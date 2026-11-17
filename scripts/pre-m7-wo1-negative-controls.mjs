/** PRE-M7-WO1 mutation matrix (CLOSEOUT-03 harness). Each control mutates one uniquely anchored REAL source location; the
 * intended guard must fail for the named reason, and every file is restored byte-for-byte. Covers the guided Formula's
 * losslessness (01, 02), the neutral removal (03), the server's request validation (04), the guided descriptors' exact
 * key sets (05), the read-only Rules Reference (06) and the preview route's body allow-list (07). */
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { applyEdits, runControls, vitestGuard } from "./lib/control-harness.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const options = { timeout: 600_000, ciEnv: false };
const formula = vitestGuard(root, "packages/prowess-db", ["--config", "vitest.unit.config.ts", "tests/unit/pre-m7-wo1-formula-guide.test.ts", "--maxWorkers=1", "--reporter=dot"], options);
const descriptors = vitestGuard(root, "apps/studio", ["tests/unit/pre-m7-wo1-descriptors.test.ts", "--maxWorkers=1", "--reporter=dot"], options);
const gate = vitestGuard(root, "apps/studio", ["tests/unit/pre-m7-wo1-static.test.ts", "--maxWorkers=1", "--reporter=dot"], options);

const PRES = "packages/prowess-db/src/compendium-rules/formula-presentation.ts";
const GUIDE = "packages/prowess-db/src/compendium-rules/formula-guide.ts";
const DESC = "apps/studio/app/compendium/admin/_lib/descriptors.ts";
const STAT = "apps/studio/app/compendium/rulesets/_components/StatAffectsPage.tsx";
const PREVIEW = "apps/studio/app/api/compendium-rules/preview/route.ts";

const rows = [
  ["01 the printer drops right-operand parentheses (a - (b + c) → a - b + c)", PRES, [["const r = precedenceOf(n.right) <= p ? `(${right})` : right;", "const r = precedenceOf(n.right) < p ? `(${right})` : right;"]], formula, /prints back to the same AST/],
  ["02 the guided view stops checking that it is lossless", PRES, [["if (!rebuilt.ok || !sameAst(rebuilt.ast, parsed.ast)) return", "if (!rebuilt.ok) return"]], formula, /lossless/],
  ["03 removing every contribution leaves an empty expression instead of the neutral 0", PRES, [['if (terms.length === 0) return "0";', 'if (terms.length === 0) return "";']], formula, /neutral 0/],
  ["04 a contribution's sign is no longer validated", GUIDE, [['if (!isSign(t.sign)) throw invalid(`terms[${i}].sign is 1 or -1`);', ""]], formula, /Studio operations/],
  ["05 the Creature Size editor loses a key the M5 reader requires", DESC, [['      { key: "orLarger", label: "This size or larger", group: "Space", input: "boolean", required: true },\n', ""]], descriptors, /exactly the stored payload keys/],
  ["06 the Rules Reference Stat page creates the Draft itself", STAT, [["import { getStatImpacts,", "import { createRevision } from \"../../admin/_lib/authoring-client\";\nimport { getStatImpacts,"]], gate, /GET-only/],
  ["07 the preview route accepts unknown body fields", PREVIEW, [['    if (unknown.length > 0) throw new ApiError("API.INVALID_BODY", `Unknown field(s): ${unknown.join(", ")}`, 400);\n', ""]], gate, /POST-with-body tools/],
];

runControls({
  root,
  title: "PRE-M7-WO1",
  controls: rows.map(([name, file, edits, guard, intended]) => ({
    name,
    file,
    mutate: applyEdits(name, edits),
    guard,
    expect: new RegExp(`(?:AssertionError|expected|FAIL)[\\s\\S]*${intended.source}|${intended.source}[\\s\\S]*(?:AssertionError|expected|FAIL)`, "i"),
  })),
  caught: (name) => `Caught and restored: ${name}`,
  done: (count) => `All ${count} PRE-M7-WO1 controls caught and restored.`,
});
