import { updateAuthoredDraftDefinition } from "@prowess/db";
import { apiSuccess, parseUuidParam, serializeForApi, toErrorResponse } from "../../../../../src/api/index";
import { optString, readStrictBody, reqString } from "../../../../../src/api/m2/index";

/**
 * PUT /api/compendium-authoring/entity-versions/:versionId — Save Draft (PAS-10 M6-WO1 §17, §42–43, §46). Edits THIS
 * DRAFT in place (never a new revision); `expectedUpdatedAt` protects newer work from being overwritten. Status,
 * revision number, parent and identity are not accepted. An omitted `prowessDefinition` leaves the stored one unchanged.
 */
export async function PUT(request: Request, { params }: { params: Promise<{ versionId: string }> }): Promise<Response> {
  try {
    const { versionId } = await params;
    const id = parseUuidParam(versionId, "versionId");
    const body = await readStrictBody(request, ["expectedUpdatedAt", "displayName", "shortDescription", "rulesText", "changeType", "changeSummary", "prowessDefinition"]);
    const displayName = optString(body, "displayName");
    const result = await updateAuthoredDraftDefinition(id, {
      expectedUpdatedAt: reqString(body, "expectedUpdatedAt"),
      displayName: displayName === null ? undefined : displayName,
      shortDescription: optString(body, "shortDescription"),
      rulesText: optString(body, "rulesText"),
      changeType: optString(body, "changeType"),
      changeSummary: optString(body, "changeSummary"),
      ...("prowessDefinition" in body ? { prowessDefinition: body.prowessDefinition } : {}),
    });
    return apiSuccess(serializeForApi(result));
  } catch (error) {
    return toErrorResponse(error);
  }
}
