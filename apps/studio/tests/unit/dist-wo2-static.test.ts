import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(process.cwd(), "../..");
const text = (file: string) => readFileSync(path.join(root, file), "utf8");
const routes = [
  "apps/studio/app/api/content-packs/route.ts",
  "apps/studio/app/api/content-packs/install/route.ts",
  "apps/studio/app/api/content-packs/preview/route.ts",
  "apps/studio/app/api/ruleset-releases/[releaseId]/content-pack/route.ts",
];

describe("DIST-WO2 catalog transfer boundary", () => {
  it("registers only the reviewed routes and additive persistence", () => {
    expect(JSON.parse(text("docs/architecture/m6-api-routes.json"))["DIST-WO2"]).toEqual(routes);
    expect(JSON.parse(text("docs/architecture/m6-schema-changes.json"))["DIST-WO2"]).toEqual({
      migrations: ["20261115010000_dist_wo2_content_packs"],
      models: ["ContentPackReceipt", "ContentPackOwnership", "ContentPackSourceLocation", "ContentPackAsset"],
    });
    for (const file of routes) expect(text(file)).toContain("if (!desktopContentPacksEnabled(request)");
  });

  it("requires the transfer proof in Tier 2 and uses the same preview/install path for the sample", () => {
    const workflow = text(".github/workflows/ci.yml");
    expect(workflow).toContain("node scripts/distribution/verify-dist-wo2-transfer.mjs");
    expect(workflow).toMatch(/tier-2:[\s\S]+?needs: \[[^\n]*\bdb-api\b/);
    const controller = text("scripts/distribution/desktop/controller.mjs");
    expect(controller).toContain("Demo.prowesspack");
    expect(controller).toContain('"/api/content-packs/preview"');
    expect(controller).toContain('"/api/content-packs/install"');
    expect(controller).toContain("preview.manifest.contentDigest !== manifest.demo.contentDigest");
  });
});
