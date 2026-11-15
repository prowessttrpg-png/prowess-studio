import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { once } from "node:events";
import http from "node:http";
import test from "node:test";
import { inspectBackup } from "./backup.mjs";
import { createDesktopGateway } from "./gateway.mjs";

const prefix = "/__prowess_desktop";

test("desktop authority is confined to authenticated same-origin sessions", async () => {
  const controlToken = "a".repeat(64);
  const backendToken = "b".repeat(64);
  const backend = http.createServer((request, response) => {
    response.end(JSON.stringify(request.headers));
  });
  backend.listen(0, "127.0.0.1");
  await once(backend, "listening");
  const gateway = await createDesktopGateway({
    controlToken, backendToken, status: () => ({ ready: true }), quit: () => {},
  });
  gateway.setBackend(backend.address().port);
  const request = (route, options) => new Promise((resolve, reject) => {
    const outgoing = http.request(gateway.origin + route, options, async (response) => {
      try {
        const data = [];
        for await (const chunk of response) data.push(chunk);
        resolve({ status: response.statusCode, headers: response.headers, text: Buffer.concat(data).toString() });
      } catch (error) { reject(error); }
    });
    outgoing.on("error", reject);
    outgoing.end(options?.body);
  });
  const post = (route, headers, body) => request(route, { method: "POST", headers, body });
  try {
    assert.equal((await request("/")).status, 401, "uncredentialed session must be refused");
    assert.equal((await request("/", { headers: { host: "outside.test" } })).status, 403, "untrusted Host must be refused");
    assert.equal((await post(prefix + "/control", {}, "open")).status, 403, "uncredentialed control must be refused");
    const issue = await post(prefix + "/control", { "x-prowess-control": controlToken }, "open");
    assert.equal(issue.status, 200);
    const ticket = new URL(issue.text);
    const redeem = () => post(prefix + "/session", { origin: gateway.origin }, ticket.hash.slice(1));
    const session = await redeem();
    assert.equal(session.status, 200);
    assert.equal((await redeem()).status, 403, "launch ticket must be single-use");
    const cookie = session.headers["set-cookie"][0].split(";")[0];
    assert.equal((await post("/api/characters", { cookie, origin: "https://outside.test" }, "bad")).status, 403,
      "cross-origin write must be refused");
    const allowed = await post("/api/characters", { cookie, origin: gateway.origin, "x-prowess-desktop-backend": "fake",
      "x-forwarded-host": "outside.test", "x-prowess-control": controlToken }, "allowed");
    assert.equal(allowed.status, 200);
    const forwarded = JSON.parse(allowed.text);
    assert.equal(forwarded["x-prowess-desktop-backend"], backendToken);
    assert.equal(forwarded["x-forwarded-host"], new URL(gateway.origin).host);
    assert.equal(forwarded["x-prowess-control"], undefined);
    assert.equal(forwarded.cookie, "");
    gateway.invalidateSessions();
    assert.equal((await request("/", { headers: { cookie } })).status, 401, "restore must invalidate the old browser session");
  } finally {
    await gateway.close();
    await new Promise((resolve) => backend.close(resolve));
  }
});

test("backup inspection verifies the digest, migration sequence, and application version", () => {
  const spec = { appVersion: "0.1.1", migrations: ["first", "second"], tables: ["characters"] };
  const data = { appVersion: "0.1.0", postgresMajor: 16, migrations: spec.migrations, setup: "demo",
    tables: [{ table: "characters", columns: ["id"], rows: [] }] };
  function pack(value, corrupt = false) {
    const payload = JSON.stringify(value);
    const sha256 = createHash("sha256").update(corrupt ? "" : payload).digest("hex");
    return Buffer.from(JSON.stringify({ format: "prowess-workspace-1", payload, sha256 }));
  }
  assert.deepEqual(inspectBackup(pack(data), spec), { entries: data.tables, setup: "demo" });
  assert.throws(() => inspectBackup(pack(data, true), spec), /damaged/, "corrupt backup must be refused");
  assert.throws(() => inspectBackup(pack({ ...data, migrations: ["second", "first"] }), spec), /compatible/,
    "mismatched migration history must be refused");
  assert.throws(() => inspectBackup(pack({ ...data, appVersion: "0.2.0" }), spec), /compatible/,
    "newer backup must be refused");
});
