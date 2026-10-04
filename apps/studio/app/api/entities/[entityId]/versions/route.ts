import { createEntityVersion, listEntityVersions } from "@prowess/db";
import type { ChangeType, EntityVersionStatus } from "@prowess/model";
import {
  apiSuccess,
  parseJsonBody,
  parseUuidParam,
  requireObjectBody,
  serializeForApi,
  toErrorResponse,
} from "../../../../../src/api/index";

/**
 * GET /api/entities/:entityId/versions — all revisions, ordered
 * `revisionNumber ASC` (PAS-10 M1-WO8 §10). Never collapsed into one
 * "current" Version — `listEntityVersions` already returns the full,
 * un-hidden history.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ entityId: string }> },
): Promise<Response> {
  try {
    const { entityId } = await params;
    const id = parseUuidParam(entityId, "entityId");
    const versions = await listEntityVersions(id);
    return apiSuccess(serializeForApi(versions));
  } catch (error) {
    return toErrorResponse(error);
  }
}

/**
 * POST /api/entities/:entityId/versions — create a new revision (PAS-10
 * M1-WO8 §11). The request body maps directly to the existing
 * `CreateEntityVersionInput` — `revisionNumber` is never accepted from the
 * caller; `createEntityVersion` allocates it.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ entityId: string }> },
): Promise<Response> {
  try {
    const { entityId } = await params;
    const id = parseUuidParam(entityId, "entityId");
    const body = requireObjectBody(await parseJsonBody(request));

    // Values are passed through as-received and validated by
    // createEntityVersion itself (PAS-10 M1-WO8 §1 — this adapter does not
    // re-implement that validation); the casts below only satisfy
    // TypeScript's structural typing at this boundary, not a safety claim.
    const version = await createEntityVersion(id, {
      displayName: body.displayName as string,
      shortDescription: (body.shortDescription as string | null | undefined) ?? undefined,
      rulesText: (body.rulesText as string | null | undefined) ?? undefined,
      structuredData: body.structuredData,
      status: body.status as EntityVersionStatus | undefined,
      parentVersionId: (body.parentVersionId as string | null | undefined) ?? undefined,
      changeType: body.changeType as ChangeType | null | undefined,
      changeSummary: (body.changeSummary as string | null | undefined) ?? undefined,
    });
    return apiSuccess(serializeForApi(version), 201);
  } catch (error) {
    return toErrorResponse(error);
  }
}
