/** WO12 cross-system audit: M4-I16–I25, I136, I155–I162, I162A. Real handlers and PostgreSQL; no persisted evaluations. */
import {
  assertRunningAgainstTestDatabase, prisma, createEntity, createEntityVersion, transitionEntityVersionStatus,
  createRuleset, createRulesetManifest, createCanonPolicy, submitRulesetForReview, approveRuleset,
  publishRulesetRelease, resolveRulesetContextFromManifest, resolveRulesetContextFromRelease,
  createRuleConflict, createCanonDecision, createChangeSet, submitChangeSetForReview, approveChangeSet,
  createMigrationPlan, createSourceDocument, ingestSourceSnapshot, createImportBatch, extractImportBatch,
  listExtractionCandidates, reviewImportCandidate, DOCX_MIME_TYPE, updateDraftEntityVersion, getEntityVersion, createKeywordDefinition, assignKeywordToEntityVersion, removeKeywordFromEntityVersion,
} from "@prowess/db";
import { ENTITY_VERSION_STATUSES, type RulesetReleaseWithComposition } from "@prowess/model";
import { orchestrateRulesEvaluation, projectExplanation, type EvaluationPlan, type ExplanationDocument } from "@prowess/rules";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as Evaluate from "../../app/api/rules/evaluate/route";
import { samplePlan } from "../../app/developer/rules/_lib/sample";
import { call, fingerprint } from "./m2-api-harness";
import { buildDocx } from "../../../../packages/prowess-db/tests/fixtures/docx-builder";

const prefix = `test.m4final.${Date.now()}`;
const evaluate = (body: unknown) => call(Evaluate.POST, "POST", "/api/rules/evaluate", {}, body);
const actor = { stats: { divisor: 4 } };
async function approvedVersion(entityId: string, label: string, keywordId?: string) {
  const version = await createEntityVersion(entityId, { displayName: label });
  if (keywordId) await assignKeywordToEntityVersion(version.id, keywordId);
  await transitionEntityVersionStatus(version.id, "IN_REVIEW"); return transitionEntityVersionStatus(version.id, "APPROVED");
}
async function baseline() {
  const A = await createEntity({ entityType: "GENERIC_RULE", canonicalKey: `${prefix}.a` });
  const B = await createEntity({ entityType: "GENERIC_RULE", canonicalKey: `${prefix}.b` });
  const keyword = await createKeywordDefinition({canonicalKey: `${prefix}.signal`, name: "Signal"});
  const A1 = await approvedVersion(A.id, "Alpha 1", keyword.id); const B1 = await approvedVersion(B.id, "Beta 1");
  const ruleset = await createRuleset({ canonicalKey: `${prefix}.r`, name: "Final Audit", channel: "CORE_PLAYTEST" });
  const manifest = await createRulesetManifest(ruleset.id, { entries: [{ entityId: A.id, entityVersionId: A1.id }, { entityId: B.id, entityVersionId: B1.id }] });
  const policy = await createCanonPolicy(ruleset.id, { name: "Audit policy 1", authorities: [] });
  await submitRulesetForReview(ruleset.id); await approveRuleset(ruleset.id);
  const release = await publishRulesetRelease({ rulesetId: ruleset.id, baseManifestId: manifest.id, canonPolicyId: policy.id, versionLabel: "audit-r1" });
  return { A, B, A1, B1, ruleset, manifest, policy, release, keyword };
}
let fx: Awaited<ReturnType<typeof baseline>>;
let laterRelease: RulesetReleaseWithComposition;
let laterVersionId: string;
let tables: string[];
let importDocId: string | undefined;
function verticalPlan(): EvaluationPlan {
  const plan = samplePlan();
  return {...plan, steps: [
    {stepKey: "metadata", order: 1, operation: "KEYWORD", input: {contributions: [{keyword: {keywordId: fx.keyword.id, canonicalKey: fx.keyword.canonicalKey, categoryId: null}, source: {sourceType: "audit", sourceKey: "alpha", provenance: {entityId: fx.A.id, entityVersionId: fx.A1.id, canonicalKey: fx.A.canonicalKey, rulesetId: fx.ruleset.id, manifestId: null}}}]}, bindings: [{target: "/contributions/0/source/provenance/manifestId", source: {kind: "CONTEXT", context: "RULESET", pointer: "/manifestId"}}]},
    {stepKey: "presence", order: 2, operation: "REQUIREMENT", input: {requirement: {kind: "KEYWORD_PRESENT", keywordId: fx.keyword.id}, facts: {keywords: null}}, bindings: [{target: "/facts/keywords", source: {kind: "STEP", stepKey: "metadata", pointer: "/data"}}]},
    ...plan.steps.map(step => {
      if(step.operation !== "EXPLANATION") return step;
      const input = step.input.input as {explanationKey: string; contributions: Array<Record<string, unknown>>};
      return {...step, input: {input: {...input, contributions: [...input.contributions, {contributionKey: "metadata", order: 5, kind: "KEYWORD", response: null}, {contributionKey: "presence", order: 6, kind: "REQUIREMENT", response: null}]}}, bindings: [...step.bindings,
        {target: "/input/contributions/4/response", source: {kind: "STEP", stepKey: "metadata", pointer: ""}},
        {target: "/input/contributions/5/response", source: {kind: "STEP", stepKey: "presence", pointer: ""}},
      ]};
    }),
  ]} as EvaluationPlan;
}
const exact = () => ({ ruleset: { kind: "RELEASE", releaseId: fx.release.id }, evaluationKey: "audit.history", actor, plan: verticalPlan() });
async function assertGolden(response: Awaited<ReturnType<typeof evaluate>>) {
  expect(response.status).toBe(200); expect(response.data.status).toBe("SUCCESS"); expect(response.data.data.executionStatus).toBe("COMPLETE");
  const step = (key: string) => response.data.data.steps.find((s: { stepKey: string }) => s.stepKey === key);
  expect(step("listed").response.data.finalTargets[0].value).toBe(17);
  expect(step("derived").response.data.finalValue).toBe(4);
  expect(step("payment").response.data).toMatchObject({ listedAmount: 17, canPay: true, allocations: [{amountPaid: 6}, {amountPaid: 11}] });
  expect(step("payment").response.data.resultingResources.resources.find((r: {resourceKey: string}) => r.resourceKey === "r.primary").current).toBe(9);
  expect(step("summary").response).toEqual(JSON.parse(JSON.stringify(projectExplanation(step("explanation").response.data as ExplanationDocument, "SUMMARY"))));
}
async function cleanupImport() {
  if (!importDocId) return;
  const snaps = (await prisma.sourceSnapshot.findMany({ where: { sourceDocumentId: importDocId }, select: { id: true } })).map(s => s.id);
  const batches = (await prisma.importBatch.findMany({ where: { sourceSnapshotId: { in: snaps } }, select: { id: true } })).map(b => b.id);
  const inBatch = { importBatchId: { in: batches } }; const inSnap = { sourceSnapshotId: { in: snaps } };
  await prisma.importDecision.deleteMany({ where: inBatch });
  await prisma.candidateDuplicateGroupMember.deleteMany({ where: inBatch }); await prisma.candidateDuplicateGroup.deleteMany({ where: inBatch });
  await prisma.candidateMatchSuggestion.deleteMany({ where: { assessment: inBatch } }); await prisma.candidateMatchAssessment.deleteMany({ where: inBatch }); await prisma.importMatchRun.deleteMany({ where: inBatch });
  await prisma.extractionCandidateSource.deleteMany({ where: inSnap }); await prisma.extractionCandidate.deleteMany({ where: inSnap }); await prisma.importBatch.deleteMany({ where: inSnap });
  await prisma.sourceContentNode.deleteMany({ where: inSnap }); await prisma.sourceAssetPlacement.deleteMany({ where: inSnap });
  await prisma.sourceBlock.deleteMany({ where: inSnap }); await prisma.sourceTable.deleteMany({ where: inSnap }); await prisma.sourceAsset.deleteMany({ where: inSnap });
  for (const section of await prisma.sourceSection.findMany({ where: inSnap, select: { id: true }, orderBy: { ordinal: "desc" } })) await prisma.sourceSection.delete({ where: { id: section.id } });
  await prisma.sourceSnapshotIngestion.deleteMany({ where: inSnap }); await prisma.sourceSnapshot.deleteMany({ where: { id: { in: snaps } } });
}

describe("WO12 final exact-history HTTP integration", () => {
  beforeAll(async () => {
    assertRunningAgainstTestDatabase(process.env.DATABASE_URL!); fx = await baseline();
    tables = (await prisma.$queryRaw<Array<{ table_name: string }>>`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' AND table_name <> '_prisma_migrations' ORDER BY table_name`).map(r => r.table_name);
  });
  afterAll(async () => { await cleanupImport(); await cleanupM2GoldenHistories(prefix); });
  it("full historical E1 remains deep-equal after later M1/M2/M3 state and explicit R2 publication", async () => {
    const request = exact(); const context = await resolveRulesetContextFromRelease(fx.release.id);
    const first = await evaluate(request); await assertGolden(first);
    expect(first.data).toEqual(JSON.parse(JSON.stringify(orchestrateRulesEvaluation({evaluationKey: request.evaluationKey, contexts: {ruleset: context, actor}, plan: request.plan}))));
    expect(first.data.data.steps.find((s: {stepKey: string}) => s.stepKey === "presence").response.data.satisfied).toBe(true);
    const manifestFirst = await evaluate({ ...request, ruleset: { kind: "MANIFEST", manifestId: fx.manifest.id } });
    const A2 = await approvedVersion(fx.A.id, "Alpha 2"); const B2 = await approvedVersion(fx.B.id, "Beta 2"); laterVersionId = A2.id;
    const policy = await createCanonPolicy(fx.ruleset.id, { name: "Audit policy 2", authorities: [] });
    const conflict = await createRuleConflict(fx.ruleset.id, { entityId: fx.A.id, conflictType: "MECHANICAL_DIVERGENCE", severity: "MEDIUM", title: "Later audit choice", candidates: [{ entityVersionId: fx.A1.id }, { entityVersionId: A2.id }] });
    const decision = await createCanonDecision(conflict.id, { canonPolicyId: policy.id, decisionType: "SELECT_RULE", conflictDisposition: "RESOLVED", selectedCandidateIds: [conflict.candidates[1]!.id], rationale: "Explicit later choice" });
    const changeSet = await createChangeSet(fx.ruleset.id, { canonDecisionId: decision.id, name: "Later audit proposal", operations: [
      { operationType: "REPLACE_ENTITY_VERSION", targetEntityId: fx.A.id, fromEntityVersionId: fx.A1.id, toEntityVersionId: A2.id, targetManifestId: fx.release.manifestId },
      { operationType: "REPLACE_ENTITY_VERSION", targetEntityId: fx.B.id, fromEntityVersionId: fx.B1.id, toEntityVersionId: B2.id, targetManifestId: fx.release.manifestId },
    ] });
    await submitChangeSetForReview(changeSet.id); await approveChangeSet(changeSet.id);
    const M2 = await createRulesetManifest(fx.ruleset.id, { entries: [{entityId: fx.A.id, entityVersionId: A2.id}, {entityId: fx.B.id, entityVersionId: B2.id}] });
    // Neither decisions, approved proposals nor development manifests auto-apply or auto-publish.
    expect(await resolveRulesetContextFromRelease(fx.release.id)).toEqual(context); expect((await evaluate(request)).data).toEqual(first.data);
    expect(await prisma.rulesetRelease.count({where: {rulesetId: fx.ruleset.id}})).toBe(1);
    laterRelease = await publishRulesetRelease({ rulesetId: fx.ruleset.id, baseManifestId: fx.release.manifestId, canonPolicyId: policy.id, changeSetId: changeSet.id, versionLabel: "audit-r2" });
    expect(laterRelease.releaseNumber).toBe(2); expect(laterRelease.manifestHash).not.toBe(fx.release.manifestHash);
    await createMigrationPlan({sourceReleaseId: fx.release.id, targetReleaseId: laterRelease.id, name: "Audit migration proposal"});
    const doc = await createSourceDocument({ title: `${prefix} later source`, sourceType: "DOCUMENT" }); importDocId = doc.id;
    const bytes = buildDocx({ pages: 1, blocks: [{ kind: "heading", level: 1, text: "Audit Metadata" }, { kind: "p", text: "Keywords: Signal" }] });
    const ingestion = await ingestSourceSnapshot(doc.id, bytes, {label: "Later snapshot", originalFilename: "audit.docx", mimeType: DOCX_MIME_TYPE});
    const batch = (await createImportBatch({sourceSnapshotId: ingestion.snapshot.id, label: "Later batch", scope: {type: "SNAPSHOT"}, extractorKey: "prowess.semantic-foundation", extractorVersion: "1"})).batch;
    await extractImportBatch(batch.id); const candidates = await listExtractionCandidates(batch.id);
    const candidate = candidates.find(c => c.candidateKind === "KEYWORD"); expect(candidate).toBeDefined();
    const beforeImportApproval = await fingerprint(tables);
    await reviewImportCandidate({ extractionCandidateId: candidate!.id, candidateFingerprint: candidate!.candidateFingerprint, decisionType: "APPROVE_SEMANTIC" });
    const afterImportApproval = await fingerprint(tables);
    expect(Object.keys(afterImportApproval).filter(t => afterImportApproval[t] !== beforeImportApproval[t]).sort()).toEqual(["extraction_candidates", "import_batches", "import_decisions"]);
    const beforeEvaluation = await fingerprint(tables);
    const [again, oldManifest, pureContext, newerManifest] = await Promise.all([evaluate(request), evaluate({...request, ruleset: {kind: "MANIFEST", manifestId: fx.manifest.id}}), resolveRulesetContextFromRelease(fx.release.id), resolveRulesetContextFromManifest(M2.id)]);
    expect(again.data).toEqual(first.data); expect(oldManifest.data).toEqual(manifestFirst.data); expect(pureContext).toEqual(context);
    expect(newerManifest.rules.find(r => r.entityId === fx.A.id)!.entityVersionId).toBe(A2.id);
    expect(pureContext.rules.find(r => r.entityId === fx.A.id)!.entityVersionId).toBe(fx.A1.id);
    expect(await fingerprint(tables)).toEqual(beforeEvaluation);
  });
  it("public content/lifecycle mutations cannot make a published Version mutable", async () => {
    const before = await getEntityVersion(fx.A1.id); const saved = await evaluate(exact());
    await expect(updateDraftEntityVersion(fx.A1.id, {displayName: "Attempted replacement"})).rejects.toMatchObject({code: "ENTITY_VERSION.IMMUTABLE"});
    await expect(assignKeywordToEntityVersion(fx.A1.id, fx.keyword.id)).rejects.toMatchObject({code: "ENTITY_VERSION.IMMUTABLE"});
    await expect(removeKeywordFromEntityVersion(fx.A1.id, fx.keyword.id)).rejects.toMatchObject({code: "ENTITY_VERSION.IMMUTABLE"});
    for (const status of ENTITY_VERSION_STATUSES) {
      const changed = await transitionEntityVersionStatus(fx.A1.id, status).then(v => v, () => null);
      if (changed) expect(changed.structuredData).toEqual(before.structuredData);
      await expect(updateDraftEntityVersion(fx.A1.id, {rulesText: "Attempted replacement"})).rejects.toMatchObject({code: "ENTITY_VERSION.IMMUTABLE"});
      expect((await evaluate(exact())).data).toEqual(saved.data);
    }
  });
  it("composition/hash tampering refuses WO2 and HTTP before a run; restored in finally", async () => {
    const entry = await prisma.rulesetManifestEntry.findFirstOrThrow({where: {manifestId: fx.release.manifestId, entityId: fx.A.id}});
    try {
      await prisma.rulesetManifestEntry.update({where: {id: entry.id}, data: {entityVersionId: laterVersionId}});
      await expect(resolveRulesetContextFromRelease(fx.release.id)).rejects.toMatchObject({code: "RULESET_RESOLUTION.RELEASE_INTEGRITY_FAILURE"});
      const response = await evaluate(exact()); expect(response.status).toBe(409); expect(response.data).toBeUndefined();
    } finally { await prisma.rulesetManifestEntry.update({where: {id: entry.id}, data: {entityVersionId: entry.entityVersionId}}); }
    try {
      await prisma.rulesetRelease.update({where: {id: fx.release.id}, data: {manifestHash: "0".repeat(64)}});
      expect((await evaluate(exact())).status).toBe(409);
    } finally { await prisma.rulesetRelease.update({where: {id: fx.release.id}, data: {manifestHash: fx.release.manifestHash}}); }
    await assertGolden(await evaluate(exact()));
  });
  it("concurrent identical HTTP evaluations preserve the entire database", async () => {
    const before = await fingerprint(tables); const responses = await Promise.all(Array.from({length: 12}, () => evaluate(exact())));
    for (const response of responses) { await assertGolden(response); expect(response.data).toEqual(responses[0]!.data); }
    expect(await fingerprint(tables)).toEqual(before);
  });
  it("different exact Rulesets pin different versions with isolated bound facts and provenance", async () => {
    const other = await createRuleset({canonicalKey: `${prefix}.other`, name: "Other exact context", channel: "CORE_PLAYTEST"});
    const manifestA = await createRulesetManifest(fx.ruleset.id, {entries: [{entityId: fx.A.id, entityVersionId: fx.A1.id}]});
    const manifestB = await createRulesetManifest(other.id, {entries: [{entityId: fx.A.id, entityVersionId: laterVersionId}]});
    const plan: EvaluationPlan = {steps: [{stepKey: "membership", order: 1, operation: "REQUIREMENT", input: {requirement: {kind: "SET_CONTAINS", factKey: "pins", member: fx.A1.id}, facts: {sets: [{key: "pins", members: [""]}]}}, bindings: [{target: "/facts/sets/0/members/0", source: {kind: "CONTEXT", context: "RULESET", pointer: "/rules/0/entityVersionId"}}]}]};
    const body = {evaluationKey: "audit.isolation", plan}; const before = await fingerprint(tables);
    const [a,b] = await Promise.all([evaluate({...body,ruleset:{kind:"MANIFEST",manifestId:manifestA.id}}),evaluate({...body,ruleset:{kind:"MANIFEST",manifestId:manifestB.id}})]);
    expect(a.data.data.steps[0].response.data.satisfied).toBe(true); expect(b.data.data.steps[0].response.data.satisfied).toBe(false);
    expect(a.data.ruleset.rulesetId).toBe(fx.ruleset.id); expect(b.data.ruleset.rulesetId).toBe(other.id);
    expect(a.data.data.steps[0].response.ruleset).toEqual(a.data.ruleset); expect(b.data.data.steps[0].response.ruleset).toEqual(b.data.ruleset);
    expect(await fingerprint(tables)).toEqual(before);
  });
  it("Base → Child → Grandchild pins and provenance remain exact after later parent manifests", async () => {
    const child = await createRuleset({canonicalKey:`${prefix}.child`,name:"Child",channel:"CORE_PLAYTEST",parentRulesetId:fx.ruleset.id});
    const cm = await createRulesetManifest(child.id,{parentManifestId:fx.manifest.id,entries:[{entityId:fx.B.id,entityVersionId:fx.B1.id}]});
    const grand = await createRuleset({canonicalKey:`${prefix}.grand`,name:"Grandchild",channel:"CORE_PLAYTEST",parentRulesetId:child.id});
    const gm = await createRulesetManifest(grand.id,{parentManifestId:cm.id,entries:[]});
    const before = await resolveRulesetContextFromManifest(gm.id);
    expect(before.rules.find(r=>r.entityId===fx.A.id)).toMatchObject({entityVersionId:fx.A1.id,sourceManifestId:fx.manifest.id,sourceRulesetId:fx.ruleset.id});
    expect(before.rules.find(r=>r.entityId===fx.B.id)).toMatchObject({entityVersionId:fx.B1.id,sourceManifestId:cm.id,sourceRulesetId:child.id});
    await createRulesetManifest(fx.ruleset.id,{entries:[{entityId:fx.A.id,entityVersionId:laterVersionId}]});
    expect(await resolveRulesetContextFromManifest(gm.id)).toEqual(before);
  });
  it.each(["latest","current","active","manifestHash","releaseNumber","resolvedRuleset","resolvedRulesetContext","persist","commit","applyToCharacter"])("strict request rejects %s without writes", async field=>{
    const before=await fingerprint(tables); const response=await evaluate({...exact(),[field]:true});
    expect(response.status).toBe(400);expect(response.data).toBeUndefined();expect(await fingerprint(tables)).toEqual(before);
  });
  it("all child/business/semantic invalidity stays distinct from transport errors",async()=>{
    for(const plan of [
      {steps:[{stepKey:"x",order:1,operation:"FORMULA",input:{program:{expression:"1 / 0"},variables:{}}}]},
      {steps:[{stepKey:"x",order:1,operation:"REQUIREMENT",input:{requirement:{kind:"ENTITY_OWNED",entityId:fx.A.id},facts:{ownedEntityIds:[]}}}]},
      {steps:[{stepKey:"x",order:1,operation:"RESOURCE_PAYMENT_APPLY",input:{snapshot:{resources:[]},payment:{costKey:"c",listedAmount:10,sources:[]}}}]},
      {steps:[{stepKey:"x",order:1,operation:"NO_SUCH_OPERATION",input:{}}]},
    ]) expect((await evaluate({...exact(),plan})).status).toBe(200);
    expect((await evaluate('{"broken":')).status).toBe(400);
    expect((await evaluate({...exact(),ruleset:{kind:"MANIFEST",manifestId:"40000000-0000-4000-8000-ffffffffffff"}})).status).toBe(404);
    expect((await evaluate({...exact(),ruleset:{rulesetId:fx.ruleset.id}})).status).toBe(400);
  });
});


/** Test-only FK teardown, scoped to this fixture prefix; production evaluation never calls this. */
async function cleanupM2GoldenHistories(prefix: string): Promise<void> {
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
