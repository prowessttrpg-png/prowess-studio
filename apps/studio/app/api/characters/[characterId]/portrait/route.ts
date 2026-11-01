import { PORTRAIT_MAX_BYTES, removeCharacterPortrait, uploadCharacterPortrait } from "@prowess/db";
import { ApiError, apiSuccess, parseUuidParam, serializeForApi, toErrorResponse } from "../../../../../src/api/index";
import { strictQuery } from "../../../../../src/api/m2/index";

/** Room for the multipart envelope around the file itself. */
const MULTIPART_OVERHEAD = 64 * 1024;

/**
 * POST /api/characters/:characterId/portrait — multipart `file` + `expectedVersion` (§9–§15, §88). The size is checked
 * before the body is read; the bytes are then validated by @prowess/db (signature + full decode; PNG / JPEG / WebP
 * only) and stored unmodified. Too large → 413; not a safe image → 422; stale → 409.
 */
export async function POST(request: Request, { params }: { params: Promise<{ characterId: string }> }): Promise<Response> {
  try {
    const { characterId } = await params;
    const id = parseUuidParam(characterId, "characterId");
    const length = Number(request.headers.get("content-length") ?? "0");
    if (Number.isFinite(length) && length > PORTRAIT_MAX_BYTES + MULTIPART_OVERHEAD) throw new ApiError("CHARACTER.PORTRAIT_TOO_LARGE", `The portrait is larger than ${PORTRAIT_MAX_BYTES / (1024 * 1024)} MB.`, 413, "file");
    if (!(request.headers.get("content-type") ?? "").toLowerCase().startsWith("multipart/form-data")) throw new ApiError("API.INVALID_BODY", "Upload the portrait as multipart/form-data with a `file` field", 400);
    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      throw new ApiError("API.INVALID_BODY", "The upload could not be read as multipart/form-data", 400);
    }
    for (const key of form.keys()) if (key !== "file" && key !== "expectedVersion") throw new ApiError("API.INVALID_BODY", `${key} is not an accepted field`, 400, key);
    const file = form.get("file");
    if (!(file instanceof Blob)) throw new ApiError("API.INVALID_BODY", "file is required", 400, "file");
    if (file.size > PORTRAIT_MAX_BYTES) throw new ApiError("CHARACTER.PORTRAIT_TOO_LARGE", `The portrait is larger than ${PORTRAIT_MAX_BYTES / (1024 * 1024)} MB.`, 413, "file");
    const rawVersion = form.get("expectedVersion");
    const expectedVersion = typeof rawVersion === "string" && /^\d+$/.test(rawVersion) ? Number(rawVersion) : rawVersion;
    const bytes = new Uint8Array(await file.arrayBuffer());
    return apiSuccess(serializeForApi(await uploadCharacterPortrait(id, { expectedVersion, bytes, declaredType: file.type === "" ? null : file.type })));
  } catch (error) {
    return toErrorResponse(error);
  }
}

/** DELETE /api/characters/:characterId/portrait?expectedVersion=N — removes the image; the placeholder returns. */
export async function DELETE(request: Request, { params }: { params: Promise<{ characterId: string }> }): Promise<Response> {
  try {
    const { characterId } = await params;
    const searchParams = new URL(request.url).searchParams;
    strictQuery(searchParams, ["expectedVersion"]);
    const raw = searchParams.get("expectedVersion");
    const expectedVersion = raw !== null && /^\d+$/.test(raw) ? Number(raw) : raw;
    return apiSuccess(serializeForApi(await removeCharacterPortrait(parseUuidParam(characterId, "characterId"), { expectedVersion })));
  } catch (error) {
    return toErrorResponse(error);
  }
}
