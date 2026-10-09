#!/usr/bin/env node
// Enforces PAS-10's package/import-boundary rules (M0-WO4), so future Work
// Orders can't silently break previously-approved architecture.
//
// Deliberately plain Node + regex over source text rather than a dedicated
// tool (dependency-cruiser, a custom ESLint plugin, etc.) — this repo's
// boundary rules are few and simple enough that a ~150-line script is
// easier to read, audit, and modify than configuring an extra tool, and it
// adds zero new dependencies. This is a lightweight, best-effort static
// check (regex-based, not a full AST/type-aware analysis) — it catches the
// realistic ways these rules get violated (a wrong import), not every
// conceivable workaround (e.g. a dynamically-constructed specifier string).
//
// Run via `pnpm run test:architecture`. Exits non-zero with every
// violation listed (file:line + the forbidden specifier) on failure.
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function walk(dir, exts = [".ts", ".tsx"]) {
  const results = [];
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return results; // directory doesn't exist (e.g. package has no src/ yet)
  }
  for (const entry of entries) {
    const full = path.join(dir, entry);
    const stats = statSync(full);
    if (stats.isDirectory()) {
      results.push(...walk(full, exts));
    } else if (exts.some((ext) => entry.endsWith(ext)) && !entry.endsWith(".test.ts") && !entry.endsWith(".test.tsx")) {
      results.push(full);
    }
  }
  return results;
}

// Matches `import ... from "x"`, `export ... from "x"`, bare `import "x"`,
// and dynamic `import("x")`. Deliberately simple: [^'"]* spans newlines
// (it's a negated character class, not `.`), so multi-line import
// statements are still matched.
const STATIC_IMPORT_RE = /(?:import|export)\s+(?:[^'"]*\sfrom\s*)?["']([^"']+)["']/g;
const DYNAMIC_IMPORT_RE = /import\(\s*["']([^"']+)["']\s*\)/g;

function findImports(filePath) {
  const content = readFileSync(filePath, "utf8");
  const found = [];
  for (const re of [STATIC_IMPORT_RE, DYNAMIC_IMPORT_RE]) {
    re.lastIndex = 0;
    let match;
    while ((match = re.exec(content))) {
      const line = content.slice(0, match.index).split("\n").length;
      found.push({ specifier: match[1], line });
    }
  }
  return found;
}

function isForbidden(specifier, forbiddenList) {
  return forbiddenList.some(
    (pattern) => specifier === pattern || specifier.startsWith(`${pattern}/`),
  );
}

// Forbids only a DEEP/sub-path import into a package (e.g.
// "@prowess/db/src/entity/repository.js") while leaving the bare package
// specifier itself ("@prowess/db") allowed — used where a package's own
// public entry point is the approved surface, but reaching past it into
// its internals is not (PAS-10 M1-WO8 §33).
function isForbiddenDeepImport(specifier, packageNames) {
  return packageNames.some((pkg) => specifier.startsWith(`${pkg}/`));
}

// Substring (not prefix) match — guards against reaching a forbidden
// target via a relative path (e.g. "../../../packages/prowess-db/generated/prisma/client.js")
// that wouldn't match a simple startsWith check on the specifier's front.
function containsForbiddenSubstring(specifier, substrings) {
  return substrings.some((s) => specifier.includes(s));
}

// --- Rule 1: import-boundary rules per package --------------------------
const RULES = [
  {
    name: "@prowess/model",
    srcDir: path.join(ROOT, "packages/prowess-model/src"),
    forbidden: [
      "next",
      "react",
      "react-dom",
      "@prisma/client",
      "@prisma/adapter-pg",
      "prisma",
      "pg",
      "@prowess/db",
      "@prowess/ui",
    ],
    reason: "must remain a framework-independent domain-types package",
  },
  {
    name: "@prowess/db",
    srcDir: path.join(ROOT, "packages/prowess-db/src"),
    forbidden: ["react", "react-dom", "next", "@prowess/ui"],
    reason: "is the persistence boundary — it must not depend on UI or the application layer",
  },
  {
    // M3-WO2: framework-independent import-specific pure logic. Node's standard library (node:crypto) is allowed.
    name: "@prowess/import",
    srcDir: path.join(ROOT, "packages/prowess-import/src"),
    forbidden: ["@prowess/db", "@prisma/client", "@prisma/adapter-pg", "prisma", "pg", "next", "react", "react-dom", "@prowess/ui", "@prowess/studio"],
    forbiddenSubstrings: ["generated/prisma", "apps/studio", "prowess-db"],
    reason: "is framework-independent import logic — it may use @prowess/model only, never persistence, UI or the application",
  },
  {
    name: "@prowess/ui",
    srcDir: path.join(ROOT, "packages/prowess-ui/src"),
    forbidden: ["@prisma/client", "@prisma/adapter-pg", "prisma", "pg", "@prowess/db"],
    reason: "is UI primitives only — it must not access persistence directly",
  },
  {
    name: "apps/studio (app/)",
    srcDir: path.join(ROOT, "apps/studio/app"),
    forbidden: ["@prisma/client", "@prisma/adapter-pg", "prisma"],
    reason: "no route or component may construct a Prisma client directly — always go through @prowess/db",
  },
  {
    name: "apps/studio (src/)",
    srcDir: path.join(ROOT, "apps/studio/src"),
    forbidden: ["@prisma/client", "@prisma/adapter-pg", "prisma"],
    reason: "application-level modules (config, navigation, etc.) must not construct a Prisma client directly either — always go through @prowess/db",
  },
  {
    // Stricter than the general "apps/studio (app/)" rule above: API route
    // handlers are the final HTTP boundary (PAS-10 M1-WO8 §33) and must
    // use ONLY @prowess/db's public service surface (the bare "@prowess/db"
    // import) — never Prisma directly, and never a deep/internal
    // @prowess/db import (e.g. reaching past its index.ts into
    // "@prowess/db/src/entity/repository.js" or its generated Prisma
    // output) that would bypass the validation/error-mapping its services
    // provide.
    name: "apps/studio (app/api/)",
    srcDir: path.join(ROOT, "apps/studio/app/api"),
    forbidden: ["@prisma/client", "@prisma/adapter-pg", "prisma"],
    forbiddenDeepImportPackages: ["@prowess/db"],
    forbiddenSubstrings: ["generated/prisma"],
    reason: "route handlers must use only @prowess/db's public service surface — no direct Prisma, no deep/internal @prowess/db import",
  },
  {
    // M2-WO10: the Ruleset & Canon governance UI and its client layer talk to data ONLY through the HTTP API.
    name: "apps/studio (app/developer/ + src/api-client/)",
    srcDir: path.join(ROOT, "apps/studio/app/developer"),
    forbidden: ["@prisma/client", "@prisma/adapter-pg", "prisma", "@prowess/db"],
    forbiddenSubstrings: ["generated/prisma"],
  },
  {
    name: "apps/studio (src/api-client/)",
    srcDir: path.join(ROOT, "apps/studio/src/api-client"),
    forbidden: ["@prisma/client", "@prisma/adapter-pg", "prisma", "@prowess/db"],
    forbiddenSubstrings: ["generated/prisma"],
  },
  {
    // The Compendium frontend (PAS-10 M1-WO9 §1, §41) must consume ONLY
    // the HTTP/API layer (apps/studio/app/compendium/_lib/api-client.ts,
    // which itself only ever calls `fetch`) — unlike `app/api/`, it has no
    // legitimate reason to import `@prowess/db` at all, bare or deep, so
    // the whole package name is forbidden here (not just deep sub-paths).
    name: "apps/studio (app/compendium/)",
    srcDir: path.join(ROOT, "apps/studio/app/compendium"),
    forbidden: ["@prisma/client", "@prisma/adapter-pg", "prisma", "@prowess/db"],
    forbiddenSubstrings: ["generated/prisma"],
    reason: "the Compendium frontend must consume only the HTTP API layer — no Prisma, no @prowess/db at all (bare or deep)",
  },
];

const violations = [];

for (const rule of RULES) {
  for (const file of walk(rule.srcDir)) {
    for (const { specifier, line } of findImports(file)) {
      const violatesBasic = isForbidden(specifier, rule.forbidden ?? []);
      const violatesDeepImport =
        rule.forbiddenDeepImportPackages !== undefined &&
        isForbiddenDeepImport(specifier, rule.forbiddenDeepImportPackages);
      const violatesSubstring =
        rule.forbiddenSubstrings !== undefined &&
        containsForbiddenSubstring(specifier, rule.forbiddenSubstrings);

      if (violatesBasic || violatesDeepImport || violatesSubstring) {
        violations.push(
          `${rule.name} (${rule.reason}):\n    ${path.relative(ROOT, file)}:${line} imports forbidden "${specifier}"`,
        );
      }
    }
  }
}

// --- Rule 2: no circular workspace-package dependencies ------------------
const WORKSPACE_PACKAGE_DIRS = [
  "packages/prowess-model",
  "packages/prowess-ui",
  "packages/prowess-db",
  "packages/prowess-import",
  "packages/prowess-test-fixtures",
  "apps/studio",
];

const graph = {};
for (const dir of WORKSPACE_PACKAGE_DIRS) {
  const pkgPath = path.join(ROOT, dir, "package.json");
  let pkg;
  try {
    pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
  } catch {
    continue;
  }
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  graph[pkg.name] = Object.keys(deps).filter((d) => d.startsWith("@prowess/"));
}

function findCycle(dependencyGraph) {
  const visited = new Set();
  const stack = new Set();
  let cyclePath = null;

  function visit(node, pathSoFar) {
    if (cyclePath) return;
    if (stack.has(node)) {
      cyclePath = [...pathSoFar, node];
      return;
    }
    if (visited.has(node)) return;
    visited.add(node);
    stack.add(node);
    for (const dep of dependencyGraph[node] ?? []) {
      visit(dep, [...pathSoFar, node]);
    }
    stack.delete(node);
  }

  for (const node of Object.keys(dependencyGraph)) {
    visit(node, []);
    if (cyclePath) break;
  }
  return cyclePath;
}

const cycle = findCycle(graph);
if (cycle) {
  violations.push(`Circular workspace package dependency detected: ${cycle.join(" -> ")}`);
}

// --- Report ---------------------------------------------------------------
if (violations.length > 0) {
  console.error("\nArchitecture boundary violations found:\n");
  for (const v of violations) {
    console.error(`  - ${v}`);
  }
  console.error(
    `\n${violations.length} violation(s). See docs/architecture/ci.md's "Architecture boundary rules" section for the rules.\n`,
  );
  process.exit(1);
}

console.log(
  `Architecture check passed: ${RULES.length} import-boundary rule(s) and ${WORKSPACE_PACKAGE_DIRS.length} package(s) checked for circular dependencies — no violations.`,
);
