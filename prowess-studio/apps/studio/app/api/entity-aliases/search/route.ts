import { findEntitiesByAlias } from "@prowess/db";
import { ApiError, apiSuccess, serializeForApi, toErrorResponse } from "../../../../src/api/index";

/**
 * GET /api/entity-aliases/search?alias=...&context=... (PAS-10 M1-WO8
 * §15). Returns 0..many matches — `findEntitiesByAlias` already never
 * arbitrarily selects a single result (see M1-WO4), and this route does
 * not add any such selection on top of it.
 */
export async function GET(request: Request): Promise<Response> {
  try {
    const { searchParams } = new URL(request.url);
    const alias = searchParams.get("alias");
    if (alias === null || alias.trim().length === 0) {
      throw new ApiError("API.INVALID_QUERY", "alias query parameter is required", 400, "alias");
    }
    const context = searchParams.get("context") ?? undefined;

    const matches = await findEntitiesByAlias(alias, context);
    return apiSuccess(serializeForApi(matches));
  } catch (error) {
    return toErrorResponse(error);
  }
}
