import { createHash } from "node:crypto";
import {
  ContentPackManifestError, decodeContentPackManifest, encodeContentPackManifest,
  MAX_MANIFEST_BYTES, MAX_PAYLOAD_BYTES, verifyContentPackReleaseComposition, type ManifestBody,
} from "./manifest.js";

const magic = Buffer.from("PROWESSPACK\x01", "ascii");
const headerSize = magic.length + 4;
export const MAX_CONTENT_PACK_BYTES = headerSize + MAX_MANIFEST_BYTES + MAX_PAYLOAD_BYTES;
export const sha256 = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");

/** Stored members follow manifest order. The format has no variable member headers or extraction paths. */
export function writeContentPack(body: ManifestBody, files: ReadonlyMap<string, Uint8Array>): Buffer {
  const manifestBytes = encodeContentPackManifest(body);
  const manifest = decodeContentPackManifest(manifestBytes);
  verifyContentPackReleaseComposition(manifest, files);
  const header = Buffer.alloc(headerSize);
  magic.copy(header);
  header.writeUInt32BE(manifestBytes.byteLength, magic.byteLength);
  return Buffer.concat([header, manifestBytes, ...manifest.files.map((file) => files.get(file.path)!)]);
}

export function readContentPack(input: Uint8Array) {
  if (input.byteLength > MAX_CONTENT_PACK_BYTES || input.byteLength < headerSize) {
    throw new ContentPackManifestError("Pack archive size is outside the supported limits");
  }
  const bytes = Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  if (!bytes.subarray(0, magic.length).equals(magic)) throw new ContentPackManifestError("Unsupported .prowesspack archive header");
  const size = bytes.readUInt32BE(magic.length);
  if (size > MAX_MANIFEST_BYTES || headerSize + size > bytes.byteLength) {
    throw new ContentPackManifestError("Pack archive has an invalid manifest size");
  }
  const manifest = decodeContentPackManifest(bytes.subarray(headerSize, headerSize + size));
  const files = new Map<string, Uint8Array>();
  let offset = headerSize + size;
  for (const file of manifest.files) {
    const end = offset + file.byteSize;
    if (end > bytes.byteLength) throw new ContentPackManifestError(`Truncated pack file: ${file.path}`);
    files.set(file.path, bytes.subarray(offset, end));
    offset = end;
  }
  if (offset !== bytes.byteLength) throw new ContentPackManifestError("Pack archive contains undeclared data");
  verifyContentPackReleaseComposition(manifest, files);
  return { manifest, files, archiveSha256: sha256(bytes) };
}
