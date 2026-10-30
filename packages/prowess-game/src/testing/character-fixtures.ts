import { createRulesetContext, type RulesetContext } from "@prowess/rules";
import { createProwessDefinitionBundle, type ProwessDefinitionBundle } from "../bundle/bundle.js";
import type { ProwessDefinitionRef } from "../definition/envelope.js";
import { PROWESS_DEFINITION_KINDS, type ProwessDefinitionKind } from "../vocabulary/families.js";
import affinityContent from "../content/core-playtest-v0.1/affinity.json";
import { PLAYTEST_DEFINITIONS } from "./core-fixtures.js";
import { uuid } from "./fixtures.js";

/**
 * Test-only fixtures for PAS-10 M6-WO3 Character creation (never game canon, never public surface). A Release-like
 * bundle with the canonical core / runtime content (Stats, Character Die, Skill ranks, Derived Stats, Creature Sizes),
 * the canonical executable Affinities, and TEST-ONLY character content under `test.m6wo3.*` keys: one Character
 * Creation Rule (budget 15, two free Skills, TRAINED), Skills and an "Orcani" test Ancestry (Base HP 10 / MP 4, +2 STR,
 * +1 to two different Stats, choose Athletics or Survival).
 */
export interface FixtureRow {
  readonly canonicalKey: string;
  readonly definitionKind: ProwessDefinitionKind;
  readonly schemaVersion: number;
  readonly payload: Record<string, unknown>;
}

const SOURCE = { locators: ["s20"], conflicts: [] };
export const TEST_SKILL_KEYS = ["test.m6wo3.skill.athletics", "test.m6wo3.skill.survival", "test.m6wo3.skill.stealth", "test.m6wo3.skill.arcana", "test.m6wo3.skill.perception"] as const;
export const TEST_RULE_KEY = "test.m6wo3.character_creation_rule";
export const TEST_ANCESTRY_KEY = "test.m6wo3.ancestry.orcani";

export const creationRulePayload = (over: Record<string, unknown> = {}) => ({
  startingLevel: 1,
  statPointBudget: 15,
  freeTrainedSkillCount: 2,
  startingSkillRankKey: "TRAINED",
  requiredAncestryCount: 1,
  requiredPrimaryAffinityCount: 1,
  source: SOURCE,
  ...over,
});
export const skillPayload = () => ({ ladderKey: "SKILL", source: SOURCE });
export const ancestryPayload = (ref: (key: string) => ProwessDefinitionRef, over: Record<string, unknown> = {}) => ({
  baseHp: 10,
  baseMp: 4,
  statGrants: [
    { grantKey: "orcani_strength", kind: "FIXED", stat: "STR", amount: 2 },
    { grantKey: "orcani_versatility", kind: "CHOOSE_DISTINCT", count: 2, amount: 1, allowedStats: ["AGI", "CON", "PER", "RES", "PRO"] },
  ],
  skillGrants: [{ grantKey: "orcani_upbringing", rankKey: "TRAINED", selectionKind: "CHOOSE_FROM", count: 1, options: [ref("test.m6wo3.skill.athletics"), ref("test.m6wo3.skill.survival")] }],
  source: SOURCE,
  ...over,
});

const AFFINITY_ROWS = (affinityContent as unknown as { definitions: FixtureRow[] }).definitions;

export interface CharacterFixture {
  readonly ruleset: RulesetContext;
  readonly bundle: ProwessDefinitionBundle;
  readonly ref: (key: string) => ProwessDefinitionRef;
  readonly sel: (key: string) => { entityId: string; entityVersionId: string };
}

/**
 * Builds the bundle. `revision` bumps the EntityVersion ids of the named keys (a newer revision pinned instead);
 * `ancestry` / `rule` override the test payloads; `omit` drops rows.
 */
export function characterFixture(options: { readonly revision?: readonly string[]; readonly ancestry?: Record<string, unknown>; readonly rule?: Record<string, unknown>; readonly omit?: readonly string[]; readonly extra?: readonly FixtureRow[]; readonly rulesetId?: string } = {}): CharacterFixture {
  const base: { canonicalKey: string; definitionKind: ProwessDefinitionKind; schemaVersion: number; payload: Record<string, unknown> | null }[] = [
    ...PLAYTEST_DEFINITIONS.map((d) => ({ canonicalKey: d.canonicalKey, definitionKind: d.definitionKind, schemaVersion: 1, payload: d.payload })),
    ...AFFINITY_ROWS.map((d) => ({ canonicalKey: d.canonicalKey, definitionKind: d.definitionKind, schemaVersion: d.schemaVersion, payload: d.payload })),
    { canonicalKey: TEST_RULE_KEY, definitionKind: "CHARACTER_CREATION_RULE", schemaVersion: 1, payload: creationRulePayload(options.rule) },
    ...TEST_SKILL_KEYS.map((k) => ({ canonicalKey: k, definitionKind: "SKILL" as ProwessDefinitionKind, schemaVersion: 1, payload: skillPayload() })),
    { canonicalKey: TEST_ANCESTRY_KEY, definitionKind: "ANCESTRY", schemaVersion: 1, payload: null },
    ...(options.extra ?? []),
  ];
  const rows = base.filter((r) => !(options.omit ?? []).includes(r.canonicalKey));
  const rulesetId = options.rulesetId ?? uuid(8001);
  const manifestId = uuid(8002);
  const index = (key: string) => base.findIndex((r) => r.canonicalKey === key);
  const entityId = (key: string) => uuid(8100 + index(key));
  const versionId = (key: string) => uuid(8400 + index(key) + ((options.revision ?? []).includes(key) ? 300 : 0));
  const ref = (key: string): ProwessDefinitionRef => {
    const row = base[index(key)]!;
    return { entityId: entityId(key), entityVersionId: versionId(key), canonicalKey: key, definitionKind: row.definitionKind, systemFamily: PROWESS_DEFINITION_KINDS[row.definitionKind].family } as ProwessDefinitionRef;
  };
  const ctx = createRulesetContext({
    rulesetId,
    manifestId,
    rules: rows.map((r) => ({ entityId: entityId(r.canonicalKey), entityVersionId: versionId(r.canonicalKey), canonicalKey: r.canonicalKey, entityType: PROWESS_DEFINITION_KINDS[r.definitionKind].entityTypes[0], sourceRulesetId: rulesetId, sourceManifestId: manifestId })),
  });
  if (!ctx.ok) throw new Error(JSON.stringify(ctx));
  const definitions = rows.map((r) => ({
    schemaVersion: r.schemaVersion,
    systemFamily: PROWESS_DEFINITION_KINDS[r.definitionKind].family,
    definitionKind: r.definitionKind,
    entityId: entityId(r.canonicalKey),
    entityVersionId: versionId(r.canonicalKey),
    canonicalKey: r.canonicalKey,
    payload: r.payload ?? ancestryPayload(ref, options.ancestry),
    provenance: { rulesetId, manifestId, releaseId: null, sourceRulesetId: rulesetId, sourceManifestId: manifestId, legacyTerms: [] },
  }));
  const out = createProwessDefinitionBundle({ ruleset: ctx.value, definitions });
  if (!out.ok) throw new Error(JSON.stringify(out.problems, null, 2));
  return { ruleset: ctx.value, bundle: out.value, ref, sel: (key) => ({ entityId: entityId(key), entityVersionId: versionId(key) }) };
}

/** The worked example: Orcani, +1 AGI / +1 PRO, 15 points, Athletics (Ancestry) + Stealth and Arcana (free), Evocation. */
export function workedCandidate(f: CharacterFixture) {
  return {
    ancestry: f.sel(TEST_ANCESTRY_KEY),
    ancestryStatChoices: [
      { grantKey: "orcani_versatility", stat: "AGI" },
      { grantKey: "orcani_versatility", stat: "PRO" },
    ],
    statAllocations: { STR: 3, AGI: 3, CON: 3, PER: 2, RES: 2, PRO: 2 },
    skills: [
      { skill: f.sel("test.m6wo3.skill.athletics"), sourceKind: "ANCESTRY", sourceGrantKey: "orcani_upbringing" },
      { skill: f.sel("test.m6wo3.skill.stealth"), sourceKind: "FREE", sourceGrantKey: null },
      { skill: f.sel("test.m6wo3.skill.arcana"), sourceKind: "FREE", sourceGrantKey: null },
    ],
    primaryAffinity: f.sel("affinity.evocation"),
  };
}
