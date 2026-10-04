import { assignKeywordToEntityVersion, listEntityVersionKeywords } from "@prowess/db";
import {
  apiSuccess,
  parseJsonBody,
  parseUuidParam,
  requireObjectBody,
  serializeForApi,
  toErrorResponse,
} from "../../../../../src/api/index";

/**
 * GET /api/entity-versions/:versionId/keywords — Version-level assignments
 * (PAS-10 M1-WO8 §17). Never gated by lifecycle status — reading a
 * protected Version's Keywords is always allowed.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ versionId: string }> },
): Promise<Response> {
  try {
    const { versionId } = await params;
    const id = parseUuidParam(versionId, "versionId");
    const assignments = await listEntityVersionKeywords(id);
    return apiSuccess(serializeForApi(assignments));
  } catch (error) {
    return toErrorResponse(error);
  }
}

/**
 * POST /api/entity-versions/:versionId/keywords — assign (PAS-10 M1-WO8
 * §17). The existing DRAFT-only lifecycle rule remains fully authoritative
 * — `assignKeywordToEntityVersion`'s own atomic guard (M1-WO5) rejects a
 * non-DRAFT target with `ENTITY_VERSION.IMMUTABLE`; this route never
 * bypasses or re-implements that check.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ versionId: string }> },
): Promise<Response> {
  try {
    const { versionId } = await params;
    const id = parseUuidParam(versionId, "versionId");
    const body = requireObjectBody(await parseJsonBody(request));

    const keywordId = parseUuidParam(body.keywordId as string, "keywordId");
    await assignKeywordToEntityVersion(
      id,
      keywordId,
      (body.source as string | undefined) ?? "AUTHORED",
    );
    const assignments = await listEntityVersionKeywords(id);
    return apiSuccess(serializeForApi(assignments), 201);
  } catch (error) {
    return toErrorResponse(error);
  }
}
