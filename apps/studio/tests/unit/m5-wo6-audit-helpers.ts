import ts from "typescript";

/**
 * M5-WO6 static audit helpers (PAS-10 M5-WO6 §173). Three kinds of check:
 *
 *   auditWo6Source   — TypeScript AST rules over the Targeting modules of @prowess/game (comments never trip a rule);
 *   auditWo6Content  — structural rules over the canonical Targeting content (targeting.json);
 *   auditStudioGeometry — no Targeting geometry arithmetic in Studio UI code (§189, M5-I175).
 *
 * Each returns sorted, de-duplicated finding names so negative controls can assert the exact rule that fires.
 */
const RESOLUTION_TOKENS = new Set(["ATTACK_ROLL", "SAVING_THROW", "AUTOMATIC", "AGI", "CON", "PRO", "STR", "PER", "RES"]);
const RANK_TOKENS = new Set(["UNTRAINED", "TRAINED", "EXPERT", "MASTER"]);
const LATEST = /getLatest|^latest|latest[A-Z]|newest|mostRecent|getCurrent|^current(Version|Definition|Ruleset|Targeting|Radius)|^findNewest/i;
const RESOLUTION_NAMES = /^(saveStat|saveProfile|savingThrow|attackRoll|attackStat|defense|dodge\w*|characterDc)$/i;
const FINAL_COST = /^(totalMp|finalMp|finalAp|spellAp|totalCost|finalCost|listedTotal|pay(Mp|Ap|Cost|ment)\w*|spend(Mp|Ap)\w*|chargeMp)$/i;
const ADD_ON_BASE = /^(spell|maneuver)\.targeting\.(trigger\w*|glyph\w*|anchor\w*)$/;
const NAME_INFERENCE = /^(spell|maneuver)\.targeting\.|^(radius|area|aura|cone|line|zone|projectile)$|^(Radius|Area|Aura|Cone|Line|Zone|Projectile)$/;

const literalText = (node: ts.Node): string | null => (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) ? node.text : null);

export function auditWo6Source(source: string, file: string): string[] {
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const findings = new Set<string>();
  const add = (f: string) => findings.add(f);
  const vocabulary = /vocabulary\//.test(file);

  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      if (/^(@prowess\/db|@prisma\/|pg$|prisma|node:|fs$|path$|next|react)/.test(node.moduleSpecifier.text)) add("database-access");
      if (/content\/.*\.json$/.test(node.moduleSpecifier.text)) add("content-in-code");
    }

    const text = literalText(node);
    if (text !== null && !vocabulary) {
      // §5, M5-I160: Targeting code never names a resolution mode or a Save / Attack Stat.
      if (RESOLUTION_TOKENS.has(text)) add("targeting-resolution");
      // Rank order and Rank Bases come from the ladder and the authored rank table, never a rank token in code.
      if (RANK_TOKENS.has(text)) add("rank-token-in-code");
      // §101, §73: no Targeting identity / compatibility from canonical-key or display text.
      if (NAME_INFERENCE.test(text)) add("name-inference");
      if (ADD_ON_BASE.test(text)) add("add-on-as-base");
      // M5-I175: geometry Formulas are content, never code.
      if (/\b(pro|per|str|rank_base|base_range)\b\s*[*+]|[*+]\s*\b(pro|per|str|rank_base|base_range)\b|^\d+\s*\*\s*\w+$/.test(text)) add("formula-in-code");
    }
    if (ts.isPropertyAssignment(node) && ts.isIdentifier(node.name) && node.name.text === "expression" && literalText(node.initializer) !== null) add("formula-in-code");

    if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
      const callee = node.expression.getText(ast);
      if (/^Math\.\w+$/.test(callee)) add("hidden-math");
      if (/^Math\.random$|^crypto\.|^Date\.now$|^performance\.now$/.test(callee) || (ts.isNewExpression(node) && callee === "Date")) add("nondeterminism");
      // §73 fuzzy compatibility: substring / case-folded matching of a name.
      if (/\.(includes|indexOf|startsWith|endsWith|match|search|test)$/.test(callee) && (node.arguments ?? []).some((a) => /radius|area|cone|line|zone|aura|projectile|target/i.test(literalText(a) ?? ""))) add("fuzzy-compatibility");
      if (/\.localeCompare$/.test(callee) || /\.(toLowerCase|toUpperCase)\(\)\.(includes|indexOf|startsWith|endsWith|match|search)$/.test(callee)) add("fuzzy-compatibility");
    }

    if (ts.isIdentifier(node)) {
      const parent = node.parent;
      const declares = parent !== undefined && (ts.isVariableDeclaration(parent) || ts.isFunctionDeclaration(parent) || ts.isPropertyAssignment(parent) || ts.isParameter(parent) || ts.isPropertySignature(parent)) && (parent as { name?: ts.Node }).name === node;
      if (declares && LATEST.test(node.text)) add("latest-or-current");
      if (declares && RESOLUTION_NAMES.test(node.text)) add("targeting-resolution");
      if (declares && FINAL_COST.test(node.text)) add("final-cost");
    }

    if (ts.isBinaryExpression(node)) {
      const op = node.operatorToken.kind;
      const arithmetic = [ts.SyntaxKind.PlusToken, ts.SyntaxKind.MinusToken, ts.SyntaxKind.AsteriskToken, ts.SyntaxKind.SlashToken, ts.SyntaxKind.PercentToken, ts.SyntaxKind.PlusEqualsToken, ts.SyntaxKind.MinusEqualsToken].includes(op);
      const stringy = [node.left, node.right].some((s) => ts.isStringLiteral(s) || ts.isTemplateExpression(s) || ts.isNoSubstitutionTemplateLiteral(s));
      if (arithmetic && !stringy) add("hidden-math");
    }

    // §128 / M5-I178: no module-level mutable state.
    if (ts.isVariableStatement(node) && node.parent === ast && (node.declarationList.flags & ts.NodeFlags.Let) !== 0) add("global-state");

    node.forEachChild(visit);
  };
  visit(ast);
  return [...findings].sort();
}

type Def = { canonicalKey: string; definitionKind: string; payload: Record<string, any> };  
export type TargetingDoc = { definitions: Def[]; deferred?: { conflictKey: string; subject: string }[]; designerRulings?: string[]; sources?: Record<string, { locators: string[]; conflicts: string[] }> };

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const SPELL_SHAPES = ["SELF", "TOUCH", "SINGLE_TARGET", "MULTI_TARGET", "PROJECTILE", "LINE", "CONE", "RADIUS", "ZONE", "AURA"];
const MANEUVER_SHAPES = ["SELF", "TOUCH", "SINGLE_TARGET", "MULTI_TARGET", "LINE", "CONE", "RADIUS", "CHAIN", "ZONE"];
const SPELL_BASE: Record<string, number> = { SELF: 0, TOUCH: 1, SINGLE_TARGET: 3, MULTI_TARGET: 5, LINE: 5, CONE: 5, RADIUS: 6, ZONE: 8, AURA: 6 };
const FORBIDDEN_KEYS = /"(save|saves|saveStat|saveProfile|saveProfiles|savingThrow|attackRoll|attackRolls|resolution|outcome|outcomes|damage|healing|status|statuses|effect|effects)"\s*:/;

/** Structural rules over targeting.json (§19–§99). */
export function auditWo6Content(doc: TargetingDoc): string[] {
  const findings = new Set<string>();
  const add = (f: string) => findings.add(f);
  const spell = doc.definitions.filter((d) => d.definitionKind === "SPELL_TARGETING");
  const maneuver = doc.definitions.filter((d) => d.definitionKind === "MANEUVER_TARGETING");
  if (spell.length + maneuver.length !== doc.definitions.length) add("foreign-definition");
  if (!same(spell.map((d) => d.payload.semanticShape), SPELL_SHAPES)) add("spell-catalog");
  if (!same(maneuver.map((d) => d.payload.semanticShape), MANEUVER_SHAPES)) add("maneuver-catalog");
  for (const d of doc.definitions) {
    if (/trigger|glyph|anchor/i.test(d.canonicalKey) || ["TRIGGERED", "ANCHOR"].includes(d.payload.semanticShape)) add("add-on-as-base"); // M5-I164
    if (FORBIDDEN_KEYS.test(JSON.stringify(d.payload))) add("targeting-resolution"); // M5-I159–I160
    const t = d.payload.rules?.targeting;
    if (t === undefined) add("rules-missing");
    if (t?.radiusCapable !== (t?.measures ?? []).some((m: { measure: string }) => m.measure === "RADIUS")) add("radius-capable");
    const params = (t?.parameters ?? []).map((p: { parameter: string }) => p.parameter);
    if (params.some((p: string) => /area|radius/i.test(p))) add("superseded-radius-expansion"); // M5-I170
    if (JSON.stringify(d.payload.costContributions ?? []).match(/radius|area_extension|widen/i)) add("superseded-radius-expansion");
  }
  // Spell base contributions (§20, §148) and Projectile (§21–§23, M5-I163).
  for (const d of spell) {
    const shape = d.payload.semanticShape as string;
    const bases = (d.payload.costContributions ?? []).filter((c: { data: { kind: string } }) => c.data.kind === "BASE" || c.data.kind === "BASE_DEFERRED");
    if (shape === "PROJECTILE") {
      if (!same(bases, [{ contributionKey: "targeting.base", currency: "MP", data: { kind: "BASE_DEFERRED", conflictKey: "M5-SC-039" } }])) add("projectile-cost-guess");
    } else if (!same(bases.map((c: { currency: string; data: { kind: string; amount: number } }) => [c.currency, c.data.kind, c.data.amount]), [["MP", "BASE", SPELL_BASE[shape]]])) add("spell-base-cost");
    if (["SINGLE_TARGET", "MULTI_TARGET", "PROJECTILE", "RADIUS", "ZONE"].includes(shape)) {
      const range = d.payload.rules?.targeting?.range;
      if (range?.model !== "DEFAULT_SPELL_RANGE" || !same(range.formula?.variables?.[0], { variable: "base_range", source: { kind: "DERIVED", statistic: "BASE_RANGE" } })) add("default-spell-range"); // M5-I165
    }
  }
  if (spell.find((d) => d.payload.semanticShape === "PROJECTILE")?.payload.rules?.targeting?.cardinality?.kind !== "ONE") add("projectile-cardinality");
  // Spell areas (§28–§35, M5-I167–I169).
  const formula = (shape: string, measure: string) => spell.find((d) => d.payload.semanticShape === shape)?.payload.rules?.targeting?.measures?.find((m: { measure: string }) => m.measure === measure);
  if (formula("LINE", "LENGTH")?.formula?.expression !== "15 * pro + length_extension * 10") add("spell-line-length");
  const width = formula("LINE", "WIDTH");
  if (width?.valueStatus !== "DEFERRED_PENDING_CANON" || width?.conflictKey !== "M5-SC-040" || width?.formula !== undefined) add("line-width-guess");
  if (formula("CONE", "LENGTH")?.formula?.expression !== "10 * pro + length_extension * 10") add("spell-cone-length");
  for (const s of ["RADIUS", "ZONE", "AURA"]) if (formula(s, "RADIUS")?.formula?.expression !== "5 * pro") add("spell-radius");
  // Maneuver (§81–§98, M5-I172–I174).
  for (const d of maneuver) if ((d.payload.costContributions ?? []).length > 0) add("maneuver-targeting-cost");
  const radius = maneuver.find((d) => d.payload.semanticShape === "RADIUS")?.payload.rules?.targeting;
  const rm = radius?.measures?.find((m: { measure: string }) => m.measure === "RADIUS");
  if (rm?.formula?.expression !== "rank_base * str") add("maneuver-radius");
  if (!same(radius?.rankTables, [{ tableKey: "MARTIAL_RANK_BASE", skillKey: "skill.martial", entries: [{ rankKey: "TRAINED", value: 5 }, { rankKey: "EXPERT", value: 10 }, { rankKey: "MASTER", value: 15 }] }])) add("maneuver-radius");
  if (JSON.stringify(maneuver).match(/"(minStr|maxStr|strMinimum|strMaximum|strBand\w*|bands?)"\s*:/i)) add("str-band-table"); // M5-I174
  // The deferred register (§21, §30).
  if (!same((doc.deferred ?? []).map((x) => [x.conflictKey, x.subject]), [["M5-SC-039", "spell.targeting.projectile"], ["M5-SC-040", "spell.targeting.line"]])) add("deferred-register");
  return [...findings].sort();
}

/** §189 / M5-I175: Studio UI code never computes Targeting geometry (it renders M4 results only). */
export function auditStudioGeometry(source: string): string[] {
  const findings = new Set<string>();
  const code = source.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, "");
  if (/\b(pro|per|str|prowess|perception|strength)\w*\s*\*\s*\d+|\b\d+\s*\*\s*(pro|per|str|prowess|perception|strength)\w*/i.test(code)) add("ui-geometry-math");
  if (/\b(radius|range|lineLength|coneLength|spellRange)\w*\s*=\s*[^;\n]*\*/i.test(code)) add("ui-geometry-math");
  function add(f: string) {
    findings.add(f);
  }
  return [...findings].sort();
}
