import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { auditM5Source } from "./m5-wo1-audit-helpers";
import { auditWo2Source } from "./m5-wo2-audit-helpers";
import { auditWo3Source } from "./m5-wo3-audit-helpers";
import { callsNamed, descendants, namedFunction, namedVariable, parseSource, syntaxIs } from "./m6-wo8-audit-helpers";

/**
 * PAS-10 M6-WO10 — Character Play Workspace: the permanent architecture gate (invariants M6-I151 – M6-I172). Every test
 * names the invariants it protects (prefix "W10-"); scripts/m6-wo10-negative-controls.mjs mutates the real sources these
 * assertions read and requires the named test to fail. Behaviour is proven by the game, DB, API, UI and browser suites
 * registered with this gate; this file pins the structure those suites rely on.
 */
const ROOT = path.resolve(process.cwd(), "../..");
const read = (f: string) => readFileSync(path.join(ROOT, f), "utf8");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
const src = (f: string) => parseSource(f, read(f));
const G = "packages/prowess-game/src/";
const PLAY = G + "play/";
const GAME_FILES = ["contract.ts", "engine.ts", "abilities.ts", "operations.ts", "state.ts", "workspace.ts"].map((f) => PLAY + f);
const ROUND = G + "internal/round.ts";
const OPS = PLAY + "operations.ts";
const SERVICE = "packages/prowess-db/src/character/play-service.ts";
const REPO = "packages/prowess-db/src/character/play-repository.ts";
const MIGRATION = "packages/prowess-db/prisma/migrations/20261108010000_m6_wo10_character_play_workspace/migration.sql";
const API = "apps/studio/app/api/characters/[characterId]/play/";
const ROUTES = [API + "route.ts", API + "preview/route.ts", API + "operations/route.ts", API + "events/route.ts"];
const UI_DIR = "apps/studio/app/characters/_components/play";
const UI_FILES = [...readdirSync(path.join(ROOT, UI_DIR)).filter((f) => /\.tsx?$/.test(f)).map((f) => `${UI_DIR}/${f}`), "apps/studio/app/characters/_lib/play-types.ts", "apps/studio/app/characters/[characterId]/play/page.tsx"];
const fn = (file: string, name: string) => namedFunction(src(file), name);
const position = (text: string, needle: string) => {
  const i = text.indexOf(needle);
  expect(i, needle).toBeGreaterThanOrEqual(0);
  return i;
};

/** Studio play UI: arithmetic on a mechanical field (or a value derived from one), Math, fetch, writes and domain imports. */
export function playUiFindings(file: string, text: string): string[] {
  const root = parseSource(file, text);
  const found = new Set<string>();
  const mechanical = /^(current|maximum|minimum|reservedCapacity|amount|ap|mp|me|value|costs|finalApCost|finalMpCost|apCost|mpCost|movementAllowance|allowanceCost|distance|total|dc|difficultyClass|targetDodge|dodge|round|investedAp|requiredAp|grants|segments|concentrationDc|pro|finalSpellMp)$/;
  const aliases = new Set<string>();
  const touches = (node: ts.Node) => descendants(node, (n): n is ts.Identifier => ts.isIdentifier(n)).some((n) => mechanical.test(n.text) || aliases.has(n.text));
  const vars = descendants(root, ts.isVariableDeclaration);
  for (let pass = 0; pass < vars.length; pass += 1) {
    let changed = false;
    for (const v of vars) if (ts.isIdentifier(v.name) && v.initializer && touches(v.initializer) && !aliases.has(v.name.text) && !ts.isArrowFunction(v.initializer) && !ts.isFunctionExpression(v.initializer)) {
      aliases.add(v.name.text);
      changed = true;
    }
    if (!changed) break;
  }
  const arithmetic = new Set([ts.SyntaxKind.PlusToken, ts.SyntaxKind.MinusToken, ts.SyntaxKind.AsteriskToken, ts.SyntaxKind.SlashToken, ts.SyntaxKind.PercentToken, ts.SyntaxKind.AsteriskAsteriskToken, ts.SyntaxKind.PlusEqualsToken, ts.SyntaxKind.MinusEqualsToken]);
  for (const n of descendants(root, ts.isBinaryExpression)) {
    const stringy = n.operatorToken.kind === ts.SyntaxKind.PlusToken && (ts.isStringLiteral(n.left) || ts.isStringLiteral(n.right) || ts.isTemplateExpression(n.left) || ts.isTemplateExpression(n.right));
    if (arithmetic.has(n.operatorToken.kind) && touches(n) && !stringy) found.add("client-mechanical-arithmetic");
  }
  for (const n of descendants(root, (x): x is ts.PrefixUnaryExpression | ts.PostfixUnaryExpression => ts.isPrefixUnaryExpression(x) || ts.isPostfixUnaryExpression(x))) {
    if ([ts.SyntaxKind.PlusPlusToken, ts.SyntaxKind.MinusMinusToken].includes(n.operator) && touches(n)) found.add("client-mechanical-arithmetic");
  }
  for (const n of descendants(root, ts.isCallExpression)) {
    const callee = n.expression.getText();
    if (callee === "fetch" || /^Math\./.test(callee)) found.add("client-mechanical-authority");
    if (/^(update|create|finalize|retire|rebuild|validate|upload|remove|save|apply)[A-Z]/.test(callee)) found.add("client-write");
  }
  for (const n of descendants(root, (x): x is ts.ImportDeclaration => ts.isImportDeclaration(x))) {
    if (ts.isStringLiteral(n.moduleSpecifier) && /^(@prowess\/(game|rules|db|model)|@prisma\/client)/.test(n.moduleSpecifier.text)) found.add("client-domain-import");
  }
  return [...found].sort();
}

describe("M6-WO10 permanent Character Play Workspace contracts", () => {
  it("W10-I151 I171 the game play modules pass the M5-WO1 / WO2 / WO3 audits; the only arithmetic is the round ordinal", () => {
    for (const f of GAME_FILES) {
      expect(existsSync(path.join(ROOT, f)), f).toBe(true);
      expect(auditM5Source(read(f), f, "game"), f).toEqual([]);
      expect(auditWo2Source(read(f), f, "game"), f).toEqual([]);
      expect(auditWo3Source(read(f), f, "game"), f).toEqual([]);
      expect(strip(read(f)), f).not.toMatch(/@prowess\/db|prisma|Math\.random|Date\.now|new Date\(/i);
    }
    // The audits still bite on these files (a self-check, so a renamed helper can never silently disable them).
    expect(auditM5Source(`${read(OPS)}\nexport const discounted = (n: number) => n - 1;`, OPS, "game")).toContain("hidden-math");
    expect(auditWo3Source(`${read(OPS)}\nexport const commitTurn = () => 1;`, OPS, "game")).toContain("persistence");
    expect(auditWo3Source(`${read(OPS)}\nexport const x = (k: string) => k === "MOVEMENT_ALLOWANCE";`, OPS, "game")).toContain("resource-name-branch");
    // internal/round.ts: one function, the ordinal 1, 2, 3 … — never an amount.
    expect(syntaxIs(fn(ROUND, "nextRoundOrdinal").body!, "{ return previous === null ? 1 : previous + 1; }")).toBe(true);
    expect(strip(read(ROUND)).replace(/\s+/g, " ").trim()).toBe("export function nextRoundOrdinal(previous: number | null): number { return previous === null ? 1 : previous + 1; }");
    expect(read(ROUND).replace(/\s*\n\s*\*\s*/g, " ")).toContain("sequence bookkeeping — never a Resource amount, cost, capacity, distance or roll");
    expect(callsNamed(fn(OPS, "timing"), "nextRoundOrdinal")).toHaveLength(1);
  });

  it("W10-I151 every Resource change runs through the WO3 runtime compiler on M4; the sheet is the one resource authority", () => {
    const engine = src(PLAY + "engine.ts");
    const runPlan = namedFunction(engine, "runPlan");
    for (const call of ["compileRuntime", "buildRuntimeContexts", "orchestrateRulesEvaluation", "readRuntimeRun"]) expect(callsNamed(runPlan, call), call).toHaveLength(1);
    expect(callsNamed(namedFunction(engine, "payAction"), "confirmActionPayment")).toHaveLength(1);
    expect(syntaxIs(callsNamed(namedFunction(engine, "payAction"), "runPlan")[0]!.arguments[1]!, '{ kind: "ACTION_PAYMENT", ...subject }')).toBe(true);
    // Nothing else in the play domain compiles or runs a runtime plan of its own.
    for (const f of GAME_FILES.filter((x) => !x.endsWith("engine.ts"))) for (const call of ["compileRuntime", "readRuntimeRun", "confirmActionPayment"]) expect(callsNamed(src(f), call), `${f} ${call}`).toHaveLength(0);
    // The current values: the sheet's stored current (or its derived maximum) — the runtime holds only the turn-scoped pool.
    const resources = fn(OPS, "runtimeResourcesOf");
    expect(syntaxIs(namedVariable(resources, "current").initializer!, "onSheet?.current ?? sheet?.maximum ?? null")).toBe(true);
    expect(syntaxIs(namedVariable(src(OPS), "RUNTIME_HELD_RESOURCES").initializer!, "Object.freeze({ MOVEMENT_ALLOWANCE: (runtime: PlayRuntimeState) => runtime.movementAllowance, })")).toBe(true);
    // The service writes exactly the sheet Resources that changed, through the one compare-and-set.
    const commit = fn(SERVICE, "commitCharacterPlayOperation");
    expect(syntaxIs(namedVariable(commit, "changed").initializer!, "outcome.resourcesAfter.filter((r) => sheetKeys.has(r.resourceKey) && before.get(r.resourceKey) !== r.current).map((r) => ({ resourceKey: r.resourceKey, current: r.current }))")).toBe(true);
    expect(callsNamed(fn(REPO, "commitPlayOperation"), "writePlayStateWithin")).toHaveLength(1);
  });

  it("W10-I152 exact Character, Release and revision provenance", () => {
    const initial = fn(OPS, "initialPlayRuntime").getText();
    for (const field of ["characterId: ctx.characterId", "releaseId: ctx.releaseId", "rulesetProvenance: ctx.bundle.rulesetProvenance", "advancementCount: ctx.advancementCount"]) expect(initial).toContain(field);
    const maneuver = fn(OPS, "maneuver").getText();
    expect(maneuver).toContain("if (found.revisionNumber !== op.revisionNumber) return refuse(R.REVISION_CHANGED");
    expect(maneuver).toContain("if (found.revisionReleaseId !== ctx.releaseId) return refuse(R.RELEASE_MISMATCH");
    const castable = fn(OPS, "castableSpell").getText();
    expect(castable).toContain("if (source.revisionNumber !== revisionNumber) return { error: { ...refuse(R.REVISION_CHANGED");
    expect(castable).toContain("if (source.revisionReleaseId !== ctx.releaseId) return { error: refuse(R.RELEASE_MISMATCH");
    expect(read(PLAY + "state.ts")).toContain('if (value.characterId !== expected.characterId) return { ok: false, reason: "the stored play state belongs to another Character" };');
    // The runtime row is bound to its Release; the database refuses any other.
    expect(fn(REPO, "commitPlayOperation").getText()).toContain("where: { characterId, lockVersion: input.expectedRuntimeVersion, rulesetReleaseId: input.rulesetReleaseId }");
    const sql = read(MIGRATION);
    expect(sql).toMatch(/CREATE TRIGGER "character_play_events_runtime_release" BEFORE INSERT ON "character_play_events"/);
    expect(sql).toMatch(/CREATE TRIGGER "character_play_runtimes_release_immutable" BEFORE UPDATE ON "character_play_runtimes"/);
    expect(read(SERVICE)).toContain("releaseId: c.rulesetReleaseId,");
  });

  it("W10-I153 the server evaluates a closed operation contract over exact registered routes", () => {
    const reader = fn(OPS, "readPlayOperation");
    const kinds = descendants(reader, ts.isCaseClause).map((c) => (ts.isStringLiteral(c.expression) ? c.expression.text : "?"));
    const contract = [...namedVariable(src(PLAY + "contract.ts"), "PLAY_OPERATION_KINDS").initializer!.getText().matchAll(/"([A-Z_]+)"/g)].map((m) => m[1]!);
    expect(contract).toEqual(["TIMING", "GENERAL_ACTION", "MOVEMENT", "WEAPON_ATTACK", "SPELL", "MANEUVER", "ACTIVE_MAGIC", "MANUAL_ADJUSTMENT", "NOTE", "RECONCILE"]);
    expect(contract).toHaveLength(10);
    for (const k of contract) expect(kinds, k).toContain(k);
    expect(reader.getText()).toMatch(/default:\s*return bad\(/);
    // Registered routes, strict bodies and queries, @prowess/db only.
    const registry = JSON.parse(read("docs/architecture/m6-api-routes.json")) as Record<string, string[]>;
    expect([...registry["M6-WO10"]!].sort()).toEqual([...ROUTES].sort());
    expect(read(API + "preview/route.ts")).toContain('readStrictBody(request, ["operation", "expectedRuntimeVersion", "expectedPlayStateVersion"])');
    expect(read(API + "operations/route.ts")).toContain('readStrictBody(request, ["operation", "idempotencyKey", "expectedRuntimeVersion", "expectedPlayStateVersion"])');
    expect(read(API + "events/route.ts")).toMatch(/\["before", "limit"\]/);
    for (const r of ROUTES) {
      const imports = descendants(src(r), ts.isImportDeclaration).map((i) => (i.moduleSpecifier as ts.StringLiteral).text);
      expect(imports, r).toContain("@prowess/db");
      for (const m of imports.filter((x) => !x.startsWith("."))) expect(["@prowess/db", "@prowess/model"], `${r} ${m}`).toContain(m);
    }
  });

  it("W10-I154 preview never writes; commit re-evaluates on the server before its one write", () => {
    const preview = fn(SERVICE, "previewCharacterPlayOperation");
    expect(callsNamed(preview, "evaluatePlayOperation")).toHaveLength(1);
    expect(callsNamed(preview, "commitPlayOperation")).toHaveLength(0);
    expect(callsNamed(preview, "staleIf")).toHaveLength(1);
    expect(read(API + "preview/route.ts")).not.toMatch(/commitCharacterPlayOperation/);
    const commit = fn(SERVICE, "commitCharacterPlayOperation");
    const text = commit.getText();
    expect(callsNamed(commit, "load")).toHaveLength(1);
    expect(callsNamed(commit, "evaluatePlayOperation")).toHaveLength(1);
    expect(callsNamed(commit, "commitPlayOperation")).toHaveLength(1);
    expect(position(text, "staleIf(l, expected);")).toBeLessThan(position(text, "evaluatePlayOperation(l.ctx, l.stored, operation)"));
    expect(position(text, 'if (outcome.status !== "COMMITTABLE" || outcome.runtimeAfter === null || outcome.resourcesAfter === null) return { committed: false')).toBeLessThan(position(text, "await commitPlayOperation({"));
    // The evaluation itself is pure: no persistence import anywhere in the play domain (I151 audit) and no clock.
    expect(strip(read(OPS))).not.toMatch(/Date|setTimeout|globalThis/);
  });

  it("W10-I155 one transaction writes the sheet, the runtime and exactly one event", () => {
    const commit = fn(REPO, "commitPlayOperation");
    expect(callsNamed(commit, "prisma.$transaction")).toHaveLength(1);
    const tx = callsNamed(commit, "prisma.$transaction")[0]!.arguments[0]!.getText();
    expect(position(tx, "writePlayStateWithin(tx,")).toBeLessThan(position(tx, "tx.characterPlayRuntime."));
    expect(position(tx, "tx.characterPlayRuntime.updateMany(")).toBeLessThan(position(tx, "tx.characterPlayEvent.create("));
    expect(tx.match(/tx\.characterPlayEvent\.create\(/g)).toHaveLength(1);
    expect(tx).not.toMatch(/prisma\./);
    expect(tx).toContain('throw new Abort({ outcome: "stale", which: "PLAY_STATE" })');
    expect(tx).toContain('throw new Abort({ outcome: "stale", which: "RUNTIME" })');
    // No other module of the database package touches the play tables.
    const dir = path.join(ROOT, "packages/prowess-db/src");
    const walk = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : /\.ts$/.test(e.name) && !/\.test\.ts$/.test(e.name) ? [path.join(d, e.name)] : []));
    const touching = walk(dir).filter((f) => /characterPlay(Runtime|Event)\b|character_play_/.test(readFileSync(f, "utf8"))).map((f) => path.relative(ROOT, f));
    expect(touching).toEqual([REPO]);
  });

  it("W10-I156 commits are idempotent per Character: a client key, a request hash and a unique index", () => {
    const commit = fn(SERVICE, "commitCharacterPlayOperation").getText();
    expect(commit).toContain("if (typeof input.idempotencyKey !== \"string\" || !UUID.test(input.idempotencyKey)) throw fail(CHARACTER_ERROR_CODES.INVALID_INPUT");
    expect(commit).toContain('createHash("sha256").update(canonical({ operation: input.operation, expectedRuntimeVersion: expected.runtimeVersion, expectedPlayStateVersion: expected.playStateVersion })).digest("hex")');
    expect(commit).toContain("if (prior.requestHash !== requestHash) throw fail(CHARACTER_ERROR_CODES.PLAY_IDEMPOTENCY_CONFLICT");
    expect(commit).toContain('if (result.outcome === "duplicate") return replay();');
    expect(position(commit, "if ((await selectPlayEventByKey(characterId, key)) !== null) return replay();")).toBeLessThan(position(commit, "const l = await load(characterId);"));
    expect(read(MIGRATION)).toContain('CREATE UNIQUE INDEX "character_play_events_character_idempotency_key" ON "character_play_events"("character_id", "idempotency_key");');
    // The browser reuses the key of an unacknowledged submission and only that submission.
    const ui = read(UI_DIR + "/PlayWorkspace.tsx");
    expect(ui).toContain("if (pendingKey.current === null || pendingKey.current.body !== body) pendingKey.current = { key: newKey(), body };");
    expect(ui).toContain("const newKey = () => globalThis.crypto.randomUUID();");
  });

  it("W10-I157 optimistic concurrency on both versions; a stale submission applies nothing and reloads", () => {
    expect(fn(SERVICE, "staleIf").getText()).toMatch(/expected\.runtimeVersion !== l\.versions\.runtimeVersion \|\| expected\.playStateVersion !== l\.versions\.playStateVersion/);
    const tx = fn(REPO, "commitPlayOperation").getText();
    expect(tx).toContain("if (written === null) throw new Abort");
    expect(tx).toContain("if (playStateVersion !== input.expectedPlayStateVersion) throw new Abort");
    expect(tx).toContain("if (claimed.count !== 1) throw new Abort");
    expect(read("packages/prowess-db/src/character/sheet-repository.ts")).toMatch(/export async function writePlayStateWithin\(/);
    const ui = read(UI_DIR + "/PlayWorkspace.tsx");
    expect(ui).toMatch(/e\.code === "CHARACTER\.STALE_WRITE"\) \{\n\s+setNotice\("This Character's play state changed elsewhere[^"]*"\);\n\s+pendingKey\.current = null;/);
  });

  it("W10-I158 I159 nothing is paid for an incomplete, refused or unsupported resolution, and nothing is charged twice", () => {
    for (const name of ["spell", "maneuver", "weaponAttack"]) {
      const text = fn(OPS, name).getText();
      expect(position(text, 'status: "PENDING_INPUT"'), name).toBeLessThan(position(text, "payCosts(engine, resources,"));
      expect(text.match(/payCosts\(/g), name).toHaveLength(1);
    }
    const general = fn(OPS, "generalAction").getText();
    expect(general).toContain('if (paid.confirmation.status !== "PAID") return { ...paymentRefusal(paid.confirmation), source };');
    expect(general.match(/payAction\(/g)).toHaveLength(1);
    // A follow-on reads the PAID receipt; it is never a second payment.
    expect(general).toContain('runPlan(engine, { kind: "ACTION_FOLLOW_ON", subjectKey: `${subject.subjectKey}.follow_on`, receipt: paid.confirmation }, after)');
    // Spell AP through the Release's VARIABLE-by-SPELL Action at the WO10 Final AP; Spell MP is ME-eligible (M5-SC-004).
    const spell = fn(OPS, "spell").getText();
    expect(spell).toContain('a.payload.actionPointCost.model === "VARIABLE" && a.payload.actionPointCost.determinedBy === "SPELL"');
    expect(spell).toContain('ap: { kind: "ACTION", subject: { subjectKey: "play.spell.cast", actionKey: cast.payload.actionKey, window: windowOf(runtime), actionPointCost: costs.finalApCost, costSourceKey: label } }, mp: { amount: costs.finalMpCost, meEligible: SPELL_CASTING_ME_ELIGIBLE, sourceKey: label }');
    expect(syntaxIs(namedVariable(src(OPS), "SPELL_CASTING_ME_ELIGIBLE").initializer!, "true as const")).toBe(true);
    // Maneuver and Attack AP are spent by their own source; their MP is never ME-eligible.
    expect(fn(OPS, "maneuver").getText()).toContain('ap: { kind: "SPEND", amount: costs.finalApCost, sourceKey: label }, mp: costs.finalMpCost > 0 ? { amount: costs.finalMpCost, meEligible: false, sourceKey: label } : null');
    expect(syntaxIs(fn(OPS, "attackCosts").body!, '{ const ap = listedAttackCost(a, "apCost"); const mp = listedAttackCost(a, "mpCost"); return { ap: { kind: "SPEND", amount: ap, sourceKey: a.attack.canonicalKey }, mp: mp > 0 ? { amount: mp, meEligible: false, sourceKey: a.attack.canonicalKey } : null }; }')).toBe(true);
    // Unsupported Attack resolution modes are REFERENCE_ONLY, never paid.
    const support = fn(OPS, "attackResolutionSupport").getText();
    expect(support).toContain('if (attack.resolution.mode === "DEFERRED") return { supported: false');
    expect(support).toContain('if (attack.resolution.mode === "SAVING_THROW") return { supported: false');
    expect(support).toContain("if (attack.accuracyModifier !== 0) return { supported: false");
    expect(read(PLAY + "workspace.ts")).toContain('!support.supported ? "REFERENCE_ONLY"');
  });

  it("W10-I160 timing transitions follow the exact sequence and only run authored RESOURCE_TIMING behaviour", () => {
    const refusal = fn(OPS, "timingRefusal").getText();
    expect(refusal).toContain('c.turn === "ENDED" ? "this Character has already taken its turn this round (AP would refresh twice)"');
    expect(refusal).toContain('c.phase !== "AWAITING_ROUND" ? "the current round has not ended"');
    expect(syntaxIs(fn(OPS, "legalTimingEvents").body!, "{ const c = runtime.combat; return PLAY_TIMING_EVENTS.filter((e) => timingRefusal(c, e) === null); }")).toBe(true);
    const run = fn(OPS, "runTiming").getText();
    expect(run).toContain('runPlan(engine, { kind: "RESOURCE_TIMING", subjectKey, event }, resources)');
    expect(run).toContain("d.refresh.some((r) => r.timing === event) || d.expiry.some((r) => r.timing === event)");
    const timing = fn(OPS, "timing").getText();
    for (const [event, wo3] of [["START_ROUND", "START_OF_ROUND"], ["START_TURN", "START_OF_TURN"], ["END_TURN", "END_OF_TURN"], ["END_ROUND", "END_OF_ROUND"]] as const) {
      expect(timing, event).toContain(`case "${event}":`);
      expect(timing, wo3).toContain(`timed("${wo3}",`);
    }
    // Workspace offers only the legal events (and none while the stored identity differs).
    expect(read(PLAY + "workspace.ts")).toContain("timing: { legal: sameIdentity ? legalTimingEvents(runtime) : [], window },");
  });

  it("W10-I161 I163 General Action cost models and Counter Action legality come from the Action Definition", () => {
    const general = fn(OPS, "generalAction").getText();
    expect(general).toContain("const cost = action.payload.actionPointCost;");
    expect(general).toContain("never priced as zero");
    expect(general).toContain('if ((cost.model === "RANGE" || cost.model === "MINIMUM") && op.chosenCost === undefined)');
    expect(general).toContain('if ((cost.model === "FIXED" || cost.model === "NONE") && op.chosenCost !== undefined) return refuse(R.INVALID_OPERATION');
    expect(general).toContain('if (overrides.length > 1) return refuse(R.IMPROVEMENT_CONFLICT');
    expect(general).toContain('m.support === "APPLIED" && m.condition === null');
    // Counter Actions: outside the own turn, in combat, with a declared trigger — the Counter Action pool alone is never enough.
    expect(general).toContain('if (action.payload.timing === "OUTSIDE_OWN_TURN") {\n    if (!runtime.combat.active) return refuse(R.NOT_IN_COMBAT');
    expect(general).toContain('if (action.payload.requiresTrigger && op.trigger === undefined) return { ...refuse(R.TRIGGER_REQUIRED');
    // No Action name is branched on anywhere in the play domain (WO3 audit) — the cast Action is found by its cost model.
    expect(strip(read(OPS))).not.toMatch(/"CAST_SPELL"|"COUNTER_REACTION"|"DODGE_ACTION"/);
  });

  it("W10-I162 movement spends the granted allowance per segment at the authored terrain cost", () => {
    const move = fn(OPS, "move").getText();
    expect(move).toContain('if (windowOf(runtime) !== "OWN_TURN") return refuse(R.WRONG_TIMING_WINDOW');
    expect(move).toContain('runPlan(engine, { kind: "MOVEMENT", subjectKey: "play.movement", segments: op.segments }, resources)');
    expect(read(OPS)).toMatch(/!\(TERRAIN_KINDS as readonly unknown\[\]\)\.includes\(s\.terrainKey\)/);
    // The allowance is granted only by a PAID Action's follow-on, and refreshes at the turn start (never carried across).
    expect(fn(OPS, "timing").getText()).toContain('next = { ...next, combat: { ...c, turn: "ACTIVE" }, movement: { grants: [], segments: [] } };');
    expect(fn(OPS, "withResources").getText()).toContain('currentOf(resources, "MOVEMENT_ALLOWANCE")');
  });

  it("W10-I164 raw rolls are inputs; the engine decides totals; Saving Throws are the defender's (GM provided)", () => {
    const abilities = src(PLAY + "abilities.ts");
    const built = namedFunction(abilities, "buildResolutionInputs").getText();
    expect(built).toContain('roller: "DEFENDER_GM_PROVIDED"');
    expect(built).toContain('source: input.difficultyClass === undefined ? "CHARACTER_DC" : "PLAYER_GM_PROVIDED"');
    expect(namedFunction(abilities, "describePending").getText()).toContain('defenderStats: request.kind === "SAVING_THROW" ? [...PROWESS_STATS] : null');
    const attack = fn(OPS, "weaponAttack").getText();
    expect(attack).toContain('procedure: "ATTACK_ROLL", mode: op.roll.mode');
    expect(callsNamed(fn(OPS, "weaponAttack"), "compileCoreResolution")).toHaveLength(1);
    // Optional digital dice: CSPRNG rejection sampling, faces only — never Math.random, never a total.
    const dice = read(UI_DIR + "/play-dice.ts");
    expect(dice).toContain("globalThis.crypto.getRandomValues(buffer);");
    expect(dice).toContain("const limit = 0x100000000 - (0x100000000 % faces);");
    expect(dice).toContain("if (v < limit) out.push((v % faces) + 1);");
    expect(strip(dice)).not.toMatch(/Math\.random|total|success|critical/i);
  });

  it("W10-I165 Spells use the WO12 Effect Chain; Maneuvers keep independent groups", () => {
    const spell = fn(OPS, "spell");
    const maneuver = fn(OPS, "maneuver");
    expect(callsNamed(spell, "evaluateSpellSource")).toHaveLength(1);
    expect(callsNamed(spell, "evaluateManeuverSource")).toHaveLength(0);
    expect(callsNamed(maneuver, "evaluateManeuverSource")).toHaveLength(1);
    expect(callsNamed(maneuver, "evaluateSpellSource")).toHaveLength(0);
    expect(syntaxIs(callsNamed(spell, "executeCompiled")[0]!, "executeCompiled(e.compiled, op.targets, null, built.value.inputs)")).toBe(true);
    expect(syntaxIs(callsNamed(maneuver, "executeCompiled")[0]!, "executeCompiled(e.compiled, op.targets, op.groupTargets, built.value.inputs)")).toBe(true);
    // Both reuse the exact plans M6-WO7 / WO8 compiled for the evaluation (captured, never re-derived).
    const abilities = read(PLAY + "abilities.ts");
    expect(abilities).toMatch(/evaluateCharacterSignatureSpell\([\s\S]*?\(plan\) => \{?\s*compiled = plan/);
    expect(abilities).toMatch(/evaluateCharacterSignatureManeuver\([\s\S]*?\(plan\) => \{?\s*compiled = plan/);
  });

  it("W10-I166 Active Magic changes only through the M5-WO13 transition with the Character Spell adapter", () => {
    const magic = fn(OPS, "magic");
    expect(callsNamed(magic, "transitionActiveMagicWith")).toHaveLength(1);
    expect(callsNamed(magic, "characterSpellAdapter")).toHaveLength(1);
    expect(callsNamed(src(OPS), "transitionActiveMagicWith")).toHaveLength(1);
    // The runtime's Active Magic state is only ever the transition's own state.
    const assigns = [...strip(read(OPS)).matchAll(/activeMagic: ([^,}]+)/g)].map((m) => m[1]!.trim());
    for (const a of assigns) expect(["activation.transition.state", "out.transition.state", "t.state", "runtime.activeMagic", "null"], a).toContain(a);
    const spell = fn(OPS, "spell").getText();
    expect(spell).toContain('if (duration !== undefined && duration.mode !== "INSTANT" && duration.futureRuntime.persists) {');
    expect(spell).toContain("M5-WO13 refused to activate this Spell's persistent Effect; nothing was paid or changed");
  });

  it("W10-I167 resolved outcomes are reported, never applied to a target", () => {
    const contract = read(PLAY + "contract.ts");
    const runtime = contract.slice(position(contract, "export interface PlayRuntimeState {"), contract.indexOf("\n}", position(contract, "export interface PlayRuntimeState {")));
    expect(runtime).not.toMatch(/target|enemy|creature|defender|hp\b/i);
    for (const f of GAME_FILES) expect(strip(read(f)), f).not.toMatch(/\b(applyDamage|applyHealing|applyCondition|targetHp|enemyHp)\b/);
    for (const name of ["spell", "maneuver"]) expect(fn(OPS, name).getText(), name).toMatch(/outcome\(s\) resolved \(not applied\)/);
    const panel = read(UI_DIR + "/ActionDetailPanel.tsx");
    expect(panel).toContain("— NOT APPLIED (roll and apply with the GM).");
    expect(panel).toContain("<strong>(not applied)</strong>");
  });

  it("W10-I168 manual adjustments are a distinct, validated, attributed classification", () => {
    const manual = fn(OPS, "manual").getText();
    expect(manual).toContain('return accept("MANUAL_ADJUSTMENT",');
    expect(manual).toContain("validateSheetPlayState({ resources: ctx.mechanics.resources, values: { [op.resourceKey]: op.after } })");
    expect(manual).toContain('source: "PLAYER_GM_PROVIDED"');
    expect(manual).toContain("not calculated by the rules engine");
    expect(read(MIGRATION)).toContain(`CHECK ("classification" IN ('RULES_EXECUTED', 'MANUAL_ADJUSTMENT', 'REFERENCE_ONLY', 'NOTE'))`);
    // Only the manual handler emits the MANUAL_ADJUSTMENT classification.
    expect(strip(read(OPS)).match(/accept\("MANUAL_ADJUSTMENT"/g)).toHaveLength(1);
  });

  it("W10-I169 the event ledger is append-only", () => {
    const sql = read(MIGRATION);
    expect(sql).toMatch(/CREATE TRIGGER "character_play_events_append_only" BEFORE UPDATE OR DELETE ON "character_play_events" FOR EACH ROW EXECUTE FUNCTION "character_play_events_append_only"\(\);/);
    expect(sql.slice(position(sql, 'CREATE FUNCTION "character_play_events_append_only"'), position(sql, 'CREATE TRIGGER "character_play_events_append_only"'))).toMatch(/RAISE EXCEPTION/);
    expect(read(MIGRATION)).toContain('CREATE UNIQUE INDEX "character_play_events_character_sequence_key" ON "character_play_events"("character_id", "sequence");');
    const repo = strip(read(REPO));
    expect(repo).not.toMatch(/characterPlayEvent\.(update|updateMany|delete|deleteMany|upsert)\(/);
    expect(repo).not.toMatch(/\$executeRaw|\$queryRaw/);
  });

  it("W10-I170 the Character Sheet and Card Library are preserved; Play links are digital-only additions", () => {
    const panels = read("apps/studio/app/characters/_components/sheet/SheetPanels.tsx");
    expect(panels).toMatch(/\{mode === "digital" \? \(\n\s+<p className="sheet-muted sheet-digital-only" data-testid="sheet-card-links">/);
    expect(panels).toMatch(/data-testid="sheet-play-link"/);
    const links = panels.slice(position(panels, 'data-testid="sheet-card-links"'));
    expect(links.slice(0, links.indexOf("</p>"))).toContain('data-testid="sheet-play-link"');
    expect(panels.match(/data-testid="sheet-play-link"/g)).toHaveLength(1);
    // The card drawer is the WO9 viewer, read-only: no play submission inside it.
    const ws = read(UI_DIR + "/PlayWorkspace.tsx");
    expect(ws).toContain('import { CardViewer, type ViewMode } from "../cards/CardViewer";');
    const drawer = ws.slice(position(ws, 'data-testid="play-card-drawer"'), position(ws, ") : null}\n    </div>\n  );"));
    expect(drawer).not.toMatch(/submitter|commit|preview/);
    expect(existsSync(path.join(ROOT, "apps/studio/app/characters/[characterId]/cards/print/page.tsx"))).toBe(true);
  });

  it("W10-I171 the approved M5 changes are additive adapters that keep the original entry points", () => {
    expect(syntaxIs(namedFunction(src(G + "ability/active-magic.ts"), "transitionActiveMagic").body!, "{ return transitionActiveMagicWith(request, null); }")).toBe(true);
    expect(syntaxIs(namedFunction(src(G + "ability/effect-execution.ts"), "executeAbilityResolution").body!, "{ const compiled = compileInternal(request); if (!compiled.ok) return compiled as ProwessOutcome<never>; return executeCompiledResolution(compiled.value, request); }")).toBe(true);
    expect(read(G + "character/signature-spell.ts")).toContain("if (execution.ok && capture !== undefined) capture(execution.value);");
    expect(read(G + "character/signature-maneuver.ts")).toContain("if (execution.ok && capture !== undefined && cost.value.valid) capture(execution.value);");
    const registry = JSON.parse(read("docs/architecture/m6-approved-m5-changes.json")) as Record<string, { changedFiles: Record<string, string>; addedFiles: Record<string, string> }>;
    const wo10 = registry["M6-WO10"]!;
    expect(Object.keys(wo10.changedFiles).sort()).toEqual([G + "ability/active-magic.ts", G + "ability/effect-execution.ts", G + "character/signature-maneuver.ts", G + "character/signature-spell.ts", G + "index.ts"]);
    expect(Object.keys(wo10.addedFiles)).toEqual(expect.arrayContaining([...GAME_FILES, ROUND]));
  });

  it("W10-I172 Studio holds no mechanics: no arithmetic on play values, no Math, no fetch, no domain imports", () => {
    for (const f of UI_FILES) expect(playUiFindings(f, read(f)), f).toEqual([]);
    const panels = UI_DIR + "/PlayPanels.tsx";
    expect(playUiFindings(panels, `${read(panels)}\nexport const left = (r: { current: number }) => r.current - 1;`)).toContain("client-mechanical-arithmetic");
    expect(playUiFindings(panels, `${read(panels)}\nexport const big = (n: number) => Math.max(n, 1);`)).toContain("client-mechanical-authority");
    // Every request goes through the typed client; preview and commit carry both expected versions.
    const client = read("apps/studio/app/characters/_lib/character-client.ts");
    expect(client).toContain('export const previewPlayOperation = async (id: string, operation: unknown, expectedRuntimeVersion: number, expectedPlayStateVersion: number) => (await request<PlayPreviewDto>("POST", playPath(id, "/preview"), { operation, expectedRuntimeVersion, expectedPlayStateVersion })).data;');
    expect(client).toContain('export const commitPlayOperation = async (id: string, operation: unknown, idempotencyKey: string, expectedRuntimeVersion: number, expectedPlayStateVersion: number) => (await request<PlayCommitDto>("POST", playPath(id, "/operations"), { operation, idempotencyKey, expectedRuntimeVersion, expectedPlayStateVersion })).data;');
    for (const f of UI_FILES) expect(strip(read(f)), f).not.toMatch(/\["STR",\s*"AGI"/);
  });

  it("W10-I151–I172 every declared invariant names existing permanent guards, this gate and the mutation inventory", () => {
    const invariants = JSON.parse(read("docs/architecture/m6-invariants.json")) as { id: string; title: string; guards: string[] }[];
    const expected = Array.from({ length: 22 }, (_, i) => `M6-I${String(i + 151).padStart(3, "0")}`);
    const rows = invariants.filter((x) => expected.includes(x.id));
    expect(rows.map((x) => x.id)).toEqual(expected);
    expect(invariants.map((x) => x.id)).toEqual(Array.from({ length: invariants.length }, (_, i) => `M6-I${String(i + 1).padStart(3, "0")}`));
    const md = read("docs/architecture/m6-invariants.md");
    for (const row of rows) {
      expect(row.guards).toContain("apps/studio/tests/unit/m6-wo10-static.test.ts");
      expect(row.guards).toContain("scripts/m6-wo10-negative-controls.mjs");
      for (const f of row.guards) expect(existsSync(path.join(ROOT, f)), `${row.id}: ${f}`).toBe(true);
      expect(md).toContain(`### ${row.id} — ${row.title}`);
    }
  });
});
