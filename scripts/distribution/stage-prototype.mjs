// Build-side staging for the DIST-WO1 feasibility test.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, readlinkSync, realpathSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { relativeInside } from "./prototype-links.mjs";

const repository = path.resolve(import.meta.dirname, "../..");
const studio = path.join(repository, "apps/studio");
const database = path.join(repository, "packages/prowess-db");
const standalone = path.join(studio, ".next/standalone");
const windows = process.platform === "win32";
const nodeVersion = "v22.23.4";
const windowsPostgres = {
  package: "@embedded-postgres/windows-x64",
  version: "16.14.0-beta.17",
  archive: "https://registry.npmjs.org/@embedded-postgres/windows-x64/-/windows-x64-16.14.0-beta.17.tgz",
  sha512: "Wn4nuAT1H7SIJuLWPs+C1aSdZKpbTloCr0Xaozdfg956lUVvv3iHv6K8Lsc+xmtt1qQpTno3PJLqAgzJ/lg60Q==",
};

const [output, postgresArchive, crtDirectory, ...extra] = process.argv.slice(2);
if (!output || extra.length || Boolean(postgresArchive) !== windows || Boolean(crtDirectory) !== windows) {
  throw new Error("Usage: node scripts/distribution/stage-prototype.mjs <new-output-directory> [Windows-PostgreSQL-archive x64-CRT-directory]");
}
if (process.version !== nodeVersion || process.arch !== "x64" || (!windows && process.platform !== "linux")) {
  throw new Error("Build this prototype using Node " + nodeVersion + " on Windows or Linux x64.");
}
const resolvedOutput = path.resolve(output);
const stage = path.join(realpathSync(path.dirname(resolvedOutput)), path.basename(resolvedOutput));
const stageRelative = path.relative(repository, stage);
if (!stageRelative || (!path.isAbsolute(stageRelative) && stageRelative.split(path.sep)[0] !== "..")) {
  throw new Error("Stage the prototype outside the source checkout.");
}
const readGit = (...args) => execFileSync("git", args, { cwd: repository, encoding: "utf8" }).trim();
const commit = readGit("rev-parse", "HEAD");
const tree = readGit("rev-parse", "HEAD^{tree}");
const clean = readGit("status", "--porcelain") === "";
if (!existsSync(path.join(standalone, "apps/studio/server.js"))) {
  throw new Error("Run the production build with PROWESS_STANDALONE_BUILD=true first.");
}
if (windows && createHash("sha512").update(readFileSync(postgresArchive)).digest("base64") !== windowsPostgres.sha512) {
  throw new Error("The Windows PostgreSQL archive differs from the pinned archive.");
}

function readWindowsCrt(input) {
  const directory = realpathSync(input);
  const architecture = path.dirname(directory);
  const version = path.basename(path.dirname(architecture));
  if (path.basename(directory) !== "Microsoft.VC143.CRT" || path.basename(architecture) !== "x64" || !/^14\.\d+\.\d+$/.test(version)) {
    throw new Error("Supply the versioned Visual Studio redistributable directory MSVC/<version>/x64/Microsoft.VC143.CRT.");
  }
  const files = readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".dll"))
    .map((entry) => {
      const bytes = readFileSync(path.join(directory, entry.name));
      const pe = bytes.length >= 64 && bytes.readUInt16LE(0) === 0x5a4d ? bytes.readUInt32LE(60) : -1;
      if (pe < 0 || pe + 6 > bytes.length || bytes.readUInt32LE(pe) !== 0x4550 || bytes.readUInt16LE(pe + 4) !== 0x8664) {
        throw new Error("Expected an x64 redistributable DLL: " + entry.name);
      }
      return { name: entry.name, sha256: createHash("sha256").update(bytes).digest("hex") };
    });
  const names = new Set(files.map((file) => file.name.toLowerCase()));
  for (const dll of ["msvcp140.dll", "vcruntime140.dll"]) {
    if (!names.has(dll)) throw new Error("The redistributable directory is missing " + dll);
  }
  return { directory, version, files };
}

const crtInput = windows ? readWindowsCrt(crtDirectory) : null;
const links = new Map();
function copyEntry(source, destination) {
  if (/^\.env(?:\.|$)/i.test(path.basename(source))) return;
  const stat = lstatSync(source);
  if (stat.isSymbolicLink()) {
    const target = path.resolve(path.dirname(source), readlinkSync(source));
    const inStandalone = path.relative(standalone, target);
    const relativeTarget = inStandalone && !path.isAbsolute(inStandalone) && inStandalone.split(path.sep)[0] !== ".."
      ? inStandalone
      : relativeInside(repository, target);
    mkdirSync(path.dirname(destination), { recursive: true });
    links.set(relativeInside(stage, destination), path.join("app", relativeTarget));
  } else if (stat.isDirectory()) {
    mkdirSync(destination, { recursive: true });
    for (const name of readdirSync(source)) copyEntry(path.join(source, name), path.join(destination, name));
  } else if (stat.isFile()) {
    mkdirSync(path.dirname(destination), { recursive: true });
    copyFileSync(source, destination);
  } else {
    throw new Error("Unsupported package entry " + source);
  }
}

const requireStudio = createRequire(path.join(studio, "package.json"));
const requireDb = createRequire(path.join(database, "package.json"));
const prismaPackage = requireDb.resolve("prisma/package.json");
const requirePrisma = createRequire(prismaPackage);
const prismaCli = path.join(path.dirname(prismaPackage), "build/index.js");
const engineDirectory = path.dirname(requirePrisma.resolve("@prisma/engines/package.json"));
const schemaEngines = readdirSync(engineDirectory).filter((name) => name.startsWith("schema-engine-"));
if (schemaEngines.length !== 1 || schemaEngines[0].endsWith(".exe") !== windows) {
  throw new Error("Expected exactly one schema engine for the build platform.");
}
const schemaEngine = path.join(engineDirectory, schemaEngines[0]);
const { nodeFileTrace } = requireStudio("next/dist/compiled/@vercel/nft");
const trace = await nodeFileTrace([
  prismaCli,
  path.join(database, "prisma.config.ts"),
  path.join(database, "node_modules/prisma/config.js"),
], { base: repository, processCwd: database });
trace.fileList.add(relativeInside(repository, schemaEngine));

mkdirSync(stage);
const app = path.join(stage, "app");
const stagedStudio = path.join(app, "apps/studio");
const stagedDatabase = path.join(app, "packages/prowess-db");
copyEntry(standalone, app);
copyEntry(path.join(studio, ".next/static"), path.join(stagedStudio, ".next/static"));
if (existsSync(path.join(studio, "public"))) copyEntry(path.join(studio, "public"), path.join(stagedStudio, "public"));
for (const file of trace.fileList) {
  copyEntry(path.join(repository, file), path.join(app, file));
}
copyEntry(path.join(database, "prisma"), path.join(stagedDatabase, "prisma"));

const node = path.join("runtime", windows ? "node.exe" : "node");
mkdirSync(path.join(stage, "runtime"));
copyFileSync(process.execPath, path.join(stage, node));
const nodeRoot = windows ? path.dirname(process.execPath) : path.resolve(path.dirname(process.execPath), "..");
copyFileSync(path.join(nodeRoot, "LICENSE"), path.join(stage, "runtime", "Node-LICENSE.txt"));
cpSync(path.join(repository, "pnpm-lock.yaml"), path.join(stage, "pnpm-lock.yaml"));

let postgres = null;
let crt = null;
if (windows) {
  const postgresDirectory = path.join(stage, "runtime/postgres");
  mkdirSync(postgresDirectory);
  execFileSync("tar.exe", ["-xzf", path.resolve(postgresArchive), "-C", postgresDirectory, "--strip-components=1"]);
  const binaryDirectory = path.join(postgresDirectory, "native/bin");
  for (const exe of ["postgres.exe", "pg_ctl.exe", "initdb.exe"]) {
    if (!existsSync(path.join(binaryDirectory, exe))) throw new Error("The PostgreSQL archive is missing " + exe);
  }
  postgres = { ...windowsPostgres, bin: relativeInside(stage, binaryDirectory) };
  const destinations = [path.join(stage, "runtime"), binaryDirectory, path.join(app, relativeInside(repository, engineDirectory))];
  for (const destination of destinations) {
    for (const file of crtInput.files) {
      copyFileSync(path.join(crtInput.directory, file.name), path.join(destination, file.name));
    }
  }
  crt = { version: crtInput.version, source: "Visual Studio MSVC x64 Microsoft.VC143.CRT redistributable", files: crtInput.files };
}

const metadata = {
  commit, tree, clean, platform: process.platform, architecture: process.arch, nodeVersion,
  node, postgres, crt,
  nodeSha256: createHash("sha256").update(readFileSync(path.join(stage, node))).digest("hex"),
  appVersion: requireStudio("./package.json").version,
  nextVersion: requireStudio("next/package.json").version,
  prismaVersion: requirePrisma("./package.json").version,
  server: relativeInside(stage, path.join(stagedStudio, "server.js")),
  database: relativeInside(stage, stagedDatabase),
  prisma: path.join("app", relativeInside(repository, prismaCli)),
  schemaEngine: path.join("app", relativeInside(repository, schemaEngine)),
  migrations: readdirSync(path.join(stagedDatabase, "prisma/migrations"), { withFileTypes: true })
    .filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort(),
};
const linkEntries = [...links.entries()];
for (const [name, target] of linkEntries) {
  if (!existsSync(path.join(stage, target))) throw new Error("The traced package is missing the target of " + name);
}
writeFileSync(path.join(stage, "prototype.json"), JSON.stringify(metadata, null, 2) + "\n");
writeFileSync(path.join(stage, "links.json"), JSON.stringify(linkEntries, null, 2) + "\n");
copyFileSync(path.join(import.meta.dirname, "prototype-links.mjs"), path.join(stage, "prototype-links.mjs"));
console.log("Staged prototype at " + stage);
