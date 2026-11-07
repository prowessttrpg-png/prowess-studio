import type { ActiveMagicAbilityAdapter, CharacterSpellIdentity } from "../ability/active-magic.js";
import { executeCompiledResolution, type AbilityExecutionResult, type Compiled, type ExecutionInputRequest } from "../ability/effect-execution.js";
import type { SpellCostResult } from "../ability/spell-cost.js";
import type { ProwessDefinitionBundle } from "../bundle/bundle.js";
import type { CharacterMechanicalProfile } from "../character/advancement.js";
import { evaluateCharacterSignatureManeuver, type CharacterManeuverSubject, type SignatureManeuverDraft, type SignatureManeuverEvaluation } from "../character/signature-maneuver.js";
import { evaluateCharacterSignatureSpell, type CharacterSpellSubject, type SignatureSpellDraft, type SignatureSpellEvaluation } from "../character/signature-spell.js";
import { resolveCharacterDie } from "../core/character.js";
import { indexCoreDefinitions } from "../core/definitions.js";
import type { CharacterAttackLibrary } from "../equipment/library.js";
import { clonePlainData, deepFreeze, isPlainObject } from "../internal/plain-data.js";
import { finish, own, Problems, type ProwessOutcome } from "../internal/problems.js";
import type { PlayResolutionInput, PlayTargetInput } from "./contract.js";
import { PROWESS_STATS } from "../vocabulary/core.js";

/**
 * PAS-10 M6-WO10 — Character Signature Ability execution adapters. A Character's Spell / Maneuver is executed from ITS
 * exact stored revision: the M6-WO7 / WO8 evaluator compiles and prices it (M5-WO10 / WO11 on M4) and hands over the SAME
 * compiled M5-WO12 plan, which `executeCompiledResolution` executes with explicit runtime inputs. Inputs are built here
 * from player / GM raw values: the roller is the Character's own CharacterCore (attacker) or the GM-described defender,
 * the die is always the roller's Character Die, the outcome is always M4's. Nothing is applied to any target.
 */

export interface PlayAbilitySource<D> {
  readonly abilityId: string;
  readonly name: string;
  readonly status: "ACTIVE" | "RETIRED" | "DRAFT";
  /** The revision the Character uses now (ACTIVE) or its last revision (RETIRED); null when never finalized. */
  readonly revisionNumber: number | null;
  readonly revisionReleaseId: string | null;
  readonly draft: D | null;
  /** Other ACTIVE Signature Abilities (the slot state the evaluator needs). */
  readonly usedSlots: number;
}

export interface PlayAbilityContext {
  readonly characterId: string;
  readonly releaseId: string;
  readonly bundle: ProwessDefinitionBundle;
  readonly ruleset: unknown;
  /** The Character's own profile (Signature Spells are evaluated against it, as the Spell Builder does). */
  readonly profile: CharacterMechanicalProfile;
  /** The profile with the equipped Weapons' context (Maneuvers, Attacks, the sheet maximums). */
  readonly equippedProfile: CharacterMechanicalProfile;
  readonly maneuverAttackLibrary: CharacterAttackLibrary;
  readonly keywords: unknown;
  readonly spells: readonly PlayAbilitySource<SignatureSpellDraft>[];
  readonly maneuvers: readonly PlayAbilitySource<SignatureManeuverDraft>[];
  /** The Character's CharacterCore (attacker / caster rolls) and its Character Die. */
  readonly casterCore: unknown;
  readonly characterDie: { readonly dieKey: string; readonly faces: number };
  /** The Character's derived Character DC (default Difficulty Class of Saves against its Abilities), when defined. */
  readonly characterDc: number | null;
  /**
   * The request-scoped evaluation cache (createPlayEvaluationCache). One context = one cache: a context derived with
   * different inputs must be given its own cache. Never module state.
   */
  readonly evaluations: PlayEvaluationCache;
}

/** Opaque request-scoped cache of Signature Ability evaluations, keyed by the exact source object. */
export type PlayEvaluationCache = Map<unknown, unknown>;
export const createPlayEvaluationCache = (): PlayEvaluationCache => new Map<unknown, unknown>();

/** A stable WO3 source label for a Character Signature Ability revision (never a canonical Definition key). */
export const signatureSourceKey = (kind: "spell" | "maneuver", abilityId: string, revisionNumber: number) => `character.signature_${kind}.${abilityId.replace(/-/g, "_").toLowerCase()}.r${String(revisionNumber)}`;

export const spellIdentityOf = (characterId: string, abilityId: string, revisionNumber: number): CharacterSpellIdentity =>
  deepFreeze({ kind: "CHARACTER_SIGNATURE_SPELL", characterId, signatureAbilityId: abilityId, revisionNumber, canonicalKey: signatureSourceKey("spell", abilityId, revisionNumber) });

export interface EvaluatedSpell {
  readonly evaluation: SignatureSpellEvaluation;
  readonly compiled: Compiled<CharacterSpellSubject> | null;
}
export interface EvaluatedManeuver {
  readonly evaluation: SignatureManeuverEvaluation;
  readonly compiled: Compiled<CharacterManeuverSubject> | null;
}

/**
 * One evaluation per (context, source) — the context and its sources are immutable for the life of one request, so a cast
 * (cost, resolution, activation) and the workspace read reuse the SAME evaluation instead of re-running it.
 */
function once<T>(ctx: PlayAbilityContext, key: unknown, run: () => T): T {
  const m = ctx.evaluations;
  if (!m.has(key)) m.set(key, run());
  return m.get(key) as T;
}

/** The M6-WO7 evaluation of the exact revision + the compiled WO12 plan it produced (null when not executable). */
export function evaluateSpellSource(ctx: PlayAbilityContext, source: PlayAbilitySource<SignatureSpellDraft>): EvaluatedSpell | null {
  return once(ctx, source, () => evaluateSpellOnce(ctx, source));
}
function evaluateSpellOnce(ctx: PlayAbilityContext, source: PlayAbilitySource<SignatureSpellDraft>): EvaluatedSpell | null {
  if (source.draft === null || source.revisionNumber === null) return null;
  let compiled: Compiled<CharacterSpellSubject> | null = null;
  const evaluation = evaluateCharacterSignatureSpell(
    { bundle: ctx.bundle, ruleset: ctx.ruleset, profile: ctx.profile, keywords: ctx.keywords, draft: source.draft, usedSlots: source.usedSlots, subject: { kind: "CHARACTER_SIGNATURE_SPELL", characterId: ctx.characterId, signatureAbilityId: source.abilityId, revisionNumber: source.revisionNumber } },
    (plan) => {
      compiled = plan;
    },
  );
  return { evaluation, compiled };
}

/** The M6-WO8 evaluation of the exact revision (equipped profile and Attack Library) + its compiled WO12 plan. */
export function evaluateManeuverSource(ctx: PlayAbilityContext, source: PlayAbilitySource<SignatureManeuverDraft>): EvaluatedManeuver | null {
  return once(ctx, source, () => evaluateManeuverOnce(ctx, source));
}
function evaluateManeuverOnce(ctx: PlayAbilityContext, source: PlayAbilitySource<SignatureManeuverDraft>): EvaluatedManeuver | null {
  if (source.draft === null || source.revisionNumber === null) return null;
  let compiled: Compiled<CharacterManeuverSubject> | null = null;
  const evaluation = evaluateCharacterSignatureManeuver(
    { bundle: ctx.bundle, ruleset: ctx.ruleset, profile: ctx.equippedProfile, attackLibrary: ctx.maneuverAttackLibrary, keywords: ctx.keywords, draft: source.draft, usedSlots: source.usedSlots, subject: { kind: "CHARACTER_SIGNATURE_MANEUVER", characterId: ctx.characterId, signatureAbilityId: source.abilityId, revisionNumber: source.revisionNumber } },
    (plan) => {
      compiled = plan;
    },
  );
  return { evaluation, compiled };
}

export interface BuiltInputs {
  readonly inputs: readonly Record<string, unknown>[];
  /** Each input as recorded in the activity ledger, labelled with its source (never a claimed success). */
  readonly recorded: readonly Record<string, unknown>[];
}

/**
 * Binds raw player / GM answers to the exact plan's requests. The attacker's CharacterCore and die are the server's; a
 * defender is the GM's description (labelled GM-provided); the Saving Throw DC defaults to the Character's derived DC.
 */
export function buildResolutionInputs(ctx: PlayAbilityContext, executionKey: string, raw: readonly PlayResolutionInput[]): ProwessOutcome<BuiltInputs> {
  const p = new Problems();
  const core = indexCoreDefinitions(ctx.bundle);
  if (!core.ok) return core as ProwessOutcome<never>;
  const inputs: Record<string, unknown>[] = [];
  const recorded: Record<string, unknown>[] = [];
  raw.forEach((input, i) => {
    if (input.kind === "ATTACK_ROLL") {
      inputs.push({ requestKey: input.requestKey, kind: "ATTACK_ROLL", executionKey, roller: ctx.casterCore, roll: { die: ctx.characterDie, mode: input.roll.mode, rolls: [...input.roll.rolls] }, targetDodge: input.targetDodge });
      recorded.push({ requestKey: input.requestKey, kind: "ATTACK_ROLL", roller: "CHARACTER", die: ctx.characterDie.dieKey, mode: input.roll.mode, rolls: [...input.roll.rolls], rollSource: input.roll.source, targetDodge: { value: input.targetDodge, source: "PLAYER_GM_PROVIDED" } });
    } else if (input.kind === "SAVING_THROW") {
      const die = resolveCharacterDie(core.value.progression.payload, input.defender.level);
      if (die === null) {
        p.add("PLAY.INVALID_OPERATION", ["inputs", i, "defender", "level"], `level ${String(input.defender.level)} is not a Character Level of this Release`);
        return;
      }
      const dc = input.difficultyClass ?? ctx.characterDc;
      if (dc === null) {
        p.add("PLAY.COST_UNRESOLVED", ["inputs", i, "difficultyClass"], "this Release defines no Character DC; state the Difficulty Class explicitly");
        return;
      }
      // baseHp / baseMp are not read by a Saving Throw; the GM describes only what the Save uses (level → die, Stats).
      const roller = { level: input.defender.level, characterDie: { dieKey: die.dieKey }, stats: { ...input.defender.stats }, baseHp: 0, baseMp: 0, skillRanks: [], explicitBonuses: [] };
      inputs.push({ requestKey: input.requestKey, kind: "SAVING_THROW", executionKey, roller, roll: { die: { dieKey: die.dieKey, faces: die.faces }, mode: input.roll.mode, rolls: [...input.roll.rolls] }, difficultyClass: dc });
      recorded.push({ requestKey: input.requestKey, kind: "SAVING_THROW", roller: "DEFENDER_GM_PROVIDED", defender: { level: input.defender.level, stats: { ...input.defender.stats }, source: "PLAYER_GM_PROVIDED" }, die: die.dieKey, mode: input.roll.mode, rolls: [...input.roll.rolls], rollSource: input.roll.source, difficultyClass: { value: dc, source: input.difficultyClass === undefined ? "CHARACTER_DC" : "PLAYER_GM_PROVIDED" } });
    } else {
      inputs.push({ requestKey: input.requestKey, kind: input.kind, executionKey, stat: input.stat });
      recorded.push({ requestKey: input.requestKey, kind: input.kind, stat: input.stat, source: "PLAYER_GM_PROVIDED" });
    }
  });
  return finish(p, () => deepFreeze({ inputs, recorded }));
}

/** Executes the exact compiled plan with explicit targets and inputs (M5-WO12 semantics, unchanged). */
export function executeCompiled<S>(compiled: Compiled<S>, targets: readonly PlayTargetInput[], groupTargets: readonly { readonly groupKey: string; readonly targetKeys: readonly string[] }[] | null, inputs: readonly Record<string, unknown>[]): ProwessOutcome<AbilityExecutionResult> {
  const execution = { targets: clonePlainData(targets), ...(groupTargets === null ? {} : { groupTargets: clonePlainData(groupTargets) }), inputs: clonePlainData(inputs) };
  return executeCompiledResolution(compiled, { execution });
}

/** Presentation of a pending request: who answers it, with the Character's DC offered as the default for a Save. */
export function describePending(ctx: PlayAbilityContext, request: ExecutionInputRequest) {
  return deepFreeze({ ...clonePlainData(request), defaultDifficultyClass: request.kind === "SAVING_THROW" ? ctx.characterDc : null, defenderStats: request.kind === "SAVING_THROW" ? [...PROWESS_STATS] : null, characterDie: request.by === "ATTACKER" ? ctx.characterDie.dieKey : null });
}

const isAbilityRef = (value: unknown): value is { readonly abilityId: string; readonly revisionNumber: number } => isPlainObject(value) && typeof own(value, "abilityId") === "string" && typeof own(value, "revisionNumber") === "number";

/**
 * The M5-WO13 adapter for this Character's Signature Spells: `{ characterSignatureSpell: { abilityId, revisionNumber } }`
 * is priced by M6-WO7 (M5-WO10) and resolved by M5-WO12 over the exact revision, and held identities are accepted only
 * for this caster's own Spells. The adapter is pure over the context it is built from.
 */
export function characterSpellAdapter(ctx: PlayAbilityContext): ActiveMagicAbilityAdapter {
  const sourceOf = (ability: Record<string, unknown>) => {
    const ref = own(ability, "characterSignatureSpell");
    if (!isAbilityRef(ref)) return null;
    const source = ctx.spells.find((s) => s.abilityId === ref.abilityId && s.revisionNumber === ref.revisionNumber);
    return source === undefined ? null : source;
  };
  const evaluated = (ability: Record<string, unknown>): EvaluatedSpell | null => {
    const source = sourceOf(ability);
    return source === null ? null : evaluateSpellSource(ctx, source);
  };
  const fail = (message: string) => {
    const p = new Problems();
    p.add("PLAY.UNKNOWN_ABILITY", ["ability"], message);
    return finish(p, () => null as never);
  };
  return {
    handles: (ability) => own(ability, "characterSignatureSpell") !== undefined,
    cost: (ability) => {
      const source = sourceOf(ability);
      const e = evaluated(ability);
      if (source === null || e === null) return fail("no Signature Spell revision of this Character has this exact identity");
      const cost = e.evaluation.cost;
      if (cost === null) return fail("the Spell cannot be priced (see its evaluation); it never becomes active magic");
      const identity = spellIdentityOf(ctx.characterId, source.abilityId, source.revisionNumber as number);
      return finish(new Problems(), () => deepFreeze({ ...clonePlainData(cost), definition: identity }) as unknown as SpellCostResult<CharacterSpellIdentity>);
    },
    execute: (ability) => {
      const source = sourceOf(ability);
      const e = evaluated(ability);
      if (source === null || e === null || e.compiled === null) return fail("the Spell has no executable M5-WO12 plan");
      const execution = own(ability, "execution");
      const out = executeCompiledResolution(e.compiled, { execution });
      if (!out.ok) return out;
      const identity = spellIdentityOf(ctx.characterId, source.abilityId, source.revisionNumber as number);
      return finish(new Problems(), () => deepFreeze({ ...clonePlainData(out.value), definition: identity }) as unknown as AbilityExecutionResult);
    },
    owns: (identity, casterKey) => {
      if (!isPlainObject(identity) || own(identity, "kind") !== "CHARACTER_SIGNATURE_SPELL" || own(identity, "characterId") !== casterKey || casterKey !== ctx.characterId) return null;
      const abilityId = own(identity, "signatureAbilityId"), revisionNumber = own(identity, "revisionNumber");
      if (typeof abilityId !== "string" || typeof revisionNumber !== "number" || !ctx.spells.some((s) => s.abilityId === abilityId)) return null;
      const expected = spellIdentityOf(ctx.characterId, abilityId, revisionNumber);
      return own(identity, "canonicalKey") === expected.canonicalKey && Object.keys(identity).length === Object.keys(expected).length ? expected : null;
    },
  };
}
