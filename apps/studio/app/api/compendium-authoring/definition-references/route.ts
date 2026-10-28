import { searchDefinitionReferences } from "@prowess/db";
import { apiSuccess, serializeForApi, toErrorResponse } from "../../../../src/api/index";
import { strictQuery } from "../../../../src/api/m2/index";
import { searchParam } from "../../../../src/api/compendium-authoring/input";

/**
 * GET /api/compendium-authoring/definition-references?search=&definitionKind= — reference picker (PAS-10 M6-WO1 §30,
 * §49–50). Bounded human search; every candidate is an exact revision carrying its full exact Definition reference.
 */
export async function GET(request: Request): Promise<Response> {
  try {
    const { searchParams } = new URL(request.url);
    strictQuery(searchParams, ["search", "definitionKind"]);
    const result = await searchDefinitionReferences({ search: searchParam(searchParams), definitionKind: searchParams.get("definitionKind") });
    return apiSuccess(serializeForApi(result));
  } catch (error) {
    return toErrorResponse(error);
  }
}
