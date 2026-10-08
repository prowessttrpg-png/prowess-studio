# Structured Source Layer (M3-WO1)

**Status: implemented; awaiting CI verification.** Source Document & Source Structure Foundation — the first M3 Work
Order. It expands M1-WO7's minimal provenance foundation (`SourceDocument` → `SourceReference` → `EntityVersion`,
see `source-provenance-model.md`) into an immutable structured-source layer that can represent real Prowess documents
**before** any semantic extraction exists.

> **Source structure records what a source says and where it says it.
> It does not determine whether that source is Canon.**

Nothing in this layer reads, sets or implies authority. `SourceDocument.authorityStatus` (M1, descriptive) and
Ruleset-scoped `SourceAuthorityRecord`s (M2-WO4) are untouched and never consulted. A Snapshot's declared version
("V0.1") and declared draft state ("Playtest") are what the source *says about itself* — recorded verbatim, never
acted on, never inferred from a filename.

## Hierarchy

```
SourceDocument                      stable conceptual identity (M1-WO7, unchanged)
  │
  ├── SourceSnapshot V0.1           one exact revision of the bytes   (sourceDocumentId, contentHash) unique
  │     ├── SourceSnapshotIngestion exactly one per Snapshot: parser name/version + structure hash
  │     ├── SourceSection           nested heading hierarchy (parent must be in the SAME Snapshot)
  │     └── SourceContentNode       the ordered document flow — each node targets exactly ONE of:
  │           ├── SourceBlock             verbatim structural text (HEADING, PARAGRAPH, LIST_ITEM, CAPTION, ...)
  │           ├── SourceTable             structured rows / cells / spans (structureJson)
  │           └── SourceAssetPlacement ──> SourceAsset   an embedded image/object, one per distinct bytes
  │
  └── SourceSnapshot V0.2           changed bytes: a NEW Snapshot with its own structure
```

## Draft V0.1 → Draft V0.2 (no overwrite)

```
"Prowess Core Playtest Packet" (SourceDocument, id D)
    │
    ├── Snapshot S1  label "V0.1"  contentHash h1   ── structure ingested once, then immutable
    │
    │        author edits the DOCX and uploads it again
    │
    └── Snapshot S2  label "V0.2"  contentHash h2   ── a second, independent structure

    S1 is never updated, re-parsed, merged or deleted. Re-reading S1 after S2 exists returns
    byte-identical content. Uploading the V0.1 bytes again returns S1 itself (idempotent).
```

## Core invariants and where each is enforced

| Invariant | Enforced by |
| --- | --- |
| SourceDocument is the stable identity | unchanged M1 table; Snapshots point at it (RESTRICT) |
| A Snapshot is exact bytes | `content_hash` (SHA-256) + `byte_size`; unique `(source_document_id, content_hash)` |
| Snapshots are immutable after ingestion | no update/delete service exists; `source_snapshot_ingestions.source_snapshot_id` is UNIQUE, so a second ingestion can never be written; a different structure raises `SOURCE_SNAPSHOT.IMMUTABLE` |
| Changed bytes never overwrite history | a different hash is a different row; nothing is ever updated |
| Raw source preserved; normalization never replaces it | `raw_text` NOT NULL and verbatim; `normalized_text` is a separate nullable view (NULL when identical) |
| Document order preserved | `source_content_nodes.ordinal` unique per Snapshot, contiguous from 0; per-kind ordinals likewise |
| Tables stay structured | `structure_json` (rows → cells with `columnIndex`, `rowSpan`, `colSpan`, `isHeader`, `nestedTables`); `raw_text` is only an extra plain rendering |
| Assets are explicit | `source_assets` (hash, mime, size, header dimensions, alt text) + `source_asset_placements` in the flow |
| Structure never crosses Snapshots | every reference between structure rows is a COMPOSITE foreign key over `(id, source_snapshot_id)` |
| A node has exactly one matching target | CHECK `source_content_nodes_exactly_one_target_check` + service validation + one UNIQUE key per target column |
| Page numbers are never invented | CHECK `*_page_location_check`: `UNAVAILABLE` ⇒ every page field NULL; the DOCX parser always states `UNAVAILABLE` |
| No implied Canon / no rule interpretation | M3 static audit: no authority fields, no semantic vocabulary, no imports of Entity/Canon/Ruleset code |
| M1 SourceReference compatible | four NULLABLE locator columns; every M1 row has them NULL and reads as `structuralLocation: null` |
| M2 reproducibility unaffected | integration test 14: whole-database fingerprint (minus source tables) and the M2 golden history are byte-identical, release hashes still verify |

All foreign keys are `ON DELETE RESTRICT`. CHECK constraints are the first in this repository; Prisma does not model
them, so they are invisible to `schema.prisma` and to the blocking drift check (verified: the diff ignores them), and
are therefore pinned by name in `apps/studio/tests/unit/m3-source-structure-static.test.ts` and exercised by
integration tests.

## Location metadata — three distinct things

- **Source-native location**: a page number the source itself states. Represented by `page_location_basis =
  SOURCE_NATIVE` plus page fields. No WO1 parser produces it.
- **Derived structural ordering**: every `ordinal`. Always present, always derived from document order by the parser.
- **Unavailable location**: `page_location_basis = UNAVAILABLE` with every page field NULL. A DOCX has no reliable
  pagination without rendering (Word's own `lastRenderedPageBreak` hints depend on fonts, printer and version), so
  the DOCX parser leaves every page field NULL. The only page-related value kept is the **declared** page count Word
  recorded at last save (`docProps/app.xml <Pages>`), stored as `SourceSnapshot.pageCount`.

## SourceReference — one provenance graph, not two

`SourceReference` (M1-WO7) gains four nullable columns: `source_snapshot_id`, `source_section_id`, `source_block_id`,
`source_table_id`, surfaced as `structuralLocation`. Composite keys guarantee the Snapshot is a Snapshot **of the
reference's own SourceDocument** (`(source_snapshot_id, source_document_id)` → `source_snapshots(id,
source_document_id)`) and that section / block / table belong to that Snapshot. A CHECK requires the Snapshot whenever
a finer locator is set, so `MATCH SIMPLE` can never skip the composite check. The service validates the same rules
first and reports `SOURCE_REFERENCE.INVALID_INPUT` (the code M1 reserved for stricter validation). The M1 free-text
locators, lifecycle independence, `SOURCE_REFERENCE.IN_USE` (M2-WO12) and the `(id, entity_version_id)` key used by
`RuleConflictCandidate` are unchanged. No HTTP route accepts the new field yet.

## Structural ingestion

```
ingestSourceSnapshot(documentId, bytes, { label, originalFilename, mimeType, declaredVersion?, declaredDraftState? })
   1. SOURCE_DOCUMENT must exist
   2. contentHash = sha256(bytes); parse bytes FIRST (malformed/unsupported input writes nothing)
   3. Snapshot of these bytes already exists?  yes -> reuse it          no -> create it (race-safe on the unique key)
   4. ingestSourceStructure(snapshot, structure)   — ONE transaction:
        insert ingestion row (UNIQUE per Snapshot)  -> sections -> assets -> blocks -> tables -> placements -> nodes
        already ingested with the same structure hash  -> no-op (created: false)
        already ingested with a different hash          -> SOURCE_SNAPSHOT.IMMUTABLE
        any failure                                     -> full rollback, no partial structure
```

If a run is interrupted between creating the Snapshot row and ingesting its structure, the Snapshot simply has no
ingestion yet (`getSourceStructure` returns `ingestion: null`); repeating the call completes it.

### The DOCX parser (`prowess-docx-structure` 1.0.0)

Dependency-free (own ZIP reader using `node:zlib`, own XML reader, own image-header reader) and deterministic. It
preserves, where obtainable: heading hierarchy (paragraph or style-chain outline level, or a built-in "heading N"
style), paragraphs, list items (nesting level; numbered vs bulleted from `numbering.xml`), captions, tables (header
rows, `gridSpan` column spans, `vMerge` row spans, nested tables, `tblCaption`), embedded images (DrawingML and legacy
VML) and OLE objects with their source alt text, text boxes, content controls, and document order.

It **does not interpret** anything: a formula written in prose stays prose, a Trained / Expert / Master subdivision
is just a heading, a mission table is just a table. Deliberately out of scope for WO1: headers/footers, footnotes,
endnotes, comments, and tracked deletions (`w:del`, which is not what the document currently says). Empty paragraphs
are spacing, not content. Images inside table cells are placed immediately after their table, because the flow is
one-dimensional. Image bytes are hashed and measured but not stored in the database.

## Services (public `@prowess/db` surface)

`createSourceSnapshot`, `getSourceSnapshot`, `listSourceSnapshots` (creation order — history, never "latest"),
`findSourceSnapshotByContentHash`, `ingestSourceSnapshot`, `ingestSourceStructure`, `getSourceSnapshotIngestion`,
`getSourceStructure`, `getSourceSection`, `listSourceSectionChildren`, `getSourceSectionContent`, `getSourceBlock`,
`getSourceTable`, `getSourceAsset`, `listSourceAssets`, `listSourceAssetPlacements`, `hashSourceStructure`,
`parseDocxStructure`. `createSourceDocument` / `getSourceDocument` / `listSourceDocuments` are the existing M1
functions. There is no update or delete function for any source-structure record, and no ImportBatch,
ExtractionCandidate, entity matching, formula extraction or Canon promotion (later M3 Work Orders).

## Error codes

| Code | HTTP (when exposed) | When |
| --- | --- | --- |
| `SOURCE_SNAPSHOT.NOT_FOUND` | 404 | unknown or malformed Snapshot id |
| `SOURCE_SNAPSHOT.DUPLICATE_CONTENT` | 409 | explicit create of bytes the document already has |
| `SOURCE_SNAPSHOT.IMMUTABLE` | 409 | a different structure for an already-ingested Snapshot |
| `SOURCE_SNAPSHOT.INVALID_INPUT` | 400 | malformed Snapshot metadata |
| `SOURCE_STRUCTURE.NOT_FOUND` | 404 | unknown section / block / table |
| `SOURCE_STRUCTURE.INVALID_PARENT` | 400 | section parent unknown, itself, or later in document order |
| `SOURCE_STRUCTURE.INVALID_ORDER` | 400 | ordinals not unique / contiguous from 0 |
| `SOURCE_STRUCTURE.INVALID_NODE_TARGET` | 400 | node payload does not match its type, or names an unknown section/asset |
| `SOURCE_STRUCTURE.INVALID_INPUT` | 400 | any other structure shape problem (incl. invented page numbers) |
| `SOURCE_ASSET.NOT_FOUND` | 404 | unknown asset |
| `SOURCE_PARSE.UNSUPPORTED_FORMAT` | 415 | no structural parser for the mime type |
| `SOURCE_PARSE.MALFORMED_SOURCE` | 422 | bytes are not a well-formed instance of the format |

Database failures are never swallowed or relabelled: a raw failure inside ingestion rolls back and propagates (and an
API would fail closed to 500). Only the two known unique-key races are translated (Snapshot content, ingestion).

## Verification: synthetic CI vs. the real document

- **CI (synthetic):** `packages/prowess-db/tests/fixtures/` builds small deterministic DOCX packages for every
  structural case the real Playtest Packet contains — prose-heavy core rules, nested chapters, bullets and numbered
  procedures, formulas in prose, simple and complex tables (header rows, row/column spans, nested table), skill
  sections with Trained/Expert/Master subdivisions, modular spellcasting sections, summoning and maneuvers, mission
  generator tables, an image-only page and an illustrated page reusing an image. Parser unit tests:
  `tests/unit/docx-structure.test.ts`; database tests 1–18: `tests/integration/source-structure.test.ts`.
- **Real document:** "Prowess Core Playtest Packet V0.1" (~898 pages) is deliberately NOT committed. Verifying it is a
  local, manual step (`parseDocxStructure(readFileSync(path))`, then `ingestSourceSnapshot` against a dev database).
  Whether that was done is reported separately in each Work Order report, never implied by CI.
