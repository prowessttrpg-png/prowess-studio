import ts from "typescript";

/** Compare syntax, ignoring comments/spacing and quote choice, without interpreting any game rule. */
export function syntaxTokens(text: string): string {
  const scan = ts.createScanner(ts.ScriptTarget.Latest, true, ts.LanguageVariant.Standard, text);
  const out: [number, string][] = [];
  for (let token = scan.scan(); token !== ts.SyntaxKind.EndOfFileToken; token = scan.scan()) {
    out.push([token, token === ts.SyntaxKind.StringLiteral ? scan.getTokenValue() : scan.getTokenText()]);
  }
  return JSON.stringify(out);
}
export const syntaxIs = (node: ts.Node, text: string) => syntaxTokens(node.getText()) === syntaxTokens(text);
export const parseSource = (file: string, text: string) => ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
export function descendants<T extends ts.Node>(root: ts.Node, predicate: (node: ts.Node) => node is T): T[] {
  const out: T[] = [];
  const visit = (node: ts.Node) => { if (predicate(node)) out.push(node); ts.forEachChild(node, visit); };
  visit(root); return out;
}
export function exactlyOne<T>(items: T[], label: string): T {
  if (items.length !== 1) throw new Error(`Expected exactly one ${label}; found ${items.length}`);
  return items[0]!;
}
export const namedFunction = (root: ts.Node, name: string) => exactlyOne(descendants(root, ts.isFunctionDeclaration).filter(n => n.name?.text === name), `function ${name}`);
export const namedVariable = (root: ts.Node, name: string) => exactlyOne(descendants(root, ts.isVariableDeclaration).filter(n => ts.isIdentifier(n.name) && n.name.text === name), `variable ${name}`);
export const callsNamed = (root: ts.Node, expression: string) => descendants(root, ts.isCallExpression).filter(n => syntaxIs(n.expression, expression));

/** The full Maneuver frontend stays covered, including its formatters and Sheet rows. Ordering arithmetic is allowed;
 * arithmetic consuming a mechanical field (including aliases) and domain/runtime imports or execution are not. */
export function maneuverUiFindings(file: string, text: string): string[] {
  const root = parseSource(file, text), found = new Set<string>();
  const mechanical = /^(baseApCost|baseMpCost|finalApCost|finalMpCost|protectedActionAp|appliedConditionFloor|postConditionApCost|effectiveApReduction|conditionMpReduction|preparationAp|mpReduction|maximumActionBlocks|effectCapacity|traitCapacity|conditionCapacity|capacity)$/;
  const aliases = new Set<string>();
  const mechanicalInput = (node: ts.Node): boolean => descendants(node, (n): n is ts.Identifier | ts.StringLiteral => ts.isIdentifier(n) || ts.isStringLiteral(n)).some(n => mechanical.test(n.text) || aliases.has(n.text));
  const variables = descendants(root, ts.isVariableDeclaration);
  for (let pass = 0; pass < variables.length; pass += 1) {
    let changed = false;
    for (const n of variables) if (ts.isIdentifier(n.name) && n.initializer && mechanicalInput(n.initializer) && !aliases.has(n.name.text)) { aliases.add(n.name.text); changed = true; }
    if (!changed) break;
  }
  const arithmetic = new Set([ts.SyntaxKind.PlusToken, ts.SyntaxKind.MinusToken, ts.SyntaxKind.AsteriskToken, ts.SyntaxKind.SlashToken, ts.SyntaxKind.PercentToken, ts.SyntaxKind.AsteriskAsteriskToken]);
  for (const n of descendants(root, ts.isBinaryExpression)) {
    if (arithmetic.has(n.operatorToken.kind) && mechanicalInput(n) && !(n.operatorToken.kind === ts.SyntaxKind.PlusToken && (ts.isStringLiteral(n.left) || ts.isStringLiteral(n.right)))) found.add("client-mechanical-arithmetic");
  }
  for (const n of descendants(root, ts.isCallExpression)) {
    if (syntaxIs(n.expression, "fetch") || /^Math\./.test(n.expression.getText())) found.add("client-mechanical-authority");
    if (/^(executeAbilityResolution|resolveEffectChain|spendAp|spendMp|spendMe|rollDice|createActiveEffect|activateManeuver)$/.test(n.expression.getText())) found.add("live-combat-execution");
    if (n.expression.kind === ts.SyntaxKind.ImportKeyword && n.arguments[0] && ts.isStringLiteral(n.arguments[0]) && /^(@prowess\/(game|rules|db)|@prisma\/client)/.test(n.arguments[0].text)) found.add("client-domain-import");
  }
  for (const n of descendants(root, ts.isFunctionDeclaration)) if (n.name && /^(spendAp|spendMp|spendMe|rollDice|activateManeuver)$/.test(n.name.text)) found.add("live-combat-execution");
  for (const n of descendants(root, (n): n is ts.ImportDeclaration | ts.ExportDeclaration => ts.isImportDeclaration(n) || ts.isExportDeclaration(n))) {
    if (n.moduleSpecifier && ts.isStringLiteral(n.moduleSpecifier) && /^(@prowess\/(game|rules|db)|@prisma\/client)/.test(n.moduleSpecifier.text)) found.add("client-domain-import");
  }
  return [...found].sort();
}
