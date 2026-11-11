import assert from "node:assert/strict";
import { mkdtempSync, realpathSync, symlinkSync } from "node:fs";
import path from "node:path";

export function createPostgresAccessPaths(tempDirectory, postgresBin, profile) {
  const temp = realpathSync(tempDirectory);
  assert.match(temp, /^[\x20-\x7e]+$/, "The proof needs an ASCII temporary parent for the PostgreSQL junctions.");
  const access = mkdtempSync(path.join(temp, "Prowess storage "));
  const runtimePath = path.join(access, "runtime");
  const profilePath = path.join(access, "profile");
  const physicalBin = realpathSync(postgresBin);
  const physicalProfile = realpathSync(profile);

  // Keep PostgreSQL's bin and its sibling share/lib directories under one junction.
  symlinkSync(path.dirname(physicalBin), runtimePath, "junction");
  symlinkSync(physicalProfile, profilePath, "junction");
  const bin = path.join(runtimePath, path.basename(physicalBin));
  assert.equal(realpathSync(bin), physicalBin);
  assert.equal(realpathSync(profilePath), physicalProfile);
  return { bin, profile: profilePath };
}
