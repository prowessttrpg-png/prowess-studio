import { transitionEntityVersionStatus } from "@prowess/db";
import {
  apiSuccess,
  parseJsonBody,
  parseUuidParam,
  requireObjectBody,
  serializeForApi,
  toErrorResponse,
} from "../../../../../src/api/index";

/**
 * POST /api/entity-versions/:versionId/status — the ONLY way to change an
 * EntityVersion's lifecycle status through this API (PAS-10 M1-WO8 §14).
 * Deliberately a separate endpoint from `PATCH .../:versionId` — status
 * transitions and content updates are never mixed into one generic
 * operation, mirroring `@prowess/db`'s own
 * `transitionEntityVersionStatus`/`updateDraftEntityVersion` split.
 * Validation against the lifecycle graph, and the atomic conditional
 * update guarding against a concurrent transition, both happen inside
 * `transitionEntityVersionStatus` itself — not reimplemented here.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ versionId: string }> },
): Promise<Response> {
  try {
    const { versionId } = await params;
    const id = parseUuidParam(versionId, "versionId");
    const body = requireObjectBody(await parseJsonBody(request));

    const version = await transitionEntityVersionStatus(id, body.status as string);
    return apiSuccess(serializeForApi(version));
  } catch (error) {
    return toErrorResponse(error);
  }
}
