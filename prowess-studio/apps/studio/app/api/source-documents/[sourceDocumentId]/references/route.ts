import { listSourceReferencesForDocument } from "@prowess/db";
import { apiSuccess, parseUuidParam, serializeForApi, toErrorResponse } from "../../../../../src/api/index";

/**
 * GET /api/source-documents/:sourceDocumentId/references — every
 * SourceReference pointing at this document, across any EntityVersion
 * (PAS-10 M1-WO8 §22, optional route — maps directly onto the existing
 * `listSourceReferencesForDocument`).
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ sourceDocumentId: string }> },
): Promise<Response> {
  try {
    const { sourceDocumentId } = await params;
    const id = parseUuidParam(sourceDocumentId, "sourceDocumentId");
    const references = await listSourceReferencesForDocument(id);
    return apiSuccess(serializeForApi(references));
  } catch (error) {
    return toErrorResponse(error);
  }
}
