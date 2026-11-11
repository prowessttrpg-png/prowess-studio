// Produce one documented production build from a new worktree of the exact source commit.
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  assertPrototypeToolchain, prototypePnpmVersion, readCleanSource, recordPrototypeBuild,
} from "./prototype-build-identity.mjs";

const repository = realpathSync(path.resolve(import.meta.dirname, "../.."));
const [output, ...extra] = process.argv.slice(2);
if (!output || extra.length) throw new Error("Usage: node scripts/distribution/build-prototype.mjs <new-build-checkout>");
assertPrototypeToolchain();
const target = path.resolve(output);
const checkout = path.join(realpathSync(path.dirname(target)), path.basename(target));
const relative = path.relative(repository, checkout);
if (existsSync(checkout) || !relative || (!path.isAbsolute(relative) && relative.split(path.sep)[0] !== "..")) {
  throw new Error("Use a new build directory outside the source checkout.");
}
const source = readCleanSource(repository);
const nodeDirectory = path.dirname(process.execPath);
const corepack = path.resolve(nodeDirectory, process.platform === "win32"
  ? "node_modules/corepack/dist/corepack.js"
  : "../lib/node_modules/corepack/dist/corepack.js");
if (!existsSync(corepack)) throw new Error("Use the extracted official Node distribution with Corepack.");

execFileSync("git", ["worktree", "add", "--detach", "--", checkout, source.commit], { cwd: repository, stdio: "inherit" });
const shims = mkdtempSync(path.join(os.tmpdir(), "prowess-build-pnpm-"));
const env = { ...process.env, CI: "true" };
const pathKey = Object.keys(env).find((name) => name.toLowerCase() === "path") ?? "PATH";
env[pathKey] = [shims, nodeDirectory, process.env.PATH].filter(Boolean).join(path.delimiter);
const pnpm = (args, options = {}) => execFileSync(process.execPath, [corepack, "pnpm", ...args], {
  cwd: checkout, env, stdio: "inherit", ...options,
});
try {
  execFileSync(process.execPath, [corepack, "enable", "--install-directory", shims, "pnpm"], { cwd: checkout, env, stdio: "inherit" });
  const version = pnpm(["--version"], { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] }).trim();
  if (version !== prototypePnpmVersion) throw new Error("Expected pnpm " + prototypePnpmVersion + ", found " + version);
  pnpm(["install", "--frozen-lockfile", "--prod=false"]);
  Object.assign(env, {
    NODE_ENV: "production",
    DATABASE_URL: "postgresql://dist_prototype:build@127.0.0.1:1/dist_build_unused",
    APP_URL: "http://127.0.0.1:3000",
    DEVELOPMENT_MODE: "false",
    LOG_LEVEL: "warn",
    NEXT_TELEMETRY_DISABLED: "1",
    PROWESS_STANDALONE_BUILD: "true",
  });
  pnpm(["db:generate"]);
  pnpm(["build"]);
  const stamp = recordPrototypeBuild(checkout, source);
  console.log("Recorded prototype build " + stamp.buildId + " from " + stamp.commit + " in " + checkout);
} finally {
  rmSync(shims, { recursive: true, force: true });
}
