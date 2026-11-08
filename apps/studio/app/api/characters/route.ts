import { createCharacter, listCharacters } from "@prowess/db";
import { ApiError, apiSuccess, apiSuccessList, parsePaginationParams, serializeForApi, toErrorResponse } from "../../../src/api/index";
import { readStrictBody, strictQuery } from "../../../src/api/m2/index";

/** M6-WO11 Library query vocabulary (the service re-validates the same rules as a domain guard). */
const LIBRARY_STATUSES: readonly string[] = ["ALL", "DRAFT", "CORE_COMPLETE"];
const MAX_SEARCH = 120;

/**
 * GET /api/characters — the Character Library (PAS-10 M6-WO3 §54, extended by M6-WO11): name, Level, exact Release,
 * creation state and the last update of the Character record. Optional M6-WO11 query, applied to the whole collection
 * before `page` / `pageSize`:
 *   `q`      — case-insensitive literal name text (punctuation is literal), trimmed; empty / whitespace-only = no filter;
 *              at most 120 characters after trimming; given once.
 *   `status` — ALL | DRAFT | CORE_COMPLETE (default ALL); given once.
 * Any other key, a repeated `q` / `status` or an invalid value → 400 API.INVALID_QUERY. Without `q` / `status` the
 * response is exactly the WO3 contract. Read-only.
 *
 * POST /api/characters — create a Character Draft on one exact Release (§72): only `name`, optional `concept` and
 * `rulesetReleaseId` are accepted — never a Level, derived value or composition.
 */
export async function GET(request: Request): Promise<Response> {
  try {
    const { searchParams } = new URL(request.url);
    strictQuery(searchParams, ["page", "pageSize", "q", "status"]);
    for (const key of ["q", "status"]) if (searchParams.getAll(key).length > 1) throw new ApiError("API.INVALID_QUERY", `${key} is accepted once`, 400, key);
    const { page, pageSize } = parsePaginationParams(searchParams);
    const status = searchParams.get("status");
    if (status !== null && !LIBRARY_STATUSES.includes(status)) throw new ApiError("API.INVALID_QUERY", `status must be one of ${LIBRARY_STATUSES.join(", ")}`, 400, "status");
    const q = searchParams.get("q");
    if (q !== null && q.trim().length > MAX_SEARCH) throw new ApiError("API.INVALID_QUERY", `q is at most ${String(MAX_SEARCH)} characters`, 400, "q");
    const result = await listCharacters({ page, pageSize, search: q, status: status ?? undefined });
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
