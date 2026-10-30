import { createCharacter, listCharacters } from "@prowess/db";
import { apiSuccess, apiSuccessList, parsePaginationParams, serializeForApi, toErrorResponse } from "../../../src/api/index";
import { readStrictBody, strictQuery } from "../../../src/api/m2/index";

/**
 * GET /api/characters — the minimal Character index (PAS-10 M6-WO3 §54): name, Level, exact Release, creation state,
 * last update. POST /api/characters — create a Character Draft on one exact Release (§72): only `name`, optional
 * `concept` and `rulesetReleaseId` are accepted — never a Level, derived value or composition.
 */
export async function GET(request: Request): Promise<Response> {
  try {
    const { searchParams } = new URL(request.url);
    strictQuery(searchParams, ["page", "pageSize"]);
    const { page, pageSize } = parsePaginationParams(searchParams);
    const result = await listCharacters({ page, pageSize });
    return apiSuccessList(serializeForApi(result.items) as unknown[], result.page, result.pageSize, result.total);
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const body = await readStrictBody(request, ["name", "concept", "rulesetReleaseId"]);
    return apiSuccess(serializeForApi(await createCharacter({ name: body.name, concept: body.concept, rulesetReleaseId: body.rulesetReleaseId })), 201);
  } catch (error) {
    return toErrorResponse(error);
  }
}
