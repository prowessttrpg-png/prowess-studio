import { describe, expect, it } from "vitest";
import type { EntityType } from "@prowess/model";
import {
  DEFINITION_ERROR_CODES as C,
  PROWESS_DEFINITION_KINDS,
  PROWESS_DEFINITION_STORAGE_KEY,
  readStoredProwessDefinition,
  validateStoredProwessDefinition,
  type ProwessDefinitionEnvelope,
  type ProwessOutcome,
} from "./index.js";
import { abilityDefinitionFixture } from "./testing/ability-definition-fixtures.js";

/**
 * PAS-10 M6-WO1 §14 / §41 / §69 / §81 — `validateStoredProwessDefinition`, the approved smallest public-surface addition
 * that lets Compendium authoring validate an UNSAVED Definition without fabricating identity.
 *
 * The central claim is PARITY: it is the same validator the materializer runs (`readStoredProwessDefinition`), minus
 * identity and Ruleset provenance (M6-I003). Every real fixture Definition (every executable kind the M5 fixtures author) is
 * accepted with an identical normalized payload, and every malformed variant is refused with the same problem codes.
 */
const fixture = abilityDefinitionFixture();
const codes = (o: ProwessOutcome<unknown>) => (o.ok ? [] : o.problems.map((p) => p.code));
const entityTypeOf = (d: ProwessDefinitionEnvelope) => PROWESS_DEFINITION_KINDS[d.definitionKind].entityTypes[0] as EntityType;
const storedOf = (d: ProwessDefinitionEnvelope, extra: Record<string, unknown> = {}) => ({
  [PROWESS_DEFINITION_STORAGE_KEY]: {
    schemaVersion: d.schemaVersion,
    systemFamily: d.systemFamily,
    definitionKind: d.definitionKind,
    payload: JSON.parse(JSON.stringify(d.payload)) as unknown,
    ...(d.provenance.legacyTerms.length > 0 ? { legacyTerms: d.provenance.legacyTerms } : {}),
    ...extra,
  },
});
const byKey = (key: string) => fixture.bundle.definitions.find((d) => d.canonicalKey === key)!;
const ruleOf = (d: ProwessDefinitionEnvelope) => fixture.ruleset.rules.find((r) => r.entityVersionId === d.entityVersionId)!;
const materializerCodes = (d: ProwessDefinitionEnvelope, structuredData: unknown, entityType = entityTypeOf(d)) =>
  codes(readStoredProwessDefinition({ ruleset: fixture.ruleset, rule: { ...ruleOf(d), entityType }, structuredData }));

describe("validateStoredProwessDefinition (M6-WO1 §81 approved M5 public surface)", () => {
  it("covers a meaningful spread of real fixture Definitions across kinds", () => {
    const kinds = new Set(fixture.bundle.definitions.map((d) => d.definitionKind));
    expect(fixture.bundle.definitions.length).toBeGreaterThan(20);
    for (const kind of ["SPELL_TARGETING", "SPELL_EFFECT", "SPELL_TRAIT", "SPELL_DURATION", "MANEUVER_EFFECT", "SPELL_DEFINITION", "MANEUVER_DEFINITION"]) expect(kinds, kind).toContain(kind);
  });

  it("PARITY (accept): every fixture Definition validates to exactly the payload the materializer reads", () => {
    for (const d of fixture.bundle.definitions) {
      const out = validateStoredProwessDefinition({ entityType: entityTypeOf(d), structuredData: storedOf(d) });
      expect(out.ok, `${d.canonicalKey}: ${JSON.stringify(out.ok ? null : out.problems)}`).toBe(true);
      if (!out.ok || out.value.kind !== "DEFINITION") throw new Error(d.canonicalKey);
      expect(out.value.definition).toEqual({ schemaVersion: d.schemaVersion, systemFamily: d.systemFamily, definitionKind: d.definitionKind, payload: d.payload, legacyTerms: d.provenance.legacyTerms });
      const read = readStoredProwessDefinition({ ruleset: fixture.ruleset, rule: ruleOf(d), structuredData: storedOf(d) });
      expect(read.ok && read.value.kind === "DEFINITION" ? read.value.envelope.payload : null, d.canonicalKey).toEqual(out.value.definition.payload);
    }
  });

  it("never assigns identity or Ruleset provenance: the result has no id, key or Ruleset field", () => {
    const d = byKey("spell.effect.direct_damage");
    const out = validateStoredProwessDefinition({ entityType: entityTypeOf(d), structuredData: storedOf(d) });
    expect(out.ok && out.value.kind === "DEFINITION" ? Object.keys(out.value.definition).sort() : []).toEqual(["definitionKind", "legacyTerms", "payload", "schemaVersion", "systemFamily"]);
    expect(JSON.stringify(out)).not.toMatch(/entityVersionId|entityId|rulesetId|manifestId|canonicalKey/);
  });

  it("generic content (no prowessDefinition key) is NOT_A_DEFINITION, never guessed", () => {
    for (const structuredData of [{}, { summary: "Fireball deals fire damage" }, null, "text"]) {
      expect(validateStoredProwessDefinition({ entityType: "GENERIC_RULE", structuredData })).toEqual({ ok: true, value: { kind: "NOT_A_DEFINITION" } });
    }
  });

  const d = byKey("spell.effect.direct_damage");
  const mutate = (fn: (payload: Record<string, unknown>) => void, extra: Record<string, unknown> = {}) => {
    const s = storedOf(d, extra) as { prowessDefinition: { payload: Record<string, unknown> } };
    fn(s.prowessDefinition.payload);
    return s;
  };
  const NEGATIVES: ReadonlyArray<[string, unknown, string, EntityType?]> = [
    ["unknown Definition kind", storedOf(d, { definitionKind: "SPELL_FIREBALL" }), C.UNKNOWN_DEFINITION_KIND],
    ["family / kind mismatch (cross-branch)", storedOf(d, { systemFamily: "MANEUVER" }), C.FAMILY_KIND_MISMATCH],
    ["unsupported schema version", storedOf(d, { schemaVersion: 9 }), C.UNSUPPORTED_SCHEMA_VERSION],
    ["reserved kind", storedOf(d, { definitionKind: "WEAPON", systemFamily: "EQUIPMENT", schemaVersion: 1 }), C.UNSUPPORTED_SCHEMA_VERSION, "GENERIC_RULE"],
    ["incompatible EntityType", storedOf(d), C.ENTITY_TYPE_MISMATCH, "SPELL_TRAIT"],
    ["stored blob claiming identity", storedOf(d, { entityVersionId: "00000000-0000-4000-8000-000000000001" }), C.INVALID_STORED_DEFINITION],
    ["malformed payload — unsupported resolution mode", mutate((p) => { p.resolution = { mode: "TELEPATHY", data: {} }; }), C.INVALID_PAYLOAD],
    ["malformed payload — unknown field", mutate((p) => { p.damageDice = "2d6"; }), C.INVALID_PAYLOAD],
    ["legacy term as canonical content", mutate((p) => { p.keywords = ["affinity.emission"]; }), C.LEGACY_TERM_AS_CANONICAL],
  ];

  it.each(NEGATIVES)("refuses %s — with the same codes the materializer reports", (_name, structuredData, code, entityType) => {
    const type = entityType ?? entityTypeOf(d);
    const out = validateStoredProwessDefinition({ entityType: type, structuredData });
    expect(codes(out)).toContain(code);
    expect(codes(out)).toEqual(materializerCodes(d, structuredData, type));
  });

  it("Targeting may never carry Effect / outcome / Save fields (M5-I022 through the same reader)", () => {
    const t = byKey("spell.targeting.single_target");
    const s = storedOf(t) as { prowessDefinition: { payload: Record<string, unknown> } };
    s.prowessDefinition.payload.geometry = { ...(s.prowessDefinition.payload.geometry as object), damage: { dice: 2 } };
    expect(codes(validateStoredProwessDefinition({ entityType: entityTypeOf(t), structuredData: s }))).toContain(C.TARGETING_IMPLIES_OUTCOME);
  });

  it("§69 untrusted input: functions, accessors, prototype keys, cycles and non-finite numbers are refused before reading", () => {
    const withGetter = storedOf(d) as { prowessDefinition: Record<string, unknown> };
    Object.defineProperty(withGetter.prowessDefinition, "payload", { get: () => ({}), enumerable: true });
    const cyclic = storedOf(d) as { prowessDefinition: { payload: Record<string, unknown> } };
    cyclic.prowessDefinition.payload.rules = cyclic.prowessDefinition.payload;
    const proto = JSON.parse(`{"prowessDefinition":{"schemaVersion":1,"systemFamily":"SPELL","definitionKind":"SPELL_EFFECT","payload":{"__proto__":{"x":1}}}}`) as unknown;
    for (const structuredData of [
      withGetter,
      cyclic,
      proto,
      mutate((p) => { p.parameters = { dice: Number.NaN }; }),
      mutate((p) => { p.parameters = { dice: Infinity }; }),
      mutate((p) => { p.rules = { run: () => 1 } as unknown as Record<string, unknown>; }),
    ]) {
      const out = validateStoredProwessDefinition({ entityType: "SPELL_EFFECT", structuredData });
      expect(out.ok).toBe(false);
      expect(codes(out)).toContain(C.NOT_PLAIN_DATA);
    }
  });

  it("is deterministic, never mutates or freezes its input, and returns a detached deep-frozen copy", () => {
    const input = storedOf(d);
    const before = JSON.stringify(input);
    const a = validateStoredProwessDefinition({ entityType: "SPELL_EFFECT", structuredData: input });
    const b = validateStoredProwessDefinition({ entityType: "SPELL_EFFECT", structuredData: storedOf(d) });
    expect(a).toEqual(b);
    expect(JSON.stringify(input)).toBe(before);
    expect(Object.isFrozen(input.prowessDefinition)).toBe(false);
    if (!a.ok || a.value.kind !== "DEFINITION") throw new Error("expected a Definition");
    expect(Object.isFrozen(a.value.definition.payload)).toBe(true);
    (input.prowessDefinition.payload as Record<string, unknown>).effectFamily = "HEALING";
    expect(a.value.definition.payload.effectFamily).toBe(d.payload.effectFamily);
  });
});
