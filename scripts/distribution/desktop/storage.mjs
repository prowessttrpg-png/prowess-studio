import { execFileSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { closeSync, existsSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync, fsyncSync } from "node:fs";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import path from "node:path";
import { identifier } from "./backup.mjs";

const username = "prowess_local";
const defaultDatabase = "prowess_workspace";
export const secret = () => randomBytes(32).toString("hex");
const readJSON = (file) => JSON.parse(readFileSync(file, "utf8"));

export function atomicJSON(file, value) {
  const temporary = file + "." + randomUUID() + ".tmp";
  const descriptor = openSync(temporary, "wx", 0o600);
  try {
    writeFileSync(descriptor, JSON.stringify(value, null, 2) + "\n");
    fsyncSync(descriptor);
  } finally { closeSync(descriptor); }
  try { renameSync(temporary, file); }
  catch (error) { rmSync(temporary, { force: true }); throw error; }
}

export async function freePort() {
  const socket = createServer();
  await new Promise((resolve, reject) => {
    socket.once("error", reject);
    socket.listen(0, "127.0.0.1", resolve);
  });
  const { port } = socket.address();
  await new Promise((resolve, reject) => socket.close((error) => error ? reject(error) : resolve()));
  return port;
}

export function readWorkspace(root) {
  const file = path.join(root, "workspace.json");
  const cluster = path.join(root, "cluster");
  if (!existsSync(file)) {
    if (existsSync(cluster)) throw new Error("A data directory exists without an installation identity. Use recovery before launching.");
    const state = {
      format: 1, id: randomUUID(), password: secret(), active: defaultDatabase,
      initialized: false, appVersion: null, migrations: [], setup: null,
    };
    atomicJSON(file, state);
    return state;
  }
  const state = readJSON(file);
  if (state.format !== 1 || !/^[0-9a-f-]{36}$/.test(state.id) || !/^[a-f0-9]{64}$/.test(state.password) ||
      !/^prowess_workspace(?:_[a-f0-9]{16})?$/.test(state.active) || typeof state.initialized !== "boolean" ||
      !Array.isArray(state.migrations) || ![null, "empty", "demo"].includes(state.setup)) {
    throw new Error("The workspace identity is invalid. Use recovery before launching.");
  }
  if (state.initialized && !existsSync(cluster)) throw new Error("The existing workspace data is missing. Use recovery before launching.");
  return state;
}

export class Storage {
  constructor({ root, accessRoot, stage, manifest, environment, log }) {
    this.root = root;
    this.accessRoot = accessRoot;
    this.stage = stage;
    this.manifest = manifest;
    this.environment = environment;
    this.log = log;
    this.postgresLog = path.join(accessRoot, "postgres.log");
    this.state = readWorkspace(root);
    const target = realpathSync(path.dirname(path.join(stage, manifest.postgres.bin)));
    const runtime = path.join(accessRoot, "pg-runtime-" + manifest.packageSha256.slice(0, 20));
    if (!existsSync(runtime)) symlinkSync(target, runtime, process.platform === "win32" ? "junction" : "dir");
    if (!lstatSync(runtime).isSymbolicLink() || realpathSync(runtime) !== target) {
      throw new Error("The local PostgreSQL runtime link has an unexpected target.");
    }
    this.bin = path.join(runtime, path.basename(manifest.postgres.bin));
    this.cluster = path.join(accessRoot, "cluster");
    this.running = false;
    const module = path.join(stage, manifest.desktopClient);
    const { Client } = createRequire(module)(module);
    this.Client = Client;
  }

  persist(changes) {
    const next = { ...this.state, ...changes };
    atomicJSON(path.join(this.root, "workspace.json"), next);
    this.state = next;
  }

  command(name, args, { timeout = 60_000, acceptMissing = false } = {}) {
    const suffix = process.platform === "win32" ? ".exe" : "";
    const descriptor = openSync(this.log, "a");
    try {
      execFileSync(path.join(this.bin, name + suffix), args, {
        cwd: this.accessRoot, env: this.environment, windowsHide: true, timeout,
        stdio: ["ignore", descriptor, descriptor],
      });
      return true;
    } catch (error) {
      if (acceptMissing && error.status === 3) return false;
      throw new Error("PostgreSQL " + name + " failed. Check the workspace recovery instructions.");
    } finally { closeSync(descriptor); }
  }

  url(database) {
    return "postgresql://" + username + ":" + this.state.password + "@127.0.0.1:" + this.port + "/" + database;
  }

  async withClient(database, operation) {
    const client = new this.Client({
      user: username, password: this.state.password, host: "127.0.0.1", port: this.port,
      database, connectionTimeoutMillis: 5000, statement_timeout: 60_000,
    });
    await client.connect();
    try { return await operation(client); }
    finally { await client.end(); }
  }

  async start() {
    if (existsSync(this.cluster)) {
      const versionFile = path.join(this.cluster, "PG_VERSION");
      if (!existsSync(versionFile)) throw new Error("The data directory contains an interrupted initialization. Keep it for recovery.");
      if (readFileSync(versionFile, "utf8").trim() !== "16") throw new Error("The workspace uses an incompatible PostgreSQL major version.");
    } else {
      const passwordFile = path.join(this.accessRoot, "initdb-" + randomUUID());
      writeFileSync(passwordFile, this.state.password + "\n", { flag: "wx", mode: 0o600 });
      try {
        this.command("initdb", ["-D", this.cluster, "-U", username, "--pwfile=" + passwordFile,
          "--auth=scram-sha-256", "--locale=C", "--encoding=UTF8"]);
      } finally { rmSync(passwordFile, { force: true }); }
    }
    if (this.command("pg_ctl", ["-D", this.cluster, "status"], { acceptMissing: true })) {
      throw new Error("PostgreSQL reports an existing process for this workspace. Close the owned installation before recovery.");
    }

    this.port = await freePort();
    this.command("pg_ctl", ["-D", this.cluster, "-l", this.postgresLog, "-w", "-t", "30", "-o",
      "-h 127.0.0.1 -p " + this.port + " -c unix_socket_directories=", "start"]);
    this.running = true;
    await this.withClient("postgres", async (client) => {
      const settings = (await client.query(`
        SELECT current_setting('data_directory') AS path, current_setting('server_version_num')::int AS version
      `)).rows[0];
      if (realpathSync(settings.path) !== realpathSync(this.cluster) || settings.version !== 160014) {
        throw new Error("The PostgreSQL instance does not match the local installation.");
      }
      if (!this.state.initialized) {
        await client.query("CREATE TABLE IF NOT EXISTS public.prowess_local_owner (id uuid PRIMARY KEY)");
        const { rows } = await client.query("SELECT id FROM public.prowess_local_owner");
        if (rows.length === 0) await client.query("INSERT INTO public.prowess_local_owner (id) VALUES ($1)", [this.state.id]);
      }
      const { rows } = await client.query("SELECT id FROM public.prowess_local_owner");
      if (rows.length !== 1 || rows[0].id !== this.state.id) throw new Error("The database belongs to another installation.");
    });
    if (!this.state.initialized) this.persist({ initialized: true });
  }

  async newDatabase(template) {
    const name = defaultDatabase + "_" + randomBytes(8).toString("hex");
    await this.withClient("postgres", (client) => client.query("CREATE DATABASE " + identifier(name) +
      (template ? " TEMPLATE " + identifier(template) : "")));
    return name;
  }

  prisma(database, ...args) {
    const descriptor = openSync(this.log, "a");
    try {
      execFileSync(path.join(this.stage, this.manifest.node), [path.join(this.stage, this.manifest.prisma), ...args], {
        cwd: path.join(this.stage, this.manifest.database), windowsHide: true, timeout: 120_000,
        env: {
          ...this.environment, DATABASE_URL: this.url(database),
          PRISMA_SCHEMA_ENGINE_BINARY: path.join(this.stage, this.manifest.schemaEngine),
          PRISMA_HIDE_UPDATE_MESSAGE: "1", CHECKPOINT_DISABLE: "1",
        },
        stdio: ["ignore", descriptor, descriptor],
      });
    } catch { throw new Error("The workspace schema check failed. The launcher has kept the existing workspace for recovery."); }
    finally { closeSync(descriptor); }
  }

  checkSchema(database) {
    this.prisma(database, "migrate", "status");
    this.prisma(database, "migrate", "diff", "--from-config-datasource", "--to-schema", "prisma/schema.prisma", "--exit-code");
  }

  async checkHistory(database, expected) {
    const rows = await this.withClient(database, async (client) => (await client.query(`
      SELECT migration_name, finished_at IS NOT NULL AS applied FROM public._prisma_migrations
      WHERE rolled_back_at IS NULL ORDER BY migration_name
    `)).rows);
    if (rows.length !== expected.length || rows.some((row, index) => !row.applied || row.migration_name !== expected[index])) {
      throw new Error("The existing workspace migration history does not match the last installed version.");
    }
  }

  stop() {
    if (!this.running) return;
    if (this.command("pg_ctl", ["-D", this.cluster, "status"], { acceptMissing: true })) {
      this.command("pg_ctl", ["-D", this.cluster, "-w", "-t", "30", "-m", "fast", "stop"]);
    }
    this.running = false;
  }
}
