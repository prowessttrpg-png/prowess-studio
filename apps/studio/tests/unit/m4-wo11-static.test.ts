// @vitest-environment node
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { frozenFileContent, frozenSchemaText, notLaterMigration } from "./later-milestone-schema";

const root = path.resolve(process.cwd(), "../..");
const read = (file: string) => readFileSync(path.join(root, file), "utf8");
const walk = (dir: string): string[] => readdirSync(path.join(root, dir)).flatMap(name => {
  const file = `${dir}/${name}`;
  return statSync(path.join(root, file)).isDirectory() ? walk(file) : [file];
});
const ui = walk("apps/studio/app/developer/rules").filter(file => /\.tsx?$/.test(file));
const files = [...ui, "apps/studio/src/api-client/rules.ts"];
const strip = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
function audit(source: string): string[] {
  const text = strip(source); const failures: string[] = [];
  const patterns: Record<string, RegExp> = {
    persistence: /@prowess\/db|@prisma|\bPrismaClient\b|generated\/prisma|@prowess\/import|\$executeRaw|localStorage|sessionStorage|indexedDB/,
    primitive: /\b(evaluateFormula|evaluateRequirement|evaluateModifiers|applyResourcePayment|previewResourcePayment|evaluateValidation|buildExplanation|projectExplanation|orchestrateRulesEvaluation)\s*\(/,
    rounding: /Math\.|toFixed\s*\(|toPrecision\s*\(/,
    latest: /getLatest|getCurrentRuleset|\/latest\b|latestRelease|activeRuleset|defaultRuleset/,
    game: /\b(if|switch)\s*\([^)]*\b(Spell|Mana|MP|ME|AP|Affinity|Weapon|STR|Expert)\b/i,
    effective: /effectiveCost|netCost|adjustedCost|listedAmount\s*[-+*/]|temporaryPayment\s*[-+*/]/i,
    network: /\bfetch\s*\(|XMLHttpRequest|WebSocket|EventSource|https?:\/\//,
    businessBlocking: /if\s*\([^)]*(satisfied|canPay)\s*===\s*false[^)]*\)\s*(return|throw|hide|block)|canPay\s*===\s*false[^\n]*(Request Error|requestFailure|throw)/,
  };
  for (const [key, pattern] of Object.entries(patterns)) if (pattern.test(text)) failures.push(key);
  const ast = ts.createSourceFile("source.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const arithmetic = new Set([ts.SyntaxKind.PlusToken, ts.SyntaxKind.MinusToken, ts.SyntaxKind.AsteriskToken, ts.SyntaxKind.SlashToken, ts.SyntaxKind.PercentToken, ts.SyntaxKind.AsteriskAsteriskToken]);
  const inspect = (node: ts.Node) => {
    if (ts.isBinaryExpression(node) && arithmetic.has(node.operatorToken.kind)) {
      const expression = node.getText(ast);
      // Presentation identity/paging counters and the approved display-order comparison only.
      if (!/^(index|id|rulesetPage|recordPage|value) \+ 1$|^a\.order - b\.order$/.test(expression)) failures.push("arithmetic");
    }
    node.forEachChild(inspect);
  };
  inspect(ast);
  ast.forEachChild(node => {
    if (!ts.isImportDeclaration(node) || !ts.isStringLiteral(node.moduleSpecifier)) return;
    const specifierName = node.moduleSpecifier.text;
    if (specifierName.startsWith("@prowess/rules/")) failures.push("internal-import");
    if (specifierName !== "@prowess/rules" || node.importClause?.isTypeOnly) return;
    const bindings = node.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings) || node.importClause?.name) failures.push("engine-import");
    else for (const specifier of bindings.elements) if (!specifier.isTypeOnly && !["EVALUATION_OPERATIONS", "EVALUATION_CONTEXT_FAMILIES"].includes((specifier.propertyName ?? specifier.name).text)) failures.push("engine-import");
  });
  return failures;
}

describe("WO11 static audit — M4-I163–I188 presentation integrity", () => {
  it.each(files)("%s: presentation-only imports, no local mechanics, rounding, latest selection, network or persistence", file => {
    expect(audit(read(file)), file).toEqual([]);
  });
  it.each([
    ["Math.floor(17 / 4)", "rounding"],
    ["const localResult = 17 / 4;", "arithmetic"],
    ["effectiveCost = listedAmount - temporaryPayment", "effective"],
    ['import { prisma } from "@prowess/db"', "persistence"],
    ['import { PrismaClient } from "generated/prisma/client"', "persistence"],
    ['const selected = getLatestRelease(rulesetId)', "latest"],
    ['if (keyword === "Fire" && stat === "MP") boost()', "game"],
    ['if (response.satisfied === false) hideSteps()', "businessBlocking"],
    ['if (response.canPay === false) throw new Error("Request Error")', "businessBlocking"],
    ['buildExplanation(result)', "primitive"],
    ['projectExplanation(result, "SUMMARY")', "primitive"],
    ['import { evaluateFormula as local } from "@prowess/rules"; local(x)', "engine-import"],
    ['fetch("/api/rules/save", { method: "POST" })', "network"],
  ])("negative control %s is rejected (%s)", (source, finding) => expect(audit(source)).toContain(finding));
  it("M4-I163/I166/I185: exact one evaluation endpoint and original request types, no forged context fields", () => {
    const client = read("apps/studio/src/api-client/rules.ts");
    expect(client.match(/apiPost<RulesEvaluationResponse>\("\/api\/rules\/evaluate", request\)/g)).toHaveLength(1);
    expect(client).toContain('import type { RulesEvaluationRequest, RulesetSelector } from "../rules-evaluation/service"');
    expect(read("apps/studio/app/developer/rules/_components/lab.tsx")).toContain('ruleset: mode === "MANIFEST" ? { kind: "MANIFEST", manifestId: exactId } : { kind: "RELEASE", releaseId: exactId }');
    expect(read("apps/studio/app/developer/rules/_components/lab.tsx")).not.toMatch(/resolvedRulesetContext|manifestHash\s*:/);
  });
  it("M4-I167/I168/I169/I170: generic JSON authoring, closed vocabulary and code-unit order preview", () => {
    const lab = read("apps/studio/app/developer/rules/_components/lab.tsx");
    expect(lab).toContain("EVALUATION_OPERATIONS.map");
    expect(lab).toContain("ordered.slice(0, editingPosition)");
    expect(lab).toContain('step.operation === (field === "validationStepKey" ? "VALIDATION" : "EXPLANATION")');
    expect(read("apps/studio/app/developer/rules/_lib/editor.ts")).toContain("a.order - b.order");
    expect(lab).not.toMatch(/transform|rounding\s*\(/);
  });
  it("M4-I171–I182/I184: rule statuses and exact fields remain distinct from transport errors and stale snapshots", () => {
    const views = read("apps/studio/app/developer/rules/_components/views.tsx");
    for (const token of ["NOT SATISFIED", "SKIPPED_CONDITION", "Payment unavailable", "Capacity Reserved", "LISTED VALUE", "THIS PAYMENT", "message.severity", "message.code", "message.path", "node.sourceTracePath", "node.ordinal", '["provenance", "Rule Provenance"]']) expect(views).toContain(token);
    const lab = read("apps/studio/app/developer/rules/_components/lab.tsx");
    for (const token of ["Run execution", "Orchestration RuleEngine status", "executionStatus", "STALE", "snapshotRequest", "explanationStepKey", "EXPLANATION_PROJECT"]) expect(lab).toContain(token);
    expect(lab).toContain("revision !== runRevision");
    expect(lab.match(/await runRulesEvaluation\(sent\)/g)).toHaveLength(1);
  });
  it("M4-I186/I187/I188: Developer route only, responsive panes, exact numeric fields, accessible controls", () => {
    expect(read("apps/studio/app/developer/page.tsx")).toContain('href="/developer/rules"');
    for (const file of walk("apps/studio/app/compendium").filter(file => /\.tsx?$/.test(file))) expect(read(file)).not.toContain("/developer/rules");
    const css = read("apps/studio/app/globals.css");
    for (const token of ["max-width: 899px", 'data-pane="PLAN"', 'data-pane="RUN"', 'data-pane="DETAILS"', "overflow: auto", ":focus-visible"]) expect(css).toContain(token);
    const lab = read("apps/studio/app/developer/rules/_components/lab.tsx");
    expect(lab).toContain('role="tablist"'); expect(lab).toContain("aria-selected"); expect(lab).toContain('aria-live="polite"');
  });
  it("no schema or migration change; exact baseline hash stays pinned", () => {
    const baseline = JSON.parse(read("docs/architecture/m4-wo11-baseline.json")) as { schemaHash: string; migrations: Record<string, string> };
    const hash = (source: string) => createHash("sha256").update(source).digest("hex");
    expect(hash(frozenSchemaText())).toBe(baseline.schemaHash);
    const migrations = walk("packages/prowess-db/prisma/migrations").filter(file => file.endsWith("migration.sql")).filter(notLaterMigration);
    expect(Object.fromEntries(migrations.map(file => [file, hash(read(file))]))).toEqual(baseline.migrations);
    expect(read(".github/workflows/ci.yml")).toContain("M4-WO11 audit gate — Rules Inspector presentation integrity");
  });
  it("M4-I163–I188 are individually catalogued and mapped to existing automated guards", () => {
    const catalog = JSON.parse(read("docs/architecture/m4-wo11-invariants.json")) as Array<{ id: string; guards: string[] }>;
    expect(catalog.map(entry => entry.id)).toEqual(Array.from({ length: 26 }, (_, index) => `M4-I${163 + index}`));
    const doc = read("docs/architecture/m4-rules-engine-core.md");
    for (const entry of catalog) {
      expect(doc).toContain(`**${entry.id}**`);
      expect(entry.guards.length).toBeGreaterThan(0);
      for (const file of entry.guards) expect(read(file)).toContain("M4-I");
    }
    expect(doc).toContain("**M4-I162A**");
  });
});

describe("M4-I162A WO10A static projection boundary", () => {
  const exact = "return projectExplanation(input.document, input.level as ExplanationLevel);";
  const projectionBody = (source: string) => strip(source).split('case "EXPLANATION_PROJECT":')[1]?.split(/\n\s*case |\n\s*}/)[0]?.trim();
  it("only WO9 projection is called — no rebuild, rules, arithmetic, rounding or persistence", () => {
    expect(projectionBody(read("packages/prowess-rules/src/orchestration/orchestrate.ts"))).toBe(exact);
  });
  it.each(["buildExplanation(input.document, options)", "evaluateFormula(input.document)", "evaluateRequirement(input.document)", "evaluateModifiers(input.document)", "applyResourcePayment(input.document)", "evaluateValidation(input.document)", "Math.floor(input.value)", "prisma.create(input.document)", "projectExplanation(input.document, input.level * 2)"])("negative control %s is caught", call => {
    expect(projectionBody(`case "EXPLANATION_PROJECT":\n return ${call};\n }`)).not.toBe(exact);
  });
});
