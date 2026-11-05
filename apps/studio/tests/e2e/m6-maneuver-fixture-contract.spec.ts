import { expect, test, type Page, type Route } from "@playwright/test";
import { maneuverUiApi } from "./m6-wo8-ui-api";

/** Node-only contract check; no browser fixture or PostgreSQL connection. The six browser scenarios remain separate. */
test("approved browser API fixtures execute the actual engine and preserve current revisions", async () => {
  let handler!: (route: Route) => Promise<unknown>;
  const page = { route: async (_match: unknown, callback: typeof handler) => { handler = callback; } } as unknown as Page;
  const api = await maneuverUiApi(page, "basic", true);
  const call = async (path: string, method = "GET", body: unknown = null) => {
    let status = 0, payload: Record<string, unknown> = {};
    await handler({ request: () => ({ method: () => method, url: () => `http://localhost/api/characters/character/maneuvers/maneuver${path}`, postDataJSON: () => body }), fulfill: async (response: { status: number; body: string }) => { status = response.status; payload = JSON.parse(response.body); } } as unknown as Route);
    return { status, payload };
  };
  const loaded = await call("/builder"); expect(loaded.status).toBe(200);
  const validate = await call("/validate", "POST", { expectedVersion: api.version() });
  expect(JSON.stringify(validate.payload)).toContain('"state":"VALID"');
  const finalized = await call("/finalize", "POST", { expectedVersion: api.version() }); expect(finalized.status).toBe(200);
  const detail = await call(""); expect(JSON.stringify(detail.payload)).toContain('"used":2');
  expect(JSON.stringify(detail.payload)).toContain('"revisionNumber":1');
  await call("/rebuild", "POST", { expectedVersion: api.version() });
  const bad = structuredClone(api.draft()); bad.effects = []; bad.effectAttachments = [];
  await call("/draft", "PUT", { expectedVersion: api.version(), draft: bad });
  expect((await call("/finalize", "POST", { expectedVersion: api.version() })).status).toBe(422);
  expect(JSON.stringify((await call("")).payload)).toContain('"revisionNumber":1');
});
