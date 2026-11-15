# `.prowesspack` v1 manifest

The format has a root `manifest.json` followed by the manifest's listed payload entries. The [machine-readable manifest schema](../../packages/prowess-db/src/content-pack/manifest.ts) is shared by the writer and verifier. The transport, record schemas and graph validation follow the [portable records map](../architecture/dist-wo2-content-packs.md).

| Field | v1 representation |
| --- | --- |
| `format`, `formatVersion` | `prowess.content-pack`, integer `1`. Independent of application and Release versions. |
| `producerId`, `label` | Stable producer UUID, human-readable pack label. A producer ID describes provenance and grants no privileges. |
| `provenance` | Claimed creator and claimed category (`sample`, `community`, `official`). Verification status is assigned by the receiver and excluded from the producer schema. |
| `release` | Original Ruleset, Release, manifest, policy and optional ChangeSet UUIDs. Retains Release number, label, channel, original manifest digest, notes and publication timestamp. Labels are compared as authored strings. |
| `compatibility` | `prowess.exact-release.v1`, plus `prowess.structured-definitions.v1` when Definitions are declared. Definition heads contain family, kind and schema version. The receiver checks actual Definitions and references after envelope validation. |
| `files` | Sorted inventory by ASCII path. Each record group uses `records/<kind>.json` with raw byte size, record count and SHA-256. Each asset uses `assets/<sha256>.<extension>` with byte size, hash and MIME. JPEG uses `jpg`, PNG uses `png`, and WebP uses `webp`. |
| `exportedAt`, `contentDigest` | Optional export timestamp outside content identity, plus the mandatory digest over the remaining fields. Timestamps are UTC with three fractional digits. |

The selected Release, Ruleset, manifest and canon policy groups are mandatory. The Release group contains exactly one record. Other groups are present when they contain portable records. Definitions are ordered by the UTF-16 code-unit order of `kind:schemaVersion`. Capabilities, Definition tuples and paths are unique. UUIDs and hash strings use lowercase hexadecimal.

The manifest is UTF-8 canonical JSON with no BOM, trailing newline or other insignificant whitespace. It uses the existing canonical serializer. Keys sort by UTF-16 code unit, array order is preserved, and strings retain their original Unicode form. Comparing parsed canonical JSON to the original bytes rejects repeated keys and alternate representations. A manifest can declare at most 512 payload files and 100,000 total records, with a 128 MiB total payload limit. The manifest itself is capped at 256 KiB. A record file is capped at 32 MiB and an asset at 16 MiB. Archive decoding and asset decoding enforce their own input, expansion and output limits before handing bytes to the manifest verifier.

```text
contentDigest = SHA-256(UTF-8("PROWESS_CONTENT_PACK_V1\n" + canonicalJSON(manifest excluding contentDigest and exportedAt)))
```

The digest incorporates all inventoried byte hashes and sizes, the exact Release metadata, compatibility and producer claims. Exporting the same protected data and metadata gives the same digest regardless of export time. A changed rule payload changes its file hash and therefore the pack digest, even when the original Release pin digest stays the same. Whole-file SHA-256 covers the archive bytes, including container metadata. Neither hash verifies the source's authorship.

When present, `records/manifest-entries.json` is a canonical JSON array of `id`, `manifestId`, `entityId`, `entityVersionId` and `createdAt` records. The verifier selects pins by the original Release manifest UUID, rejects duplicate Entities in that composition, and recomputes `PROWESS_MANIFEST_V1` with the existing Release hash function. Entries for ancillary manifests do not contribute to the selected Release's original hash. The record graph stage checks manifest ownership and that each exact revision belongs to its named Entity.

## Archive framing

A v1 file begins with the eleven ASCII bytes `PROWESSPACK`, followed by byte `01` and an unsigned four-byte big-endian manifest length. The canonical manifest follows immediately. Payload bytes follow in manifest inventory order and use exactly the declared sizes. The file ends after the last member. Every member is stored at a 1:1 ratio. The framing has no independent member paths, compression, encryption, links, or nested archives, and the reader never extracts files to disk. Repeated exports from the same snapshot and producer metadata are byte-identical.

Every record member is a canonical JSON array ordered by its primary identity tuple. Exports preserve the authored and exact relationship identities documented in the architecture. Private source file references, notes, and excerpts are excluded. For provenance with an archived source locator, the pack transports the original UUIDs and source snapshot hash as metadata. The installer stores that locator separately from the receiver's source archive.
