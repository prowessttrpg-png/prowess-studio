import { DomainError, PROWESS_MATERIALIZATION_ERROR_CODES } from "@prowess/model";
import type { RulesetContext } from "@prowess/rules";
import {
  createProwessDefinitionBundle,
  readStoredProwessDefinition,
  type ProwessDefinitionBundle,
  type ProwessDefinitionEnvelope,
} from "@prowess/game";
import { resolveRulesetContextFromManifest, resolveRulesetContextFromRelease } from "../ruleset-context/index.js";
import { selectPinnedEntityVersionContent } from "./repository.js";

/**
 * Exact Prowess Definition materialization (PAS-10 M5-WO1 §88–92) — server / application data code.
 *
 *   Exact RulesetContext → pinned EntityVersion ids → exact structured EntityVersions → ProwessDefinitionBundle
 *
 * The materializer is NOT a resolver: M2 / M4-WO2 already decided which exact versions a Manifest or Release contains
 * (resolveRulesetContextFromManifest / FromRelease), and this module only LOADS those exact versions. It never selects
 * by recency, Canon, display name, alias or canonical key; it never compiles (M5-I008, M5-I010, M5-I027). Read-only.
 *
 * Pinned versions without a stored Prowess Definition (generic rule content) are simply not part of the bundle. A
 * pinned version that cannot be loaded, or whose stored Definition is malformed, fails closed — nothing is skipped
 * or repaired.
 */
export async function materializeProwessDefinitionBundle(ruleset: RulesetContext): Promise<ProwessDefinitionBundle> {
  const rows = await selectPinnedEntityVersionContent(ruleset.rules.map((rule) => rule.entityVersionId));
  const byId = new Map(rows.map((row) => [row.id, row]));
  const definitions: ProwessDefinitionEnvelope[] = [];
  for (const rule of ruleset.rules) {
    const row = byId.get(rule.entityVersionId);
    if (row === undefined || row.entityId !== rule.entityId) {
      throw new DomainError(PROWESS_MATERIALIZATION_ERROR_CODES.PINNED_VERSION_MISSING, `Pinned EntityVersion ${rule.entityVersionId} of Entity ${rule.entityId} could not be loaded exactly`);
    }
    const reading = readStoredProwessDefinition({ ruleset, rule, structuredData: row.structuredData });
    if (!reading.ok) {
      const detail = reading.problems.map((p) => `${p.code} at ${p.path || "/"}: ${p.message}`).join("; ");
      throw new DomainError(PROWESS_MATERIALIZATION_ERROR_CODES.INVALID_STORED_DEFINITION, `EntityVersion ${rule.entityVersionId} holds an invalid Prowess Definition — ${detail}`);
    }
    if (reading.value.kind === "DEFINITION") definitions.push(reading.value.envelope);
  }
  const bundle = createProwessDefinitionBundle({ ruleset, definitions });
  if (!bundle.ok) {
    throw new DomainError(PROWESS_MATERIALIZATION_ERROR_CODES.INVALID_BUNDLE, bundle.problems.map((p) => `${p.code} at ${p.path}: ${p.message}`).join("; "));
  }
  return bundle.value;
}

/** Development / playtest: the exact Manifest's resolved context (M4-WO2) and its exact Definition bundle. */
export async function materializeProwessDefinitionsFromManifest(manifestId: string): Promise<{ ruleset: RulesetContext; bundle: ProwessDefinitionBundle }> {
  const ruleset = await resolveRulesetContextFromManifest(manifestId);
  return { ruleset, bundle: await materializeProwessDefinitionBundle(ruleset) };
}

/** Published / historical: the exact Release's integrity-verified frozen context (M4-WO2) and its exact bundle. */
export async function materializeProwessDefinitionsFromRelease(releaseId: string): Promise<{ ruleset: RulesetContext; bundle: ProwessDefinitionBundle }> {
  const ruleset = await resolveRulesetContextFromRelease(releaseId);
  return { ruleset, bundle: await materializeProwessDefinitionBundle(ruleset) };
}
