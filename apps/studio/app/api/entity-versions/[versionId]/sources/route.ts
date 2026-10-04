import { createSourceReference, listSourceReferencesForVersion } from "@prowess/db";
import {
  apiSuccess,
  parseJsonBody,
  parseUuidParam,
  requireObjectBody,
  serializeForApi,
  toErrorResponse,
} from "../../../../../src/api/index";

/** GET /api/entity-versions/:versionId/sources — provenance for this Version (PAS-10 M1-WO8 §22). */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ versionId: string }> },
): Promise<Response> {
  try {
    const { versionId } = await params;
    const id = parseUuidParam(versionId, "versionId");
    const references = await listSourceReferencesForVersion(id);
    return apiSuccess(serializeForApi(references));
  } catch (error) {
    return toErrorResponse(error);
  }
}

/**
 * POST /api/entity-versions/:versionId/sources — attach provenance
 * (PAS-10 M1-WO8 §22). Not gated by DRAFT/CANON lifecycle status —
 * `createSourceReference` itself is deliberately lifecycle-independent
 * (M1-WO7); this route does not add a restriction that doesn't exist
 * below it.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ versionId: string }> },
): Promise<Response> {
  try {
    const { versionId } = await params;
    const id = parseUuidParam(versionId, "versionId");
    const body = requireObjectBody(await parseJsonBody(request));

    const sourceDocumentId = parseUuidParam(body.sourceDocumentId as string, "sourceDocumentId");
    const reference = await createSourceReference(id, {
      sourceDocumentId,
      sectionLabel: body.sectionLabel as string | null | undefined,
      pageReference: body.pageReference as string | null | undefined,
      sourceExcerptNote: body.sourceExcerptNote as string | null | undefined,
    });
    return apiSuccess(serializeForApi(reference), 201);
  } catch (error) {
    return toErrorResponse(error);
  }
}
