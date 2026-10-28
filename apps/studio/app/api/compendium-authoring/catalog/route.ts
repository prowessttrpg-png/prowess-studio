import { getAuthoringCatalog } from "@prowess/db";
import { apiSuccess, serializeForApi, toErrorResponse } from "../../../../src/api/index";
import { strictQuery } from "../../../../src/api/m2/index";

/**
 * GET /api/compendium-authoring/catalog — the authoring catalog (PAS-10 M6-WO1 §8, §40): every Prowess Definition kind
 * with its family, branch, shared contract, allowed storage EntityTypes and supported schema versions, plus the M5
 * vocabularies the editor renders as options. A read-only projection of the certified M5 registry — never a copy.
 */
export async function GET(request: Request): Promise<Response> {
  try {
    strictQuery(new URL(request.url).searchParams, []);
    return apiSuccess(serializeForApi(getAuthoringCatalog()));
  } catch (error) {
    return toErrorResponse(error);
  }
}
