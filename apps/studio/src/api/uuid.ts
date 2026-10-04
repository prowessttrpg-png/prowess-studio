import { ApiError } from "./errors.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isValidUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

/**
 * Validates a route-param UUID BEFORE it ever reaches a service call —
 * PAS-10 M1-WO8 §24: malformed identifiers must never fall through into
 * an opaque Prisma/database error. Throws a 400 `ApiError` (caught by
 * every route's shared `toErrorResponse`) if `value` isn't UUID-shaped;
 * otherwise returns it unchanged, ready to pass to a `@prowess/db`
 * service.
 */
export function parseUuidParam(value: string, paramName: string): string {
  if (!isValidUuid(value)) {
    throw new ApiError(
      "API.INVALID_UUID",
      `${paramName} must be a valid UUID`,
      400,
      paramName,
    );
  }
  return value;
}
