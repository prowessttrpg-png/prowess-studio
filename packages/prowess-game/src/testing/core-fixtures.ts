import { createRulesetContext, type RulesetContext } from "@prowess/rules";
import type { ProwessDefinitionBundle } from "../bundle/bundle.js";
import { createProwessDefinitionBundle } from "../bundle/bundle.js";
import { PROWESS_DEFINITION_KINDS, type ProwessDefinitionKind } from "../vocabulary/families.js";
import content from "../content/core-playtest-v0.1/core-resolution.json";
import runtimeContent from "../content/core-playtest-v0.1/runtime-resources.json";
import { uuid } from "./fixtures.js";

/**
 * Test fixtures for the canonical Core Playtest Definitions: the M5-WO2 core Definitions
 * (`src/content/core-playtest-v0.1/core-resolution.json`) and the M5-WO3 runtime Definitions
 * (`src/content/core-playtest-v0.1/runtime-resources.json`) — content files, never TypeScript — pinned under fixed test
 * identities. Not part of the public surface.
 */
export interface CoreContentDefinition {
  readonly canonicalKey: string;
  readonly definitionKind: ProwessDefinitionKind;
  readonly payload: Record<string, unknown>;
}
export const CORE_CONTENT = content as unknown as { readonly definitions: readonly CoreContentDefinition[]; readonly [k: string]: unknown };
export const CORE_DEFINITIONS: readonly CoreContentDefinition[] = CORE_CONTENT.definitions;
export const RUNTIME_CONTENT = runtimeContent as unknown as { readonly definitions: readonly CoreContentDefinition[]; readonly [k: string]: unknown };
export const RUNTIME_DEFINITIONS: readonly CoreContentDefinition[] = RUNTIME_CONTENT.definitions;
/** Every canonical Core Playtest Definition, core first (WO2 identities are unchanged by WO3 additions). */
export const PLAYTEST_DEFINITIONS: readonly CoreContentDefinition[] = [...CORE_DEFINITIONS, ...RUNTIME_DEFINITIONS];

export const CORE_RULESET = uuid(7001);
export const CORE_MANIFEST = uuid(7002);
export const OTHER_RULESET = uuid(7011);
export const OTHER_MANIFEST = uuid(7012);

/** Entity n of the core catalog: entity ids 7100+, version ids 7300+ (offset for revisions). */
const entityOf = (i: number) => uuid(7100 + i);
const versionOf = (i: number, revision: number) => uuid(7300 + i + revision * 100);

export interface CoreFixtureOptions {
  readonly rulesetId?: string;
  readonly manifestId?: string;
  /** Replace a Definition's payload (by canonical key) — content revision under a new EntityVersion. */
  readonly revise?: Readonly<Record<string, Record<string, unknown>>>;
  readonly omit?: readonly string[];
  readonly extra?: readonly CoreContentDefinition[];
}

export function coreCatalog(options: CoreFixtureOptions = {}): CoreContentDefinition[] {
  const defs = PLAYTEST_DEFINITIONS.filter((d) => !(options.omit ?? []).includes(d.canonicalKey)).map((d) => ({
    ...d,
    payload: JSON.parse(JSON.stringify(options.revise?.[d.canonicalKey] ?? d.payload)) as Record<string, unknown>,
  }));
  return [...defs, ...(options.extra ?? [])];
}

export function coreRuleset(options: CoreFixtureOptions = {}): { ruleset: RulesetContext; definitions: Record<string, unknown>[] } {
  const rulesetId = options.rulesetId ?? CORE_RULESET;
  const manifestId = options.manifestId ?? CORE_MANIFEST;
  const catalog = coreCatalog(options);
  const index = (d: CoreContentDefinition) => {
    const i = PLAYTEST_DEFINITIONS.findIndex((x) => x.canonicalKey === d.canonicalKey);
    return i === -1 ? 90 + (options.extra ?? []).indexOf(d) : i;
  };
  const revision = (d: CoreContentDefinition) => (options.revise?.[d.canonicalKey] === undefined ? 0 : 1);
  const ctx = createRulesetContext({
    rulesetId,
    manifestId,
    rules: catalog.map((d) => ({
      entityId: entityOf(index(d)),
      entityVersionId: versionOf(index(d), revision(d)),
      canonicalKey: d.canonicalKey,
      entityType: PROWESS_DEFINITION_KINDS[d.definitionKind].entityTypes[0],
      sourceRulesetId: rulesetId,
      sourceManifestId: manifestId,
    })),
  });
  if (!ctx.ok) throw new Error(JSON.stringify(ctx));
  const ruleset = ctx.value;
  const definitions = catalog.map((d) => ({
    schemaVersion: 1,
    systemFamily: PROWESS_DEFINITION_KINDS[d.definitionKind].family,
    definitionKind: d.definitionKind,
    entityId: entityOf(index(d)),
    entityVersionId: versionOf(index(d), revision(d)),
    canonicalKey: d.canonicalKey,
    payload: d.payload,
    provenance: { rulesetId, manifestId, releaseId: null, sourceRulesetId: rulesetId, sourceManifestId: manifestId, legacyTerms: [] },
  }));
  return { ruleset, definitions };
}

export function coreBundle(options: CoreFixtureOptions = {}): { ruleset: RulesetContext; bundle: ProwessDefinitionBundle } {
  const { ruleset, definitions } = coreRuleset(options);
  const out = createProwessDefinitionBundle({ ruleset, definitions });
  if (!out.ok) throw new Error(JSON.stringify(out.problems, null, 2));
  return { ruleset, bundle: out.value };
}

/** A neutral Level 3 character (d6) — test data only. */
export const characterL3 = () => ({
  level: 3,
  characterDie: { dieKey: "D6" },
  stats: { STR: 4, AGI: 3, CON: 4, PER: 5, RES: 6, PRO: 4 },
  baseHp: 8,
  baseMp: 6,
  skillRanks: [{ skillKey: "skill.athletics", rankKey: "TRAINED" }],
  explicitBonuses: [] as { bonusKey: string; appliesTo: string; value: number }[],
});
