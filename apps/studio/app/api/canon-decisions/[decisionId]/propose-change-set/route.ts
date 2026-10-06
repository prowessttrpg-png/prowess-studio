import { proposeChangeSetFromCanonDecision } from "@prowess/db";
import { apiSuccess, parseUuidParam, serializeForApi, toErrorResponse } from "../../../../../src/api/index";
import { optString, optUuid, readStrictBody, reqString } from "../../../../../src/api/m2/index";

/**
 * Explicit proposal (§34).
 * Thin HTTP adapter (PAS-10 M2-WO9): shape validation, one @prowess/db service call, serialization,
 * and the central error mapping. No business rule lives here.
 */

/** POST — EXPLICITLY persists a DRAFT ChangeSet translated from the decision. Retrieving a decision never does. */
export async function POST(request: Request, { params }: { params: Promise<{ decisionId: string }> }): Promise<Response> {
  try {
    const { decisionId: decisionIdRaw } = await params;
    const decisionId = parseUuidParam(decisionIdRaw, "decisionId");
    const body = await readStrictBody(request, ["targetManifestId", "name", "description"]);
    const changeSet = await proposeChangeSetFromCanonDecision(decisionId, {
      targetManifestId: optUuid(body, "targetManifestId"),
      name: reqString(body, "name"),
      description: optString(body, "description"),
    });
    return apiSuccess(serializeForApi(changeSet), 201);
  } catch (error) {
    return toErrorResponse(error);
  }
}
