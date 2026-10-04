import { createKeywordDefinition, listKeywordDefinitions } from "@prowess/db";
import {
  apiSuccess,
  parseJsonBody,
  requireObjectBody,
  serializeForApi,
  toErrorResponse,
} from "../../../src/api/index";

/**
 * GET /api/keywords — list KeywordDefinitions, optionally filtered by
 * `categoryId` (PAS-10 M1-WO8 §18).
 */
export async function GET(request: Request): Promise<Response> {
  try {
    const { searchParams } = new URL(request.url);
    const categoryId = searchParams.get("categoryId") ?? undefined;
    const keywords = await listKeywordDefinitions(categoryId);
    return apiSuccess(serializeForApi(keywords));
  } catch (error) {
    return toErrorResponse(error);
  }
}

/** POST /api/keywords — create (PAS-10 M1-WO8 §18). No editing/deprecation behavior here. */
export async function POST(request: Request): Promise<Response> {
  try {
    const body = requireObjectBody(await parseJsonBody(request));
    const keyword = await createKeywordDefinition({
      canonicalKey: body.canonicalKey as string,
      name: body.name as string,
      categoryId: body.categoryId as string | null | undefined,
      description: body.description as string | null | undefined,
    });
    return apiSuccess(serializeForApi(keyword), 201);
  } catch (error) {
    return toErrorResponse(error);
  }
}
