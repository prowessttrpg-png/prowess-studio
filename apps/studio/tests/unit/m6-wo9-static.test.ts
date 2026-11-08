import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { auditM5Source } from "./m5-wo1-audit-helpers";
import { auditWo3Source } from "./m5-wo3-audit-helpers";
import { callsNamed, descendants, namedFunction, namedVariable, parseSource, syntaxIs } from "./m6-wo8-audit-helpers";

/**
 * PAS-10 M6-WO9 — Character Ability Card System: the permanent architecture gate (invariants M6-I129 – M6-I150). Every
 * test names the invariants it protects (prefix "W9-"); scripts/m6-wo9-negative-controls.mjs mutates the real sources
 * these assertions read and requires the named test to fail. Behaviour is proven by the game, DB, API, UI and browser
 * suites registered with this gate; this file pins the structure those suites rely on.
 */
const ROOT = path.resolve(process.cwd(), "../..");
const read = (f: string) => readFileSync(path.join(ROOT, f), "utf8");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
const src = (f: string) => parseSource(f, read(f));
const G = "packages/prowess-game/src/";
const CARD = G + "card/";
const GAME_FILES = ["card/contract.ts", "card/semantics.ts", "card/language.ts", "card/projection.ts", "card/equipment.ts", "card/action.ts", "card/mage-art.ts", "character/action-improvement.ts", "definition/action-improvement-payload.ts"].map((f) => G + f);
const SERVICE = "packages/prowess-db/src/character/card-service.ts";
const UI_DIR = "apps/studio/app/characters/_components/cards";
const UI_FILES = [...readdirSync(path.join(ROOT, UI_DIR)).filter((f) => /\.tsx?$/.test(f)).map((f) => `${UI_DIR}/${f}`), "apps/studio/app/characters/_lib/card-format.ts", "apps/studio/app/characters/_lib/card-types.ts"];
const ROUTES = ["apps/studio/app/api/characters/[characterId]/actions/route.ts", "apps/studio/app/api/characters/[characterId]/cards/route.ts"];
const PAGES = ["apps/studio/app/characters/[characterId]/cards/page.tsx", "apps/studio/app/characters/[characterId]/cards/print/page.tsx", "apps/studio/app/characters/[characterId]/actions/page.tsx"];
const SHEET = "apps/studio/app/characters/_components/sheet/";

/** Studio card UI: arithmetic on mechanical card fields (or values derived from them), Math, fetch and domain imports. */
export function cardUiFindings(file: string, text: string): string[] {
  const root = parseSource(file, text);
  const found = new Set<string>();
  const mechanical = /^(value|costs|ap|mp|amount|actionPointCost|breakdown|minimum|maximum|statScore|feetPerPoint|rangeFeet|reachFeet|lengthFeet|radiusFeet|accuracyModifier|power|apCost|mpCost|finalApCost|finalMpCost)$/;
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
  for (const n of descendants(root, ts.isCallExpression)) {
    const callee = n.expression.getText();
    if (callee === "fetch" || /^Math\.(?!max$|min$)/.test(callee)) found.add("client-mechanical-authority");
    if ((callee === "Math.max" || callee === "Math.min") && touches(n)) found.add("client-mechanical-authority");
    if (/^(update|create|finalize|retire|rebuild|validate|upload|remove)[A-Z]/.test(callee)) found.add("client-write");
  }
  for (const n of descendants(root, (x): x is ts.ImportDeclaration => ts.isImportDeclaration(x))) {
    if (ts.isStringLiteral(n.moduleSpecifier) && /^(@prowess\/(game|rules|db)|@prisma\/client)/.test(n.moduleSpecifier.text)) found.add("client-domain-import");
  }
  return [...found].sort();
}

describe("M6-WO9 permanent card system contracts", () => {
  it("W9-I129 I131 game card modules pass the M5-WO1 / WO3 audits: no arithmetic, Math, hidden cost identifiers or persistence", () => {
    for (const f of GAME_FILES) {
      expect(existsSync(path.join(ROOT, f)), f).toBe(true);
      expect(auditM5Source(read(f), f, "game"), f).toEqual([]);
      expect(auditWo3Source(read(f), f, "game"), f).toEqual([]);
      expect(strip(read(f)), f).not.toMatch(/@prowess\/db|prisma/i);
    }
    expect(auditM5Source(`${read(CARD + "equipment.ts")}\nexport const discounted = (n: number) => n - 1;`, CARD + "equipment.ts", "game")).toContain("hidden-math");
    expect(auditWo3Source(`${read(CARD + "action.ts")}\nexport const saveCard = () => 1;`, CARD + "action.ts", "game").length).toBeGreaterThan(0);
  });

  it("W9-I129 I130 the contract is versioned with exact category sections and exact-identity card keys", () => {
    const contract = src(CARD + "contract.ts");
    expect(syntaxIs(namedVariable(contract, "CARD_CONTRACT_VERSION").initializer!, "1 as const")).toBe(true);
    expect(read(CARD + "contract.ts")).toMatch(/export type CardPresentation = SpellCard \| ManeuverCard \| MageArtCard \| WeaponCard \| AttackCard \| GeneralActionCard;/);
    expect(syntaxIs(namedVariable(src(CARD + "projection.ts"), "cardKeyOf").initializer!, '(category: string, identity: CardAbilityIdentity) => `${category}:${identity.abilityId ?? "draft"}:${identity.revisionNumber === null ? "draft" : String(identity.revisionNumber)}`')).toBe(true);
    expect(syntaxIs(namedVariable(src(CARD + "equipment.ts"), "attackCardKey").initializer!, "(hand: string, weaponRef: ProwessDefinitionRef, attackRef: ProwessDefinitionRef): string => `ATTACK:${weaponRef.entityVersionId}:${attackRef.entityVersionId}:${hand}`")).toBe(true);
    expect(syntaxIs(namedVariable(src(CARD + "equipment.ts"), "weaponCardKey").initializer!, "(hand: string, weaponRef: ProwessDefinitionRef): string => `WEAPON:${weaponRef.entityVersionId}:${hand}`")).toBe(true);
    expect(syntaxIs(namedVariable(src(CARD + "action.ts"), "generalActionCardKey").initializer!, "(action: ProwessDefinitionRef): string => `GENERAL_ACTION:${action.entityVersionId}`")).toBe(true);
    // Every projection retains provenance and repeats its identity in the snapshot.
    for (const f of ["projection.ts", "equipment.ts", "action.ts", "mage-art.ts"]) expect(strip(read(CARD + f)), f).toMatch(/snapshot: \{ contractVersion: CARD_CONTRACT_VERSION, cardKey,/);
  });

  it("W9-I138 costs are AVAILABLE only from a usable evaluation and are the evaluation's own values", () => {
    const p = src(CARD + "projection.ts");
    expect(syntaxIs(namedVariable(p, "usable").initializer!, '(state: SignatureSpellState) => state === "VALID" || state === "VALID_WITH_RUNTIME_DEFERRED"')).toBe(true);
    const spell = namedFunction(p, "projectSpellCard");
    expect(syntaxIs(namedVariable(spell, "ok").initializer!, "usable(e.state) && e.cost !== null")).toBe(true);
    const costs = namedVariable(spell, "costs").initializer!.getText();
    expect(costs).toContain("ok && c !== null ? available(c.ap.finalApCost) : unavailable(\"CARD.COST_UNRESOLVED\", why)");
    expect(costs).toContain("ok && c !== null ? available(c.finalMpCost) : unavailable(\"CARD.COST_UNRESOLVED\", why)");
    // Weapon Attack AP / MP are the WO6 library's authored Move values, read by key.
    const eq = src(CARD + "equipment.ts");
    expect(syntaxIs(namedVariable(namedFunction(eq, "projectAttackCard"), "ap").initializer!, 'listed(a, "apCost")')).toBe(true);
    expect(syntaxIs(namedVariable(namedFunction(eq, "projectAttackCard"), "mp").initializer!, 'listed(a, "mpCost")')).toBe(true);
    // General Actions: a FIXED cost is its amount; a variable / chosen cost is typed; a cost-free Action is the authored NONE.
    const action = read(CARD + "action.ts");
    expect(action).toContain('if (overrides.length === 0) return { ap: available(c.amount), breakdown, limitations: [] };');
    expect(action).toContain('unavailable("ACTION.COST_SET_BY_SOURCE"');
    expect(action).toContain('unavailable("ACTION.COST_CHOSEN_AT_USE"');
  });

  it("W9-I132 I133 language: the Saving Throw is keyed to the defender and attack saves keep their authored sides", () => {
    const lang = read(CARD + "language.ts");
    expect(lang).toContain("sentence(`if the save fails, the Effect succeeds: ${success}`), sentence(`if the save succeeds, the Effect fails: ${failure}`)");
    expect(lang).toContain("sentence(`if the target's save fails, ${ATTACK_OUTCOME_WORDS[check.onDefenderSaveFails]}`)");
    expect(lang).toContain("sentence(`if the target's save succeeds, ${ATTACK_OUTCOME_WORDS[check.onDefenderSaveSucceeds]}`)");
    const checkOf = namedFunction(src(CARD + "equipment.ts"), "checkOf");
    expect(checkOf.getText()).toContain('return { kind: "SAVING_THROW", stat: r.savingThrowStat, dc: r.dc, onDefenderSaveFails: r.onFailure, onDefenderSaveSucceeds: r.onSuccess };');
    const sem = read(CARD + "semantics.ts");
    expect(sem).toMatch(/effectSucceedsWhen: "DEFENDER_SAVE_FAILS"/);
  });

  it("W9-I134 I135 the semantic chain mirrors the executor: behaviors, delivery and triggers", () => {
    const sem = src(CARD + "semantics.ts");
    const transitions = namedFunction(sem, "transitionsOf").getText();
    for (const behavior of ["STOP", "SUCCESS_ONLY", "FAILURE_ONLY", "BRANCH"]) expect(transitions, behavior).toContain(`case "${behavior}":`);
    // CONTINUE (and a ruled default) move forward on either result.
    expect(transitions).toMatch(/default:\s*return \{ afterSuccess: forward, afterFailure: forward \};/);
    expect(transitions).toContain('return { afterSuccess: forward, afterFailure: { kind: "END", termination: "SUCCESS_ONLY_FAILURE" } };');
    expect(transitions).toContain('return { afterSuccess: { kind: "END", termination: "FAILURE_ONLY_SUCCESS" }, afterFailure: forward };');
    expect(read(CARD + "semantics.ts")).toMatch(/onMiss: "NOT_DELIVERED"/);
    expect(read(CARD + "language.ts")).toContain("otherwise it is not triggered — not a failure");
    expect(read(CARD + "language.ts")).toContain("every other Effect is not delivered — not a failure — and the chain ends for that target");
  });

  it("W9-I136 I137 Maneuver cards use independent groups and never the Spell Effect Chain", () => {
    const projectManeuver = namedFunction(src(CARD + "projection.ts"), "projectManeuverCard");
    expect(callsNamed(projectManeuver, "maneuverRulesOf").length).toBe(1);
    expect(callsNamed(projectManeuver, "spellRulesOf").length).toBe(0);
    expect(callsNamed(projectManeuver, "renderSpellRules").length).toBe(0);
    const render = namedFunction(src(CARD + "language.ts"), "renderCardRules").getText();
    expect(render).toMatch(/case "MANEUVER_GROUPS":\s*return renderManeuverRules\(rules, ctx\);/);
    expect(render).toMatch(/case "SPELL_CHAIN":\s*return renderSpellRules\(rules, ctx\);/);
    expect(read(CARD + "language.ts")).toContain("resolve each Action group separately — each has its own resolution; Maneuver Actions never form one Spell Effect Chain");
    expect(read(CARD + "language.ts")).toMatch(/Powerful Blow: \$\{/);
  });

  it("W9-I139 Weapon and Attack cards come from the current loadout's exact references", () => {
    const eq = src(CARD + "equipment.ts");
    const all = namedFunction(eq, "projectEquipmentCards").getText();
    expect(all).toContain('["MAIN_HAND", library.loadout.mainHand, library.mainHand]');
    expect(all).toContain('["OFF_HAND", library.loadout.offHand, library.offHand]');
    expect(all).toContain("if (held === null || lib === null) continue;");
    const attack = namedFunction(eq, "projectAttackCard").getText();
    expect(attack).toContain("const { weapon: weaponRef, attack: attackRef } = a;");
    expect(attack).toContain("weapon: weaponRef,\n        attack: attackRef,");
    expect(attack).toContain("damage: a.damage.map((d) => ({ profileKey: d.profileKey");
    // The service builds the library from the Character's own stored loadout choice.
    expect(strip(read(SERVICE))).toContain("const library = buildCharacterAttackLibrary({ bundle, characterProfile: base, loadout: choice });");
  });

  it("W9-I140 I141 ACTION_IMPROVEMENT is additive, names one exact parent and evaluates each prerequisite through M4", () => {
    expect(read(G + "vocabulary/families.ts")).toMatch(/ACTION_IMPROVEMENT: active\("ACTION_ECONOMY"\),/);
    expect(read(G + "vocabulary/families.ts")).toMatch(/ {2}ACTION: active\("ACTION_ECONOMY"\),/);
    const payload = read(G + "definition/action-improvement-payload.ts");
    expect(payload).toContain('if (action !== null && action.definitionKind !== "ACTION") p.add(C.INVALID_PAYLOAD');
    const evaluator = src(G + "character/action-improvement.ts");
    const evaluate = namedFunction(evaluator, "evaluateActionImprovement");
    expect(syntaxIs(namedVariable(evaluate, "state").initializer!, 'pinnedEnvelope === null ? "NOT_IN_RELEASE" : pinnedEnvelope.entityVersionId === payload.action.entityVersionId ? "PINNED" : "REVISION_MISMATCH"')).toBe(true);
    expect(evaluate.getText()).toContain('if (state !== "PINNED") status = "UNRESOLVED";');
    expect(namedFunction(evaluator, "levelResult").getText()).toContain('numericCompare(LEVEL_FACT, profile.level, ">=", q.minimum)');
    expect(namedFunction(evaluator, "statResult").getText()).toContain('numericCompare(`stat.${q.stat}`, row.final, ">=", q.minimum)');
    expect(callsNamed(evaluate, "evaluateRankPrerequisites").length).toBe(1);
    // ACTION Definitions author no prerequisites: no eligibility rule is invented for them.
    expect(read(CARD + "action.ts")).toContain('eligibility: { status: "NO_REQUIREMENTS" as const },');
  });

  it("W9-I142 progression states need authoritative evidence: FUTURE from Level range only, UNAVAILABLE from impossibility only", () => {
    const ev = src(G + "character/action-improvement.ts");
    expect(syntaxIs(namedVariable(namedFunction(ev, "levelResult"), "progression").initializer!, 'satisfied === null || withinRange === null ? "UNRESOLVED" : satisfied ? "MET" : withinRange ? "REACHABLE" : "UNREACHABLE"')).toBe(true);
    expect(syntaxIs(namedVariable(namedFunction(ev, "statResult"), "progression").initializer!, 'satisfied === null || withinMaximum === null ? "UNRESOLVED" : satisfied ? "MET" : withinMaximum ? "UNDETERMINED" : "UNREACHABLE"')).toBe(true);
    expect(syntaxIs(namedVariable(namedFunction(ev, "rankResult"), "progression").initializer!, 'satisfied === null ? "UNRESOLVED" : satisfied ? "MET" : "UNDETERMINED"')).toBe(true);
    expect(namedFunction(ev, "evaluateActionImprovement").getText()).toContain('status = unmet.some((x) => x.progression === "UNREACHABLE") ? "UNAVAILABLE" : unmet.every((x) => x.progression === "REACHABLE") ? "FUTURE" : "UNRESOLVED";');
  });

  it("W9-I143 unsupported improvement operations are never applied", () => {
    const ev = src(G + "character/action-improvement.ts");
    const mod = namedFunction(ev, "modificationResult").getText();
    expect(mod).toContain('if (m.kind === "RULE_OPERATION") return { ...base, operationKey: m.operationKey, support: "UNSUPPORTED"');
    expect(mod).toContain('const overridable = parent !== null && parent.costOverridableByExplicitRule && parent.actionPointCost.model === "FIXED";');
    const costs = namedFunction(src(CARD + "action.ts"), "costsOf").getText();
    expect(costs).toContain('.filter((e) => e.status === "ACTIVE")');
    expect(costs).toContain('m.support === "APPLIED" && m.condition === null && m.actionPointCost !== null');
    expect(costs).toContain('if (overrides.length > 1) return { ap: unavailable("ACTION.COST_OVERRIDE_CONFLICT"');
  });

  it("W9-I144 Mage Arts are an unavailable domain: reserved kind, no card, no cost, no evaluation", () => {
    expect(read(G + "vocabulary/families.ts")).toMatch(/MAGE_ART: reserved\("MAGE_ART"\),/);
    const mage = read(CARD + "mage-art.ts");
    expect(mage).toContain('availability: "UNAVAILABLE" as const,');
    expect(mage).toContain("costs: { ap: unavailable<number>(MAGE_ART_UNAVAILABLE_CODE, reason), mp: unavailable<number>(MAGE_ART_UNAVAILABLE_CODE, reason), breakdown: [] },");
    expect(strip(mage)).not.toMatch(/(^|[^n])available</);
    expect(strip(mage)).not.toMatch(/(^|[^n])available\(/);
    expect(strip(read(SERVICE))).toContain("mageArts: { domain: mageArtDomainOf(bundle), cards: [] },");
  });

  it("W9-I145 current, draft, retired and historical revisions stay distinct; other-Release revisions are never re-evaluated", () => {
    const service = strip(read(SERVICE));
    expect(service).toContain("if (releaseId !== null && releaseId !== ctx.c.rulesetReleaseId) return { revisionNumber, card: null, unavailable: OTHER_RELEASE };");
    // Spells and Maneuvers both present a non-ACTIVE Ability's revision as HISTORICAL (one use each).
    expect(service.split('a.status === "ACTIVE" ? "CURRENT" : "HISTORICAL"').length - 1).toBe(2);
    expect(service).toContain('history: a.revisions.filter((r) => r.id !== a.currentRevisionId)');
    const format = src("apps/studio/app/characters/_lib/card-format.ts");
    expect(syntaxIs(namedVariable(format, "USABLE_STATES").initializer!, '["ACTIVE", "EQUIPPED", "AVAILABLE"]')).toBe(true);
    const find = namedFunction(format, "findEntry").getText();
    expect(find).toContain('if (q.ability) return entries.find((e) => e.abilityId === q.ability && (e.state === "ACTIVE" || e.state === "RETIRED")) ?? null;');
    expect(find).toContain("if (q.card) return entries.find((e) => e.key === q.card) ?? null;");
    expect(namedFunction(format, "abilityEntries").getText()).toContain('e.status === "ACTIVE" ? "ACTIVE" : "RETIRED"');
  });

  it("W9-I146 the two card APIs are strict, Character-scoped GET reads and the service never writes", () => {
    const registry = JSON.parse(read("docs/architecture/m6-api-routes.json")) as Record<string, string[]>;
    expect(registry["M6-WO9"]).toEqual(ROUTES);
    for (const r of ROUTES) {
      const text = strip(read(r));
      expect(text, r).toMatch(/export async function GET\(/);
      expect(text, r).not.toMatch(/export async function (POST|PUT|PATCH|DELETE)\(/);
      expect(text, r).toContain('strictQuery(new URL(request.url).searchParams, []);');
      expect(text, r).toMatch(/parseUuidParam\(characterId, "characterId"\)/);
    }
    const service = strip(read(SERVICE));
    expect(service).not.toMatch(/\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\(|\$executeRaw|\$queryRaw|insert[A-Z]\w*\(|write[A-Z]\w*\(|finalize[A-Z]\w*\(|retire[A-Z]\w*\(/);
    expect(service).toContain("characterReleaseId: equipped.c.rulesetReleaseId");
    expect(service).toContain("const equipped = await loadEquippedCharacter(characterId);");
    expect(service).toContain("const all = await selectSignatureAbilities(c.id);");
  });

  it("W9-I131 Studio card UI imports no domain package, writes nothing and computes nothing from card values", () => {
    for (const f of [...UI_FILES, ...PAGES]) expect(cardUiFindings(f, read(f)), f).toEqual([]);
    expect(cardUiFindings("x.tsx", "const ap = card.costs.ap; export const cheaper = ap.value - 1;")).toContain("client-mechanical-arithmetic");
    expect(cardUiFindings("x.tsx", 'import { evaluateActionImprovement } from "@prowess/game";')).toContain("client-domain-import");
    expect(cardUiFindings("x.tsx", "void updatePlayState(id, 1, {});")).toContain("client-write");
    const client = read("apps/studio/app/characters/_lib/character-client.ts");
    expect(client).toContain('export const getCardLibrary = async (id: string) => (await request<CardLibraryDto>("GET", `/api/characters/${enc(id)}/cards`)).data;');
    expect(client).toContain('export const getActionDirectory = async (id: string) => (await request<ActionDirectoryViewDto>("GET", `/api/characters/${enc(id)}/actions`)).data;');
  });

  it("W9-I147 five viewer modes over one contract; flip and mode controls are pressed-state buttons; reduced motion respected", () => {
    const viewer = src(`${UI_DIR}/CardViewer.tsx`);
    const modes = descendants(namedVariable(viewer, "VIEW_MODES").initializer!, ts.isStringLiteral).map((n) => n.text);
    expect(modes).toEqual(["illustrated", "Illustrated", "tactical", "Tactical", "flip", "Front / Back", "combined", "Combined", "print", "Print"]);
    const text = read(`${UI_DIR}/CardViewer.tsx`);
    expect(text).toContain("aria-pressed={back}");
    expect(text).toContain("aria-pressed={mode === m.key}");
    expect(text).toContain('<p className="fcard-sr" aria-live="polite">');
    const library = read(`${UI_DIR}/CardLibrary.tsx`);
    expect(library).toContain("const changeMode = (m: ViewMode) => {\n    setMode(m);\n    writeUrl(selected, m);\n  };");
    const css = read(`${UI_DIR}/cards.css`);
    expect(css).toContain("@media (prefers-reduced-motion: reduce) { .fcard-flip__face { animation: none; } }");
    expect(css).toContain("@media (prefers-reduced-motion: reduce) { .fcard-drawer__panel { animation: none; } }");
  });

  it("W9-I148 the drawer and directory present server authority: grouped states, focus trap, Escape and focus restore", () => {
    const groups = namedVariable(src("apps/studio/app/characters/_lib/card-format.ts"), "improvementGroups").initializer!.getText();
    const order = [...groups.matchAll(/key: "(\w+)"/g)].map((m) => m[1]);
    expect(order).toEqual(["ACTIVE", "CONDITIONAL", "FUTURE", "BLOCKED"]);
    expect(groups).toContain('items: list.filter((i) => i.status === "FUTURE")');
    expect(groups).toContain('items: list.filter((i) => i.status === "UNAVAILABLE" || i.status === "UNRESOLVED")');
    const drawer = read(`${UI_DIR}/ProgressionDrawer.tsx`);
    expect(drawer).toContain('role="dialog" aria-modal="true"');
    expect(drawer).toContain('if (e.key === "Escape") {');
    expect(drawer).toContain("if (back instanceof HTMLElement) back.focus();");
    expect(drawer).toMatch(/if \(e\.shiftKey && document\.activeElement === first\) \{\s*e\.preventDefault\(\);\s*last\.focus\(\);/);
    expect(strip(drawer)).not.toMatch(/progression\s*===|satisfied\s*\?|REACHABLE"\s*\?/);
    const directory = read(`${UI_DIR}/ActionDirectory.tsx`);
    expect(directory).toContain("const list = d.cards.filter(");
    expect(directory).toContain("cardHref(view.character.id, current.cardKey)");
  });

  it("W9-I149 printed cards: 4 × 6 named pages, no clipping, continuation numbering, duplex pairs and snapshot identity", () => {
    const css = read(`${UI_DIR}/cards.css`);
    expect(css).toContain("@page fcard-4x6 { size: 4in 6in; margin: 0; }");
    expect(css).toContain("@page fcard-combined { size: 11in 8.5in; margin: 0; }");
    expect(css).toMatch(/\.fprint-page \{\n {2}page: fcard-4x6;\n {2}box-sizing: border-box;\n {2}width: 4in;\n {2}height: 6in;/);
    expect(css).toMatch(/\.fprint-page \{[^}]*font-size: 8\.5pt;/);
    // Nothing on a card page is clipped or hidden (the screen-only print bar is the one hidden element).
    expect(css).not.toMatch(/\.fprint-(page|card|sheet|block)[^{]*\{[^}]*(overflow:\s*hidden|display:\s*none|visibility:\s*hidden)/);
    const print = src(`${UI_DIR}/PrintCard.tsx`);
    const paginate = namedFunction(print, "paginate").getText();
    expect(paginate).toContain("if (!(capacity > 0)) return [{ side, blocks, first: true, tall: false }];");
    expect(paginate).toContain("if (current.length > 0 && used + h > limit) {");
    const pages = namedFunction(print, "PrintCardPages").getText();
    expect(pages).toContain("for (let i = 0; i < pairs; i += 1) sequence.push(pages.front[i] ?? blank(), pages.back[i] ?? blank());");
    expect(pages).toContain('printBlocks(frontBlocks(card, names, { compact: false }), card, "how", "How to Use")');
    const frame = namedFunction(print, "PageFrame").getText();
    expect(frame).toContain("Card page {index} / {total}");
    expect(frame).toContain("{card.snapshot.cardKey}");
    expect(frame).toContain('` · r${ability.revisionNumber}`');
    expect(frame).toContain('page.first ? "" : " — continued"');
  });

  it("W9-I150 the Character Sheet keeps its rows and print; card links are digital-only additions", () => {
    const panels = read(SHEET + "SheetPanels.tsx");
    expect(panels).toMatch(/<WeaponAttackRows sheet=\{sheet\} printRows=\{PRINT_ATTACK_ROWS\} \/>\n\s+<SignatureSpellRows sheet=\{sheet\} \/>\n\s+<SignatureManeuverRows sheet=\{sheet\} \/>\n\s+<NotesText label="Action Notes"/);
    expect(panels).toMatch(/\{mode === "digital" \? \(\n\s+<p className="sheet-muted sheet-digital-only" data-testid="sheet-card-links">/);
    expect(read(SHEET + "SpellRows.tsx")).toMatch(/\{mode === "digital" \? \(\n\s+<>\n\s+\{" "\}\n\s+· <a href=\{`\/characters\/\$\{id\}\/cards\?ability=\$\{encodeURIComponent\(s\.id\)\}`\} data-testid="sheet-spell-card">Card<\/a>/);
    expect(read(SHEET + "ManeuverRows.tsx")).toContain('{m.warnings.map((q, i) => <span className="sheet-muted" key={i}> {q.message}</span>)}{mode === "digital" ? <> · <a href={`/characters/${encodeURIComponent(sheet.identity.id)}/cards?ability=${encodeURIComponent(m.id)}`} data-testid="sheet-maneuver-card">Card</a></> : null}');
    expect(read(SHEET + "WeaponPanels.tsx")).toMatch(/\{mode === "digital" \? \(\n\s+<>\n\s+\{" "\}\n\s+·\{" "\}\n\s+<a href=\{`\/characters\/\$\{encodeURIComponent\(sheet\.identity\.id\)\}\/cards\?attack=\$\{encodeURIComponent\(a\.attackKey\)\}&hand=\$\{encodeURIComponent\(a\.hand\)\}`\} data-testid="sheet-attack-card">/);
    expect(read(SHEET + "character-sheet.css")).toContain("@page { size: letter; margin: 0; }");
  });

  it("W9-I129–I150 every declared invariant names existing permanent guards, this gate and the mutation inventory", () => {
    const invariants = JSON.parse(read("docs/architecture/m6-invariants.json")) as { id: string; title: string; guards: string[] }[];
    const expected = Array.from({ length: 22 }, (_, i) => `M6-I${String(i + 129).padStart(3, "0")}`);
    const rows = invariants.filter((x) => expected.includes(x.id));
    expect(rows.map((x) => x.id)).toEqual(expected);
    // The register stays one contiguous, duplicate-free M6-I sequence; WO9 closed it at I150 and later Work Orders only
    // append after it (M6-WO10 appends I151+ under its own gate).
    expect(invariants.length).toBeGreaterThanOrEqual(150);
    expect(invariants.map((x) => x.id)).toEqual(Array.from({ length: invariants.length }, (_, i) => `M6-I${String(i + 1).padStart(3, "0")}`));
    const md = read("docs/architecture/m6-invariants.md");
    for (const row of rows) {
      expect(row.guards).toContain("apps/studio/tests/unit/m6-wo9-static.test.ts");
      expect(row.guards).toContain("scripts/m6-wo9-negative-controls.mjs");
      for (const f of row.guards) expect(existsSync(path.join(ROOT, f)), `${row.id}: ${f}`).toBe(true);
      expect(md).toContain(`### ${row.id} — ${row.title}`);
    }
  });
});
