import { createEntity, listEntities } from "@prowess/db";
import {
  apiSuccess,
  apiSuccessList,
  parseJsonBody,
  parsePaginationParams,
  requireObjectBody,
  serializeForApi,
  toErrorResponse,
} from "../../../src/api/index";

/**
 * GET /api/entities — paginated, filterable Entity list (PAS-10 M1-WO8
 * §6–7, §27–30). See `docs/api/entity-api.md` for the full filter/
 * pagination semantics; this handler only parses the query string and
 * delegates everything else to `@prowess/db`'s `listEntities`.
 */
export async function GET(request: Request): Promise<Response> {
  try {
    const { searchParams } = new URL(request.url);
    const { page, pageSize } = parsePaginationParams(searchParams);

    const result = await listEntities({
      page,
      pageSize,
      entityType: searchParams.get("entityType") ?? undefined,
      canonicalKey: searchParams.get("canonicalKey") ?? undefined,
      search: searchParams.get("search") ?? undefined,
      keywordId: searchParams.get("keyword") ?? undefined,
      status: searchParams.get("status") ?? undefined,
    });

    return apiSuccessList(serializeForApi(result.items) as unknown[], result.page, result.pageSize, result.total);
  } catch (error) {
    return toErrorResponse(error);
  }
}

/** POST /api/entities — create (PAS-10 M1-WO8 §8). Uses the existing `createEntity` directly. */
export async function POST(request: Request): Promise<Response> {
  try {
    const body = requireObjectBody(await parseJsonBody(request));
    const entity = await createEntity({
      entityType: body.entityType as string,
      canonicalKey: body.canonicalKey as string,
    });
    return apiSuccess(serializeForApi(entity), 201);
  } catch (error) {
    return toErrorResponse(error);
  }
}
