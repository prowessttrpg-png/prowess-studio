import { ApiError } from "../errors";
import { objectArray, optString, reqUuid, uuidArray } from "../m2/index";

/**
 * Request SHAPE reading for the Compendium authoring API (PAS-10 M6-WO1 §38): presence, JSON types and UUID format
 * only, reusing the strict M2 readers. Nothing here knows a Definition contract — `prowessDefinition` is passed to the
 * @prowess/db authoring service, which runs the M5 validation boundary.
 */
type Obj = Record<string, unknown>;

/** An optional array of UUIDs (omitted / null = none). */
export function optUuidArray(o: Obj, key: string): string[] {
  return o[key] === undefined || o[key] === null ? [] : uuidArray(o, key);
}

/** Optional provenance rows: `{ sourceDocumentId, sectionLabel?, pageReference?, sourceExcerptNote? }`. */
export function optSources(o: Obj, key: string) {
  if (o[key] === undefined || o[key] === null) return [];
  return objectArray(o, key, ["sourceDocumentId", "sectionLabel", "pageReference", "sourceExcerptNote"], (item, at) => ({
    sourceDocumentId: reqUuid(item, "sourceDocumentId", at),
    sectionLabel: optString(item, "sectionLabel", at),
    pageReference: optString(item, "pageReference", at),
    sourceExcerptNote: optString(item, "sourceExcerptNote", at),
  }));
}

/** The candidate Definition: any JSON value is accepted as SHAPE; its legality is the M5 contract's decision. */
export function definitionField(o: Obj, key = "prowessDefinition"): unknown {
  if (!(key in o)) throw new ApiError("API.INVALID_BODY", `${key} is required`, 400, key);
  return o[key];
}

/** A bounded free-text search parameter (empty allowed). */
export function searchParam(searchParams: URLSearchParams, key = "search"): string {
  const v = searchParams.get(key) ?? "";
  if (v.length > 200) throw new ApiError("API.INVALID_QUERY", `${key} must be at most 200 characters`, 400, key);
  return v;
}
