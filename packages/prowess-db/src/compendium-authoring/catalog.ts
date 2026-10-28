import {
  ABILITY_COMPONENT_CONTRACTS,
  CANONICAL_AFFINITIES,
  COST_CURRENCIES,
  DURATION_CONCEPTS,
  PROWESS_DEFINITION_KINDS,
  PROWESS_DEFINITION_KIND_NAMES,
  PROWESS_SYSTEM_FAMILIES,
  RESOLUTION_MODES,
  TARGETING_SEMANTIC_SHAPES,
  TERMINOLOGY_INVENTORY,
  TRAIT_SCOPES,
  isProwessDefinitionKind,
  type ProwessDefinitionKind,
} from "@prowess/game";

/**
 * The Compendium authoring catalog (PAS-10 M6-WO1 §8, §40) — a read-only PROJECTION of the certified M5 Definition
 * registry, never a second list. Every row is computed from `PROWESS_DEFINITION_KINDS`; every option list is an M5
 * vocabulary constant passed through unchanged. Nothing here decides legality: the M5 contract does, at validation.
 *
 * A kind is AUTHORABLE exactly when M5 supports at least one payload schema version for it. A kind with
 * `schemaVersions: []` is known but RESERVED — its payload contract belongs to a later Work Order — so authoring
 * fails closed for it (§55) instead of guessing a shape.
 */
export interface AuthoringDefinitionKind {
  readonly definitionKind: ProwessDefinitionKind;
  readonly systemFamily: string;
  readonly branch: string | null;
  readonly sharedContract: string | null;
  readonly allowedEntityTypes: readonly string[];
  readonly supportedSchemaVersions: readonly number[];
  /** The highest supported payload version — what a NEW Definition of this kind is authored at. Null when reserved. */
  readonly authoringSchemaVersion: number | null;
  readonly authorable: boolean;
}

export interface AuthoringCatalog {
  readonly kinds: readonly AuthoringDefinitionKind[];
  readonly systemFamilies: readonly string[];
  /** M5 vocabularies the authoring descriptors render as option lists — values verbatim from @prowess/game. */
  readonly vocabularies: Readonly<Record<string, readonly string[]>>;
  /** Inventoried LEGACY → CANONICAL terminology pairs: the only legacy terms provenance may record (§68). */
  readonly legacyTerms: readonly { readonly legacyTerm: string; readonly canonicalTerm: string }[];
}

function kindRow(kind: ProwessDefinitionKind): AuthoringDefinitionKind {
  const spec = PROWESS_DEFINITION_KINDS[kind];
  const versions = [...spec.schemaVersions].sort((a, b) => a - b);
  return {
    definitionKind: kind,
    systemFamily: spec.family,
    branch: spec.branch,
    sharedContract: spec.contract,
    allowedEntityTypes: [...spec.entityTypes],
    supportedSchemaVersions: versions,
    authoringSchemaVersion: versions.length === 0 ? null : (versions[versions.length - 1] as number),
    authorable: versions.length > 0,
  };
}

export function getAuthoringCatalog(): AuthoringCatalog {
  return {
    kinds: PROWESS_DEFINITION_KIND_NAMES.map(kindRow),
    systemFamilies: [...PROWESS_SYSTEM_FAMILIES],
    vocabularies: {
      targetingSemanticShapes: [...TARGETING_SEMANTIC_SHAPES],
      resolutionModes: [...RESOLUTION_MODES],
      traitScopes: [...TRAIT_SCOPES],
      durationConcepts: [...DURATION_CONCEPTS],
      costCurrencies: [...COST_CURRENCIES],
      canonicalAffinities: [...CANONICAL_AFFINITIES],
      componentContracts: [...ABILITY_COMPONENT_CONTRACTS],
    },
    legacyTerms: TERMINOLOGY_INVENTORY.filter((t) => t.status === "LEGACY" && t.canonicalTerm !== null)
      .map((t) => ({ legacyTerm: t.term, canonicalTerm: t.canonicalTerm as string }))
      .sort((a, b) => (a.legacyTerm < b.legacyTerm ? -1 : a.legacyTerm > b.legacyTerm ? 1 : 0)),
  };
}

/** The catalog row of a kind, or null when the value is not an M5 Definition kind at all. */
export function authoringKind(kind: unknown): AuthoringDefinitionKind | null {
  return isProwessDefinitionKind(kind) ? kindRow(kind) : null;
}
