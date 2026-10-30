// @vitest-environment node
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { frozenFileContent, frozenSchemaText, notLaterMigration } from "./later-milestone-schema";

/**
 * M4-WO7 Resource Engine — static audit (PAS-10 M4-WO7 §136–144). Invariant ids refer to
 * docs/architecture/m4-rules-engine-core.md: M4-I82 Listed Cost Is Immutable During Payment · M4-I84 Temporary Pools
 * Have No Automatic Priority · M4-I85 Insufficient Resources Are A Valid Runtime Outcome · M4-I86 Failed Payment Is
 * Atomic · M4-I87 Capacity Reservation Does Not Spend · M4-I88 Capacity Release Does Not Restore Current Value ·
 * M4-I91 Resource Refresh Is Explicit · M4-I92 Resource Operations Never Round Implicitly · M4-I93 Resource Evaluation
 * Has No External Side Effects · M4-I97 Payment Preview And Apply Share One Allocation Semantics · M4-I98 Runtime
 * Payment Never Rewrites Prior Formula / Modifier Results. (The M4-WO1 audit additionally applies all package-wide
 * purity rules to these files.)
 *
 * The scanner is a plain function proven by in-memory control snippets — no broken file is ever committed.
 */
const ROOT = path.resolve(process.cwd(), "..", "..");
const read = (...p: string[]) => readFileSync(path.join(ROOT, ...p), "utf8");
const rel = (f: string) => path.relative(ROOT, f).split(path.sep).join("/");
const walk = (d: string, out: string[] = []) => {
  for (const e of readdirSync(d)) {
    if (["node_modules", "dist", ".next", "generated"].includes(e)) continue;
    const f = path.join(d, e);
    if (statSync(f).isDirectory()) walk(f, out);
    else out.push(f);
  }
  return out;
};
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const RES_DIR = path.join(ROOT, "packages", "prowess-rules", "src", "resource");
const RES_FILES = walk(RES_DIR).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));
const src = (file: string) => strip(read("packages", "prowess-rules", "src", "resource", file));
/** The body of one exported function. */
const body = (text: string, name: string) => {
  const start = text.indexOf(`export function ${name}(`);
  expect(start, name).toBeGreaterThanOrEqual(0);
  const next = text.indexOf("\nexport ", start + 1);
  return text.slice(start, next === -1 ? undefined : next);
};

const FORBIDDEN: Array<{ id: string; pattern: RegExp }> = [
  { id: "persistence", pattern: /@prowess\/db|prisma|postgres|@prowess\/import/i },
  { id: "code-execution", pattern: /\beval\s*\(|new\s+Function\b|\bFunction\s*\(|\bimport\s*\(|\brequire\s*\(/ },
  { id: "callback", pattern: /typeof\s+[\w.]+\s*[!=]==\s*["']function["']|\.call\s*\(|\.apply\s*\(/ },
  { id: "game-vocabulary", pattern: /\b(mana|exertion|sustain\w*|spells?|health|stamina|concentration|maneuver\w*)\b/i },
  // Case-insensitive: resource keys are lower-case context keys, so "resource.mp" must be caught as well as "MP".
  { id: "game-stat", pattern: /\b(ap|mp|me|hp)\b/i },
  { id: "kind-behaviour", pattern: /\.kind\s*[!=]==?|\bkind\s*[!=]==?\s*["'`]|["'`](TEMPORARY_POOL|ACTION|RESERVED_CAPACITY|SLOT|TRACKER|CAPACITY)["'`]\s*(\)|:|\?|&&|\|\|)/ },
  { id: "timing", pattern: /\b(roundStart|roundEnd|startOfRound|endOfTurn|turn|encounter|longRest|shortRest|expir\w*|tick)\b/i },
  { id: "implicit-rounding", pattern: /Math\.(round|floor|ceil|trunc|fround)|toFixed|toPrecision|EPSILON|parseFloat|parseInt/ },
  { id: "formula-or-modifier-execution", pattern: /evaluateFormula|evaluateModifiers|parseFormula\w*|formula\/|modifier\// },
  { id: "effective-cost", pattern: /effective\w*|netCost|adjustedCost|discount\w*/i },
  { id: "reservation-clamp", pattern: /Math\.min\(\s*[\w.]*current|current\s*:\s*Math\.min|current\s*=\s*Math\.min/ },
  { id: "hidden-latest", pattern: /latest|newest|mostRecent|currentVersion|getCurrent\w*|RulesetContext|findResolvedRule/ },
  { id: "locale-or-case", pattern: /toLocale\w*|localeCompare|\bIntl\b|toLowerCase|toUpperCase|\.normalize\s*\(/ },
  { id: "mutable-registry", pattern: /^(export\s+)?(let|var)\s|^(export\s+)?const\s+\w+\s*=\s*new\s+(Map|Set|WeakMap|WeakSet)\b|Registry|class\s+\w*Engine/m },
];
const audit = (source: string) => [...new Set(FORBIDDEN.filter((r) => r.pattern.test(strip(source))).map((r) => r.id))];

describe("M4-WO7 static audit — scanner control tests (§138–144)", () => {
  it.each([
    ["const effectiveCost = request.listedAmount - temporary.current;", "effective-cost"],
    ["return { ...s, current: Math.min(s.current, getAvailableMaximum(s) as number) };", "reservation-clamp"],
    ["current = Math.min(current, available);", "reservation-clamp"],
    ['const ordered = [...sources].sort((a, b) => (byKey.get(a.resourceKey)?.kind === "TEMPORARY_POOL" ? -1 : 1));', "kind-behaviour"],
    ['if (state.kind === "ACTION") return refresh(state);', "kind-behaviour"],
    ["const paid = Math.floor(Math.min(remaining, capacity));", "implicit-rounding"],
    ["remaining = Math.round(remaining - amountPaid);", "implicit-rounding"],
    ['import { prisma } from "@prowess/db";', "persistence"],
    ["if (resourceKey === \"resource.mp\") applyMeFirst();", "game-stat"],
    ["const exertion = sources.find((s) => s.resourceKey.includes(\"mana\"));", "game-vocabulary"],
    ["if (onEndOfTurn) expireTemporary(state);", "timing"],
    ["const ap = evaluateFormula({ expression: \"floor(x / 4)\" }, { x: paid });", "formula-or-modifier-execution"],
    ["const v = eval(source);", "code-execution"],
    ["export class ResourceEngine { pay() {} }", "mutable-registry"],
  ])("catches %s", (snippet, id) => expect(audit(snippet)).toContain(id));

  it("accepts representative resource code and ignores comments", () => {
    const clean = [
      "// no ME discount, no MP rules, no Math.floor, TEMPORARY_POOL is never first",
      "const amountPaid = zero(Math.min(remaining, capacity));",
      "return { ...nothing, current: s.current, reservedCapacity: s.reservedCapacity + a, applied: true };",
      'if (!(RESOURCE_KINDS as readonly unknown[]).includes(r.kind)) return fail();',
      "const raise = Math.max(0, ceiling - s.current);",
    ].join("\n");
    expect(audit(clean)).toEqual([]);
  });
});

describe("M4-WO7 static audit — the Resource implementation", () => {
  it("covers the resource module", () => {
    expect(RES_FILES.map(rel).sort()).toEqual(["model.ts", "payment.ts", "snapshot.ts", "transition.ts"].map((f) => `packages/prowess-rules/src/resource/${f}`));
  });

  it.each(RES_FILES.map((f) => [rel(f), f]))(
    "%s: no persistence, callbacks, game resources, kind-based behaviour, timing, rounding, Formula / Modifier execution, effective cost or clamping (M4-I84 M4-I92 M4-I93 M4-I98)",
    (_n, f) => expect(audit(readFileSync(f, "utf8"))).toEqual([]),
  );

  it("M4-I84: resource kinds appear only as the metadata vocabulary; kind is read only to validate it", () => {
    for (const f of ["payment.ts", "transition.ts"]) expect(src(f), f).not.toMatch(/\.kind\b|\bkind\s*[!=]==?/);
    expect(src("snapshot.ts").match(/\.kind\b/g)).toEqual([".kind", ".kind"]); // validation read + copy into state
  });

  it("M4-I86: the resulting snapshot is built only when the whole amount is covered", () => {
    const p = src("payment.ts");
    expect(p).toContain("const canPay = remaining === 0;");
    expect(p).toMatch(/let resulting = snapshot;\s*if \(canPay\) \{\s*for \(const a of allocations\) if \(a\.amountPaid !== 0\) resulting = replaceResource\(/);
    expect(p.match(/replaceResource\(/g)).toHaveLength(1);
  });

  it("M4-I97: preview and apply share one allocation algorithm", () => {
    const p = src("payment.ts");
    expect(p.match(/allocatePayment\(/g)).toHaveLength(2); // definition + one call
    expect(body(p, "previewResourcePayment")).toMatch(/return runPayment\("PREVIEW", snapshot, payment, options\);/);
    expect(body(p, "applyResourcePayment")).toMatch(/return runPayment\("APPLY", snapshot, payment, options\);/);
    expect(p).toMatch(/a\.order - b\.order \|\| byCodeUnit\(a\.resourceKey, b\.resourceKey\)/);
  });

  it("M4-I82: payment never writes listedAmount except by copying it through", () => {
    const p = src("payment.ts");
    expect(p.match(/listedAmount\s*[-+*/]?=(?!=)/g) ?? []).toEqual([]);
    expect(p).toContain("listedAmount: payment.listedAmount,");
  });

  it("M4-I87 / M4-I88: reserve and release change reservedCapacity only — current is copied unchanged", () => {
    const tr = src("transition.ts");
    expect(body(tr, "reserveResourceCapacity")).toContain("current: s.current, reservedCapacity: s.reservedCapacity + a,");
    expect(body(tr, "releaseResourceCapacity")).toContain("current: s.current, reservedCapacity: s.reservedCapacity - a,");
  });

  it("M4-I91: refresh only raises (never lowers) and is a caller-invoked operation", () => {
    expect(body(src("transition.ts"), "refreshResource")).toContain("const raise = Math.max(0, ceiling - s.current);");
  });

  it("M4-I85: no diagnostic code models insufficiency — it lives in result data", () => {
    expect(src("model.ts")).not.toMatch(/INSUFFICIENT|NOT_ENOUGH|CANNOT_PAY|CANNOT_AFFORD|SHORTFALL\s*:/);
    expect(src("model.ts")).toMatch(/readonly shortfall: number;/);
    expect(src("model.ts")).toMatch(/readonly canPay: boolean;/);
  });

  it("every operation goes through the M4-WO1 envelope", () => {
    for (const f of ["transition.ts", "payment.ts"]) expect(src(f), f).toMatch(/import \{ evaluate \} from "\.\.\/evaluation\/evaluate\.js";/);
  });
});

describe("M4-WO7 boundaries (§5–7, §136)", () => {
  it("@prowess/rules still depends on @prowess/model only", () => {
    const rules = JSON.parse(read("packages", "prowess-rules", "package.json")) as { dependencies: Record<string, string>; devDependencies: Record<string, string> };
    expect(Object.keys(rules.dependencies)).toEqual(["@prowess/model"]);
    expect(Object.keys(rules.devDependencies).sort()).toEqual(["typescript", "vitest"]);
  });

  it("adds no resource persistence, migration, route, UI or DB service", () => {
    expect(read("packages", "prowess-db", "prisma", "schema.prisma")).not.toMatch(/model\s+(ResourceState|ResourceSnapshot|RuntimeResource|Payment)\w*|resource_(states|snapshots|payments)/i);
    expect(readdirSync(path.join(ROOT, "packages", "prowess-db", "prisma", "migrations")).filter((e) => /^\d{14}_/.test(e)).filter(notLaterMigration)).toHaveLength(22);
    for (const f of [...walk(path.join(ROOT, "apps", "studio")), ...walk(path.join(ROOT, "packages", "prowess-db", "src"))].filter((file) => /\.(ts|tsx)$/.test(file) && !rel(file).includes("/tests/"))) {
      expect(readFileSync(f, "utf8"), rel(f)).not.toMatch(/applyResourcePayment|previewResourcePayment|spendResource|reserveResourceCapacity/);
    }
  });

  it("permanent CI runs this audit as a named gate", () => {
    expect(read(".github", "workflows", "ci.yml")).toContain("tests/unit/m4-wo7-static.test.ts");
  });
});

describe("M4 invariant catalog and coverage matrix (WO7 entries)", () => {
  const doc = read("docs", "architecture", "m4-rules-engine-core.md");
  const ids = Array.from({ length: 19 }, (_, i) => `M4-I${String(i + 80).padStart(2, "0")}`);
  const tests = [...walk(path.join(ROOT, "packages")), ...walk(path.join(ROOT, "apps", "studio", "tests"))].filter((f) => /\.test\.ts$/.test(f));
  const guard = (f: string) => tests.find((t) => path.basename(t) === f);

  it("names M4-I80 – M4-I98 and maps every one to an existing automated guard that cites it", () => {
    for (const id of ids) {
      expect(doc, id).toMatch(new RegExp(`\\*\\*${id}\\*\\*`));
      const row = doc.split("\n").find((l) => l.startsWith(`| ${id} `));
      expect(row, `coverage row for ${id}`).toBeDefined();
      const files = [...(row as string).matchAll(/`([\w./-]+\.test\.ts)`/g)].map((x) => x[1] as string);
      expect(files.length, id).toBeGreaterThan(0);
      for (const f of files) expect(guard(f), `${id}: ${f} exists`).toBeDefined();
      expect(files.some((f) => readFileSync(guard(f) as string, "utf8").includes(id)), `${id} is cited by one of its guards`).toBe(true);
    }
  });
});
