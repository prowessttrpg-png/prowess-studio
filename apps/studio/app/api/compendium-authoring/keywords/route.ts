import { searchAuthoringKeywords } from "@prowess/db";
import { apiSuccess, serializeForApi, toErrorResponse } from "../../../../src/api/index";
import { strictQuery } from "../../../../src/api/m2/index";
import { searchParam } from "../../../../src/api/compendium-authoring/input";

/**
 * GET /api/compendium-authoring/keywords?search= — Keyword picker (PAS-10 M6-WO1 §22, §49): a bounded search of the
 * approved Keyword vocabulary by canonical key or name. Never the whole vocabulary preloaded into a select.
 */
export async function GET(request: Request): Promise<Response> {
  try {
    const { searchParams } = new URL(request.url);
    strictQuery(searchParams, ["search"]);
    return apiSuccess(serializeForApi(await searchAuthoringKeywords(searchParam(searchParams))));
  } catch (error) {
    return toErrorResponse(error);
  }
}
