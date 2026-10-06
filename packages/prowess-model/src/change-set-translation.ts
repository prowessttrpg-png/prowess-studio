import type { CanonConflictDisposition } from "./canon-conflict-disposition.js";
import type { CanonDecisionType } from "./canon-decision-type.js";
import type { CreateChangeSetOperationInput } from "./change-set.js";
import type { RulesetResolutionSource } from "./ruleset-resolution.js";

/**
 * Deterministic translation of a CanonDecision into proposed operations (PAS-10 M2-WO7 §15–§21).
 * PURE: it reads nothing and writes nothing; the caller supplies the facts.
 *
 * A decision that names exactly ONE governance-chosen Version (SELECT_RULE's selected candidate, or
 * MERGE's result) maps to one manifest-composition proposal for the conflict's Entity:
 *
 *   no target manifest                       -> PIN_ENTITY_VERSION      (Entity -> chosen)
 *   target manifest has no effective pin     -> ADD_ENTITY_TO_MANIFEST  (Entity -> chosen)
 *   effective pin is already the chosen one  -> NO_CHANGE
 *   effective pin is another Version         -> REPLACE_ENTITY_VERSION  (effective -> chosen)
 *
 * "Effective" is M2-WO3 resolution, so a pin INHERITED from a parent manifest is replaced by a proposal
 * for a future manifest of the target's own Ruleset — the parent is never the target of a change.
 *
 * Every other decision maps to NO_CHANGE and never infers a winner:
 *   KEEP_SEPARATE (accepted divergence needs a deliberate later composition choice),
 *   RESOLVE_CONFLICT (its selections are citations, not a chosen Version),
 *   and any DISMISSED disposition.
 */
export interface DecisionTranslationFacts {
  decisionId: string;
  decisionType: CanonDecisionType;
  conflictDisposition: CanonConflictDisposition;
  /** The conflict's Entity. */
  entityId: string;
  /** SELECT_RULE: the selected candidate's Version; MERGE: the result Version; otherwise null. */
  chosenEntityVersionId: string | null;
  targetManifestId: string | null;
  /** The target manifest's EFFECTIVE pin for the Entity (null = none, or no target manifest). */
  effective: { entityVersionId: string; resolvedFromManifestId: string; source: RulesetResolutionSource } | null;
}

export function translateDecisionToOperations(facts: DecisionTranslationFacts): CreateChangeSetOperationInput[] {
  const by = `Proposed from CanonDecision ${facts.decisionId} (${facts.decisionType}, ${facts.conflictDisposition})`;
  const manifest = facts.targetManifestId;
  const noChange = (why: string): CreateChangeSetOperationInput[] => [
    { operationType: "NO_CHANGE", targetManifestId: manifest, description: `${by}: ${why}` },
  ];

  const namesOneVersion = facts.decisionType === "SELECT_RULE" || facts.decisionType === "MERGE";
  if (facts.conflictDisposition === "DISMISSED") return noChange("the conflict was dismissed; no repository/ruleset change is proposed.");
  if (facts.decisionType === "KEEP_SEPARATE") {
    return noChange("accepted divergence; mapping each interpretation into a Ruleset composition is a later, deliberate choice.");
  }
  if (!namesOneVersion || facts.chosenEntityVersionId === null) {
    return noChange("the decision does not identify one exact chosen Version; no winner is inferred.");
  }

  const chosen = facts.chosenEntityVersionId;
  if (manifest === null) {
    return [{ operationType: "PIN_ENTITY_VERSION", targetEntityId: facts.entityId, toEntityVersionId: chosen, description: `${by}: pin the chosen Version in a future manifest.` }];
  }
  if (facts.effective === null) {
    return [
      {
        operationType: "ADD_ENTITY_TO_MANIFEST",
        targetEntityId: facts.entityId,
        toEntityVersionId: chosen,
        targetManifestId: manifest,
        description: `${by}: the target manifest has no effective pin for this Entity; add the chosen Version in a future manifest.`,
      },
    ];
  }
  if (facts.effective.entityVersionId === chosen) {
    return noChange(`the target manifest already resolves the chosen Version (${facts.effective.source}).`);
  }
  const inherited =
    facts.effective.source === "INHERITED"
      ? ` The current pin is INHERITED from manifest ${facts.effective.resolvedFromManifestId}; the proposal is an override in a future manifest of the target's Ruleset — the parent is unchanged.`
      : "";
  return [
    {
      operationType: "REPLACE_ENTITY_VERSION",
      targetEntityId: facts.entityId,
      fromEntityVersionId: facts.effective.entityVersionId,
      toEntityVersionId: chosen,
      targetManifestId: manifest,
      description: `${by}: replace the effective Version with the chosen one in a future manifest.${inherited}`,
    },
  ];
}
