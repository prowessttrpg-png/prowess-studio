import { inflateRawSync } from "node:zlib";

/**
 * Minimal, dependency-free ZIP reader for structural source ingestion (PAS-10 M3-WO1).
 *
 * Reads the central directory and extracts entries stored (method 0) or deflated (method 8) — the only two
 * methods OOXML (DOCX) containers use. Deterministic and side-effect free. Anything else — a truncated archive,
 * ZIP64, encryption, an unknown method — is reported as a `ZipFormatError`, which the DOCX parser turns into the
 * controlled SOURCE_PARSE.MALFORMED_SOURCE error. It never writes anything anywhere.
 */
export class ZipFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ZipFormatError";
  }
}

interface ZipEntry {
  name: string;
  method: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
  flags: number;
}

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;

export class ZipArchive {
  private readonly entries = new Map<string, ZipEntry>();

  constructor(private readonly bytes: Buffer) {
    if (bytes.length < 22) throw new ZipFormatError("not a ZIP archive (too short)");
    // The end-of-central-directory record is within the last 64 KiB + 22 bytes.
    let eocd = -1;
    for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65_557); i -= 1) {
      if (bytes.readUInt32LE(i) === EOCD_SIGNATURE) {
        eocd = i;
        break;
      }
    }
    if (eocd < 0) throw new ZipFormatError("not a ZIP archive (no end-of-central-directory record)");
    const count = bytes.readUInt16LE(eocd + 10);
    const size = bytes.readUInt32LE(eocd + 12);
    const offset = bytes.readUInt32LE(eocd + 16);
    if (count === 0xffff || offset === 0xffffffff) throw new ZipFormatError("ZIP64 archives are not supported");
    if (offset + size > bytes.length) throw new ZipFormatError("central directory lies outside the archive");

    let p = offset;
    for (let n = 0; n < count; n += 1) {
      if (p + 46 > bytes.length || bytes.readUInt32LE(p) !== CENTRAL_SIGNATURE) throw new ZipFormatError("corrupt central directory");
      const flags = bytes.readUInt16LE(p + 8);
      const method = bytes.readUInt16LE(p + 10);
      const compressedSize = bytes.readUInt32LE(p + 20);
      const uncompressedSize = bytes.readUInt32LE(p + 24);
      const nameLength = bytes.readUInt16LE(p + 28);
      const extraLength = bytes.readUInt16LE(p + 30);
      const commentLength = bytes.readUInt16LE(p + 32);
      const localHeaderOffset = bytes.readUInt32LE(p + 42);
      const name = bytes.toString("utf8", p + 46, p + 46 + nameLength);
      this.entries.set(name, { name, method, compressedSize, uncompressedSize, localHeaderOffset, flags });
      p += 46 + nameLength + extraLength + commentLength;
    }
  }

  /** Entry names in central-directory order. */
  names(): string[] {
    return [...this.entries.keys()];
  }

  has(name: string): boolean {
    return this.entries.has(name);
  }

  /** The entry's exact uncompressed bytes, or null when absent. */
  read(name: string): Buffer | null {
    const entry = this.entries.get(name);
    if (!entry) return null;
    if (entry.flags & 0x1) throw new ZipFormatError(`entry ${name} is encrypted`);
    const p = entry.localHeaderOffset;
    if (p + 30 > this.bytes.length || this.bytes.readUInt32LE(p) !== LOCAL_SIGNATURE) throw new ZipFormatError(`corrupt local header for ${name}`);
    const start = p + 30 + this.bytes.readUInt16LE(p + 26) + this.bytes.readUInt16LE(p + 28);
    const end = start + entry.compressedSize;
    if (end > this.bytes.length) throw new ZipFormatError(`entry ${name} is truncated`);
    const raw = this.bytes.subarray(start, end);
    let out: Buffer;
    if (entry.method === 0) out = Buffer.from(raw);
    else if (entry.method === 8) {
      try {
        out = inflateRawSync(raw);
      } catch (error) {
        throw new ZipFormatError(`entry ${name} could not be inflated: ${(error as Error).message}`);
      }
    } else throw new ZipFormatError(`entry ${name} uses unsupported compression method ${entry.method}`);
    if (out.length !== entry.uncompressedSize) throw new ZipFormatError(`entry ${name} has the wrong uncompressed size`);
    return out;
  }

  readText(name: string): string | null {
    const bytes = this.read(name);
    return bytes === null ? null : bytes.toString("utf8").replace(/^\uFEFF/, "");
  }
}
