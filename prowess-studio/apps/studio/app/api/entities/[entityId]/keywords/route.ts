import { assignKeywordToEntity, listEntityKeywords } from "@prowess/db";
import {
  apiSuccess,
  parseJsonBody,
  parseUuidParam,
  requireObjectBody,
  serializeForApi,
  toErrorResponse,
} from "../../../../../src/api/index";

/** GET /api/entities/:entityId/keywords — Entity-level assignments (PAS-10 M1-WO8 §16). */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ entityId: string }> },
): Promise<Response> {
  try {
    const { entityId } = await params;
    const id = parseUuidParam(entityId, "entityId");
    const assignments = await listEntityKeywords(id);
    return apiSuccess(serializeForApi(assignments));
  } catch (error) {
    return toErrorResponse(error);
  }
}

/**
 * POST /api/entities/:entityId/keywords — assign (PAS-10 M1-WO8 §16).
 * `assignKeywordToEntity` itself enforces no-duplicate and validates
 * `keywordId` exists; this route adds no mechanics of its own.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ entityId: string }> },
): Promise<Response> {
  try {
    const { entityId } = await params;
    const id = parseUuidParam(entityId, "entityId");
    const body = requireObjectBody(await parseJsonBody(request));

    const keywordId = parseUuidParam(body.keywordId as string, "keywordId");
    await assignKeywordToEntity(id, keywordId, (body.source as string | undefined) ?? "AUTHORED");
    const assignments = await listEntityKeywords(id);
    return apiSuccess(serializeForApi(assignments), 201);
  } catch (error) {
    return toErrorResponse(error);
  }
}
