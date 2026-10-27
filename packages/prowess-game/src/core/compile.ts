import { createRulesetContext, type ActorContext, type EvaluationPlan, type EvaluationContextFamily, type RuleProvenance, type RuntimeContext } from "@prowess/rules";
import type { JsonObject } from "@prowess/model";
import { deepFreeze, isPlainObject } from "../internal/plain-data.js";
import { Problems, checkPlainData, finish, isExactCanonicalKey, isExactLabel, own, readEnum, readRecord, type ProwessOutcome } from "../internal/problems.js";
import { COMPILATION_ERROR_CODES as X, CORE_ERROR_CODES as K, DEFINITION_ERROR_CODES as C } from "../definition/codes.js";
import type { ProwessDefinitionRef } from "../definition/envelope.js";
import type { CoreFormula, CoreRollPayload, FormulaVariableSource, StatMasteryPayload } from "../definition/core-payload.js";
import { bundleMatchesRuleset, type ProwessDefinitionBundle, type ProwessRulesetProvenance, createBundleWithinCheckedRequest } from "../bundle/bundle.js";
import { assembleFragments, compiledStepKey, type SubjectComponents } from "../compilation/assemble.js";
import type { CompilationFragment, CompilationFragmentBinding, ProwessCompilationSourceMap } from "../compilation/model.js";
import { PROWESS_COMPILATION_CONTRACT_VERSION, SUPPORTED_PROWESS_COMPILATION_CONTRACT_VERSIONS, type ProwessCompilationContractVersion } from "../contract-version.js";
import {
  CHARACTER_PROPERTY_KEYS,
  COMPARISON_STATE_KEYS,
  CORE_PROCEDURES,
  DERIVED_STATISTICS,
  PROWESS_STATS,
  ROLL_MODES,
  ROLL_MODE_VARIABLES,
  ROLL_STATE_KEYS,
  STAT_CONTEXT_KEYS,
  type BonusTarget,
  type CoreProcedure,
  type DerivedStatistic,
  type ProwessStat,
  type RollMode,
} from "../vocabulary/core.js";
import { bonusPropertyKey, buildCharacterActorContext, validateCharacterCore, type ValidatedCharacterCore } from "./character.js";
import { indexCoreDefinitions, type CoreDefinitionIndex, type CoreEntry } from "./definitions.js";
import { buildRollRuntimeContext, validateDieRollInput } from "./dice.js";

/**
 * Core-resolution compilation (PAS-10 M5-WO2): exact core Definitions + a CharacterCore + a procedure → ONE M4
 * EvaluationPlan whose FORMULA steps do every piece of arithmetic (natural selection, totals, derived statistics, named
 * bonus sums) and whose REQUIREMENT / MODIFIER steps do every comparison and signal (success, critical threat,
 * critical hit, Stat Mastery). This module chooses WHICH authored programs to run and wires their inputs; it computes
 * nothing, rolls nothing and never branches on a Stat, a level, a die size or a rank (M5-I047, M5-I056).
 */

export const CORE_SUBJECT_KINDS = deepFreeze(["CORE_RESOLUTION", "DERIVED_STATISTICS"] as const);
export type CoreSubjectKind = (typeof CORE_SUBJECT_KINDS)[number];

/** A roll procedure to compile (CORE_ROLL, SKILL_CHECK, SKILL_AUTOMATIC_SUCCESS, SAVING_THROW, ATTACK_ROLL). */
export interface CoreResolutionSubject {
  readonly kind: "CORE_RESOLUTION";
  /** Caller-chosen exact label naming this compilation (e.g. `check.force_door`); part of every step key. */
  readonly subjectKey: string;
  readonly procedure: Exclude<CoreProcedure, "STAT_MASTERY">;
  /** Required for a procedure that rolls a die; forbidden otherwise. Resolve signals with `resolveRollMode`. */
  readonly mode?: RollMode;
  /** The Stat chosen by the approach (s32, s40) — required exactly when the procedure's total reads CHOSEN_STAT. */
  readonly stat?: ProwessStat;
  /** Exact Skill canonical key — required exactly when the procedure requires a Skill. */
  readonly skillKey?: string;
  /** Explicit GM / rule permission for a rank whose `attemptAllowed` is false (UNTRAINED, s30). Never assumed. */
  readonly attemptPermitted?: boolean;
}

/** Every derived statistic the bundle defines (or the listed ones, with their dependencies). */
export interface DerivedStatisticsSubject {
  readonly kind: "DERIVED_STATISTICS";
  readonly subjectKey: string;
  readonly statistics?: readonly DerivedStatistic[];
}

export type CoreCompilationSubject = CoreResolutionSubject | DerivedStatisticsSubject;

export interface CoreCompilationRequest {
  readonly contractVersion: ProwessCompilationContractVersion;
  readonly subject: CoreCompilationSubject;
  readonly definitions: ProwessDefinitionBundle;
  readonly ruleset: unknown;
  readonly character: unknown;
}

/** Which compiled step holds which result. Null where the procedure has no such result. Pure naming — no values. */
export interface CoreCompiledOutputs {
  readonly natural: string | null;
  readonly total: string | null;
  readonly success: string | null;
  readonly criticalThreat: string | null;
  readonly criticalHit: string | null;
  readonly automaticTotal: string | null;
  readonly automaticSuccess: string | null;
  readonly statMasterySignal: string | null;
  readonly derived: Readonly<Partial<Record<DerivedStatistic, string>>>;
}

export interface ProwessCoreCompiledPlan {
  readonly contractVersion: ProwessCompilationContractVersion;
  readonly subject: {
    readonly kind: CoreSubjectKind;
    readonly subjectKey: string;
    readonly procedure: CoreProcedure | null;
    readonly mode: RollMode | null;
    readonly stat: ProwessStat | null;
    readonly skillKey: string | null;
  };
  readonly rulesetProvenance: ProwessRulesetProvenance;
  readonly evaluationPlan: EvaluationPlan;
  readonly sourceMap: ProwessCompilationSourceMap;
  readonly outputs: CoreCompiledOutputs;
}

/**
 * Explicit, increasing plan positions. Named bonus sums read only the ActorContext, so they run first (-1); derived
 * statistics take positions 0…n in M4's dependency order; roll steps follow.
 */
const ORDER = deepFreeze({
  BONUSES: -1,
  STAT_MASTERY: 1000,
  NATURAL: 1010,
  TOTAL: 1030,
  SUCCESS: 1040,
  CRITICAL_THREAT: 1040,
  CRITICAL_HIT: 1050,
  AUTOMATIC_TOTAL: 1030,
  AUTOMATIC_SUCCESS: 1040,
});
const SUBJECT_FIELDS = { CORE_RESOLUTION: ["kind", "subjectKey", "procedure", "mode", "stat", "skillKey", "attemptPermitted"], DERIVED_STATISTICS: ["kind", "subjectKey", "statistics"] } as const;
const REQUEST_FIELDS = ["contractVersion", "subject", "definitions", "ruleset", "character"];
const FACT = deepFreeze({ NATURAL: "roll.natural", TOTAL: "roll.total", LEVEL: "character.level", STAT: "stat.score" });
const SIGNAL_TARGET = "roll.mode_signal";

export const pointer = (...tokens: string[]): string => tokens.map((t) => `/${t.replace(/~/g, "~0").replace(/\//g, "~1")}`).join("");
export const fromContext = (target: string, context: EvaluationContextFamily, path: string): CompilationFragmentBinding => ({ target, source: { kind: "CONTEXT", context, pointer: path } });
export const fromFragment = (target: string, fragmentKey: string, path = "/data/finalValue"): CompilationFragmentBinding => ({ target, source: { kind: "FRAGMENT", fragmentKey, pointer: path } });
const derivedFragmentKey = (statistic: DerivedStatistic): string => `derived.${statistic}`;
const bonusFragmentKey = (target: BonusTarget): string => `bonuses.${target}`;
const statComponent = (stat: ProwessStat): string => `stat.${stat}`;

/**
 * One compilation's working state: the fragments emitted so far and the subject's components. Shared with the M5-WO3
 * runtime compiler, which reuses `derived` to bind a Resource's maximum to the exact WO2 capacity statistic.
 */
export class Emitter {
  readonly fragments: CompilationFragment[] = [];
  readonly components = new Map<string, ProwessDefinitionRef[]>();
  constructor(readonly core: CoreDefinitionIndex, readonly character: ValidatedCharacterCore, readonly p: Problems) {}

  component(key: string, entries: readonly CoreEntry<unknown>[]): string {
    this.components.set(key, entries.map((e) => e.ref));
    return key;
  }

  emit(fragment: CompilationFragment): string {
    this.fragments.push(fragment);
    return fragment.fragmentKey;
  }

  has(fragmentKey: string): boolean {
    return this.fragments.some((f) => f.fragmentKey === fragmentKey);
  }

  /** The named bonus-sum Formula for `target`: an M4 AST of `+` nodes over each bonus's own variable (or 0). */
  bonuses(target: BonusTarget, owner: string, entry: CoreEntry<unknown>): string {
    const fragmentKey = bonusFragmentKey(target);
    if (this.has(fragmentKey)) return fragmentKey;
    const bonuses = this.character.explicitBonuses.filter((b) => b.appliesTo === target);
    const leaf = (name: string) => ({ type: "VARIABLE", key: name, startOffset: 0, endOffset: 0 });
    const ast = bonuses.reduce<JsonObject>(
      (acc, b, i) => (i === 0 ? leaf(`bonus.${b.bonusKey}`) : { type: "BINARY", operator: "+", left: acc, right: leaf(`bonus.${b.bonusKey}`), startOffset: 0, endOffset: 0 }),
      { type: "NUMBER", value: 0, startOffset: 0, endOffset: 0 },
    );
    return this.emit({
      fragmentKey,
      order: ORDER.BONUSES,
      operation: "FORMULA",
      input: { program: { ast, rounding: "NONE", provenance: entry.provenance as unknown as JsonObject }, variables: {} },
      bindings: bonuses.map((b) => fromContext(pointer("variables", `bonus.${b.bonusKey}`), "ACTOR", pointer("properties", bonusPropertyKey(b)))),
      role: `explicit-bonuses:${target}`,
      componentKeys: [owner],
      definitions: [entry.ref],
    });
  }

  /** Bindings + cited components for each declared Formula variable; DERIVED variables pull their statistic in first. */
  variables(formula: CoreFormula, owner: string, ownerEntry: CoreEntry<unknown>, context: { stat: ProwessStat | null; natural: string | null; rankBonus: number | null; bonusTarget: BonusTarget | null }) {
    const bindings: CompilationFragmentBinding[] = [];
    const literals: Record<string, number> = {};
    const componentKeys = new Set<string>([owner]);
    const definitions: ProwessDefinitionRef[] = [ownerEntry.ref];
    const cite = (key: string) => {
      componentKeys.add(key);
      for (const ref of this.components.get(key) ?? []) if (!definitions.includes(ref)) definitions.push(ref);
    };
    for (const { variable, source } of formula.variables) {
      const target = pointer("variables", variable);
      const read = (s: FormulaVariableSource) => {
        switch (s.kind) {
          case "STAT":
            cite(this.component(statComponent(s.stat), [this.core.stats[s.stat]]));
            bindings.push(fromContext(target, "ACTOR", pointer("stats", STAT_CONTEXT_KEYS[s.stat])));
            break;
          case "CHOSEN_STAT":
            if (context.stat === null) {
              this.p.add(K.INVALID_CORE_REQUEST, ["subject", "stat"], "this procedure reads the Stat chosen by the approach; subject.stat is required");
              return;
            }
            cite(this.component(statComponent(context.stat), [this.core.stats[context.stat]]));
            bindings.push(fromContext(target, "ACTOR", pointer("stats", STAT_CONTEXT_KEYS[context.stat])));
            break;
          case "CHARACTER":
            bindings.push(fromContext(target, "ACTOR", pointer("properties", CHARACTER_PROPERTY_KEYS[s.field])));
            break;
          case "CHARACTER_DIE_FACES":
            cite(this.component("character-die", [this.core.progression]));
            bindings.push(fromContext(target, "ACTOR", pointer("properties", CHARACTER_PROPERTY_KEYS.CHARACTER_DIE_FACES)));
            break;
          case "DERIVED": {
            const key = this.derived(s.statistic);
            if (key !== null) {
              cite(`derived.${s.statistic}`);
              bindings.push(fromFragment(target, key));
            }
            break;
          }
          case "NATURAL":
            if (context.natural !== null) bindings.push(fromFragment(target, context.natural));
            break;
          case "SKILL_RANK_BONUS":
            // The bonus is the exact SKILL_RANK Definition's literal for the character's rank — copied, never computed.
            cite("skill-rank");
            if (context.rankBonus !== null) literals[variable] = context.rankBonus;
            break;
          case "EXPLICIT_BONUSES":
            if (context.bonusTarget !== null) bindings.push(fromFragment(target, this.bonuses(context.bonusTarget, owner, ownerEntry)));
            break;
          case "CREATURE_SIZE_BASE_MOVEMENT": {
            // The character's exact CREATURE_SIZE Definition's authored Base Movement — copied, never computed or
            // inferred from occupied space (post-WO4 designer ruling M5-SC-033, M5-I113, M5-I152).
            const size = this.character.creatureSize;
            const entry = this.core.sizes[size];
            if (entry === undefined) {
              this.p.add(K.MISSING_CORE_DEFINITION, ["definitions"], `the bundle has no CREATURE_SIZE Definition for ${size}; Base Movement comes from it`);
              return;
            }
            if (entry.payload.baseMovement === null) {
              this.p.add(K.SIZE_BASE_MOVEMENT_PENDING_CANON, ["character", "creatureSize"], `${size} has no canonical Base Movement yet (${entry.ref.canonicalKey}); it is never guessed`);
              return;
            }
            cite(this.component(`creature-size.${size}`, [entry]));
            literals[variable] = entry.payload.baseMovement.feet;
            break;
          }
        }
      };
      read(source);
    }
    return { bindings, literals, componentKeys: [...componentKeys], definitions };
  }

  /** Emits the FORMULA step of one derived statistic (and, first, the statistics it depends on). */
  derived(statistic: DerivedStatistic): string | null {
    const fragmentKey = derivedFragmentKey(statistic);
    if (this.has(fragmentKey)) return fragmentKey;
    const entry = this.core.derived[statistic];
    if (entry === undefined) {
      this.p.add(K.MISSING_CORE_DEFINITION, ["definitions"], `the bundle has no DERIVED_STAT Definition for ${statistic}`);
      return null;
    }
    const owner = this.component(`derived.${statistic}`, [entry]);
    const order = this.core.derivedOrder.indexOf(statistic);
    const f = entry.payload.formula;
    const vars = this.variables(f, owner, entry, { stat: null, natural: null, rankBonus: null, bonusTarget: entry.payload.bonusTarget });
    return this.emit({
      fragmentKey,
      order,
      operation: "FORMULA",
      input: { program: program(f, entry.provenance), variables: vars.literals },
      bindings: vars.bindings,
      role: `derived-statistic:${statistic}`,
      componentKeys: vars.componentKeys,
      definitions: vars.definitions,
    });
  }
}

export function program(f: CoreFormula, provenance: RuleProvenance): JsonObject {
  return {
    expression: f.expression,
    rounding: f.rounding,
    ...(f.minimum === null ? {} : { minimum: f.minimum }),
    ...(f.maximum === null ? {} : { maximum: f.maximum }),
    ...(f.unit === null ? {} : { unit: f.unit }),
    provenance: provenance as unknown as JsonObject,
  };
}

export const compare = (factKey: string, operator: ">=" | "==" | "<=", provenance: RuleProvenance): JsonObject => ({ kind: "NUMERIC_COMPARE", factKey, operator, expected: 0, provenance: provenance as unknown as JsonObject });
export const numericFacts = (...keys: string[]): JsonObject => ({ numeric: keys.map((key) => ({ key, value: 0 })) });

/** The single Stat a roll uses: the chosen Stat, else the one STAT its total reads (an Attack Roll reads PER). */
function rollStat(total: CoreFormula, chosen: ProwessStat | null): ProwessStat | null {
  if (chosen !== null) return chosen;
  const fixed = total.variables.flatMap((v) => (v.source.kind === "STAT" ? [v.source.stat] : []));
  return fixed.length === 1 ? (fixed[0] as ProwessStat) : null;
}

function emitRoll(e: Emitter, subject: CoreResolutionSubject, procedure: Exclude<CoreProcedure, "STAT_MASTERY">, prefix: string, outputs: Record<string, string | null>, attemptPermitted: boolean): void {
  const entry = e.core.procedures[procedure] as CoreEntry<CoreRollPayload> | undefined;
  if (entry === undefined) {
    e.p.add(K.MISSING_CORE_DEFINITION, ["definitions"], `the bundle has no CORE_RESOLUTION Definition for ${procedure}`);
    return;
  }
  const payload = entry.payload;
  // INITIATIVE (M5-WO3) is a roll with no comparison, no critical and no Skill: its total is compared with other sides'.
  const comparison = (payload as Partial<CoreRollPayload>).comparison ?? null;
  const critical = (payload as Partial<CoreRollPayload>).critical ?? null;
  const requiresSkill = (payload as Partial<CoreRollPayload>).requiresSkill ?? false;
  const owner = e.component(`procedure.${procedure}`, [entry]);
  const key = (k: string) => `${prefix}${k}`;
  const usesChosenStat = payload.total.variables.some((v) => v.source.kind === "CHOSEN_STAT");
  if (usesChosenStat !== (subject.stat !== undefined)) {
    e.p.add(K.INVALID_CORE_REQUEST, ["subject", "stat"], usesChosenStat ? `${procedure} uses the Stat chosen by the approach; subject.stat is required` : `${procedure} reads a fixed Stat; subject.stat must be absent`);
    return;
  }

  // Skill rank → its bonus and attempt policy, read from the exact SKILL_RANK Definition.
  let rankBonus: number | null = null;
  if (requiresSkill) {
    if (subject.skillKey === undefined) {
      e.p.add(K.INVALID_CORE_REQUEST, ["subject", "skillKey"], `${procedure} requires an exact Skill canonical key`);
      return;
    }
    const ladder = e.core.skillLadder.payload.ranks;
    // A Skill the character holds no rank in is at the ladder's first rank (UNTRAINED in V0.1, s29).
    const held = e.character.skillRanks.find((r) => r.skillKey === subject.skillKey)?.rankKey ?? (ladder[0] as { rankKey: string }).rankKey;
    const meaning = e.core.skillRanks.payload.entries.find((m) => m.rankKey === held);
    e.component("skill-rank", [e.core.skillRanks, e.core.skillLadder]);
    if (meaning === undefined) return;
    if (!meaning.attemptAllowed && !attemptPermitted) {
      e.p.add(K.ATTEMPT_REQUIRES_PERMISSION, ["subject", "attemptPermitted"], `a ${held} character may attempt this check only with explicit GM permission (${e.core.skillRanks.ref.canonicalKey})`);
      return;
    }
    rankBonus = meaning.bonus;
  } else if (subject.skillKey !== undefined && procedure === subject.procedure) {
    e.p.add(K.INVALID_CORE_REQUEST, ["subject", "skillKey"], `${procedure} uses no Skill; subject.skillKey must be absent`);
    return;
  }

  let natural: string | null = null;
  if (payload.naturalSelection !== null) {
    const mode = subject.mode;
    if (mode === undefined) {
      e.p.add(K.INVALID_CORE_REQUEST, ["subject", "mode"], `${procedure} rolls the Character Die; subject.mode (NORMAL | ADVANTAGE | DISADVANTAGE) is required`);
      return;
    }
    const names = ROLL_MODE_VARIABLES[mode];
    natural = e.emit({
      fragmentKey: key("natural"),
      order: ORDER.NATURAL,
      operation: "FORMULA",
      input: { program: { expression: payload.naturalSelection[mode].expression, rounding: "NONE", provenance: entry.provenance as unknown as JsonObject }, variables: {} },
      bindings: names.map((name) => fromContext(pointer("variables", name), "RUNTIME", pointer("state", ROLL_STATE_KEYS[name]))),
      role: `natural-selection:${mode}`,
      componentKeys: [owner],
      definitions: [entry.ref],
    });
  }

  const stat = subject.stat ?? null;
  const vars = e.variables(payload.total, owner, entry, { stat, natural, rankBonus, bonusTarget: payload.bonusTarget });
  if (e.p.count > 0) return;
  const total = e.emit({
    fragmentKey: key("total"),
    order: payload.naturalSelection === null ? ORDER.AUTOMATIC_TOTAL : ORDER.TOTAL,
    operation: "FORMULA",
    input: { program: program(payload.total, entry.provenance), variables: vars.literals },
    bindings: vars.bindings,
    role: `roll-total:${procedure}`,
    componentKeys: vars.componentKeys,
    definitions: vars.definitions,
  });

  outputs[payload.naturalSelection === null ? "automaticTotal" : "total"] = total;
  outputs.natural = natural ?? outputs.natural ?? null;
  if (comparison === null) return;
  const against = pointer("state", COMPARISON_STATE_KEYS[comparison.against]);
  const success = e.emit({
    fragmentKey: key("success"),
    order: ORDER.SUCCESS,
    operation: "REQUIREMENT",
    input: { requirement: compare(FACT.TOTAL, comparison.operator, entry.provenance), facts: numericFacts(FACT.TOTAL) },
    bindings: [fromContext("/requirement/expected", "RUNTIME", against), fromFragment("/facts/numeric/0/value", total)],
    role: `meets-or-exceeds:${comparison.against}`,
    componentKeys: [owner],
    definitions: [entry.ref],
  });
  outputs[payload.naturalSelection === null ? "automaticSuccess" : "success"] = success;

  if (critical !== null && natural !== null) {
    const die = e.component("character-die", [e.core.progression]);
    const faces = pointer("properties", CHARACTER_PROPERTY_KEYS.CHARACTER_DIE_FACES);
    outputs.criticalThreat = e.emit({
      fragmentKey: key("critical-threat"),
      order: ORDER.CRITICAL_THREAT,
      operation: "REQUIREMENT",
      input: { requirement: compare(FACT.NATURAL, "==", entry.provenance), facts: numericFacts(FACT.NATURAL) },
      bindings: [fromContext("/requirement/expected", "ACTOR", faces), fromFragment("/facts/numeric/0/value", natural)],
      role: "critical-threat:natural-equals-die-faces",
      componentKeys: [owner, die],
      definitions: [entry.ref, e.core.progression.ref],
    });
    outputs.criticalHit = e.emit({
      fragmentKey: key("critical-hit"),
      order: ORDER.CRITICAL_HIT,
      operation: "REQUIREMENT",
      input: {
        requirement: { kind: "ALL", children: [compare(FACT.NATURAL, "==", entry.provenance), compare(FACT.TOTAL, comparison.operator, entry.provenance)], provenance: entry.provenance as unknown as JsonObject },
        facts: numericFacts(FACT.NATURAL, FACT.TOTAL),
      },
      bindings: [
        fromContext("/requirement/children/0/expected", "ACTOR", faces),
        fromContext("/requirement/children/1/expected", "RUNTIME", against),
        fromFragment("/facts/numeric/0/value", natural),
        fromFragment("/facts/numeric/1/value", total),
      ],
      role: "critical-hit:threat-and-success",
      componentKeys: [owner, die],
      definitions: [entry.ref, e.core.progression.ref],
    });
  }

  // Stat Mastery (s162): an ADVANTAGE roll SIGNAL through M4's Modifier engine — never a number added to the total.
  const mastery = e.core.procedures.STAT_MASTERY as CoreEntry<StatMasteryPayload> | undefined;
  const masteredStat = rollStat(payload.total, stat);
  if (mastery !== undefined && masteredStat !== null && mastery.payload.appliesTo.includes(procedure) && natural !== null) {
    const masteryOwner = e.component("procedure.STAT_MASTERY", [mastery]);
    const statKey = e.component(statComponent(masteredStat), [e.core.stats[masteredStat]]);
    const m = mastery.payload.mastery;
    outputs.statMasterySignal = e.emit({
      fragmentKey: key("stat-mastery"),
      order: ORDER.STAT_MASTERY,
      operation: "MODIFIER",
      input: {
        request: {
          targets: [{ targetKey: SIGNAL_TARGET, kind: "ROLL_SIGNAL" }],
          modifiers: [
            {
              modifierKey: `stat_mastery.${STAT_CONTEXT_KEYS[masteredStat]}`,
              targetKey: SIGNAL_TARGET,
              operation: m.signal,
              phase: { phaseKey: "stat_mastery", phaseOrder: 0 },
              priority: 0,
              order: 0,
              condition: {
                kind: "ALL",
                children: [
                  { kind: "NUMERIC_COMPARE", factKey: FACT.LEVEL, operator: ">=", expected: m.levelAtLeast, provenance: mastery.provenance as unknown as JsonObject },
                  { kind: "NUMERIC_COMPARE", factKey: FACT.STAT, operator: ">=", expected: m.statAtLeast, provenance: mastery.provenance as unknown as JsonObject },
                ],
                provenance: mastery.provenance as unknown as JsonObject,
              },
              stacking: { policy: "STACK" },
              provenance: mastery.provenance as unknown as JsonObject,
            },
          ],
          facts: numericFacts(FACT.LEVEL, FACT.STAT),
        },
      },
      bindings: [
        fromContext("/request/facts/numeric/0/value", "ACTOR", pointer("properties", CHARACTER_PROPERTY_KEYS.LEVEL)),
        fromContext("/request/facts/numeric/1/value", "ACTOR", pointer("stats", STAT_CONTEXT_KEYS[masteredStat])),
      ],
      role: `stat-mastery-signal:${masteredStat}`,
      componentKeys: [masteryOwner, statKey],
      definitions: [mastery.ref, e.core.stats[masteredStat].ref],
    });
  }
}

function readSubject(value: unknown, p: Problems): CoreCompilationSubject | null {
  if (!isPlainObject(value)) {
    p.add(X.INVALID_REQUEST, ["subject"], "subject is { kind: CORE_RESOLUTION | DERIVED_STATISTICS, subjectKey, … }");
    return null;
  }
  const kind = readEnum(own(value, "kind"), CORE_SUBJECT_KINDS, ["subject", "kind"], p, X.INVALID_REQUEST, "core subject kind");
  if (kind === null) return null;
  const r = readRecord(value, ["subject"], p, X.INVALID_REQUEST, SUBJECT_FIELDS[kind], ["kind", "subjectKey", ...(kind === "CORE_RESOLUTION" ? ["procedure"] : [])]);
  if (r === null) return null;
  const subjectKey = own(r, "subjectKey");
  if (!isExactLabel(subjectKey) || subjectKey.includes(":")) p.add(X.INVALID_REQUEST, ["subject", "subjectKey"], "subjectKey is an exact label without ':'");
  if (kind === "DERIVED_STATISTICS") {
    const raw = own(r, "statistics");
    const statistics = raw === undefined ? undefined : Array.isArray(raw) ? raw.flatMap((s: unknown, i: number) => readEnum(s, DERIVED_STATISTICS, ["subject", "statistics", i], p, X.INVALID_REQUEST, "derived statistic") ?? []) : (p.add(X.INVALID_REQUEST, ["subject", "statistics"], "statistics is an array"), []);
    return { kind, subjectKey: subjectKey as string, ...(statistics === undefined ? {} : { statistics }) };
  }
  const procedure = readEnum(own(r, "procedure"), CORE_PROCEDURES.filter((x) => x !== "STAT_MASTERY") as Exclude<CoreProcedure, "STAT_MASTERY">[], ["subject", "procedure"], p, X.INVALID_REQUEST, "roll procedure");
  const mode = own(r, "mode") === undefined ? undefined : readEnum(own(r, "mode"), ROLL_MODES, ["subject", "mode"], p, X.INVALID_REQUEST, "roll mode");
  const stat = own(r, "stat") === undefined ? undefined : readEnum(own(r, "stat"), PROWESS_STATS, ["subject", "stat"], p, X.INVALID_REQUEST, "Stat");
  const skillKey = own(r, "skillKey");
  if (skillKey !== undefined && !isExactCanonicalKey(skillKey)) p.add(X.INVALID_REQUEST, ["subject", "skillKey"], "skillKey is an exact Skill canonical key");
  const attemptPermitted = own(r, "attemptPermitted");
  if (attemptPermitted !== undefined && typeof attemptPermitted !== "boolean") p.add(X.INVALID_REQUEST, ["subject", "attemptPermitted"], "attemptPermitted is an explicit boolean");
  if (procedure === null || mode === null || stat === null) return null;
  return {
    kind,
    subjectKey: subjectKey as string,
    procedure,
    ...(mode === undefined ? {} : { mode }),
    ...(stat === undefined ? {} : { stat }),
    ...(skillKey === undefined ? {} : { skillKey: skillKey as string }),
    ...(attemptPermitted === undefined ? {} : { attemptPermitted: attemptPermitted as boolean }),
  };
}

/** Re-validates the request's bundle against its exact RulesetContext and indexes the core Definitions. */
export function readCoreBundle(r: Record<string, unknown>, p: Problems): { bundle: ProwessDefinitionBundle; core: CoreDefinitionIndex } | null {
  const ruleset = createRulesetContext(own(r, "ruleset"));
  if (!ruleset.ok) {
    p.add(X.INVALID_REQUEST, ["ruleset"], "an exact, valid M4 RulesetContext is required");
    return null;
  }
  const rawBundle = own(r, "definitions");
  if (!isPlainObject(rawBundle)) {
    p.add(X.INVALID_REQUEST, ["definitions"], "definitions is the exact ProwessDefinitionBundle of the request's RulesetContext");
    return null;
  }
  const bundle = createBundleWithinCheckedRequest(own(r, "ruleset"), own(rawBundle, "definitions") ?? null, true);
  if (!bundle.ok) {
    for (const problem of bundle.problems) p.list.push({ ...problem, path: `/definitions${problem.path}` });
    return null;
  }
  if (!bundleMatchesRuleset({ rulesetProvenance: own(rawBundle, "rulesetProvenance") as ProwessRulesetProvenance, definitions: [] }, ruleset.value)) {
    p.add(X.BUNDLE_RULESET_MISMATCH, ["definitions", "rulesetProvenance"], "the Definition bundle was materialized for a different exact Ruleset context");
    return null;
  }
  const core = indexCoreDefinitions(bundle.value);
  if (!core.ok) {
    p.list.push(...core.problems);
    return null;
  }
  return { bundle: bundle.value, core: core.value };
}

/**
 * Compiles a core-resolution subject into an M4 EvaluationPlan (M5-WO2). Pure and deterministic: equal requests give
 * deep-equal, deep-frozen, JSON-safe plans; no input is mutated. Fails closed on an unsupported contract version, a
 * bundle that is not exactly the request's Ruleset bundle, a missing or ambiguous core Definition, an invalid
 * CharacterCore, a missing / forbidden Stat, Skill or mode, or an attempt that needs GM permission.
 */
export function compileCoreResolution(request: unknown): ProwessOutcome<ProwessCoreCompiledPlan> {
  const p = new Problems();
  if (!checkPlainData(request, [], p, C.NOT_PLAIN_DATA)) return finish(p, () => null as never);
  const r = readRecord(request, [], p, X.INVALID_REQUEST, REQUEST_FIELDS, REQUEST_FIELDS);
  if (r === null) return finish(p, () => null as never);
  const contractVersion = own(r, "contractVersion");
  if (typeof contractVersion !== "number" || !SUPPORTED_PROWESS_COMPILATION_CONTRACT_VERSIONS.includes(contractVersion)) {
    p.add(X.UNSUPPORTED_CONTRACT_VERSION, ["contractVersion"], `supported Prowess compilation contract versions: ${SUPPORTED_PROWESS_COMPILATION_CONTRACT_VERSIONS.join(", ")}`);
  }
  const subject = readSubject(own(r, "subject"), p);
  const resolved = readCoreBundle(r, p);
  if (p.count > 0 || subject === null || resolved === null) return finish(p, () => null as never);
  const { bundle, core } = resolved;

  const character = validateCharacterCore(own(r, "character"), core);
  if (!character.ok) {
    for (const problem of character.problems) p.list.push({ ...problem, path: `/character${problem.path}` });
    return finish(p, () => null as never);
  }

  const e = new Emitter(core, character.value, p);
  const outputs: Record<string, string | null> = {
    natural: null,
    total: null,
    success: null,
    criticalThreat: null,
    criticalHit: null,
    automaticTotal: null,
    automaticSuccess: null,
    statMasterySignal: null,
  };
  let primary: string | null = null;
  if (subject.kind === "DERIVED_STATISTICS") {
    for (const statistic of subject.statistics ?? core.derivedOrder) e.derived(statistic);
  } else {
    const rolls = core.procedures[subject.procedure]?.payload as CoreRollPayload | undefined;
    if (rolls !== undefined && rolls.naturalSelection === null && subject.mode !== undefined) {
      p.add(K.INVALID_CORE_REQUEST, ["subject", "mode"], `${subject.procedure} rolls no die; subject.mode must be absent`);
    } else {
      // A Skill Check also exposes its automatic-success fragments (s31, s36): both are evaluated, nothing is skipped.
      if (subject.procedure === "SKILL_CHECK") emitRoll(e, subject, "SKILL_AUTOMATIC_SUCCESS", "automatic.", outputs, subject.attemptPermitted === true);
      if (p.count === 0) emitRoll(e, subject, subject.procedure, "", outputs, subject.attemptPermitted === true);
      primary = outputs.success ?? outputs.automaticSuccess ?? outputs.total ?? null;
    }
  }
  if (p.count > 0) return finish(p, () => null as never);

  const components: SubjectComponents = e.components;
  const assembled = assembleFragments({ subjectKind: subject.kind, subjectKey: subject.subjectKey, components, bundle, fragments: e.fragments }, p);
  const stepKey = (fragmentKey: string | null) => (fragmentKey === null ? null : compiledStepKey(subject.kind, subject.subjectKey, fragmentKey));
  const derived: Partial<Record<DerivedStatistic, string>> = {};
  for (const f of e.fragments) {
    const statistic = DERIVED_STATISTICS.find((s) => derivedFragmentKey(s) === f.fragmentKey);
    if (statistic !== undefined) derived[statistic] = stepKey(f.fragmentKey) as string;
  }
  return finish(p, () => ({
    contractVersion: PROWESS_COMPILATION_CONTRACT_VERSION,
    subject: {
      kind: subject.kind,
      subjectKey: subject.subjectKey,
      procedure: subject.kind === "CORE_RESOLUTION" ? subject.procedure : null,
      mode: subject.kind === "CORE_RESOLUTION" ? (subject.mode ?? null) : null,
      stat: subject.kind === "CORE_RESOLUTION" ? (subject.stat ?? null) : null,
      skillKey: subject.kind === "CORE_RESOLUTION" ? (subject.skillKey ?? null) : null,
    },
    rulesetProvenance: bundle.rulesetProvenance,
    evaluationPlan: { steps: assembled.steps, primaryStepKey: stepKey(primary), validationStepKey: null, explanationStepKey: null },
    sourceMap: { entries: assembled.entries },
    outputs: {
      natural: stepKey(outputs.natural ?? null),
      total: stepKey(outputs.total ?? null),
      success: stepKey(outputs.success ?? null),
      criticalThreat: stepKey(outputs.criticalThreat ?? null),
      criticalHit: stepKey(outputs.criticalHit ?? null),
      automaticTotal: stepKey(outputs.automaticTotal ?? null),
      automaticSuccess: stepKey(outputs.automaticSuccess ?? null),
      statMasterySignal: stepKey(outputs.statMasterySignal ?? null),
      derived,
    },
  }));
}

/**
 * The exact M4 contexts a compiled core plan runs under: the character's ActorContext and the roll's RuntimeContext.
 * The roll is validated against the character's Character Die and must be in the plan's mode; nothing is rolled.
 */
export function buildCoreResolutionContexts(input: {
  readonly definitions: ProwessDefinitionBundle;
  readonly character: unknown;
  readonly plan: Pick<ProwessCoreCompiledPlan, "subject">;
  readonly roll?: unknown;
  readonly difficultyClass?: number;
  readonly targetDodge?: number;
}): ProwessOutcome<{ readonly actor: ActorContext; readonly runtime: RuntimeContext }> {
  const p = new Problems();
  const core = indexCoreDefinitions(input.definitions);
  if (!core.ok) return core as ProwessOutcome<never>;
  const character = validateCharacterCore(input.character, core.value);
  if (!character.ok) return character as ProwessOutcome<never>;
  const actor = buildCharacterActorContext(character.value);
  if (!actor.ok) return actor as ProwessOutcome<never>;
  let checkedRoll = null;
  const mode = input.plan.subject.mode;
  if (input.roll !== undefined) {
    const checked = validateDieRollInput(input.roll, character.value.resolvedDie);
    if (!checked.ok) return checked as ProwessOutcome<never>;
    if (checked.value.mode !== mode) p.add(K.INVALID_ROLL_INPUT, ["roll", "mode"], `the plan was compiled for ${String(mode)}; the roll is ${checked.value.mode}`);
    checkedRoll = checked.value;
  } else if (mode !== null) p.add(K.INVALID_ROLL_INPUT, ["roll"], "this plan rolls the Character Die; the natural results are required runtime input");
  const runtime = buildRollRuntimeContext({
    roll: checkedRoll,
    ...(input.difficultyClass === undefined ? {} : { difficultyClass: input.difficultyClass }),
    ...(input.targetDodge === undefined ? {} : { targetDodge: input.targetDodge }),
  });
  if (!runtime.ok) return runtime as ProwessOutcome<never>;
  return finish(p, () => ({ actor: actor.value, runtime: runtime.value }));
}
