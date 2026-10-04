import { getSourceDocument } from "@prowess/db";
import { apiSuccess, parseUuidParam, serializeForApi, toErrorResponse } from "../../../../src/api/index";

/** GET /api/source-documents/:sourceDocumentId (PAS-10 M1-WO8 §21). */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ sourceDocumentId: string }> },
): Promise<Response> {
  try {
    const { sourceDocumentId } = await params;
    const id = parseUuidParam(sourceDocumentId, "sourceDocumentId");
    const document = await getSourceDocument(id);
    return apiSuccess(serializeForApi(document));
  } catch (error) {
    return toErrorResponse(error);
  }
}
