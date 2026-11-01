import type { ProwessDefinitionRef } from "../definition/envelope.js";
import type { ProwessDefinitionKind } from "../vocabulary/families.js";
import weaponContent from "../content/core-playtest-v0.1/weapons.json";
import { advancementFixture, type AdvancementFixture } from "./advancement-fixtures.js";
import type { FixtureRow } from "./character-fixtures.js";
import { buildCharacterMechanicalProfile, previewCharacterAdvancement, type AdvancementChoices, type CharacterMechanicalProfile, type CommittedAdvancement, type ProfileEquipmentContext } from "../character/advancement.js";
import type { ProwessStat } from "../vocabulary/core.js";

/**
 * Test-only fixtures for PAS-10 M6-WO6: the approved baseline Weapon catalog (the content file
 * `src/content/core-playtest-v0.1/weapons.json` — never TypeScript constants) pinned beside the M6-WO4 advancement
 * fixture. Every `{ "$ref": "<content key>" }` in the content is resolved to the EXACT reference of the revision this
 * fixture pins, exactly as an authoring / import step would. Not part of the public surface.
 */
export interface WeaponContentDefinition {
  readonly canonicalKey: string;
  readonly definitionKind: ProwessDefinitionKind;
  readonly displayName: string;
  readonly payload: Record<string, unknown>;
}
export const WEAPON_CONTENT = weaponContent as unknown as { readonly definitions: readonly WeaponContentDefinition[]; readonly [k: string]: unknown };
export const WEAPON_DEFINITIONS: readonly WeaponContentDefinition[] = WEAPON_CONTENT.definitions;

/** Replaces every `{ "$ref": key }` with the exact reference `ref(key)`. */
export function resolveContentRefs(value: unknown, ref: (key: string) => ProwessDefinitionRef): unknown {
  if (Array.isArray(value)) return value.map((v) => resolveContentRefs(v, ref));
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record);
    if (keys.length === 1 && keys[0] === "$ref" && typeof record.$ref === "string") return ref(record.$ref);
    return Object.fromEntries(keys.map((k) => [k, resolveContentRefs(record[k], ref)]));
  }
  return value;
}

export interface WeaponFixture extends AdvancementFixture {
  readonly content: readonly WeaponContentDefinition[];
}

export interface WeaponFixtureOptions {
  /** Pin a newer revision (new EntityVersion) of these content keys — a "Release 2". */
  readonly revision?: readonly string[];
  /** Replace the payload of a content key (applied before references are resolved). */
  readonly revise?: Readonly<Record<string, (payload: Record<string, unknown>) => Record<string, unknown>>>;
  readonly rulesetId?: string;
  readonly extra?: readonly FixtureRow[];
}

/** The advancement fixture + the whole baseline Weapon catalog, built in dependency order (traits → attacks → weapons). */
export function weaponFixture(options: WeaponFixtureOptions = {}): WeaponFixture {
  const payloadOf = (d: WeaponContentDefinition) => (options.revise?.[d.canonicalKey] ?? ((x: Record<string, unknown>) => x))(JSON.parse(JSON.stringify(d.payload)) as Record<string, unknown>);
  const order: ProwessDefinitionKind[] = ["EQUIPMENT_TRAIT", "ATTACK", "WEAPON"];
  const all = order.flatMap((k) => WEAPON_DEFINITIONS.filter((d) => d.definitionKind === k));
  // Exact references depend only on row order, so each pass pins the rows the next pass refers to.
  let f: AdvancementFixture | null = null;
  for (let pass = 1; pass <= order.length; pass += 1) {
    const kinds = order.slice(0, pass);
    const probe: AdvancementFixture | null = f;
    const ref = (key: string): ProwessDefinitionRef => {
      if (probe === null) throw new Error(`no reference yet for ${key}`);
      return probe.ref(key);
    };
    const rows: FixtureRow[] = all.filter((d) => kinds.includes(d.definitionKind)).map((d) => ({ canonicalKey: d.canonicalKey, definitionKind: d.definitionKind, schemaVersion: 1, payload: resolveContentRefs(payloadOf(d), ref) as Record<string, unknown> }));
    f = advancementFixture({ revision: options.revision, rulesetId: options.rulesetId, extra: [...(options.extra ?? []), ...rows] });
  }
  return { ...(f as AdvancementFixture), content: WEAPON_DEFINITIONS };
}

// ---- Characters --------------------------------------------------------------------------------------------------------

/** The worked Character, but trained in the Release's Martial Skill (in place of Arcana). STR 6. */
export function martialCreation(f: WeaponFixture) {
  const c = f.creation;
  return { ...c, skills: c.skills.map((s, i) => (i === 2 ? { ...s, skill: f.sel("skill.martial") } : s)) };
}

const NO_CHOICES = { statAllocations: {}, skillAdvancements: [], affinityChoice: null } as const;

/**
 * The real profile of a Character at the given Martial rank (UNTRAINED = the worked Character; TRAINED from creation;
 * EXPERT at Level 3 and MASTER at Level 5 through committed advancements). Every value comes from the M6-WO4 builder.
 */
export function martialProfile(f: WeaponFixture, rank: "UNTRAINED" | "TRAINED" | "EXPERT" | "MASTER", equipment: ProfileEquipmentContext | null = null): CharacterMechanicalProfile {
  const creation = rank === "UNTRAINED" ? f.creation : martialCreation(f);
  const upgrades = rank === "EXPERT" ? 1 : rank === "MASTER" ? 2 : 0;
  const steps: AdvancementChoices[] = [
    { ...NO_CHOICES, statAllocations: { PER: 1 } },
    { ...NO_CHOICES, statAllocations: { PRO: 1 }, skillAdvancements: [{ action: "UPGRADE", skill: f.sel("skill.martial") }] },
    { ...NO_CHOICES, statAllocations: { AGI: 1 } },
    { ...NO_CHOICES, statAllocations: { CON: 1 }, skillAdvancements: [{ action: "UPGRADE", skill: f.sel("skill.martial") }] },
  ].slice(0, upgrades === 0 ? 0 : upgrades === 1 ? 2 : 4) as AdvancementChoices[];
  const history: CommittedAdvancement[] = [];
  let level = 1;
  for (const choices of steps) {
    const p = previewCharacterAdvancement({ bundle: f.bundle, ruleset: f.ruleset, character: { creation, level, history }, choices });
    if (p.status !== "READY") throw new Error(JSON.stringify(p.issues));
    history.push(p.record as CommittedAdvancement);
    level = p.toLevel as number;
  }
  const built = buildCharacterMechanicalProfile({ bundle: f.bundle, ruleset: f.ruleset, character: { creation, level, history }, equipment });
  if (built.profile === null) throw new Error(JSON.stringify(built.issues));
  return built.profile;
}

/** A copy of `profile` with some final Stat scores replaced (for Stat-specific damage goldens only). */
export function withStats(profile: CharacterMechanicalProfile, stats: Partial<Record<ProwessStat, number>>): CharacterMechanicalProfile {
  return {
    ...profile,
    stats: profile.stats.map((s) => (stats[s.stat] === undefined ? s : { ...s, final: stats[s.stat] as number })),
    constructionContext: { ...profile.constructionContext, stats: { ...profile.constructionContext.stats, ...stats } },
  };
}
