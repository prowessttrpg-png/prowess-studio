import { readFileSync } from "node:fs";
import path from "node:path";
import type { APIRequestContext } from "@playwright/test";
import { post, put, seed, type Id, type Pin, type World } from "./m6-wo5-world";

/**
 * PAS-10 M6-WO6 — the E2E world for the Weapon & Attack specs (shared helper, not a spec): the M6-WO5 capable Release
 * plus every Equipment Trait and the Long Blade, Light Shield, Rifle and four Unarmed profiles from the baseline
 * Weapon content (test-only `test.e2e_m6wo5.*` keys; never canon). Content `{ "$ref": key }` placeholders resolve to
 * the exact pins, exactly as an authoring / import step would.
 */
const CONTENT = path.resolve(process.cwd(), "../../packages/prowess-game/src/content/core-playtest-v0.1/weapons.json"); // Playwright runs from apps/studio
type Row = { canonicalKey: string; definitionKind: string; displayName: string; payload: unknown };
const WEAPONS = ["weapon.long_blade", "weapon.light_shield", "weapon.rifle", "weapon.unarmed_untrained", "weapon.unarmed_trained", "weapon.unarmed_expert", "weapon.unarmed_master"];

function resolveRefs(value: unknown, pins: Map<string, Pin>): unknown {
  if (Array.isArray(value)) return value.map((v) => resolveRefs(v, pins));
  if (value !== null && typeof value === "object") {
    const o = value as Record<string, unknown>;
    if (Object.keys(o).length === 1 && typeof o.$ref === "string") {
      const pin = pins.get(o.$ref);
      if (pin === undefined) throw new Error(`unresolved content ref ${o.$ref}`);
      return { ...pin };
    }
    return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, resolveRefs(v, pins)]));
  }
  return value;
}

export async function seedWeapons(request: APIRequestContext): Promise<World> {
  const rows = (JSON.parse(readFileSync(CONTENT, "utf8")) as { definitions: Row[] }).definitions;
  const byKey = new Map(rows.map((r) => [r.canonicalKey, r]));
  const weapons = WEAPONS.map((k) => byKey.get(k)!);
  const attackKeys = new Set(weapons.flatMap((w) => (w.payload as { moveset: Array<{ $ref: string }> }).moveset.map((m) => m.$ref)));
  return seed(request, async (add, pins) => {
    // Sequential, in dependency order: traits → Attacks → Weapons.
    for (const t of rows.filter((r) => r.definitionKind === "EQUIPMENT_TRAIT")) await add(t.canonicalKey, t.definitionKind, resolveRefs(t.payload, pins), t.displayName);
    for (const a of rows.filter((r) => attackKeys.has(r.canonicalKey))) await add(a.canonicalKey, a.definitionKind, resolveRefs(a.payload, pins), a.displayName);
    for (const w of weapons) await add(w.canonicalKey, w.definitionKind, resolveRefs(w.payload, pins), w.displayName);
  });
}

/** A completed Level 1 Character with STR 6 and Martial Trained (a free Skill), created through the WO3 API. */
export async function martialCharacter(request: APIRequestContext, w: World, name: string) {
  const sel = (k: string) => ({ entityId: w.pins.get(k)!.entityId, entityVersionId: w.pins.get(k)!.entityVersionId });
  const c = await post<Id & { lockVersion: number }>(request, "/api/characters", { name, concept: null, rulesetReleaseId: w.r1.id });
  const saved = await put<{ lockVersion: number }>(request, `/api/characters/${c.id}/creation`, {
    expectedLockVersion: c.lockVersion,
    candidate: {
      ancestry: sel("ancestry.orcani"),
      ancestryStatChoices: [
        { grantKey: "orcani_versatility", stat: "AGI" },
        { grantKey: "orcani_versatility", stat: "PER" },
      ],
      statAllocations: { STR: 4, AGI: 3, CON: 3, PER: 2, RES: 2, PRO: 1 },
      skills: [
        { skill: sel("skill.athletics"), sourceKind: "ANCESTRY", sourceGrantKey: "orcani_upbringing" },
        { skill: sel("skill.martial"), sourceKind: "FREE", sourceGrantKey: null },
        { skill: sel("skill.stealth"), sourceKind: "FREE", sourceGrantKey: null },
      ],
      primaryAffinity: sel("affinity.evocation"),
    },
  });
  const done = await post<Id & { lockVersion: number }>(request, `/api/characters/${c.id}/finalize`, { expectedLockVersion: saved.lockVersion });
  return { id: done.id, sel };
}
