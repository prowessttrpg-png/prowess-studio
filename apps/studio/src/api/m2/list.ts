import { parsePaginationParams } from "../pagination";
import { apiSuccessList } from "../response";
import { serializeForApi } from "../serialize";

/**
 * The M1 list shape `{ data, pagination }` for M2 list routes (PAS-10 M2-WO9 §45). The M2 list services
 * return each Ruleset's (bounded) records in their documented deterministic order; rather than rewrite
 * those services for HTTP, the route pages over that ordered result with the M1 page / pageSize rules
 * (default 25, max 100, malformed -> 400). Ordering is the service's; nothing is re-sorted here.
 */
export function paginatedList<T>(items: readonly T[], searchParams: URLSearchParams) {
  const { page, pageSize } = parsePaginationParams(searchParams);
  const slice = items.slice((page - 1) * pageSize, page * pageSize);
  return apiSuccessList(serializeForApi(slice) as unknown[], page, pageSize, items.length);
}

export const PAGINATION_QUERY = ["page", "pageSize"] as const;
