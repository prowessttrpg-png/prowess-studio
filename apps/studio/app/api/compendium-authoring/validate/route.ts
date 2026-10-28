import { validateAuthoringCandidate } from "@prowess/db";
import { apiSuccess, serializeForApi, toErrorResponse } from "../../../../src/api/index";
import { optString, readStrictBody } from "../../../../src/api/m2/index";
import { definitionField } from "../../../../src/api/compendium-authoring/input";

/**
 * POST /api/compendium-authoring/validate — validate an UNSAVED candidate Definition (PAS-10 M6-WO1 §41). Runs the M5
 * validation boundary and the read-only reference checks; persists nothing, assigns no identity, has no side effects.
 * Always 200 with `{ status: PASS | FAIL, issues, normalized, refused }` for a well-formed request: an invalid
 * Definition is a validation RESULT, not an HTTP error.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    const body = await readStrictBody(request, ["definitionKind", "entityType", "prowessDefinition"]);
    const result = await validateAuthoringCandidate({
      definitionKind: optString(body, "definitionKind"),
      entityType: optString(body, "entityType"),
      prowessDefinition: definitionField(body),
    });
    return apiSuccess(serializeForApi(result));
  } catch (error) {
    return toErrorResponse(error);
  }
}
