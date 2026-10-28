import { submitAuthoredRevisionForReview } from "@prowess/db";
import { apiSuccess, parseUuidParam, serializeForApi, toErrorResponse } from "../../../../../../src/api/index";
import { requireNoBody } from "../../../../../../src/api/m2/index";

/**
 * POST /api/compendium-authoring/entity-versions/:versionId/submit-review — DRAFT → IN_REVIEW through the M1 lifecycle,
 * only for a Definition that passes validation (PAS-10 M6-WO1 §16). Not publication: no Ruleset is touched.
 */
export async function POST(request: Request, { params }: { params: Promise<{ versionId: string }> }): Promise<Response> {
  try {
    const { versionId } = await params;
    const id = parseUuidParam(versionId, "versionId");
    await requireNoBody(request);
    return apiSuccess(serializeForApi(await submitAuthoredRevisionForReview(id)));
  } catch (error) {
    return toErrorResponse(error);
  }
}
