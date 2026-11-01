import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, type APIRequestContext } from "@playwright/test";

/**
 * PAS-10 M6-WO5 — the E2E Character world for the Digital Character Sheet specs (shared helper, not a spec). The same
 * capable Release as the M6-WO4 advancement spec, published through the existing API (test-only `test.e2e_m6wo5.*`
 * keys; never canon), plus a "Performance" Skill so the sheet proves every Release Skill renders.
 */
const CONTENT = path.resolve(process.cwd(), "../../packages/prowess-game/src/content/core-playtest-v0.1"); // Playwright runs from apps/studio
type Row = { canonicalKey: string; definitionKind: string; schemaVersion?: number; payload: unknown };
const rows = (file: string) => (JSON.parse(readFileSync(path.join(CONTENT, file), "utf8")) as { definitions: Row[] }).definitions;
const SOURCE = { locators: ["s159"], conflicts: [] };
export type Id = { id: string };
export type Pin = { entityId: string; entityVersionId: string; canonicalKey: string; definitionKind: string; systemFamily: string };
export type World = { tag: string; rulesetId: string; rulesetName: string; policyId: string; r1: Id & { manifestId: string }; pins: Map<string, Pin> };

export async function post<T>(request: APIRequestContext, url: string, data?: unknown): Promise<T> {
  const r = await request.post(url, data === undefined ? {} : { data });
  expect(r.ok(), `${url}: ${await r.text()}`).toBe(true);
  return (await r.json()).data as T;
}
export async function put<T>(request: APIRequestContext, url: string, data: unknown): Promise<T> {
  const r = await request.put(url, { data });
  expect(r.ok(), `${url}: ${await r.text()}`).toBe(true);
  return (await r.json()).data as T;
}
export const advancementRule = (statPoints: (level: number) => number) => ({
  levels: [2, 3, 4, 5, 6, 7, 8, 9, 10].map((level) => ({ level, statPoints: statPoints(level), skillAdvancements: [3, 5, 6, 8, 9, 10].includes(level) ? 1 : 0 })),
  source: SOURCE,
});

/** Adds one test Definition (Entity + approved EntityVersion) and pins it under its content key. */
export type AddDefinition = (contentKey: string, kind: string, payload: unknown, displayName: string, schemaVersion?: number) => Promise<void>;

/** `extra` (M6-WO6) adds more test content before the Release is published; the WO5 world is unchanged without it. */
export async function seed(request: APIRequestContext, extra?: (add: AddDefinition, pins: Map<string, Pin>) => Promise<void>): Promise<World> {
  const tag = `${Date.now()}_${Math.floor(Math.random() * 1e4)}`;
  const catalog = (await (await request.get("/api/compendium-authoring/catalog")).json()).data as { kinds: Array<{ definitionKind: string; systemFamily: string; allowedEntityTypes: string[] }> };
  const kind = (k: string) => catalog.kinds.find((x) => x.definitionKind === k)!;
  const pins = new Map<string, Pin>();
  const stored = (k: string, payload: unknown, schemaVersion = 1) => ({ prowessDefinition: { schemaVersion, systemFamily: kind(k).systemFamily, definitionKind: k, payload } });
  async function add(contentKey: string, k: string, payload: unknown, displayName: string, schemaVersion = 1) {
    const canonicalKey = `test.e2e_m6wo5.${contentKey.replace(/\./g, "_")}_${tag}`;
    const e = await post<Id>(request, "/api/entities", { entityType: kind(k).allowedEntityTypes[0], canonicalKey });
    const v = await post<Id>(request, `/api/entities/${e.id}/versions`, { displayName, structuredData: stored(k, payload, schemaVersion), shortDescription: `${displayName} — E2E test fixture` });
    await post(request, `/api/entity-versions/${v.id}/status`, { status: "IN_REVIEW" });
    await post(request, `/api/entity-versions/${v.id}/status`, { status: "APPROVED" });
    pins.set(contentKey, { entityId: e.id, entityVersionId: v.id, canonicalKey, definitionKind: k, systemFamily: kind(k).systemFamily });
  }
  // Sequential on purpose: the other E2E specs run in parallel against the same server; no request bursts.
  for (const d of [...rows("core-resolution.json"), ...rows("runtime-resources.json"), ...rows("affinity.json")]) await add(d.canonicalKey, d.definitionKind, d.payload, d.canonicalKey, d.schemaVersion ?? 1);
  await add("rule", "CHARACTER_CREATION_RULE", { startingLevel: 1, statPointBudget: 15, freeTrainedSkillCount: 2, startingSkillRankKey: "TRAINED", requiredAncestryCount: 1, requiredPrimaryAffinityCount: 1, source: SOURCE }, "Character Creation Rule E2E");
  await add("advancement", "CHARACTER_ADVANCEMENT_RULE", advancementRule((l) => (l === 10 ? 2 : 1)), `Character Advancement Rule E2E5 ${tag}`);
  for (const [key, name] of [["skill.athletics", "Athletics"], ["skill.survival", "Survival"], ["skill.stealth", "Stealth"], ["skill.arcana", "Arcana"], ["skill.martial", "Martial"], ["skill.performance", "Performance"]] as const) await add(key, "SKILL", { ladderKey: "SKILL", source: SOURCE }, `${name} E2E`);
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
  if (extra !== undefined) await extra(add, pins);
  const rulesetName = `Sheet E2E ${tag}`;
  const rs = await post<Id>(request, "/api/rulesets", { canonicalKey: `test.e2e_m6wo5.ruleset_${tag}`, name: rulesetName, channel: "CORE_PLAYTEST" });
  await post(request, `/api/rulesets/${rs.id}/submit-review`);
  await post(request, `/api/rulesets/${rs.id}/approve`);
  const manifest = await post<Id>(request, `/api/rulesets/${rs.id}/manifests`, { entries: [...pins.values()].map((p) => ({ entityId: p.entityId, entityVersionId: p.entityVersionId })) });
  const policy = await post<Id>(request, `/api/rulesets/${rs.id}/canon-policies`, { name: "P", authorities: [] });
  const r1 = await post<Id & { manifestId: string }>(request, `/api/rulesets/${rs.id}/releases`, { baseManifestId: manifest.id, canonPolicyId: policy.id, versionLabel: "0.1.0" });
  return { tag, rulesetId: rs.id, rulesetName, policyId: policy.id, r1, pins };
}

/** A completed Level 1 Character, created through the WO3 API (the creation UI is proven by m6-character-creation.spec). */
export async function completedCharacter(request: APIRequestContext, w: World, name: string) {
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

