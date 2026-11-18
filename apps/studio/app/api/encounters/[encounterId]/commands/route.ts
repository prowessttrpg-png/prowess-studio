import { commandEncounter } from "@prowess/db";
import { apiSuccess, parseUuidParam, serializeForApi, toErrorResponse } from "../../../../../src/api/index";
import { readStrictBody } from "../../../../../src/api/m2/index";

/**
 * POST /api/encounters/:encounterId/commands — `{ command, expectedVersion, idempotencyKey }` (M7-WO1). One closed
 * roster / lifecycle command: UPDATE_METADATA, ADD_SIDE, RENAME_SIDE, REMOVE_SIDE, ADD_PARTICIPANT, MOVE_PARTICIPANT,
 * REMOVE_PARTICIPANT or ARCHIVE. The server re-reads and decides; the change and one history event commit atomically
 * under the encounter's version. Stale → 409; reused key with another request → 409; archived → 409; malformed → 400.
 */
export async function POST(request: Request, { params }: { params: Promise<{ encounterId: string }> }): Promise<Response> {
  try {
    const { encounterId } = await params;
    const body = await readStrictBody(request, ["command", "expectedVersion", "idempotencyKey"]);
    return apiSuccess(serializeForApi(await commandEncounter(parseUuidParam(encounterId, "encounterId"), { command: body.command, expectedVersion: body.expectedVersion, idempotencyKey: body.idempotencyKey })));
  } catch (error) {
    return toErrorResponse(error);
  }
}
