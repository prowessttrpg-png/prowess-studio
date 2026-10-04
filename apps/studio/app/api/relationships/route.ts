import { createEntityRelationship } from "@prowess/db";
import type { JsonObject } from "@prowess/model";
import {
  apiSuccess,
  parseJsonBody,
  requireObjectBody,
  serializeForApi,
  toErrorResponse,
} from "../../../src/api/index";

/**
 * POST /api/relationships — create (PAS-10 M1-WO8 §19). Self-reference,
 * type validity, and source/target existence are all validated inside
 * `createEntityRelationship` itself (M1-WO6) — never re-implemented here.
 * Never auto-creates an inverse relationship.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    const body = requireObjectBody(await parseJsonBody(request));
    const relationship = await createEntityRelationship({
      sourceEntityId: body.sourceEntityId as string,
      targetEntityId: body.targetEntityId as string,
      relationshipType: body.relationshipType as string,
      metadata: body.metadata as JsonObject | undefined,
    });
    return apiSuccess(serializeForApi(relationship), 201);
  } catch (error) {
    return toErrorResponse(error);
  }
}
