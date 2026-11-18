import { createEncounter, listEncounters } from "@prowess/db";
import { ApiError, apiSuccess, apiSuccessList, parsePaginationParams, serializeForApi, toErrorResponse } from "../../../src/api/index";
import { readStrictBody, strictQuery } from "../../../src/api/m2/index";

const LIST_STATUSES: readonly string[] = ["ALL", "PREPARATION", "ARCHIVED"];
const MAX_SEARCH = 120;

/**
 * GET /api/encounters — the encounter list (M7-WO1): name, status, exact Release, side and participant counts, last
 * update. Optional `q` (literal, case-insensitive name text) and `status` (ALL | PREPARATION | ARCHIVED), each once.
 * Read-only.
 *
 * POST /api/encounters — create an encounter draft on ONE exact published Release: `{ name, notes?, rulesetReleaseId,
 * idempotencyKey }`. Nothing else is accepted; a retried key returns the original encounter (`replayed: true`).
 */
export async function GET(request: Request): Promise<Response> {
  try {
    const { searchParams } = new URL(request.url);
    strictQuery(searchParams, ["page", "pageSize", "q", "status"]);
    for (const key of ["q", "status"]) if (searchParams.getAll(key).length > 1) throw new ApiError("API.INVALID_QUERY", `${key} is accepted once`, 400, key);
    const { page, pageSize } = parsePaginationParams(searchParams);
    const status = searchParams.get("status");
    if (status !== null && !LIST_STATUSES.includes(status)) throw new ApiError("API.INVALID_QUERY", `status must be one of ${LIST_STATUSES.join(", ")}`, 400, "status");
    const q = searchParams.get("q");
    if (q !== null && q.trim().length > MAX_SEARCH) throw new ApiError("API.INVALID_QUERY", `q is at most ${String(MAX_SEARCH)} characters`, 400, "q");
    const result = await listEncounters({ page, pageSize, search: q, status: status ?? undefined });
    return apiSuccessList(serializeForApi(result.items) as unknown[], result.page, result.pageSize, result.total);
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const body = await readStrictBody(request, ["name", "notes", "rulesetReleaseId", "idempotencyKey"]);
    const result = await createEncounter({ name: body.name, notes: body.notes, rulesetReleaseId: body.rulesetReleaseId, idempotencyKey: body.idempotencyKey });
    return apiSuccess(serializeForApi(result), result.replayed ? 200 : 201);
  } catch (error) {
    return toErrorResponse(error);
  }
}
