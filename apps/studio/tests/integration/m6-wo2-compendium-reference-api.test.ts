/**
 * PAS-10 M6-WO2 — Compendium Rules Reference: HTTP-level integration proof. Every read goes through a REAL route
 * handler against the real prowess_studio_test database; fixtures are created through the existing public services
 * (M1 Entities / revisions, M2 Rulesets / Manifests / ChangeSets / Releases). Fixture content is test-only
 * (`test.m6wo2api.*`) and never game canon.
 *
 * Scenario: Ruleset G — Release A pins Force Push Revision 1; Release B (through an approved ChangeSet) pins Revision 2,
 * removes "Retired Rule" and adds "Brand New Rule"; Revision 3 is the latest revision and pinned by neither. A Trait
 * holds an exact reference to Force Push Revision 2. Ruleset H pins Revision 2 on its own; Ruleset E has no Release.
 *
 * Invariants exercised: M6-I011 Release scoping · M6-I012 pins never substituted · M6-I013 historical reproducibility ·
 * M6-I014 server-side facets · M6-I016 exact references · M6-I017 verification + Latest Release by query · M6-I018
 * comparison · M6-I020 read-only.
 */
import {
  approveChangeSet,
  approveRuleset,
  assertRunningAgainstTestDatabase,
  createCanonPolicy,
  createChangeSet,
  createEntity,
  createEntityVersion,
  createKeywordDefinition,
  createRuleset,
  createRulesetManifest,
  prisma,
  publishRulesetRelease,
  submitChangeSetForReview,
  submitRulesetForReview,
  transitionEntityVersionStatus,
} from "@prowess/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as Releases from "../../app/api/compendium-reference/rulesets/[rulesetId]/releases/route";
import * as Latest from "../../app/api/compendium-reference/rulesets/[rulesetId]/latest-release/route";
import * as Release from "../../app/api/compendium-reference/rulesets/[rulesetId]/releases/[releaseId]/route";
import * as Entries from "../../app/api/compendium-reference/rulesets/[rulesetId]/releases/[releaseId]/entities/route";
import * as Entry from "../../app/api/compendium-reference/rulesets/[rulesetId]/releases/[releaseId]/entities/[entityId]/route";
import * as Compare from "../../app/api/compendium-reference/rulesets/[rulesetId]/releases/[releaseId]/compare/[otherReleaseId]/route";
import { call, cleanupM2Rulesets, fingerprint } from "./m2-api-harness";
import { cleanupFixtures } from "./cleanup";

const PREFIX = "test.m6wo2api";
let n = 0;
const key = (label: string) => `${PREFIX}.${label}_${Date.now()}_${++n}`;
const TABLES = ["entities", "entity_versions", "entity_aliases", "entity_keywords", "entity_version_keywords", "entity_relationships", "source_references", "rulesets", "ruleset_manifests", "ruleset_manifest_entries", "ruleset_releases", "change_sets", "change_set_operations", "canon_policies"];

const w: Record<string, string> = {};
const base = () => `/api/compendium-reference/rulesets/${w.g}`;

async function approved(entityId: string, displayName: string, structuredData: object = {}) {
  const v = await createEntityVersion(entityId, { displayName, structuredData });
  await transitionEntityVersionStatus(v.id, "IN_REVIEW");
  return transitionEntityVersionStatus(v.id, "APPROVED");
}
async function ruleset(label: string) {
  const r = await createRuleset({ canonicalKey: key(`ruleset_${label}`), name: `M6-WO2 API ${label}`, channel: "CORE_PLAYTEST", versionLabel: label });
  await submitRulesetForReview(r.id);
  await approveRuleset(r.id);
  return { r, policy: await createCanonPolicy(r.id, { name: `P ${label}`, authorities: [] }) };
}
const effect = (feet: number, keyword: string) => ({
  prowessDefinition: { schemaVersion: 1, systemFamily: "SPELL", definitionKind: "SPELL_EFFECT", payload: { effectFamily: "MOVEMENT", keywords: [keyword], parameters: {}, compatibility: [], costContributions: [], rules: {}, resolution: null, outcomes: [{ outcomeKey: "push", data: { feet } }] } },
});

async function cleanup() {
  await cleanupM2Rulesets(PREFIX);
  await cleanupFixtures({ entityPrefix: PREFIX, keywordPrefix: PREFIX });
}

describe("M6-WO2 Rules Reference API (prowess_studio_test only)", () => {
  beforeAll(async () => {
    assertRunningAgainstTestDatabase(process.env.DATABASE_URL ?? "");
    await cleanup();
    const control = await createKeywordDefinition({ canonicalKey: key("keyword_control"), name: "M6WO2 API Control" });
    w.keyword = control.id;
    const push = await createEntity({ entityType: "SPELL_EFFECT", canonicalKey: key("force_push") });
    w.push = push.id;
    const r1 = await approved(push.id, "Force Push", effect(10, control.canonicalKey));
    const r2 = await approved(push.id, "Force Push", effect(15, control.canonicalKey));
    w.r1 = r1.id;
    w.r2 = r2.id;
    const trait = await createEntity({ entityType: "SPELL_TRAIT", canonicalKey: key("piercing") });
    w.trait = trait.id;
    const tv = await approved(trait.id, "Piercing", {
      prowessDefinition: { schemaVersion: 1, systemFamily: "SPELL", definitionKind: "SPELL_TRAIT", payload: { traitFamily: "PIERCING", scope: "EFFECT", keywords: [], parameters: {}, compatibility: [], costContributions: [], rules: { pairsWith: { entityId: push.id, entityVersionId: r2.id, canonicalKey: push.canonicalKey, definitionKind: "SPELL_EFFECT", systemFamily: "SPELL" } } } },
    });
    const removed = await createEntity({ entityType: "GENERIC_RULE", canonicalKey: key("removed") });
    const removedV = await approved(removed.id, "Retired Rule");
    const added = await createEntity({ entityType: "GENERIC_RULE", canonicalKey: key("added") });
    const addedV = await approved(added.id, "Brand New Rule");
    w.removed = removed.id;
    w.added = added.id;

    const g = await ruleset("g");
    w.g = g.r.id;
    const mA = await createRulesetManifest(g.r.id, { entries: [{ entityId: push.id, entityVersionId: r1.id }, { entityId: trait.id, entityVersionId: tv.id }, { entityId: removed.id, entityVersionId: removedV.id }] });
    const a = await publishRulesetRelease({ rulesetId: g.r.id, baseManifestId: mA.id, canonPolicyId: g.policy.id, versionLabel: "A" });
    w.a = a.id;
    const cs = await createChangeSet(g.r.id, {
      name: "B",
      operations: [
        { operationType: "REPLACE_ENTITY_VERSION", targetEntityId: push.id, fromEntityVersionId: r1.id, toEntityVersionId: r2.id },
        { operationType: "REMOVE_ENTITY_FROM_MANIFEST", targetEntityId: removed.id, fromEntityVersionId: removedV.id },
        { operationType: "ADD_ENTITY_TO_MANIFEST", targetEntityId: added.id, toEntityVersionId: addedV.id },
      ],
    });
    await submitChangeSetForReview(cs.id);
    await approveChangeSet(cs.id);
    w.b = (await publishRulesetRelease({ rulesetId: g.r.id, baseManifestId: a.manifestId, canonPolicyId: g.policy.id, changeSetId: cs.id, versionLabel: "B" })).id;
    w.r3 = (await createEntityVersion(push.id, { displayName: "Force Push (rework)", structuredData: effect(99, control.canonicalKey) })).id;

    const h = await ruleset("h");
    w.h = h.r.id;
    const mH = await createRulesetManifest(h.r.id, { entries: [{ entityId: push.id, entityVersionId: r2.id }] });
    w.hRelease = (await publishRulesetRelease({ rulesetId: h.r.id, baseManifestId: mH.id, canonPolicyId: h.policy.id, versionLabel: "H1" })).id;
    w.empty = (await ruleset("empty")).r.id;
  });

  afterAll(cleanup);

  it("Release History and the Latest Release resolve by query to exact Releases; an empty Ruleset resolves to null", async () => {
    const history = await call(Releases.GET, "GET", `${base()}/releases`, { rulesetId: w.g! });
    expect(history.status).toBe(200);
    expect(history.data.releases.map((r: { id: string; releaseNumber: number; versionLabel: string }) => [r.id, r.releaseNumber, r.versionLabel])).toEqual([[w.a, 1, "A"], [w.b, 2, "B"]]);
    expect(history.data.releases[0]).toEqual(expect.objectContaining({ channel: "CORE_PLAYTEST", publishedAt: expect.any(String) }));
    const latest = await call(Latest.GET, "GET", `${base()}/latest-release`, { rulesetId: w.g! });
    expect(latest.data.release.id).toBe(w.b);
    const none = await call(Latest.GET, "GET", `/x`, { rulesetId: w.empty! });
    expect([none.status, none.data.release]).toEqual([200, null]);
    expect((await call(Releases.GET, "GET", `/x`, { rulesetId: w.empty! })).data.releases).toEqual([]);
  });

  it("Release metadata carries the server-side manifest verification and composition size", async () => {
    const r = await call(Release.GET, "GET", `${base()}/releases/${w.a}`, { rulesetId: w.g!, releaseId: w.a! });
    expect(r.status).toBe(200);
    expect(r.data).toEqual(expect.objectContaining({ releaseNumber: 1, versionLabel: "A", compositionSize: 3, manifestHash: expect.stringMatching(/^[0-9a-f]{64}$/), verification: expect.objectContaining({ valid: true }) }));
    expect(r.data.ruleset).toEqual(expect.objectContaining({ id: w.g, name: "M6-WO2 API g" }));
  });

  it("M6-I011 / M6-I012 entries are each Release's pins, paged and sorted on the server — never Revision 3", async () => {
    const a = await call(Entries.GET, "GET", `${base()}/releases/${w.a}/entities?pageSize=2`, { rulesetId: w.g!, releaseId: w.a! });
    expect(a.status).toBe(200);
    expect(a.body.pagination).toEqual({ page: 1, pageSize: 2, total: 3, totalPages: 2 });
    expect(a.data.map((c: { displayName: string }) => c.displayName)).toEqual(["Force Push", "Piercing"]);
    expect(a.data[0]).toEqual(expect.objectContaining({ entityVersionId: w.r1, revisionNumber: 1, definitionKind: "SPELL_EFFECT" }));
    const b = await call(Entries.GET, "GET", `${base()}/releases/${w.b}/entities`, { rulesetId: w.g!, releaseId: w.b! });
    expect(b.data.find((c: { entityId: string }) => c.entityId === w.push)).toEqual(expect.objectContaining({ entityVersionId: w.r2, revisionNumber: 2 }));
    expect(JSON.stringify([a.data, b.data])).not.toContain(w.r3);
    const generic = await call(Entries.GET, "GET", `${base()}/releases/${w.b}/entities?kind=GENERIC`, { rulesetId: w.g!, releaseId: w.b! });
    expect(generic.data.map((c: { entityId: string; definitionKind: string | null }) => [c.entityId, c.definitionKind])).toEqual([[w.added, null]]);
    const byKeyword = await call(Entries.GET, "GET", `${base()}/releases/${w.a}/entities?keywordId=${w.keyword}`, { rulesetId: w.g!, releaseId: w.a! });
    expect(byKeyword.data.map((c: { entityId: string }) => c.entityId)).toEqual([w.push]);
  });

  it("M6-I016 the entry is the exact pin with authored-vs-pinned references and the latest revision as an indicator only", async () => {
    const pushA = await call(Entry.GET, "GET", "/x", { rulesetId: w.g!, releaseId: w.a!, entityId: w.push! });
    expect(pushA.status).toBe(200);
    expect([pushA.data.pinnedRevision.id, pushA.data.pinnedRevision.revisionNumber, pushA.data.latestRevisionNumber]).toEqual([w.r1, 1, 3]);
    expect(pushA.data.definition.payload.outcomes[0].data.feet).toBe(10);
    expect(pushA.data.referencedBy.map((c: { entityId: string }) => c.entityId)).toEqual([w.trait]);
    const traitA = await call(Entry.GET, "GET", "/x", { rulesetId: w.g!, releaseId: w.a!, entityId: w.trait! });
    expect(traitA.data.references[0]).toEqual(expect.objectContaining({ path: "payload.rules.pairsWith", authoredRevisionNumber: 2, matchesPin: false, pinned: expect.objectContaining({ revisionNumber: 1 }) }));
    expect(traitA.data.references[0].authored.entityVersionId).toBe(w.r2);
    const traitB = await call(Entry.GET, "GET", "/x", { rulesetId: w.g!, releaseId: w.b!, entityId: w.trait! });
    expect(traitB.data.references[0].matchesPin).toBe(true);
  });

  it("M6-I018 comparison A → B: one changed revision, one removed, one added, one unchanged", async () => {
    const c = await call(Compare.GET, "GET", `/x`, { rulesetId: w.g!, releaseId: w.a!, otherReleaseId: w.b! });
    expect(c.status).toBe(200);
    expect(c.data.counts).toEqual({ added: 1, removed: 1, changed: 1, unchanged: 1 });
    expect(c.data.entries.map((e: { type: string; entityId: string }) => [e.type, e.entityId]).sort()).toEqual(
      [["ADDED_ENTITY", w.added], ["CHANGED_VERSION", w.push], ["REMOVED_ENTITY", w.removed]].sort(),
    );
    const only = await call(Compare.GET, "GET", `/x?type=CHANGED_VERSION`, { rulesetId: w.g!, releaseId: w.a!, otherReleaseId: w.b! });
    expect(only.data.entries).toEqual([expect.objectContaining({ from: expect.objectContaining({ revisionNumber: 1 }), to: expect.objectContaining({ revisionNumber: 2 }) })]);
  });

  it("errors are explicit and mapped: unknown query keys / bad ids 400, foreign Release or unpinned Entity 404 — never a fallback", async () => {
    const cases: Array<[unknown, string, Record<string, string>, number, string]> = [
      [Entries.GET, `/x?sort=latest`, { rulesetId: w.g!, releaseId: w.a! }, 400, "API.INVALID_QUERY"],
      [Entries.GET, `/x?kind=SPELL_FIREBALL`, { rulesetId: w.g!, releaseId: w.a! }, 400, "COMPENDIUM_REFERENCE.INVALID_INPUT"],
      [Release.GET, `/x`, { rulesetId: w.g!, releaseId: "nope" }, 400, "API.INVALID_UUID"],
      [Release.GET, `/x`, { rulesetId: w.g!, releaseId: w.hRelease! }, 404, "COMPENDIUM_REFERENCE.RELEASE_NOT_IN_RULESET"],
      [Entry.GET, `/x`, { rulesetId: w.g!, releaseId: w.a!, entityId: w.added! }, 404, "COMPENDIUM_REFERENCE.ENTITY_NOT_IN_RELEASE"],
      [Compare.GET, `/x`, { rulesetId: w.g!, releaseId: w.a!, otherReleaseId: w.hRelease! }, 404, "COMPENDIUM_REFERENCE.RELEASE_NOT_IN_RULESET"],
      [Release.GET, `/x`, { rulesetId: w.g!, releaseId: "00000000-0000-4000-8000-000000000000" }, 404, "RULESET_RELEASE.NOT_FOUND"],
      [Releases.GET, `/x`, { rulesetId: "00000000-0000-4000-8000-000000000000" }, 404, "RULESET_RELEASE.RULESET_NOT_FOUND"],
    ];
    for (const [handler, path, params, status, code] of cases) {
      const r = await call(handler, "GET", path, params);
      expect([r.status, r.body.error?.code], `${path} ${JSON.stringify(params)}`).toEqual([status, code]);
      expect(JSON.stringify(r.body)).not.toMatch(/at \w+ \(|prisma/i);
    }
  });

  it("M6-I013 / M6-I020 reads are byte-identical across time and write nothing; only GET is exported", async () => {
    const before = await fingerprint(TABLES);
    const first = await call(Entry.GET, "GET", "/x", { rulesetId: w.g!, releaseId: w.a!, entityId: w.push! });
    for (const [handler, params] of [
      [Releases.GET, { rulesetId: w.g! }],
      [Latest.GET, { rulesetId: w.g! }],
      [Release.GET, { rulesetId: w.g!, releaseId: w.a! }],
      [Entries.GET, { rulesetId: w.g!, releaseId: w.b! }],
      [Compare.GET, { rulesetId: w.g!, releaseId: w.a!, otherReleaseId: w.b! }],
    ] as const) {
      expect((await call(handler, "GET", "/x", params)).status).toBe(200);
    }
    const again = await call(Entry.GET, "GET", "/x", { rulesetId: w.g!, releaseId: w.a!, entityId: w.push! });
    expect(again.data).toEqual(first.data);
    expect(await fingerprint(TABLES)).toEqual(before);
    for (const mod of [Releases, Latest, Release, Entries, Entry, Compare]) expect(Object.keys(mod)).toEqual(["GET"]);
  });
});
