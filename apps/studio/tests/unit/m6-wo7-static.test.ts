import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { expectedFrozenHash, laterMigrations } from "./later-milestone-schema";
import { auditM5Source } from "./m5-wo1-audit-helpers";

/**
 * M6-WO7 gate — Signature Spell Builder (PAS-10 M6-WO7 §161–§176). Static architecture assertions over the real
 * sources; the behaviour is guarded by the @prowess/game Signature Spell and M5 characterization suites, the @prowess/db
 * and Studio integration suites, the WO7 UI suite, the WO7 E2E spec and scripts/m6-wo7-negative-controls.mjs (shared
 * CLOSEOUT-03 harness).
 *
 * Invariants: M6-I077 Character-owned, not canon · M6-I078 exact Release-pinned components · M6-I079 prose never creates
 * mechanics · M6-I080 explicit authority · M6-I081 capacities never stack · M6-I082 M5 owns legality · M6-I083 M5-WO10
 * owns cost · M6-I084 ME never changes listed cost · M6-I085 the 30% effective cap · M6-I086 Effect order is meaning ·
 * M6-I087 explicit exchange · M6-I088 M5-SC-042 fail-closed · M6-I089 drafts use no slot · M6-I090 shared Signature
 * capacity · M6-I091 atomic finalization · M6-I092 append-only revisions · M6-I093 invalid rebuilds never replace ·
 * M6-I094 retirement keeps history · M6-I095 no latest component · M6-I096 reuse, never redefine M5 · M6-I097 runtime
 * deferrals surfaced · M6-I098 no live casting.
 */
const ROOT = path.resolve(process.cwd(), "..", "..");
const read = (p: string) => readFileSync(path.join(ROOT, p), "utf8");
const hash = (b: Buffer | string) => createHash("sha256").update(b).digest("hex");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
function walk(dir: string): string[] {
  const abs = path.join(ROOT, dir);
  if (!existsSync(abs)) return [];
  return readdirSync(abs).flatMap((e) => {
    const rel = `${dir}/${e}`;
    return statSync(path.join(ROOT, rel)).isDirectory() ? walk(rel) : [rel];
  });
}
const code = (dir: string) => walk(dir).filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\.(ts|tsx)$/.test(f));
const fn = (src: string, name: string) => {
  const start = src.search(new RegExp(`export (async )?function ${name}(<[^>]*>)?\\(`));
  expect(start, `${name} exists`).toBeGreaterThanOrEqual(0);
  const end = src.indexOf("\n}\n", start);
  return src.slice(start, end < 0 ? undefined : end + 2);
};

const GAME_DIR = "packages/prowess-game/src";
const ADAPTER_PATH = `${GAME_DIR}/character/signature-spell.ts`;
const CATALOG_PATH = `${GAME_DIR}/character/signature-spell-catalog.ts`;
const WO7_GAME = [ADAPTER_PATH, CATALOG_PATH];
const ADAPTER = strip(read(ADAPTER_PATH));
const EVALUATE = fn(ADAPTER, "evaluateCharacterSignatureSpell");
const CATALOG = strip(read(CATALOG_PATH));
const SERVICE_PATH = "packages/prowess-db/src/character/signature-spell-service.ts";
const REPOSITORY_PATH = "packages/prowess-db/src/character/signature-spell-repository.ts";
// M6-WO8 extracts the unchanged exact-Release context loader for both kinds.
const SERVICE = strip(read(SERVICE_PATH) + read("packages/prowess-db/src/character/signature-context.ts"));
const REPOSITORY = strip(read(REPOSITORY_PATH));
const SHEET_SERVICE = strip(read("packages/prowess-db/src/character/sheet-service.ts"));

const SCHEMA_PATH = "packages/prowess-db/prisma/schema.prisma";
const SCHEMA = read(SCHEMA_PATH);
const WO7_BLOCK = SCHEMA.slice(SCHEMA.indexOf("// >>> M6-WO7"), SCHEMA.indexOf("// <<< M6-WO7")).replace(/^\s*\/\/.*$/gm, "");
const MIGRATION_NAME = "20261103010000_m6_wo7_signature_spells";
const MIGRATION = read(`packages/prowess-db/prisma/migrations/${MIGRATION_NAME}/migration.sql`);
const BASELINE = JSON.parse(read("docs/architecture/m6-wo7-baseline.json")) as { baseCommit: string; frozenFiles: Record<string, string>; m5BaseFiles: Record<string, string> };

const API = "apps/studio/app/api/characters/[characterId]";
const ROUTES = ["abilities/route.ts", "spells/route.ts", "spells/[spellId]/route.ts", "spells/[spellId]/builder/route.ts", "spells/[spellId]/draft/route.ts", "spells/[spellId]/validate/route.ts", "spells/[spellId]/finalize/route.ts", "spells/[spellId]/rebuild/route.ts", "spells/[spellId]/retire/route.ts"].map((r) => `${API}/${r}`);
const SPELL_UI_DIR = "apps/studio/app/characters/_components/spells";
const SPELL_UI = [...code(SPELL_UI_DIR), "apps/studio/app/characters/_lib/spell-format.ts", "apps/studio/app/characters/_components/sheet/SpellRows.tsx"];
const BUILDER = strip(read(`${SPELL_UI_DIR}/SpellBuilder.tsx`));
const CHARACTER_UI = code("apps/studio/app/characters");
const PAGES = ["abilities/page.tsx", "spells/new/page.tsx", "spells/[spellId]/page.tsx", "spells/[spellId]/edit/page.tsx"].map((p) => `apps/studio/app/characters/[characterId]/${p}`);
const LATEST = /latest|newest|mostRecent|findFirst|getCurrent|current\w*(Release|Version)\b/i;

describe("M6-WO7 gate — Character-owned, never canon (§6–§9, §105, M6-I077 M6-I078 M6-I095)", () => {
  it("M6-I077 the adapter cites NO subject Definition and never extends the Release bundle with a synthetic Spell", () => {
    expect(EVALUATE).toMatch(/compileAuthoredAbilityCore\(p1, r, subjectKey, context\.value, bundle, catalog, \{ authored: payload, spell: true, subjectRefs: \[\], definition: subject \}\)/);
    expect(EVALUATE).toMatch(/compileSpellCostCore\(p2, r, ability\.value, pro, \{ subjectRefs: \[\], sourceKey: "character\.signature_spell", sourceId \}\)/);
    expect(EVALUATE).toMatch(/definitions: bundle,/);
    for (const f of WO7_GAME) {
      const src = strip(read(f));
      expect(src, f).not.toMatch(/createProwessDefinitionBundle|definitions: \[\.\.\.(request\.)?bundle\.definitions|bundle\.definitions\.(push|concat|splice)|definitionKind: "SPELL_DEFINITION"/);
    }
  });

  it("M6-I077 the database path writes only the two Character Signature tables — never an Entity, revision, ChangeSet, Manifest or Release", () => {
    expect([...new Set([...REPOSITORY.matchAll(/(?:prisma|tx)\.(\w+)\./g)].map((m) => m[1]))].sort()).toEqual(["characterSignatureAbility", "characterSignatureManeuverRevision", "characterSignatureSpellRevision", "characterWeaponLoadout"]);
    for (const src of [SERVICE, REPOSITORY]) expect(src).not.toMatch(/\.(entity|entityVersion|changeSet|changeSetOperation|rulesetManifest|rulesetManifestEntry|rulesetRelease|ruleset)\.(create|update|upsert|delete)/);
    expect(SERVICE).not.toMatch(/prisma\.(entity|entityVersion|changeSet|rulesetRelease)\./);
  });

  it("M6-I078 every component is resolved by its exact pinned identity — never a display name or canonical key", () => {
    for (const f of [...WO7_GAME, SERVICE_PATH]) {
      const src = strip(read(f));
      expect(src, f).not.toMatch(/displayName|canonicalKey ===|=== \w+\.canonicalKey|find\([^)]*canonicalKey/);
    }
    expect(EVALUATE).toMatch(/findBundleDefinition\(bundle, ref\)/);
    expect(EVALUATE).toMatch(/findBundleDefinition\(bundle, draft\.duration!\.definition\)/);
    expect(CATALOG).toMatch(/entityVersionId/);
  });

  it("M6-I095 no latest / current revision lookup anywhere in the WO7 game, route or Studio path; the service reads the Character's own Release", () => {
    for (const f of [...WO7_GAME, ...ROUTES, ...SPELL_UI, ...PAGES]) expect(strip(read(f)), f).not.toMatch(LATEST);
    expect(SERVICE).toMatch(/const \{ c, bundle, ruleset, progression \} = await loadCompleted\(characterId\);/);
    expect(SERVICE).not.toMatch(/entityVersion\.find|orderBy: \{ revisionNumber: "desc" \}|getEffectiveManifestEntries|resolveEffectiveEntityVersion/);
    // §80: a revision pinned to another Release is never re-evaluated against this one.
    expect(SERVICE).toMatch(/r\.characterReleaseId !== ctx\.c\.rulesetReleaseId \? null : evaluateStored/);
  });
});

describe("M6-WO7 gate — M5 owns legality and cost (§4–§5, §102–§110, M6-I081–I085 M6-I096)", () => {
  it("the WO7 game files pass the M5-WO1 audit with no allowance", () => {
    for (const f of WO7_GAME) expect(auditM5Source(read(f), f, "game"), f).toEqual([]);
  });

  it("M6-I082 / M6-I083 the adapter composes the exported M5 cores and ONE M4 run — no cost, capacity or rounding of its own", () => {
    expect(EVALUATE).toMatch(/readAuthoredAbilityPayload\("SPELL_DEFINITION", spellPayloadOf\(draft\), \[\], p0\)/);
    expect(EVALUATE).toMatch(/orchestrateRulesEvaluation\(\{ evaluationKey: `spell-cost\.\$\{subjectKey\}`, contexts: \{ ruleset: context\.value \}, plan: costPlan\.value\.evaluationPlan \}\)/);
    expect(EVALUATE).toMatch(/readSpellCostRun\(costPlan\.value, run\.data\)/);
    expect(EVALUATE).toMatch(/compileExecutionCore\(p3, r, ability\.value, authored, sourceId\)/);
    for (const f of WO7_GAME) {
      const src = strip(read(f));
      expect(src, f).not.toMatch(/Math\.|floor\(|ceil\(|round\(|\bmax\(|\bmin\(/);
      expect(src, f).not.toMatch(/expression:\s*["'`]/);
      expect(src, f).not.toMatch(/netCostPercent\s*[=:]\s*\d|finalMpCost\s*[=:]\s*\w+\s*[*/+-]|percent\w*\s*[*/+-]\s*\d/);
    }
    // The Sustain preview is the pinned WO13 Formula evaluated by M4 — never recomputed (§58).
    expect(EVALUATE).toMatch(/evaluateFormula\(\{ expression: policy\.formulas\.sustainMp\.expression, rounding: "NONE" \}, \{ final_mp: cost\.finalMpCost, pro \}\)/);
  });

  it("M6-I081 capacities are never stacked or self-granted: no access grants, the default slot use, the explicit authority", () => {
    expect(EVALUATE).not.toMatch(/accessGrants|exemption|slotUse: "EXEMPT"/);
    expect(EVALUATE).toMatch(/signature: \{ usedSlots: request\.usedSlots, candidate: \{ slotUse: "DEFAULT" \} \}/);
    expect(ADAPTER).toMatch(/authority: \{ authority: draft\.authority \},/);
    // Capacities are M5's results, shown as given — never read from a rank table or summed here.
    expect(ADAPTER).not.toMatch(/(effect|trait|condition)Capacity\s*[+*-]|arcana\.ranks|rankRule\.\w+Capacity/);
  });

  it("M6-I084 / M6-I085 ME and current resources never reach the listed price; the permanent cost policy is unchanged", () => {
    for (const f of WO7_GAME) expect(strip(read(f)), f).not.toMatch(/manaEfficiency|currentMp|playState|resources\.\w+\.current|\bME\b/);
    expect(ADAPTER).toMatch(/character: constructionCharacterOf\(profile\),/);
    // The permanent M5 policy content (cost incl. the 30% cap, construction, Affinity, Duration / Condition, execution,
    // active magic) is byte-identical to the M6-WO6 base.
    const content = Object.entries(BASELINE.frozenFiles).filter(([f]) => f.includes("/content/core-playtest-v0.1/"));
    expect(content.length).toBe(6);
    for (const [f, h] of content) expect(hash(readFileSync(path.join(ROOT, f))), f).toBe(h);
  });

  it("M6-I096 the approved M5 change registry lists exactly the WO7 files at their current hashes; the base hashes are recorded", () => {
    const approved = JSON.parse(read("docs/architecture/m6-approved-m5-changes.json")) as Record<string, { changedFiles: Record<string, string>; addedFiles: Record<string, string> } | string>;
    const wo7 = approved["M6-WO7"] as { changedFiles: Record<string, string>; addedFiles: Record<string, string> };
    expect(Object.keys(wo7.changedFiles).sort()).toEqual(["ability/compile.ts", "ability/effect-execution.ts", "ability/spell-cost.ts", "construction/composition.ts", "index.ts"].map((f) => `${GAME_DIR}/${f}`));
    expect(Object.keys(wo7.addedFiles).sort()).toEqual(
      ["character-signature-spell-world.test.ts", "character-signature-spell.test.ts", "character/signature-spell-catalog.ts", "character/signature-spell.ts", "m6-wo7-m5-characterization.test.ts", "testing/m6-wo7-m5-characterization.json", "testing/m6-wo7-spell-world.json", "testing/signature-spell-fixtures.ts"].map((f) => `${GAME_DIR}/${f}`),
    );
    for (const [f, h] of [...Object.entries(wo7.changedFiles), ...Object.entries(wo7.addedFiles)]) expect(hash(readFileSync(path.join(ROOT, f))), f).toBe(expectedFrozenHash(f, h));
    expect(Object.keys(BASELINE.m5BaseFiles).sort()).toEqual(Object.keys(wo7.changedFiles).sort());
    for (const [f, h] of Object.entries(BASELINE.m5BaseFiles)) expect(h, f).not.toBe(wo7.changedFiles[f]);
  });

  it("M6-I096 the refactor is additive: each M5 public entry point delegates to its exported core unchanged", () => {
    const compile = strip(read(`${GAME_DIR}/ability/compile.ts`));
    expect(compile).toMatch(/export function compileAuthoredAbilityCore<S>\(/);
    // M6-WO8 keeps canonical subjects exact; only the explicitly versioned Maneuver scope extension supplies context.
    expect(fn(compile, "compileAbilityDefinition")).toMatch(/return compileAuthoredAbilityCore\(p, r, subjectKey as string, context\.value, bundle, catalog, \{ authored, spell: d\.definitionKind === "SPELL_DEFINITION", subjectRefs: \[definitionRefOf\(d\)\], definition: definitionRefOf\(d\) \}, scopedGraph\);/);
    expect(compile).toContain('costPolicy?.maneuverCostPolicy?.extension?.version === "M6-WO8-A"');
    const cost = strip(read(`${GAME_DIR}/ability/spell-cost.ts`));
    expect(fn(cost, "compileSpellCost")).toMatch(/return compileSpellCostCore\(p, r, plan, pro, \{ subjectRefs: \[plan\.definition\], sourceKey: plan\.definition\.canonicalKey, sourceId: plan\.definition\.entityVersionId \}\);/);
    expect(cost).toContain('modifier("spell.minimum_ap", AP_TARGET, "MAX", "spell.ap_minimum", 2, 0, spellRef), operand: POLICY.minimumAp');
    const execution = strip(read(`${GAME_DIR}/ability/effect-execution.ts`));
    expect(execution).toMatch(/export function compileExecutionCore<S>\(/);
    const characterization = read(`${GAME_DIR}/m6-wo7-m5-characterization.test.ts`);
    expect(characterization).toContain("M6-I096");
    const stored = JSON.parse(read(`${GAME_DIR}/testing/m6-wo7-m5-characterization.json`)) as { base: string; digests: Record<string, string> };
    expect(stored.base).toBe(BASELINE.baseCommit);
    expect(Object.keys(stored.digests).length).toBeGreaterThanOrEqual(300);
  });
});

describe("M6-WO7 gate — authority, composition and unresolved rules (§24–§68, M6-I079 M6-I080 M6-I086 M6-I087 M6-I088 M6-I097)", () => {
  it("M6-I079 prose never reaches the engine: a fixed inert label is compiled; nothing parses the player's text", () => {
    expect(ADAPTER).toMatch(/name: "Character Signature Spell",\n\s+description: "",/);
    const payloadOf = ADAPTER.slice(ADAPTER.indexOf("function spellPayloadOf"), ADAPTER.indexOf("function missingSteps"));
    expect(payloadOf).not.toMatch(/concept/);
    // Mechanical Keywords come only from the chosen components; narrative tags never become Keywords (§86).
    expect(EVALUATE).not.toMatch(/concept|narrativeTags/);
    for (const f of [...WO7_GAME, SERVICE_PATH, ...SPELL_UI]) expect(strip(read(f)), f).not.toMatch(/concept\.(name|description|visualDescription|notes)\.(match|includes|split|toLowerCase|search)|new RegExp\([^)]*concept|dangerouslySetInnerHTML/);
  });

  it("M6-I080 a new draft chooses nothing; a missing authority is reported, never filled in", () => {
    expect(ADAPTER).toMatch(/authority: null, affinity: null, targeting: null, effects: \[\], effectChain: null, traits: \[\], duration: null, castingConditions: \[\], constructionOptions: \{ effectSlotsTradedForTraits: 0 \}/);
    expect(ADAPTER).toMatch(/if \(draft\.authority === null \|\| \(draft\.authority === "AFFINITY_AUTHORITY" && draft\.affinity === null\)\) out\.push\("AUTHORITY"\);/);
    for (const f of SPELL_UI) expect(strip(read(f)), f).not.toMatch(/authority: "(ARCANE|AFFINITY)_AUTHORITY"|defaultChecked|affinity: (catalog|data\.catalog)\.affinities\[0\]/);
  });

  it("M6-I086 / M6-I087 Effect order and the Effect-slot exchange are the player's, passed to M5 verbatim", () => {
    expect(ADAPTER).toMatch(/const ordered = \(u: SignatureSpellOrderedUse\) => \(\{ componentKey: u\.componentKey, definition: u\.definition, order: u\.order, parameters: u\.parameters \}\);/);
    expect(ADAPTER).toMatch(/effects: draft\.effects\.map\(ordered\),/);
    expect(ADAPTER).toMatch(/constructionOptions: draft\.constructionOptions,/);
    expect(ADAPTER).not.toMatch(/\.sort\(\(a, b\) => a\.order|effects\]\.sort|effectSlotsTradedForTraits:\s*[^;,}]*(remaining|maximum|unused|length)/);
    // The builder changes the exchange only from the explicit Trade / Return buttons.
    expect(BUILDER.match(/effectSlotsTradedForTraits: d\.constructionOptions\.effectSlotsTradedForTraits/g)).toHaveLength(2);
    expect(BUILDER).toMatch(/Trade 1 unused Effect slot for \+1 Trait slot/);
    expect(BUILDER).toMatch(/const renumber = <T extends SpellOrderedUseDto>\(list: readonly T\[\]\): T\[\] => list\.map\(\(x, i\) => \(\{ \.\.\.x, order: i \+ 1 \}\)\);/);
  });

  it("M6-I088 / M6-I097 unresolved M5 conflicts are passed through and surfaced — never resolved here", () => {
    expect(ADAPTER).toMatch(/additionalAffinityTraits: draft\.additionalAffinityTraits,/);
    expect(ADAPTER).toMatch(/manaLock = \{ reservedMp: null, conflictKey \};/);
    expect(ADAPTER).toMatch(/deferred\.push\(\{ conflictKey: CONFLICT\.exec\(q\.message\)\?\.\[0\] \?\? q\.code, message: q\.message \}\)/);
    for (const f of [...WO7_GAME, SERVICE_PATH, ...SPELL_UI]) {
      const src = strip(read(f));
      expect(src, f).not.toMatch(/reservedMp: (?!null)\w|additionalAffinityTraitCapacity|signatureDiscount|targetCount\s*[*]\s*\w/);
    }
    expect(read(`${SPELL_UI_DIR}/SpellReview.tsx`)).toMatch(/Runtime: Deferred/);
    // §45: a later Effect that is not triggered is never presented as a failure.
    expect(read(`${SPELL_UI_DIR}/SpellReview.tsx`)).toMatch(/A later Effect that is not triggered is NOT a failure\./);
  });

  it("§54 / §68 no dynamic Metamagic and no parallel Performance Condition; Performance is reported from the catalog", () => {
    for (const f of [...WO7_GAME, ...SPELL_UI]) expect(strip(read(f)), f).not.toMatch(/Quickened|TwinCast|Twin Cast|Overchannel|TargetShift|EffectReorder|metamagic\s*[:=(]/i);
    expect(CATALOG).toMatch(/performanceCondition/);
    expect(BUILDER).toMatch(/catalog\.performanceCondition\.present/);
  });
});

describe("M6-WO7 gate — persistence, roster and history (§10–§18, §87–§92, §116–§119, M6-I089–I094)", () => {
  it("M6-I089 / M6-I090 only ACTIVE finalized Spells count against the shared Signature capacity; no separate Spell slots", () => {
    expect(REPOSITORY).toMatch(/const usedSlots = await tx\.characterSignatureAbility\.count\(\{ where: \{ characterId, status: "ACTIVE", id: \{ not: abilityId \} \} \}\);/);
    expect(SERVICE).toMatch(/const activeCount = \(all: readonly StoredSignatureAbility\[\], except: string \| null\) => all\.filter\(\(a\) => a\.status === "ACTIVE" && a\.id !== except\)\.length;/);
    expect(SERVICE).toMatch(/signature: \{ capacity: ctx\.profile\.signatureCapacity, used: activeCount\(all, null\) \}/);
    expect(SCHEMA + SERVICE).not.toMatch(/spellSlots|spell_slots|signatureSpellSlots/i);
  });

  it("M6-I091 finalization locks the Character row, re-checks both versions and decides with the exact roster in ONE transaction", () => {
    const finalize = fn(REPOSITORY, "finalizeSignatureSpell");
    expect(finalize).toMatch(/SELECT "lock_version", "ruleset_release_id" FROM "characters" WHERE "id" = \$\{characterId\}::uuid FOR UPDATE/);
    expect(finalize).toMatch(/locked\[0\]!\.lock_version !== input\.characterLockVersion \|\| locked\[0\]!\.ruleset_release_id !== input\.characterReleaseId/);
    expect(finalize).toMatch(/if \(stored\.lockVersion !== expected\) throw new Outcome/);
    const order = ["FOR UPDATE", "const usedSlots", "input.decide(stored.draftPayload, usedSlots)", "characterSignatureSpellRevision.create", "updateMany({ where: { id: abilityId, characterId, lockVersion: expected }"].map((s) => finalize.indexOf(s));
    expect(order.every((x) => x >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it("M6-I092 / M6-I093 / M6-I094 revisions are only ever appended; a refused rebuild appends nothing; retirement deletes nothing", () => {
    expect(REPOSITORY).not.toMatch(/characterSignatureSpellRevision\.(update|upsert|delete)/);
    expect(REPOSITORY).not.toMatch(/characterSignatureAbility\.delete/);
    const finalize = fn(REPOSITORY, "finalizeSignatureSpell");
    expect(finalize).toMatch(/if \(!decision\.ok\) throw new FinalizeAbort\(\{ outcome: "rejected", reason: decision\.reason, detail: decision\.detail \}\);/);
    expect(finalize).toMatch(/previousRevisionId: stored\.currentRevisionId/);
    expect(fn(REPOSITORY, "retireSignatureSpell")).toMatch(/return \{ status: "RETIRED", retiredAt: new Date\(\), draftPayload: Prisma\.DbNull \};/);
    expect(fn(REPOSITORY, "startSignatureSpellRebuild")).toMatch(/return \{ draftPayload: current\.payload as object \};/);
    expect(fn(REPOSITORY, "writeSignatureSpellDraft")).toMatch(/if \(row\.status === "RETIRED"\) throw new Outcome\(\{ outcome: "state", status: row\.status, reason: "a retired Signature Spell is history; it is never edited" \}\);/);
    expect(MIGRATION).toMatch(/CREATE TRIGGER "character_signature_spell_revisions_append_only" BEFORE UPDATE OR DELETE ON "character_signature_spell_revisions" FOR EACH ROW/);
    expect(SERVICE).toMatch(/if \(e\.state === "VALID" \|\| e\.state === "VALID_WITH_RUNTIME_DEFERRED"\) return \{ ok: true, payload:/);
  });

  it("§87 every write is a compare-and-set on the Spell's lockVersion; stale → 409", () => {
    expect(REPOSITORY).toMatch(/const claimed = await tx\.characterSignatureAbility\.updateMany\(\{ where: \{ id: abilityId, characterId, lockVersion: expected \}, data: \{ \.\.\.data, lockVersion: next, updatedAt: new Date\(\) \} \}\);/);
    expect(SERVICE).toMatch(/case "stale":\n\s+throw fail\(CHARACTER_ERROR_CODES\.STALE_WRITE/);
    expect(read("apps/studio/src/api/errors.ts")).toMatch(/SIGNATURE_CAPACITY_EXCEEDED/);
  });

  it("§78 / §119 only SELECTIONS are stored: no derived column; stored drafts are re-read strictly and re-evaluated on every read", () => {
    expect(WO7_BLOCK).not.toMatch(/final_?mp|final_?ap|mp_?cost|ap_?cost|capacity|discount|sustain|concentration|range|keyword/i);
    expect(SERVICE).toMatch(/function storedDraft\(raw: unknown\): SignatureSpellDraft \| null \{\n\s+const out = readSignatureSpellDraft\(raw\);/);
    expect(SERVICE).toMatch(/Unknown field "\$\{k\}" — only Spell selections and prose are submitted/);
    expect(SERVICE).not.toMatch(/\.finalMpCost\s*\?\?\s*stored|payload\.cost|draftPayload\.cost/);
  });
});

describe("M6-WO7 gate — registered schema change and migration (§116–§118, §166–§169)", () => {
  it("the registry entry is exactly the two Signature models and the one WO7 migration, after WO6", () => {
    const registry = JSON.parse(read("docs/architecture/m6-schema-changes.json")) as Record<string, unknown>;
    expect(registry["M6-WO7"]).toEqual({ migrations: [MIGRATION_NAME], models: ["CharacterSignatureAbility", "CharacterSignatureSpellRevision"] });
    const later = laterMigrations();
    expect(later.indexOf(MIGRATION_NAME)).toBe(later.indexOf("20261102010000_m6_wo6_character_weapon_loadout") + 1);
    expect([...WO7_BLOCK.matchAll(/^model (\w+) \{/gm)].map((m) => m[1])).toEqual(["CharacterSignatureAbility", "CharacterSignatureSpellRevision"]);
    expect(WO7_BLOCK).not.toMatch(/^enum /m);
    expect(SCHEMA.match(/\/\/ M6-WO7 back-relation/g)).toHaveLength(2);
  });

  it("removing exactly the marked WO7 additions restores the M6-WO6 schema; earlier migrations are untouched", () => {
    expect(BASELINE.baseCommit).toBe("28bcfaecd98c0852446dbb278a88d6091d347cc9");
    const registered = Object.keys(JSON.parse(read("docs/architecture/m6-schema-changes.json")) as Record<string, unknown>).filter((k) => /^M\d+-WO\d+$/.test(k));
    let without = SCHEMA;
    for (const wo of registered.slice(registered.indexOf("M6-WO7"))) {
      const w = wo.replace(/-/g, "\\-");
      without = without.replace(new RegExp(`^[^\\n]*// ${w} back-relation[^\\n]*\\n`, "gm"), "").replace(new RegExp(`\\n// >>> ${w}[^\\n]*\\n[\\s\\S]*?// <<< ${w}[^\\n]*\\n`), "");
    }
    expect(hash(without)).toBe(BASELINE.frozenFiles[SCHEMA_PATH]);
    for (const [f, h] of Object.entries(BASELINE.frozenFiles).filter(([k]) => k.endsWith("migration.sql"))) expect(hash(readFileSync(path.join(ROOT, f))), f).toBe(h);
  });

  it("integrity: Spell kind only, closed status, RESTRICT relations, append-only and owned-current guards; no cascade or drop", () => {
    expect(MIGRATION).toMatch(/CHECK \("ability_kind" = 'SPELL'\)/);
    expect(MIGRATION).toMatch(/CHECK \("status" IN \('DRAFT', 'ACTIVE', 'RETIRED'\)\)/);
    expect(MIGRATION).toMatch(/CHECK \(\("status" = 'RETIRED'\) = \("retired_at" IS NOT NULL\)\)/);
    expect(MIGRATION).toMatch(/CHECK \("status" = 'DRAFT' OR "current_revision_id" IS NOT NULL OR "retired_at" IS NOT NULL\)/);
    expect(MIGRATION).toMatch(/CREATE UNIQUE INDEX "character_signature_spell_revisions_ability_revision_key" ON "character_signature_spell_revisions"\("ability_id", "revision_number"\)/);
    expect(MIGRATION.match(/ON DELETE RESTRICT ON UPDATE RESTRICT/g)).toHaveLength(5);
    expect(MIGRATION).toMatch(/CHARACTER_SIGNATURE_ABILITY_CURRENT_REVISION/);
    expect(MIGRATION).not.toMatch(/CASCADE|SET NULL|DROP |ALTER TABLE "(characters|entity_versions|entities|ruleset_releases|character_\w+_(states?|loadouts?|notes))" (ADD|ALTER|DROP)/i);
  });

  it("§167 no Spell component catalog, Ability Card or Maneuver table exists", () => {
    // M6-WO8 adds only its registered Maneuver revision model; all other catalogs/cards remain forbidden.
    const beforeWo8 = SCHEMA.replace(/\n\/\/ >>> M6-WO8[^\n]*\n[\s\S]*?\/\/ <<< M6-WO8[^\n]*\n/g, "");
    expect(beforeWo8).not.toMatch(/model \w*(SpellComponent|SpellTargeting|SpellEffect|SpellTrait|SpellDuration|CastingCondition|AbilityCard|Maneuver)\w* \{/);
  });
});

describe("M6-WO7 gate — API and Studio presentation (§19–§21, §82, §93–§99, §120–§134)", () => {
  it("the nine WO7 routes are registered exactly and are thin adapters with strict bodies and central error mapping", () => {
    const registry = JSON.parse(read("docs/architecture/m6-api-routes.json")) as Record<string, unknown>;
    expect([...(registry["M6-WO7"] as string[])].sort()).toEqual([...ROUTES].sort());
    for (const f of ROUTES) {
      const src = strip(read(f));
      expect(src, f).toMatch(/from "@prowess\/db"/);
      expect(src, f).toMatch(/toErrorResponse\(error\)/);
      expect(src, f).not.toMatch(/prisma|from "@prowess\/(game|rules)"|evaluate|finalMp|capacity/);
    }
    expect(read(ROUTES[1]!)).toMatch(/readStrictBody\(request, \["name"\]\)/);
    expect(read(ROUTES[4]!)).toMatch(/readStrictBody\(request, \["expectedVersion", "draft"\]\)/);
    for (const r of ROUTES.slice(5)) expect(read(r), r).toMatch(/readStrictBody\(request, \["expectedVersion"\]\)/);
  });

  it("M6-I082 / M6-I083 Studio never calculates cost, capacity, discounts or Sustain; it formats the server's evaluation", () => {
    for (const f of [...SPELL_UI, ...PAGES]) {
      const src = strip(read(f));
      expect(src, f).not.toMatch(/from "(@prowess\/(db|game|rules)|@prisma\/client)[^"]*"/);
      expect(src, f).not.toMatch(/Math\.|floor\(|ceil\(|calculateSpell(Mp|Ap)|\b(finalMpCost|finalApCost|baseMp|baseAp|netPercent|unroundedMp|pro|percent|capacity|remaining|strengthDiscountPercent|activationPenaltyPercent|mpPerRound)\s*[*/+-]\s*[\w(]|[*/+-]\s*\w+\.(finalMpCost|finalApCost|baseMp|netPercent|pro|percent|strengthDiscountPercent|capacity)\b/);
      expect(src, f).not.toMatch(/\bfetch\(/);
    }
    // "Cost unresolved" — never zero — unless M5 found the Spell valid (§128).
    const format = strip(read("apps/studio/app/characters/_lib/spell-format.ts"));
    expect(format).toMatch(/return e && e\.cost !== null && isFinalizable\(e\.state\) \? e\.cost : null;/);
    expect(read(`${SPELL_UI_DIR}/SpellReview.tsx`)).toMatch(/<strong>Cost unresolved<\/strong>/);
  });

  it("the builder offers only Release catalog options and the M5 vocabularies — no hard-coded component list", () => {
    for (const f of SPELL_UI) {
      const src = strip(read(f));
      // BRANCH is named once: the one M5 chain behaviour whose editor picks successors (the options still come from the catalog).
      expect(src, f).not.toMatch(/"(SINGLE_TARGET|RADIUS|CONE|LINE|AURA|PROJECTILE|TOUCH|INSTANT|SUSTAINED|MANA_LOCK|ROUNDS|DAMAGE|HEALING|CONTINUE|SUCCESS_ONLY|FAILURE_ONLY|STOP|EFFECT_SPECIFIC|ABILITY_WIDE)"/);
      expect(src, f).not.toMatch(/Single Target|Direct Damage|Fireball|Evocation|Arcana\b/);
    }
    expect(BUILDER).toMatch(/catalog\.vocabularies\.chainBehaviors/);
    expect(BUILDER.match(/"BRANCH"/g)).toHaveLength(1);
    expect(BUILDER).toMatch(/catalog\.vocabularies\.chainFailurePolicies/);
    expect(BUILDER).toMatch(/catalog\.vocabularies\.authorities\.map/);
    expect(BUILDER).toMatch(/catalog\.vocabularies\.traitScopeTargets/);
  });

  it("§21 / §124 ten steps in order with keyboard navigation; the validation summary links to steps; autosave states are announced", () => {
    const steps = read("apps/studio/app/characters/_lib/spell-format.ts");
    expect([...steps.matchAll(/\{ key: "(\w+)", label: "([^"]+)" \}/g)].map((m) => m[2])).toEqual(["Concept", "Authority", "Targeting", "Effects", "Effect Chain", "Traits", "Duration", "Casting Conditions", "Review", "Finalize"]);
    expect(BUILDER).toMatch(/role="tablist"/);
    expect(BUILDER).toMatch(/e\.key === "ArrowRight"/);
    expect(BUILDER).toMatch(/aria-live="polite"/);
    expect(BUILDER).toMatch(/onClick=\{\(\) => onGo\(stepOf\(q\.step\)\)\}/);
    expect(BUILDER).toMatch(/window\.addEventListener\("beforeunload", warn\)/);
    expect(BUILDER).toMatch(/saved: "Saved", unsaved: "Unsaved changes", saving: "Saving…", conflict: "Conflict — this Spell changed elsewhere"/);
  });

  it("M6-I098 nothing is cast: no spend, roll, chain resolution, Sustain activation, Mana Lock reservation or Active Effect", () => {
    for (const f of [...WO7_GAME, SERVICE_PATH, REPOSITORY_PATH, ...ROUTES, ...SPELL_UI]) {
      const src = strip(read(f));
      expect(src, f).not.toMatch(/executeAbilityResolution|resolveEffectChain|spend(Mp|Ap|Me)|rollDice|castSpell|activateSustain|reserveMana|createActiveEffect|activeEffectInstance/i);
    }
    expect(EVALUATE).not.toMatch(/execution:|executeAbility/);
  });

  it("§20 / §94 the Abilities tab, the four pages and the compact Sheet line exist; Weapon Attacks and Action Notes stay", () => {
    expect(read("apps/studio/app/characters/_components/CharacterSheetSummary.tsx")).toMatch(/\{ key: "abilities", label: "Abilities" \}/);
    for (const p of PAGES) expect(existsSync(path.join(ROOT, p)), p).toBe(true);
    const panels = read("apps/studio/app/characters/_components/sheet/SheetPanels.tsx");
    expect(panels).toMatch(/<WeaponAttackRows sheet=\{sheet\} printRows=\{PRINT_ATTACK_ROWS\} \/>\n\s+<SignatureSpellRows sheet=\{sheet\} \/>\n\s+<SignatureManeuverRows sheet=\{sheet\} \/>\n\s+<NotesText label="Action Notes"/);
    expect(SHEET_SERVICE).toMatch(/const spells = await signatureSpellsForSheet\(c\.id\);/);
    expect(SERVICE).toMatch(/const active = all\.filter\(\(a\) => a\.abilityKind === "SPELL" && a\.status === "ACTIVE" && a\.currentRevisionId !== null\);\n\s+if \(active\.length === 0\) return \{ spells: \[\], refs: \[\] \};/);
  });

  it("§99 no Ability Card framework; Maneuver UI is limited to the exact WO8 inventory", () => {
    const wo8 = JSON.parse(read("docs/architecture/m6-wo8-baseline.json")) as { studioFiles: string[] };
    for (const f of [...CHARACTER_UI, ...code("apps/studio/app/api/characters"), ...WO7_GAME, SERVICE_PATH]) {
      expect(path.basename(f), f).not.toMatch(/ability-?card/i);
      expect(strip(read(f)), f).not.toMatch(/AbilityCard/);
      if (!wo8.studioFiles.includes(f)) {
        expect(path.basename(f), f).not.toMatch(/maneuver-?builder/i);
        expect(strip(read(f)), f).not.toMatch(/ManeuverBuilder|createManeuver/);
      }
    }
  });

  it("§97 component links go to the Rules Reference of the Character's own Release", () => {
    expect(read(`${SPELL_UI_DIR}/SpellReview.tsx`)).toMatch(/<Link href=\{entryHref\(release\.rulesetId, release\.id, refDto\.entityId\)\}/);
  });
});

describe("M6-WO7 gate — frozen M4, invariants, documentation and CI (§161–§175)", () => {
  it("M4 source is untouched (frozen hashes since M6-WO2)", () => {
    const wo2 = JSON.parse(read("docs/architecture/m6-wo2-baseline.json")) as { frozenFiles: Record<string, string> };
    const m4 = Object.entries(wo2.frozenFiles).filter(([f]) => f.startsWith("packages/prowess-rules/src/"));
    expect(m4.length).toBeGreaterThan(20);
    for (const [f, h] of m4) expect(hash(readFileSync(path.join(ROOT, f))), f).toBe(h);
  });

  const inv = JSON.parse(read("docs/architecture/m6-invariants.json")) as Array<{ id: string; title: string; guards: string[] }>;
  it("M6-I077–I098 follow M6-I001–I076, are documented, and each is guarded by executing files that cite it", () => {
    expect(inv.slice(0, 98).map((x) => x.id)).toEqual(Array.from({ length: 98 }, (_, i) => `M6-I${String(i + 1).padStart(3, "0")}`));
    const md = read("docs/architecture/m6-invariants.md");
    const titles = ["Character Signature Spells Are Character-Owned Content, Not Compendium Canon", "Every Mechanical Spell Component Is An Exact Release-Pinned Definition", "Spell Name And Description Never Create Mechanics", "Authority Is Explicit And Never Automatically Switched", "Arcane And Affinity Capacities Never Stack", "All Construction Legality Is Owned By M5", "All Spell Cost Is Owned By M5-WO10", "ME Never Changes Listed Spell Cost", "Casting Condition Reduction Uses The Permanent 30% Effective Cap", "Effect Ordering Is Authored Spell Meaning", "Effect-Slot Trait Exchange Is Explicit", "Additional Affinity Trait Capacity Remains Fail-Closed While M5-SC-042 Is Unresolved", "Draft Spells Consume No Signature Slot", "Finalized Spells Consume Exact Shared Signature Capacity", "Signature Finalization Is Atomic Against Roster Capacity", "Spell Revisions Are Append-Only Historical Records", "Invalid Rebuilds Never Replace The Current Valid Revision", "Retired Spells Release Slots Without Deleting History", "Character Spell Validation Never Uses Latest Component Revisions", "The Character Spell Adapter May Reuse But Never Redefine M5 Semantics", "Runtime-Deferred M5 Conflicts Are Surfaced, Never Guessed", "WO7 Does Not Execute Live Spell Casting"];
    expect(inv.slice(76, 98).map((x) => x.title)).toEqual(titles);
    for (const row of inv.slice(76, 98)) {
      expect(md).toContain(`### ${row.id} — ${row.title}`);
      expect(row.guards).toContain("apps/studio/tests/unit/m6-wo7-static.test.ts");
      expect(row.guards).toContain("scripts/m6-wo7-negative-controls.mjs");
      expect(row.guards.length, row.id).toBeGreaterThanOrEqual(3);
      for (const g of row.guards) {
        expect(existsSync(path.join(ROOT, g)), g).toBe(true);
        if (/\.(test|spec)\.tsx?$/.test(g)) expect(read(g), `${row.id} → ${g}`).toContain(row.id);
      }
    }
  });

  it("the architecture document and the implementation report exist with their required sections", () => {
    const doc = read("docs/architecture/m6-signature-spell-builder.md");
    for (const h of ["Ownership", "Persistence", "Lifecycle", "Adapter", "M5 Reuse", "Builder", "Cost And Runtime", "Unresolved Rules", "Character Sheet", "API", "Known Limitations"]) expect(doc, h).toMatch(new RegExp(`^## \\d+\\. ${h}$`, "m"));
    const report = read("docs/reports/m6-wo7-implementation-report.md");
    for (const h of ["Test Totals", "Architecture Gate", "Controls"]) expect(report, h).toMatch(new RegExp(`^## \\d+\\. ${h}`, "m"));
  });

  it("the M6-WO7 gate is a named step of the consolidated CI workflow with its exact control count; no m6-wo7.yml", () => {
    const ci = read(".github/workflows/ci.yml");
    expect(ci).toMatch(/- name: M6-WO7 — Signature Spell Builder\n\s+run: \|\n[\s\S]*?node scripts\/ci\/verify-gate\.mjs M6-WO7 [^\n]*\n\s+PROWESS_EXPECT_CONTROLS=\d+ node scripts\/m6-wo7-negative-controls\.mjs/);
    expect(existsSync(path.join(ROOT, ".github/workflows/m6-wo7.yml"))).toBe(false);
    const gates = JSON.parse(read("scripts/ci/gates.json")) as { gates: Array<{ id: string; tests: string[]; controls: { script: string; count: number } | null }> };
    const gate = gates.gates.find((g) => g.id === "M6-WO7");
    expect(gate?.controls?.script).toBe("scripts/m6-wo7-negative-controls.mjs");
    expect(gate?.controls?.count).toBeGreaterThanOrEqual(56);
    const count = Number(/PROWESS_EXPECT_CONTROLS=(\d+) node scripts\/m6-wo7-negative-controls\.mjs/.exec(ci)?.[1]);
    expect(count).toBe(gate?.controls?.count);
    for (const t of gate?.tests ?? []) expect(existsSync(path.join(ROOT, t)), t).toBe(true);
  });
});

