import {
  ChangeSetImpactCollector,
  type ChangeSetImpactReason,
  type ChangeSetImpactReport,
  type ChangeSetOperation,
} from "@prowess/model";
import {
  selectImpactGovernance,
  selectImpactKeywords,
  selectImpactRelationships,
  selectImpactSources,
  selectInheritingManifests,
  selectManifestNode,
} from "./repository.js";
import { getChangeSet } from "./service.js";

/**
 * Derived, READ-ONLY impact analysis of a ChangeSet (PAS-10 M2-WO7 §22–§35). Nothing is written and
 * nothing is persisted: the report is computed against the CURRENT database state on every call
 * (`derivation: "LIVE"`), while the ChangeSet itself is a historical snapshot. Repeating the analysis
 * against unchanged state returns an equal report (stable ordering, documented dedup).
 *
 * Impact means "review may be required" — never "changed" or "broken":
 *   - descendant manifests are POTENTIAL downstream impact; existing immutable manifests never change;
 *   - relationships are analyzed ONE hop only (manifest inheritance is the explicit exception);
 *   - keywords, sources and governance records are context; nothing is interpreted mechanically;
 *   - no rules-engine work (MP/AP/damage/spells/characters) happens — those systems do not exist yet.
 */
export async function analyzeChangeSetImpact(changeSetId: string): Promise<ChangeSetImpactReport> {
  const changeSet = await getChangeSet(changeSetId);
  const collector = new ChangeSetImpactCollector();
  const reason = (op: ChangeSetOperation | null, text: string, relationshipType: string | null = null): ChangeSetImpactReason => ({
    sourceOperationId: op === null ? null : op.id,
    sequence: op === null ? null : op.sequence,
    reason: text,
    relationshipType,
  });
  const label = (op: ChangeSetOperation) => `operation ${op.sequence} (${op.operationType})`;

  for (const op of changeSet.operations) {
    // DIRECT (§24)
    if (op.targetEntityId !== null) collector.add("DIRECT_ENTITY", "ENTITY", op.targetEntityId, reason(op, `target Entity of ${label(op)}`));
    if (op.fromEntityVersionId !== null) {
      collector.add("DIRECT_ENTITY_VERSION", "ENTITY_VERSION", op.fromEntityVersionId, reason(op, `"from" Version of ${label(op)}`));
    }
    if (op.toEntityVersionId !== null) {
      collector.add("DIRECT_ENTITY_VERSION", "ENTITY_VERSION", op.toEntityVersionId, reason(op, `"to" Version of ${label(op)}`));
    }

    // MANIFEST + INHERITING_MANIFEST (§25, §26) — only for operations that propose something about an Entity.
    if (op.targetManifestId !== null && op.targetEntityId !== null) {
      const manifest = await selectManifestNode(op.targetManifestId);
      if (manifest !== null) {
        collector.add("MANIFEST", "RULESET_MANIFEST", manifest.id, reason(op, `manifest analyzed by ${label(op)}; it is NOT edited — an applied change would create a new manifest`));
        collector.add("MANIFEST", "RULESET", manifest.rulesetId, reason(op, `Ruleset owning the manifest analyzed by ${label(op)}`));
        for (const descendant of await selectInheritingManifests(manifest.id)) {
          const text = `inherits (depth ${descendant.depth}) from manifest ${manifest.id} analyzed by ${label(op)}: POTENTIAL downstream impact; this existing manifest does not change`;
          collector.add("INHERITING_MANIFEST", "RULESET_MANIFEST", descendant.id, reason(op, text));
          collector.add("INHERITING_MANIFEST", "RULESET", descendant.rulesetId, reason(op, `owns inheriting manifest ${descendant.id} (depth ${descendant.depth}); potential downstream impact`));
        }
      }
    }

    // RELATIONSHIP_DEPENDENT_ENTITY (§27, §34): one hop, either direction.
    if (op.targetEntityId !== null) {
      for (const rel of await selectImpactRelationships(op.targetEntityId)) {
        const outgoing: boolean = rel.sourceEntityId === op.targetEntityId;
        const neighbour: string = outgoing ? rel.targetEntityId : rel.sourceEntityId;
        if (neighbour === op.targetEntityId) continue;
        const text = outgoing
          ? `target of ${label(op)} ${rel.relationshipType} this Entity (relationship ${rel.id}); review may be required`
          : `this Entity ${rel.relationshipType} the target of ${label(op)} (relationship ${rel.id}); review may be required`;
        collector.add("RELATIONSHIP_DEPENDENT_ENTITY", "ENTITY", neighbour, reason(op, text, rel.relationshipType));
      }
    }

    // KEYWORD_RELATED (§28) and SOURCE_PROVENANCE (§29): context only.
    const versions = [op.fromEntityVersionId, op.toEntityVersionId].filter((v): v is NonNullable<typeof v> => v !== null);
    if (op.targetEntityId !== null || versions.length > 0) {
      const { entityKeywords, versionKeywords } = await selectImpactKeywords(op.targetEntityId === null ? [] : [op.targetEntityId], versions);
      for (const k of entityKeywords) {
        collector.add("KEYWORD_RELATED", "KEYWORD_ASSIGNMENT", `${k.entityId}:${k.keywordId}`, reason(op, `keyword ${k.keyword.canonicalKey} on the target Entity of ${label(op)}`));
      }
      for (const k of versionKeywords) {
        collector.add(
          "KEYWORD_RELATED",
          "KEYWORD_ASSIGNMENT",
          `${k.entityVersionId}:${k.keywordId}`,
          reason(op, `keyword ${k.keyword.canonicalKey} on Version ${k.entityVersionId} of ${label(op)}`),
        );
      }
      for (const s of await selectImpactSources(versions)) {
        collector.add("SOURCE_PROVENANCE", "SOURCE_REFERENCE", s.id, reason(op, `provenance of Version ${s.entityVersionId} (SourceDocument ${s.sourceDocumentId}) in ${label(op)}`));
      }
    }
  }

  // CANON_GOVERNANCE (§30): the linked decision, and this Ruleset's conflicts about any target Entity.
  const targets = [...new Set(changeSet.operations.map((op) => op.targetEntityId).filter((e): e is NonNullable<typeof e> => e !== null))];
  const { conflicts, decisions } = await selectImpactGovernance(changeSet.rulesetId, targets, changeSet.canonDecisionId);
  const opsByEntity = new Map<string, ChangeSetOperation[]>();
  for (const op of changeSet.operations) {
    if (op.targetEntityId !== null) opsByEntity.set(op.targetEntityId, [...(opsByEntity.get(op.targetEntityId) ?? []), op]);
  }
  const conflictEntity = new Map(conflicts.map((c) => [c.id, c.entityId]));
  for (const c of conflicts) {
    for (const op of opsByEntity.get(c.entityId) ?? []) {
      collector.add("CANON_GOVERNANCE", "RULE_CONFLICT", c.id, reason(op, `RuleConflict (${c.status}) about the target Entity of ${label(op)}`));
    }
  }
  for (const d of decisions) {
    if (d.id === changeSet.canonDecisionId) {
      collector.add("CANON_GOVERNANCE", "CANON_DECISION", d.id, reason(null, `the CanonDecision this ChangeSet is linked to (${d.decisionType})`));
      collector.add("CANON_GOVERNANCE", "CANON_POLICY", d.canonPolicyId, reason(null, `the CanonPolicy snapshot pinned by the linked CanonDecision ${d.id}`));
    }
    const entity = conflictEntity.get(d.ruleConflictId);
    for (const op of entity === undefined ? [] : (opsByEntity.get(entity) ?? [])) {
      collector.add("CANON_GOVERNANCE", "CANON_DECISION", d.id, reason(op, `CanonDecision (${d.decisionType}) on a RuleConflict about the target Entity of ${label(op)}`));
      collector.add("CANON_GOVERNANCE", "CANON_POLICY", d.canonPolicyId, reason(op, `CanonPolicy pinned by CanonDecision ${d.id} about the target Entity of ${label(op)}`));
    }
  }

  return { changeSetId: changeSet.id, rulesetId: changeSet.rulesetId, derivation: "LIVE", items: collector.toItems() };
}
