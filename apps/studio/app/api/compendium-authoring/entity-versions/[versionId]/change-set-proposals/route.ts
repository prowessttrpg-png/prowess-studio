import { proposeDefinitionChangeSet } from "@prowess/db";
import { apiSuccess, parseUuidParam, serializeForApi, toErrorResponse } from "../../../../../../src/api/index";
import { optString, optUuid, readStrictBody, reqString, reqUuid } from "../../../../../../src/api/m2/index";

/**
 * POST /api/compendium-authoring/entity-versions/:versionId/change-set-proposals — hand a passing revision to the M2
 * Canon Manager (PAS-10 M6-WO1 §32–33): an ordinary DRAFT ChangeSet in the EXPLICITLY chosen Ruleset with one exact
 * PIN_ENTITY_VERSION proposal, created by M2's own createChangeSet. Nothing is applied, pinned or published.
 */
export async function POST(request: Request, { params }: { params: Promise<{ versionId: string }> }): Promise<Response> {
  try {
    const { versionId } = await params;
    const id = parseUuidParam(versionId, "versionId");
    const body = await readStrictBody(request, ["rulesetId", "targetManifestId", "name", "description"]);
    const changeSet = await proposeDefinitionChangeSet(id, {
      rulesetId: reqUuid(body, "rulesetId"),
      targetManifestId: optUuid(body, "targetManifestId"),
      name: reqString(body, "name"),
      description: optString(body, "description"),
    });
    return apiSuccess(serializeForApi(changeSet), 201);
  } catch (error) {
    return toErrorResponse(error);
  }
}
