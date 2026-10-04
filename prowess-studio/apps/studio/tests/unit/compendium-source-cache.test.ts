import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  resolveSourceDocuments,
  type SourceDocumentDto,
  type SourceReferenceDto,
} from "../../app/compendium/_lib/api-client";

const ref = (id: string, sourceDocumentId: string): SourceReferenceDto => ({
  id,
  sourceDocumentId,
  entityVersionId: "v1",
  sectionLabel: null,
  pageReference: null,
  sourceExcerptNote: null,
  createdAt: "",
});
const doc = (id: string): SourceDocumentDto => ({
  id,
  title: `Doc ${id}`,
  sourceType: "DOCUMENT",
  versionLabel: null,
  authorityStatus: null,
  fileReference: null,
  notes: null,
  createdAt: "",
});

describe("resolveSourceDocuments with a shared cache (M1-WO10 §37)", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchMock = vi.fn(async (path: string) => {
      const id = path.split("/").pop() as string;
      return new Response(JSON.stringify({ data: doc(id) }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("fetches a document once even when two revisions cite it", async () => {
    const cache = new Map<string, Promise<SourceDocumentDto>>();
    await resolveSourceDocuments([ref("r1", "d1")], cache);
    await resolveSourceDocuments([ref("r2", "d1"), ref("r3", "d2")], cache);
    expect(fetchMock).toHaveBeenCalledTimes(2); // d1 once, d2 once
  });

  it("does not poison the cache when a lookup fails, so a retry can succeed", async () => {
    const cache = new Map<string, Promise<SourceDocumentDto>>();
    fetchMock.mockImplementationOnce(async () =>
      new Response(JSON.stringify({ code: "SOURCE_DOCUMENT.NOT_FOUND", message: "x", field: null, details: null }), { status: 404 }),
    );
    await expect(resolveSourceDocuments([ref("r1", "d1")], cache)).rejects.toBeTruthy();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const retried = await resolveSourceDocuments([ref("r1", "d1")], cache);
    expect(retried.get("d1")?.title).toBe("Doc d1");
  });

  it("still works with no cache (M1-WO9 behavior)", async () => {
    const result = await resolveSourceDocuments([ref("r1", "d1"), ref("r2", "d1")]);
    expect(result.size).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
