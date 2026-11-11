import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { prototypePackageSha256, readCleanSource, recordPrototypeBuild, verifyPrototypeBuild } from "./prototype-build-identity.mjs";
import { requireOrdinaryWindowsAccount } from "./windows-proof-environment.mjs";
import { createPostgresAccessPaths } from "./windows-postgres-paths.mjs";

function disposableDirectory(t) {
  const directory = mkdtempSync(path.join(os.tmpdir(), "prowess-proof-test-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

function buildFixture(t) {
  const repository = disposableDirectory(t);
  const git = (...args) => execFileSync("git", ["-c", "user.name=Prototype Test", "-c", "user.email=prototype@example.invalid",
    "-c", "commit.gpgsign=false", ...args], { cwd: repository, stdio: "pipe" });
  git("init", "--quiet");
  writeFileSync(path.join(repository, ".gitignore"), ".next/\n");
  const input = path.join(repository, "source.txt");
  writeFileSync(input, "tracked source\n");
  git("add", ".");
  git("commit", "--quiet", "-m", "Fixture source");
  const source = readCleanSource(repository);

  const output = path.join(repository, "apps/studio/.next");
  const studio = path.join(output, "standalone/apps/studio");
  mkdirSync(path.join(studio, ".next"), { recursive: true });
  mkdirSync(path.join(output, "static"));
  writeFileSync(path.join(output, "BUILD_ID"), "fixture-build\n");
  writeFileSync(path.join(studio, ".next/BUILD_ID"), "fixture-build\n");
  writeFileSync(path.join(output, "required-server-files.json"), '{"config":{"output":"standalone"}}\n');
  writeFileSync(path.join(studio, "server.js"), "// fixture server\n");
  const asset = path.join(output, "static/chunk.js");
  writeFileSync(asset, "// fixture asset\n");
  return { repository, source, git, input, asset, stamp: path.join(output, "prowess-prototype-build.json") };
}

test("staging rejects a standalone directory without a recorded build", (t) => {
  const { repository } = buildFixture(t);
  assert.throws(() => verifyPrototypeBuild(repository), /Missing or unreadable prototype build record/);
});

test("staging accepts the recorded clean build", (t) => {
  const { repository, source } = buildFixture(t);
  const stamp = recordPrototypeBuild(repository, source);
  assert.deepEqual(verifyPrototypeBuild(repository), stamp);
  assert.equal(stamp.commit, source.commit);
  assert.equal(stamp.tree, source.tree);
  assert.match(stamp.outputSha256, /^[a-f0-9]{64}$/);
});

test("staging rejects a stamp from another commit even when the tree matches", (t) => {
  const { repository, source, git } = buildFixture(t);
  recordPrototypeBuild(repository, source);
  git("commit", "--quiet", "--allow-empty", "-m", "Another commit with the same tree");
  assert.equal(readCleanSource(repository).tree, source.tree);
  assert.throws(() => verifyPrototypeBuild(repository), /commit or tree does not match/);
});

test("staging rejects a stamp with a mismatched tree", (t) => {
  const { repository, source, stamp } = buildFixture(t);
  const build = recordPrototypeBuild(repository, source);
  writeFileSync(stamp, JSON.stringify({ ...build, tree: "0".repeat(40) }));
  assert.throws(() => verifyPrototypeBuild(repository), /commit or tree does not match/);
});

test("staging rejects changed output at the recorded commit and build ID", (t) => {
  const { repository, source, asset } = buildFixture(t);
  recordPrototypeBuild(repository, source);
  writeFileSync(asset, "// asset from a different build\n");
  assert.throws(() => verifyPrototypeBuild(repository), /output differs from the recorded build/);
});

test("staging rejects standalone and static output with different Next.js build IDs", (t) => {
  const { repository, source } = buildFixture(t);
  recordPrototypeBuild(repository, source);
  writeFileSync(path.join(repository, "apps/studio/.next/BUILD_ID"), "other-build\n");
  assert.throws(() => verifyPrototypeBuild(repository), /matching Next.js build IDs/);
});

test("build recording and staging reject a dirty checkout", (t) => {
  const { repository, source, input } = buildFixture(t);
  recordPrototypeBuild(repository, source);
  writeFileSync(input, "modified source\n");
  assert.throws(() => recordPrototypeBuild(repository, source), /clean source checkout/);
  assert.throws(() => verifyPrototypeBuild(repository), /clean source checkout/);
});

test("the package hash covers staged files separately from the manifest", (t) => {
  const directory = disposableDirectory(t);
  const file = path.join(directory, "runtime.exe");
  writeFileSync(file, "runtime");
  const original = prototypePackageSha256(directory);
  writeFileSync(path.join(directory, "prototype.json"), JSON.stringify({ packageSha256: original }));
  assert.equal(prototypePackageSha256(directory), original);
  writeFileSync(file, Buffer.concat([readFileSync(file), Buffer.from(" different")]));
  assert.notEqual(prototypePackageSha256(directory), original);
});

const standardToken = {
  processId: 123, caption: "Microsoft Windows 11 Pro", version: "10.0.26100", build: 26100, productType: 1,
  nativeMachine: 0x8664, processMachine: 0,
  isElevated: false, isAdministrator: false, elevationType: 1,
};

test("the Windows guard records build, architecture and ordinary-user token status", () => {
  assert.deepEqual(requireOrdinaryWindowsAccount(standardToken, 123), {
    os: { caption: "Microsoft Windows 11 Pro", version: "10.0.26100", build: 26100, architecture: "x64" },
    process: { id: 123, architecture: "x64", elevated: false, administrator: false, elevationType: "Default" },
  });
});

test("the Windows guard refuses elevated, administrator, filtered and unreported tokens", () => {
  for (const token of [
    { isElevated: true, elevationType: 2 }, { isAdministrator: true }, { elevationType: 3 },
    { isElevated: undefined }, { isAdministrator: "false" },
  ]) {
    assert.throws(() => requireOrdinaryWindowsAccount({ ...standardToken, ...token }, 123), /standard Windows user account/);
  }
});

test("the Windows guard refuses a different process, Windows Server and x64 emulation", () => {
  assert.throws(() => requireOrdinaryWindowsAccount(standardToken, 456), /probe process/);
  assert.throws(() => requireOrdinaryWindowsAccount({ ...standardToken, productType: 3 }, 123), /native x64 Windows 11 workstation/);
  assert.throws(() => requireOrdinaryWindowsAccount({ ...standardToken, nativeMachine: 0xaa64, processMachine: 0x8664 }, 123),
    /native x64 Windows 11 workstation/);
});

test("PostgreSQL can address the accented package and profile through ASCII paths", (t) => {
  const temp = disposableDirectory(t);
  const runtime = path.join(temp, "Prowess prototype é", "runtime", "postgres", "native");
  const bin = path.join(runtime, "bin");
  const share = path.join(runtime, "share");
  const profile = path.join(temp, "Prowess essai é");
  mkdirSync(bin, { recursive: true });
  mkdirSync(share);
  mkdirSync(profile);
  writeFileSync(path.join(bin, "initdb.exe"), "staged binary");
  writeFileSync(path.join(share, "postgres.bki"), "staged catalog");

  const access = createPostgresAccessPaths(temp, bin, profile);
  assert.match(access.bin, /^[\x20-\x7e]+$/);
  assert.match(access.profile, /^[\x20-\x7e]+$/);
  assert.equal(readFileSync(path.join(access.bin, "initdb.exe"), "utf8"), "staged binary");
  assert.equal(readFileSync(path.join(access.bin, "..", "share", "postgres.bki"), "utf8"), "staged catalog");
  writeFileSync(path.join(access.profile, "postgres.log"), "test log");
  assert.equal(readFileSync(path.join(profile, "postgres.log"), "utf8"), "test log");
});
