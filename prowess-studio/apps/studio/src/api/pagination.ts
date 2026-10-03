import { ApiError } from "./errors.js";

export const DEFAULT_PAGE = 1;
export const DEFAULT_PAGE_SIZE = 25;
/** Hard cap — PAS-10 M1-WO8 §25–26: "Do not allow unbounded list queries." */
export const MAX_PAGE_SIZE = 100;

export interface ParsedPagination {
  page: number;
  pageSize: number;
}

/**
 * Parses `page`/`pageSize` from a route's query string. Defaults to
 * `page=1, pageSize=25` when absent. A `pageSize` above `MAX_PAGE_SIZE` is
 * silently clamped down to it (a generous request like `pageSize=10000`
 * is treated as "give me as many as you'll allow," not an error) — a
 * malformed value (non-numeric, zero, negative, non-integer) is rejected
 * outright with a 400 `ApiError` rather than silently substituting a
 * default, so a caller's typo is surfaced rather than hidden.
 */
export function parsePaginationParams(searchParams: URLSearchParams): ParsedPagination {
  const pageRaw = searchParams.get("page");
  const pageSizeRaw = searchParams.get("pageSize");

  const page = pageRaw === null ? DEFAULT_PAGE : parsePositiveInteger(pageRaw, "page");
  const pageSize =
    pageSizeRaw === null
      ? DEFAULT_PAGE_SIZE
      : Math.min(parsePositiveInteger(pageSizeRaw, "pageSize"), MAX_PAGE_SIZE);

  return { page, pageSize };
}

function parsePositiveInteger(raw: string, fieldName: string): number {
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new ApiError(
      "API.INVALID_QUERY",
      `${fieldName} must be a positive integer`,
      400,
      fieldName,
    );
  }
  return parsed;
}
