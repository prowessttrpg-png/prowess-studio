import { formulaGuide } from "@prowess/db";
import { ApiError, apiSuccess, parseJsonBody, requireObjectBody, serializeForApi, toErrorResponse } from "../../../../src/api/index";

/**
 * POST /api/compendium-rules/formula — PRE-M7-WO1 guided Formula editing, computed on the server with the M4 parser (the
 * Studio never parses or rebuilds a Formula itself). Body `{ op, … }`:
 *   describe { expression, sources? } · compose { terms, sources? } · rename { expression, from, to, sources? } ·
 *   name { source, taken, style? } (style "camel": a lowerCamel name, for Effect formulas).
 * Pure: no database access, nothing written. POST only because the request carries a body.
 */
const FIELDS = ["op", "expression", "sources", "terms", "from", "to", "source", "taken", "style"];

export async function POST(request: Request): Promise<Response> {
  try {
    const body = requireObjectBody(await parseJsonBody(request));
    const unknown = Object.keys(body).filter((k) => !FIELDS.includes(k));
    if (unknown.length > 0) throw new ApiError("API.INVALID_BODY", `Unknown field(s): ${unknown.join(", ")}`, 400);
    return apiSuccess(serializeForApi(formulaGuide(body)));
  } catch (error) {
    return toErrorResponse(error);
  }
}
