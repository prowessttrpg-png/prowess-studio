import { createSourceDocument, listSourceDocuments } from "@prowess/db";
import {
  apiSuccess,
  parseJsonBody,
  requireObjectBody,
  serializeForApi,
  toErrorResponse,
} from "../../../src/api/index";

/** GET /api/source-documents — list (PAS-10 M1-WO8 §21). No file upload/parsing anywhere here. */
export async function GET(): Promise<Response> {
  try {
    const documents = await listSourceDocuments();
    return apiSuccess(serializeForApi(documents));
  } catch (error) {
    return toErrorResponse(error);
  }
}

/** POST /api/source-documents — create a provenance record (PAS-10 M1-WO8 §21). */
export async function POST(request: Request): Promise<Response> {
  try {
    const body = requireObjectBody(await parseJsonBody(request));
    const document = await createSourceDocument({
      title: body.title as string,
      sourceType: body.sourceType as string,
      versionLabel: body.versionLabel as string | null | undefined,
      authorityStatus: body.authorityStatus as string | null | undefined,
      fileReference: body.fileReference as string | null | undefined,
      notes: body.notes as string | null | undefined,
    });
    return apiSuccess(serializeForApi(document), 201);
  } catch (error) {
    return toErrorResponse(error);
  }
}
