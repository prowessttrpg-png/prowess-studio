import ts from "typescript";

export type Layer = "engine" | "resolver" | "http" | "ui";
/** Parse imports/calls/branches rather than scanning comments or prose. Controls mutate complete source snapshots. */
export function auditSource(source: string, file: string, layer: Layer): string[] {
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, file.endsWith("tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const findings = new Set<string>();
  const add = (name: string) => findings.add(name);
  const mechanics = /^(evaluateFormula|evaluateRequirement|evaluateModifiers|spendResource|restoreResource|setResourceCurrent|reserveResourceCapacity|releaseResourceCapacity|refreshResource|previewResourcePayment|applyResourcePayment|evaluateValidation|buildExplanation|projectExplanation|orchestrateRulesEvaluation)$/;
  const arithmetic = new Set([ts.SyntaxKind.PlusToken, ts.SyntaxKind.MinusToken, ts.SyntaxKind.AsteriskToken, ts.SyntaxKind.SlashToken, ts.SyntaxKind.PercentToken, ts.SyntaxKind.AsteriskAsteriskToken]);
  const visit = (node: ts.Node): void => {
    if (layer === "engine" && ts.isVariableStatement(node) && node.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword)) {
      for (const declaration of node.declarationList.declarations) {
        let value = declaration.initializer;
        while (value && ts.isAsExpression(value)) value = value.expression;
        if (value && (ts.isArrayLiteralExpression(value) || ts.isObjectLiteralExpression(value))) add("mutable-contract");
      }
    }
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const name = node.moduleSpecifier.text;
      if (layer === "engine" && !name.startsWith(".") && name !== "@prowess/model") add("package-boundary");
      if (layer === "ui" && /@prowess\/db|prisma|@prowess\/import/.test(name)) add("persistence");
      if (layer === "ui" && name === "@prowess/rules" && !node.importClause?.isTypeOnly) {
        const bindings = node.importClause?.namedBindings;
        if (!bindings || !ts.isNamedImports(bindings) || node.importClause?.name) add("browser-engine");
        else for (const item of bindings.elements) if (!item.isTypeOnly && !["EVALUATION_OPERATIONS", "EVALUATION_CONTEXT_FAMILIES"].includes((item.propertyName ?? item.name).text)) add("browser-engine");
      }
    }
    if (ts.isIdentifier(node)) {
      const name = node.text;
      if (/^(effectiveCost|netCost|adjustedCost|discountedCost|reducedCost)$/i.test(name)) add("effective-cost");
      if (/getLatest|latestManifest|latestRelease|resolveCurrent|currentRuleset|currentVersion|activeRuleset|defaultRuleset|mostRecent/i.test(name)) add("implicit-selection");
      if (layer === "engine" && /^(lastEvaluation|currentContext|evaluatorCache|operationRegistry)$/.test(name)) add("global-state");
    }
    if (ts.isIfStatement(node) || ts.isSwitchStatement(node) || ts.isConditionalExpression(node)) {
      const condition = ts.isIfStatement(node) || ts.isSwitchStatement(node) ? node.expression : node.condition;
      const code = condition.getText(ast);
      if (/\b(Spell|Mana|MP|ME|AP|Affinity|Weapon|Armor|STR|AGI|CON|PER|PRO|RES|Trained|Expert|Master|Fire)\b/.test(code)) add("game-branch");
    }
    if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
      const name = node.expression.getText(ast);
      if (/^(eval|Function)$/.test(name) || name === "import") add("dynamic-code");
      if (/^(Math\.random|Date\.now|Date|crypto\.randomUUID|randomUUID|performance\.now|fetch|WebSocket|XMLHttpRequest)$/.test(name) && layer === "engine") add("environment");
      if (/localeCompare|toLocale|Intl\./.test(name) && layer !== "ui") add("locale");
      if (/^(Math\.(floor|ceil|round|trunc|fround))$|\.toFixed$|\.toPrecision$/.test(name) && !(file.endsWith("formula/evaluate.ts") && /^Math\.(floor|ceil)$/.test(name))) add("hidden-rounding");
      if (/registerOperation|registerEvaluator/.test(name)) add("dynamic-code");
      if (/\$executeRaw|^prisma\..*\.(create|update|upsert|delete)(Many)?$|saveEvaluation|persistEvaluation/.test(name) && ["engine", "resolver", "http", "ui"].includes(layer)) add("database-write");
      if (mechanics.test(name) && layer === "ui") add("browser-engine");
      if (mechanics.test(name) && file.includes("/explanation/")) add("explanation-recalculation");
      if (mechanics.test(name) && layer === "http" && name !== "orchestrateRulesEvaluation") add("http-mechanics");
    }
    if (ts.isBinaryExpression(node) && arithmetic.has(node.operatorToken.kind)) {
      const code = node.getText(ast);
      if (layer === "ui" && !/^(index|id|rulesetPage|recordPage|value) \+ 1$|^a\.order - b\.order$/.test(code)) add("browser-arithmetic");
      if (file.endsWith("orchestration/pointer.ts") && /\bvalue\b|resolvedValue|copiedValue/.test(code)) add("binding-arithmetic");
    }
    node.forEachChild(visit);
  };
  visit(ast);
  if (file.endsWith("orchestration/orchestrate.ts")) {
    const dispatch = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "dispatch");
    if (!dispatch || !ts.isFunctionDeclaration(dispatch) || !dispatch.body) add("dispatcher");
    else {
      const statement = dispatch.body.statements.find(ts.isSwitchStatement);
      const projection = statement?.caseBlock.clauses.find(node => ts.isCaseClause(node) && ts.isStringLiteral(node.expression) && node.expression.text === "EXPLANATION_PROJECT");
      if (!projection || projection.statements.length !== 1 || projection.statements[0]?.getText(ast) !== "return projectExplanation(input.document, input.level as ExplanationLevel);") add("projection-rebuild");
    }
    if (/\.satisfied\s*===\s*false|\.canPay\s*===\s*false/.test(source)) add("business-auto-block");
  }
  return [...findings].sort();
}
