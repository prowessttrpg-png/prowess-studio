import { ApiError } from "../errors";
import { parseJsonBody, requireObjectBody } from "../request";
import { isValidUuid } from "../uuid";

/**
 * Strict request SHAPE reading for the M2 Ruleset / Canon API (PAS-10 M2-WO9 §5, §46, §80).
 *
 * Shape only: field presence, JSON types, UUID format, membership in a controlled vocabulary (always
 * passed in from @prowess/model — never redefined here), and no unknown keys. Every SEMANTIC rule
 * (lengths, cross-record ownership, lifecycle, staleness, …) stays in the @prowess/db services.
 * Every failure is a 400 ApiError carrying the offending field.
 */
type Obj = Record<string, unknown>;
const bodyError = (message: string, field?: string) => new ApiError("API.INVALID_BODY", message, 400, field);
const queryError = (message: string, field?: string) => new ApiError("API.INVALID_QUERY", message, 400, field);
const present = (v: unknown) => v !== undefined && v !== null;

/** A JSON object whose keys are all in `allowed` — an unknown key (e.g. `status`, `releaseNumber`) is rejected, never ignored. */
export function strictObject(value: unknown, allowed: readonly string[], at = "body"): Obj {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw bodyError(`${at} must be a JSON object`, at === "body" ? undefined : at);
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) throw bodyError(`${at === "body" ? "" : `${at}.`}${key} is not an accepted field`, key);
  }
  return value as Obj;
}

/** Parses the JSON body (malformed JSON -> 400) and applies `strictObject`. */
export async function readStrictBody(request: Request, allowed: readonly string[]): Promise<Obj> {
  return strictObject(requireObjectBody(await parseJsonBody(request)), allowed);
}

/** Named command routes take no input: an empty body or `{}` only. */
export async function requireNoBody(request: Request): Promise<void> {
  const text = await request.text();
  if (text.trim() === "") return;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw bodyError("Request body must be valid JSON");
  }
  strictObject(parsed, []);
}

export function reqString(o: Obj, key: string, at = ""): string {
  if (typeof o[key] !== "string") throw bodyError(`${at}${key} is required and must be a string`, key);
  return o[key] as string;
}
export function optString(o: Obj, key: string, at = ""): string | null | undefined {
  if (o[key] === undefined || o[key] === null) return o[key] as null | undefined;
  if (typeof o[key] !== "string") throw bodyError(`${at}${key} must be a string or null`, key);
  return o[key] as string;
}
export function reqUuid(o: Obj, key: string, at = ""): string {
  const v = o[key];
  if (typeof v !== "string" || !isValidUuid(v)) throw bodyError(`${at}${key} is required and must be a valid UUID`, key);
  return v;
}
export function optUuid(o: Obj, key: string, at = ""): string | null | undefined {
  if (!present(o[key])) return o[key] as null | undefined;
  return reqUuid(o, key, at);
}
export function reqEnum(o: Obj, key: string, values: readonly string[], at = ""): string {
  const v = o[key];
  if (typeof v !== "string" || !values.includes(v)) throw bodyError(`${at}${key} must be one of: ${values.join(", ")}`, key);
  return v;
}
export function uuidArray(o: Obj, key: string): string[] {
  const v = o[key];
  if (!Array.isArray(v)) throw bodyError(`${key} is required and must be an array`, key);
  v.forEach((item, i) => {
    if (typeof item !== "string" || !isValidUuid(item)) throw bodyError(`${key}[${i}] must be a valid UUID`, key);
  });
  return v as string[];
}
/** An array of strict objects; `read` validates each element (receiving its "key[i]." prefix). */
export function objectArray<T>(o: Obj, key: string, allowed: readonly string[], read: (item: Obj, at: string) => T): T[] {
  const v = o[key];
  if (!Array.isArray(v)) throw bodyError(`${key} is required and must be an array`, key);
  return v.map((item, i) => read(strictObject(item, allowed, `${key}[${i}]`), `${key}[${i}].`));
}

/** Rejects unknown query parameters instead of silently ignoring a typo'd filter (§46). */
export function strictQuery(searchParams: URLSearchParams, allowed: readonly string[]): void {
  for (const key of searchParams.keys()) {
    if (!allowed.includes(key)) throw queryError(`${key} is not an accepted query parameter`, key);
  }
}
export function queryUuid(searchParams: URLSearchParams, key: string, required = false): string | undefined {
  const v = searchParams.get(key);
  if (v === null) {
    if (required) throw queryError(`${key} is required`, key);
    return undefined;
  }
  if (!isValidUuid(v)) throw queryError(`${key} must be a valid UUID`, key);
  return v;
}
export function queryEnum(searchParams: URLSearchParams, key: string, values: readonly string[]): string | undefined {
  const v = searchParams.get(key);
  if (v === null) return undefined;
  if (!values.includes(v)) throw queryError(`${key} must be one of: ${values.join(", ")}`, key);
  return v;
}
export function queryString(searchParams: URLSearchParams, key: string): string {
  const v = searchParams.get(key);
  if (v === null || v.trim() === "") throw queryError(`${key} is required`, key);
  return v;
}
