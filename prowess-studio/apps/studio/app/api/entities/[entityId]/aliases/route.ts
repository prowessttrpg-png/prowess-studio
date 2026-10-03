import { createEntityAlias, listEntityAliases } from "@prowess/db";
import {
  apiSuccess,
  parseJsonBody,
  parseUuidParam,
  requireObjectBody,
  serializeForApi,
  toErrorResponse,
} from "../../../../../src/api/index";

/** GET /api/entities/:entityId/aliases — list (PAS-10 M1-WO8 §15). */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ entityId: string }> },
): Promise<Response> {
  try {
    const { entityId } = await params;
    const id = parseUuidParam(entityId, "entityId");
    const aliases = await listEntityAliases(id);
    return apiSuccess(serializeForApi(aliases));
  } catch (error) {
    return toErrorResponse(error);
  }
}

/** POST /api/entities/:entityId/aliases — create (PAS-10 M1-WO8 §15). */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ entityId: string }> },
): Promise<Response> {
  try {
    const { entityId } = await params;
    const id = parseUuidParam(entityId, "entityId");
    const body = requireObjectBody(await parseJsonBody(request));

    const alias = await createEntityAlias(id, {
      alias: body.alias as string,
      context: body.context as string | null | undefined,
    });
    return apiSuccess(serializeForApi(alias), 201);
  } catch (error) {
    return toErrorResponse(error);
  }
}
