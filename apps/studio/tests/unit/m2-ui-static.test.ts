// @vitest-environment node
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * M2-WO10 static audit — the governance UI is an operator interface over the HTTP API: no persistence imports,
 * no fetch outside the client layer, no reimplemented governance logic, no current/active semantics, no
 * mutation verbs beyond the named commands.
 */
const STUDIO = process.cwd();
const walk = (d: string, out: string[] = []) => {
  for (const e of readdirSync(d)) {
    const f = path.join(d, e);
    if (statSync(f).isDirectory()) walk(f, out);
    else if (/\.(ts|tsx)$/.test(e)) out.push(f);
  }
  return out;
};
const UI = walk(path.join(STUDIO, "app", "developer"));
const CLIENT = walk(path.join(STUDIO, "src", "api-client"));
const SHELL = [path.join(STUDIO, "app", "components", "AppShell.tsx")];
const ALL = [...UI, ...CLIENT, ...SHELL];
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const rel = (f: string) => path.relative(STUDIO, f);

describe("M2-WO10 — the governance UI stays on the API side of the boundary (§1, §63, §64, §85)", () => {
  it("finds the UI, client and shell sources", () => {
    expect(UI.length).toBeGreaterThan(15);
    expect(CLIENT.length).toBeGreaterThanOrEqual(4);
  });
  it.each(ALL.map((f) => [rel(f), f]))("%s imports no persistence internals", (_n, f) => {
    const src = strip(readFileSync(f as string, "utf8"));
    for (const i of [...src.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1] as string)) {
      expect(i, i).not.toMatch(/^@prowess\/db|@prisma|^prisma$|generated\/prisma|repository/);
    }
  });
  it("only the client layer calls fetch, and it only GETs and POSTs relative /api URLs", () => {
    for (const f of [...UI, ...SHELL]) expect(strip(readFileSync(f, "utf8")), rel(f)).not.toMatch(/\bfetch\(/);
    const http = strip(readFileSync(path.join(STUDIO, "src", "api-client", "http.ts"), "utf8"));
    expect(http).toMatch(/method: "GET" \| "POST"/);
    for (const f of CLIENT) {
      const src = strip(readFileSync(f, "utf8"));
      expect(src, rel(f)).not.toMatch(/\b(PATCH|PUT|DELETE)\b|https?:\/\//);
      for (const m of src.matchAll(/`(\/[^`$]*)/g)) expect(m[1], rel(f)).toMatch(/^\/api\//);
    }
  });
  it("no governance logic is reimplemented client-side (§1, §85)", () => {
    const FORBIDDEN = /\b(canonicalManifestText|computeManifestHash|createHash|sha256|planChangeSetApplication|translateDecisionToOperations|resolveAuthorityFromDeclarations|diffCompositions|ChangeSetImpactCollector|ruleConflictStatusForDisposition|resolutionDepth\s*\+)\b|\.sort\(/;
    for (const c of ["computeManifestHash(x)", "items.sort((a, b) => a - b)", "translateDecisionToOperations(f)"]) expect(c).toMatch(FORBIDDEN);
    for (const f of ALL) expect(strip(readFileSync(f, "utf8")), rel(f)).not.toMatch(FORBIDDEN);
    // Inheritance is never walked in the browser: parentManifestId is only displayed or linked, never followed in a loop.
    for (const f of UI) expect(strip(readFileSync(f, "utf8")), rel(f)).not.toMatch(/\b(while|for)\s*\([^)]*parentManifestId/);
  });
  it("introduces no current / active semantics (§5, §6, §62)", () => {
    for (const f of [...ALL, path.join(STUDIO, "..", "..", "packages", "prowess-ui", "src", "TopBar.tsx")]) {
      expect(readFileSync(f, "utf8"), rel(f)).not.toMatch(/\b(Current|Active) (Ruleset|Canon|Policy|Manifest|Release|Rules)\b/);
    }
  });
  it("the only mutations are creations and the named commands (§10, §36, §51)", () => {
    const gov = strip(readFileSync(path.join(STUDIO, "src", "api-client", "governance.ts"), "utf8"));
    const posts = [...gov.matchAll(/export const (\w+) = [^=]*=>\s*apiPost/g)].map((m) => m[1]).sort();
    expect(posts).toEqual([
      "approveChangeSet", "approveRuleset", "createChangeSet", "createConflict", "createDecision", "createManifest", "createPolicy", "createRuleset",
      "proposeChangeSet", "publishRelease", "rejectChangeSet", "submitChangeSetForReview", "submitRulesetForReview",
    ]);
    expect(gov).not.toMatch(/\b(update|edit|delete|remove|set\w*Status|addEntry|removeEntry|replaceEntry)\w*\s*=/i);
  });
  it("the workspace has durable URL routes for every historical record (§46, §47)", () => {
    const pages = UI.filter((f) => f.endsWith("page.tsx")).map((f) => path.relative(path.join(STUDIO, "app"), path.dirname(f)).split(path.sep).join("/")).sort();
    expect(pages).toEqual(
      [
        "developer",
        "developer/rulesets",
        "developer/rulesets/[rulesetId]",
        "developer/rulesets/[rulesetId]/change-sets",
        "developer/rulesets/[rulesetId]/change-sets/[changeSetId]",
        "developer/rulesets/[rulesetId]/conflicts",
        "developer/rulesets/[rulesetId]/conflicts/[conflictId]",
        "developer/rulesets/[rulesetId]/decisions",
        "developer/rulesets/[rulesetId]/decisions/[decisionId]",
        "developer/rulesets/[rulesetId]/manifests",
        "developer/rulesets/[rulesetId]/manifests/[manifestId]",
        "developer/rulesets/[rulesetId]/policies",
        "developer/rulesets/[rulesetId]/policies/[policyId]",
        "developer/rulesets/[rulesetId]/releases",
        "developer/rulesets/[rulesetId]/releases/[releaseId]",
      ].sort(),
    );
  });
  it("historical detail pages render no edit or delete control (§29, §35, §43, §61)", () => {
    for (const f of UI.filter((x) => /\[(manifestId|policyId|decisionId|releaseId|changeSetId|conflictId)\]\/page\.tsx$/.test(x))) {
      expect(readFileSync(f, "utf8"), rel(f)).not.toMatch(/>\s*(Edit|Delete|Save changes)\s*</);
    }
  });
});
