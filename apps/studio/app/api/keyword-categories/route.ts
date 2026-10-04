import { createKeywordCategory, listKeywordCategories } from "@prowess/db";
import {
  apiSuccess,
  parseJsonBody,
  requireObjectBody,
  serializeForApi,
  toErrorResponse,
} from "../../../src/api/index";

/** GET /api/keyword-categories — list (PAS-10 M1-WO8 §18). */
export async function GET(): Promise<Response> {
  try {
    const categories = await listKeywordCategories();
    return apiSuccess(serializeForApi(categories));
  } catch (error) {
    return toErrorResponse(error);
  }
}

/** POST /api/keyword-categories — create (PAS-10 M1-WO8 §18). No editing behavior here. */
export async function POST(request: Request): Promise<Response> {
  try {
    const body = requireObjectBody(await parseJsonBody(request));
    const category = await createKeywordCategory({
      canonicalKey: body.canonicalKey as string,
      name: body.name as string,
      description: body.description as string | null | undefined,
    });
    return apiSuccess(serializeForApi(category), 201);
  } catch (error) {
    return toErrorResponse(error);
  }
}
