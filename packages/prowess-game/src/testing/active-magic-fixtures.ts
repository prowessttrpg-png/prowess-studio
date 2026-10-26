import { transitionActiveMagic, type ActiveMagicState, type ActiveMagicTransition } from "../ability/active-magic.js";
import { ACTIVE_MAGIC_CONTENT } from "../content/core-playtest-v0.1/active-magic.js";
import { copy, setPath } from "./duration-condition-fixtures.js";
import { effectCharacter } from "./effect-fixtures.js";
import { executionFixture, type SpellChainSpec } from "./effect-execution-fixtures.js";

/**
 * M5-WO13 TEST fixtures (not canonical content). Spells over a test copy of the canonical WO7 Reinforce Effect
 * (AUTOMATIC, MODIFY_VALUE) widened to every WO9 Spell Duration and declared Sustain- and Mana-Lock-eligible, with a FIXED
 * listed MP chosen per golden so WO10 produces the Final Spell MP each example needs. The caster is a WO2 CharacterCore
 * (d6) whose PRO equals the construction character's. Canonical policy: no Mana Lock amount (M5-SC-052); tests that
 * exercise a reservation pin an explicit TEST rule (`manaLock`).
 */
export const ALL_DURATIONS = ["INSTANT", "ROUNDS", "COMBAT", "SCENE", "MISSION", "SUSTAINED", "MANA_LOCK"];
const aura = (mp: number) => (e: Record<string, unknown>) => {
  setPath(e, "rules/effect/duration", { allowed: ALL_DURATIONS, default: "ROUNDS", sustainEligible: true, manaLockEligible: true });
  setPath(e, "costContributions", [{ contributionKey: "effect.buff.base", currency: "MP", data: { kind: "FIXED", amount: mp } }]);
};
const ticking = (e: Record<string, unknown>) => {
  aura(6)(e);
  setPath(e, "outcomes", [{ outcomeKey: "SUCCESS", data: { operations: [{ kind: "MODIFY_VALUE", data: { target: "ARMOR", direction: "INCREASE", amountParameter: "amount", timing: "START_OF_TARGET_TURN" } }] } }, { outcomeKey: "FAILURE", data: { operations: [{ kind: "NO_EFFECT", data: {} }] } }]);
};
const dur = (concept: string, params: Record<string, unknown> = {}) => [`spell.duration.${concept.toLowerCase()}`, params] as const;
const one = (suffix: string, concept: string, params: Record<string, unknown> = {}): SpellChainSpec => ({ effects: [["effect1", suffix]], chain: null, duration: dur(concept, params) });

export const WO13_SPELLS: Readonly<Record<string, SpellChainSpec>> = {
  "fixture.wo13.spell.instant": one("aura6", "INSTANT"),
  "fixture.wo13.spell.rounds": one("aura6", "ROUNDS", { rounds: 3 }),
  "fixture.wo13.spell.combat": one("aura6", "COMBAT"),
  "fixture.wo13.spell.scene": one("aura6", "SCENE"),
  "fixture.wo13.spell.mission": one("aura6", "MISSION"),
  "fixture.wo13.spell.sustained": one("aura6", "SUSTAINED"),
  "fixture.wo13.spell.sustained_b": one("aura6", "SUSTAINED"),
  "fixture.wo13.spell.sustained_c": one("aura6", "SUSTAINED"),
  "fixture.wo13.spell.sustained_heavy": one("aura_heavy", "SUSTAINED"),
  "fixture.wo13.spell.sustained_light": one("aura_light", "SUSTAINED"),
  "fixture.wo13.spell.locked": one("aura6", "MANA_LOCK"),
  "fixture.wo13.spell.locked_b": one("aura_heavy", "MANA_LOCK"),
  "fixture.wo13.spell.locked_a": one("aura7", "MANA_LOCK"),
  "fixture.wo13.spell.ticking": one("ticking", "COMBAT"),
  "fixture.wo13.spell.hex_rounds": { effects: [["effect1", "hex"]], chain: null, duration: dur("ROUNDS", { rounds: 2 }) },
  "fixture.wo13.spell.channel": one("aura_heavy", "INSTANT"),
};

export interface ActiveMagicFixtureOptions {
  readonly rulesetId?: string;
  readonly manifestId?: string;
  /** TEST-ONLY Mana Lock amount rule; omitted → the canonical `null` (M5-SC-052, fail closed). */
  readonly manaLock?: Record<string, unknown> | null;
  readonly policy?: Record<string, unknown>;
  /** Listed MP of the heavy / light Effects (Final Spell MP before targeting). */
  readonly heavyMp?: number;
  readonly lightMp?: number;
}

export function activeMagicFixture(options: ActiveMagicFixtureOptions = {}) {
  const rule = copy(ACTIVE_MAGIC_CONTENT.constructionRule.payload) as Record<string, unknown>;
  const policy = { ...(rule.activeMagicPolicy as Record<string, unknown>), ...(options.policy ?? {}) };
  if (options.manaLock !== undefined) policy.manaLock = { ...(policy.manaLock as Record<string, unknown>), amount: options.manaLock };
  rule.activeMagicPolicy = policy;
  const f = executionFixture({
    rulesetId: options.rulesetId, manifestId: options.manifestId, revise: { "construction.ability_rules": rule }, spells: WO13_SPELLS,
    effects: [["aura6", "spell.effect.reinforce", aura(6)], ["aura_heavy", "spell.effect.reinforce", aura(options.heavyMp ?? 15)], ["aura_light", "spell.effect.reinforce", aura(options.lightMp ?? 1)], ["ticking", "spell.effect.reinforce", ticking], ["aura7", "spell.effect.reinforce", aura(7)]],
  });
  /** The authored-Ability request an event carries (the transition supplies definitions / ruleset). */
  const ability = (key: string, pro = 4, execution: Record<string, unknown> | null = { targets: [{ targetKey: "ally" }], inputs: [] }) => {
    const { definitions: _d, ruleset: _r, ...rest } = f.ability(key) as Record<string, unknown>;
    void _d; void _r;
    return { ...rest, character: effectCharacter({ pro }), ...(execution ? { execution } : {}) } as Record<string, unknown>;
  };
  return { ...f, ability };
}

/** A WO2 CharacterCore caster (d6). Defaults: PRO 4, RES 4 (3 Concentration slots). */
export const caster = (stats: Partial<Record<"STR" | "AGI" | "CON" | "PER" | "RES" | "PRO", number>> = {}, baseMp = 30) => ({
  level: 3, characterDie: { dieKey: "D6" }, stats: { STR: 4, AGI: 3, CON: 4, PER: 5, RES: 4, PRO: 4, ...stats }, baseHp: 8, baseMp, skillRanks: [], explicitBonuses: [],
});
export const pool = (entries: Record<string, number>, reservedMp = 0) => ({ resources: Object.entries(entries).map(([resourceKey, current]) => ({ resourceKey, current, ...(resourceKey === "MP" ? { reservedCapacity: reservedMp } : {}) })) });
export const d6 = (natural: number) => ({ die: { dieKey: "D6", faces: 6 }, mode: "NORMAL", rolls: [natural] });

export type Fixture = ReturnType<typeof activeMagicFixture>;
export interface Step { readonly state: ActiveMagicState | null; readonly resources: unknown; readonly caster?: unknown }
/** One transition request over the fixture's exact Ruleset. */
export const request = (f: Fixture, step: Step, event: Record<string, unknown>) => ({ contractVersion: 1, definitions: f.bundle, ruleset: f.ruleset, caster: step.caster ?? caster(), casterKey: "caster.1", resources: step.resources, state: step.state, event });
/** Transition; throws on refusal. */
export function tx(f: Fixture, step: Step, event: Record<string, unknown>): ActiveMagicTransition {
  const out = transitionActiveMagic(request(f, step, event));
  if (!out.ok) throw new Error(`transition failed: ${JSON.stringify(out.problems, null, 2)}`);
  return out.value;
}
/** The transition's refusal codes (empty when it succeeded). */
export function refused(f: Fixture, step: Step, event: Record<string, unknown>): string[] {
  const out = transitionActiveMagic(request(f, step, event));
  return out.ok ? [] : out.problems.map((q) => q.code);
}
export const next = (t: ActiveMagicTransition, c?: unknown): Step => ({ state: t.state, resources: t.resources, ...(c === undefined ? {} : { caster: c }) });
export const cur = (t: { resources: { resources: readonly { resourceKey: string; current: number; reservedCapacity: number }[] } }, key: string) => t.resources.resources.find((x) => x.resourceKey === key)!;
