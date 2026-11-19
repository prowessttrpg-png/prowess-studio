/** RULES-WO1 mutation matrix (CLOSEOUT-03 harness). Each control mutates one uniquely anchored REAL source location; the
 * intended guard must fail for the named reason, and every file is restored byte-for-byte. Covers the additive kind
 * registration (01), M4-only arithmetic (02), no invented base (03), missing inputs never 0 (04), the canon note (05),
 * the cycle refusal (06), play not reading the Concentration rule (07), the "preview only" statement (08), the sheet's
 * test-value label (09) and build identity reaching Studio (10). */
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { applyEdits, runControls, vitestGuard } from "./lib/control-harness.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const options = { timeout: 600_000, ciEnv: false };
const gate = vitestGuard(root, "apps/studio", ["tests/unit/rules-wo1-static.test.ts", "--maxWorkers=1", "--reporter=dot"], options);
const ui = vitestGuard(root, "apps/studio", ["tests/unit/rules-wo1-authoring-ui.test.tsx", "--maxWorkers=1", "--reporter=dot"], options);
const game = vitestGuard(root, "packages/prowess-game", ["src/rules-wo1-authoring.test.ts", "--maxWorkers=1", "--reporter=dot"], options);

const FAMILIES = "packages/prowess-game/src/vocabulary/families.ts";
const VALUES = "packages/prowess-game/src/character/calculated-values.ts";
const READER = "packages/prowess-game/src/definition/rules-authoring-payload.ts";
const ENGINE = "packages/prowess-game/src/play/engine.ts";
const PANEL = "apps/studio/app/compendium/admin/_components/AuthoredRulePreviewPanel.tsx";
const SHEET = "apps/studio/app/characters/_components/sheet/SheetPanels.tsx";
const CONTROLLER = "scripts/distribution/desktop/controller.mjs";

const rows = [
  ["01 the Concentration rule is registered under another family", FAMILIES, [['  CONCENTRATION_RULE: active("ABILITY"),', '  CONCENTRATION_RULE: active("CONDITION"),']], game, /CONCENTRATION_RULE \(ABILITY\)/],
  ["02 a calculated value is summed outside M4", VALUES, [["    const total = unavailable !== null ? null : sumOf(parts);", "    const total = unavailable !== null ? null : parts.reduce((s, x) => s + x, 0);"]], gate, /run every number through M4/],
  ["03 an unstated base is invented", VALUES, [["    const parts = [...(base === null ? [] : [base]),", "    const parts = [...(base === null ? [10] : [base]),"]], game, /no base is invented/],
  ["04 a missing input becomes zero", VALUES, [['    if (typeof v !== "number") return { missing: what };', '    if (typeof v !== "number") v = 0;']], game, /never zero/],
  ["05 a non-canonical rule need not say why", READER, [['  if (canonStatus !== null && canonStatus !== "CANONICAL" && note === null) p.add(', '  if (false as boolean) p.add(']], game, /must say why/],
  ["06 a dependency cycle is silently broken", VALUES, [["      for (const k of path.slice(path.indexOf(key))) cyclic.add(k);", "      void path;"]], game, /cycle is refused/],
  ["07 play reads the Concentration rule", ENGINE, [['import { orchestrateRulesEvaluation } from "@prowess/rules";', 'import { orchestrateRulesEvaluation } from "@prowess/rules";\nimport { previewConcentration } from "../ability/concentration-preview.js";\nexport const sustain = previewConcentration;']], gate, /no play, combat or Active Magic module reads the Concentration rule/],
  ["08 the Concentration preview no longer says play does not use it", PANEL, [["            Preview only — combat does not use this rule yet.", "            Concentration preview."]], ui, /preview only/],
  ["09 a test value is shown on the sheet without its label", SHEET, [['TEST_ONLY: "Test value — not canon"', 'TEST_ONLY: "Test value"']], ui, /labelled by where they come from/],
  ["10 the installed build no longer passes its commit to Studio", CONTROLLER, [["PROWESS_BUILD_COMMIT: manifest.build.commit, ", ""]], gate, /build identity reaches Studio/],
];

runControls({
  root,
  title: "RULES-WO1",
  controls: rows.map(([name, file, edits, guard, intended]) => ({
    name,
    file,
    mutate: applyEdits(name, edits),
    guard,
    expect: new RegExp(`(?:AssertionError|expected|FAIL)[\\s\\S]*${intended.source}|${intended.source}[\\s\\S]*(?:AssertionError|expected|FAIL)`, "i"),
  })),
  caught: (name) => `Caught and restored: ${name}`,
  done: (count) => `All ${count} RULES-WO1 controls caught and restored.`,
});
