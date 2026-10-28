import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * The route inventories frozen by the M5 static gates describe the API AS CERTIFIED: each M5 Work Order proved it added
 * no endpoint. M6 legitimately adds routes, each registered by Work Order in docs/architecture/m6-api-routes.json
 * (pinned by m6-wo1-static). The M5 gates therefore compare the live inventory with EXACTLY their frozen baseline plus
 * the registered later routes: an unregistered route — or a removed baseline route — still fails every M5 gate.
 */
const ROOT = path.resolve(process.cwd(), "..", "..");

export function laterMilestoneRoutes(): string[] {
  const registry = JSON.parse(readFileSync(path.join(ROOT, "docs/architecture/m6-api-routes.json"), "utf8")) as Record<string, unknown>;
  return Object.entries(registry)
    .filter(([key]) => /^M\d+-WO\d+$/.test(key))
    .flatMap(([, routes]) => routes as string[]);
}

/** A frozen M5 baseline inventory plus every registered later-milestone route, sorted like the live walk. */
export function withLaterMilestoneRoutes(baseline: readonly string[]): string[] {
  return [...baseline, ...laterMilestoneRoutes()].sort();
}
