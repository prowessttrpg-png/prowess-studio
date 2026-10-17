import ts from "typescript";

/**
 * M5-WO2 static audit helpers (PAS-10 M5-WO2 §182). Two kinds of check:
 *
 *   auditWo2Source  — TypeScript AST rules over production source (comments and prose never trip a rule);
 *   auditCoreContent — structural rules over the canonical core content document (the Definitions WO2 executes).
 *
 * The WO2 "movement-formula" rule (M5-I073, Movement DEFERRED_PENDING_CANON) was retired by M5-WO3 when the designer
 * resolved M5-SC-006; M5-I073 is SUPERSEDED by M5-I075 and its replacement rules are in m5-wo3-audit-helpers.ts.
 *
 * Both return sorted, de-duplicated finding names so negative controls can assert the exact rule that fires.
 */
export type Wo2Layer = "game" | "rules";

const STAT_TOKENS = new Set(["STR", "AGI", "CON", "PER", "RES", "PRO"]);
const DIE_FACES = new Set(["4", "6", "8", "10", "12"]);
const M4_CORE_TERMS = /dodge|evasion|accuracy|character_?die|player_?di(c)?e|stat_?mastery|half_?character|saving_?throw|attack_?roll|skill_?rank|untrained|^(STR|AGI|CON|PER|RES|PRO)$/i;
const LEGACY_VALUES = /^(player[ _]?di(c)?e|evasion)$/i;
const RANDOM_CALLEE = /^(Math\.random|crypto\.\w+|globalThis\.crypto\.\w+|randomInt|randomUUID|getRandomValues|Date\.now|performance\.now)$|\.(randomInt|randomUUID|getRandomValues|randomBytes)$/;
const RANDOM_NAME = /^(roll(Die|Dice|D\d+)|rng|random\w*|\w*Rng|\w*Random\w*|dice(Roller|Rng))$/;
const RANK_NUMERIC = /^(rankValue|rankValues|rankNumber|RANK_VALUES?)$/;
const SKILL_NAME = /athletics|arcana|awareness|insight|stealth|crafting|engineering|medicine|persuasion|intimidation/i;
const ME_DISCOUNT = /^(listedMpAfterMe|mpAfterMe|effectiveMp|discountedMp|mpAfterDiscount|costAfterMe)$/i;
const LATEST = /getLatest|^latest|latest[A-Z]|newest|mostRecent|getCurrent|^current(Version|Effect|Definition|Ruleset|Die|Rules)|^active(Ruleset|Definition)/i;

const literalText = (node: ts.Node): string | null => (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) ? node.text : null);

export function auditWo2Source(source: string, file: string, layer: Wo2Layer): string[] {
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const findings = new Set<string>();
  const add = (f: string) => findings.add(f);
  const vocabulary = /vocabulary\/(terminology|core)\.ts$/.test(file);
  const infrastructure = /\/internal\//.test(file);

  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const name = node.moduleSpecifier.text;
      if (layer === "game" && /^(@prowess\/db|@prisma\/|pg$|prisma|node:|fs$|path$)/.test(name)) add("database-dependency");
      if (layer === "game" && /content\/.*\.json$/.test(name)) add("content-in-code");
      if (layer === "rules" && /@prowess\/game/.test(name)) add("prowess-in-m4");
    }

    if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
      const callee = node.expression.getText(ast);
      if (RANDOM_CALLEE.test(callee)) add("randomness");
      if (layer === "game" && /^Math\.(max|min|floor|ceil|round|trunc|abs)$/.test(callee)) add("hidden-math");
      if (layer === "game" && /\.sort$/.test(callee) && /rank/i.test(callee) && (node.arguments?.length ?? 0) === 0) add("rank-alphabetical");
      if (/localeCompare$/.test(callee) && /rank/i.test(node.getText(ast))) add("rank-alphabetical");
    }

    if (ts.isIdentifier(node) && layer === "game") {
      const parent = node.parent;
      const declares = parent !== undefined && (ts.isVariableDeclaration(parent) || ts.isFunctionDeclaration(parent) || ts.isPropertyAssignment(parent) || ts.isMethodDeclaration(parent) || ts.isParameter(parent)) && (parent as { name?: ts.Node }).name === node;
      if (declares && RANDOM_NAME.test(node.text)) add("randomness");
      if (RANK_NUMERIC.test(node.text)) add("rank-numeric-collapse");
      if (ME_DISCOUNT.test(node.text)) add("me-discount");
      if (LATEST.test(node.text)) add("latest-or-current");
      if (declares && /^(playerDie|playerDice|evasion)$/i.test(node.text)) add("legacy-canonical");
    }

    const text = literalText(node);
    if (text !== null) {
      if (layer === "rules" && M4_CORE_TERMS.test(text)) add("prowess-in-m4");
      if (layer === "game" && !vocabulary && LEGACY_VALUES.test(text)) add("legacy-canonical");
      if (layer === "game" && /^(floor|ceil|max|min)\(|\b[a-z_]+ [-+*/] [a-z0-9_]+\b/i.test(text) && !/^[a-z]+:\/\//.test(text) && !/[{}$]/.test(text) && /\b(per|pro|agi|str|con|res|r1|r2|natural|faces|bonus\w*|accuracy)\b/i.test(text)) add("formula-in-code");
    }
    if (ts.isTemplateExpression(node) && layer === "game" && /^\s*(floor|ceil|max|min)\(/.test(node.head.text)) add("formula-in-code");

    if (ts.isIdentifier(node) && layer === "rules" && M4_CORE_TERMS.test(node.text) && node.text.length > 3) add("prowess-in-m4");

    if (ts.isBinaryExpression(node) && layer === "game") {
      const op = node.operatorToken.kind;
      const arithmetic = [ts.SyntaxKind.PlusToken, ts.SyntaxKind.MinusToken, ts.SyntaxKind.AsteriskToken, ts.SyntaxKind.SlashToken, ts.SyntaxKind.PercentToken, ts.SyntaxKind.PlusEqualsToken, ts.SyntaxKind.MinusEqualsToken].includes(op);
      if (arithmetic && !infrastructure) add("hidden-math");
      const comparison = [ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken, ts.SyntaxKind.LessThanToken, ts.SyntaxKind.LessThanEqualsToken, ts.SyntaxKind.GreaterThanToken, ts.SyntaxKind.GreaterThanEqualsToken].includes(op);
      if (comparison) {
        const sides = [node.left, node.right];
        const lits = sides.map(literalText);
        const nums = sides.map((s) => (ts.isNumericLiteral(s) ? s.text : null));
        const texts = sides.map((s) => s.getText(ast));
        if (lits.some((l) => l !== null && STAT_TOKENS.has(l))) add("stat-branch");
        const subject = texts.filter((t) => !/\.length$/.test(t));
        if (nums.some((n) => n !== null) && subject.some((t) => /(^|[^A-Za-z])level([^A-Za-z]|$)/i.test(t))) add("level-branch");
        if (nums.some((n) => n !== null && DIE_FACES.has(n)) && subject.some((t) => /faces|die|natural|roll/i.test(t))) add("die-branch");
        if (nums.some((n) => n !== null) && subject.some((t) => /\b(str|agi|con|per|res|pro|stat|score)\b/i.test(t))) add("stat-branch");
        if (lits.some((l) => l !== null && /^skill\./.test(l))) add("skill-fixed-stat");
        if (texts.some((t) => /rankKey/.test(t)) && [ts.SyntaxKind.LessThanToken, ts.SyntaxKind.GreaterThanToken, ts.SyntaxKind.LessThanEqualsToken, ts.SyntaxKind.GreaterThanEqualsToken].includes(op)) add("rank-alphabetical");
      }
    }
    if ((ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) && layer === "game" && !infrastructure && [ts.SyntaxKind.PlusPlusToken, ts.SyntaxKind.MinusMinusToken].includes(node.operator)) add("hidden-math");

    if (ts.isCaseClause(node) && layer === "game") {
      const lit = literalText(node.expression);
      if (lit !== null && STAT_TOKENS.has(lit)) add("stat-branch");
      if (ts.isNumericLiteral(node.expression)) add("level-branch");
    }

    if (ts.isPropertyAssignment(node) && layer === "game") {
      const name = node.name.getText(ast).replace(/["']/g, "");
      const init = literalText(node.initializer);
      if (SKILL_NAME.test(name) && init !== null && STAT_TOKENS.has(init)) add("skill-fixed-stat");
      if (/^(TRAINED|EXPERT|MASTER|UNTRAINED)$/.test(name) && ts.isNumericLiteral(node.initializer)) add("rank-numeric-collapse");
      if (/^(finalValue|total|natural|satisfied|dodge|characterDc|accuracy)$/.test(name) && ts.isNumericLiteral(node.initializer) && node.initializer.text !== "0") add("hidden-result");
    }

    node.forEachChild(visit);
  };
  visit(ast);
  return [...findings].sort();
}

// ---- content ---------------------------------------------------------------------------------------------------------

interface ContentDefinition {
  canonicalKey: string;
  definitionKind: string;
  payload: Record<string, unknown>;
}
interface Formula {
  expression: string;
  variables: { variable: string; source: { kind: string; stat?: string; statistic?: string; field?: string } }[];
}
const byStatistic = (defs: ContentDefinition[], statistic: string) => defs.filter((d) => d.definitionKind === "DERIVED_STAT" && d.payload.statistic === statistic);
const byProcedure = (defs: ContentDefinition[], procedure: string) => defs.find((d) => d.definitionKind === "CORE_RESOLUTION" && d.payload.procedure === procedure);
const sources = (f: Formula | undefined, kind: string) => (f?.variables ?? []).filter((v) => v.source.kind === kind);
const sourceOf = (f: Formula | undefined, kind: string, key: "stat" | "statistic" | "field", value: string) => sources(f, kind).filter((v) => v.source[key] === value);

/** Structural rules over the canonical core content document (designer rulings M5-SC-002 / 003 / 005 / 008 / 009 / 010). */
export function auditCoreContent(content: { definitions: ContentDefinition[] }): string[] {
  const defs = content.definitions;
  const findings = new Set<string>();
  const add = (f: string) => findings.add(f);
  const text = JSON.stringify(defs);

  // Terminology: one Character Die, one Dodge.
  if (/player[ _]?di(c)?e/i.test(text)) add("player-die-duplicate");
  if (defs.filter((d) => d.definitionKind === "CHARACTER_DIE_PROGRESSION").length !== 1) add("player-die-duplicate");
  if (/evasion/i.test(text)) add("evasion-duplicate");
  if (byStatistic(defs, "DODGE").length !== 1) add("evasion-duplicate");

  // M5-WO2 kept Movement DEFERRED_PENDING_CANON here (M5-SC-006, M5-I073). M5-WO3 resolved M5-SC-006 by designer
  // ruling and superseded M5-I073 with M5-I075: the Movement rules now live in the M5-WO3 audit (m5-wo3-audit-helpers.ts).

  // Dodge = half die + AGI + named PER term (+ bonuses).
  const dodge = byStatistic(defs, "DODGE")[0]?.payload.formula as Formula | undefined;
  if (sourceOf(dodge, "DERIVED", "statistic", "DODGE_PERCEPTION_BONUS").length !== 1) add("per-dodge-omitted");
  if (sourceOf(dodge, "DERIVED", "statistic", "HALF_CHARACTER_DIE").length !== 1 || sourceOf(dodge, "STAT", "stat", "AGI").length !== 1) add("dodge-incomplete");
  const perBonus = byStatistic(defs, "DODGE_PERCEPTION_BONUS")[0]?.payload.formula as Formula | undefined;
  if (perBonus?.expression !== "floor(per / 3)") add("per-dodge-omitted");

  // Character DC = half die + PRO + named Resolve term (+ bonuses).
  const dc = byStatistic(defs, "CHARACTER_DC")[0]?.payload.formula as Formula | undefined;
  if (sourceOf(dc, "DERIVED", "statistic", "CHARACTER_DC_RESOLVE_BONUS").length !== 1) add("resolve-dc-omitted");
  if (sources(dc, "STAT").some((v) => v.source.stat === "RES") || /res/.test(sourceOf(dc, "STAT", "stat", "PRO")[0]?.variable ?? "")) add("resolve-hidden-in-pro");
  if ((byStatistic(defs, "CHARACTER_DC_RESOLVE_BONUS")[0]?.payload.formula as Formula | undefined)?.expression !== "floor(res / 3)") add("resolve-dc-omitted");

  // Attack = natural + PER + named Accuracy + bonuses; Accuracy = floor(PRO / 3), never folded into PER.
  const attack = byProcedure(defs, "ATTACK_ROLL")?.payload.total as Formula | undefined;
  if (sourceOf(attack, "DERIVED", "statistic", "ACCURACY").length !== 1) add("accuracy-omitted");
  if (sourceOf(attack, "STAT", "stat", "PER").length !== 1 || sources(attack, "STAT").some((v) => v.source.stat === "PRO")) add("accuracy-hidden-in-per");
  if (attack !== undefined && /\/|floor|ceil|\d/.test(attack.expression)) add("accuracy-hidden-in-per");
  if ((byStatistic(defs, "ACCURACY")[0]?.payload.formula as Formula | undefined)?.expression !== "floor(pro / 3)") add("accuracy-omitted");

  // HP / MP are additive racial bases (M5-SC-003).
  for (const [statistic, base, stat] of [["MAXIMUM_HP", "BASE_HP", "CON"], ["MAXIMUM_MP", "BASE_MP", "RES"]] as const) {
    const f = byStatistic(defs, statistic)[0]?.payload.formula as Formula | undefined;
    if (f === undefined || /[*/]/.test(f.expression) || sourceOf(f, "CHARACTER", "field", base).length !== 1 || sourceOf(f, "STAT", "stat", stat).length !== 1) add("multiplicative-resources");
  }

  // Natural selection first, bonuses once: selection reads only r1 / r2; every total adds `natural` exactly once.
  for (const d of defs.filter((x) => x.definitionKind === "CORE_RESOLUTION" && x.payload.naturalSelection !== null && x.payload.procedure !== "STAT_MASTERY")) {
    const sel = d.payload.naturalSelection as Record<string, { expression: string }>;
    if (sel.NORMAL?.expression !== "r1" || sel.ADVANTAGE?.expression !== "max(r1, r2)" || sel.DISADVANTAGE?.expression !== "min(r1, r2)") add("advantage-modifiers-twice");
    if (Object.keys(sel).sort().join() !== "ADVANTAGE,DISADVANTAGE,NORMAL") add("advantage-stacking");
    const total = d.payload.total as Formula;
    if (sources(total, "NATURAL").length !== 1 || (total.expression.match(/\bnatural\b/g) ?? []).length !== 1) add("advantage-modifiers-twice");
  }

  // Criticals read the selected natural and still require the hit; damage deferred.
  const critical = byProcedure(defs, "ATTACK_ROLL")?.payload.critical as Record<string, string> | null | undefined;
  if (critical?.threat !== "NATURAL_EQUALS_DIE_FACES" || critical.hit !== "THREAT_AND_SUCCESS" || critical.damage !== "DEFERRED") add("critical-rule");

  // Skill Checks: Stat chosen by approach; ranks ordered explicitly; bonuses 0 / 2 / 4 / 6; UNTRAINED gated.
  for (const p of ["SKILL_CHECK", "SKILL_AUTOMATIC_SUCCESS", "SAVING_THROW", "CORE_ROLL"]) {
    const total = byProcedure(defs, p)?.payload.total as Formula | undefined;
    if (sources(total, "CHOSEN_STAT").length !== 1 || sources(total, "STAT").length > 0) add("skill-fixed-stat");
  }
  const ladder = defs.find((d) => d.definitionKind === "RANK_LADDER" && d.payload.ladderKey === "SKILL")?.payload.ranks as { rankKey: string; order: number }[] | undefined;
  if (JSON.stringify(ladder?.map((r) => r.rankKey)) !== JSON.stringify(["UNTRAINED", "TRAINED", "EXPERT", "MASTER"]) || (ladder ?? []).some((r, i, all) => i > 0 && !(r.order > (all[i - 1] as { order: number }).order))) add("rank-alphabetical");
  const entries = defs.find((d) => d.definitionKind === "SKILL_RANK")?.payload.entries as { rankKey: string; bonus: number; attemptAllowed: boolean }[] | undefined;
  const bonuses = Object.fromEntries((entries ?? []).map((e) => [e.rankKey, e.bonus]));
  if (JSON.stringify(bonuses) !== JSON.stringify({ UNTRAINED: 0, TRAINED: 2, EXPERT: 4, MASTER: 6 })) add("rank-numeric-collapse");
  if (entries?.find((e) => e.rankKey === "UNTRAINED")?.attemptAllowed !== false) add("untrained-access");

  // Mana Efficiency is a payment pool equal to PRO, never a discount.
  const me = byStatistic(defs, "BASE_MANA_EFFICIENCY")[0]?.payload.formula as Formula | undefined;
  if (me?.expression !== "pro" || /listed|discount|cost/i.test(text)) add("me-discount");

  // Stat Mastery is a signal, never a bonus.
  const mastery = byProcedure(defs, "STAT_MASTERY")?.payload as { mastery?: Record<string, unknown> } | undefined;
  if (mastery?.mastery?.signal !== "ADVANTAGE" || Object.keys(mastery.mastery).some((k) => !["levelAtLeast", "statAtLeast", "signal"].includes(k))) add("stat-mastery-bonus");

  return [...findings].sort();
}
