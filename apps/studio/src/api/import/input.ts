import { ApiError } from "../errors";

/**
 * M3 Import API request helpers (PAS-10 M3-WO7) — SHAPE validation only (types, presence). Every business rule stays
 * in the @prowess/db services. Reuses the M2 strict-input helpers for everything else (src/api/m2).
 */
type Obj = Record<string, unknown>;
const bodyError = (message: string, field?: string) => new ApiError("API.INVALID_BODY", message, 400, field);

export function reqInteger(o: Obj, key: string, at = ""): number {
  const v = o[key];
  if (typeof v !== "number" || !Number.isInteger(v)) throw bodyError(`${at}${key} is required and must be an integer`, key);
  return v;
}
export function optInteger(o: Obj, key: string, at = ""): number | null | undefined {
  if (o[key] === undefined || o[key] === null) return o[key] as null | undefined;
  return reqInteger(o, key, at);
}
export function optNumber(o: Obj, key: string, at = ""): number | undefined {
  const v = o[key];
  if (v === undefined) return undefined;
  if (typeof v !== "number" || !Number.isFinite(v)) throw bodyError(`${at}${key} must be a number`, key);
  return v;
}
export function optStringOnly(o: Obj, key: string, at = ""): string | undefined {
  const v = o[key];
  if (v === undefined) return undefined;
  if (typeof v !== "string") throw bodyError(`${at}${key} must be a string`, key);
  return v;
}
/** Drops undefined members so an absent field never overrides a service default. */
export function definedOnly<T extends Obj>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
}
