import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { checkCertificationCaches, checkInventory, loadInventory, workflowJobs } from "../../../../scripts/ci/gate-inventory.mjs";

/**
 * M5-CLOSEOUT-03 §5: the permanent gate inventory is part of the architecture. scripts/ci/gates.json must match the
 * consolidated workflow exactly and must represent everything the pre-CLOSEOUT-03 workflows ran
 * (scripts/ci/legacy-inventory.json): old unique assertion inventory ⊆ new consolidated inventory.
 */
const ROOT = path.resolve(import.meta.dirname, "../../../..");
interface Gate { id: string; controls: { script: string; count: number; kind: string } | null; tiers: number[] }
interface Inventory { gates: Gate[]; suites: Record<string, { job: string }>; checks: { id: string }[] }

describe("CI gate inventory (M5-CLOSEOUT-03)", () => {
  const inventory = loadInventory(ROOT) as Inventory;

  it("is consistent with .github/workflows/ci.yml and covers every legacy check", () => {
    expect(checkInventory(ROOT)).toEqual([]);
  });

  it("keeps the complete negative / mutation control inventory: 344 controls across 17 scripts (M6-WO1 added 18, M6-WO2 added 18, M6-WO3 added 28)", () => {
    const counts = Object.fromEntries(inventory.gates.filter((g) => g.controls).map((g) => [g.controls!.script, g.controls!.count]));
    expect(counts).toEqual({
      "scripts/m4-final-negative-controls.mjs": 3,
      "scripts/m5-wo1-negative-controls.mjs": 17,
      "scripts/m5-wo2-negative-controls.mjs": 18,
      "scripts/m5-wo3-negative-controls.mjs": 21,
      "scripts/m5-wo4-negative-controls.mjs": 34,
      "scripts/m5-wo5-negative-controls.mjs": 29,
      "scripts/m5-wo6-negative-controls.mjs": 16,
      "scripts/m5-wo7-negative-controls.mjs": 22,
      "scripts/m5-wo8-negative-controls.mjs": 8,
      "scripts/m5-wo9-negative-controls.mjs": 12,
      "scripts/m5-wo10-negative-controls.mjs": 18,
      "scripts/m5-wo11-negative-controls.mjs": 26,
      "scripts/m5-wo12-negative-controls.mjs": 26,
      "scripts/m5-wo13-negative-controls.mjs": 30,
      "scripts/m6-wo1-negative-controls.mjs": 18,
      "scripts/m6-wo2-negative-controls.mjs": 18,
      "scripts/m6-wo3-negative-controls.mjs": 28,
    });
  });

  it("every M1, M4-WO1…WO12 and M5-WO1…WO13 gate is permanent (Tier 2 and Tier 3)", () => {
    const ids = inventory.gates.map((g) => g.id);
    for (const id of ["M1-STATIC", "M1-DB", "M1-API", "M4-WO12", "M5-CANON"]) expect(ids).toContain(id);
    for (let i = 1; i <= 11; i += 1) expect(ids.some((x) => x === `M4-WO${i}` || x.startsWith(`M4-WO${i}-`))).toBe(true);
    for (let i = 1; i <= 13; i += 1) expect(ids).toContain(`M5-WO${i}`);
    for (const gate of inventory.gates) expect(gate.tiers).toEqual([2, 3]);
  });

  it("the merge-readiness summary needs every job; PR runs cancel when superseded, main and certification runs never do", () => {
    const ci = readFileSync(path.join(ROOT, ".github/workflows/ci.yml"), "utf8");
    const jobs = Object.keys(workflowJobs(ci) as Record<string, string>);
    const tier2 = (workflowJobs(ci) as Record<string, string>)["tier-2"]!;
    const needs = /needs: \[([^\]]+)\]/.exec(tier2)![1]!.split(",").map((s) => s.trim());
    expect([...needs].sort()).toEqual(jobs.filter((j) => !j.startsWith("tier-")).sort());
    expect(tier2).toContain("if: always()");
    expect(ci).toContain("cancel-in-progress: ${{ github.event_name == 'pull_request' }}");
    expect(ci).toMatch(/group: \$\{\{ github\.event_name == 'pull_request' && format\('ci-pr-\{0\}', github\.event\.pull_request\.number\) \|\| format\('ci-run-\{0\}', github\.run_id\) \}\}/);
    expect(ci).not.toMatch(/paths(-ignore)?:/); // no path filter: Tier 2 / Tier 3 never skip a check
  });

  it("Tier 3 uses no dependency, browser or Next.js cache; Tier 1 / 2 keep the pnpm store cache (CLOSEOUT-04 correction)", () => {
    const ci = readFileSync(path.join(ROOT, ".github/workflows/ci.yml"), "utf8");
    expect(checkCertificationCaches(ci)).toEqual([]);
    const jobs = workflowJobs(ci) as Record<string, string>;
    const withNode = Object.keys(jobs).filter((id) => jobs[id]!.includes("actions/setup-node@"));
    expect(withNode.length).toBe(13); // every job except the two tier summaries (db-integration is one matrix job)
    // The exact defect of Tier 3 attempt #226 is rejected: '' is falsy, so this expression always yields 'pnpm'.
    const node = /( +)- name: Set up Node\.js\n[\s\S]*?cache: pnpm\n\1- name: Set up Node\.js \(Tier 3[^\n]*\n(?:\1 [^\n]*\n)+/;
    const defective = ci.replace(node, "$1- name: Set up Node.js\n$1  uses: actions/setup-node@v4\n$1  with:\n$1    node-version: \"22\"\n$1    cache: ${{ env.CERTIFICATION == 'true' && '' || 'pnpm' }}\n");
    expect(defective).not.toBe(ci);
    expect(checkCertificationCaches(defective).length).toBeGreaterThan(0);
    // An unconditional cache restore is rejected as well.
    expect(checkCertificationCaches(ci.replace("      - name: Restore Next.js build cache\n        if: env.CERTIFICATION != 'true'\n", "      - name: Restore Next.js build cache\n")).length).toBeGreaterThan(0);
  });

  it("R6: the placeholder @prowess/test-fixtures package is gone and nothing references it as a workspace package", () => {
    expect(existsSync(path.join(ROOT, "packages/prowess-test-fixtures"))).toBe(false);
    const manifests = [...readdirSync(path.join(ROOT, "packages")).map((d) => `packages/${d}/package.json`), "apps/studio/package.json", "package.json"];
    for (const m of manifests) if (existsSync(path.join(ROOT, m))) expect(readFileSync(path.join(ROOT, m), "utf8"), m).not.toContain("@prowess/test-fixtures");
    expect(readFileSync(path.join(ROOT, "pnpm-lock.yaml"), "utf8")).not.toContain("prowess-test-fixtures");
    expect(readFileSync(path.join(ROOT, ".github/workflows/ci.yml"), "utf8")).not.toContain("test-fixtures");
    // The architecture rules still FORBID importing it from @prowess/rules and @prowess/game (defence if re-added).
    expect(readFileSync(path.join(ROOT, "scripts/check-architecture.mjs"), "utf8")).not.toContain('"packages/prowess-test-fixtures"');
  });
});
