import { listCharacterEligibleDefinitions } from "@prowess/db";
import { apiSuccessList, parsePaginationParams, parseUuidParam, serializeForApi, toErrorResponse } from "../../../../../src/api/index";
import { strictQuery } from "../../../../../src/api/m2/index";

/**
 * GET /api/characters/:characterId/eligible-definitions?definitionKind=…&includeLocked=true — the Character's eligibility
 * for the Release's Definitions of one kind (§65), paginated. Locked entries carry their unmet requirements. Read-only.
 */
export async function GET(request: Request, { params }: { params: Promise<{ characterId: string }> }): Promise<Response> {
  try {
    const { characterId } = await params;
    const searchParams = new URL(request.url).searchParams;
    strictQuery(searchParams, ["definitionKind", "includeLocked", "page", "pageSize"]);
    const { page, pageSize } = parsePaginationParams(searchParams);
    const result = await listCharacterEligibleDefinitions(parseUuidParam(characterId, "characterId"), { definitionKind: searchParams.get("definitionKind"), includeLocked: searchParams.get("includeLocked") === "true", page, pageSize });
    return apiSuccessList(serializeForApi(result.items) as unknown[], result.page, result.pageSize, result.total);
  } catch (error) {
    return toErrorResponse(error);
  }
}
