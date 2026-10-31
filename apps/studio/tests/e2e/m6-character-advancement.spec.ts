import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type APIRequestContext } from "@playwright/test";

/**
 * PAS-10 M6-WO4 §122–§126 — Character advancement through the REAL Studio UI.
 *
 * A Release capable of creation AND advancement is published through the existing API exactly as the Canon Manager
 * would: the canonical Core Playtest core / runtime Definitions, executable Affinities and the canonical Ability
 * Construction Rule (stored under test-only canonical keys; its Arcane / Martial Skill keys point at this test's Skills),
 * plus TEST-ONLY character content — a Character Creation Rule, a Character Advancement Rule with the playtest cadence,
 * Skills, the "Orcani" test Ancestry and one Spell Effect whose structured prerequisite is Arcana EXPERT. Never canon.
 *
 * 1. Level 1 → 2 (Stat Points only) and Level 2 → 3 (automatic Primary Trained, Skill upgrade that unlocks the Effect).
 * 2. A complex Level (5 → 6: Stat, new Skill, Affinity choice), then a newer Release with a different advancement
 *    schedule leaves the Character, its history and its next entitlements unchanged.
 */
const CONTENT = path.resolve(process.cwd(), "../../packages/prowess-game/src/content/core-playtest-v0.1"); // Playwright runs from apps/studio
type Row = { canonicalKey: string; definitionKind: string; schemaVersion?: number; payload: unknown };
const rows = (file: string) => (JSON.parse(readFileSync(path.join(CONTENT, file), "utf8")) as { definitions: Row[] }).definitions;
const SOURCE = { locators: ["s159"], conflicts: [] };
type Id = { id: string };
type Pin = { entityId: string; entityVersionId: string; canonicalKey: string; definitionKind: string; systemFamily: string };
type World = { tag: string; rulesetId: string; rulesetName: string; policyId: string; r1: Id & { manifestId: string }; pins: Map<string, Pin> };

async function post<T>(request: APIRequestContext, url: string, data?: unknown): Promise<T> {
  const r = await request.post(url, data === undefined ? {} : { data });
  expect(r.ok(), `${url}: ${await r.text()}`).toBe(true);
  return (await r.json()).data as T;
}
async function put<T>(request: APIRequestContext, url: string, data: unknown): Promise<T> {
  const r = await request.put(url, { data });
  expect(r.ok(), `${url}: ${await r.text()}`).toBe(true);
  return (await r.json()).data as T;
}
const advancementRule = (statPoints: (level: number) => number) => ({
  levels: [2, 3, 4, 5, 6, 7, 8, 9, 10].map((level) => ({ level, statPoints: statPoints(level), skillAdvancements: [3, 5, 6, 8, 9, 10].includes(level) ? 1 : 0 })),
  source: SOURCE,
});

async function seed(request: APIRequestContext): Promise<World> {
  const tag = `${Date.now()}_${Math.floor(Math.random() * 1e4)}`;
  const catalog = (await (await request.get("/api/compendium-authoring/catalog")).json()).data as { kinds: Array<{ definitionKind: string; systemFamily: string; allowedEntityTypes: string[] }> };
  const kind = (k: string) => catalog.kinds.find((x) => x.definitionKind === k)!;
  const pins = new Map<string, Pin>();
  const stored = (k: string, payload: unknown, schemaVersion = 1) => ({ prowessDefinition: { schemaVersion, systemFamily: kind(k).systemFamily, definitionKind: k, payload } });
  async function add(contentKey: string, k: string, payload: unknown, displayName: string, schemaVersion = 1) {
    const canonicalKey = `test.e2e_m6wo4.${contentKey.replace(/\./g, "_")}_${tag}`;
    const e = await post<Id>(request, "/api/entities", { entityType: kind(k).allowedEntityTypes[0], canonicalKey });
    const v = await post<Id>(request, `/api/entities/${e.id}/versions`, { displayName, structuredData: stored(k, payload, schemaVersion), shortDescription: `${displayName} — E2E test fixture` });
    await post(request, `/api/entity-versions/${v.id}/status`, { status: "IN_REVIEW" });
    await post(request, `/api/entity-versions/${v.id}/status`, { status: "APPROVED" });
    pins.set(contentKey, { entityId: e.id, entityVersionId: v.id, canonicalKey, definitionKind: k, systemFamily: kind(k).systemFamily });
  }
  // Sequential on purpose: the other E2E specs run in parallel against the same server; no request bursts.
  for (const d of [...rows("core-resolution.json"), ...rows("runtime-resources.json"), ...rows("affinity.json")]) await add(d.canonicalKey, d.definitionKind, d.payload, d.canonicalKey, d.schemaVersion ?? 1);
  await add("rule", "CHARACTER_CREATION_RULE", { startingLevel: 1, statPointBudget: 15, freeTrainedSkillCount: 2, startingSkillRankKey: "TRAINED", requiredAncestryCount: 1, requiredPrimaryAffinityCount: 1, source: SOURCE }, "Character Creation Rule E2E");
  await add("advancement", "CHARACTER_ADVANCEMENT_RULE", advancementRule((l) => (l === 10 ? 2 : 1)), `Character Advancement Rule E2E ${tag}`);
  for (const [key, name] of [["skill.athletics", "Athletics"], ["skill.survival", "Survival"], ["skill.stealth", "Stealth"], ["skill.arcana", "Arcana"], ["skill.martial", "Martial"]] as const) await add(key, "SKILL", { ladderKey: "SKILL", source: SOURCE }, `${name} E2E`);
  await add(
    "ancestry.orcani",
    "ANCESTRY",
    {
      baseHp: 10,
      baseMp: 4,
      statGrants: [
        { grantKey: "orcani_strength", kind: "FIXED", stat: "STR", amount: 2 },
        { grantKey: "orcani_versatility", kind: "CHOOSE_DISTINCT", count: 2, amount: 1, allowedStats: ["AGI", "CON", "PER", "RES", "PRO"] },
      ],
      skillGrants: [{ grantKey: "orcani_upbringing", rankKey: "TRAINED", selectionKind: "CHOOSE_FROM", count: 1, options: [pins.get("skill.athletics"), pins.get("skill.survival")] }],
      source: SOURCE,
    },
    `Orcani E2E ${tag}`,
  );
  const construction = JSON.parse(JSON.stringify(rows("ability-construction.json")[0]!.payload)) as { spell: { arcaneAuthority: { skillKey: string } }; maneuver: { martial: { skillKey: string } } };
  construction.spell.arcaneAuthority.skillKey = pins.get("skill.arcana")!.canonicalKey;
  construction.maneuver.martial.skillKey = pins.get("skill.martial")!.canonicalKey;
  await add("construction", "ABILITY_CONSTRUCTION_RULE", construction, "Ability Construction Rule E2E");
  await add(
    "effect.expert_lore",
    "SPELL_EFFECT",
    {
      effectFamily: "UTILITY",
      resolution: { mode: "SAVING_THROW", data: { authored: true } },
      outcomes: [{ outcomeKey: "on-fail", data: { authored: true } }],
      rules: { construction: { prerequisites: [{ prerequisiteKey: "ARCANA_EXPERT", kind: "SKILL_RANK_AT_LEAST", skillKey: pins.get("skill.arcana")!.canonicalKey, minimumRank: "EXPERT" }] } },
    },
    "Expert Lore E2E",
  );
  const rulesetName = `Advancement E2E ${tag}`;
  const rs = await post<Id>(request, "/api/rulesets", { canonicalKey: `test.e2e_m6wo4.ruleset_${tag}`, name: rulesetName, channel: "CORE_PLAYTEST" });
  await post(request, `/api/rulesets/${rs.id}/submit-review`);
  await post(request, `/api/rulesets/${rs.id}/approve`);
  const manifest = await post<Id>(request, `/api/rulesets/${rs.id}/manifests`, { entries: [...pins.values()].map((p) => ({ entityId: p.entityId, entityVersionId: p.entityVersionId })) });
  const policy = await post<Id>(request, `/api/rulesets/${rs.id}/canon-policies`, { name: "P", authorities: [] });
  const r1 = await post<Id & { manifestId: string }>(request, `/api/rulesets/${rs.id}/releases`, { baseManifestId: manifest.id, canonPolicyId: policy.id, versionLabel: "0.1.0" });
  return { tag, rulesetId: rs.id, rulesetName, policyId: policy.id, r1, pins };
}

/** A completed Level 1 Character, created through the WO3 API (the creation UI is proven by m6-character-creation.spec). */
async function completedCharacter(request: APIRequestContext, w: World, name: string) {
  const sel = (k: string) => ({ entityId: w.pins.get(k)!.entityId, entityVersionId: w.pins.get(k)!.entityVersionId });
  const c = await post<Id & { lockVersion: number }>(request, "/api/characters", { name, concept: null, rulesetReleaseId: w.r1.id });
  const saved = await put<{ lockVersion: number }>(request, `/api/characters/${c.id}/creation`, {
    expectedLockVersion: c.lockVersion,
    candidate: {
      ancestry: sel("ancestry.orcani"),
      ancestryStatChoices: [
        { grantKey: "orcani_versatility", stat: "AGI" },
        { grantKey: "orcani_versatility", stat: "PRO" },
      ],
      statAllocations: { STR: 3, AGI: 3, CON: 3, PER: 2, RES: 2, PRO: 2 },
      skills: [
        { skill: sel("skill.athletics"), sourceKind: "ANCESTRY", sourceGrantKey: "orcani_upbringing" },
        { skill: sel("skill.stealth"), sourceKind: "FREE", sourceGrantKey: null },
        { skill: sel("skill.arcana"), sourceKind: "FREE", sourceGrantKey: null },
      ],
      primaryAffinity: sel("affinity.evocation"),
    },
  });
  const done = await post<Id & { lockVersion: number }>(request, `/api/characters/${c.id}/finalize`, { expectedLockVersion: saved.lockVersion });
  return { id: done.id, lockVersion: done.lockVersion, sel };
}

test.describe.configure({ mode: "serial" });
let world: World;
test.beforeAll(async ({ playwright, baseURL }) => {
  test.setTimeout(240_000);
  const request = await playwright.request.newContext({ baseURL });
  world = await seed(request);
  await request.dispose();
});

test("a player advances a Character from Level 1 to 2 and 2 to 3; access opens from the exact prerequisite", async ({ page, request }) => {
  test.setTimeout(180_000);
  const c = await completedCharacter(request, world, `Grukk ${world.tag}`);
  await page.goto(`/characters/${c.id}`);
  await expect(page.getByTestId("profile-level")).toHaveText("1 of 10");
  await expect(page.getByTestId("access-arcane")).toHaveText("Trained (needs Trained) — Available");
  await expect(page.getByTestId("advancement-history")).toHaveCount(0);

  // Level 1 → 2: one Stat Point, nothing else.
  await page.getByRole("link", { name: "Advance Character" }).click();
  await page.waitForURL(`**/characters/${c.id}/advance`);
  await expect(page.getByTestId("advance-levels")).toHaveText("Level 1 → 2");
  await expect(page.getByTestId("advance-release")).toHaveText(`Pinned to ${world.rulesetName} — Release 1 (0.1.0)`);
  await expect(page.getByTestId("summary-stat-points")).toHaveText("1");
  await expect(page.getByTestId("summary-affinity")).toHaveText("None at this Level");
  await expect(page.getByRole("button", { name: "Advance Character" })).toBeDisabled();
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(page.getByTestId("advance-points")).toHaveText("Points Remaining: 1 of 1");
  await page.getByRole("button", { name: "Add a point to PER" }).click();
  await expect(page.getByTestId("advance-points")).toHaveText("Points Remaining: 0 of 1");
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(page.getByTestId("review-after-level")).toHaveText("2");
  await expect(page.getByTestId("review-after-PER")).toHaveText("4");
  await expect(page.getByTestId("advance-ready")).toBeVisible();
  await page.getByRole("button", { name: "Advance Character" }).click();
  await page.waitForURL(`**/characters/${c.id}`);
  await expect(page.getByTestId("profile-level")).toHaveText("2 of 10");
  await expect(page.getByTestId("profile-final-PER")).toHaveText("4");
  await expect(page.getByTestId("history-level-2")).toContainText("+1 PER");

  // Level 2 → 3: automatic Primary Trained, a Stat Point and an Arcana upgrade that opens the EXPERT-gated Effect.
  await page.getByRole("link", { name: "Advance Character" }).click();
  await expect(page.getByTestId("advance-levels")).toHaveText("Level 2 → 3");
  await expect(page.getByTestId("summary-die")).toHaveText("d4 → d6");
  await expect(page.getByTestId("summary-affinity")).toContainText("Automatic: Primary Trained");
  await page.getByRole("button", { name: "2. Stat Points" }).click();
  await page.getByRole("button", { name: "Add a point to PRO" }).click();
  await expect(page.getByTestId("advance-points")).toHaveText("Points Remaining: 0 of 1");
  await page.getByRole("button", { name: "3. Skill Advancement" }).click();
  await page.getByTestId("skill-upgrade-option").filter({ hasText: "Arcana E2E" }).getByRole("radio").check();
  await page.getByRole("button", { name: "4. Review" }).click();
  await expect(page.getByTestId("review-after-die")).toHaveText("d6");
  await expect(page.getByTestId("review-after-affinity")).toHaveText("Trained");
  await expect(page.getByTestId("newly-eligible")).toContainText(world.pins.get("effect.expert_lore")!.canonicalKey);
  await expect(page.getByTestId("advance-ready")).toBeVisible();
  await page.getByRole("button", { name: "Advance Character" }).click();
  await page.waitForURL(`**/characters/${c.id}`);
  await expect(page.getByTestId("profile-level")).toHaveText("3 of 10");
  await expect(page.getByTestId("profile-die")).toHaveText("D6 (d6)");
  await expect(page.getByTestId("access-arcane")).toHaveText("Expert (needs Trained) — Available");
  await expect(page.getByTestId("history-level-3")).toContainText("Arcana E2E — rank upgrade");
  await expect(page.getByTestId("history-level-2")).toContainText("+1 PER");
  // The Level 1 creation record stays as it was.
  await expect(page.getByText("Level 1 creation record")).toBeVisible();
});

test("a complex Level (5 → 6) and a newer Release that changes nothing for this Character", async ({ page, request }) => {
  test.setTimeout(180_000);
  const c = await completedCharacter(request, world, `Vasha ${world.tag}`);
  let lockVersion = c.lockVersion;
  for (const choices of [
    { statAllocations: { PER: 1 }, skillAdvancements: [], affinityChoice: null },
    { statAllocations: { PRO: 1 }, skillAdvancements: [{ action: "UPGRADE", skill: c.sel("skill.athletics") }], affinityChoice: null },
    { statAllocations: { AGI: 1 }, skillAdvancements: [], affinityChoice: null },
    { statAllocations: { CON: 1 }, skillAdvancements: [{ action: "UPGRADE", skill: c.sel("skill.arcana") }], affinityChoice: null },
  ]) {
    lockVersion = (await post<{ lockVersion: number }>(request, `/api/characters/${c.id}/advance`, { expectedLockVersion: lockVersion, choices })).lockVersion;
  }
  await page.goto(`/characters/${c.id}/advance`);
  await expect(page.getByTestId("advance-levels")).toHaveText("Level 5 → 6");
  const steps = page.getByRole("navigation", { name: "Advancement steps" }).getByRole("button");
  await expect(steps).toHaveText(["1. Next Level", "2. Stat Points", "3. Skill Advancement", "4. Affinity Progression", "5. Review"]);
  await steps.nth(1).click();
  await page.getByRole("button", { name: "Add a point to RES" }).click();
  await expect(page.getByTestId("advance-points")).toHaveText("Points Remaining: 0 of 1");
  await steps.nth(2).click();
  await page.getByTestId("skill-train-option").filter({ hasText: "Martial E2E" }).getByRole("radio").check();
  await steps.nth(3).click();
  await expect(page.getByTestId("affinity-option")).toHaveCount(2);
  await page.getByTestId("affinity-option").filter({ hasText: "Primary Expert" }).getByRole("radio").check();
  await steps.nth(4).click();
  await expect(page.getByTestId("review-after-level")).toHaveText("6");
  await expect(page.getByTestId("review-after-affinity")).toHaveText("Expert");
  await expect(page.getByTestId("advance-ready")).toBeVisible();
  await page.getByRole("button", { name: "Advance Character" }).click();
  await page.waitForURL(`**/characters/${c.id}`);
  await expect(page.getByTestId("profile-level")).toHaveText("6 of 10");
  await expect(page.getByTestId("profile-affinity").first()).toContainText("Primary, Expert");
  await expect(page.getByTestId("access-martial")).toHaveText("Trained (needs Trained) — Available");
  await expect(page.getByTestId("history-level-6")).toContainText("Martial E2E — new training");
  for (const level of [2, 3, 4, 5, 6]) await expect(page.getByTestId(`history-level-${level}`)).toBeVisible();
  const profileBefore = await page.getByTestId("character-profile").textContent();

  // §125 — a newer Release with a different schedule (3 Stat Points per Level): this Character is unchanged.
  const adv = world.pins.get("advancement")!;
  const v = await post<Id>(request, `/api/entities/${adv.entityId}/versions`, {
    displayName: "Character Advancement Rule E2E (revised)",
    structuredData: { prowessDefinition: { schemaVersion: 1, systemFamily: adv.systemFamily, definitionKind: adv.definitionKind, payload: advancementRule(() => 3) } },
    shortDescription: "revised — E2E test fixture",
  });
  await post(request, `/api/entity-versions/${v.id}/status`, { status: "IN_REVIEW" });
  await post(request, `/api/entity-versions/${v.id}/status`, { status: "APPROVED" });
  const cs = await post<Id>(request, `/api/rulesets/${world.rulesetId}/change-sets`, { name: `Cadence ${world.tag}`, operations: [{ operationType: "REPLACE_ENTITY_VERSION", targetEntityId: adv.entityId, fromEntityVersionId: adv.entityVersionId, toEntityVersionId: v.id }] });
  await post(request, `/api/change-sets/${cs.id}/submit-review`);
  await post(request, `/api/change-sets/${cs.id}/approve`);
  await post(request, `/api/rulesets/${world.rulesetId}/releases`, { baseManifestId: world.r1.manifestId, canonPolicyId: world.policyId, changeSetId: cs.id, versionLabel: "0.2.0" });
  await page.reload();
  await expect(page.getByTestId("character-pinned-release")).toHaveText(`Pinned to ${world.rulesetName} — Release 1 (0.1.0)`);
  await expect(page.getByTestId("character-profile")).toHaveText(profileBefore ?? "");
  await page.getByRole("link", { name: "Advance Character" }).click();
  await expect(page.getByTestId("advance-levels")).toHaveText("Level 6 → 7");
  await expect(page.getByTestId("summary-stat-points")).toHaveText("1");
});
