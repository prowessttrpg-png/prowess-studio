import ts from "typescript";

/**
 * M5-WO4 static audit helpers (PAS-10 M5-WO4 §266). Two kinds of check:
 *
 *   auditWo4Source   — TypeScript AST rules over @prowess/game / @prowess/rules production source (comments never trip a rule);
 *   auditWo4Content  — structural rules over the canonical Affinity content and the amended core / runtime Movement content.
 *
 * Both return sorted, de-duplicated finding names so negative controls can assert the exact rule that fires.
 */
export type Wo4Layer = "game" | "rules";

const AFFINITY_TOKENS = new Set(["EVOCATION", "CONJURATION", "TRANSMUTATION", "DIVINATION", "ENHANCEMENT", "MANIPULATION", "EMISSION"]);
const GEOMETRY = new Set(["SELF", "TOUCH", "SINGLE_TARGET", "MULTI_TARGET", "LINE", "CONE", "RADIUS", "ZONE", "AURA", "CHAIN"]);
const AFFINITY_IN_M4 = /(^|[^a-z])(affinit\w*|evocation|emission|conjuration|transmutation|divination|enhancement|manipulation|strength_?keyword|weakness\w*|governing)([^a-z]|$)/i;
const LATEST = /getLatest|^latest|latest[A-Z]|newest|mostRecent|getCurrent|^current(Version|Affinity|Definition|Ruleset|Rules)|^active(Affinity|Ruleset|Definition)|^findNewest/i;
const GLOBAL_STATE = /^(currentAffinity|selectedAffinity|activeAffinity|lastAffinityResult|affinityCache|affinityRegistry)$/i;
const AUTO_GOVERNING = /^(highest|best|strongest|newest|first|cheapest|auto)\w*(Affinity|Rank)$|^(pickGoverning|chooseGoverning|selectGoverning|autoSelect\w*)$/i;
const FREE_TRAIT = /^(freeTrait\w*|waive\w*|traitCostWaived|zeroCostTrait\w*|freeAccess)$/i;
const DIRECT_AP = /^(spellAp\w*|apDiscount|apCost|apReduction|affinityAp\w*|reduceAp)$/i;
const ME_TERMS = /^(manaEfficiency\w*|meEligible|meDiscount|meCost|mePaid)$/i;
const NETTING = /^(netPercent|netModifier|combinedPercent|netAffinity\w*)$/i;
const CAPACITY_SUM = /^(totalCapacity|combinedCapacity|stackedCapacity)$/i;

const literalText = (node: ts.Node): string | null => (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) ? node.text : null);

/** True when `node` sits inside a loop or an iterating callback (map / forEach / flatMap / reduce / filter). */
function insideIteration(node: ts.Node, ast: ts.SourceFile): boolean {
  for (let n: ts.Node | undefined = node.parent; n !== undefined; n = n.parent) {
    if (ts.isForOfStatement(n) || ts.isForStatement(n) || ts.isForInStatement(n) || ts.isWhileStatement(n)) return true;
    if (ts.isCallExpression(n) && /\.(map|forEach|flatMap|reduce|filter)$/.test(n.expression.getText(ast))) return true;
  }
  return false;
}

export function auditWo4Source(source: string, file: string, layer: Wo4Layer): string[] {
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const findings = new Set<string>();
  const add = (f: string) => findings.add(f);
  const vocabulary = /vocabulary\/(terminology|construction|affinity)\.ts$/.test(file);
  const affinity = /\/affinity\/|definition\/affinity-payload\.ts$/.test(file);
  const compiler = /affinity\/compile\.ts$/.test(file);

  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const name = node.moduleSpecifier.text;
      if (layer === "game" && /^(@prowess\/db|@prisma\/|pg$|prisma|node:|fs$|path$|next|react)/.test(name)) add("database-access");
      if (layer === "rules" && /@prowess\/game/.test(name)) add("affinity-in-m4");
    }

    // ---- literals ------------------------------------------------------------------------------------------------
    const text = literalText(node);
    if (text !== null) {
      if (layer === "rules" && AFFINITY_IN_M4.test(text)) add("affinity-in-m4");
      if (layer === "game" && /^(EMISSION|affinity\.emission)$/i.test(text) && !/terminology\.ts$/.test(file)) add("emission-canonical");
      if (layer === "game" && /^(TOTAL_MOVEMENT|FINAL_MOVEMENT|total_movement|final_movement)$/.test(text)) add("total-movement-stat");
      if (layer === "game" && /^5 \* agi$|^agi \* 5$/.test(text)) add("old-movement-term");
      if (affinity && (text === "ACTION_POINTS" || text === "AP" || /^spell\.ap/.test(text))) add("direct-ap");
      if (affinity && (text === "ME" || /mana_?efficiency/i.test(text) || /^ME_ELIGIBLE/.test(text))) add("me-in-affinity");
      if (affinity && GEOMETRY.has(text)) add("geometry-inference");
      if (affinity && /^[a-z]+( [a-z]+)+$/.test(text) && /damage|healing|area|buff|summon|control/.test(text) && ts.isBinaryExpression(node.parent)) add("fuzzy-keyword");
    }
    if (ts.isRegularExpressionLiteral(node) && affinity && /\/[a-z]*i[a-z]*$/.test(node.text)) add("fuzzy-keyword");

    // ---- calls ---------------------------------------------------------------------------------------------------
    if (ts.isCallExpression(node)) {
      const callee = node.expression.getText(ast);
      if (affinity && /^Math\.(floor|ceil|round|trunc)$|\.(toFixed|toPrecision)$/.test(callee)) add("affinity-rounding");
      // Exact identity only: the Affinity layer never case-folds, normalizes or pattern-matches anything (§68).
      if (affinity && /\.(toLowerCase|toUpperCase|toLocaleLowerCase|toLocaleUpperCase|localeCompare|normalize|search|match)$/.test(callee)) add("fuzzy-keyword");
      if (affinity && /\.(includes|startsWith|endsWith|indexOf)$/.test(callee) && /displayName|\.name\b|\.label\b|\.text\b/i.test(callee)) add("fuzzy-keyword");
      if (affinity && /^Math\.max$/.test(callee)) add("hidden-percent-math");
      if (layer === "game" && LATEST.test(callee.split(".").pop() ?? "")) add("latest-or-current");
      if (compiler && /\.affinities\.(map|forEach|flatMap|reduce)$|\.affinities\.sort$/.test(callee)) {
        const body = node.arguments.map((a) => a.getText(ast)).join(" ");
        if (/strengths|weaknesses|REDUCE_PERCENT|INCREASE_PERCENT|ruleCondition|emitRules/.test(body) || /\.sort$/.test(callee)) add(/\.sort$/.test(callee) ? "auto-governing" : "multi-affinity-stack");
      }
    }
    if (ts.isForOfStatement(node) && compiler && /\.affinities$/.test(node.expression.getText(ast)) && /strengths|weaknesses|REDUCE_PERCENT|INCREASE_PERCENT|ruleCondition|emitRules/.test(node.statement.getText(ast))) add("multi-affinity-stack");

    // ---- property access / identifiers -----------------------------------------------------------------------------
    if (ts.isPropertyAccessExpression(node) && compiler) {
      if (node.name.text === "primaryAffinity") add("auto-governing");
      if (node.name.text === "semanticShape" || node.name.text === "geometry") add("geometry-inference");
    }
    if (ts.isElementAccessExpression(node) && compiler && /\.affinities$/.test(node.expression.getText(ast))) add("auto-governing");
    if (ts.isIdentifier(node) && layer === "game") {
      const parent = node.parent;
      const declares = parent !== undefined && (ts.isVariableDeclaration(parent) || ts.isFunctionDeclaration(parent) || ts.isPropertyAssignment(parent) || ts.isMethodDeclaration(parent) || ts.isParameter(parent) || ts.isPropertySignature(parent)) && (parent as { name?: ts.Node }).name === node;
      if (LATEST.test(node.text)) add("latest-or-current");
      if (affinity && declares && GLOBAL_STATE.test(node.text)) add("global-affinity-state");
      if (affinity && AUTO_GOVERNING.test(node.text)) add("auto-governing");
      if (affinity && declares && FREE_TRAIT.test(node.text)) add("free-trait");
      if (affinity && declares && DIRECT_AP.test(node.text)) add("direct-ap");
      if (affinity && ME_TERMS.test(node.text)) add("me-in-affinity");
      if (affinity && declares && NETTING.test(node.text)) add("percent-netting");
      if (affinity && declares && CAPACITY_SUM.test(node.text)) add("capacity-addition");
      if (declares && /^(totalMovement|finalMovement)$/i.test(node.text)) add("total-movement-stat");
    }
    if (ts.isIdentifier(node) && layer === "rules" && AFFINITY_IN_M4.test(node.text.replace(/([a-z])([A-Z])/g, "$1_$2"))) add("affinity-in-m4");

    // Module-level mutable state in the Affinity layer (§168).
    if (affinity && ts.isVariableStatement(node) && ts.isSourceFile(node.parent) && (node.declarationList.flags & ts.NodeFlags.Let) !== 0) add("global-affinity-state");

    // ---- object literals: modifiers ---------------------------------------------------------------------------------
    if (ts.isPropertyAssignment(node) && layer === "game") {
      const name = node.name.getText(ast).replace(/["']/g, "");
      const value = literalText(node.initializer);
      // Strength discount applies ONCE: a REDUCE_PERCENT emitted per rule / per match is stacking (§87–§88).
      if (affinity && name === "operation" && value === "REDUCE_PERCENT" && insideIteration(node, ast)) add("strength-stacking");
      // The selected Weakness applies ONCE: INCREASE_PERCENT per Weakness is "all Weaknesses stack" (§91).
      if (affinity && name === "operation" && value === "INCREASE_PERCENT" && insideIteration(node, ast)) add("weakness-stacking");
      if (affinity && name === "rounding" && value !== null && value !== "NONE") add("affinity-rounding");
      if (affinity && /^(cost|mpCost|traitCost|listedCost)$/.test(name) && ts.isNumericLiteral(node.initializer) && node.initializer.text === "0") add("free-trait");
      if (!vocabulary && AFFINITY_TOKENS.has(name) && (ts.isNumericLiteral(node.initializer) || ts.isObjectLiteralExpression(node.initializer) || ts.isArrayLiteralExpression(node.initializer))) add("affinity-switch");
    }
    // Strength phase must precede Weakness phase (§97).
    if (ts.isObjectLiteralExpression(node) && affinity) {
      const props = new Map(node.properties.filter(ts.isPropertyAssignment).map((p) => [p.name.getText(ast).replace(/["']/g, ""), p.initializer]));
      const key = props.get("phaseKey");
      const order = props.get("phaseOrder");
      if (key !== undefined && order !== undefined && ts.isNumericLiteral(order)) {
        const k = literalText(key);
        if (k === "affinity.strength" && order.text !== "1") add("modifier-order");
        if (k === "affinity.weakness" && order.text !== "2") add("modifier-order");
      }
    }

    // ---- binary expressions ----------------------------------------------------------------------------------------
    if (ts.isBinaryExpression(node) && layer === "game") {
      const op = node.operatorToken.kind;
      const sides = [node.left, node.right];
      const lits = sides.map(literalText);
      const texts = sides.map((s) => s.getText(ast));
      const equality = [ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken, ts.SyntaxKind.EqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsToken].includes(op);
      if (equality && !vocabulary && lits.some((l) => l !== null && AFFINITY_TOKENS.has(l))) add("affinity-switch");
      if (equality && affinity && lits.some((l) => l !== null && GEOMETRY.has(l))) add("geometry-inference");
      if (equality && affinity && texts.some((t) => /displayName|\.name$|\.label$|\.text$/.test(t))) add("fuzzy-keyword");
      if (equality && affinity && texts.some((t) => /rankKey|\.rank$/.test(t)) && [ts.SyntaxKind.LessThanToken, ts.SyntaxKind.GreaterThanToken].includes(op)) add("rank-alphabetical");
      if ([ts.SyntaxKind.LessThanToken, ts.SyntaxKind.GreaterThanToken, ts.SyntaxKind.LessThanEqualsToken, ts.SyntaxKind.GreaterThanEqualsToken].includes(op) && affinity && texts.some((t) => /\.rank$|rankKey$|minimumRank$/.test(t))) add("rank-alphabetical");
      const arithmetic = [ts.SyntaxKind.PlusToken, ts.SyntaxKind.MinusToken, ts.SyntaxKind.AsteriskToken, ts.SyntaxKind.SlashToken, ts.SyntaxKind.PlusEqualsToken, ts.SyntaxKind.MinusEqualsToken, ts.SyntaxKind.AsteriskEqualsToken].includes(op);
      if (arithmetic && affinity && texts.some((t) => /percent|discount|penalty|cost|operand|capacity/i.test(t))) add("hidden-percent-math");
      if (arithmetic && affinity && texts.some((t) => /strength|discount/i.test(t)) && texts.some((t) => /weakness|penalty/i.test(t))) add("percent-netting");
      if (arithmetic && affinity && texts.some((t) => /arcan/i.test(t))) add("capacity-addition");
      if (arithmetic && compiler && texts.some((t) => /\bap\b|actionPoint/i.test(t))) add("direct-ap");
    }

    if (ts.isCaseClause(node) && layer === "game" && !vocabulary) {
      const lit = literalText(node.expression);
      if (lit !== null && AFFINITY_TOKENS.has(lit)) add("affinity-switch");
      if (lit !== null && GEOMETRY.has(lit) && affinity) add("geometry-inference");
    }
    node.forEachChild(visit);
  };
  visit(ast);
  // The Spell-only boundary of the MP fragment must stay in the compiler (§8, M5-I144).
  if (compiler && /case "SPELL_AFFINITY_COST"/.test(source) && !/subject\.kind === "SPELL_AFFINITY_COST" && composition\.abilityKind !== "SPELL"/.test(source)) add("maneuver-spell-cost");
  return [...findings].sort();
}

// ---- content ---------------------------------------------------------------------------------------------------------

interface ContentDefinition {
  canonicalKey: string;
  definitionKind: string;
  schemaVersion?: number;
  payload: Record<string, unknown>;
}
interface Formula {
  expression: string;
  rounding?: string;
  variables: { variable: string; source: { kind: string; stat?: string; statistic?: string } }[];
}
type Doc = { definitions: ContentDefinition[]; deferred?: { conflictKey: string }[]; keywords?: { canonicalKey: string }[] };

const EXPECTED_STRENGTHS: Record<string, string[]> = {
  EVOCATION: ["DIRECT_DAMAGE", "AREA_EFFECT", "SUSTAINED_OR_CHANNELED_OUTPUT"],
  CONJURATION: ["SUMMONING", "UTILITY", "PERSISTENT_CREATION"],
  TRANSMUTATION: ["BUFF", "UTILITY", "ELEMENTAL_OR_TERRAIN_ALTERATION"],
  DIVINATION: ["DETECTION", "KNOWLEDGE", "PREDICTIVE_OR_REACTIVE_EFFECT"],
  ENHANCEMENT: ["BUFF", "HEALING", "RESISTANCE", "REINFORCEMENT", "RECOVERY"],
  MANIPULATION: ["CONTROL", "ILLUSION", "REDIRECTION", "INTERFERENCE", "MIND_EFFECT"],
};
const EXPECTED_WEAKNESSES: Record<string, [string, number][]> = {
  EVOCATION: [["HEALING", 30], ["BUFF_OR_DEBUFF", 20], ["SUMMON_OR_CONSTRUCT", 20]],
  CONJURATION: [["DAMAGE", 20], ["HEALING_OR_BUFF", 30], ["INSTANT_EFFECT", 20]],
  TRANSMUTATION: [["DIRECT_DAMAGE", 10], ["AOE_SCALING", 20], ["SUMMON", 30]],
  DIVINATION: [["DAMAGE", 30], ["HEALING", 30], ["PERSISTENT_EFFECT", 15]],
  ENHANCEMENT: [["CONTROL", 10], ["SUMMON", 20], ["DAMAGE", 30]],
  MANIPULATION: [["PERSISTENT_EFFECT", 10], ["HEALING", 20], ["DAMAGE", 30]],
};

/** Structural rules over the canonical Affinity content and the amended Movement content (M5-WO4 §10–§75, §142–§147). */
export function auditWo4Content(affinity: Doc, core: Doc, runtime: Doc): string[] {
  const findings = new Set<string>();
  const add = (f: string) => findings.add(f);
  const defs = affinity.definitions;
  const of = (kind: string) => defs.filter((d) => d.definitionKind === kind);

  // Six exact canonical Affinities, version 2, keyed affinity.<name>; Emission nowhere (M5-I114, M5-I115).
  const affinities = of("AFFINITY");
  const tokens = affinities.map((d) => String(d.payload.affinity));
  if (JSON.stringify(tokens) !== JSON.stringify(Object.keys(EXPECTED_STRENGTHS)) || affinities.some((d) => d.schemaVersion !== 2 || d.canonicalKey !== `affinity.${String(d.payload.affinity).toLowerCase()}`)) add("affinity-identity");
  if (/emission/i.test(JSON.stringify(defs))) add("emission-canonical");

  // The Strength / Weakness tables are exact content; Divination Persistent Effects stays exactly 15% with no severity.
  for (const d of affinities) {
    const strengths = (d.payload.strengths as { strengthKey: string; matchAny: string[] }[]) ?? [];
    const weaknesses = (d.payload.weaknesses as { weaknessKey: string; matchAny: string[]; activationPenaltyPercent: number; severity: string | null }[]) ?? [];
    if (JSON.stringify(strengths.map((s) => s.strengthKey)) !== JSON.stringify(EXPECTED_STRENGTHS[String(d.payload.affinity)])) add("strength-table");
    if (JSON.stringify(weaknesses.map((w) => [w.weaknessKey, w.activationPenaltyPercent])) !== JSON.stringify(EXPECTED_WEAKNESSES[String(d.payload.affinity)])) add("weakness-table");
    for (const r of [...strengths, ...weaknesses]) if (!r.matchAny.every((k) => /^keyword\.[a-z0-9_]+$/.test(k))) add("fuzzy-keyword");
    const divination = d.payload.affinity === "DIVINATION" ? weaknesses.find((w) => w.weaknessKey === "PERSISTENT_EFFECT") : undefined;
    if (d.payload.affinity === "DIVINATION" && (divination?.activationPenaltyPercent !== 15 || divination.severity !== null)) add("divination-coerced");
  }

  // Rank rule: NONE 0 / TRAINED 10 / EXPERT 20 / MASTER 30; capacities 1 / 2 / 3; NONE none; Authority from TRAINED.
  const rule = of("AFFINITY_RANK_RULE");
  const ranks = (rule[0]?.payload.ranks as { rank: string; order: number; strengthDiscountPercent: number; authority: { effectCapacity: number; traitCapacity: number } | null }[] | undefined) ?? [];
  const expectedRanks = [
    ["NONE", 0, 0, null],
    ["TRAINED", 1, 10, [1, 1]],
    ["EXPERT", 2, 20, [2, 2]],
    ["MASTER", 3, 30, [3, 3]],
  ];
  if (rule.length !== 1 || JSON.stringify(ranks.map((r) => [r.rank, r.order, r.strengthDiscountPercent, r.authority === null ? null : [r.authority.effectCapacity, r.authority.traitCapacity]])) !== JSON.stringify(expectedRanks)) add("rank-rule");
  if (rule[0]?.payload.authorityMinimumRank !== "TRAINED") add("rank-rule");
  const severities = of("AFFINITY_WEAKNESS_SEVERITY")[0]?.payload.severities;
  if (JSON.stringify(severities) !== JSON.stringify([{ severity: "MINOR", percent: 10 }, { severity: "MODERATE", percent: 20 }, { severity: "MAJOR", percent: 30 }])) add("severity-scale");

  // Progression: Level 1 NONE, Level 3 TRAINED, Level 6 Expert-or-Secondary, Level 9 new Affinity unresolved (M5-SC-035).
  const levels = (of("AFFINITY_PROGRESSION")[0]?.payload.levels as { level: number; options: Record<string, unknown>[] }[] | undefined) ?? [];
  const opt = (level: number, key: string) => levels.find((l) => l.level === level)?.options.find((o) => o.optionKey === key);
  if (opt(1, "CHOOSE_PRIMARY")?.startingRank !== "NONE" || opt(3, "PRIMARY_TRAINED")?.to !== "TRAINED" || opt(6, "PRIMARY_EXPERT")?.to !== "EXPERT" || opt(6, "GAIN_SECONDARY_TRAINED")?.startingRank !== "TRAINED") add("progression");
  const gain = opt(9, "GAIN_NEW_AFFINITY");
  if (gain === undefined || gain.startingRank !== null || gain.conflictKey !== "M5-SC-035") add("level9-rank-guess");
  if (!(affinity.deferred ?? []).some((x) => x.conflictKey === "M5-SC-035")) add("level9-rank-guess");

  // Every rule Keyword is listed for the M1 Keyword catalog.
  const listed = new Set((affinity.keywords ?? []).map((k) => k.canonicalKey));
  for (const d of affinities) for (const r of [...(d.payload.strengths as { matchAny: string[] }[]), ...(d.payload.weaknesses as { matchAny: string[] }[])]) if (!r.matchAny.every((k) => listed.has(k))) add("keyword-catalog");

  // Movement amendment (M5-I111, M5-I112, M5-I113): Base Movement is the authored 5 ft; Movement = Base × AGI; Sprint
  // = Movement × 4; no Total / Final Movement statistic anywhere.
  const stat = (s: string) => core.definitions.filter((d) => d.definitionKind === "DERIVED_STAT" && d.payload.statistic === s);
  const base = stat("BASE_MOVEMENT")[0]?.payload.formula as Formula | undefined;
  if (base === undefined || base.expression !== "5" || base.variables.length !== 0) add("old-movement-term");
  const movement = stat("MOVEMENT")[0]?.payload.formula as Formula | undefined;
  if (movement === undefined || !/^base_movement \* agi/.test(movement.expression)) add("old-movement-term");
  const all = JSON.stringify([core.definitions, runtime.definitions]);
  if (/TOTAL_MOVEMENT|FINAL_MOVEMENT|total_movement|final_movement/.test(all)) add("total-movement-stat");
  const sprint = runtime.definitions.find((d) => d.definitionKind === "ACTION" && d.payload.actionKey === "SPRINT")?.payload.movementGrant as { formula: Formula } | null | undefined;
  if (sprint?.formula.expression !== "movement * 4" || sprint.formula.variables.some((v) => v.source.statistic !== "MOVEMENT")) add("sprint-allowance");
  for (const d of runtime.definitions.filter((x) => x.definitionKind === "CREATURE_SIZE")) if (d.payload.baseMovement !== null || "movementAdjustment" in d.payload) add("size-base-movement");
  if (!(runtime.deferred ?? []).some((x) => x.conflictKey === "M5-SC-033") || (runtime.deferred ?? []).some((x) => x.conflictKey === "M5-SC-034")) add("movement-conflicts");
  return [...findings].sort();
}
