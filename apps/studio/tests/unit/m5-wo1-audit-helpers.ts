import ts from "typescript";

/**
 * M5-WO1 static architecture audit (PAS-10 M5-WO1 §213) — parses TypeScript rather than grepping prose, so comments
 * and documentation never trip a rule and controls can mutate complete source snapshots.
 *
 *   game         — @prowess/game production source (pure Prowess domain)
 *   rules        — @prowess/rules production source (generic M4 — must hold no Prowess logic)
 *   materializer — @prowess/db exact Definition materializer (server data code)
 *   source       — the M3 source / import pipeline (historical wording is never rewritten)
 */
export type M5Layer = "game" | "rules" | "materializer" | "source";

const SHAPES = new Set(["SELF", "TOUCH", "SINGLE_TARGET", "MULTI_TARGET", "LINE", "CONE", "RADIUS", "ZONE", "AURA", "TRIGGERED", "ANCHOR"]);
const STATS = /^(STR|AGI|CON|PER|RES|PRO|STRENGTH|AGILITY|CONSTITUTION|PERCEPTION|RESOLVE|PROWESS)$/i;
const ARITHMETIC = new Set([
  ts.SyntaxKind.PlusToken,
  ts.SyntaxKind.MinusToken,
  ts.SyntaxKind.AsteriskToken,
  ts.SyntaxKind.SlashToken,
  ts.SyntaxKind.PercentToken,
  ts.SyntaxKind.AsteriskAsteriskToken,
  ts.SyntaxKind.PlusEqualsToken,
  ts.SyntaxKind.MinusEqualsToken,
  ts.SyntaxKind.AsteriskEqualsToken,
  ts.SyntaxKind.SlashEqualsToken,
]);
const PROWESS_IN_M4 = /evocation|emission|conjuration|transmutation|divination|affinit|spell|maneuver|summon|mage_?art|cantrip|prowess_?score|mana_?lock|martial|arcana/i;
const LATEST = /getLatest|^latest|latest[A-Z]|newest|mostRecent|getCurrent|^current(Version|Effect|Definition|Targeting|Trait|Affinity|Ruleset)|^active(Targeting|Ruleset|Definition|Trait|Affinity)/i;

const literalText = (node: ts.Node): string | null => (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) ? node.text : null);

export function auditM5Source(source: string, file: string, layer: M5Layer): string[] {
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const findings = new Set<string>();
  const add = (finding: string) => findings.add(finding);
  const isTerminology = file.endsWith("vocabulary/terminology.ts");
  const isContracts = file.endsWith("construction/contracts.ts");
  const legalityFile = /construction\/composition\.ts$|bundle\/bundle\.ts$|compilation\/|definition\/envelope\.ts$/.test(file);
  const identityOnly = /definition\/envelope\.ts$/.test(file);
  const infrastructure = /\/internal\//.test(file);

  const visit = (node: ts.Node): void => {
    // ---- imports -------------------------------------------------------------------------------------------------
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const name = node.moduleSpecifier.text;
      if (layer === "game" && !name.startsWith(".") && !["@prowess/model", "@prowess/rules"].includes(name)) add("package-boundary");
      if (layer === "materializer" && !name.startsWith(".") && !["@prowess/model", "@prowess/rules", "@prowess/game"].includes(name)) add("package-boundary");
      if (layer === "rules" && /@prowess\/game/.test(name)) add("prowess-logic-in-m4");
      node.forEachChild(visit);
      return;
    }

    // ---- identifiers -----------------------------------------------------------------------------------------------
    if (ts.isIdentifier(node)) {
      const name = node.text;
      if (LATEST.test(name) && (layer === "game" || layer === "materializer")) add("latest-or-current");
      if (layer === "game" && /^(SourceDocument\w*|SourceSnapshot\w*|parseDocx\w*|rawText|ExtractionCandidate\w*|ImportCandidate\w*|ImportBatch\w*)$/.test(name)) add("source-parsing");
      if (layer === "game" && /^(finalAp|finalMp|apCost|mpCost|totalCost|effectiveCost|listedMp|spellAp|maneuverAp|apFromMp)$/i.test(name)) add("hidden-math");
      if ((layer === "game" || layer === "materializer") && /^(displayName|byName|findByName|lookupByName|display_name)$/.test(name)) add("display-name-identity");
      if (layer === "game" && /^(appliesStatus|applyStatus|appliedStatus|statusEffect|inflicts\w*)$/.test(name)) add("condition-status-collapse");
      if (layer === "game" && /^(register\w+|\w*Registry)$/.test(name)) add("dynamic-dispatch");
      if (layer === "rules" && PROWESS_IN_M4.test(name)) add("prowess-logic-in-m4");
      if ((layer === "game" || layer === "materializer") && /^(publish\w*|approve\w*|\w*CanonDecision\w*|canonDecision\w*|\w*CanonPolicy\w*|canonPolicy\w*|createRulesetRelease\w*|transition\w*Status|\w*ImportDecision\w*|reviewCandidate\w*)$/.test(name)) add("canon-governance");
      if (layer === "game" && legalityFile && /^(componentContractOf|implementSameContract|shareTargetingSemanticShape)$/.test(name)) add("cross-branch-coercion");
    }

    // ---- string literals -----------------------------------------------------------------------------------------
    const text = literalText(node);
    if (text !== null) {
      if (layer === "game" && !isTerminology && /(^|[^a-z])emission([^a-z]|$)/i.test(text)) add("legacy-canonical");
      if (layer === "rules" && PROWESS_IN_M4.test(text)) add("prowess-logic-in-m4");
      if (layer === "source" && /emission|evocation/i.test(text)) add("source-rewrite");
    }
    if (ts.isRegularExpressionLiteral(node) && layer === "source" && /emission|evocation/i.test(node.text)) add("source-rewrite");

    // ---- property access -------------------------------------------------------------------------------------------
    if (ts.isPropertyAccessExpression(node)) {
      const prop = node.name.text;
      if (layer === "game" && prop === "weapon") add("kind-inference");
      if (layer === "game" && legalityFile && !identityOnly && prop === "contract") add("cross-branch-coercion");
      if (layer === "game" && legalityFile && prop === "semanticShape") add("cross-branch-coercion");
      if (layer === "game" && !isContracts && prop === "semanticShape" && !legalityFile) add("shape-implies-mechanics");
    }

    // ---- property assignments ------------------------------------------------------------------------------------
    if (ts.isPropertyAssignment(node) || ts.isShorthandPropertyAssignment(node)) {
      const name = node.name.getText(ast).replace(/["']/g, "");
      const init = ts.isPropertyAssignment(node) ? literalText(node.initializer) : null;
      if (layer === "game" && /^(appliesStatus|applyStatus|appliedStatus|statusEffect|inflicts\w*)$/.test(name)) add("condition-status-collapse");
      if (layer === "game" && /^save(Stat|Type)?$/i.test(name) && init !== null && STATS.test(init)) add("implied-resolution");
      if (layer === "game" && name === "effectFamily" && init !== null) add("catalog-content-in-code");
      if (layer === "materializer" && name === "orderBy" && /createdAt|revisionNumber|desc/.test(node.getText(ast))) add("latest-or-current");
    }

    // ---- calls ---------------------------------------------------------------------------------------------------
    if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
      const callee = node.expression.getText(ast);
      if (/^(eval|Function|require)$/.test(callee) || node.expression.kind === ts.SyntaxKind.ImportKeyword) add("dynamic-code");
      if (/^(Math\.random|Date\.now|Date|crypto\.\w+|randomUUID|performance\.now|fetch|setTimeout|setInterval)$/.test(callee) && layer !== "source") add("environment");
      if (/localeCompare|toLocale|^Intl\./.test(callee) && layer !== "source") add("environment");
      if (layer === "game" && /^Math\.\w+$/.test(callee)) add("hidden-math");
      if (layer === "materializer" && /compileProwessAbility|assembleCompiledPlan/.test(callee)) add("materializer-compiles");
      if (layer === "materializer" && /\$executeRaw|\$queryRaw|\.(create|update|upsert|delete)(Many)?$|\.findFirst$/.test(callee)) add(/findFirst/.test(callee) ? "latest-or-current" : "database-write");
      if (layer === "materializer" && /resolveEntityVersion|resolveEffectiveEntityVersion|getEffectiveManifestEntries/.test(callee)) add("materializer-resolves");
    }

    // ---- binary expressions --------------------------------------------------------------------------------------
    if (ts.isBinaryExpression(node)) {
      const op = node.operatorToken.kind;
      if (layer === "game" && !infrastructure && ARITHMETIC.has(op)) add("hidden-math");
      if (op === ts.SyntaxKind.EqualsEqualsEqualsToken || op === ts.SyntaxKind.ExclamationEqualsEqualsToken || op === ts.SyntaxKind.EqualsEqualsToken) {
        for (const side of [node.left, node.right]) {
          const lit = literalText(side);
          if (layer === "game" && lit !== null && SHAPES.has(lit)) add("shape-implies-mechanics");
          if (layer === "game" && lit !== null && /^keyword\./.test(lit)) add("keyword-mechanics");
          if (layer === "rules" && lit !== null && PROWESS_IN_M4.test(lit)) add("prowess-logic-in-m4");
        }
        if (layer === "game" && /typeof\s/.test(node.left.getText(ast)) && literalText(node.right) === "function") add("dynamic-dispatch");
      }
      if (layer === "game" && op === ts.SyntaxKind.EqualsToken && /save(Stat|Type)?$/i.test(node.left.getText(ast))) add("implied-resolution");
      if (layer === "game" && op === ts.SyntaxKind.InKeyword && /^(weapon\w*|mp\w*|ap\w*|spell\w*|maneuver\w*|casting\w*|martial\w*|arcana\w*|foundation|effectChain|sustain|concentration)$/i.test(literalText(node.left) ?? "")) add("kind-inference");
    }
    if ((ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) && layer === "game" && !infrastructure && [ts.SyntaxKind.PlusPlusToken, ts.SyntaxKind.MinusMinusToken].includes(node.operator)) add("hidden-math");
    if (ts.isCaseClause(node) && layer === "game") {
      const lit = literalText(node.expression);
      if (lit !== null && SHAPES.has(lit)) add("shape-implies-mechanics");
    }
    if (ts.isConditionalExpression(node) && layer === "game") {
      const outcomes = [literalText(node.whenTrue), literalText(node.whenFalse)];
      if (outcomes.some((o) => o === "SPELL" || o === "MANEUVER")) add("kind-inference");
    }

    // ---- module state --------------------------------------------------------------------------------------------
    if (ts.isVariableStatement(node) && node.parent === ast && layer === "game") {
      if (!(node.declarationList.flags & ts.NodeFlags.Const)) add("mutable-module-state");
      for (const d of node.declarationList.declarations) if (d.initializer && ts.isNewExpression(d.initializer) && /^(Map|Set|WeakMap|WeakSet)$/.test(d.initializer.expression.getText(ast))) add("mutable-module-state");
    }
    node.forEachChild(visit);
  };
  visit(ast);
  return [...findings].sort();
}
