/**
 * Authoring descriptors (PAS-10 M6-WO1 §12–13, §28, §59) — a PRESENTATION layer that tells the editor how to render the
 * structured fields of a Prowess Definition payload: label, grouping, input type, which M5 vocabulary supplies a
 * select's options, required / optional state, help text, collection behavior and where exact Definition references are
 * expected.
 *
 * A descriptor DESCRIBES the M5 contract; it never decides legality (M6-I002 / M6-I003). It holds no option VALUES
 * (they come from the catalog endpoint, i.e. the M5 domain package's own vocabularies), no numbers, costs, formulas or rules:
 * the M5 validation boundary is the only authority on what is legal. Descriptors are keyed by the M5 SHARED CONTRACT
 * name the catalog reports for each kind, so Spell and Maneuver kinds of the same contract render the same way while
 * remaining different Definition kinds.
 *
 * Opaque M5 sub-objects (`parameters`, `rules`, `geometry`, `data`, `tradeoff` …) are edited with the structured
 * authored-data editor — never as a raw JSON text box — and their content is validated by M5 like everything else.
 */

/** Names a vocabulary in the catalog response (`catalog.vocabularies[name]`) — never the values themselves. */
export type VocabularyName = "targetingSemanticShapes" | "resolutionModes" | "traitScopes" | "durationConcepts" | "costCurrencies" | "canonicalAffinities" | "componentContracts";

interface FieldBase {
  /** The payload key this field edits. */
  readonly key: string;
  readonly label: string;
  readonly group: string;
  readonly required: boolean;
  readonly help?: string;
}

export type FieldDescriptor =
  | (FieldBase & { readonly input: "select"; readonly vocabulary: VocabularyName })
  | (FieldBase & { readonly input: "token"; readonly placeholder?: string })
  | (FieldBase & { readonly input: "keywords" })
  | (FieldBase & { readonly input: "compatibility" })
  | (FieldBase & { readonly input: "costContributions" })
  | (FieldBase & { readonly input: "outcomes" })
  | (FieldBase & { readonly input: "resolution" })
  | (FieldBase & { readonly input: "restriction" })
  | (FieldBase & { readonly input: "authoredData" });

export interface ContractDescriptor {
  /** Short explanation of what this kind of Definition is FOR (§59) — presentation only. */
  readonly purpose: string;
  readonly fields: readonly FieldDescriptor[];
}

const KEYWORDS: FieldDescriptor = {
  key: "keywords",
  label: "Keywords",
  group: "Keywords",
  input: "keywords",
  required: false,
  help: "Structured rules metadata: choose existing Keyword Definitions. Unknown Keywords fail validation — a Keyword never becomes a rule just because it is named here.",
};
const COMPATIBILITY: FieldDescriptor = {
  key: "compatibility",
  label: "Compatibility",
  group: "Compatibility",
  input: "compatibility",
  required: false,
  help: "Which components this Definition may combine with: a relation and the exact labels (canonical keys or vocabulary tokens) it allows.",
};
const COSTS: FieldDescriptor = {
  key: "costContributions",
  label: "Cost contributions",
  group: "Costs",
  input: "costContributions",
  required: false,
  help: "Authored cost data per currency. The editor never computes a cost — the Rules Engine does, from this data.",
};
const PARAMETERS: FieldDescriptor = { key: "parameters", label: "Parameters", group: "Rules data", input: "authoredData", required: false, help: "Authored parameter declarations for this component." };
const RULES: FieldDescriptor = {
  key: "rules",
  label: "Rules",
  group: "Rules data",
  input: "authoredData",
  required: false,
  help: "Structured rule data owned by the M5 contract for this kind. Everything that matters to the engine must be here — never only in Rules Text.",
};
const COMMON: readonly FieldDescriptor[] = [KEYWORDS, COMPATIBILITY, COSTS, PARAMETERS, RULES];

/** Descriptors per M5 SHARED CONTRACT (`sharedContract` in the catalog). */
export const CONTRACT_DESCRIPTORS: Readonly<Record<string, ContractDescriptor>> = {
  TARGETING: {
    purpose: "Targeting decides WHERE and HOW an ability is delivered — shape, geometry, range, count, placement. It never decides what happens: Damage, Healing, Saves and outcomes belong to Effects.",
    fields: [
      { key: "semanticShape", label: "Semantic shape", group: "Classification", input: "select", vocabulary: "targetingSemanticShapes", required: true, help: "A classifier of the geometry's meaning — never identity." },
      { key: "geometry", label: "Geometry", group: "Geometry", input: "authoredData", required: false, help: "Origin, range, area, count, delivery and placement data." },
      ...COMMON,
    ],
  },
  EFFECT: {
    purpose: "An Effect decides WHAT HAPPENS — its family, how it resolves and its outcomes. Effects carry the fullest mechanical data.",
    fields: [
      { key: "effectFamily", label: "Effect family", group: "Classification", input: "token", required: true, help: "The source-defined family token (SCREAMING_SNAKE_CASE)." },
      { key: "resolution", label: "Resolution", group: "Resolution & outcomes", input: "resolution", required: false, help: "How this Effect resolves (its own resolution) and the structured resolution data." },
      { key: "outcomes", label: "Outcomes", group: "Resolution & outcomes", input: "outcomes", required: false, help: "Named outcomes with their structured data." },
      ...COMMON,
    ],
  },
  TRAIT: {
    purpose: "A Trait MODIFIES an explicitly scoped part of an ability. It never becomes an independent Effect.",
    fields: [
      { key: "traitFamily", label: "Trait family", group: "Classification", input: "token", required: true },
      { key: "scope", label: "Scope", group: "Classification", input: "select", vocabulary: "traitScopes", required: true, help: "What the Trait applies to — never assumed ability-wide." },
      ...COMMON,
    ],
  },
  DURATION: {
    purpose: "A Duration describes how long an ability's result lasts, as exact structured Duration data.",
    fields: [{ key: "durationConcept", label: "Duration concept", group: "Classification", input: "select", vocabulary: "durationConcepts", required: true }, ...COMMON],
  },
  ABILITY_CONDITION: {
    purpose: "An Ability Condition is a restriction on USING an ability, traded for an authored benefit. It never applies a status to a target.",
    fields: [
      { key: "restriction", label: "Restriction", group: "Restriction & tradeoff", input: "restriction", required: true, help: "The restriction key (SCREAMING_SNAKE_CASE) and its structured data." },
      { key: "tradeoff", label: "Tradeoff", group: "Restriction & tradeoff", input: "authoredData", required: false, help: "The exact authored modifier data the restriction buys." },
      ...COMMON,
    ],
  },
  FOUNDATION: {
    purpose: "A Maneuver Foundation is the action a Maneuver starts from (the existing M5 Foundation contract).",
    fields: [{ key: "foundationKind", label: "Foundation kind", group: "Classification", input: "token", required: true }, ...COMMON],
  },
};

/** Version-1 AFFINITY: identity only (its canonical Affinity). Later versions use the generic editor. */
const AFFINITY_V1: ContractDescriptor = {
  purpose: "An Affinity identity. Canonical structured content uses the canonical Affinity (never a legacy term).",
  fields: [{ key: "affinity", label: "Affinity", group: "Classification", input: "select", vocabulary: "canonicalAffinities", required: true }],
};

/** Kinds without a dedicated descriptor: the whole payload is edited as structured authored data. */
export const GENERIC_DESCRIPTOR: ContractDescriptor = {
  purpose: "This kind has no dedicated authoring descriptor yet: author its payload as structured data. The M5 contract still validates every field.",
  fields: [{ key: "", label: "Payload", group: "Payload", input: "authoredData", required: true, help: "The complete payload for this Definition kind." }],
};

export function descriptorFor(kind: { definitionKind: string; sharedContract: string | null }, schemaVersion: number | null): ContractDescriptor {
  if (kind.sharedContract !== null && CONTRACT_DESCRIPTORS[kind.sharedContract] !== undefined) return CONTRACT_DESCRIPTORS[kind.sharedContract] as ContractDescriptor;
  if (kind.definitionKind === "AFFINITY" && schemaVersion === 1) return AFFINITY_V1;
  return GENERIC_DESCRIPTOR;
}

/** Field groups in first-appearance order. */
export function groupsOf(descriptor: ContractDescriptor): string[] {
  return [...new Set(descriptor.fields.map((f) => f.group))];
}

/** The empty value a field starts with in a new Definition (shape only — every value is the author's). */
export function initialFieldValue(field: FieldDescriptor): unknown {
  switch (field.input) {
    case "select":
    case "token":
      return "";
    case "keywords":
    case "compatibility":
    case "costContributions":
    case "outcomes":
      return [];
    case "resolution":
      return null;
    case "restriction":
      return { restrictionKey: "", data: {} };
    case "authoredData":
      return {};
  }
}

/** A new, empty payload for a descriptor (the generic descriptor's single field IS the payload). */
export function initialPayload(descriptor: ContractDescriptor): Record<string, unknown> {
  if (descriptor === GENERIC_DESCRIPTOR) return {};
  return Object.fromEntries(descriptor.fields.map((f) => [f.key, initialFieldValue(f)]));
}
