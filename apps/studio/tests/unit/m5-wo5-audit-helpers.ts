import ts from "typescript";

/**
 * M5-WO5 static audit helpers (PAS-10 M5-WO5 §141). Two kinds of check:
 *
 *   auditWo5Source   — TypeScript AST rules over the shared construction modules of @prowess/game (comments never trip a rule);
 *   auditWo5Content  — structural rules over the canonical ABILITY_CONSTRUCTION_RULE content.
 *
 * Both return sorted, de-duplicated finding names so negative controls can assert the exact rule that fires.
 */
const RANK_TOKENS = new Set(["UNTRAINED", "TRAINED", "EXPERT", "MASTER"]);
const AFFINITY_TOKENS = new Set(["EVOCATION", "CONJURATION", "TRANSMUTATION", "DIVINATION", "ENHANCEMENT", "MANIPULATION"]);
const LATEST = /getLatest|^latest|latest[A-Z]|newest|mostRecent|getCurrent|^current(Version|Definition|Ruleset|Rules)|^findNewest/i;
const AUTO_AUTHORITY = /^(highest|best|strongest|auto)\w*(Authority|Rank|Capacity)$|^(pickAuthority|chooseAuthority|selectAuthority|autoSelect\w*)$/i;
const CAPACITY_SUM = /^(totalCapacity|combinedCapacity|stackedCapacity|sumCapacity|bonusCapacity)$/i;
const FREE_SLOT = /^(isFree|freeSlot\w*|freeSignature\w*|slotWaived|unlimitedPool|ignoreSignature\w*)$/i;
const RANK_VALUE_DEFAULT = /^(defaultStackLimit|stackLimitDefault|universalStackLimit|maxStacks)$/i;
const NAME_INFERENCE = /^(spell|maneuver)\.(effect|trait|condition|targeting|foundation)\.|^keyword\.|^affinity\./;

const literalText = (node: ts.Node): string | null => (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) ? node.text : null);

export function auditWo5Source(source: string, file: string): string[] {
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
      // §141.1 rank order and capacity come from the ladder and the rule — never from a rank token in code.
      if (RANK_TOKENS.has(text)) add("rank-token-in-code");
      // §141.2 no Affinity-specific construction rule in code.
      if (AFFINITY_TOKENS.has(text)) add("affinity-switch");
      // §141.3 no component identity / Keyword / Affinity inference from canonical-key text.
      if (NAME_INFERENCE.test(text)) add("name-inference");
      // §141.4 construction arithmetic is content — no Formula source in code.
      if (/^(floor|ceil|max|min)\(|\b[a-z_]+ [-+*/] [a-z0-9_]+\b/.test(text) && !/[{}$]/.test(text) && /\b(effects?|traits?|trades?|slots?|capacity|projected|stacks?)\b/.test(text)) add("formula-in-code");
    }
    if (ts.isPropertyAssignment(node) && ts.isIdentifier(node.name) && node.name.text === "expression" && literalText(node.initializer) !== null) add("formula-in-code");

    if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
      const callee = node.expression.getText(ast);
      if (/^Math\.(max|min|floor|ceil|round|trunc|abs)$/.test(callee)) add("hidden-math");
      if (/^Math\.random$|^crypto\.|^Date\.now$|^performance\.now$/.test(callee) || (ts.isNewExpression(node) && callee === "Date")) add("nondeterminism");
      if (/localeCompare$/.test(callee)) add("rank-string-order");
      if (/\.sort$/.test(callee) && (node.arguments?.length ?? 0) === 0 && /rank/i.test(callee)) add("rank-string-order");
    }

    if (ts.isIdentifier(node)) {
      const parent = node.parent;
      const declares = parent !== undefined && (ts.isVariableDeclaration(parent) || ts.isFunctionDeclaration(parent) || ts.isPropertyAssignment(parent) || ts.isParameter(parent) || ts.isPropertySignature(parent)) && (parent as { name?: ts.Node }).name === node;
      if (declares && LATEST.test(node.text)) add("latest-or-current");
      if (declares && AUTO_AUTHORITY.test(node.text)) add("authority-auto-switch");
      if (declares && CAPACITY_SUM.test(node.text)) add("capacity-addition");
      if (declares && FREE_SLOT.test(node.text)) add("free-signature-slot");
      if (declares && RANK_VALUE_DEFAULT.test(node.text)) add("default-stack-limit");
    }

    if (ts.isBinaryExpression(node)) {
      const op = node.operatorToken.kind;
      const arithmetic = [ts.SyntaxKind.PlusToken, ts.SyntaxKind.MinusToken, ts.SyntaxKind.AsteriskToken, ts.SyntaxKind.SlashToken, ts.SyntaxKind.PercentToken, ts.SyntaxKind.PlusEqualsToken, ts.SyntaxKind.MinusEqualsToken].includes(op);
      const stringy = [node.left, node.right].some((s) => ts.isStringLiteral(s) || ts.isTemplateExpression(s) || ts.isNoSubstitutionTemplateLiteral(s));
      // §141.5 the compiler counts and compares nothing mechanically: capacities, trades and slots are M4 Formula /
      // Requirement work. (String concatenation is not arithmetic.)
      if (arithmetic && !stringy) add("hidden-math");
      const order = [ts.SyntaxKind.LessThanToken, ts.SyntaxKind.GreaterThanToken, ts.SyntaxKind.LessThanEqualsToken, ts.SyntaxKind.GreaterThanEqualsToken].includes(op);
      const texts = [node.left, node.right].map((s) => s.getText(ast));
      if (order && texts.some((t) => /rank(Key)?\b/i.test(t) && !/\.order\b|\.length\b/.test(t))) add("rank-string-order");
      if (order && texts.some((t) => /\b(effectSlots|traitSlots|conditionSlots|trades|usedSlots|stacks|baseEffects|baseTraits|capacity)\b/.test(t)) && texts.some((t) => /\b(effectSlots|traitSlots|conditionSlots|trades|usedSlots|stacks|baseEffects|baseTraits|capacity|limit|maximum)\b/.test(t)) && !/\b(ok|count|length)\b/.test(texts.join(" "))) add("legality-in-code");
    }

    // §141.6 no module-level mutable state.
    if (ts.isVariableStatement(node) && node.parent === ast && (node.declarationList.flags & ts.NodeFlags.Let) !== 0) add("global-state");

    node.forEachChild(visit);
  };
  visit(ast);
  return [...findings].sort();
}

type Row = Record<string, unknown> & { rankKey: string };
export type ConstructionDoc = { definitions: Array<{ canonicalKey: string; definitionKind: string; schemaVersion?: number; payload: Record<string, any> }>; designerRulings?: string[]; deferred?: unknown[] };  

const table = (rows: Row[] | undefined, fields: string[]) => (rows ?? []).map((r) => [r.rankKey, ...fields.map((f) => r[f])]);
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Structural rules over ability-construction.json (§9–§16, §120–§127, §A1–§A9). */
export function auditWo5Content(doc: ConstructionDoc): string[] {
  const findings = new Set<string>();
  const add = (f: string) => findings.add(f);
  const rules = doc.definitions.filter((d) => d.definitionKind === "ABILITY_CONSTRUCTION_RULE");
  if (rules.length !== 1 || doc.definitions.length !== 1) add("rule-count");
  const p = rules[0]?.payload;
  if (p === undefined) return [...findings].sort();
  if (p.rankLadder !== "SKILL") add("ladder");

  const arcane = p.spell?.arcaneAuthority;
  if (arcane?.skillKey !== "skill.arcana" || arcane?.minimumRank !== "TRAINED") add("arcane-access"); // M5-I156
  if (!same(table(arcane?.ranks, ["effectCapacity", "traitCapacity"]), [["UNTRAINED", 0, 0], ["TRAINED", 1, 1], ["EXPERT", 2, 2], ["MASTER", 3, 3]])) add("arcane-capacity");
  if (!same(p.spell?.affinityAuthority, { capacitySource: "AFFINITY_RANK_RULE" })) add("affinity-capacity-duplicated");
  const cc = p.spell?.castingConditions;
  if (cc?.capacitySource !== "ARCANE_RANK" || !same(table(cc?.ranks, ["capacity"]), [["UNTRAINED", 0], ["TRAINED", 1], ["EXPERT", 2], ["MASTER", 3]])) add("casting-condition-capacity"); // M5-I157
  if (p.spell?.minimumEffects !== 1 || p.maneuver?.minimumEffects !== 1) add("minimum-effects");
  if (!same(p.spell?.traitExchange, { effectSlotsPerExchange: 1, traitSlotsPerExchange: 1, minimumEffectsRemaining: 1 })) add("spell-exchange");
  if (p.maneuver?.traitExchange !== null) add("maneuver-exchange");

  const martial = p.maneuver?.martial;
  if (martial?.skillKey !== "skill.martial" || martial?.minimumRank !== "TRAINED") add("martial-access"); // M5-I158
  if (!same(table(martial?.ranks, ["martialRankValue", "effectCapacity", "traitCapacity", "conditionCapacity"]), [["UNTRAINED", 0, 0, 0, 0], ["TRAINED", 1, 1, 1, 1], ["EXPERT", 2, 2, 2, 2], ["MASTER", 3, 3, 3, 3]])) add("martial-capacity");
  if (p.maneuver?.foundationRequired !== true) add("foundation");

  const sig = p.signature;
  if (sig?.capacityStatistic !== "SIGNATURE_ABILITY_SLOTS" || sig?.defaultSlotCost !== 1 || sig?.exemptSlotCost !== 0) add("signature-policy");
  if (!Array.isArray(sig?.exemptions) || sig.exemptions.some((x: { description?: unknown }) => typeof x.description !== "string" || x.description.length === 0)) add("signature-exemption");

  const formulas = p.formulas ?? {};
  if (!same(Object.keys(formulas), ["remainingEffects", "effectiveTraits", "maximumTrades", "signatureProjected", "signatureAvailable"])) add("formulas");
  if (formulas.maximumTrades?.minimum !== 0) add("trade-floor");

  const conflicts: string[] = p.source?.conflicts ?? [];
  for (const k of ["M5-SC-011", "M5-SC-015", "M5-SC-017", "M5-SC-021", "M5-SC-022", "M5-SC-025"]) if (!conflicts.includes(k)) add("conflict-citation");
  if (!Array.isArray(p.source?.locators) || p.source.locators.length === 0) add("source-locators");
  if (!Array.isArray(doc.designerRulings) || doc.designerRulings.length < 8) add("designer-rulings");
  return [...findings].sort();
}
