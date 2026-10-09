import { getSourceStructure } from "@prowess/db";
import { apiSuccess, parseUuidParam, serializeForApi, toErrorResponse } from "../../../../../../src/api/index";
import { strictQuery } from "../../../../../../src/api/m2/index";

/**
 * A Snapshot's structural OUTLINE (WO1): the Snapshot, its ingestion record, its sections, and counts. Content is read per section (paged), never the whole flow at once.
 * Thin HTTP adapter (PAS-10 M3-WO7): strict shape validation, one public @prowess/db service call, serialization, and
 * the central error mapping. No import-domain rule lives here.
 */

/** GET — outline only, to avoid giant payloads for ~900-page sources. Read-only. */
export async function GET(request: Request, { params }: { params: Promise<{ snapshotId: string }> }): Promise<Response> {
  try {
    const { snapshotId: raw } = await params;
    const snapshotId = parseUuidParam(raw, "snapshotId");
    strictQuery(new URL(request.url).searchParams, []);
    const { snapshot, ingestion, sections, assets, nodes } = await getSourceStructure(snapshotId);
    return apiSuccess(serializeForApi({ snapshot, ingestion, sections, assetCount: assets.length, contentNodeCount: nodes.length }));
  } catch (error) {
    return toErrorResponse(error);
  }
}
