import { timingSafeEqual } from "node:crypto";
import { ContentPackInstallConflict, ContentPackManifestError, MAX_CONTENT_PACK_BYTES } from "@prowess/db/content-packs";
import { toErrorResponse } from "./index";

export function desktopContentPacksEnabled(request: Request): boolean {
  const token = process.env.PROWESS_DESKTOP_BACKEND_TOKEN;
  const supplied = request.headers.get("x-prowess-desktop-backend");
  return process.env.PROWESS_DESKTOP_MODE === "true" && !!token && !!supplied &&
    /^[a-f0-9]{64}$/.test(token) && /^[a-f0-9]{64}$/.test(supplied) &&
    timingSafeEqual(Buffer.from(token, "hex"), Buffer.from(supplied, "hex"));
}

export const contentPacksUnavailable = () => Response.json({ error: "Open Content Packs from the desktop launcher." }, { status: 403 });

export async function readContentPackUpload(request: Request): Promise<Uint8Array> {
  const length = request.headers.get("content-length");
  if (!request.body || length !== null && (!/^\d+$/.test(length) || Number(length) > MAX_CONTENT_PACK_BYTES)) {
    throw new ContentPackManifestError("The pack file exceeds the upload limit or is missing");
  }
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > MAX_CONTENT_PACK_BYTES) {
        await reader.cancel();
        throw new ContentPackManifestError("The pack file exceeds the upload limit");
      }
      chunks.push(value);
    }
    return Buffer.concat(chunks, received);
  } finally {
    reader.releaseLock();
  }
}

export function contentPackError(error: unknown): Response {
  if (error instanceof ContentPackInstallConflict) return Response.json({ error: error.message, preview: error.preview }, { status: 409 });
  if (error instanceof ContentPackManifestError) return Response.json({ error: error.message }, { status: 422 });
  return toErrorResponse(error);
}
