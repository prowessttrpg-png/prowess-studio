import { commitCharacterPlayOperation } from "@prowess/db";
import { apiSuccess, parseUuidParam, serializeForApi, toErrorResponse } from "../../../../../../src/api/index";
import { readStrictBody } from "../../../../../../src/api/m2/index";

/**
 * POST /api/characters/:characterId/play/operations — `{ operation, idempotencyKey, expectedRuntimeVersion,
 * expectedPlayStateVersion }` (PAS-10 M6-WO10 §16). The server re-evaluates and, only for a COMMITTABLE outcome, writes
 * the sheet values, the runtime and ONE ledger event atomically. A refused / pending / unsupported outcome is returned
 * with `committed: false`; a retried key returns the original event (`replayed: true`). Stale → 409; reused key with a
 * different operation → 409; malformed → 400.
 */
export async function POST(request: Request, { params }: { params: Promise<{ characterId: string }> }): Promise<Response> {
  try {
    const { characterId } = await params;
    const body = await readStrictBody(request, ["operation", "idempotencyKey", "expectedRuntimeVersion", "expectedPlayStateVersion"]);
    return apiSuccess(serializeForApi(await commitCharacterPlayOperation(parseUuidParam(characterId, "characterId"), { operation: body.operation, idempotencyKey: body.idempotencyKey, expectedRuntimeVersion: body.expectedRuntimeVersion, expectedPlayStateVersion: body.expectedPlayStateVersion })));
  } catch (error) {
    return toErrorResponse(error);
  }
}
