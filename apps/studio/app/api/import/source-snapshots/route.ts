import { createSourceSnapshot, listSourceSnapshots } from "@prowess/db";
import { apiSuccess, serializeForApi, toErrorResponse } from "../../../../src/api/index";
import { PAGINATION_QUERY, optString, paginatedList, queryUuid, readStrictBody, reqString, reqUuid, strictQuery } from "../../../../src/api/m2/index";
import { optInteger, reqInteger } from "../../../../src/api/import/index";

/**
 * Source Snapshots (WO1). Registers Snapshot METADATA only — there is no upload / blob pipeline (see m3-import-api.md).
 * Thin HTTP adapter (PAS-10 M3-WO7): strict shape validation, one public @prowess/db service call, serialization, and
 * the central error mapping. No import-domain rule lives here.
 */

/** POST — register an exact source revision's metadata (no bytes). Structure ingestion is not exposed over HTTP. */
export async function POST(request: Request): Promise<Response> {
  try {
    const body = await readStrictBody(request, ["sourceDocumentId", "label", "originalFilename", "mimeType", "contentHash", "byteSize", "pageCount", "declaredVersion", "declaredDraftState"]);
    const snapshot = await createSourceSnapshot(reqUuid(body, "sourceDocumentId"), {
      label: reqString(body, "label"),
      originalFilename: reqString(body, "originalFilename"),
      mimeType: reqString(body, "mimeType"),
      contentHash: reqString(body, "contentHash"),
      byteSize: reqInteger(body, "byteSize"),
      pageCount: optInteger(body, "pageCount"),
      declaredVersion: optString(body, "declaredVersion"),
      declaredDraftState: optString(body, "declaredDraftState"),
    });
    return apiSuccess(serializeForApi(snapshot), 201);
  } catch (error) {
    return toErrorResponse(error);
  }
}

/** GET — the Snapshots of one SourceDocument (required filter sourceDocumentId), history order, paginated. */
export async function GET(request: Request): Promise<Response> {
  try {
    const { searchParams } = new URL(request.url);
    strictQuery(searchParams, ["sourceDocumentId", ...PAGINATION_QUERY]);
    return paginatedList(await listSourceSnapshots(queryUuid(searchParams, "sourceDocumentId", true) as string), searchParams);
  } catch (error) {
    return toErrorResponse(error);
  }
}
