import { createImportBatch, listImportBatches } from "@prowess/db";
import { IMPORT_BATCH_SCOPE_TYPES } from "@prowess/model";
import { apiSuccess, serializeForApi, toErrorResponse } from "../../../../src/api/index";
import { PAGINATION_QUERY, optString, optUuid, paginatedList, queryUuid, readStrictBody, reqEnum, reqString, reqUuid, strictObject, strictQuery } from "../../../../src/api/m2/index";

/**
 * Import Batches (WO2). Server-controlled fields (status, fingerprints, hashes, timestamps) are not accepted.
 * Thin HTTP adapter (PAS-10 M3-WO7): strict shape validation, one public @prowess/db service call, serialization, and
 * the central error mapping. No import-domain rule lives here.
 */

/** POST — create (or idempotently return) a Batch: 201 when created, 200 for an existing identical extraction context. */
export async function POST(request: Request): Promise<Response> {
  try {
    const body = await readStrictBody(request, ["sourceSnapshotId", "label", "description", "scope", "reviewRulesetId", "comparisonManifestId", "extractorKey", "extractorVersion", "extractorConfigHash"]);
    const scope = strictObject(body.scope, ["type", "sectionId"], "scope");
    const result = await createImportBatch({
      sourceSnapshotId: reqUuid(body, "sourceSnapshotId"),
      label: reqString(body, "label"),
      description: optString(body, "description"),
      scope: { type: reqEnum(scope, "type", IMPORT_BATCH_SCOPE_TYPES, "scope.") as (typeof IMPORT_BATCH_SCOPE_TYPES)[number], sectionId: optUuid(scope, "sectionId", "scope.") },
      reviewRulesetId: optUuid(body, "reviewRulesetId"),
      comparisonManifestId: optUuid(body, "comparisonManifestId"),
      extractorKey: reqString(body, "extractorKey"),
      extractorVersion: reqString(body, "extractorVersion"),
      extractorConfigHash: optString(body, "extractorConfigHash"),
    });
    return apiSuccess(serializeForApi(result), result.created ? 201 : 200);
  } catch (error) {
    return toErrorResponse(error);
  }
}

/** GET — Batches in creation order (filter: sourceSnapshotId — the only filter the service supports), paginated. */
export async function GET(request: Request): Promise<Response> {
  try {
    const { searchParams } = new URL(request.url);
    strictQuery(searchParams, ["sourceSnapshotId", ...PAGINATION_QUERY]);
    const sourceSnapshotId = queryUuid(searchParams, "sourceSnapshotId");
    return paginatedList(await listImportBatches(sourceSnapshotId === undefined ? {} : { sourceSnapshotId }), searchParams);
  } catch (error) {
    return toErrorResponse(error);
  }
}
