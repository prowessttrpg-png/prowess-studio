/**
 * Reads intrinsic pixel dimensions from an image's own header (PNG, JPEG, GIF, BMP) — source-native metadata, never
 * computed by rendering, and never an analysis of what the image depicts. Unknown or truncated formats yield nulls.
 */
export interface ImageDimensions {
  width: number | null;
  height: number | null;
}

const NONE: ImageDimensions = { width: null, height: null };
const positive = (w: number, h: number): ImageDimensions => (w > 0 && h > 0 ? { width: w, height: h } : NONE);

export function readImageDimensions(bytes: Buffer): ImageDimensions {
  try {
    // PNG: signature + IHDR
    if (bytes.length >= 24 && bytes.readUInt32BE(0) === 0x89504e47 && bytes.toString("ascii", 12, 16) === "IHDR") {
      return positive(bytes.readUInt32BE(16), bytes.readUInt32BE(20));
    }
    // GIF
    if (bytes.length >= 10 && bytes.toString("ascii", 0, 3) === "GIF") {
      return positive(bytes.readUInt16LE(6), bytes.readUInt16LE(8));
    }
    // BMP
    if (bytes.length >= 26 && bytes.toString("ascii", 0, 2) === "BM") {
      return positive(Math.abs(bytes.readInt32LE(18)), Math.abs(bytes.readInt32LE(22)));
    }
    // JPEG: walk segments to the first SOFn
    if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
      let p = 2;
      while (p + 9 < bytes.length) {
        if (bytes[p] !== 0xff) return NONE;
        const marker = bytes[p + 1] as number;
        if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
          p += 2;
          continue;
        }
        const length = bytes.readUInt16BE(p + 2);
        const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
        if (isSof) return positive(bytes.readUInt16BE(p + 7), bytes.readUInt16BE(p + 5));
        p += 2 + length;
      }
    }
  } catch {
    // A truncated header is simply "dimensions unavailable".
  }
  return NONE;
}
