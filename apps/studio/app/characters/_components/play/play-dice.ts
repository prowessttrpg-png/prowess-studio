/**
 * PAS-10 M6-WO10 §12 — the OPTIONAL digital dice convenience. It only generates raw die faces (uniformly, by rejection
 * sampling over the platform CSPRNG — never Math.random, never modulo-biased) that the player can see and edit; the face
 * values are then submitted as an ordinary gameplay input. The server's M4 / M5 evaluation decides every total, success
 * and critical; nothing here is mechanics and nothing here is certified.
 */
export function rollFaces(faces: number, count: number): number[] {
  if (!Number.isSafeInteger(faces) || faces < 2 || faces > 1000 || !Number.isSafeInteger(count) || count < 1 || count > 2) throw new Error("rollFaces: 2–1000 faces, 1–2 dice");
  const limit = 0x100000000 - (0x100000000 % faces); // the largest multiple of `faces` below 2^32: values above it are rejected
  const out: number[] = [];
  const buffer = new Uint32Array(1);
  while (out.length < count) {
    globalThis.crypto.getRandomValues(buffer);
    const v = buffer[0] as number;
    if (v < limit) out.push((v % faces) + 1);
  }
  return out;
}
