import { describe, expect, it } from "vitest";
import { createRulesetContext } from "@prowess/rules";
import {
  BUNDLE_ERROR_CODES as B,
  DEFINITION_ERROR_CODES as C,
  PROWESS_DEFINITION_STORAGE_KEY,
  createProwessDefinitionBundle,
  findBundleDefinition,
  readStoredProwessDefinition,
  type ProwessOutcome,
} from "./index.js";
import { ALL_DEFS, DEFS, MANIFEST_B, RULESET_B, envelopeOf, refOf, rulesetOf, uuid } from "./testing/fixtures.js";

/**
 * Exact Definition bundles (§84–87, §130–132, §208). Invariants: M5-I007 Ruleset provenance preserved · M5-I008 only
 * pinned versions · M5-I009 no Ruleset mixing · M5-I010 / M5-I027 no latest / current selection.
 */
const codes = (o: ProwessOutcome<unknown>) => (o.ok ? [] : o.problems.map((p) => p.code));

describe("ProwessDefinitionBundle", () => {
  it("bundles a single Definition with its exact Ruleset provenance", () => {
    const ruleset = rulesetOf(["spellRadius"]);
    const out = createProwessDefinitionBundle({ ruleset, definitions: [envelopeOf("spellRadius", ruleset)] });
    expect(codes(out)).toEqual([]);
    if (!out.ok) return;
    expect(out.value.rulesetProvenance).toEqual({ rulesetId: ruleset.rulesetId, manifestId: ruleset.manifestId, manifestHash: null, rulesetVersionLabel: null, release: null });
    expect(out.value.definitions[0]?.provenance.sourceManifestId).toBe(ruleset.manifestId);
    expect(Object.isFrozen(out.value.definitions)).toBe(true);
    expect(JSON.parse(JSON.stringify(out.value))).toEqual(out.value);
  });

  it("orders multiple Definitions deterministically by Entity id, whatever the input order", () => {
    const ruleset = rulesetOf(ALL_DEFS);
    const forward = createProwessDefinitionBundle({ ruleset, definitions: ALL_DEFS.map((n) => envelopeOf(n, ruleset)) });
    const backward = createProwessDefinitionBundle({ ruleset, definitions: [...ALL_DEFS].reverse().map((n) => envelopeOf(n, ruleset)) });
    expect(forward).toEqual(backward);
    expect(forward.ok && forward.value.definitions.map((d) => d.entityId)).toEqual([...ALL_DEFS.map((n) => uuid(DEFS[n].n))].sort());
  });

  it("a bundle may hold a subset of the pinned rules (generic rule content is not a Definition)", () => {
    const ruleset = rulesetOf(["spellRadius", "spellDamage"]);
    expect(codes(createProwessDefinitionBundle({ ruleset, definitions: [envelopeOf("spellDamage", ruleset)] }))).toEqual([]);
  });

  it("rejects a duplicate exact version", () => {
    const ruleset = rulesetOf(["spellRadius"]);
    expect(codes(createProwessDefinitionBundle({ ruleset, definitions: [envelopeOf("spellRadius", ruleset), envelopeOf("spellRadius", ruleset)] }))).toEqual([B.DUPLICATE_DEFINITION]);
  });

  it("§132 injection: a version the RulesetContext does not pin is rejected", () => {
    const ruleset = rulesetOf(["spellRadius"]);
    const injectedVersion = { ...envelopeOf("spellRadius", ruleset), entityVersionId: uuid(5555) };
    expect(codes(createProwessDefinitionBundle({ ruleset, definitions: [injectedVersion] }))).toEqual([B.NOT_PINNED]);
    expect(codes(createProwessDefinitionBundle({ ruleset, definitions: [envelopeOf("spellDamage", ruleset)] }))).toEqual([B.NOT_PINNED]);
  });

  it("rejects a conflicting canonical identity or a storage EntityType the kind may not use", () => {
    const ruleset = rulesetOf(["spellRadius"]);
    expect(codes(createProwessDefinitionBundle({ ruleset, definitions: [{ ...envelopeOf("spellRadius", ruleset), canonicalKey: "spell.targeting.circle" }] }))).toEqual([B.CANONICAL_CONFLICT]);
    const asGeneric = createRulesetContext({ ...ruleset, rules: ruleset.rules.map((r) => ({ ...r, entityType: "GENERIC_RULE" })) });
    if (!asGeneric.ok) throw new Error("fixture");
    expect(codes(createProwessDefinitionBundle({ ruleset: asGeneric.value, definitions: [envelopeOf("spellRadius", asGeneric.value)] }))).toEqual([C.ENTITY_TYPE_MISMATCH]);
  });

  it("§131 / §227 never mixes Rulesets: an R1 Effect with an R2-materialized Trait is rejected", () => {
    const r1 = rulesetOf(["spellDamage", "spellFire"]);
    const r2 = rulesetOf(["spellDamage", "spellFire"], { rulesetId: RULESET_B, manifestId: MANIFEST_B, versionOffset: 1000 });
    const mixed = createProwessDefinitionBundle({ ruleset: r1, definitions: [envelopeOf("spellDamage", r1), envelopeOf("spellFire", r2)] });
    expect(codes(mixed)).toEqual([B.NOT_PINNED]); // R2's Trait version is not pinned by R1
    // Same version, different Ruleset provenance — still mixing.
    const sameVersionOtherRuleset = { ...envelopeOf("spellFire", r1), provenance: { ...(envelopeOf("spellFire", r1).provenance as object), rulesetId: RULESET_B } };
    expect(codes(createProwessDefinitionBundle({ ruleset: r1, definitions: [sameVersionOtherRuleset] }))).toEqual([B.RULESET_MISMATCH]);
    const wrongPinSource = { ...envelopeOf("spellFire", r1), provenance: { ...(envelopeOf("spellFire", r1).provenance as object), sourceManifestId: MANIFEST_B } };
    expect(codes(createProwessDefinitionBundle({ ruleset: r1, definitions: [wrongPinSource] }))).toEqual([B.RULESET_MISMATCH]);
  });

  it("§131 isolation: two Rulesets with different versions of one semantic Definition give isolated bundles", () => {
    const r1 = rulesetOf(["spellDamage"]);
    const r2 = rulesetOf(["spellDamage"], { rulesetId: RULESET_B, manifestId: MANIFEST_B, versionOffset: 1000 });
    const b1 = createProwessDefinitionBundle({ ruleset: r1, definitions: [envelopeOf("spellDamage", r1)] });
    const b2 = createProwessDefinitionBundle({ ruleset: r2, definitions: [envelopeOf("spellDamage", r2)] });
    if (!b1.ok || !b2.ok) throw new Error("fixture");
    expect(b1.value.definitions[0]?.entityVersionId).toBe(uuid(103));
    expect(b2.value.definitions[0]?.entityVersionId).toBe(uuid(1103));
    expect(findBundleDefinition(b1.value, refOf("spellDamage", 1000))).toBeNull(); // R2's version is absent from R1 — no fallback
    expect(findBundleDefinition(b2.value, refOf("spellDamage"))).toBeNull();
    expect(findBundleDefinition(b1.value, refOf("spellDamage"))?.entityVersionId).toBe(uuid(103));
  });

  it("rejects an invalid RulesetContext and unsafe input", () => {
    expect(codes(createProwessDefinitionBundle({ ruleset: { rulesetId: "latest" }, definitions: [] }))).toEqual([B.INVALID_RULESET]);
    expect(codes(createProwessDefinitionBundle({ ruleset: rulesetOf([]), definitions: [() => 1] }))).toEqual([C.NOT_PLAIN_DATA]);
  });
});

describe("stored Definitions inside the existing EntityVersion model (§232 — no schema change)", () => {
  const ruleset = rulesetOf(["spellRadius", "evocation"]);
  const rule = ruleset.rules.find((r) => r.canonicalKey === "spell.targeting.radius")!;
  const stored = { schemaVersion: 1, systemFamily: "SPELL", definitionKind: "SPELL_TARGETING", payload: DEFS.spellRadius.payload };

  it("reads identity from the exact pinned rule, never from the stored JSON", () => {
    const out = readStoredProwessDefinition({ ruleset, rule, structuredData: { [PROWESS_DEFINITION_STORAGE_KEY]: stored, unrelated: 1 } });
    expect(out.ok && out.value.kind).toBe("DEFINITION");
    if (!out.ok || out.value.kind !== "DEFINITION") return;
    expect(out.value.envelope.entityVersionId).toBe(rule.entityVersionId);
    expect(out.value.envelope.provenance).toMatchObject({ rulesetId: ruleset.rulesetId, manifestId: ruleset.manifestId, sourceManifestId: rule.sourceManifestId });
    const claimsIdentity = readStoredProwessDefinition({ ruleset, rule, structuredData: { [PROWESS_DEFINITION_STORAGE_KEY]: { ...stored, entityVersionId: uuid(4444) } } });
    expect(codes(claimsIdentity)).toEqual([C.INVALID_STORED_DEFINITION]);
  });

  it("generic content without the key is not a Definition; a mismatched storage EntityType is rejected", () => {
    expect(readStoredProwessDefinition({ ruleset, rule, structuredData: {} })).toEqual({ ok: true, value: { kind: "NOT_A_DEFINITION" } });
    const affinityRule = ruleset.rules.find((r) => r.canonicalKey === "affinity.evocation")!;
    expect(codes(readStoredProwessDefinition({ ruleset, rule: affinityRule, structuredData: { [PROWESS_DEFINITION_STORAGE_KEY]: stored } }))).toEqual([C.ENTITY_TYPE_MISMATCH]);
  });
});
