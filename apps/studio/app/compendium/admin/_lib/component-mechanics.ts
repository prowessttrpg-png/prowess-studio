/**
 * RULES-WO1 Phase F — presentation helpers for the guided Spell / Maneuver component editors (Effects, Traits and the
 * shared construction rules). They translate between the M5 component contracts and game language: a "number choice",
 * "a fixed amount", "for each die", "on a failure". They hold NO rule: every option list comes from the catalog (the M5
 * vocabularies) and the server's M5 validation stays the only authority on legality. Each shape map below is keyed by
 * the M5 token (unquoted keys) and says only which CONTROL the editor shows for it.
 */

type Payload = Record<string, unknown>;

/** Which control an Effect / Trait parameter kind is edited with. */
export const PARAMETER_SHAPES = {
  COUNT: "number",
  TOKEN: "list",
  FLAG: "yesno",
} as const;
export type ParameterShape =
  (typeof PARAMETER_SHAPES)[keyof typeof PARAMETER_SHAPES];
export const PARAMETER_SHAPE_WORDS: Readonly<Record<ParameterShape, string>> = {
  number: "A number",
  list: "One option from a list",
  yesno: "Yes or no",
};

/** How a listed cost contribution is charged. */
export const COST_SHAPES = {
  FIXED: "fixed",
  PER_UNIT: "perNumber",
  PER_SELECTION: "perOption",
} as const;
export type CostShape = (typeof COST_SHAPES)[keyof typeof COST_SHAPES];
export const COST_SHAPE_WORDS: Readonly<Record<CostShape, string>> = {
  fixed: "A fixed amount",
  perNumber: "An amount for each step of a number choice",
  perOption: "An amount that depends on an option chosen",
};

/** A number choice's largest value. */
export const LIMIT_SHAPES = { FIXED: "fixed", STAT: "stat" } as const;

/** What a resolution mode asks for. */
export const MODE_SHAPES = {
  ATTACK_ROLL: "attack",
  SAVING_THROW: "save",
  AUTOMATIC: "automatic",
} as const;
export const MODE_WORDS: Readonly<Record<string, string>> = {
  ATTACK_ROLL: "An attack roll",
  SAVING_THROW: "A Saving Throw by the target",
  AUTOMATIC: "It happens automatically (no roll)",
};
export const RESOLUTION_POLICY_SHAPES = {
  OWN: "own",
  INHERIT_ABILITY: "inherit",
} as const;

export const SAVE_POLICY_WORDS: Readonly<Record<string, string>> = {
  FIXED: "Always this Save",
  CONSTRUCTION_CHOICE: "Chosen from these when the Spell or Maneuver is built",
  TARGET_CHOICE: "The target chooses one of these",
  MARTIAL_CONTROL: "Decided by Martial control (from these)",
};
export const ATTACK_TYPE_WORDS: Readonly<Record<string, string>> = {
  ABILITY_ATTACK: "Ability attack",
  MELEE_ATTACK: "Melee attack",
  RANGED_ATTACK: "Ranged attack",
  FOUNDATION_ATTACK: "The Maneuver's own foundation attack",
};
export const OUTCOME_WORDS: Readonly<Record<string, string>> = {
  SUCCESS: "On a success",
  FAILURE: "On a failure",
};

/** One field of an outcome operation: which control edits it. Keys are the stored operation-data keys. */
export interface OperationField {
  readonly key: string;
  readonly label: string;
  readonly control:
    | "number"
    | "list"
    | "words"
    | "direction"
    | "fraction"
    | "maneuverTargeting";
  readonly optional?: boolean;
}
export const OPERATION_WORDS: Readonly<Record<string, string>> = {
  NO_EFFECT: "Nothing happens",
  DAMAGE: "Deals damage",
  HEAL: "Heals",
  CLEANSE: "Removes a Condition category",
  MODIFY_VALUE: "Raises or lowers a value",
  CONTROL: "Controls the target (for example a push)",
  UTILITY: "Performs a utility function",
  SUMMON: "Summons (the Summon itself comes from a Summon Type)",
  FOUNDATION_DAMAGE: "Deals a share of the foundation attack's damage",
  CONVERT_TARGETING: "Changes how the Maneuver targets",
  CONVERT_DAMAGE_TYPE: "Changes the damage type",
};
export const OPERATION_FIELDS: Readonly<
  Record<string, readonly OperationField[]>
> = {
  NO_EFFECT: [],
  DAMAGE: [
    {
      key: "diceParameter",
      label: "Number of damage dice comes from",
      control: "number",
    },
    {
      key: "damageTypeParameter",
      label: "Damage type comes from",
      control: "list",
    },
  ],
  HEAL: [
    {
      key: "diceParameter",
      label: "Number of healing dice comes from",
      control: "number",
    },
  ],
  CLEANSE: [
    {
      key: "categoryParameter",
      label: "The Condition category comes from",
      control: "list",
    },
  ],
  MODIFY_VALUE: [
    { key: "target", label: "The value it changes", control: "words" },
    { key: "direction", label: "Raises or lowers it", control: "direction" },
    {
      key: "amountParameter",
      label: "By an amount that comes from",
      control: "number",
    },
  ],
  CONTROL: [
    { key: "control", label: "Kind of control", control: "words" },
    {
      key: "distanceParameter",
      label: "Distance comes from",
      control: "number",
      optional: true,
    },
  ],
  UTILITY: [
    { key: "function", label: "What it does", control: "words" },
    {
      key: "distanceParameter",
      label: "Distance comes from",
      control: "number",
      optional: true,
    },
  ],
  SUMMON: [],
  FOUNDATION_DAMAGE: [
    {
      key: "fraction",
      label:
        "Share of the foundation attack's damage (1 = all of it, 0.5 = half)",
      control: "fraction",
    },
  ],
  CONVERT_TARGETING: [
    {
      key: "destination",
      label: "The Maneuver now targets as",
      control: "maneuverTargeting",
    },
  ],
  CONVERT_DAMAGE_TYPE: [
    {
      key: "damageTypeParameter",
      label: "The new damage type comes from",
      control: "list",
    },
  ],
};
export const DIRECTIONS: Readonly<Record<string, string>> = {
  INCREASE: "Raises it",
  DECREASE: "Lowers it",
};

/** Component construction prerequisites and stacking. */
export const PREREQUISITE_SHAPES = {
  SKILL_RANK_AT_LEAST: "skill",
  AFFINITY_RANK_AT_LEAST: "affinity",
} as const;
export const STACK_SHAPES = {
  FIXED: "fixed",
  TRACK_RANK_VALUE: "track",
} as const;

/** Trait modifications: which fields each kind of modification asks for. */
export const TRAIT_MODIFICATION_WORDS: Readonly<Record<string, string>> = {
  DAMAGE_TYPE: "Changes the damage type of one Effect",
  TARGETING_MEASURE:
    "Changes a Targeting measure (radius, range, length or width)",
  RESOLUTION: "Changes how it resolves",
  TRIGGER: "Adds a trigger",
  COST: "Changes a cost",
};
export const TRAIT_MEASURES: Readonly<Record<string, string>> = {
  RADIUS: "Radius",
  RANGE: "Range",
  LENGTH: "Length",
  WIDTH: "Width",
};
export const TRAIT_OPERATIONS: Readonly<Record<string, string>> = {
  ADD: "Adds the chosen number",
  MULTIPLY: "Multiplies by the chosen number",
  SET: "Sets it to the chosen number",
};
export const TRAIT_EVENTS: Readonly<Record<string, string>> = {
  ON_HIT: "On a hit",
  ON_MISS: "On a miss",
  ON_DELIVERY: "When it is delivered",
  ON_ENTRY: "When something enters it",
};
export const TRAIT_MODIFICATION_SHAPES = {
  DAMAGE_TYPE: "damageType",
  TARGETING_MEASURE: "measure",
  RESOLUTION: "resolution",
  TRIGGER: "trigger",
  COST: "cost",
} as const;

/** The token whose shape is `shape` in a shape map (the M5 token comes from the map's own key, never a literal). */
export function tokenOf<M extends Readonly<Record<string, string>>>(
  map: M,
  shape: M[keyof M],
): string {
  const hit = Object.keys(map).find((k) => map[k] === shape);
  if (hit === undefined) throw new Error(`no token for ${String(shape)}`);
  return hit;
}
export function shapeOf<M extends Readonly<Record<string, string>>>(
  map: M,
  token: unknown,
): M[keyof M] | null {
  return typeof token === "string" &&
    Object.prototype.hasOwnProperty.call(map, token)
    ? (map[token] as M[keyof M])
    : null;
}

/** Plain words → the lowerCamel name a parameter is stored under ("Damage dice" → "damageDice"). */
export function asParameterName(words: string): string {
  const parts = words.replace(/[^A-Za-z0-9]+/g, " ").trim().split(" ").filter(Boolean);
  // A name starts with a letter: leading digits are dropped ("2 extra targets" → "extraTargets").
  while (parts.length > 0 && /^[0-9]/.test(parts[0] as string)) {
    const rest = (parts[0] as string).replace(/^[0-9]+/, "");
    if (rest === "") parts.shift();
    else parts[0] = rest;
  }
  if (parts.length === 0) return "";
  const [first, ...rest] = parts as [string, ...string[]];
  const name = first.charAt(0).toLowerCase() + first.slice(1) + rest.map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join("");
  return name.slice(0, 64);
}
/** A stored lowerCamel name in words ("damageDice" → "Damage dice"). */
export function parameterWords(name: string): string {
  const spaced = name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/_/g, " ")
    .toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}
/** A token in words ("ROLL_QUALITY" → "Roll quality"). */
export function tokenWords(token: string): string {
  return token.charAt(0) + token.slice(1).toLowerCase().replace(/_/g, " ");
}

/** A stable new key not yet used (`cost.1`, `cost.2` …) — authors never type contribution keys. */
export function nextKey(existing: readonly string[], prefix: string): string {
  for (let i = 1; ; i++)
    if (!existing.includes(`${prefix}.${i}`)) return `${prefix}.${i}`;
}

export const asArray = (v: unknown): Array<Record<string, unknown>> =>
  Array.isArray(v)
    ? (v.filter((x) => x !== null && typeof x === "object") as Array<
        Record<string, unknown>
      >)
    : [];
export const asObject = (v: unknown): Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};

/** The declared parameters (name + shape) of a parameter list. */
export function declaredParameters(
  parameters: unknown,
): { name: string; shape: ParameterShape | null; allowed: string[] }[] {
  return asArray(parameters).map((p) => ({
    name: typeof p.parameter === "string" ? p.parameter : "",
    shape: shapeOf(PARAMETER_SHAPES, p.kind),
    allowed: Array.isArray(p.allowed)
      ? (p.allowed.filter((a) => typeof a === "string") as string[])
      : [],
  }));
}

/**
 * Renames a parameter everywhere this payload names it: listed costs, outcome operations (`…Parameter` fields), Trait
 * modifications and an Ability Condition's choice — so renaming a choice never silently breaks what reads it.
 */
export function renameParameterReferences(
  payload: Payload,
  from: string,
  to: string,
): Payload {
  if (from === "" || from === to) return payload;
  const costs = asArray(payload.costContributions).map((c) => {
    const data = asObject(c.data);
    return data.parameter === from
      ? { ...c, data: { ...data, parameter: to } }
      : c;
  });
  const outcomes = asArray(payload.outcomes).map((o) => {
    const data = asObject(o.data);
    const ops = asArray(data.operations).map((op) => {
      const d = asObject(op.data);
      const next = Object.fromEntries(
        Object.entries(d).map(([k, v]) => [
          k,
          /Parameter$/.test(k) && v === from ? to : v,
        ]),
      );
      return { ...op, data: next };
    });
    return { ...o, data: { ...data, operations: ops } };
  });
  const rules = asObject(payload.rules);
  const trait = asObject(rules.trait);
  const condition = asObject(rules.condition);
  const nextRules: Record<string, unknown> = { ...rules };
  if (rules.trait !== undefined)
    nextRules.trait = {
      ...trait,
      modifications: asArray(trait.modifications).map((m) =>
        m.parameter === from ? { ...m, parameter: to } : m,
      ),
    };
  if (
    rules.condition !== undefined &&
    asObject(condition.choice).parameter === from
  )
    nextRules.condition = {
      ...condition,
      choice: { ...asObject(condition.choice), parameter: to },
    };
  return {
    ...payload,
    ...(payload.costContributions !== undefined
      ? { costContributions: costs }
      : {}),
    ...(payload.outcomes !== undefined ? { outcomes } : {}),
    rules: nextRules,
  };
}

/** A game-language summary of one listed cost (for the editor's own preview line and the read-only view). */
export function costWords(cost: Record<string, unknown>): string {
  const data = asObject(cost.data);
  const currency = typeof cost.currency === "string" ? cost.currency : "?";
  const shape = shapeOf(COST_SHAPES, data.kind);
  const amount = typeof data.amount === "number" ? data.amount : "?";
  if (shape === "fixed") return `${amount} ${currency}`;
  if (shape === "perNumber") {
    const free =
      typeof data.includedUnits === "number" && data.includedUnits > 0
        ? ` after the first ${data.includedUnits}`
        : "";
    return `${amount} ${currency} for each ${parameterWords(String(data.parameter ?? "?")).toLowerCase()}${free}`;
  }
  if (shape === "perOption") {
    const amounts = Object.entries(asObject(data.amounts)).map(
      ([k, v]) => `${tokenWords(k)} ${String(v)} ${currency}`,
    );
    return `depends on ${parameterWords(String(data.parameter ?? "?")).toLowerCase()}: ${amounts.join(", ") || "no amounts yet"}`;
  }
  return "a cost not yet described";
}

/** The Trait family a Trait kind's branch implies (no branch → shared). */
export const TRAIT_FAMILY_SHAPES = {
  SHARED: "shared",
  SPELL: "spell",
  MANEUVER: "maneuver",
} as const;
export function traitFamilyFor(branch: string | null | undefined): string {
  return branch ?? tokenOf(TRAIT_FAMILY_SHAPES, "shared");
}

/** The `rules.effect` record a new executable Effect starts from (shape only; every value is the author's). */
export function initialEffectRules(
  branch: string,
  ownPolicy: string = tokenOf(RESOLUTION_POLICY_SHAPES, "own"),
): Record<string, unknown> {
  return {
    branch,
    effectSubfamily: null,
    targetCategories: [],
    resolutionPolicy: ownPolicy,
    attackType: null,
    saveProfile: null,
    parameters: [],
    formulas: [],
    duration: {
      allowed: [],
      default: null,
      sustainEligible: false,
      manaLockEligible: false,
    },
    targetingConversion: null,
    restrictions: [],
  };
}
/** The `rules.trait` record a new executable Trait starts from. */
export function initialTraitRules(family: string): Record<string, unknown> {
  return {
    family,
    name: "",
    description: "",
    parameters: [],
    modifications: [],
    effectFamilies: [],
    foundationCategories: [],
    incompatibleTraits: [],
    affinity: null,
  };
}
/** A new component payload of the guided editors (every M5 field present; nothing chosen). */
/** RULES-WO1 Phase G: every Ability component contract with a guided mechanics editor. */
export type MechanicsContract = "effect" | "trait" | "targeting" | "duration" | "condition" | "foundation";

export function initialComponentPayload(
  contract: MechanicsContract,
  branch: string | null | undefined,
): Record<string, unknown> {
  const common = {
    keywords: [],
    compatibility: [],
    costContributions: [],
    parameters: {},
  };
  if (contract === "targeting") return { ...common, semanticShape: "", geometry: {}, rules: {} };
  if (contract === "duration") return { ...common, durationConcept: "", rules: {} };
  if (contract === "condition") return { ...common, restriction: { restrictionKey: "", data: {} }, tradeoff: {}, rules: {} };
  if (contract === "foundation") return { ...common, foundationKind: "", rules: {} };
  return contract === "effect"
    ? {
        ...common,
        effectFamily: "",
        resolution: null,
        outcomes: [],
        rules: { effect: initialEffectRules(branch ?? "") },
      }
    : {
        ...common,
        traitFamily: "",
        scope: "",
        rules: { trait: initialTraitRules(traitFamilyFor(branch)) },
      };
}

/** A game-language reading of a stored Effect or Trait, line by line (read-only views; nothing is computed). */
export function mechanicsSummary(
  payload: Record<string, unknown>,
  contract: MechanicsContract,
): string[] {
  if (contract !== "effect" && contract !== "trait") return componentRulesSummary(payload, contract);
  const rules = asObject(payload.rules);
  const lines: string[] = [];
  const choices = (list: unknown) =>
    asArray(list).map((p) => {
      const name = parameterWords(String(p.parameter ?? "?"));
      const shape = shapeOf(PARAMETER_SHAPES, p.kind);
      if (shape === "list")
        return `${name}: one of ${(Array.isArray(p.allowed) ? (p.allowed as string[]) : []).map(tokenWords).join(", ")}`;
      if (shape === "yesno") return `${name}: yes or no`;
      const max = asObject(p.maximum);
      const top =
        p.maximum == null
          ? "no limit"
          : shapeOf(LIMIT_SHAPES, max.kind) === "stat"
            ? `up to ${String(max.stat)}`
            : `up to ${String(max.value)}`;
      return `${name}: a number from ${String(p.minimum ?? 0)}, ${top}`;
    });
  if (contract === "effect") {
    const effect = asObject(rules.effect);
    const resolution = asObject(payload.resolution);
    lines.push(
      `Does: ${tokenWords(String(payload.effectFamily ?? "?"))}${typeof effect.effectSubfamily === "string" ? ` (${tokenWords(effect.effectSubfamily)})` : ""}`,
    );
    if (
      Array.isArray(effect.targetCategories) &&
      effect.targetCategories.length > 0
    )
      lines.push(
        `Can affect: ${(effect.targetCategories as string[]).map(tokenWords).join(", ")}`,
      );
    lines.push(
      `Resolves by: ${payload.resolution == null ? (shapeOf(RESOLUTION_POLICY_SHAPES, effect.resolutionPolicy) === "inherit" ? "the Maneuver's own roll" : "not set") : (MODE_WORDS[String(resolution.mode)] ?? String(resolution.mode))}`,
    );
    for (const c of choices(effect.parameters)) lines.push(`Choice — ${c}`);
    for (const o of asArray(payload.outcomes))
      for (const op of asArray(asObject(o.data).operations))
        lines.push(
          `${OUTCOME_WORDS[String(o.outcomeKey)] ?? String(o.outcomeKey)}: ${OPERATION_WORDS[String(op.kind)] ?? String(op.kind)}`,
        );
  } else {
    const trait = asObject(rules.trait);
    if (typeof trait.name === "string" && trait.name !== "")
      lines.push(`Trait: ${trait.name}`);
    for (const c of choices(trait.parameters)) lines.push(`Choice — ${c}`);
    for (const m of asArray(trait.modifications))
      lines.push(
        `Changes: ${TRAIT_MODIFICATION_WORDS[String(m.kind)] ?? String(m.kind)}`,
      );
  }
  for (const c of asArray(payload.costContributions))
    lines.push(`Costs: ${costWords(c)}`);
  return lines;
}

// ---- RULES-WO1 Phase G: Targeting, Duration, Ability Condition and Foundation components ------------------------------

/** Which control a Targeting parameter kind is edited with (the Targeting grammar: COUNT / STEPS / FLAG / TOKEN). */
export const TARGETING_PARAMETER_SHAPES = { COUNT: "number", STEPS: "steps", FLAG: "yesno", TOKEN: "list" } as const;
export const TARGETING_PARAMETER_WORDS: Readonly<Record<string, string>> = { number: "A number (for example extra targets)", steps: "A size step (each step extends a distance)", yesno: "Yes or no", list: "One option from a list" };
export const CARDINALITY_SHAPES = { ONE: "one", SELECTED: "selected", AREA: "area", CHAIN: "chain" } as const;
export const CARDINALITY_WORDS: Readonly<Record<string, string>> = { ONE: "One target", SELECTED: "Several targets, chosen one by one", AREA: "Everything in an area", CHAIN: "A chain from target to target" };
/** What a range model needs: nothing, a distance (an M4 Formula, composed by the server) or written text. */
export const RANGE_SHAPES = { SELF: "none", TOUCH: "none", DEFAULT_SPELL_RANGE: "distance", FOUNDATION_RANGE: "none", FIXED: "distance", EFFECT_DEFINED: "none", SPECIAL: "text" } as const;
export const RANGE_WORDS: Readonly<Record<string, string>> = { SELF: "Self only", TOUCH: "Touch", DEFAULT_SPELL_RANGE: "The caster's Spell range", FOUNDATION_RANGE: "The foundation's own range or reach", FIXED: "A stated distance", EFFECT_DEFINED: "Set by the Effect", SPECIAL: "A special rule (written)" };
export const MEASURE_STATUS_SHAPES = { FORMULA: "distance", DEFERRED_PENDING_CANON: "deferred", EFFECT_DEFINED: "effect" } as const;
export const MEASURE_STATUS_WORDS: Readonly<Record<string, string>> = { FORMULA: "A stated distance", DEFERRED_PENDING_CANON: "Not yet settled by the rules (open question)", EFFECT_DEFINED: "Set by the Effect" };
export const TARGETING_COST_SHAPES = { BASE: "base", BASE_DEFERRED: "deferred", PER_STEP: "perStep", PER_ADDITIONAL_TARGET: "perTarget", PER_SELECTION: "perSelection" } as const;
export const TARGETING_COST_WORDS: Readonly<Record<string, string>> = { BASE: "Its base MP cost", BASE_DEFERRED: "Base cost not yet settled (open question)", PER_STEP: "MP for each size step", PER_ADDITIONAL_TARGET: "MP for each additional target", PER_SELECTION: "MP when an option is chosen" };
/** Which Formula input kinds a Targeting distance may read. */
export const TARGETING_SOURCE_SHAPES = { STAT: "stat", DERIVED: "derived", PARAMETER: "steps", SKILL_RANK_TABLE: "table" } as const;
/** A Duration's inert future-runtime markers follow from its concept (the reader checks they agree). */
export const DURATION_RUNTIME_SHAPES = { SUSTAINED: "sustained", MANA_LOCK: "manaLock", INSTANT: "instant" } as const;
export const DURATION_CONCENTRATION_SHAPES = { NONE: "none", WO13: "concentration" } as const;
export const AVAILABILITY_SHAPES = { EXECUTABLE: "executable", DEFERRED: "deferred" } as const;
export const DURATION_COST_STATUS_SHAPES = { UNLISTED: "unlisted", AUTHORED: "authored" } as const;
/** The implicit choice a Duration concept carries (a ROUNDS Duration is priced per round). */
export const DURATION_IMPLICIT_PARAMETERS: Readonly<Record<string, readonly Record<string, unknown>[]>> = { ROUNDS: [{ parameter: "rounds", kind: tokenOf(PARAMETER_SHAPES, "number"), minimum: 1, maximum: null, increment: 1, default: null }] };
export const CONDITION_MEANING_WORDS: Readonly<Record<string, string>> = { MP_PERCENT_REDUCTION: "Reduces the MP cost by this percentage", AP_REDUCTION: "Reduces the AP cost", MP_REDUCTION: "Reduces the MP cost", AP_COMMITMENT: "Commits extra AP" };
export const CHOICE_SHAPES = { ALL: "all", CHOOSE_ONE: "one" } as const;
/** The construction facts an Ability Condition's applicability may read, by the fact's last word (e.g. mechanic.attack). */
export const MECHANIC_FACT_WORDS: Readonly<Record<string, string>> = {
  present: "Always (no further condition)",
  attack: "The ability makes an attack roll",
  save: "The ability calls for a Saving Throw",
  area: "The ability affects an area",
  sustained: "The ability is Sustained",
  duration: "The ability lasts",
  targets: "The ability can target",
  effects: "The ability includes an Effect of the family",
  foundations: "The ability uses a foundation of the category",
};
/** The catalog list a set fact's members come from (none = typed in plain words). */
export const MECHANIC_SET_MEMBERS: Readonly<Record<string, string | null>> = { duration: "durationConcepts", targets: "targetCategories", effects: "spellEffectFamilies", foundations: null };
export const factWord = (factKey: string): string => factKey.split(".").pop() ?? factKey;
/** The M4 Requirement node shapes the guided component editors build (a compiled-fact check or an ALL / ANY group). */
export const REQUIREMENT_SHAPES = { NUMERIC_COMPARE: "compare", SET_CONTAINS: "includes", ALL: "all", ANY: "any" } as const;
/** Which resource each Ability Condition contribution meaning is paid in (the reader refuses a mismatch). */
export const CONDITION_MEANING_CURRENCY: Readonly<Record<string, "ap" | "mp">> = { MP_PERCENT_REDUCTION: "mp", MP_REDUCTION: "mp", AP_REDUCTION: "ap", AP_COMMITMENT: "ap" };
/** The meanings a Maneuver Condition may use (listed AP or MP reductions only). */
export const MANEUVER_CONDITION_MEANINGS: Readonly<Record<string, true>> = { AP_REDUCTION: true, MP_REDUCTION: true };
export const CURRENCY_SHAPES = { AP: "ap", MP: "mp" } as const;
export const FOUNDATION_ACTION_WORDS: Readonly<Record<string, string>> = { MOVEMENT: "A movement", DEFENSE: "A defence (block or guard)", INTERACTION: "An interaction" };

/** A game-language reading of a stored Targeting, Duration, Ability Condition or Foundation (read-only). */
export function componentRulesSummary(payload: Record<string, unknown>, contract: "targeting" | "duration" | "condition" | "foundation"): string[] {
  const rules = asObject(payload.rules);
  const lines: string[] = [];
  if (contract === "targeting") {
    const t = asObject(rules.targeting);
    const shape = payload.semanticShape;
    if (typeof shape === "string") lines.push(`Shape: ${tokenWords(shape)}`);
    if (typeof t.deliveryFamily === "string") lines.push(`Delivered by: ${tokenWords(t.deliveryFamily)}`);
    const c = asObject(t.cardinality);
    if (typeof c.kind === "string") lines.push(`Targets: ${CARDINALITY_WORDS[c.kind] ?? tokenWords(c.kind)}`);
    const r = asObject(t.range);
    if (typeof r.model === "string") lines.push(`Range: ${RANGE_WORDS[r.model] ?? tokenWords(r.model)}${r.formula ? ` (${String(asObject(r.formula).expression ?? "")} ft)` : ""}`);
    for (const m of asArray(t.measures)) lines.push(`${tokenWords(String(m.measure))}: ${MEASURE_STATUS_WORDS[String(m.valueStatus)] ?? String(m.valueStatus)}${m.formula ? ` (${String(asObject(m.formula).expression ?? "")} ft)` : ""}`);
    for (const p of asArray(t.parameters)) lines.push(`Choice — ${parameterWords(String(p.parameter ?? "?"))}: ${TARGETING_PARAMETER_WORDS[String(shapeOf(TARGETING_PARAMETER_SHAPES, p.kind))] ?? String(p.kind)}`);
    for (const k of asArray(payload.costContributions)) {
      const d = asObject(k.data);
      lines.push(`Costs: ${TARGETING_COST_WORDS[String(d.kind)] ?? String(d.kind)}${typeof d.amount === "number" ? ` — ${d.amount} MP` : ""}`);
    }
  } else if (contract === "duration") {
    const d = asObject(rules.duration);
    if (typeof payload.durationConcept === "string") lines.push(`Lasts: ${tokenWords(payload.durationConcept)}`);
    if (shapeOf(AVAILABILITY_SHAPES, d.availability) === "deferred") lines.push(`Waits on: ${String(d.deferralKey ?? "?")}`);
    lines.push(shapeOf(DURATION_COST_STATUS_SHAPES, d.costStatus) === "authored" ? "Cost: listed" : "Cost: not listed");
    for (const k of asArray(payload.costContributions)) lines.push(`Costs: ${costWords(k)}`);
  } else if (contract === "condition") {
    const c = asObject(rules.condition);
    const restriction = asObject(payload.restriction);
    if (typeof restriction.restrictionKey === "string") lines.push(`Restriction: ${tokenWords(restriction.restrictionKey)}`);
    if (shapeOf(AVAILABILITY_SHAPES, c.availability) === "deferred") lines.push(`Waits on: ${String(c.deferralKey ?? "?")}`);
    for (const r of asArray(c.runtimeRequirements)) lines.push(`Checked in play (not yet run): ${tokenWords(String(r.requirementKey ?? "?"))}`);
    for (const k of asArray(payload.costContributions)) {
      const d = asObject(k.data);
      lines.push(`Benefit: ${CONDITION_MEANING_WORDS[String(d.modifier)] ?? String(d.modifier)} — ${costWords(k)}${typeof d.option === "string" ? ` (${tokenWords(d.option)})` : ""}`);
    }
  } else {
    if (typeof payload.foundationKind === "string") lines.push(`Foundation: ${tokenWords(payload.foundationKind)}`);
    const action = asObject(rules.action);
    if (typeof action.category === "string") lines.push(`Action: ${FOUNDATION_ACTION_WORDS[action.category] ?? tokenWords(action.category)}`);
    if (rules.attack !== undefined) lines.push("Bound to an exact Weapon Attack");
    for (const k of asArray(payload.costContributions)) lines.push(`Costs: ${costWords(k)}`);
  }
  return lines;
}
