import { afterEach, describe, expect, it, vi } from "vitest";
import { CONTRACT_DESCRIPTORS, GENERIC_DESCRIPTOR, descriptorFor, initialPayload, type FieldDescriptor } from "../../app/compendium/admin/_lib/descriptors";
import { fieldDomId, isDirty, isExactReference, issuesForField, newCandidate, stableStringify, storedCandidate, suggestCanonicalKey, unplacedIssues } from "../../app/compendium/admin/_lib/definition-form";
import { AuthoringApiError, createDefinition, saveDraft, validateCandidate } from "../../app/compendium/admin/_lib/authoring-client";
import { listAllRulesets } from "../../src/api-client";
import { CATALOG, issue } from "./m6-wo1-fixtures";

/**
 * PAS-10 M6-WO1 — authoring presentation layer, pure parts (§12–13, §19, §35, §37). Descriptors describe the M5
 * contract without owning it; the client only transports; dirty state, field / issue association and the explicit
 * canonical-key suggestion are deterministic.
 */
afterEach(() => vi.unstubAllGlobals());

describe("authoring descriptors (M6-I002 UI never owns mechanics)", () => {
  it("cover every shared contract the catalog reports; other kinds fall back to the generic structured editor", () => {
    for (const k of CATALOG.kinds.filter((x) => x.sharedContract !== null)) expect(descriptorFor(k, 1), k.definitionKind).toBe(CONTRACT_DESCRIPTORS[k.sharedContract!]);
    expect(descriptorFor({ definitionKind: "AFFINITY", sharedContract: null }, 2)).toBe(GENERIC_DESCRIPTOR);
    expect(descriptorFor({ definitionKind: "STAT", sharedContract: null }, 1)).toBe(GENERIC_DESCRIPTOR);
    expect(descriptorFor({ definitionKind: "AFFINITY", sharedContract: null }, 1).fields.map((f) => f.key)).toEqual(["affinity"]);
  });

  it("every select names a vocabulary the catalog serves — option VALUES are never written in the descriptor", () => {
    const fields: FieldDescriptor[] = Object.values(CONTRACT_DESCRIPTORS).flatMap((d) => [...d.fields]);
    for (const f of fields.filter((x) => x.input === "select")) expect(Object.keys(CATALOG.vocabularies), f.key).toContain((f as { vocabulary: string }).vocabulary);
    // Descriptors are KEYED by the M5 shared-contract name (that is how they attach to a kind); their CONTENT holds no value.
    const text = JSON.stringify(Object.values(CONTRACT_DESCRIPTORS));
    for (const vocabulary of Object.values(CATALOG.vocabularies)) for (const value of vocabulary) expect(text, value).not.toContain(`"${value}"`);
  });

  it("Targeting renders no Effect / outcome / resolution field; Effects get the fuller mechanical surface; Traits stay concise (§57–59)", () => {
    const keys = (c: string) => CONTRACT_DESCRIPTORS[c]!.fields.map((f) => f.key);
    expect(keys("TARGETING")).not.toEqual(expect.arrayContaining(["resolution"]));
    for (const k of ["resolution", "outcomes", "effectFamily", "damage", "save"]) expect(keys("TARGETING")).not.toContain(k);
    expect(keys("EFFECT")).toEqual(expect.arrayContaining(["effectFamily", "resolution", "outcomes", "keywords", "parameters", "compatibility", "costContributions", "rules"]));
    expect(keys("TRAIT").length).toBeLessThan(keys("EFFECT").length);
  });

  it("a new candidate takes kind, family and the authoring schema version from the catalog row, with empty author values", () => {
    const effect = CATALOG.kinds.find((k) => k.definitionKind === "SPELL_EFFECT")!;
    expect(newCandidate(effect)).toEqual({ schemaVersion: 1, systemFamily: "SPELL", definitionKind: "SPELL_EFFECT", payload: initialPayload(CONTRACT_DESCRIPTORS.EFFECT!) });
    expect(newCandidate(effect).payload).toMatchObject({ effectFamily: "", resolution: null, outcomes: [], keywords: [], rules: {} });
    expect(initialPayload(GENERIC_DESCRIPTOR)).toEqual({});
  });
});

describe("definition form helpers", () => {
  it("dirty state is a deterministic deep comparison, independent of key order", () => {
    expect(stableStringify({ b: 1, a: [{ d: 1, c: 2 }] })).toBe(stableStringify({ a: [{ c: 2, d: 1 }], b: 1 }));
    expect(isDirty({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(false);
    expect(isDirty({ a: 1 }, { a: 2 })).toBe(true);
  });

  it("reads a stored candidate back; generic content is NOT a Definition (no kind is inferred, §67)", () => {
    expect(storedCandidate({ prowessDefinition: { schemaVersion: 1, systemFamily: "SPELL", definitionKind: "SPELL_EFFECT", payload: {} } })?.definitionKind).toBe("SPELL_EFFECT");
    for (const sd of [{}, null, { summary: "Spell Effect: fire damage" }, { prowessDefinition: { payload: {} } }]) expect(storedCandidate(sd)).toBeNull();
  });

  it("issues attach to the field that owns their path; the rest stay in the summary", () => {
    const issues = [issue("payload.resolution.mode"), issue("payload.outcomes[0].outcomeKey"), issue("payload.outcomesExtra"), issue("legacyTerms[0]"), issue("")];
    expect(issuesForField(issues, "resolution").map((i) => i.path)).toEqual(["payload.resolution.mode"]);
    expect(issuesForField(issues, "outcomes").map((i) => i.path)).toEqual(["payload.outcomes[0].outcomeKey"]);
    expect(issuesForField(issues, "").map((i) => i.path)).toEqual(["payload.resolution.mode", "payload.outcomes[0].outcomeKey", "payload.outcomesExtra"]);
    expect(unplacedIssues(issues, ["resolution", "outcomes"]).map((i) => i.path)).toEqual(["payload.outcomesExtra", "legacyTerms[0]", ""]);
    expect(fieldDomId("")).toBe("definition-field-payload");
  });

  it("recognizes exact Definition references only by their five identity fields", () => {
    const ref = { entityId: "a", entityVersionId: "b", canonicalKey: "c.d", definitionKind: "SPELL_EFFECT", systemFamily: "SPELL" };
    expect(isExactReference(ref)).toBe(true);
    expect(isExactReference({ ...ref, displayName: "Fireball" })).toBe(false);
    expect(isExactReference({ canonicalKey: "c.d", definitionKind: "SPELL_EFFECT" })).toBe(false);
  });

  it("§11 the canonical-key suggestion is explicit and namespaced by kind; it is never applied by itself", () => {
    expect(suggestCanonicalKey("SPELL_EFFECT", "Force Push!")).toBe("spell.effect.force_push");
    expect(suggestCanonicalKey("MANEUVER_CONDITION", "Stationary")).toBe("maneuver.condition.stationary");
    expect(suggestCanonicalKey("SPELL_TARGETING", "   ")).toBe("");
  });
});

describe("authoring client (thin transport, §37–39)", () => {
  const reply = (status: number, body: unknown) => vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));

  it("validates through POST /api/compendium-authoring/validate and returns the server's result untouched", async () => {
    const fetchMock = reply(200, { data: { status: "FAIL", definitionKind: "SPELL_EFFECT", issues: [issue("payload.resolution.mode")], normalized: null, refused: false } });
    vi.stubGlobal("fetch", fetchMock);
    const r = await validateCandidate("SPELL_EFFECT", { definitionKind: "SPELL_EFFECT" });
    expect(r.status).toBe("FAIL");
    expect(fetchMock).toHaveBeenCalledWith("/api/compendium-authoring/validate", expect.objectContaining({ method: "POST", body: JSON.stringify({ definitionKind: "SPELL_EFFECT", prowessDefinition: { definitionKind: "SPELL_EFFECT" } }) }));
  });

  it("surfaces API errors with the server's own code, never a raw Response or stack", async () => {
    vi.stubGlobal("fetch", reply(409, { code: "COMPENDIUM_AUTHORING.STALE_REVISION", message: "Revision 1 changed after it was loaded", field: null, details: null }));
    const error = await saveDraft("v1", { expectedUpdatedAt: "2026-01-01T00:00:00.000Z" }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AuthoringApiError);
    expect(error).toMatchObject({ code: "COMPENDIUM_AUTHORING.STALE_REVISION", status: 409 });
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("offline"))));
    await expect(createDefinition({ definitionKind: "SPELL_EFFECT", canonicalKey: "a.b", displayName: "x", prowessDefinition: {} })).rejects.toMatchObject({ code: "NETWORK_ERROR", status: 0 });
  });

  it("M6-I008 never sends a revision number or status when creating or saving", async () => {
    const fetchMock = reply(200, { data: { version: {}, validation: null } });
    vi.stubGlobal("fetch", fetchMock);
    await saveDraft("v1", { expectedUpdatedAt: "t", displayName: "x" });
    const body = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(["displayName", "expectedUpdatedAt"]);
  });
});

describe("§35 Ruleset selector pagination (owned by M6)", () => {
  it("listAllRulesets follows every page instead of stopping at the first 100", async () => {
    const page = (n: number, totalPages: number) => ({ data: Array.from({ length: n }, (_, i) => ({ id: `${totalPages}-${n}-${i}`, name: `R${i}` })), pagination: { page: 1, pageSize: 100, total: 0, totalPages } });
    const fetchMock = vi.fn(async (url: string) => {
      const p = Number(new URL(url, "http://x").searchParams.get("page"));
      return new Response(JSON.stringify(p < 3 ? page(100, 3) : page(7, 3)), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const all = await listAllRulesets();
    expect(all).toHaveLength(207);
    expect(fetchMock.mock.calls.map((c) => new URL(c[0] as string, "http://x").searchParams.get("page"))).toEqual(["1", "2", "3"]);
  });
});
