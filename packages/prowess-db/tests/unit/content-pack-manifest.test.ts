import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { readContentPack, writeContentPack } from "../../src/content-pack/archive.js";
import { computeManifestHash } from "../../src/ruleset-release/hash.js";
import {
  decodeContentPackManifest,
  encodeContentPackManifest,
  verifyContentPackInventory,
  verifyContentPackReleaseComposition,
} from "../../src/content-pack/manifest.js";

const exampleId = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const publishedAt = "2026-01-01T00:00:00.000Z";
const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

function example() {
  const groups = ["canon-policies", "manifests", "releases", "rulesets"] as const;
  const payload = new Map(groups.map((kind, i) => [
    `records/${kind}.json`, Buffer.from(JSON.stringify([{ id: exampleId(i + 1) }])),
  ]));
  const body: Parameters<typeof encodeContentPackManifest>[0] = {
    format: "prowess.content-pack",
    formatVersion: 1,
    producerId: exampleId(5),
    label: "Example release",
    provenance: { claimedCreator: "Example producer", category: "sample" },
    release: {
      canonPolicyId: exampleId(1),
      manifestId: exampleId(2),
      releaseId: exampleId(3),
      rulesetId: exampleId(4),
      changeSetId: null,
      releaseNumber: 1,
      versionLabel: "Example 1",
      channel: "INTERNAL_PLAYTEST",
      manifestHash: "f".repeat(64),
      releaseNotes: null,
      publishedAt,
    },
    compatibility: { capabilities: ["prowess.exact-release.v1"], definitionSchemas: [] },
    files: groups.map((kind) => {
      const path = `records/${kind}.json`;
      const bytes = payload.get(path)!;
      return { type: "records", kind, path, byteSize: bytes.length, recordCount: 1, sha256: sha256(bytes) };
    }),
  };
  return { body, payload };
}

describe("DIST-WO2 content pack manifest and byte inventory", () => {
  it("round-trips an exact Release and verifies every inventory file", () => {
    const { body, payload } = example();
    const manifest = decodeContentPackManifest(encodeContentPackManifest(body));
    expect(manifest.release).toEqual(body.release);
    expect(manifest.contentDigest).toBe("f8c61b9cc65d3bb3d0f84075505ff8f449b72f5e3666ee64bcb1267b7b548036");
    expect(() => verifyContentPackInventory(manifest, payload)).not.toThrow();
  });

  it("keeps content identity across export dates but changes it when file bytes change", () => {
    const { body } = example();
    const original = decodeContentPackManifest(encodeContentPackManifest(body));
    const second = decodeContentPackManifest(encodeContentPackManifest({ ...body, exportedAt: publishedAt }));
    expect(second.contentDigest).toBe(original.contentDigest);
    body.files[0]!.sha256 = "0".repeat(64);
    const changed = decodeContentPackManifest(encodeContentPackManifest(body));
    expect(changed.contentDigest).not.toBe(original.contentDigest);
    expect(changed.release.manifestHash).toBe(original.release.manifestHash);
  });

  it("rejects tampered headers, equivalent but noncanonical bytes, and duplicate JSON keys", () => {
    const through = (text: string) => decodeContentPackManifest(Buffer.from(text));
    const written = Buffer.from(encodeContentPackManifest(example().body)).toString("utf8");
    expect(() => through(written.replace("Example release", "Changed release"))).toThrow(/digest/);
    expect(() => through(`${written}\n`)).toThrow(/canonical JSON/);
    expect(() => through(`{"formatVersion":1,${written.slice(1)}`)).toThrow(/canonical JSON/);
    expect(() => decodeContentPackManifest(new Uint8Array([0xff]))).toThrow(/UTF-8/);
    expect(() => decodeContentPackManifest(new Uint8Array(262_145))).toThrow(/size limit/);
  });

  it("rejects archive path aliases, executable groups, a backup discriminator and unknown fields", () => {
    const written = Buffer.from(encodeContentPackManifest(example().body)).toString("utf8");
    const read = (text: string) => decodeContentPackManifest(Buffer.from(text));
    expect(() => read(written.replace("prowess.content-pack", "prowess.workspace-backup"))).toThrow(/format/);
    expect(() => read(written.replace('"formatVersion":1', '"formatVersion":2'))).toThrow(/formatVersion/);
    expect(() => read(written.replace('"kind":"releases"', '"kind":"install-script"'))).toThrow(/kind/);
    expect(() => read(written.replace('"category":"sample"', '"category":"official","verified":true'))).toThrow(/provenance/);
    for (const path of ["../releases.json", "records\\releases.json", "Records/releases.json", "C:/releases.json", "records/rels.json"]) {
      const { body } = example();
      body.files[2]!.path = path;
      expect(() => encodeContentPackManifest(body)).toThrow(/paths|payload path/);
    }
    const { body } = example();
    body.files.splice(2, 0, body.files[2]!);
    expect(() => encodeContentPackManifest(body)).toThrow(/unique/);
  });

  it("checks declared Definition versions and capabilities through the existing registry", () => {
    const { body } = example();
    body.compatibility.definitionSchemas = [{ kind: "AFFINITY", family: "AFFINITY", schemaVersion: 2 }];
    expect(() => encodeContentPackManifest(body)).toThrow(/Capabilities/);
    body.compatibility.capabilities.push("prowess.structured-definitions.v1");
    expect(() => encodeContentPackManifest(body)).not.toThrow();
    body.compatibility.definitionSchemas[0]!.schemaVersion = 99;
    expect(() => encodeContentPackManifest(body)).toThrow(/Unsupported Definition schema: AFFINITY\/AFFINITY@99/);
    const encoded = Buffer.from(encodeContentPackManifest(example().body)).toString("utf8");
    expect(() => decodeContentPackManifest(Buffer.from(encoded.replace("prowess.exact-release.v1", "unknown-engine")))).toThrow(/capabilities/);
  });

  it("rejects missing groups, an extra Release, oversized record inventories and unsupported media", () => {
    const { body } = example();
    body.files[2] = { type: "records", kind: "releases", path: "records/releases.json", recordCount: 2, byteSize: 10, sha256: "a".repeat(64) };
    expect(() => encodeContentPackManifest(body)).toThrow(/exactly one/);
    body.files[2] = { type: "records", kind: "entities", path: "records/entities.json", recordCount: 1, byteSize: 10, sha256: "a".repeat(64) };
    [body.files[1], body.files[2]] = [body.files[2]!, body.files[1]!];
    expect(() => encodeContentPackManifest(body)).toThrow(/Missing required record group: releases/);
    const oversize = example().body;
    for (const file of oversize.files) if (file.type === "records") file.recordCount = 50_000;
    const releaseGroup = oversize.files[2]!;
    if (releaseGroup.type === "records") releaseGroup.recordCount = 1;
    expect(() => encodeContentPackManifest(oversize)).toThrow(/inventory exceeds/);
    const encoded = Buffer.from(encodeContentPackManifest(example().body)).toString("utf8");
    const svg = { type: "asset", path: `assets/${"a".repeat(64)}.svg`, byteSize: 1, sha256: "a".repeat(64), mediaType: "image/svg+xml" };
    expect(() => decodeContentPackManifest(Buffer.from(encoded.replace('"files":[', `"files":[${JSON.stringify(svg)},`)))).toThrow(/mediaType/);
  });

  it("rejects undeclared files, missing files and altered bytes at the same path and size", () => {
    const { body, payload } = example();
    const manifest = decodeContentPackManifest(encodeContentPackManifest(body));
    payload.set("scripts/install.js", Buffer.from("x"));
    expect(() => verifyContentPackInventory(manifest, payload)).toThrow(/file count/);
    const name = "records/releases.json";
    payload.delete(name);
    expect(() => verifyContentPackInventory(manifest, payload)).toThrow(/Missing payload file/);
    payload.delete("scripts/install.js");
    payload.set(name, Buffer.alloc(body.files[2]!.byteSize));
    expect(() => verifyContentPackInventory(manifest, payload)).toThrow(/Payload bytes/);
  });

  it("checks exact pins against the original Release hash even when a changed pack is rehashed", () => {
    const { body, payload } = example();
    const pin = {
      createdAt: publishedAt, entityId: exampleId(6), entityVersionId: exampleId(7),
      id: exampleId(8), manifestId: body.release.manifestId,
    };
    body.release.manifestHash = sha256(Buffer.from(`PROWESS_MANIFEST_V1\n${pin.entityId}:${pin.entityVersionId}\n`));
    const path = "records/manifest-entries.json";
    const setEntries = (entries: typeof pin[]) => {
      const bytes = Buffer.from(JSON.stringify(entries));
      payload.set(path, bytes);
      body.files[1] = { type: "records", kind: "manifest-entries", path, byteSize: bytes.length, recordCount: entries.length, sha256: sha256(bytes) };
      return decodeContentPackManifest(encodeContentPackManifest(body));
    };
    body.files.splice(1, 0, body.files[1]!);
    const otherManifestPin = { ...pin, id: exampleId(9), manifestId: exampleId(10) };
    const original = setEntries([pin, otherManifestPin]);
    expect(() => verifyContentPackReleaseComposition(original, payload)).not.toThrow();

    const changed = setEntries([{ ...pin, entityVersionId: exampleId(11) }, otherManifestPin]);
    expect(() => verifyContentPackInventory(changed, payload)).not.toThrow();
    expect(() => verifyContentPackReleaseComposition(changed, payload)).toThrow(/original manifest hash/);

    const duplicate = setEntries([pin, { ...pin, id: exampleId(12) }]);
    expect(() => verifyContentPackReleaseComposition(duplicate, payload)).toThrow(/Duplicate Release pin/);
  });

  it("round-trips byte-identical framed archives without trailing, encrypted or truncated member data", () => {
    const { body, payload } = example();
    body.release.manifestHash = computeManifestHash([]);
    const encoded = writeContentPack(body, payload);
    expect(writeContentPack(body, payload)).toEqual(encoded);
    const decoded = readContentPack(encoded);
    expect(decoded.archiveSha256).toBe(sha256(encoded));
    expect(decoded.files).toEqual(payload);
    expect(() => readContentPack(encoded.subarray(0, -1))).toThrow(/Truncated pack file/);
    expect(() => readContentPack(Buffer.concat([encoded, Buffer.from([0])]))).toThrow(/undeclared data/);
    expect(() => readContentPack(Buffer.concat([Buffer.from("PK\x03\x04"), encoded]))).toThrow(/Unsupported .* header/);
    const unsafeLength = Buffer.from(encoded);
    unsafeLength.writeUInt32BE(0xffffffff, 12);
    expect(() => readContentPack(unsafeLength)).toThrow(/invalid manifest size/);
    const tampered = Buffer.from(encoded);
    tampered[tampered.length - 1] = tampered[tampered.length - 1]! ^ 1;
    expect(() => readContentPack(tampered)).toThrow(/Payload bytes/);
  });
});
