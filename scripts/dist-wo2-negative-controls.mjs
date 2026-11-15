import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { applyEdits, runControls, vitestGuard } from "./lib/control-harness.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const guard = vitestGuard(root, "packages/prowess-db", [
  "--config", "vitest.unit.config.ts", "tests/unit/content-pack-manifest.test.ts", "--maxWorkers=1", "--reporter=dot",
], { timeout: 120_000, ciEnv: false });
const archive = "packages/prowess-db/src/content-pack/archive.ts";
const manifest = "packages/prowess-db/src/content-pack/manifest.ts";
const mutations = [
  ["unchecked archive end", archive, "if (offset !== bytes.byteLength)", "if (false)", /round-trips byte-identical framed archives/],
  ["record payload hash omitted", manifest, "file.byteSize !== bytes.byteLength || file.sha256 !== hash(bytes)", "file.byteSize !== bytes.byteLength", /rejects undeclared files, missing files and altered bytes/],
  ["original exact Release pins are ignored", manifest, "if (computeManifestHash(selectedPins) !== manifest.release.manifestHash)", "if (false)", /checks exact pins against the original Release hash/],
  ["unvalidated logical member paths", manifest, "if (file.path !== expected)", "if (false)", /rejects archive path aliases/],
];

runControls({
  root,
  title: "DIST-WO2",
  controls: mutations.map(([name, file, before, after, expected]) => ({
    name, file, guard, mutate: applyEdits(name, [[before, after]]),
    expect: new RegExp(`${expected.source}[\\s\\S]*AssertionError`, "i"),
  })),
  caught: (name) => `Caught and restored: ${name}`,
  done: (count) => `All ${count} DIST-WO2 controls caught and restored.`,
});
