import { ApiError } from "./errors";

/**
 * Parses a request body as JSON, throwing a 400 `ApiError` (caught by the
 * shared `toErrorResponse`) rather than letting a malformed body crash the
 * route handler with an unhandled exception.
 */
export async function parseJsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new ApiError("API.INVALID_BODY", "Request body must be valid JSON", 400);
  }
}

/**
 * Narrows `body` to a plain object, throwing a 400 `ApiError` otherwise —
 * every route handler that expects a JSON object body (not an array, a
 * string, `null`, etc.) can rely on this before reading individual fields.
 */
export function requireObjectBody(body: unknown): Record<string, unknown> {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new ApiError("API.INVALID_BODY", "Request body must be a JSON object", 400);
  }
  return body as Record<string, unknown>;
}
