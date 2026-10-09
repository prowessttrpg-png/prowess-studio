# Structural Segmentation & Automated Extraction (M3-WO3)

**Status: implemented; awaiting CI verification.** The first automatic extraction process: an ImportBatch
(`m3-import-batches-candidates.md`) explicitly executes its exact registered extractor over its exact pinned source
structure (`m3-source-structure.md`) and commits a deterministic set of generic, UNREVIEWED ExtractionCandidates.

```
SourceSnapshot
      ↓
ImportBatch
      ↓
Structural Extractor          prowess.structural@1 (pure, deterministic)
      ├── SECTION
      ├── TABLE
      └── ROOT_CONTENT
      ↓
ExtractionCandidates          generic, UNREVIEWED, exact anchors
      ↓
READY_FOR_REVIEW
```

The extractor answers *"what structural pieces of this source should later import stages inspect?"* — never *"what
rules should Prowess adopt?"*.

```
Structural Candidate
        ≠
Prowess Entity

"Spell AP = ..."
        ↓ WO3
Structural source evidence

NOT YET

FormulaDefinition
```

## Roadmap boundary

| Work Order | Responsibility |
| --- | --- |
| **WO3** (this) | automatic STRUCTURAL extraction |
| WO4 | Entity matching / normalization (aliases, canonical keys, exact comparison Manifest) |
| WO5 | Formula / Requirement / Keyword SEMANTIC extraction |
| WO6 | conflict detection / review decisions / ImportDecision |

Nothing in WO3 matches Entities, parses formulas or requirements, interprets keywords, compares rule fields, creates
RuleConflicts, records decisions, transitions Candidates past UNREVIEWED, or creates EntityVersions.

## Extractor registry (`@prowess/import`)

```ts
interface ExtractorDefinition {
  key: string;                    // "prowess.structural"
  version: string;                // "1"
  description: string;
  payloadSchemas: { key: string; version: number }[]; // the only schemas it may emit
  acceptsConfiguration: boolean;  // v1: false
  extract(context: ExtractionContext): CreateExtractionCandidateInput[];
}
```

- **Exact lookup.** `ExtractorRegistry.find(key, version)` returns the extractor registered as exactly
  `key@version`, or nothing. There is no latest, newest-compatible, default or fallback extractor. An unknown exact
  extractor — including WO2's `manual-foundation` key, which has no executable extractor — is
  `IMPORT_BATCH.EXTRACTOR_NOT_FOUND`. A Batch pinning an `extractorConfigHash` for an extractor that accepts no
  configuration is also `EXTRACTOR_NOT_FOUND` (there is no extractor matching that exact identity).
- **Versioning.** A registered `key@version` is never edited. Changing behaviour means registering a new version;
  because the extractor version is part of the WO2 Batch fingerprint, a new version is a new ImportBatch, and
  completed Batches are never altered.
- **Official registry.** `defaultExtractorRegistry` holds exactly `prowess.structural@1`.

### Extraction context (pure)

```ts
interface ExtractionContext {
  batch: { importBatchId, sourceSnapshotId, sourceStructureHash, scopeType, scopeSectionId,
           extractorKey, extractorVersion, extractorConfigHash };
  sections: SourceSection[];             // IN SCOPE only, source order
  nodes: ResolvedSourceContentNode[];    // IN SCOPE only, source order (block / table / asset placement resolved)
}
```

No Prisma client, repository, CanonPolicy, Manifest, Ruleset service, source authority or Entity data is passed. The
runner (`runExtraction`) scopes the structure *before* the extractor sees it, so an extractor cannot inspect sibling
sections or unrelated root content of a SECTION_SUBTREE Batch.

## `prowess.structural@1`

Deterministic and structural: no LLM, no AI service, no network, no randomness, no clock. It reads only WO1
structure and performs **no text interpretation** — the only use it makes of source text is "is there any text at all"
(pinned by the static audit). Every candidate has `proposedEntityType = null`, `proposedCanonicalKey = null`,
`status = UNREVIEWED`, and null excerpts (the anchors already preserve the exact source text).

### Segmentation rules

| Unit | When | Primary anchor | Supporting anchors | candidateKind | Confidence | Label |
| --- | --- | --- | --- | --- | --- | --- |
| `SECTION` | an in-scope section that directly owns meaningful text (a non-heading block with text) | the section | every directly-owned content node except its heading block (paragraphs, list items, tables, image placements), in source order | `UNKNOWN` | `HIGH` (explicit heading) | the section title (truncated to 300 chars with "…") |
| `TABLE` | an in-scope table with at least one non-empty cell | the table's content node | none | `REFERENCE` | `HIGH` (explicit table) | the caption; else "Table in ‹section›" (or "Table n in ‹section›" when the section has several) |
| `ROOT_CONTENT` | a contiguous run (consecutive node ordinals) of section-less nodes containing meaningful text — SNAPSHOT scope only | the run's first node | the rest of the run | `UNKNOWN` | `MEDIUM` (derived grouping) | "Preface content", or `Content after "‹last section›"` |

- **Containers.** A section with only a heading, sub-sections, images and/or tables yields no SECTION unit — an empty
  parent is not a reviewable unit. Its children (and its tables, as TABLE units) still are.
- **Tables** are both a TABLE unit and supporting evidence of their section. Table semantics (lookup, damage,
  difficulty, random, formula table) are not inferred; exact content remains available through the WO1 anchor.
- **Lists, examples and callouts** stay with their section as supporting anchors; bullets are never turned into
  abilities, requirements, modifiers or keywords.
- **Formula-, requirement- and keyword-looking text** ("Spell AP = floor(Final MP / PRO)", "Requires Expert
  Emission", repeated or bold terms) is never a FORMULA / REQUIREMENT / KEYWORD candidate and is never copied into a
  payload — it is source evidence under its unit's anchors. WO5 owns semantic extraction.
- **Images** are never interpreted (no OCR, no vision). They appear as supporting anchors of a text section; an
  image-only section yields no candidate and the asset simply stays preserved in source structure.
- Unit types are extractor-internal. They are not EntityTypes, and no game-specific type exists in the extractor.

### Payload schemas (version 1)

`prowess.structural.section`
```json
{ "unitType": "SECTION", "sourceSectionId": "…", "parentSectionId": "…|null", "title": "Spellcasting",
  "headingLevel": 2, "sectionOrdinal": 5, "directContentNodeCount": 14, "directBlockCount": 12,
  "directListItemCount": 4, "directTableCount": 1, "directAssetPlacementCount": 1, "childSectionCount": 7 }
```
`prowess.structural.table`
```json
{ "unitType": "TABLE", "sourceTableId": "…", "sourceContentNodeId": "…", "sourceSectionId": "…|null",
  "caption": "…|null", "rowCount": 8, "columnCount": 3, "hasHeader": true }
```
`prowess.structural.root-content`
```json
{ "unitType": "ROOT_CONTENT", "nodeCount": 4, "nodeTypes": { "BLOCK": 3, "TABLE": 0, "ASSET_PLACEMENT": 1 },
  "firstNodeOrdinal": 0, "lastNodeOrdinal": 3 }
```
Structural facts only — no raw section text is duplicated into payloads; the source is the authoritative text. The
extractor may emit only these three schemas; anything else is invalid output.

## Deterministic ordering

WO1 orders all content in one flow (`SourceContentNode.ordinal`, contiguous per Snapshot); sections have their own
ordinal and begin at their heading block. The runner sorts sections and nodes by `ordinal` with `id` only as a
tie-breaker — never by database read order. Units are ordered by the node ordinal where they begin (a SECTION at its
heading block, a TABLE at its node, a ROOT_CONTENT run at its first node), then ROOT_CONTENT < SECTION < TABLE, then
the anchor id; candidate ordinals are 1..n in that order. *Limitation:* a section that owns no content node at all has
no position in the flow; it yields no unit, so this never affects output.

## Output validation (before anything is written)

The complete output is validated twice, before the commit transaction:

1. **Pure** (`runExtraction`): candidate shape (WO2 rules), unique positive ordinals ascending in output order,
   declared payload schemas, anchors inside the *scoped* structure (so the same Snapshot and inside the Batch scope),
   canonical payloads, no duplicate fingerprints.
2. **Database** (WO2 `prepareCandidates`): anchors exist, belong to the Batch's Snapshot, lie inside the scope, and any
   excerpt is verbatim source text; fingerprints must equal the pure ones.

Any failure is `IMPORT_BATCH.INVALID_EXTRACTOR_OUTPUT` and writes nothing. An extractor that throws is reported the
same way.

## Output hash — `PROWESS_EXTRACTION_SET_V1`

```
PROWESS_EXTRACTION_SET_V1
1:<candidateFingerprint>
2:<candidateFingerprint>
…
```

One line per candidate in ascending ordinal order (an empty set is the version line alone), UTF-8, SHA-256, lowercase
hex, stored as `ImportBatch.extractionOutputHash`. It proves exactly which immutable candidate set the Batch produced.
`extractedAt` records when that set was committed; it is metadata and is in no fingerprint.

## Lifecycle

```
CREATED ──extractImportBatch──▶ EXTRACTING ──(same transaction)──▶ READY_FOR_REVIEW
```

1. load the exact pinned structure (chunked reads); 2. run the pure extractor; 3. validate the whole output (pure,
then database); 4. compute fingerprints and the output hash; 5. ONE short transaction: claim the Batch with a
conditional update `CREATED → EXTRACTING` (row-locked — exactly one caller can win), prove it holds no candidates,
insert candidates and supporting anchors in bounded chunks, then set `READY_FOR_REVIEW` + `extractionOutputHash` +
`extractedAt`. The expensive segmentation happens before the transaction.

`EXTRACTING` is held only inside that transaction, so it is never visible to other readers and no crash can leave a
Batch stuck in it. CHECK constraints make it impossible for a Batch to look extracted without an output hash (or carry
one while CREATED / EXTRACTING), and the hash and timestamp are always written together.

**Failure (documented decision).** If the extractor throws, its output is invalid, or the commit fails, nothing is
written and the Batch stays `CREATED` with a controlled error (or, for a raw database failure, the error propagates
unchanged). `FAILED` is not used: there is no async job system, and recording a failure would require a second write
outside the atomic commit. REVIEWING / COMPLETED are not implemented (later review Work Orders).

**Manual recording and extraction never mix.** `recordExtractionCandidates` now works only while a Batch is
`CREATED`, and its transaction row-locks the Batch with a no-op conditional write, so it can neither interleave with
nor follow a committed extraction (`IMPORT_BATCH.EXTRACTION_CONFLICT`). Automated extraction requires an empty Batch.

## Reruns, idempotency, nondeterminism

- **Repeat on READY_FOR_REVIEW.** The extractor is re-run over the same pinned structure and its output hash compared
  with `extractionOutputHash`. Identical → the committed result is returned (`alreadyExtracted: true`, same candidate
  ids, no new rows). Different → `IMPORT_BATCH.NONDETERMINISTIC_OUTPUT`: the same Snapshot, structure hash and
  extractor key / version / config now produce another set. It fails closed; historical candidates are never
  overwritten.
- **Concurrency.** Concurrent extractions compute independently; one wins the conditional claim and commits, every
  other caller finds the committed Batch and returns it after the same hash comparison. One logical set, no duplicate
  candidates or ordinals, never a partial Batch.
- **`verifyExtractionOutput`** (read-only) recomputes both the hash of the candidates actually stored and the hash of
  a fresh run of the exact extractor, and reports whether each matches the stored hash.
- **After review begins** (REVIEWING / COMPLETED / CANCELLED) extraction is `IMPORT_BATCH.ALREADY_REVIEWING`.

## Large sources

The real Playtest Packet is ~898 pages, so there is no artificial candidate ceiling on extraction. Structure is read
with WO1's chunked reads; candidates are inserted 1,000 rows per statement and supporting anchors 5,000 per statement
inside the single commit transaction (300 s budget); stored sets are read back in 10,000-row pages. A regression test
extracts a synthetic document of ~33,000 content nodes into 3,001 candidates with more than 32,767 supporting anchors
— beyond PostgreSQL's bind-parameter limit — and re-verifies it. `MAX_SUPPORTING_ANCHORS` was raised from 100 to
10,000 because a SECTION unit cites every directly-owned node of a long section.

## Immutability and independence

Extraction reads source structure and writes only the ImportBatch workflow fields, `extraction_candidates` and
`extraction_candidate_sources`. It never modifies any Source table, never creates or modifies an Entity, EntityVersion,
alias, Keyword, relationship, Ruleset, Manifest, CanonPolicy, RuleConflict, CanonDecision, ChangeSet, RulesetRelease
or MigrationPlan, and never reads source authority to change confidence, skip, rank or approve anything. A heading
"Arcana" is simply a structural unit; whether it matches the Arcana Entity is WO4.

## Services (`@prowess/db`; no HTTP routes, no UI)

`extractImportBatch(importBatchId)`, `getExtractionResult(importBatchId)` (`IMPORT_BATCH.NOT_EXTRACTED` before
extraction), `verifyExtractionOutput(importBatchId)`. Results return the Batch, candidate count, output hash, the
derived summary and `alreadyExtracted`. The Import API is WO7 and the Import Studio UI WO8.

## Error codes

| Code | HTTP (when exposed) | Why |
| --- | --- | --- |
| `IMPORT_BATCH.EXTRACTOR_NOT_FOUND` | 409 | the deployment has no extractor for the Batch's exact identity |
| `IMPORT_BATCH.INVALID_EXTRACTOR_OUTPUT` | 500 | a server-side extractor defect, not a caller error (explicit, never a stack trace) |
| `IMPORT_BATCH.EXTRACTION_CONFLICT` | 409 | Batch not extractable (manual candidates) / no longer open for recording |
| `IMPORT_BATCH.NONDETERMINISTIC_OUTPUT` | 409 | integrity failure against stored history (like `MIGRATION_PLAN.MANIFEST_INTEGRITY_FAILURE`) |
| `IMPORT_BATCH.ALREADY_REVIEWING` | 409 | extraction closed once review has begun |
| `IMPORT_BATCH.NOT_EXTRACTED` | 409 | no committed extraction to read or verify |

## Verification: synthetic CI vs the real document

CI uses deterministic synthetic structures only: in-memory WO1-shaped structures for the pure extractor tests, and
synthetic DOCX fixtures ingested through WO1 for the database tests. The real "Prowess Core Playtest Packet V0.1" is not
committed; structurally extracting a section of it is an optional local step, reported separately and never implied
by CI.
