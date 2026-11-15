import path from "node:path";
import { spawnSync } from "node:child_process";
import { applyEdits, keyedGuard, runControls } from "../../lib/control-harness.mjs";

const root = path.resolve(import.meta.dirname, "../../..");
const directory = "scripts/distribution/desktop/";
const test = directory + "desktop-boundary.test.mjs";
const guard = keyedGuard(test, () => spawnSync(process.execPath, ["--test", test], {
  cwd: root, encoding: "utf8", timeout: 30_000,
}));
const controls = [
  ["untrusted Host", "gateway.mjs", "request.headers.host !== host", "false", /untrusted Host must be refused/],
  ["missing control secret", "gateway.mjs", '!matches(request.headers["x-prowess-control"], controlToken)', "false",
    /uncredentialed control must be refused/],
  ["launch token replay", "gateway.mjs", "      launches.delete(key);", "", /launch ticket must be single-use/],
  ["retained session at cutover", "gateway.mjs", "sessions.clear(); launches.clear();", "launches.clear();",
    /restore must invalidate the old browser session/],
  ["changed backup content", "backup.mjs", "digest(envelope.payload) !== envelope.sha256", "false", /corrupt backup must be refused/],
  ["newer backup", "backup.mjs", "compareVersions(payload.appVersion, appVersion) > 0", "false", /newer backup must be refused/],
];
runControls({ root, title: "DIST-WO1", controls: controls.map(([name, file, from, to, expect]) => ({
  name, file: directory + file, mutate: applyEdits(name, [[from, to]]), guard, expect,
})) });
