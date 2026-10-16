import { describe, expect, it } from "vitest";
import {
  DEFINITION_ERROR_CODES as C,
  PROWESS_DEFINITION_KINDS,
  PROWESS_DEFINITION_KIND_NAMES,
  createProwessDefinitionEnvelope,
  definitionRefOf,
  type ProwessOutcome,
} from "./index.js";
import { DEFS, envelopeOf, uuid } from "./testing/fixtures.js";

/**
 * M5-WO1 domain test matrix (§204). Invariants: M5-I005 exact EntityVersion identity · M5-I006 schemaVersion ·
 * M5-I028 immutable detached plain data · M5-I029 determinism · M5-I037 Evocation canonical.
 */
const codes = (o: ProwessOutcome<unknown>) => (o.ok ? [] : o.problems.map((p) => p.code));
const valid = envelopeOf("spellRadius");

describe("ProwessDefinitionEnvelope", () => {
  it("accepts a valid envelope and returns a detached, deep-frozen, JSON-stable copy", () => {
    const input = envelopeOf("spellRadius");
    const out = createProwessDefinitionEnvelope(input);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.value.entityVersionId).toBe(uuid(101));
    expect(out.value.definitionKind).toBe("SPELL_TARGETING");
    expect(Object.isFrozen(out.value) && Object.isFrozen(out.value.payload) && Object.isFrozen(out.value.provenance)).toBe(true);
    expect(Object.isFrozen(input)).toBe(false); // caller input is never frozen in place
    expect(JSON.parse(JSON.stringify(out.value))).toEqual(out.value);
    (input.payload as Record<string, unknown>).semanticShape = "CONE"; // later caller mutation does not leak in
    expect((out.value.payload as Record<string, unknown>).semanticShape).toBe("RADIUS");
  });

  it("is deterministic: equal inputs give deep-equal outputs regardless of key order", () => {
    const shuffled = Object.fromEntries(Object.entries(envelopeOf("spellDamage")).reverse());
    expect(createProwessDefinitionEnvelope(shuffled)).toEqual(createProwessDefinitionEnvelope(envelopeOf("spellDamage")));
  });

  it("M5-I005 requires exact Entity, EntityVersion and canonical key — no floating latest version", () => {
    for (const field of ["entityId", "entityVersionId", "canonicalKey"]) {
      const missing = { ...valid } as Record<string, unknown>;
      delete missing[field];
      expect(codes(createProwessDefinitionEnvelope(missing)), field).toContain(C.INVALID_ENVELOPE);
      expect(codes(createProwessDefinitionEnvelope({ ...valid, [field]: "latest" })), field).toContain(C.MISSING_EXACT_IDENTITY);
    }
    expect(codes(createProwessDefinitionEnvelope({ ...valid, entityVersionId: "ABCDEF00-0000-4000-8000-000000000101" }))).toContain(C.MISSING_EXACT_IDENTITY);
  });

  it("M5-I006 schemaVersion is explicit, supported, and independent of EntityVersion", () => {
    expect(codes(createProwessDefinitionEnvelope({ ...valid, schemaVersion: 2 }))).toEqual([C.UNSUPPORTED_SCHEMA_VERSION]);
    expect(codes(createProwessDefinitionEnvelope({ ...valid, schemaVersion: "1" }))).toEqual([C.UNSUPPORTED_SCHEMA_VERSION]);
    expect(codes(createProwessDefinitionEnvelope({ ...valid, schemaVersion: 0 }))).toEqual([C.UNSUPPORTED_SCHEMA_VERSION]);
    const noVersion = { ...valid } as Record<string, unknown>;
    delete noVersion.schemaVersion;
    expect(codes(createProwessDefinitionEnvelope(noVersion))).toContain(C.INVALID_ENVELOPE);
    // Two different EntityVersions of the same Definition share payload schemaVersion 1.
    const later = createProwessDefinitionEnvelope({ ...valid, entityVersionId: uuid(999) });
    expect(later.ok && later.value.schemaVersion).toBe(1);
  });

  it("reserved kinds are known but refuse a guessed payload contract", () => {
    const reserved = PROWESS_DEFINITION_KIND_NAMES.filter((k) => PROWESS_DEFINITION_KINDS[k].schemaVersions.length === 0);
    expect(reserved).toContain("STATUS_CONDITION");
    for (const kind of reserved) {
      const out = createProwessDefinitionEnvelope({ ...valid, definitionKind: kind, systemFamily: PROWESS_DEFINITION_KINDS[kind].family, payload: {} });
      expect(codes(out), kind).toEqual([C.UNSUPPORTED_SCHEMA_VERSION]);
    }
  });

  it("rejects unknown families and kinds, and a family that does not own the kind", () => {
    expect(codes(createProwessDefinitionEnvelope({ ...valid, systemFamily: "MAGIC" }))).toContain(C.UNKNOWN_SYSTEM_FAMILY);
    expect(codes(createProwessDefinitionEnvelope({ ...valid, definitionKind: "SPELL_RADIUS" }))).toContain(C.UNKNOWN_DEFINITION_KIND);
    expect(codes(createProwessDefinitionEnvelope({ ...valid, systemFamily: "MANEUVER" }))).toEqual([C.FAMILY_KIND_MISMATCH]);
  });

  it("rejects a malformed payload and unknown envelope fields; display names are not identity fields", () => {
    expect(codes(createProwessDefinitionEnvelope({ ...valid, payload: { semanticShape: "BLOB" } }))).toContain(C.INVALID_PAYLOAD);
    expect(codes(createProwessDefinitionEnvelope({ ...valid, displayName: "Radius" }))).toContain(C.INVALID_ENVELOPE);
  });

  it("rejects getters, functions, unsafe prototypes, cycles and non-finite numbers without invoking caller code", () => {
    let invoked = false;
    const getter = { ...valid };
    Object.defineProperty(getter, "payload", { enumerable: true, get: () => ((invoked = true), {}) });
    expect(codes(createProwessDefinitionEnvelope(getter))).toEqual([C.NOT_PLAIN_DATA]);
    expect(invoked).toBe(false);

    expect(codes(createProwessDefinitionEnvelope({ ...valid, payload: { ...DEFS.spellRadius.payload, rules: { f: () => 1 } } }))).toContain(C.NOT_PLAIN_DATA);
    expect(codes(createProwessDefinitionEnvelope({ ...valid, payload: { ...DEFS.spellRadius.payload, rules: { x: Infinity } } }))).toContain(C.NOT_PLAIN_DATA);
    expect(codes(createProwessDefinitionEnvelope(JSON.parse(`{"__proto__":{"polluted":true},"schemaVersion":1}`)))).toContain(C.NOT_PLAIN_DATA);
    expect(codes(createProwessDefinitionEnvelope(Object.assign(Object.create({ inherited: 1 }), valid)))).toContain(C.NOT_PLAIN_DATA);
    const cyclic = JSON.parse(JSON.stringify(valid)) as Record<string, Record<string, unknown>>;
    cyclic.payload!.rules = cyclic;
    expect(codes(createProwessDefinitionEnvelope(cyclic))).toContain(C.NOT_PLAIN_DATA);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("definitionRefOf carries exactly the five identity fields", () => {
    const out = createProwessDefinitionEnvelope(valid);
    if (!out.ok) throw new Error("fixture");
    expect(definitionRefOf(out.value)).toEqual({ entityId: uuid(1), entityVersionId: uuid(101), canonicalKey: "spell.targeting.radius", definitionKind: "SPELL_TARGETING", systemFamily: "SPELL" });
  });
});

describe("M5-I037 Evocation is canonical; Emission is legacy provenance only", () => {
  it("accepts EVOCATION and records the legacy source term in provenance", () => {
    const out = createProwessDefinitionEnvelope(envelopeOf("evocation"));
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.value.payload).toEqual({ affinity: "EVOCATION" });
    expect(out.value.provenance.legacyTerms).toEqual([{ legacyTerm: "Emission", canonicalTerm: "Evocation" }]);
  });

  it("rejects Emission as a canonical structured value anywhere in a payload", () => {
    const e = envelopeOf("evocation");
    for (const affinity of ["EMISSION", "Emission", "emission"]) {
      expect(codes(createProwessDefinitionEnvelope({ ...e, payload: { affinity } })), affinity).toContain(C.LEGACY_TERM_AS_CANONICAL);
    }
    const spell = envelopeOf("spellDamage");
    expect(codes(createProwessDefinitionEnvelope({ ...spell, payload: { ...DEFS.spellDamage.payload, keywords: ["keyword.emission"] } }))).toContain(C.LEGACY_TERM_AS_CANONICAL);
    expect(codes(createProwessDefinitionEnvelope({ ...spell, payload: { ...DEFS.spellDamage.payload, rules: { affinity: "Emission" } } }))).toContain(C.LEGACY_TERM_AS_CANONICAL);
  });

  it("only inventoried LEGACY → CANONICAL pairs may be recorded — no arbitrary aliases", () => {
    const e = envelopeOf("evocation") as { provenance: Record<string, unknown> };
    const withTerms = (legacyTerms: unknown) => createProwessDefinitionEnvelope({ ...e, provenance: { ...e.provenance, legacyTerms } });
    expect(codes(withTerms([{ legacyTerm: "Emission", canonicalTerm: "Conjuration" }]))).toEqual([C.INVALID_PROVENANCE]);
    expect(codes(withTerms([{ legacyTerm: "Blast", canonicalTerm: "Evocation" }]))).toEqual([C.INVALID_PROVENANCE]);
  });

  it("rejects malformed provenance", () => {
    const e = envelopeOf("spellRadius") as { provenance: Record<string, unknown> };
    expect(codes(createProwessDefinitionEnvelope({ ...e, provenance: { ...e.provenance, rulesetId: "current" } }))).toEqual([C.INVALID_PROVENANCE]);
    expect(codes(createProwessDefinitionEnvelope({ ...e, provenance: { ...e.provenance, extra: 1 } }))).toEqual([C.INVALID_PROVENANCE]);
  });
});
