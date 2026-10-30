import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type APIRequestContext } from "@playwright/test";

/**
 * PAS-10 M6-WO3 §104–§106 — core Character creation through the REAL Studio UI.
 *
 * A Character-Creation-capable Release is published through the existing API exactly as the Canon Manager would: the
 * canonical Core Playtest core / runtime Definitions and executable Affinities (stored under test-only canonical keys),
 * plus TEST-ONLY character content — a Character Creation Rule, five Skills and the "Orcani" test Ancestry. Never canon.
 *
 * Characters → New Character → exact Release → Draft → Race + its Stat choices → Stat points → starting Skills → Primary
 * Affinity → Review (server-derived values) → save → Complete Core Creation → reopen. A newer Release (a revised Ancestry
 * with Base HP 12) is then published: the Character still shows Release 1 and identical values, and the index lists it.
 */
const CONTENT = path.resolve(process.cwd(), "../../packages/prowess-game/src/content/core-playtest-v0.1"); // Playwright runs from apps/studio
type Row = { canonicalKey: string; definitionKind: string; schemaVersion?: number; payload: unknown };
const rows = (file: string) => (JSON.parse(readFileSync(path.join(CONTENT, file), "utf8")) as { definitions: Row[] }).definitions;
const SOURCE = { locators: ["s20"], conflicts: [] };
type Id = { id: string };
type Pin = { entityId: string; entityVersionId: string; canonicalKey: string; definitionKind: string; systemFamily: string };

async function post<T>(request: APIRequestContext, url: string, data?: unknown): Promise<T> {
  const r = await request.post(url, data === undefined ? {} : { data });
  expect(r.ok(), `${url}: ${await r.text()}`).toBe(true);
  return (await r.json()).data as T;
}

test("a player creates, completes and reopens a Level 1 Character pinned to its exact Release", async ({ page, request }) => {
  test.setTimeout(180_000);
  const tag = `${Date.now()}`;
  const catalog = (await (await request.get("/api/compendium-authoring/catalog")).json()).data as { kinds: Array<{ definitionKind: string; systemFamily: string; allowedEntityTypes: string[] }> };
  const kind = (k: string) => catalog.kinds.find((x) => x.definitionKind === k)!;
  const pins = new Map<string, Pin>();
  const stored = (k: string, schemaVersion: number, payload: unknown) => ({ prowessDefinition: { schemaVersion, systemFamily: kind(k).systemFamily, definitionKind: k, payload } });
  async function approved(entityId: string, displayName: string, structuredData: object) {
    const v = await post<Id>(request, `/api/entities/${entityId}/versions`, { displayName, structuredData, shortDescription: `${displayName} — E2E test fixture` });
    await post(request, `/api/entity-versions/${v.id}/status`, { status: "IN_REVIEW" });
    await post(request, `/api/entity-versions/${v.id}/status`, { status: "APPROVED" });
    return v;
  }
  async function add(contentKey: string, k: string, schemaVersion: number, payload: unknown, displayName: string) {
    const canonicalKey = `test.e2e_m6wo3.${contentKey.replace(/\./g, "_")}_${tag}`;
    const e = await post<Id>(request, "/api/entities", { entityType: kind(k).allowedEntityTypes[0], canonicalKey });
    const v = await approved(e.id, displayName, stored(k, schemaVersion, payload));
    pins.set(contentKey, { entityId: e.id, entityVersionId: v.id, canonicalKey, definitionKind: k, systemFamily: kind(k).systemFamily });
  }
  const ref = (k: string) => pins.get(k)!;
  const content = [...rows("core-resolution.json"), ...rows("runtime-resources.json"), ...rows("affinity.json")];
  // Sequential on purpose: the other E2E specs run in parallel against the same server; no request bursts.
  for (const d of content) await add(d.canonicalKey, d.definitionKind, d.schemaVersion ?? 1, d.payload, d.canonicalKey === "affinity.evocation" ? `Evocation E2E ${tag}` : d.canonicalKey);
  await add("rule", "CHARACTER_CREATION_RULE", 1, { startingLevel: 1, statPointBudget: 15, freeTrainedSkillCount: 2, startingSkillRankKey: "TRAINED", requiredAncestryCount: 1, requiredPrimaryAffinityCount: 1, source: SOURCE }, `Character Creation Rule E2E ${tag}`);
  for (const s of ["Athletics", "Survival", "Stealth", "Arcana", "Perception"]) await add(`skill.${s.toLowerCase()}`, "SKILL", 1, { ladderKey: "SKILL", source: SOURCE }, `${s} E2E`);
  const ancestry = (baseHp: number) => ({
    baseHp,
    baseMp: 4,
    statGrants: [
      { grantKey: "orcani_strength", kind: "FIXED", stat: "STR", amount: 2 },
      { grantKey: "orcani_versatility", kind: "CHOOSE_DISTINCT", count: 2, amount: 1, allowedStats: ["AGI", "CON", "PER", "RES", "PRO"] },
    ],
    skillGrants: [{ grantKey: "orcani_upbringing", rankKey: "TRAINED", selectionKind: "CHOOSE_FROM", count: 1, options: [ref("skill.athletics"), ref("skill.survival")] }],
    source: SOURCE,
  });
  await add("ancestry.orcani", "ANCESTRY", 1, ancestry(10), `Orcani E2E ${tag}`);

  const rulesetName = `Characters E2E ${tag}`;
  const rs = await post<Id>(request, "/api/rulesets", { canonicalKey: `test.e2e_m6wo3.ruleset_${tag}`, name: rulesetName, channel: "CORE_PLAYTEST" });
  await post(request, `/api/rulesets/${rs.id}/submit-review`);
  await post(request, `/api/rulesets/${rs.id}/approve`);
  const manifest = await post<Id>(request, `/api/rulesets/${rs.id}/manifests`, { entries: [...pins.values()].map((p) => ({ entityId: p.entityId, entityVersionId: p.entityVersionId })) });
  const policy = await post<Id>(request, `/api/rulesets/${rs.id}/canon-policies`, { name: "P", authorities: [] });
  const r1 = await post<Id & { manifestId: string }>(request, `/api/rulesets/${rs.id}/releases`, { baseManifestId: manifest.id, canonPolicyId: policy.id, versionLabel: "0.1.0" });
  const pinnedLabel = `${rulesetName} — Release 1 (0.1.0)`;

  // Characters → New Character: Ruleset → exact Release (nothing preselected) → capability → name → Draft.
  await page.goto("/characters");
  await expect(page.getByRole("heading", { level: 1, name: "Characters" })).toBeVisible();
  await page.getByRole("link", { name: "New Character" }).click();
  await page.getByRole("combobox", { name: "Ruleset", exact: true }).selectOption({ label: rulesetName });
  await page.getByRole("combobox", { name: "Release", exact: true }).selectOption(r1.id);
  await expect(page.getByTestId("capability-ready")).toBeVisible();
  const name = `Grukk ${tag}`;
  await page.getByLabel("Name (required)").fill(name);
  await page.getByLabel("Concept (optional)").fill("A wandering bruiser");
  await page.getByRole("button", { name: "Create Character Draft" }).click();
  await page.waitForURL(/\/characters\/[0-9a-f-]+\/create$/);
  const characterId = page.url().split("/").at(-2)!;
  await expect(page.getByTestId("wizard-release")).toHaveText(`Pinned to ${pinnedLabel}`);

  // Race / Ancestry and its Stat choices.
  await page.getByRole("button", { name: "2. Race / Ancestry" }).click();
  const card = page.getByTestId("ancestry-card").filter({ hasText: `Orcani E2E ${tag}` });
  await expect(card).toContainText("Base HP 10 · Base MP 4");
  await expect(card.getByRole("link", { name: "Rules Reference" })).toHaveAttribute("href", `/compendium/rulesets/${rs.id}/releases/${r1.id}/entities/${ref("ancestry.orcani").entityId}`);
  await card.getByRole("radio").check();
  await page.getByLabel("Stat choice 1 of 2").selectOption("AGI");
  await page.getByLabel("Stat choice 2 of 2").selectOption("PRO");
  await page.getByRole("button", { name: "Save & Continue" }).click();
  await expect(page.getByRole("heading", { level: 2, name: "Stats" })).toBeVisible();

  // Stats: spend all 15 points (the server reports Points Remaining).
  await expect(page.getByTestId("points-remaining")).toHaveText("Points Remaining: 15 of 15");
  for (const [stat, n] of [["STR", 3], ["AGI", 3], ["CON", 3], ["PER", 2], ["RES", 2], ["PRO", 2]] as const) {
    for (let i = 0; i < n; i += 1) await page.getByRole("button", { name: `Add a point to ${stat}` }).click();
  }
  await expect(page.getByTestId("points-remaining")).toHaveText("Points Remaining: 0 of 15");
  await expect(page.getByTestId("stat-row-STR").locator("td").nth(3)).toHaveText("6");
  await expect(page.getByRole("button", { name: "Add a point to STR" })).toBeDisabled();
  await page.getByRole("button", { name: "Save & Continue" }).click();
  await expect(page.getByRole("heading", { level: 2, name: "Skills" })).toBeVisible();

  // Skills: one Race choice + two free trained Skills; duplicates are disabled.
  await page.getByLabel("Race Skill 1").selectOption({ label: "Athletics E2E" });
  await expect(page.getByLabel("Free Skill 1").locator("option", { hasText: "Athletics E2E" })).toHaveJSProperty("disabled", true);
  await page.getByLabel("Free Skill 1").selectOption({ label: "Stealth E2E" });
  await page.getByLabel("Free Skill 2").selectOption({ label: "Arcana E2E" });
  await page.getByRole("button", { name: "Save & Continue" }).click();
  await expect(page.getByRole("heading", { level: 2, name: "Primary Affinity" })).toBeVisible();

  // Primary Affinity.
  await page.getByTestId("affinity-card").filter({ hasText: `Evocation E2E ${tag}` }).getByRole("radio").check();
  await page.getByRole("button", { name: "Save & Continue" }).click();

  // Review: server-derived values; then Complete Core Creation.
  await expect(page.getByRole("heading", { level: 2, name: "Review" }).first()).toBeVisible();
  await expect(page.getByTestId("check-ready")).toBeVisible();
  const expectValues = async () => {
    await expect(page.getByTestId("final-STR")).toHaveText("6");
    await expect(page.getByTestId("final-AGI")).toHaveText("5");
    await expect(page.getByTestId("final-CON")).toHaveText("4");
    await expect(page.getByTestId("final-PRO")).toHaveText("4");
    await expect(page.getByTestId("derived-MAXIMUM_HP")).toHaveText("14");
    await expect(page.getByTestId("derived-MAXIMUM_MP")).toHaveText("7");
    await expect(page.getByTestId("derived-SIGNATURE_ABILITY_SLOTS")).toHaveText("4");
    await expect(page.getByTestId("review-ancestry")).toContainText(`Orcani E2E ${tag}`);
    await expect(page.getByTestId("review-affinity")).toContainText(`Evocation E2E ${tag}`);
    await expect(page.getByTestId("character-release")).toHaveText(pinnedLabel);
  };
  await expectValues();
  await page.getByRole("button", { name: "Complete Core Creation" }).click();
  await page.waitForURL(`**/characters/${characterId}`);
  await expect(page.getByTestId("character-status")).toHaveText("Core Creation Complete");
  await expect(page.getByTestId("character-pinned-release")).toHaveText(`Pinned to ${pinnedLabel}`);
  await expectValues();

  // The completed build is read-only in the wizard.
  await page.goto(`/characters/${characterId}/create`);
  await expect(page.getByTestId("wizard-read-only")).toBeVisible();
  await expect(page.getByRole("button", { name: "Save & Continue" })).toHaveCount(0);

  // §105 — a newer Release (revised Ancestry: Base HP 12) never changes this Character.
  const revised = await approved(ref("ancestry.orcani").entityId, `Orcani E2E ${tag} (revised)`, stored("ANCESTRY", 1, ancestry(12)));
  const cs = await post<Id>(request, `/api/rulesets/${rs.id}/change-sets`, { name: "Orcani rework", operations: [{ operationType: "REPLACE_ENTITY_VERSION", targetEntityId: ref("ancestry.orcani").entityId, fromEntityVersionId: ref("ancestry.orcani").entityVersionId, toEntityVersionId: revised.id }] });
  await post(request, `/api/change-sets/${cs.id}/submit-review`);
  await post(request, `/api/change-sets/${cs.id}/approve`);
  await post(request, `/api/rulesets/${rs.id}/releases`, { baseManifestId: r1.manifestId, canonPolicyId: policy.id, changeSetId: cs.id, versionLabel: "0.2.0" });
  await page.goto(`/characters/${characterId}`);
  await expect(page.getByTestId("character-pinned-release")).toHaveText(`Pinned to ${pinnedLabel}`);
  await expectValues();

  // §106 — the index lists the Character; opening it returns the exact saved Character.
  await page.goto("/characters");
  const row = page.getByTestId("character-row").filter({ hasText: name });
  await expect(row).toContainText("Core Creation Complete");
  await expect(row).toContainText(pinnedLabel);
  await expect(row.locator("td").first()).toHaveText("1");
  await row.getByRole("link", { name }).click();
  await page.waitForURL(`**/characters/${characterId}`);
  await expectValues();
});
