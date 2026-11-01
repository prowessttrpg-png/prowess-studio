import { createHash } from "node:crypto";
import sharp from "sharp";

/**
 * Character portrait validation (PAS-10 M6-WO5 §10–§11, §88). An upload is untrusted bytes. It is accepted only when:
 *
 *   1. its size is within PORTRAIT_MAX_BYTES;
 *   2. its magic bytes are a PNG, JPEG or WebP signature (the filename and the browser's declared type are never
 *      trusted on their own — a declared type must AGREE with the signature);
 *   3. sharp fully decodes it as that same format (a truncated or corrupt image is refused), within a pixel limit.
 *
 * SVG and every other format are refused (no scriptable image type is ever stored). The bytes are stored exactly as
 * uploaded — never re-encoded, cropped or resized; framing is applied visually (nondestructive, §12).
 */

export const PORTRAIT_MAX_BYTES = 8 * 1024 * 1024;
const PORTRAIT_MAX_PIXELS = 40_000_000;

export const PORTRAIT_MIME_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;
export type PortraitMimeType = (typeof PORTRAIT_MIME_TYPES)[number];

const SHARP_FORMAT: Record<PortraitMimeType, string> = { "image/png": "png", "image/jpeg": "jpeg", "image/webp": "webp" };

export type PortraitCheck =
  | { readonly ok: true; readonly mimeType: PortraitMimeType; readonly width: number; readonly height: number; readonly byteSize: number; readonly contentHash: string }
  | { readonly ok: false; readonly reason: "TOO_LARGE" | "EMPTY" | "UNSUPPORTED_TYPE" | "TYPE_MISMATCH" | "CORRUPT"; readonly message: string };

const startsWith = (b: Uint8Array, sig: readonly number[], at = 0) => sig.every((v, i) => b[at + i] === v);

/** The format the magic bytes say, or null for anything that is not PNG / JPEG / WebP. */
export function sniffPortraitType(bytes: Uint8Array): PortraitMimeType | null {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)) return "image/webp";
  return null;
}

export async function checkPortraitImage(bytes: Uint8Array, declaredType: string | null): Promise<PortraitCheck> {
  if (bytes.byteLength === 0) return { ok: false, reason: "EMPTY", message: "The portrait file is empty." };
  if (bytes.byteLength > PORTRAIT_MAX_BYTES) return { ok: false, reason: "TOO_LARGE", message: `The portrait is larger than ${PORTRAIT_MAX_BYTES / (1024 * 1024)} MB.` };
  const sniffed = sniffPortraitType(bytes);
  if (sniffed === null) return { ok: false, reason: "UNSUPPORTED_TYPE", message: "A portrait must be a PNG, JPEG or WebP image." };
  const declared = declaredType === null || declaredType === "" ? null : declaredType.toLowerCase() === "image/jpg" ? "image/jpeg" : declaredType.toLowerCase();
  if (declared !== null && declared !== "application/octet-stream" && declared !== sniffed) return { ok: false, reason: "TYPE_MISMATCH", message: `The file says it is ${declared} but its contents are ${sniffed}.` };
  try {
    const decoded = await sharp(Buffer.from(bytes), { failOn: "error", limitInputPixels: PORTRAIT_MAX_PIXELS, animated: false }).raw().toBuffer({ resolveWithObject: true });
    const meta = await sharp(Buffer.from(bytes), { failOn: "error", limitInputPixels: PORTRAIT_MAX_PIXELS }).metadata();
    if (meta.format !== SHARP_FORMAT[sniffed] || decoded.info.width < 1 || decoded.info.height < 1) return { ok: false, reason: "CORRUPT", message: "The portrait could not be decoded as an image." };
    const oriented = meta.autoOrient ?? { width: meta.width ?? decoded.info.width, height: meta.height ?? decoded.info.height };
    return { ok: true, mimeType: sniffed, width: oriented.width, height: oriented.height, byteSize: bytes.byteLength, contentHash: createHash("sha256").update(bytes).digest("hex") };
  } catch {
    return { ok: false, reason: "CORRUPT", message: "The portrait could not be decoded as an image." };
  }
}
