import { getKeywordDefinition } from "@prowess/db";
import { apiSuccess, parseUuidParam, serializeForApi, toErrorResponse } from "../../../../src/api/index";

/** GET /api/keywords/:keywordId (PAS-10 M1-WO8 §18). */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ keywordId: string }> },
): Promise<Response> {
  try {
    const { keywordId } = await params;
    const id = parseUuidParam(keywordId, "keywordId");
    const keyword = await getKeywordDefinition(id);
    return apiSuccess(serializeForApi(keyword));
  } catch (error) {
    return toErrorResponse(error);
  }
}
