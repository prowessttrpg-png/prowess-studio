import { getEntityVersion, updateDraftEntityVersion } from "@prowess/db";
import type { ChangeType } from "@prowess/model";
import {
  apiSuccess,
  parseJsonBody,
  parseUuidParam,
  requireObjectBody,
  serializeForApi,
  toErrorResponse,
} from "../../../../src/api/index";

/** GET /api/entity-versions/:versionId — the full EntityVersion representation (PAS-10 M1-WO8 §12). */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ versionId: string }> },
): Promise<Response> {
  try {
    const { versionId } = await params;
    const id = parseUuidParam(versionId, "versionId");
    const version = await getEntityVersion(id);
    return apiSuccess(serializeForApi(version));
  } catch (error) {
    return toErrorResponse(error);
  }
}

/**
 * PATCH /api/entity-versions/:versionId — lifecycle-safe DRAFT content
 * update (PAS-10 M1-WO8 §13). Accepts ONLY the fields
 * `UpdateDraftEntityVersionInput` allows — `id`, `entityId`,
 * `revisionNumber`, `parentVersionId`, `status`, and `createdAt` are never
 * read from the body at all, so there is no path for a caller to even
 * attempt to smuggle one through. Status transition is a deliberately
 * separate endpoint (`POST .../status`) — never mixed into this route.
 * `updateDraftEntityVersion` itself enforces the DRAFT-only rule
 * atomically; this handler does not re-check status.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ versionId: string }> },
): Promise<Response> {
  try {
    const { versionId } = await params;
    const id = parseUuidParam(versionId, "versionId");
    const body = requireObjectBody(await parseJsonBody(request));

    const version = await updateDraftEntityVersion(id, {
      displayName: body.displayName as string | undefined,
      shortDescription: body.shortDescription as string | null | undefined,
      rulesText: body.rulesText as string | null | undefined,
      structuredData: body.structuredData,
      changeType: body.changeType as ChangeType | null | undefined,
      changeSummary: body.changeSummary as string | null | undefined,
    });
    return apiSuccess(serializeForApi(version));
  } catch (error) {
    return toErrorResponse(error);
  }
}
