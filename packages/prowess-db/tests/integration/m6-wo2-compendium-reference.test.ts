/**
 * PAS-10 M6-WO2 — Compendium Rules Reference read service: database integration. Runs only against prowess_studio_test.
 *
 *  - Release scoping (M6-I011, M6-I012): Release A pins Revision 1, Release B pins Revision 2, Revision 3 is the
 *    Entity's latest revision and is pinned by neither — each Release shows exactly its pin, never the latest.
 *  - Historical reproducibility (M6-I013): Release A reads identically after Release B and Revision 3 exist.
 *  - Cross-Ruleset isolation (M6-I011): a Release of another Ruleset is never readable under this Ruleset's URL.
 *  - Exact references (M6-I016): an authored Revision-2 reference is shown as Revision 2 next to the pinned revision —
 *    a mismatch in Release A, a match in Release B — and never rewritten.
 *  - Comparison (M6-I018): A → B is one CHANGED_VERSION, one REMOVED_ENTITY, one ADDED_ENTITY plus the unchanged count.
 *  - Structured content per family (M6-I015): every M5 Ability-component kind and Affinity reads with its catalog kind;
 *    an unsupported historical schema version is returned verbatim and flagged — never migrated on view.
 *  - Read-only (M6-I020): every read leaves the database byte-identical.
 *
 * Fixture content is test-only (`test.m6wo2db.*`) and never game canon.
 */
import { COMPENDIUM_REFERENCE_ERROR_CODES, DomainError, RULESET_RELEASE_ERROR_CODES } from "@prowess/model";
import { PROWESS_DEFINITION_KINDS, type ProwessDefinitionEnvelope } from "@prowess/game";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  approveChangeSet,
  approveRuleset,
  assignKeywordToEntityVersion,
  compareReferenceReleases,
  createCanonPolicy,
  createChangeSet,
  createEntity,
  createEntityAlias,
  createEntityRelationship,
  createEntityVersion,
  createKeywordDefinition,
  createRuleset,
  createRulesetManifest,
  createSourceDocument,
  createSourceReference,
  getReferenceEntry,
  getReferenceRelease,
  listReferenceEntries,
  listReferenceReleases,
  prisma,
  publishRulesetRelease,
  resolveLatestReferenceRelease,
  submitChangeSetForReview,
  submitRulesetForReview,
  transitionEntityVersionStatus,
} from "../../src/index";
import { assertRunningAgainstTestDatabase } from "../../src/testDatabaseGuard";
import { getTestDatabaseUrl } from "./env";
import { abilityDefinitionFixture } from "../../../prowess-game/src/testing/ability-definition-fixtures.js";
import { durationConditionFixture } from "../../../prowess-game/src/testing/duration-condition-fixtures.js";

const PREFIX = "test.m6wo2db";
const tag = `${Date.now()}`;
let n = 0;
const key = (label: string) => `${PREFIX}.${label}_${tag}_${++n}`;
const rulesetIds: string[] = [];
const entityIds: string[] = [];
const keywordIds: string[] = [];
const documentIds: string[] = [];
const TABLES = ["entities", "entity_versions", "entity_aliases", "entity_keywords", "entity_version_keywords", "entity_relationships", "source_references", "rulesets", "ruleset_manifests", "ruleset_manifest_entries", "ruleset_releases", "change_sets"];

async function fingerprint(): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const t of TABLES) {
    const [row] = await prisma.$queryRawUnsafe<Array<{ h: string }>>(`SELECT md5(coalesce(string_agg(t::text, '|' ORDER BY t::text), '')) AS h FROM "${t}" t`);
    out[t] = row?.h ?? "";
  }
  return out;
}

async function expectCode(promise: Promise<unknown>, code: string) {
  const error = await promise.then(() => null, (e: unknown) => e);
  expect(error).toBeInstanceOf(DomainError);
  expect((error as DomainError).code).toBe(code);
}

const definition = (kind: string, payload: Record<string, unknown>, schemaVersion = 1) => ({
  prowessDefinition: { schemaVersion, systemFamily: PROWESS_DEFINITION_KINDS[kind as keyof typeof PROWESS_DEFINITION_KINDS].family, definitionKind: kind, payload },
});

async function approved(entityId: string, displayName: string, structuredData: object, keywordId?: string) {
  const v = await createEntityVersion(entityId, { displayName, structuredData });
  if (keywordId !== undefined) await assignKeywordToEntityVersion(v.id, keywordId);
  await transitionEntityVersionStatus(v.id, "IN_REVIEW");
  return transitionEntityVersionStatus(v.id, "APPROVED");
}

async function entity(entityType: string, label: string) {
  const e = await createEntity({ entityType, canonicalKey: key(label) });
  entityIds.push(e.id);
  return e;
}

async function ruleset(label: string) {
  const r = await createRuleset({ canonicalKey: key(`ruleset_${label}`), name: `M6-WO2 ${label}`, channel: "CORE_PLAYTEST", versionLabel: label });
  rulesetIds.push(r.id);
  await submitRulesetForReview(r.id);
  await approveRuleset(r.id);
  const policy = await createCanonPolicy(r.id, { name: `P ${label}`, authorities: [] });
  return { r, policy };
}

async function publish(g: Awaited<ReturnType<typeof ruleset>>, label: string, pins: Array<{ entityId: string; entityVersionId: string }>) {
  const m = await createRulesetManifest(g.r.id, { entries: pins });
  return publishRulesetRelease({ rulesetId: g.r.id, baseManifestId: m.id, canonPolicyId: g.policy.id, versionLabel: label });
}

const ref = (e: { id: string; canonicalKey: string }, versionId: string, kind = "SPELL_EFFECT") => ({ entityId: e.id, entityVersionId: versionId, canonicalKey: e.canonicalKey, definitionKind: kind, systemFamily: "SPELL" });

// Shared world: Ruleset G with Releases A and B, and another Ruleset H.
let g: Awaited<ReturnType<typeof ruleset>>;
let h: Awaited<ReturnType<typeof ruleset>>;
let releaseA: { id: string; manifestId: string };
let releaseB: { id: string };
let releaseH: { id: string };
let push: { id: string; canonicalKey: string };
let pushRev: { id: string }[] = [];
let trait: { id: string; canonicalKey: string };
let generic: { id: string; canonicalKey: string };
let removed: { id: string; canonicalKey: string };
let added: { id: string; canonicalKey: string };
let control: { id: string; canonicalKey: string };

describe("M6-WO2 Rules Reference read service (prowess_studio_test only)", () => {
  beforeAll(async () => {
    assertRunningAgainstTestDatabase(getTestDatabaseUrl());
    control = await createKeywordDefinition({ canonicalKey: key("keyword_control"), name: "M6WO2 Control" });
    keywordIds.push(control.id);
    const doc = await createSourceDocument({ title: `${PREFIX} Playtest Rules ${tag}`, sourceType: "DOCUMENT" });
    documentIds.push(doc.id);

    push = await entity("SPELL_EFFECT", "force_push");
    const effectPayload = (feet: number) => ({ effectFamily: "MOVEMENT", keywords: [control.canonicalKey], parameters: {}, compatibility: [], costContributions: [{ contributionKey: "effect.mp", currency: "MP", data: { kind: "FIXED", amount: 2 } }], rules: {}, resolution: null, outcomes: [{ outcomeKey: "push", data: { feet } }] });
    pushRev = [await approved(push.id, "Force Push", definition("SPELL_EFFECT", effectPayload(10)))];
    pushRev.push(await approved(push.id, "Force Push", definition("SPELL_EFFECT", effectPayload(15))));
    await createSourceReference(pushRev[0]!.id, { sourceDocumentId: doc.id, sectionLabel: "Movement Effects", pageReference: "14" });
    await createEntityAlias(push.id, { alias: "Telekinetic Shove" });

    trait = await entity("SPELL_TRAIT", "piercing");
    await approved(trait.id, "Piercing", definition("SPELL_TRAIT", { traitFamily: "PIERCING", scope: "EFFECT", keywords: [control.canonicalKey], parameters: {}, compatibility: [], costContributions: [], rules: { pairsWith: ref(push, pushRev[1]!.id) } }));
    generic = await entity("GENERIC_RULE", "lookalike");
    await approved(generic.id, "Adjudication note — Spell Effect lookalike", { summary: "Fire damage Spell Effect" }, control.id);
    removed = await entity("GENERIC_RULE", "removed");
    const removedV = await approved(removed.id, "Retired Rule", {});
    added = await entity("GENERIC_RULE", "added");
    const addedV = await approved(added.id, "Brand New Rule", {});
    await createEntityRelationship({ sourceEntityId: trait.id, targetEntityId: push.id, relationshipType: "REQUIRES" });

    g = await ruleset("g");
    const traitV = (await prisma.entityVersion.findFirstOrThrow({ where: { entityId: trait.id } })).id;
    const genericV = (await prisma.entityVersion.findFirstOrThrow({ where: { entityId: generic.id } })).id;
    releaseA = await publish(g, "A", [
      { entityId: push.id, entityVersionId: pushRev[0]!.id },
      { entityId: trait.id, entityVersionId: traitV },
      { entityId: generic.id, entityVersionId: genericV },
      { entityId: removed.id, entityVersionId: removedV.id },
    ]);
    const cs = await createChangeSet(g.r.id, {
      name: `B ${tag}`,
      operations: [
        { operationType: "REPLACE_ENTITY_VERSION", targetEntityId: push.id, fromEntityVersionId: pushRev[0]!.id, toEntityVersionId: pushRev[1]!.id },
        { operationType: "REMOVE_ENTITY_FROM_MANIFEST", targetEntityId: removed.id, fromEntityVersionId: removedV.id },
        { operationType: "ADD_ENTITY_TO_MANIFEST", targetEntityId: added.id, toEntityVersionId: addedV.id },
      ],
    });
    await submitChangeSetForReview(cs.id);
    await approveChangeSet(cs.id);
    releaseB = await publishRulesetRelease({ rulesetId: g.r.id, baseManifestId: releaseA.manifestId, canonPolicyId: g.policy.id, changeSetId: cs.id, versionLabel: "B" });
    // Revision 3 — the Entity's latest revision, pinned by NO Release.
    pushRev.push(await createEntityVersion(push.id, { displayName: "Force Push (draft rework)", structuredData: definition("SPELL_EFFECT", effectPayload(99)) }));

    h = await ruleset("h");
    releaseH = await publish(h, "H1", [{ entityId: push.id, entityVersionId: pushRev[1]!.id }]);
  });

  afterAll(async () => {
    await prisma.rulesetRelease.deleteMany({ where: { rulesetId: { in: rulesetIds } } });
    await prisma.changeSetOperation.deleteMany({ where: { rulesetId: { in: rulesetIds } } });
    await prisma.changeSet.deleteMany({ where: { rulesetId: { in: rulesetIds } } });
    await prisma.sourceAuthorityRecord.deleteMany({ where: { canonPolicy: { rulesetId: { in: rulesetIds } } } });
    await prisma.canonPolicy.deleteMany({ where: { rulesetId: { in: rulesetIds } } });
    await prisma.rulesetManifestEntry.deleteMany({ where: { manifest: { rulesetId: { in: rulesetIds } } } });
    await prisma.rulesetManifest.updateMany({ where: { rulesetId: { in: rulesetIds } }, data: { parentManifestId: null } });
    await prisma.rulesetManifest.deleteMany({ where: { rulesetId: { in: rulesetIds } } });
    await prisma.ruleset.deleteMany({ where: { id: { in: rulesetIds } } });
    await prisma.entityRelationship.deleteMany({ where: { sourceEntityId: { in: entityIds } } });
    await prisma.sourceReference.deleteMany({ where: { sourceDocumentId: { in: documentIds } } });
    await prisma.entityVersionKeyword.deleteMany({ where: { entityVersion: { entityId: { in: entityIds } } } });
    await prisma.entityAlias.deleteMany({ where: { entityId: { in: entityIds } } });
    await prisma.entityVersion.updateMany({ where: { entityId: { in: entityIds } }, data: { parentVersionId: null } });
    await prisma.entityVersion.deleteMany({ where: { entityId: { in: entityIds } } });
    await prisma.entity.deleteMany({ where: { id: { in: entityIds } } });
    await prisma.sourceDocument.deleteMany({ where: { id: { in: documentIds } } });
    await prisma.keywordDefinition.deleteMany({ where: { id: { in: keywordIds } } });
  });

  it("M6-I011 / M6-I012 each Release lists exactly its pins (A → Revision 1, B → Revision 2), never the latest Revision 3", async () => {
    const a = await listReferenceEntries(g.r.id, releaseA.id, { page: 1, pageSize: 50 });
    const b = await listReferenceEntries(g.r.id, releaseB.id, { page: 1, pageSize: 50 });
    const pinOf = (page: typeof a, id: string) => page.items.find((i) => i.entityId === id);
    expect([a.total, b.total]).toEqual([4, 4]);
    expect(pinOf(a, push.id)?.revisionNumber).toBe(1);
    expect(pinOf(b, push.id)?.revisionNumber).toBe(2);
    expect([...a.items, ...b.items].some((i) => i.entityVersionId === pushRev[2]!.id)).toBe(false);
    expect(pinOf(a, added.id)).toBeUndefined();
    expect(pinOf(b, removed.id)).toBeUndefined();
    // Deterministic order: display name (case-insensitive), canonical key, Entity id.
    expect(a.items.map((i) => i.displayName)).toEqual(["Adjudication note — Spell Effect lookalike", "Force Push", "Piercing", "Retired Rule"]);
    const detail = await getReferenceEntry(g.r.id, releaseA.id, push.id);
    expect([detail.pinnedRevision.id, detail.pinnedRevision.revisionNumber, detail.latestRevisionNumber]).toEqual([pushRev[0]!.id, 1, 3]);
    expect((detail.definition?.payload?.outcomes as Array<{ data: { feet: number } }>)[0]!.data.feet).toBe(10);
  });

  it("M6-I014 facets are server-side: kind, family, branch, EntityType, generic, Keyword id and search (alias / key)", async () => {
    const q = (over: Record<string, string>) => listReferenceEntries(g.r.id, releaseA.id, { page: 1, pageSize: 50, ...over }).then((p) => p.items.map((i) => i.entityId).sort());
    expect(await q({ kind: "SPELL_EFFECT" })).toEqual([push.id]);
    expect(await q({ family: "SPELL" })).toEqual([push.id, trait.id].sort());
    expect(await q({ branch: PROWESS_DEFINITION_KINDS.SPELL_TRAIT.branch as string })).toEqual([push.id, trait.id].sort());
    expect(await q({ entityType: "SPELL_TRAIT" })).toEqual([trait.id]);
    expect(await q({ kind: "GENERIC" })).toEqual([generic.id, removed.id].sort());
    expect(await q({ kind: "GENERIC", family: "SPELL" })).toEqual([]);
    // Keyword by id: Version-level assignment (generic) OR the payload's structured keywords (effect, trait).
    expect(await q({ keywordId: control.id })).toEqual([push.id, trait.id, generic.id].sort());
    expect(await q({ search: "telekinetic" })).toEqual([push.id]);
    expect(await q({ search: push.canonicalKey.slice(0, -3) })).toContain(push.id);
    expect(await q({ search: "100%_" })).toEqual([]);
    const paged = await listReferenceEntries(g.r.id, releaseA.id, { page: 2, pageSize: 3 });
    expect([paged.total, paged.items.length, paged.items[0]?.displayName]).toEqual([4, 1, "Retired Rule"]);
    for (const [field, value] of [["kind", "SPELL_FIREBALL"], ["family", "NOPE"], ["branch", "NOPE"], ["entityType", "NOPE"], ["keywordId", "not-a-uuid"]] as const) {
      await expectCode(listReferenceEntries(g.r.id, releaseA.id, { page: 1, pageSize: 5, [field]: value }), COMPENDIUM_REFERENCE_ERROR_CODES.INVALID_INPUT);
    }
  });

  it("M6-I015 / M6-I010 generic content has no inferred kind; Definitions carry their catalog kind", async () => {
    const a = await listReferenceEntries(g.r.id, releaseA.id, { page: 1, pageSize: 50 });
    const lookalike = a.items.find((i) => i.entityId === generic.id)!;
    expect([lookalike.definitionKind, lookalike.kind]).toEqual([null, null]);
    const effect = a.items.find((i) => i.entityId === push.id)!;
    expect([effect.definitionKind, effect.kind?.sharedContract, effect.kind?.systemFamily]).toEqual(["SPELL_EFFECT", "EFFECT", "SPELL"]);
    expect(effect.keywords).toEqual([control.canonicalKey]);
  });

  it("M6-I016 exact references show the authored revision vs the Release's pin, never rewritten; Referenced By is Release-bounded", async () => {
    const inA = await getReferenceEntry(g.r.id, releaseA.id, trait.id);
    expect(inA.references).toEqual([
      expect.objectContaining({ path: "payload.rules.pairsWith", authored: ref(push, pushRev[1]!.id), authoredRevisionNumber: 2, inRelease: true, pinned: expect.objectContaining({ entityVersionId: pushRev[0]!.id, revisionNumber: 1 }), matchesPin: false }),
    ]);
    const inB = await getReferenceEntry(g.r.id, releaseB.id, trait.id);
    expect(inB.references[0]).toEqual(expect.objectContaining({ matchesPin: true, pinned: expect.objectContaining({ revisionNumber: 2 }) }));
    const target = await getReferenceEntry(g.r.id, releaseA.id, push.id);
    expect(target.referencedBy.map((c) => c.entityId)).toEqual([trait.id]);
    expect(target.relationships).toEqual([expect.objectContaining({ direction: "INCOMING", counterpart: expect.objectContaining({ id: trait.id }), counterpartPin: expect.objectContaining({ revisionNumber: 1 }) })]);
    expect(target.relatedByKeyword.map((c) => c.entityId)).toEqual([trait.id]);
    expect(target.keywords.structured).toEqual([{ canonicalKey: control.canonicalKey, keyword: expect.objectContaining({ id: control.id }) }]);
    expect(target.sources).toEqual([expect.objectContaining({ reference: expect.objectContaining({ sectionLabel: "Movement Effects", pageReference: "14" }), document: expect.objectContaining({ id: documentIds[0] }) })]);
    // Revision 2's sources are its own — none were recorded, so none are borrowed from Revision 1.
    expect((await getReferenceEntry(g.r.id, releaseB.id, push.id)).sources).toEqual([]);
  });

  it("M6-I013 Release A reads identically after Release B and Revision 3 exist (historical reproducibility)", async () => {
    const first = await getReferenceEntry(g.r.id, releaseA.id, push.id);
    await createEntityVersion(push.id, { displayName: "Force Push (another draft)", structuredData: {} });
    const again = await getReferenceEntry(g.r.id, releaseA.id, push.id);
    expect({ ...again, latestRevisionNumber: 0 }).toEqual({ ...first, latestRevisionNumber: 0 });
    expect(again.latestRevisionNumber).toBe(4);
  });

  it("M6-I011 Releases and Entities never cross Rulesets; absence is explicit (no fallback)", async () => {
    await expectCode(getReferenceRelease(g.r.id, releaseH.id), COMPENDIUM_REFERENCE_ERROR_CODES.RELEASE_NOT_IN_RULESET);
    await expectCode(listReferenceEntries(h.r.id, releaseA.id, { page: 1, pageSize: 5 }), COMPENDIUM_REFERENCE_ERROR_CODES.RELEASE_NOT_IN_RULESET);
    await expectCode(getReferenceEntry(h.r.id, releaseH.id, trait.id), COMPENDIUM_REFERENCE_ERROR_CODES.ENTITY_NOT_IN_RELEASE);
    await expectCode(getReferenceEntry(g.r.id, releaseA.id, added.id), COMPENDIUM_REFERENCE_ERROR_CODES.ENTITY_NOT_IN_RELEASE);
    await expectCode(getReferenceRelease(g.r.id, "00000000-0000-4000-8000-000000000000"), RULESET_RELEASE_ERROR_CODES.NOT_FOUND);
    await expectCode(listReferenceReleases("nope"), RULESET_RELEASE_ERROR_CODES.RULESET_NOT_FOUND);
    // H pins Revision 2 of the same Entity: its own pin, unaffected by G.
    expect((await getReferenceEntry(h.r.id, releaseH.id, push.id)).pinnedRevision.revisionNumber).toBe(2);
  });

  it("M6-I017 Release metadata, server-side manifest verification and the Latest Release query (no pointer)", async () => {
    const detail = await getReferenceRelease(g.r.id, releaseA.id);
    expect([detail.releaseNumber, detail.versionLabel, detail.compositionSize, detail.verification.valid, detail.ruleset.id]).toEqual([1, "A", 4, true, g.r.id]);
    expect(detail.verification.computedHash).toBe(detail.manifestHash);
    expect((await listReferenceReleases(g.r.id)).releases.map((r) => r.releaseNumber)).toEqual([1, 2]);
    expect((await resolveLatestReferenceRelease(g.r.id)).release?.id).toBe(releaseB.id);
    const empty = await ruleset("empty");
    expect((await resolveLatestReferenceRelease(empty.r.id)).release).toBeNull();
    expect((await listReferenceReleases(empty.r.id)).releases).toEqual([]);
  });

  it("M6-I018 comparison reuses the M2 composition diff: CHANGED_VERSION / REMOVED_ENTITY / ADDED_ENTITY + unchanged", async () => {
    const diff = await compareReferenceReleases(g.r.id, releaseA.id, releaseB.id, { page: 1, pageSize: 50 });
    expect(diff.counts).toEqual({ added: 1, removed: 1, changed: 1, unchanged: 2 });
    const byType = Object.fromEntries(diff.entries.map((e) => [e.type, e]));
    expect(byType.CHANGED_VERSION).toEqual(expect.objectContaining({ entityId: push.id, canonicalKey: push.canonicalKey, from: expect.objectContaining({ revisionNumber: 1 }), to: expect.objectContaining({ revisionNumber: 2 }) }));
    expect(byType.REMOVED_ENTITY).toEqual(expect.objectContaining({ entityId: removed.id, to: null }));
    expect(byType.ADDED_ENTITY).toEqual(expect.objectContaining({ entityId: added.id, from: null }));
    expect((await compareReferenceReleases(g.r.id, releaseA.id, releaseB.id, { page: 1, pageSize: 50, type: "ADDED_ENTITY" })).entries).toHaveLength(1);
    await expectCode(compareReferenceReleases(g.r.id, releaseA.id, releaseH.id, { page: 1, pageSize: 5 }), COMPENDIUM_REFERENCE_ERROR_CODES.RELEASE_NOT_IN_RULESET);
  });

  it("M6-I015 every M5 Ability-component kind and Affinity reads with its catalog kind; an unsupported schema version is flagged, verbatim", async () => {
    const all = [...abilityDefinitionFixture().bundle.definitions, ...durationConditionFixture().bundle.definitions] as ProwessDefinitionEnvelope[];
    const wanted = ["SPELL_TARGETING", "SPELL_EFFECT", "SPELL_TRAIT", "SPELL_DURATION", "SPELL_CASTING_CONDITION", "MANEUVER_TARGETING", "MANEUVER_EFFECT", "MANEUVER_TRAIT", "MANEUVER_DURATION", "MANEUVER_CONDITION", "MANEUVER_FOUNDATION", "AFFINITY"];
    const picks = wanted.map((k) => all.find((d) => d.definitionKind === k)).filter((d): d is ProwessDefinitionEnvelope => d !== undefined);
    expect(picks.map((d) => d.definitionKind).sort()).toEqual([...wanted].sort());
    const pins: Array<{ entityId: string; entityVersionId: string }> = [];
    for (const d of picks) {
      const e = await entity(PROWESS_DEFINITION_KINDS[d.definitionKind].entityTypes[0] as string, d.definitionKind.toLowerCase());
      const v = await approved(e.id, d.canonicalKey, { prowessDefinition: { schemaVersion: d.schemaVersion, systemFamily: d.systemFamily, definitionKind: d.definitionKind, payload: JSON.parse(JSON.stringify(d.payload)) as unknown } });
      pins.push({ entityId: e.id, entityVersionId: v.id });
    }
    const future = await entity("SPELL_EFFECT", "future_schema");
    const fv = await approved(future.id, "Future Schema Effect", definition("SPELL_EFFECT", { anything: { goes: true } }, 99));
    pins.push({ entityId: future.id, entityVersionId: fv.id });
    const k = await ruleset("families");
    const rel = await publish(k, "F1", pins);
    for (const [i, d] of picks.entries()) {
      const detail = await getReferenceEntry(k.r.id, rel.id, pins[i]!.entityId);
      expect([detail.kind?.definitionKind, detail.schemaVersionSupported], d.definitionKind).toEqual([d.definitionKind, true]);
      expect(detail.definition?.payload, d.definitionKind).toEqual(JSON.parse(JSON.stringify(d.payload)));
    }
    const historical = await getReferenceEntry(k.r.id, rel.id, future.id);
    expect([historical.kind?.definitionKind, historical.schemaVersionSupported, historical.definition?.schemaVersion, historical.definition?.payload]).toEqual(["SPELL_EFFECT", false, 99, { anything: { goes: true } }]);
  });

  it("M6-I020 every Rules Reference read leaves the database byte-identical", async () => {
    const before = await fingerprint();
    await listReferenceReleases(g.r.id);
    await resolveLatestReferenceRelease(g.r.id);
    await getReferenceRelease(g.r.id, releaseA.id);
    await listReferenceEntries(g.r.id, releaseA.id, { page: 1, pageSize: 50, search: "force", keywordId: control.id });
    await getReferenceEntry(g.r.id, releaseA.id, push.id);
    await getReferenceEntry(g.r.id, releaseA.id, trait.id);
    await compareReferenceReleases(g.r.id, releaseA.id, releaseB.id, { page: 1, pageSize: 50 });
    expect(await fingerprint()).toEqual(before);
  });
});
