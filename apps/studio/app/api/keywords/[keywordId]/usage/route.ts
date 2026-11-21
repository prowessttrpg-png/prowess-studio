import { getKeywordUsage } from "@prowess/db";
import { apiSuccess, parseUuidParam, serializeForApi, toErrorResponse } from "../../../../../src/api/index";

/** GET /api/keywords/:keywordId/usage — RULES-WO1 (R09): where a Keyword is used (read-only counts). */
export async function GET(_request: Request, { params }: { params: Promise<{ keywordId: string }> }): Promise<Response> {
  try {
    const { keywordId } = await params;
    return apiSuccess(serializeForApi(await getKeywordUsage(parseUuidParam(keywordId, "keywordId"))));
  } catch (error) {
    return toErrorResponse(error);
  }
}
