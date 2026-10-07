import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { computeManifestHash } from "../../src/ruleset-release/hash";

/** PAS-10 M2-WO8 §41–§42: the release manifest hash depends on composition only. */
const p = (entityId: string, entityVersionId: string) => ({ entityId, entityVersionId });
const A = "00000000-0000-4000-8000-00000000000a";
const B = "00000000-0000-4000-8000-00000000000b";
const V = (n: number) => `00000000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`;

describe("computeManifestHash", () => {
  it("is SHA-256 (lowercase hex) of the PROWESS_MANIFEST_V1 text", () => {
    const text = `PROWESS_MANIFEST_V1\n${A}:${V(1)}\n${B}:${V(2)}\n`;
    expect(computeManifestHash([p(A, V(1)), p(B, V(2))])).toBe(createHash("sha256").update(text, "utf8").digest("hex"));
    expect(computeManifestHash([])).toMatch(/^[0-9a-f]{64}$/);
  });
  it("same composition in any order or case -> same hash; repeated -> identical", () => {
    const h = computeManifestHash([p(A, V(1)), p(B, V(2))]);
    expect(computeManifestHash([p(B.toUpperCase(), V(2)), p(A, V(1))])).toBe(h);
    expect(computeManifestHash([p(A, V(1)), p(B, V(2))])).toBe(h);
  });
  it("a changed Version, an added or a removed Entity -> a different hash", () => {
    const h = computeManifestHash([p(A, V(1)), p(B, V(2))]);
    expect(computeManifestHash([p(A, V(3)), p(B, V(2))])).not.toBe(h);
    expect(computeManifestHash([p(A, V(1))])).not.toBe(h);
    expect(computeManifestHash([p(A, V(1)), p(B, V(2)), p("00000000-0000-4000-8000-00000000000c", V(4))])).not.toBe(h);
  });
  it("only composition goes in: the input type has no room for row ids, timestamps, or labels", () => {
    const withExtras = [{ ...p(A, V(1)), id: "row-1", createdAt: new Date(), versionLabel: "0.1" }];
    expect(computeManifestHash(withExtras)).toBe(computeManifestHash([p(A, V(1))]));
  });
});
