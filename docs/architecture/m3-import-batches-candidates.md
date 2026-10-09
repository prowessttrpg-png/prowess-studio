# Import Batches & Extraction Candidates (M3-WO2)

**Status: implemented; awaiting CI verification.** The infrastructure for performing an import against one exact
SourceSnapshot (`m3-source-structure.md`) and recording reviewable extraction **proposals**. There is no semantic
extraction, Entity matching, review, ImportDecision, Import API or Import UI yet — those are later M3 Work Orders.

```
SourceSnapshot V0.1
      ↓
ImportBatch                 (exact Snapshot + exact structure hash + scope + extractor identity)
      ↓
ExtractionCandidate
      ├── source anchor     (exactly one primary Section / ContentNode, plus ordered supporting anchors)
      ├── candidate payload (payloadSchemaKey + payloadSchemaVersion + JSON object)
      ├── confidence        (HIGH / MEDIUM / LOW — of the EXTRACTION, not of the source)
      └── UNREVIEWED
```

and, in later Work Orders only:

```
ExtractionCandidate
      ↓ future
Matching                    (M3-WO4)
      ↓
Import Review               (M3-WO6)
      ↓
ImportDecision              (M3-WO6)
      ↓
EntityVersion / RuleConflict proposal
```

## Candidate ≠ Entity, and nothing else moves

A Candidate is what an extractor *proposed*. It is not authoritative game data. Creating an ImportBatch or recording
Candidates never creates or changes an Entity, EntityVersion, alias, Keyword, EntityRelationship, formula or
requirement definition, Ruleset, RulesetManifest, CanonPolicy, SourceAuthorityRecord, RuleConflict, CanonDecision,
ChangeSet, RulesetRelease or MigrationPlan. The integration suite fingerprints every other table before and after and
requires them to be byte-identical; the M3 static audit requires the import code to write only its three tables.

## The Batch

| Field | Meaning |
| --- | --- |
| `sourceSnapshotId` | the ONE exact Snapshot; mandatory |
| `sourceStructureHash` | the Snapshot's WO1 ingestion `structureHash` at creation — the same hash and algorithm, not a new one |
| `scopeType` / `scopeSectionId` | `SNAPSHOT` (no section) or `SECTION_SUBTREE` (one root section of the same Snapshot) |
| `reviewRulesetId` / `comparisonManifestId` | optional exact review CONTEXT; the Manifest must belong to that Ruleset |
| `extractorKey` / `extractorVersion` / `extractorConfigHash` | which extractor implementation and configuration |
| `batchFingerprint` | SHA-256 of the extraction context (below); UNIQUE |
| `status` | always `CREATED` in WO2 |

**Structure must be ready.** A Snapshot without completed structural ingestion gets
`IMPORT_BATCH.SOURCE_STRUCTURE_NOT_READY`; WO2 never triggers ingestion. In the database, `(source_snapshot_id,
source_structure_hash)` is a composite foreign key onto `source_snapshot_ingestions(source_snapshot_id,
structure_hash)`, so a Batch cannot exist for an un-ingested Snapshot or pin a hash the Snapshot was not ingested with.

**Scope.** `SNAPSHOT` covers everything in the Snapshot. `SECTION_SUBTREE` covers the root section, every descendant
section, and every content node whose section is one of those (content before the first heading is in no subtree).
Arbitrary multi-section scopes are deliberately unsupported: "Spellcasting, Skills, Weapons" is three Batches. The
scope section is a composite key `(scope_section_id, source_snapshot_id)`, so it is always a section of the Batch's
own Snapshot; a CHECK enforces "SNAPSHOT ⇔ no section".

**Review context is context only.** `reviewRulesetId` / `comparisonManifestId` are recorded only when the caller names
them. They are not a destination, an import target, automatic Canon, or anything that is ever mutated. Nothing ever
resolves a "latest", "active" or "current" Manifest, Release, CanonPolicy or EntityVersion: with no Manifest supplied,
`comparisonManifestId` is null. A composite key `(comparison_manifest_id, review_ruleset_id)` →
`ruleset_manifests(id, ruleset_id)` plus a CHECK (Manifest ⇒ Ruleset) make "a Manifest of another Ruleset" impossible.

**Extractor identity.** Reprocessing the same Snapshot with a later extractor version is legitimate and is a new
Batch. Before WO3's extractor exists, synthetic/manual work uses the documented key `manual-foundation`.

### Batch fingerprint — `PROWESS_IMPORT_BATCH_V1`

```
PROWESS_IMPORT_BATCH_V1
sourceSnapshot=<uuid>
structureHash=<sha256>
scopeType=SNAPSHOT|SECTION_SUBTREE
scopeSection=<uuid|null>
reviewRuleset=<uuid|null>
comparisonManifest=<uuid|null>
extractorKey=<key>
extractorVersion=<version>
configHash=<sha256|null>
```

Lines joined by `\n`, UTF-8, SHA-256, lowercase hex (`@prowess/import`). UUIDs are lowercased; absent values are the
literal `null`; no value may contain a newline. Label, description, database id and timestamps are excluded — they
are not extraction semantics. **Idempotency:** creating a Batch whose fingerprint exists returns the existing Batch
(`created: false`) unchanged, including under concurrency (the unique-key loser reads the winner). Changing the
Snapshot, scope, review context or extractor key / version / config is a different fingerprint and a new Batch.

## The Candidate

| Field | Meaning |
| --- | --- |
| `importBatchId` / `sourceSnapshotId` | the Batch, and (composite key) its Snapshot |
| `ordinal` | positive extractor-output / review order; UNIQUE per Batch; NOT priority, authority, confidence or Canon order |
| `candidateKind` | generic: ENTITY, ENTITY_FIELD, FORMULA, REQUIREMENT, KEYWORD, RELATIONSHIP, REFERENCE, UNKNOWN |
| `proposedEntityType` / `proposedCanonicalKey` | extractor proposals only (type only for ENTITY / ENTITY_FIELD; key syntax-checked); never looked up |
| `displayLabel` / `summary` | human text |
| `confidence` | HIGH / MEDIUM / LOW |
| `status` | always `UNREVIEWED` in WO2; callers cannot supply it |
| `payloadSchemaKey` / `payloadSchemaVersion` / `payloadJson` | the generic payload contract |
| `candidateFingerprint` | SHA-256 of the extracted content (below); UNIQUE per Batch |
| `primarySourceSectionId` / `primarySourceContentNodeId` | exactly one (CHECK) |

Game-specific kinds (SPELL_EFFECT, MANEUVER_TRAIT, WEAPON_RULE) are deliberately absent: they are domain
classifications, carried later by `proposedEntityType` and the payload schema, not extraction infrastructure.

**Generic payload, schema-versioned.** `payloadJson` must be a JSON object (also a CHECK). `payloadSchemaKey` (a
lowercase dotted identifier such as `prowess.entity.skill`) and `payloadSchemaVersion` (positive integer) are required
so extractor output stays interpretable when schemas evolve; WO2 validates only this generic contract. New extraction
types never need a migration. The stored payload is the canonical-JSON copy of what was given.

### Source anchors

Every Candidate has exactly one PRIMARY anchor — one SourceSection or one SourceContentNode — and zero or more
ordered SUPPORTING anchors (`ExtractionCandidateSource`, 1-based `ordinal` in the extractor's order), each also
exactly one Section or ContentNode. Supporting anchors are evidence, not further Candidates.

- **Reuse of the WO1 location model.** WO1's structural location identifies a Snapshot / Section / Block / Table; a
  ContentNode resolves to exactly one Block, Table or AssetPlacement. WO1 has no character offsets or table-cell
  coordinates, so none are stored: the exact Section / ContentNode is the finest location. Page numbers and offsets
  are never invented.
- **Excerpts are verbatim.** A supporting anchor may carry an `excerpt`; the service accepts it only if it is a
  substring of the anchored block's raw text, the table's raw text or one of its cells (or, for a section anchor, its
  title). Paraphrase is rejected as `INVALID_SOURCE_ANCHOR`. Primary anchors carry no excerpt.
- **Same Snapshot, always.** Every anchor is a composite key `(…_id, source_snapshot_id)`, and the Candidate's own
  `(import_batch_id, source_snapshot_id)` is a composite key onto the Batch, so a Candidate of a Snapshot-A Batch can
  never anchor Snapshot-B structure — in the service (`INVALID_SOURCE_ANCHOR`) and in PostgreSQL.
- **Inside the Batch scope, always.** For a SECTION_SUBTREE Batch, the primary and every supporting anchor must lie in
  the subtree, otherwise `OUTSIDE_BATCH_SCOPE`. The Batch is never silently widened.

### Candidate fingerprint — `PROWESS_EXTRACTION_CANDIDATE_V1`

`PROWESS_EXTRACTION_CANDIDATE_V1` + `\n` + canonical JSON of `{candidateKind, proposedEntityType,
proposedCanonicalKey, displayLabel, confidence, payloadSchemaKey, payloadSchemaVersion, payload, primaryAnchor,
supportingAnchors}`, anchors as `{kind: "SECTION"|"CONTENT_NODE", id}` (supporting anchors also `excerpt`), in the
extractor's order. Excluded: database id, `createdAt`, `status` (future review must never redefine what was
extracted), and `ordinal` / `summary` (presentation). Hashed as UTF-8 SHA-256, lowercase hex.

**Canonical JSON** (`@prowess/import`): object keys sorted recursively by UTF-16 code unit (no locale); array order
preserved; numbers as `JSON.stringify` emits them; strings exactly as given — no trimming, case folding or Unicode
(NFC/NFKC) normalization; explicit `null` preserved; `undefined`, NaN/Infinity, functions, bigint and non-plain objects
rejected. Key insertion order never changes a fingerprint; array order always does.

### Idempotency, ordinals, atomicity

- **Exact repeat → reuse.** The same content (fingerprint) with the same ordinal and summary returns the existing
  Candidate, within one call, across calls, and under concurrency (a unique-key race is re-evaluated and resolved to
  reuse when identical).
- **Different content, same ordinal → `ORDINAL_CONFLICT`.** Nothing is renumbered; extractor output must be
  deterministic.
- **Same content, different ordinal or summary → `CANDIDATE_CONFLICT`.** The first record is never overwritten.
- **Different content at the same anchor** is simply a different Candidate under its own ordinal.
- **Atomic.** All Candidates (and their supporting anchors) of one `recordExtractionCandidates` call are written in
  one transaction; any invalid, out-of-scope or conflicting Candidate — or a database failure — leaves none of them.

### Immutability

No update, replace, re-anchor or delete operation exists for a Batch or a Candidate, and all foreign keys are
`ON DELETE RESTRICT` (a referenced Snapshot, Section or ContentNode cannot be deleted). If extraction output must
change, a new Batch (another extractor version or source context) records it. Rejected Candidates will remain as
historical evidence of what was proposed.

## Confidence is not authority; APPROVED is not Canon

```
HIGH confidence
      ≠
high Canon authority
```

`ExtractionConfidence` answers only "how sure was the extraction process that it identified / interpreted this
correctly?". It is not source authority, Canon priority, balance confidence or design approval. A HIGH-confidence
Candidate from a `REFERENCE_ONLY` source outranks nothing; a LOW-confidence Candidate from a `GOVERNING` source does
not become Canon. Confidence never reads or writes `SourceDocument.authorityStatus`, CanonPolicy or
SourceAuthorityRecord (integration test: byte-identical before/after).

The candidate status vocabulary is PAS-07's: UNREVIEWED, MATCHED, NEW_ENTITY, CONFLICT, NEEDS_MAPPING, REJECTED,
APPROVED. WO2 writes only UNREVIEWED. A future `APPROVED` will mean "approved through the import review workflow" —
never Canon, published, part of a Manifest, or EntityVersion status CANON. Candidate status is not a CanonDecision.

## Derived summary

`getImportBatch` / `getImportBatchSummary` return `candidateCount` and counts `byConfidence`, `byStatus` and `byKind`
(every vocabulary value present), computed from the Candidates on every read. No counter is persisted.

## Package boundary: `@prowess/import`

Framework-independent, import-specific pure logic: canonical JSON, both fingerprints, and the section-subtree scope
helper. It depends only on `@prowess/model` and Node's standard library (`node:crypto`); never on `@prowess/db`,
Prisma, Next.js, React, `@prowess/ui` or `apps/studio` (enforced by `scripts/check-architecture.mjs` and the M1
layering audit). `@prowess/db` uses it; the dependency graph stays acyclic. No semantic extraction lives there yet.

## Services (`@prowess/db`, no HTTP routes)

`createImportBatch`, `getImportBatch`, `listImportBatches`, `getImportBatchSummary`, `recordExtractionCandidates`,
`getExtractionCandidate`, `listExtractionCandidates` (`ordinal ASC, id ASC`). No review, status, update or delete
operation. The Import API is M3-WO7 and the Import Studio UI M3-WO8.

## Error codes

| Code | HTTP (when exposed) |
| --- | --- |
| `IMPORT_BATCH.NOT_FOUND` | 404 |
| `IMPORT_BATCH.SOURCE_SNAPSHOT_NOT_FOUND` | 400 |
| `IMPORT_BATCH.SOURCE_STRUCTURE_NOT_READY` | 409 |
| `IMPORT_BATCH.INVALID_SCOPE` / `INVALID_COMPARISON_CONTEXT` / `INVALID_INPUT` | 400 |
| `IMPORT_BATCH.CONFLICT` | 409 |
| `EXTRACTION_CANDIDATE.NOT_FOUND` | 404 |
| `EXTRACTION_CANDIDATE.INVALID_INPUT` / `INVALID_SOURCE_ANCHOR` / `OUTSIDE_BATCH_SCOPE` | 400 |
| `EXTRACTION_CANDIDATE.ORDINAL_CONFLICT` / `CANDIDATE_CONFLICT` | 409 |

Database failures are never swallowed: only the two known unique-key races (Batch fingerprint; Candidate ordinal /
fingerprint) are translated, and everything else propagates (an API would fail closed to 500).

## Future responsibilities

- **WO3** — the semantic extractor (`prowess.semantic-extractor`), payload schemas, Batch extraction transitions.
- **WO4** — matching / classification against Entities (exact historical comparison Manifest when pinned).
- **WO6** — import review, ImportDecision, controlled Candidate status transitions, Batch completion.
- **WO7 / WO8** — Import HTTP API and Import Studio UI.
