import { getImportDecision } from "@prowess/db";
import { apiSuccess, parseUuidParam, serializeForApi, toErrorResponse } from "../../../../../src/api/index";
import { strictQuery } from "../../../../../src/api/m2/index";

/**
 * One immutable Import Decision (WO6).
 * Thin HTTP adapter (PAS-10 M3-WO7): strict shape validation, one public @prowess/db service call, serialization, and
 * the central error mapping. No import-domain rule lives here.
 */

export async function GET(request: Request, { params }: { params: Promise<{ decisionId: string }> }): Promise<Response> {
  try {
    const { decisionId: raw } = await params;
    const decisionId = parseUuidParam(raw, "decisionId");
    strictQuery(new URL(request.url).searchParams, []);
    return apiSuccess(serializeForApi(await getImportDecision(decisionId)));
  } catch (error) {
    return toErrorResponse(error);
  }
}
