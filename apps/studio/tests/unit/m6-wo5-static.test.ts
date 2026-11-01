// @vitest-environment node
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { laterMigrations } from "./later-milestone-schema";

/**
 * M6-WO5 permanent architecture gate — Digital Character Sheet (PAS-10 M6-WO5 §119–§121).
 *
 * Guards M6-I045 the sheet consumes the canonical CharacterMechanicalProfile · M6-I046 mechanical values are read-only
 * projections · M6-I047 mutable resources are separate from progression history · M6-I048 Character Notes never
 * create mechanics · M6-I049 Action Notes never create mechanics · M6-I050 portrait framing is nondestructive ·
 * M6-I051 portraits are safe raster images shown at their own aspect ratio · M6-I052 the sheet is exact-Release scoped
 * · M6-I053 frozen creation cannot be changed through the sheet · M6-I054 advancement cannot be bypassed through the
 * sheet · M6-I055 equipment / ability panels stay integration boundaries · M6-I056 print presentation is not rules
 * authority. Its negative / mutation controls are scripts/m6-wo5-negative-controls.mjs (shared CLOSEOUT-03 harness).
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
const fn = (src: string, name: string) => {
  const start = src.search(new RegExp(`export (async )?function ${name}\\(`));
  expect(start, `${name} exists`).toBeGreaterThanOrEqual(0);
  const end = src.indexOf("\n}\n", start);
  return src.slice(start, end < 0 ? undefined : end + 2);
};

const BASELINE = JSON.parse(read("docs/architecture/m6-wo5-baseline.json")) as { baseCommit: string; frozenFiles: Record<string, string> };
const SCHEMA_PATH = "packages/prowess-db/prisma/schema.prisma";
const SCHEMA = read(SCHEMA_PATH);
const WO5_BLOCK = SCHEMA.slice(SCHEMA.indexOf("// >>> M6-WO5"), SCHEMA.indexOf("// <<< M6-WO5")).replace(/^\s*\/\/.*$/gm, "");
const MIGRATION_NAME = "20261101010000_m6_wo5_character_sheet_state";
const MIGRATION = read(`packages/prowess-db/prisma/migrations/${MIGRATION_NAME}/migration.sql`);
const MODELS = ["CharacterPlayState", "CharacterPortrait", "CharacterPortraitImage", "CharacterResourceState", "CharacterSheetNotes"];
const model = (name: string) => {
  const start = WO5_BLOCK.indexOf(`model ${name} {`);
  expect(start, name).toBeGreaterThanOrEqual(0);
  return WO5_BLOCK.slice(start, WO5_BLOCK.indexOf("\n}", start));
};
const GAME_SHEET = strip(read("packages/prowess-game/src/character/sheet.ts"));
const REPO = strip(read("packages/prowess-db/src/character/sheet-repository.ts"));
const SERVICE = strip(read("packages/prowess-db/src/character/sheet-service.ts"));
const PORTRAIT = strip(read("packages/prowess-db/src/character/portrait-image.ts"));
const SHEET_UI_DIR = "apps/studio/app/characters/_components/sheet";
const SHEET_UI = walk(SHEET_UI_DIR).filter((f) => /\.tsx?$/.test(f));
const UI = walk("apps/studio/app/characters").filter((f) => /\.tsx?$/.test(f));
const ROUTE_DIR = "apps/studio/app/api/characters/[characterId]";
const ROUTES = ["notes", "play-state", "portrait-transform", "portrait/image", "portrait", "sheet"].map((r) => `${ROUTE_DIR}/${r}/route.ts`);

describe("M6-WO5 gate — registered schema change and migration (§102–§103, §123)", () => {
  it("M6-I047 the registry entry is exactly the five sheet-state models and the one WO5 migration, after WO4", () => {
    const registry = JSON.parse(read("docs/architecture/m6-schema-changes.json")) as Record<string, unknown>;
    expect(registry["M6-WO5"]).toEqual({ migrations: [MIGRATION_NAME], models: MODELS });
    const later = laterMigrations();
    expect(later.indexOf(MIGRATION_NAME)).toBe(later.indexOf("20261031010000_m6_wo4_character_advancement") + 1);
    expect([...WO5_BLOCK.matchAll(/^model (\w+) \{/gm)].map((m) => m[1]).sort()).toEqual(MODELS);
    expect(WO5_BLOCK).not.toMatch(/^enum /m);
    expect(SCHEMA.match(/\/\/ M6-WO5 back-relation/g)).toHaveLength(3);
  });

  it("removing exactly the marked WO5 additions restores the M6-WO4 schema; the WO3 / WO4 migrations are untouched", () => {
    expect(BASELINE.baseCommit).toBe("d13efd8767a7a1dbef3debb53d879b23f7218446");
    const registered = Object.keys(JSON.parse(read("docs/architecture/m6-schema-changes.json")) as Record<string, unknown>).filter((k) => /^M\d+-WO\d+$/.test(k));
    let without = SCHEMA;
    for (const wo of registered.slice(registered.indexOf("M6-WO5"))) {
      const w = wo.replace(/-/g, "\\-");
      without = without.replace(new RegExp(`^[^\\n]*// ${w} back-relation[^\\n]*\\n`, "gm"), "").replace(new RegExp(`\\n// >>> ${w}[^\\n]*\\n[\\s\\S]*?// <<< ${w}[^\\n]*\\n`), "");
    }
    expect(hash(without)).toBe(BASELINE.frozenFiles[SCHEMA_PATH]);
    for (const m of ["20261029010000_m6_wo3_character_foundation", "20261031010000_m6_wo4_character_advancement"]) {
      const f = `packages/prowess-db/prisma/migrations/${m}/migration.sql`;
      expect(hash(readFileSync(path.join(ROOT, f))), f).toBe(BASELINE.frozenFiles[f]);
    }
  });

  it("M6-I046 no derived value, maximum or rule is persisted; M6-I055 no equipment, inventory, ability or encounter table", () => {
    expect(WO5_BLOCK).not.toMatch(/maximum|maxHp|maxMp|maxAp|dieKey|faces|score|rankKey|derived|accuracy|dodge|armor\b|movement|attunement|level\b/i);
    expect(WO5_BLOCK).not.toMatch(/model \w*(Equipment|Weapon|Armou?r|Inventory|Item|Gear|Ability|Spell|Maneuver|Encounter|Effect|Condition)\w* \{/);
    expect(model("CharacterResourceState")).toMatch(/resourceKey String @map\("resource_key"\)\n\s+current\s+Int/);
    expect(model("CharacterPortrait")).toMatch(/zoom\s+Float\n\s+offsetX Float @map\("offset_x"\)\n\s+offsetY Float @map\("offset_y"\)/);
  });

  it("M6-I051 image bytes live ONLY in character_portrait_images — never on the Character or portrait metadata row", () => {
    expect([...SCHEMA.matchAll(/^\s+(\w+)\s+Bytes\b/gm)].map((m) => m[1])).toEqual(["bytes"]);
    expect(model("CharacterPortraitImage")).toMatch(/bytes Bytes/);
    expect(model("CharacterPortrait")).not.toMatch(/Bytes|bytes/);
    expect(MIGRATION).toMatch(/"mime_type" IN \('image\/png', 'image\/jpeg', 'image\/webp'\)/);
    expect(MIGRATION).toMatch(/"byte_size" <= 8388608/);
    expect(MIGRATION).toMatch(/CHECK \("zoom" >= 1 AND "zoom" <= 5 AND "offset_x" >= -1 AND "offset_x" <= 1 AND "offset_y" >= -1 AND "offset_y" <= 1\)/);
  });

  it("every relation is RESTRICT; the migration creates only sheet tables and changes no function or trigger", () => {
    expect(WO5_BLOCK.match(/onDelete: Restrict, onUpdate: Restrict/g)).toHaveLength(5);
    expect(MIGRATION).not.toMatch(/CASCADE|SET NULL|CREATE (OR REPLACE )?FUNCTION|CREATE TRIGGER|DROP /i);
    expect(MIGRATION.match(/ON DELETE RESTRICT ON UPDATE RESTRICT/g)).toHaveLength(5);
  });
});

describe("M6-WO5 gate — the read model consumes the profile (§79–§80, M6-I045 M6-I046 M6-I052)", () => {
  it("one sheet builder in @prowess/game reads only the bundle, ruleset and the CharacterMechanicalProfile", () => {
    expect(GAME_SHEET).toMatch(/export function buildCharacterSheetMechanics\(request: \{ readonly bundle: ProwessDefinitionBundle; readonly ruleset: RulesetContext; readonly profile: CharacterMechanicalProfile \}\): CharacterSheetMechanics \{/);
    expect(GAME_SHEET).not.toMatch(/notes|Notes|portrait|companyPac|playState/);
    expect(GAME_SHEET).not.toMatch(/buildCharacterMechanicalProfile|previewCharacterAdvancement|validateCharacterCreation/); // consumes, never rebuilds
    expect(GAME_SHEET).toMatch(/const d = profile\.derivedStatistics\.find\(\(x\) => x\.statistic === statistic\);/);
    expect(GAME_SHEET).toMatch(/score: entry\?\.bonus \?\? null,/);
    expect(GAME_SHEET).toMatch(/for \(const envelope of bundle\.definitions\.filter\(\(d\) => d\.definitionKind === "SKILL"\)\) \{/);
    expect(GAME_SHEET).toMatch(/concentration: \{ maximum: unavailable\(/);
    expect(GAME_SHEET).not.toMatch(/\b(10|5)\s*\*|\*\s*(agi|per|pro|str|con|res)\b|"\d+ ft"/i);
  });

  it("the service builds the sheet from the WO4 profile of the Character's OWN Release; reads never write", () => {
    const get = fn(SERVICE, "getCharacterSheet");
    expect(SERVICE).toMatch(/const \{ c, bundle, ruleset, history, progression \} = await loadCompleted\(id\);\n\s+const profile = requireProfile\(profileOf\(bundle, ruleset, progression\)\);\n\s+const mechanics = buildCharacterSheetMechanics\(\{ bundle, ruleset, profile \}\);/);
    expect(SERVICE).not.toMatch(/latest|newest|findFirst|current\w*Release|rulesetId:|prisma\.|\$queryRaw|\$executeRaw/i);
    expect(get).not.toMatch(/write\w*\(|clearPortrait|update\w*\(/);
    expect(get).toMatch(/identity: \{ id: c\.id, name: c\.name, concept: c\.concept, level: profile\.level, maximumLevel: profile\.maximumLevel,/);
  });

  it("M6-I048 M6-I049 Character Notes and Action Notes are read only into the notes view — never into identity or mechanics", () => {
    const get = fn(SERVICE, "getCharacterSheet");
    expect(get.match(/state\.notes\?\.actionNotes/g)).toHaveLength(1);
    expect(get.match(/state\.notes\?\.characterNotes/g)).toHaveLength(1);
    expect(get).toMatch(/notes: \{ actionNotes: state\.notes\?\.actionNotes \?\? "", characterNotes: state\.notes\?\.characterNotes \?\? "",/);
    expect(SERVICE).not.toMatch(/(actionNotes|characterNotes|item|category)\s*\.\s*(match|includes|split|search|test)\(/);
  });

  it("M6-I053 M6-I054 the sheet never writes the Character row, creation rows or advancement history", () => {
    const writes = [...REPO.matchAll(/(?:prisma|tx)\.(\w+)\.(create|createMany|update|updateMany|delete|deleteMany|upsert)\(/g)].map((m) => m[1]);
    expect(new Set(writes)).toEqual(new Set(["characterPlayState", "characterResourceState", "characterSheetNotes", "characterPortrait", "characterPortraitImage"]));
    expect(SERVICE).not.toMatch(/advanceCharacter|commitAdvancement|saveCharacterCreation|replaceCreationInputs|markCoreCreationComplete|updateCharacterProfile|updateProfile\(/);
  });
});

describe("M6-WO5 gate — play state (§31–§35, §85–§87, M6-I046 M6-I047)", () => {
  it("only current values are accepted; @prowess/game validates them before the compare-and-set write", () => {
    expect(read(`${ROUTE_DIR}/play-state/route.ts`)).toMatch(/readStrictBody\(request, \["expectedVersion", "resources"\]\)/);
    const update = fn(SERVICE, "updateCharacterPlayState");
    expect(update).toMatch(/const issues = validateSheetPlayState\(\{ resources: mechanics\.resources, values: input\.resources \}\);/);
    expect(update.indexOf("validateSheetPlayState")).toBeLessThan(update.indexOf("writePlayState"));
    expect(GAME_SHEET).toMatch(/issues\.push\(\{ code: E\.NOT_A_SHEET_RESOURCE, path: `resources\.\$\{key\}`/);
    expect(GAME_SHEET).toMatch(/numericCompare\(`resource\.\$\{key\}`, raw, "<=", r\.maximum\) !== true\) issues\.push\(\{ code: E\.ABOVE_MAXIMUM/);
    const client = strip(read("apps/studio/app/characters/_lib/character-client.ts"));
    expect(client).toMatch(/updatePlayState = async \(id: string, expectedVersion: number, resources: Record<string, number>\) => \(await request<CharacterSheetDto>\("PUT", `\/api\/characters\/\$\{enc\(id\)\}\/play-state`, \{ expectedVersion, resources \}\)\)/);
  });

  it("every sheet write is a compare-and-set on its own row's lockVersion", () => {
    for (const name of ["writePlayState", "writeSheetNotes", "writePortraitImage", "writePortraitFraming", "clearPortrait"]) {
      expect(fn(REPO, name), name).toMatch(/updateMany\(\{\s*where: \{ characterId, lockVersion: expected/);
    }
    expect(REPO).toMatch(/if \(isUniqueViolation\(e\)\) return \{ outcome: "stale", current: await read\(\) \};/);
  });
});

describe("M6-WO5 gate — portrait (§9–§15, §88–§89, M6-I050 M6-I051)", () => {
  it("only PNG / JPEG / WebP by magic bytes AND a full decode; the size limit is enforced before decoding", () => {
    expect(PORTRAIT).toMatch(/export const PORTRAIT_MIME_TYPES = \["image\/png", "image\/jpeg", "image\/webp"\] as const;/);
    expect(PORTRAIT).not.toMatch(/svg|gif|bmp|tiff|heic/i);
    expect(PORTRAIT).toMatch(/export const PORTRAIT_MAX_BYTES = 8 \* 1024 \* 1024;/);
    expect(PORTRAIT).toMatch(/if \(bytes\.byteLength > PORTRAIT_MAX_BYTES\) return \{ ok: false, reason: "TOO_LARGE"/);
    expect(PORTRAIT).toMatch(/if \(sniffed === null\) return \{ ok: false, reason: "UNSUPPORTED_TYPE"/);
    expect(PORTRAIT).toMatch(/failOn: "error", limitInputPixels: PORTRAIT_MAX_PIXELS/);
    expect(PORTRAIT).toMatch(/if \(meta\.format !== SHARP_FORMAT\[sniffed\]/);
    expect(read(`${ROUTE_DIR}/portrait/route.ts`)).toMatch(/if \(Number\.isFinite\(length\) && length > PORTRAIT_MAX_BYTES \+ MULTIPART_OVERHEAD\)/);
  });

  it("M6-I050 the source is stored exactly as uploaded; framing writes never touch the image bytes", () => {
    expect(PORTRAIT).not.toMatch(/\.(resize|extract|crop|rotate|toFormat|png|jpeg|webp)\(/);
    expect(fn(SERVICE, "uploadCharacterPortrait")).toMatch(/bytes: input\.bytes \}\), "portrait"\);/);
    expect(fn(REPO, "writePortraitFraming")).not.toMatch(/characterPortraitImage|bytes/);
    expect(read(`${ROUTE_DIR}/portrait-transform/route.ts`)).toMatch(/readStrictBody\(request, \["expectedVersion", "zoom", "offsetX", "offsetY"\]\)/);
  });

  it("M6-I051 the frame keeps the source aspect ratio (cover-fit, never stretched) and the image route is protected", () => {
    const framing = strip(read(`${SHEET_UI_DIR}/portrait-framing.ts`));
    expect(framing).toMatch(/const widthPct = imageAspect >= frameAspect \? 100 \* zoom \* \(imageAspect \/ frameAspect\) : 100 \* zoom;/);
    expect(framing).toMatch(/const heightPct = imageAspect >= frameAspect \? 100 \* zoom : 100 \* zoom \* \(frameAspect \/ imageAspect\);/);
    const css = read(`${SHEET_UI_DIR}/character-sheet.css`);
    expect(css).not.toMatch(/object-fit:\s*(fill|stretch)|url\(/);
    const image = read(`${ROUTE_DIR}/portrait/image/route.ts`);
    expect(image).toMatch(/"X-Content-Type-Options": "nosniff"/);
    expect(image).toMatch(/"Content-Security-Policy": "default-src 'none'; sandbox"/);
    expect(image).toMatch(/"Content-Type": image\.mimeType/);
    // No portrait is ever written to a public / filesystem path.
    for (const f of ["packages/prowess-db/src/character/sheet-service.ts", "packages/prowess-db/src/character/sheet-repository.ts", "packages/prowess-db/src/character/portrait-image.ts", ...ROUTES]) expect(strip(read(f)), f).not.toMatch(/writeFile|createWriteStream|node:fs|"fs"|public\//);
  });
});

describe("M6-WO5 gate — Studio presents, never decides (§17–§45, §77–§78, M6-I046 M6-I055 M6-I056)", () => {
  it("the Character frontend imports no database, Prisma or rules package; only the API client fetches", () => {
    for (const f of UI) {
      const src = read(f);
      expect(src, f).not.toMatch(/from "(@prowess\/(db|game|rules)|@prisma\/client)[^"]*"/);
      if (!f.endsWith("_lib/character-client.ts")) expect(strip(src), f).not.toMatch(/\bfetch\(/);
    }
    expect(SHEET_UI.map((f) => path.basename(f)).sort()).toEqual(["CharacterSheet.tsx", "PortraitFrame.tsx", "SheetIcons.tsx", "SheetPanels.tsx", "portrait-framing.ts"]);
  });

  it("no mechanical arithmetic or formula text in the sheet: every number is the server's, formatted only", () => {
    for (const f of SHEET_UI) {
      const src = strip(read(f));
      expect(src, f).not.toMatch(/\.(maximum|score|total|value|bonus|faces|level)\s*[+*-]\s*[\w(]/);
      expect(src, f).not.toMatch(/[+*-]\s*\w+\.(maximum|score|total|faces|level)\b/);
      expect(src, f).not.toMatch(/To-Hit|Evasion|ft\s*[×x*]|×\s*(AGI|PER|PRO|STR|CON|RES)|Movement\s*=|maximumHp|MAXIMUM_HP|BASE_RANGE/);
      expect(src, f).not.toMatch(/held\)\.length|ranks\.filter/);
    }
    const panels = strip(read(`${SHEET_UI_DIR}/SheetPanels.tsx`));
    expect(panels).toMatch(/<td data-testid="sheet-skill-score">\{s\.score === null \? "—" : signed\(s\.score\)\}<\/td>/);
    expect(panels).toMatch(/<Value v=\{s\.savingThrow\} sign testId=\{`sheet-save-\$\{s\.stat\}`\} \/>/);
    expect(panels).toMatch(/\["accuracy", "Accuracy", /);
    expect(panels).toMatch(/\["dodge", "Dodge", /);
  });

  it("M6-I055 Equipment & Gear and Granted Effects are explicit boundaries; Actions stay player text (M6-I049)", () => {
    expect(SERVICE).toMatch(/equipment: \{ available: false, mainHand: null, offHand: null, armor: null, accessorySlots: mechanics\.attunement\.maximum\.value, accessories: \[\] \},/);
    expect(SERVICE).toMatch(/grantedEffects: \[\],/);
    const all = [...SHEET_UI, ...ROUTES].map((f) => strip(read(f))).join("\n");
    expect(all).not.toMatch(/equipItem|addWeapon|createSpell|createManeuver|abilityCard|turnOrder|initiativeTracker/i);
    expect(walk("apps/studio/app/api/characters").filter((f) => /equip|inventor|abilit|spell|maneuver|encounter/i.test(f))).toEqual([]);
  });

  it("the Sheet is the default Character view; the WO4 advancement views stay one tab away", () => {
    const summary = strip(read("apps/studio/app/characters/_components/CharacterSheetSummary.tsx"));
    expect(summary).toMatch(/const requested = useSearchParams\(\)\?\.get\("view"\) \?\? "sheet";/);
    expect(summary).toMatch(/\{view === "sheet" \? <CharacterSheet characterId=\{c\.id\} \/> : null\}/);
    expect(summary).toMatch(/<CharacterProgress character=\{c\} \/>/);
  });

  it("M6-I056 print reuses the same components in print mode — no controls, no separate rule source", () => {
    const page = strip(read("apps/studio/app/characters/[characterId]/print/page.tsx"));
    expect(page).toMatch(/<CharacterSheet characterId=\{characterId\} mode="print" \/>/);
    const sheet = strip(read(`${SHEET_UI_DIR}/CharacterSheet.tsx`));
    expect(sheet).toMatch(/const supplemental = mode === "print" && \(possessionsOverflow \|\| textOverflow/);
    expect(read(`${SHEET_UI_DIR}/character-sheet.css`)).toMatch(/@page \{ size: letter; margin: 0; \}/);
  });
});

describe("M6-WO5 gate — routes and API boundary (§85)", () => {
  const methods = (f: string) => [...read(f).matchAll(/export async function (GET|POST|PUT|PATCH|DELETE)\(/g)].map((m) => m[1]).sort();
  it("the six routes are registered under M6-WO5 and export exactly their methods", () => {
    const registry = JSON.parse(read("docs/architecture/m6-api-routes.json")) as Record<string, unknown>;
    expect(registry["M6-WO5"]).toEqual([...ROUTES].sort());
    const expected: Record<string, string[]> = { notes: ["PUT"], "play-state": ["PUT"], "portrait-transform": ["PUT"], "portrait/image": ["GET"], portrait: ["DELETE", "POST"], sheet: ["GET"] };
    for (const f of ROUTES) expect(methods(f), f).toEqual(expected[f.replace(`${ROUTE_DIR}/`, "").replace("/route.ts", "")]);
    expect(read(`${ROUTE_DIR}/notes/route.ts`)).toMatch(/readStrictBody\(request, \["expectedVersion", "companyPac", "actionNotes", "characterNotes", "possessions"\]\)/);
  });

  it("routes stay thin: @prowess/db only, no Prisma, no rules package", () => {
    for (const f of ROUTES) {
      const src = strip(read(f));
      expect(src, f).not.toMatch(/@prisma\/client|@prowess\/(game|rules)|prisma\./);
      expect(src, f).toMatch(/from "@prowess\/db"/);
    }
  });

  it("sheet error codes map to HTTP statuses (invalid 422, too large 413, no image 404, stale 409)", () => {
    const errors = read("apps/studio/src/api/errors.ts");
    for (const [c, status] of [["INVALID_PLAY_STATE", 422], ["INVALID_SHEET_NOTES", 422], ["INVALID_PORTRAIT", 422], ["PORTRAIT_TOO_LARGE", 413], ["PORTRAIT_NOT_FOUND", 404], ["STALE_WRITE", 409]] as const) {
      expect(errors, c).toMatch(new RegExp(`\\[CHARACTER_ERROR_CODES\\.${c}\\]:\\s*${status}`));
    }
  });
});

describe("M6-WO5 gate — approved M5 change, invariants, documentation and CI (§120–§125)", () => {
  it("the approved M5 change registry lists exactly the WO5 files and their current hashes", () => {
    const approved = JSON.parse(read("docs/architecture/m6-approved-m5-changes.json")) as Record<string, { changedFiles: Record<string, string>; addedFiles: Record<string, string> } | string>;
    const wo5 = approved["M6-WO5"] as { changedFiles: Record<string, string>; addedFiles: Record<string, string> };
    expect(Object.keys(wo5.changedFiles).sort()).toEqual(["packages/prowess-game/src/index.ts"]);
    expect(Object.keys(wo5.addedFiles).sort()).toEqual(["packages/prowess-game/src/character-sheet.test.ts", "packages/prowess-game/src/character/sheet.ts"]);
    for (const [f, h] of [...Object.entries(wo5.changedFiles), ...Object.entries(wo5.addedFiles)]) expect(hash(readFileSync(path.join(ROOT, f))), f).toBe(h);
  });

  it("M4 source is untouched (frozen hashes since M6-WO2)", () => {
    const wo2 = JSON.parse(read("docs/architecture/m6-wo2-baseline.json")) as { frozenFiles: Record<string, string> };
    const m4 = Object.entries(wo2.frozenFiles).filter(([f]) => f.startsWith("packages/prowess-rules/src/"));
    expect(m4.length).toBeGreaterThan(20);
    for (const [f, h] of m4) expect(hash(readFileSync(path.join(ROOT, f))), f).toBe(h);
  });

  const inv = JSON.parse(read("docs/architecture/m6-invariants.json")) as Array<{ id: string; title: string; guards: string[] }>;
  it("M6-I045–I056 follow M6-I001–I044, are documented, and each is guarded by executing files that cite it", () => {
    expect(inv.map((x) => x.id)).toEqual(Array.from({ length: 56 }, (_, i) => `M6-I${String(i + 1).padStart(3, "0")}`));
    const md = read("docs/architecture/m6-invariants.md");
    for (const row of inv.slice(44, 56)) {
      expect(md).toContain(`### ${row.id} — ${row.title}`);
      expect(row.guards).toContain("apps/studio/tests/unit/m6-wo5-static.test.ts");
      expect(row.guards).toContain("scripts/m6-wo5-negative-controls.mjs");
      for (const g of row.guards) {
        expect(existsSync(path.join(ROOT, g)), g).toBe(true);
        if (/\.test\.tsx?$/.test(g)) expect(read(g), `${row.id} → ${g}`).toContain(row.id);
      }
    }
  });

  it("the architecture document and the implementation report exist with their required sections", () => {
    const doc = read("docs/architecture/m6-digital-character-sheet.md");
    expect(doc).toContain("The approved two-page Prowess Field Manual mockup is the canonical visual direction for the Digital Character Sheet. Exact section dimensions are implementation-flexible and should be optimized for real player usage.");
    for (const h of ["Read Model", "Mechanical Values", "Play State", "Notes", "Portrait", "Layout", "Print", "API", "Integration Boundaries", "Known Limitations"]) expect(doc, h).toMatch(new RegExp(`^## \\d+\\. ${h}$`, "m"));
    expect(existsSync(path.join(ROOT, "docs/design/m6-wo5-field-manual-character-sheet-mockup.png"))).toBe(true);
    const report = read("docs/reports/m6-wo5-implementation-report.md");
    for (const h of ["Test Totals", "Architecture Gate", "Controls"]) expect(report, h).toMatch(new RegExp(`^## \\d+\\. ${h}`, "m"));
  });

  it("the M6-WO5 gate is a named step of the consolidated CI workflow with its exact control count; no m6-wo5.yml", () => {
    const ci = read(".github/workflows/ci.yml");
    expect(ci).toMatch(/- name: M6-WO5 — Digital Character Sheet\n\s+run: \|\n[\s\S]*?node scripts\/ci\/verify-gate\.mjs M6-WO5 [^\n]*\n\s+PROWESS_EXPECT_CONTROLS=\d+ node scripts\/m6-wo5-negative-controls\.mjs/);
    expect(existsSync(path.join(ROOT, ".github/workflows/m6-wo5.yml"))).toBe(false);
    const gates = JSON.parse(read("scripts/ci/gates.json")) as { gates: Array<{ id: string; tests: string[]; controls: { script: string; count: number } | null }> };
    const gate = gates.gates.find((g) => g.id === "M6-WO5");
    expect(gate?.controls?.script).toBe("scripts/m6-wo5-negative-controls.mjs");
    expect(gate?.controls?.count).toBeGreaterThanOrEqual(24);
    const count = Number(/PROWESS_EXPECT_CONTROLS=(\d+) node scripts\/m6-wo5-negative-controls\.mjs/.exec(ci)?.[1]);
    expect(count).toBe(gate?.controls?.count);
    for (const t of gate?.tests ?? []) expect(existsSync(path.join(ROOT, t)), t).toBe(true);
  });
});
