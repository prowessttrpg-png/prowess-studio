/**
 * M2 GOLDEN HISTORY FIXTURE (PAS-10 M2-WO12 §3, §57) — one miniature, complete M2 history built ONLY through the
 * public @prowess/db services, exposing every exact id through aliases (never hard-coded production ids).
 *
 * Intended use: the baseline regression fixture for future milestones (M3 Source & Import, M4 …). A later test can
 * call `buildM2GoldenHistory()` and assert that new work leaves this history byte-for-byte reproducible. Build cost
 * is a few hundred ms; call `cleanupM2GoldenHistories(prefix)` in afterAll.
 *
 * Timeline (Ruleset R):
 *   Entities A, B, C · Versions A1 A2 B1 B2 C1 (moved to APPROVED via the lifecycle; A3 later stays DRAFT) · SourceDocuments docA docB (docA has its OWN metadata authority)
 *   SourceReferences refA1 (A1←docA), refA2 (A2←docB)
 *   M1 = {A→A1, B→B1}                                   P1 = {docA@global CURRENT_PRIMARY, docB@spell.affinity REFERENCE_ONLY}
 *   C1 (A: A1 vs A2, with evidence) → D1 SELECT_RULE A2 under P1
 *   CS1 = proposal from D1 against M1 (REPLACE A1→A2) → impact → submit → approve
 *   R submit → approve → R1 publish (base M1, P1, CS1)
 *   later: Version A3; M2 = {A→A2, B→B2} (a later development manifest); P2 = {docA@global REFERENCE_ONLY}
 *   C2 (B: B1 vs B2) → D2 SELECT_RULE B2 under P2
 *   CS2 = manual, linked to D2, against R1's manifest (REPLACE B1→B2, ADD C→C1) → submit → approve
 *   R2 publish (base = R1's manifest, P2, CS2)
 *   MigrationPlan R1 → R2
 */
import {
  analyzeChangeSetImpact, approveChangeSet, approveRuleset, createCanonDecision, createCanonPolicy, createChangeSet, createEntity, createEntityVersion,
  createMigrationPlan, createRuleConflict, createRuleset, createRulesetManifest, createSourceDocument, createSourceReference, prisma,
  proposeChangeSetFromCanonDecision, publishRulesetRelease, submitChangeSetForReview, submitRulesetForReview, transitionEntityVersionStatus,
} from "../../../src/index";

export type GoldenHistory = Awaited<ReturnType<typeof buildM2GoldenHistory>>;

export async function buildM2GoldenHistory(prefix: string) {
  const key = (s: string) => `${prefix}.${s}`;
  const entity = async (label: string) => createEntity({ entityType: "GENERIC_RULE", canonicalKey: key(`entity_${label}`) });
  const [A, B, C] = [await entity("a"), await entity("b"), await entity("c")];
  const A1 = await createEntityVersion(A.id, { displayName: "Evocation" });
  const A2 = await createEntityVersion(A.id, { displayName: "Emission" });
  const B1 = await createEntityVersion(B.id, { displayName: "Ward" });
  const B2 = await createEntityVersion(B.id, { displayName: "Bulwark" });
  const C1 = await createEntityVersion(C.id, { displayName: "Channel" });
  // M2-WO12 F1: everything that will be PUBLISHED leaves DRAFT through the normal lifecycle (A3, created later, stays DRAFT).
  for (const v of [A1, A2, B1, B2, C1]) {
    await transitionEntityVersionStatus(v.id, "IN_REVIEW");
    await transitionEntityVersionStatus(v.id, "APPROVED");
  }
  const docA = await createSourceDocument({ title: `${prefix} Spellcasting`, sourceType: "DOCUMENT", authorityStatus: "REFERENCE_ONLY" });
  const docB = await createSourceDocument({ title: `${prefix} Errata`, sourceType: "DOCUMENT" });
  const refA1 = await createSourceReference(A1.id, { sourceDocumentId: docA.id, sectionLabel: "Spell AP Cost" });
  const refA2 = await createSourceReference(A2.id, { sourceDocumentId: docB.id, sectionLabel: "Errata 1" });

  const R = await createRuleset({ canonicalKey: key("ruleset_r"), name: `${prefix} Core Playtest`, channel: "CORE_PLAYTEST" });
  const M1 = await createRulesetManifest(R.id, { entries: [{ entityId: A.id, entityVersionId: A1.id }, { entityId: B.id, entityVersionId: B1.id }] });
  const P1 = await createCanonPolicy(R.id, {
    name: "P1",
    authorities: [
      { sourceDocumentId: docA.id, scopeKey: "global", authorityStatus: "CURRENT_PRIMARY" },
      { sourceDocumentId: docB.id, scopeKey: "spell.affinity", authorityStatus: "REFERENCE_ONLY" },
    ],
  });
  const C1x = await createRuleConflict(R.id, {
    entityId: A.id,
    conflictType: "TERMINOLOGY_DIVERGENCE",
    severity: "HIGH",
    title: "Affinity naming",
    candidates: [{ entityVersionId: A1.id, sourceReferenceId: refA1.id, label: "Original" }, { entityVersionId: A2.id, sourceReferenceId: refA2.id, label: "Errata" }],
  });
  const D1 = await createCanonDecision(C1x.id, {
    canonPolicyId: P1.id, decisionType: "SELECT_RULE", conflictDisposition: "RESOLVED", selectedCandidateIds: [C1x.candidates[1]!.id], rationale: "Errata adopts Emission.",
  });
  const CS1 = await proposeChangeSetFromCanonDecision(D1.id, { name: "Adopt Emission", targetManifestId: M1.id });
  const impact1 = await analyzeChangeSetImpact(CS1.id);
  await submitChangeSetForReview(CS1.id);
  await approveChangeSet(CS1.id);
  await submitRulesetForReview(R.id);
  await approveRuleset(R.id);
  const R1 = await publishRulesetRelease({ rulesetId: R.id, baseManifestId: M1.id, canonPolicyId: P1.id, changeSetId: CS1.id, versionLabel: "Core Playtest 1" });

  const A3 = await createEntityVersion(A.id, { displayName: "Emission (revised)" });
  const M2 = await createRulesetManifest(R.id, { entries: [{ entityId: A.id, entityVersionId: A2.id }, { entityId: B.id, entityVersionId: B2.id }] });
  const P2 = await createCanonPolicy(R.id, { name: "P2", authorities: [{ sourceDocumentId: docA.id, scopeKey: "global", authorityStatus: "REFERENCE_ONLY" }] });
  const C2x = await createRuleConflict(R.id, {
    entityId: B.id, conflictType: "MECHANICAL_DIVERGENCE", severity: "MEDIUM", title: "Ward strength", candidates: [{ entityVersionId: B1.id }, { entityVersionId: B2.id }],
  });
  const D2 = await createCanonDecision(C2x.id, {
    canonPolicyId: P2.id, decisionType: "SELECT_RULE", conflictDisposition: "RESOLVED", selectedCandidateIds: [C2x.candidates[1]!.id], rationale: "Bulwark playtested better.",
  });
  const CS2 = await createChangeSet(R.id, {
    canonDecisionId: D2.id,
    name: "Adopt Bulwark, add Channel",
    operations: [
      { operationType: "REPLACE_ENTITY_VERSION", targetEntityId: B.id, fromEntityVersionId: B1.id, toEntityVersionId: B2.id, targetManifestId: R1.manifestId },
      { operationType: "ADD_ENTITY_TO_MANIFEST", targetEntityId: C.id, toEntityVersionId: C1.id, targetManifestId: R1.manifestId },
    ],
  });
  await submitChangeSetForReview(CS2.id);
  await approveChangeSet(CS2.id);
  const R2 = await publishRulesetRelease({ rulesetId: R.id, baseManifestId: R1.manifestId, canonPolicyId: P2.id, changeSetId: CS2.id, versionLabel: "Core Playtest 2" });
  const plan = await createMigrationPlan({ sourceReleaseId: R1.id, targetReleaseId: R2.id, name: "Core Playtest 1 → 2" });

  return {
    prefix,
    entities: { A, B, C },
    versions: { A1, A2, A3, B1, B2, C1 },
    sources: { docA, docB, refA1, refA2 },
    ruleset: R,
    manifests: { M1, M2 },
    policies: { P1, P2 },
    conflicts: { C1: C1x, C2: C2x },
    decisions: { D1, D2 },
    changeSets: { CS1, CS2 },
    impact1,
    releases: { R1, R2 },
    plan,
  };
}

/** FK-ordered cleanup of every row a golden history (or other test data under `prefix`) created. */
export async function cleanupM2GoldenHistories(prefix: string): Promise<void> {
  const rulesetIds = (await prisma.ruleset.findMany({ where: { canonicalKey: { startsWith: prefix } }, select: { id: true } })).map((r: { id: string }) => r.id);
  const inR = { rulesetId: { in: rulesetIds } };
  const releaseIds = (await prisma.rulesetRelease.findMany({ where: inR, select: { id: true } })).map((r: { id: string }) => r.id);
  const planIds = (await prisma.migrationPlan.findMany({ where: { OR: [{ sourceReleaseId: { in: releaseIds } }, { targetReleaseId: { in: releaseIds } }] }, select: { id: true } })).map((p: { id: string }) => p.id);
  await prisma.migrationPlanItem.deleteMany({ where: { migrationPlanId: { in: planIds } } });
  await prisma.migrationPlan.deleteMany({ where: { id: { in: planIds } } });
  await prisma.rulesetRelease.deleteMany({ where: inR });
  await prisma.changeSetOperation.deleteMany({ where: inR });
  await prisma.changeSet.deleteMany({ where: inR });
  await prisma.canonDecisionSelection.deleteMany({ where: { canonDecision: inR } });
  await prisma.canonDecision.deleteMany({ where: inR });
  await prisma.ruleConflictCandidate.deleteMany({ where: { ruleConflict: inR } });
  await prisma.ruleConflict.deleteMany({ where: inR });
  await prisma.sourceAuthorityRecord.deleteMany({ where: { canonPolicy: inR } });
  await prisma.canonPolicy.deleteMany({ where: inR });
  await prisma.rulesetManifestEntry.deleteMany({ where: { manifest: inR } });
  await prisma.rulesetManifest.updateMany({ where: inR, data: { parentManifestId: null } });
  await prisma.rulesetManifest.deleteMany({ where: inR });
  await prisma.ruleset.updateMany({ where: { id: { in: rulesetIds } }, data: { parentRulesetId: null } });
  await prisma.ruleset.deleteMany({ where: { id: { in: rulesetIds } } });
  const entityIds = (await prisma.entity.findMany({ where: { canonicalKey: { startsWith: prefix } }, select: { id: true } })).map((e: { id: string }) => e.id);
  const versionIds = (await prisma.entityVersion.findMany({ where: { entityId: { in: entityIds } }, select: { id: true } })).map((v: { id: string }) => v.id);
  await prisma.entityRelationship.deleteMany({ where: { OR: [{ sourceEntityId: { in: entityIds } }, { targetEntityId: { in: entityIds } }] } });
  await prisma.entityVersionKeyword.deleteMany({ where: { entityVersionId: { in: versionIds } } });
  await prisma.entityKeyword.deleteMany({ where: { entityId: { in: entityIds } } });
  await prisma.keywordDefinition.deleteMany({ where: { canonicalKey: { startsWith: prefix } } });
  await prisma.sourceReference.deleteMany({ where: { entityVersionId: { in: versionIds } } });
  await prisma.sourceDocument.deleteMany({ where: { title: { startsWith: prefix } } });
  await prisma.entityVersion.updateMany({ where: { id: { in: versionIds } }, data: { parentVersionId: null } });
  await prisma.entityVersion.deleteMany({ where: { id: { in: versionIds } } });
  await prisma.entity.deleteMany({ where: { id: { in: entityIds } } });
}
