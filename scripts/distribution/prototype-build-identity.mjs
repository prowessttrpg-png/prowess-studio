import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, readdirSync, readlinkSync, writeFileSync } from "node:fs";
import path from "node:path";

export const prototypeNodeVersion = "v22.23.4";
export const prototypePnpmVersion = "9.15.9";

export function assertPrototypeToolchain() {
  if (process.version !== prototypeNodeVersion || process.arch !== "x64" || !["win32", "linux"].includes(process.platform)) {
    throw new Error("Use Node " + prototypeNodeVersion + " on Windows or Linux x64 for the prototype.");
  }
}

export function readCleanSource(repository) {
  const git = (...args) => execFileSync("git", args, { cwd: repository, encoding: "utf8" }).trim();
  if (git("status", "--porcelain=v1", "--untracked-files=all")) {
    throw new Error("Prototype evidence requires a clean source checkout.");
  }
  const [commit, tree] = git("rev-parse", "HEAD", "HEAD^{tree}").split(/\r?\n/);
  return { commit, tree };
}

// Include names, contents, executable bits and link targets. Traversal never
// follows a link, so the digest describes the artifact's own tree.
function treeSha256(root, entries) {
  const hash = createHash("sha256");
  function visit(segments) {
    const file = path.join(root, ...segments);
    const name = segments.join("/");
    const stat = lstatSync(file);
    if (stat.isDirectory()) {
      hash.update(JSON.stringify(["directory", name]) + "\n");
      for (const entry of readdirSync(file).sort()) visit([...segments, entry]);
    } else if (stat.isSymbolicLink()) {
      hash.update(JSON.stringify(["link", name, readlinkSync(file)]) + "\n");
    } else if (stat.isFile()) {
      const sha256 = createHash("sha256").update(readFileSync(file)).digest("hex");
      hash.update(JSON.stringify(["file", name, stat.mode & 0o111, sha256]) + "\n");
    } else {
      throw new Error("Unsupported prototype artifact entry " + file);
    }
  }
  for (const entry of [...entries].sort()) visit([entry]);
  return hash.digest("hex");
}

export function prototypePackageSha256(root) {
  // The manifest contains this digest. The proof records its separate digest.
  return treeSha256(root, readdirSync(root).filter((name) => name !== "prototype.json"));
}

const buildDirectory = (repository) => path.join(repository, "apps/studio/.next");
const stampFile = (directory) => path.join(directory, "prowess-prototype-build.json");
const buildEntries = ["BUILD_ID", "required-server-files.json", "standalone", "static"];

function inspectProductionBuild(directory) {
  if (!lstatSync(directory).isDirectory()) throw new Error("Expected a physical Next.js build directory.");
  for (const name of buildEntries) {
    const stat = lstatSync(path.join(directory, name));
    const valid = name === "standalone" || name === "static" ? stat.isDirectory() : stat.isFile();
    if (!valid) throw new Error("Invalid prototype build entry " + name);
  }
  const buildId = readFileSync(path.join(directory, "BUILD_ID"), "utf8").trim();
  const studio = path.join(directory, "standalone/apps/studio");
  const packagedId = readFileSync(path.join(studio, ".next/BUILD_ID"), "utf8").trim();
  const { config } = JSON.parse(readFileSync(path.join(directory, "required-server-files.json"), "utf8"));
  if (!buildId || packagedId !== buildId || config?.output !== "standalone" || !lstatSync(path.join(studio, "server.js")).isFile()) {
    throw new Error("Expected one complete production standalone build with matching Next.js build IDs.");
  }
  const project = path.dirname(directory);
  const entries = buildEntries.map((name) => ".next/" + name);
  const publicAssets = path.join(project, "public");
  if (existsSync(publicAssets)) {
    if (!lstatSync(publicAssets).isDirectory()) throw new Error("Expected a physical public asset directory.");
    entries.push("public");
  }
  return { buildId, outputSha256: treeSha256(project, entries) };
}

function matchesSource(source, recorded) {
  return source.commit === recorded?.commit && source.tree === recorded?.tree;
}

export function recordPrototypeBuild(repository, expectedSource) {
  const source = readCleanSource(repository);
  if (!matchesSource(source, expectedSource)) throw new Error("The source commit or tree changed during the prototype build.");
  const directory = buildDirectory(repository);
  const stamp = {
    version: 1, ...source, ...inspectProductionBuild(directory),
    platform: process.platform, architecture: process.arch,
    nodeVersion: process.version, pnpmVersion: prototypePnpmVersion,
  };
  writeFileSync(stampFile(directory), JSON.stringify(stamp, null, 2) + "\n", { flag: "wx" });
  return stamp;
}

export function verifyPrototypeBuild(repository) {
  const source = readCleanSource(repository);
  const directory = buildDirectory(repository);
  let stamp;
  try {
    stamp = JSON.parse(readFileSync(stampFile(directory), "utf8"));
  } catch (error) {
    throw new Error("Missing or unreadable prototype build record. Run build-prototype.mjs in a fresh checkout.", { cause: error });
  }
  if (stamp?.version !== 1 || !matchesSource(source, stamp)) {
    throw new Error("Prototype build commit or tree does not match the staging checkout. Rebuild with build-prototype.mjs.");
  }
  if (stamp.platform !== process.platform || stamp.architecture !== process.arch ||
      stamp.nodeVersion !== process.version || stamp.pnpmVersion !== prototypePnpmVersion) {
    throw new Error("Prototype build toolchain does not match the staging environment.");
  }
  const observed = inspectProductionBuild(directory);
  if (observed.buildId !== stamp.buildId || observed.outputSha256 !== stamp.outputSha256) {
    throw new Error("Prototype production output differs from the recorded build. Rebuild with build-prototype.mjs.");
  }
  return stamp;
}
