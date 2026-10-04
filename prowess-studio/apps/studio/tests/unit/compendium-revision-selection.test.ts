import { describe, expect, it } from "vitest";
import type { EntityVersionDto, KeywordAssignmentDto } from "../../app/compendium/_lib/api-client";
import { buildDetailHref } from "../../app/compendium/_lib/detail-url";
import {
  categorizeKeywords,
  findLatestVersion,
  findVersionByRevision,
  resolveParentLineage,
  resolveRevisionSelection,
  sameJson,
} from "../../app/compendium/_lib/revision-selection";

function version(revisionNumber: number, parentVersionId: string | null = null): EntityVersionDto {
  return {
    id: `v${revisionNumber}`,
    entityId: "e1",
    revisionNumber,
    status: "DRAFT",
    displayName: `Rev ${revisionNumber}`,
    shortDescription: null,
    rulesText: null,
    structuredData: {},
    parentVersionId,
    changeType: null,
    changeSummary: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function keyword(id: string, name: string): KeywordAssignmentDto {
  return {
    keyword: { id, canonicalKey: `k.${id}`, name, categoryId: null, description: null, deprecated: false, createdAt: "" },
    sourceType: "AUTHORED",
    createdAt: "",
  };
}

describe("findLatestVersion", () => {
  it("is the highest revisionNumber regardless of array order", () => {
    expect(findLatestVersion([version(2), version(3), version(1)])?.revisionNumber).toBe(3);
  });
  it("is null when there are no versions", () => {
    expect(findLatestVersion([])).toBeNull();
  });
});

describe("findVersionByRevision", () => {
  const versions = [version(1), version(2)];
  it("finds a revision belonging to this entity", () => {
    expect(findVersionByRevision(versions, "2")?.id).toBe("v2");
  });
  it.each(["0", "-1", "abc", "1.5", "", " 2", "02", "999"])("rejects %j", (raw) => {
    expect(findVersionByRevision(versions, raw)).toBeNull();
  });
});

describe("resolveRevisionSelection", () => {
  const versions = [version(1), version(2), version(3)];

  it("selects the Latest Revision when no revision is requested", () => {
    const selection = resolveRevisionSelection(versions, null);
    expect(selection).toMatchObject({ kind: "ok", isLatest: true });
    expect(selection.kind === "ok" && selection.version.revisionNumber).toBe(3);
  });

  it("selects an older revision and reports it is not the latest", () => {
    const selection = resolveRevisionSelection(versions, "1");
    expect(selection).toMatchObject({ kind: "ok", isLatest: false });
    expect(selection.kind === "ok" && selection.version.revisionNumber).toBe(1);
  });

  it("reports explicitly requesting the highest revision as latest", () => {
    expect(resolveRevisionSelection(versions, "3")).toMatchObject({ kind: "ok", isLatest: true });
  });

  it("reports an unknown revision as not-found — it never falls back to Latest", () => {
    const selection = resolveRevisionSelection(versions, "999");
    expect(selection.kind).toBe("not-found");
    expect(selection).toMatchObject({ requested: "999" });
  });

  it("reports a malformed revision as not-found", () => {
    expect(resolveRevisionSelection(versions, "abc").kind).toBe("not-found");
  });

  it("is empty for an Entity with no versions and no request", () => {
    expect(resolveRevisionSelection([], null).kind).toBe("empty");
  });

  it("is not-found (not a crash) when a revision is requested of an Entity with no versions", () => {
    expect(resolveRevisionSelection([], "1")).toMatchObject({ kind: "not-found", latest: null });
  });
});

describe("resolveParentLineage", () => {
  it("uses the real parentVersionId, not revisionNumber - 1 (branch awareness)", () => {
    const versions = [version(1), version(2, "v1"), version(3, "v1")];
    const lineage = resolveParentLineage(versions[2]!, versions);
    expect(lineage.kind).toBe("found");
    expect(lineage.kind === "found" && lineage.parent.revisionNumber).toBe(1);
  });
  it("reports no parent cleanly", () => {
    expect(resolveParentLineage(version(1), [version(1)]).kind).toBe("none");
  });
  it("reports a parent id that is not among this entity's versions as missing, without inventing one", () => {
    const orphan = version(2, "someone-elses-version");
    expect(resolveParentLineage(orphan, [version(1), orphan])).toEqual({
      kind: "missing",
      parentVersionId: "someone-elses-version",
    });
  });
});

describe("sameJson", () => {
  it("ignores object key order but not values", () => {
    expect(sameJson({ a: 1, b: { c: 2, d: 3 } }, { b: { d: 3, c: 2 }, a: 1 })).toBe(true);
    expect(sameJson({ value: 10 }, { value: 20 })).toBe(false);
  });
  it("treats array order as significant", () => {
    expect(sameJson([1, 2], [2, 1])).toBe(false);
  });
});

describe("categorizeKeywords", () => {
  it("splits by KeywordDefinition id into only-A, shared, only-B", () => {
    const result = categorizeKeywords(
      [keyword("alpha", "Alpha"), keyword("common", "Common")],
      [keyword("beta", "Beta"), keyword("common", "Common")],
    );
    expect(result.onlyA.map((k) => k.keyword.name)).toEqual(["Alpha"]);
    expect(result.shared.map((k) => k.keyword.name)).toEqual(["Common"]);
    expect(result.onlyB.map((k) => k.keyword.name)).toEqual(["Beta"]);
  });
  it("uses identity, not rendered text: two different keywords with the same name stay distinct", () => {
    const result = categorizeKeywords([keyword("id-1", "Fire")], [keyword("id-2", "Fire")]);
    expect(result.shared).toHaveLength(0);
    expect(result.onlyA).toHaveLength(1);
    expect(result.onlyB).toHaveLength(1);
  });
});

describe("buildDetailHref", () => {
  it("sets a revision while preserving unrelated params", () => {
    const href = buildDetailHref("e1", new URLSearchParams("compareA=1&compareB=2"), { revision: "3" });
    expect(new URL(href, "http://x").searchParams.get("compareA")).toBe("1");
    expect(href.startsWith("/compendium/entities/e1?")).toBe(true);
    expect(new URL(href, "http://x").searchParams.get("revision")).toBe("3");
  });
  it("removes a param with null and yields a bare path when nothing is left", () => {
    expect(buildDetailHref("e1", new URLSearchParams("revision=2"), { revision: null })).toBe(
      "/compendium/entities/e1",
    );
  });
});
