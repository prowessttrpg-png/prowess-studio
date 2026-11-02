import { readFileSync } from "node:fs";
import path from "node:path";
import type { APIRequestContext } from "@playwright/test";
import { post, seed, type World } from "./m6-wo5-world";

/**
 * PAS-10 M6-WO7 — the E2E world for the Signature Spell Builder specs (shared helper, not a spec): the M6-WO5 capable
 * Release with the CURRENT Ability Construction Rule (WO9–WO13 policies) and every Spell component of the M5 Spell test
 * fixture — Targeting, Effects, Traits, Durations, Casting Conditions (packages/prowess-game/src/testing/
 * m6-wo7-spell-world.json; test-only `test.e2e_m6wo5.*` keys, never canon) — plus the M1 Keywords those components
 * author. Content `{ "$ref": key }` placeholders resolve to the exact pins; Skill keys name this world's Skills.
 */
const WORLD = path.resolve(process.cwd(), "../../packages/prowess-game/src/testing/m6-wo7-spell-world.json"); // Playwright runs from apps/studio
type Row = { canonicalKey: string; definitionKind: string; schemaVersion: number; payload: unknown };
type SpellWorld = { keywords: string[]; definitions: Row[] };

/** Readable display names for the test components ("spell.targeting.single_target" → "Single Target"). */
const DISPLAY: Record<string, string> = { "fixture.wo10.effect.damage": "Arcane Bolt", "spell.effect.direct_damage": "Direct Damage", "fixture.trait.spell": "Spell Trait (test)", "fixture.trait.affinity": "Affinity Trait (test)" };
export const spellDisplayName = (key: string) => DISPLAY[key] ?? (key.split(".").at(-1) ?? key).split("_").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");

function resolve(value: unknown, refs: (key: string) => unknown, skills: Record<string, string>): unknown {
  if (Array.isArray(value)) return value.map((v) => resolve(v, refs, skills));
  if (value !== null && typeof value === "object") {
    const o = value as Record<string, unknown>;
    if (Object.keys(o).length === 1 && typeof o.$ref === "string") return refs(o.$ref);
    return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, k === "skillKey" && typeof v === "string" ? (skills[v] ?? v) : resolve(v, refs, skills)]));
  }
  return value;
}

/** Creates any of the world's Keywords not yet defined (M1 Keyword API; idempotent). */
async function ensureKeywords(request: APIRequestContext, keys: readonly string[]) {
  const existing = new Set(((await (await request.get("/api/keywords")).json()).data as Array<{ canonicalKey: string }>).map((k) => k.canonicalKey));
  for (const k of keys.filter((x) => !existing.has(x))) {
    const r = await request.post("/api/keywords", { data: { canonicalKey: k, name: k.replace(/^keyword\./, "").replaceAll("_", " ") } });
    if (!r.ok() && r.status() !== 409) await post(request, "/api/keywords", { canonicalKey: k, name: k });
  }
}

export async function seedSpells(request: APIRequestContext): Promise<World> {
  const world = JSON.parse(readFileSync(WORLD, "utf8")) as SpellWorld;
  await ensureKeywords(request, world.keywords);
  const rule = world.definitions.find((d) => d.definitionKind === "ABILITY_CONSTRUCTION_RULE")!.payload as Record<string, unknown>;
  return seed(
    request,
    async (add, pins) => {
      const skills = { "skill.arcana": pins.get("skill.arcana")!.canonicalKey, "skill.martial": pins.get("skill.martial")!.canonicalKey };
      const refs = (key: string) => {
        const p = pins.get(key);
        if (p === undefined) throw new Error(`unresolved content ref ${key}`);
        return { ...p };
      };
      for (const d of world.definitions.filter((x) => x.definitionKind !== "ABILITY_CONSTRUCTION_RULE")) await add(d.canonicalKey, d.definitionKind, resolve(d.payload, refs, skills), spellDisplayName(d.canonicalKey), d.schemaVersion);
    },
    { construction: rule },
  );
}
