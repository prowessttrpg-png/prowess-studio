# Import HTTP API (M3-WO7)

**Status: implemented; awaiting CI verification.** A thin HTTP layer over the approved M3 services. It adds no import
semantics: no extraction, matching, workflow, conflict or materialization rule lives in a route.

```
Studio UI later
      ↓
/api/import/...
      ↓
thin route adapter            strict shape validation · one public @prowess/db call · serializeForApi · toErrorResponse
      ↓
@prowess/db service
      ↓
M3 domain model
```

```
POST Candidate Decision
      ↓
ImportDecision service
      ↓
immutable Decision + Candidate status

NOT:
  PATCH Candidate.status
```

## Scope

Internal, unversioned Phase-1 Studio API under `/api/import` (no `/v1`), following the M1/M2 conventions exactly: camelCase
JSON, ISO timestamps, explicit nulls, `{ data }` / `{ data, pagination }` envelopes, the central `{ code, message, field,
details }` error shape, strict UUID / body / query handling, and an opaque 500 for anything unexpected. Authentication is
outside WO7 (no Studio auth contract exists yet). No OpenAPI yet. No UI (WO8).

## Route / method matrix

The static audit (`apps/studio/tests/unit/m3-import-api-static.test.ts`) pins this table against the actual route files.

| Method | Route | Service | Mutation? | Purpose |
| --- | --- | --- | --- | --- |
| POST | /api/import/source-snapshots | createSourceSnapshot | yes | register a Snapshot's metadata (no bytes) |
| GET | /api/import/source-snapshots | listSourceSnapshots | no | Snapshots of `?sourceDocumentId=` (required) |
| GET | /api/import/source-snapshots/[snapshotId] | getSourceSnapshot | no | one Snapshot |
| GET | /api/import/source-snapshots/[snapshotId]/structure | getSourceStructure | no | outline: Snapshot, ingestion, sections, counts |
| GET | /api/import/source-sections/[sectionId] | getSourceSection | no | one section |
| GET | /api/import/source-sections/[sectionId]/children | listSourceSectionChildren | no | child sections (paged) |
| GET | /api/import/source-sections/[sectionId]/contents | getSourceSectionContent | no | a section's content nodes (paged) |
| GET | /api/import/source-blocks/[blockId] | getSourceBlock | no | one block |
| GET | /api/import/source-tables/[tableId] | getSourceTable | no | one table |
| GET | /api/import/source-assets/[assetId] | getSourceAsset | no | one asset |
| POST | /api/import/batches | createImportBatch | yes | create / idempotently return a Batch |
| GET | /api/import/batches | listImportBatches | no | Batches (`?sourceSnapshotId=`, paged) |
| GET | /api/import/batches/[batchId] | getImportBatch | no | a Batch with its derived summary |
| POST | /api/import/batches/[batchId]/extract | extractImportBatch | yes | run the Batch's exact registered extractor |
| GET | /api/import/batches/[batchId]/extraction-result | getExtractionResult | no | the committed extraction |
| GET | /api/import/batches/[batchId]/verify-extraction | verifyExtractionOutput | no | re-verify the committed output hash |
| GET | /api/import/batches/[batchId]/candidates | listExtractionCandidates | no | Candidates (paged) |
| GET | /api/import/batches/[batchId]/summary | getImportBatchSummary | no | derived Candidate counts |
| POST | /api/import/batches/[batchId]/match-runs | analyzeImportBatchMatches | yes | create / idempotently return a MatchRun |
| GET | /api/import/batches/[batchId]/match-runs | listImportMatchRuns | no | MatchRuns (paged) |
| GET | /api/import/batches/[batchId]/conflicts | analyzeImportConflicts | no | conflict signals for `?matchRunId=` (required, paged) |
| GET | /api/import/batches/[batchId]/decisions | listImportDecisionsForBatch | no | all decisions (paged) |
| GET | /api/import/batches/[batchId]/review-summary | getImportReviewSummary | no | derived review counts (`?matchRunId=` optional) |
| POST | /api/import/batches/[batchId]/complete-review | completeImportReview | yes | REVIEWING → COMPLETED |
| GET | /api/import/candidates/[candidateId] | getExtractionCandidate | no | one Candidate |
| POST | /api/import/candidates/[candidateId]/decisions | reviewImportCandidate | yes | record one explicit review decision |
| GET | /api/import/candidates/[candidateId]/decisions | listImportDecisionsForCandidate | no | the Candidate's history (paged) |
| GET | /api/import/decisions/[decisionId] | getImportDecision | no | one decision |
| GET | /api/import/match-runs/[matchRunId] | getImportMatchRun | no | a MatchRun with its summary |
| GET | /api/import/match-runs/[matchRunId]/assessments | listCandidateMatchAssessments | no | assessments (paged) |
| GET | /api/import/match-runs/[matchRunId]/candidates/[candidateId]/assessment | getCandidateMatchAssessment | no | one Candidate's assessment |
| GET | /api/import/match-runs/[matchRunId]/duplicate-groups | listCandidateDuplicateGroups | no | duplicate groups (paged) |

There is no PATCH, PUT or DELETE, no status route, no approve / reject route (both are decision types of the one decision
command), no RuleConflict route, and no materialization route (`/materialize`, `/create-entity`, `/apply-import` …).
Exactly six commands mutate: create Snapshot metadata, create Batch, extract, create MatchRun, record a decision,
complete review.

## Strict request validation (shape only)

- Unknown body fields → `400 API.INVALID_BODY` (with `field`); unknown query parameters → `400 API.INVALID_QUERY`;
  malformed path ids → `400 API.INVALID_UUID`; malformed JSON → `400 API.INVALID_BODY` with no parser text.
- Server-controlled fields are never accepted: for Batches `status`, `sourceStructureHash`, `batchFingerprint`,
  `extractionOutputHash`, `extractedAt`, `createdAt`; for decisions `fromStatus`, `toStatus`, `sequenceNumber`,
  `decisionFingerprint`, `candidateSetHash`, `createdAt`; for MatchRuns `comparisonManifestId`, `candidateSetHash`,
  `entityCatalogHash`.
- Commands with no input (`extract`, `complete-review`) accept only an empty body or `{}` — extractor identity and scope
  are frozen in the Batch.
- Routes validate types and presence only. Every business rule (transitions, evidence, rationale requirements, scope,
  exact registry lookups) stays in the services and surfaces as its controlled domain error.

## Commands and responses

- `POST /batches` → `{ data: { batch, created } }`, **201** when created, **200** for an identical existing extraction
  context. `POST /batches/[id]/match-runs` → `{ data: { run, created } }` (201 / 200) — the body accepts only the existing
  `matcherKey` / `matcherVersion` / `matcherConfig { suggestionThreshold, maxSuggestions }` contract (exact registry).
  `POST /candidates/[id]/decisions` → `{ data: { decision, created } }` (201 appended / 200 exact retry); the body is
  `candidateFingerprint` and `decisionType` plus the decision-specific `matchBasis`, `targetEntityId`, `matchRunId`,
  `matchAssessmentId`, `duplicateGroupId`, `comparisonEntityVersionId`, `rationale`.
- `POST /batches/[id]/extract` and `/complete-review` → 200 with the service result.
- `GET /verify-extraction` → 200 with `{ storedOutputHash, persistedSetHash, recomputedOutputHash, persistedSetMatches,
  extractorOutputMatches }` — the verification result itself, also when it does not match (as M2's
  `verify-manifest-hash`). No derived field is added in the route.
- Conflict analysis needs the exact MatchRun (`?matchRunId=`, required) — never a latest run.

## Errors

Every handler returns `toErrorResponse(error)`: controlled domain codes map through the exhaustive central table (404
addressed, 400 referenced / shape, 409 state, explicit 500 for defective extractor / matcher output), and anything
unknown fails closed to `500 INTERNAL.UNEXPECTED_ERROR` with a generic message — no Prisma code, SQL, connection string,
path or stack text (regression-tested with an injected error).

## Pagination and large results

Lists use the M1/M2 `page` / `pageSize` (default 25, max 100) pagination. As with M2 Phase-1 lists, the service's
ordered result is paged in the adapter. Source structure is never returned whole: `/structure` returns the outline
(sections + counts), and content is read per section (paged) or per block / table / asset — a ~900-page source never
produces one giant payload.

## Deliberate exclusions

- **No source upload.** WO1 has no persistent blob store, so HTTP can only register Snapshot metadata; structural
  ingestion (bytes or structure) is not exposed. WO9 ingests the real Playtest Packet through a controlled developer
  path; an upload / blob adapter can be its own Work Order.
- **No manual Candidate recording.** `recordExtractionCandidates` remains a service for developer / manual-foundation
  workflows; over HTTP it would be a dead end (manual Batches are never extracted, so they can never be reviewed).
- **No list filters the services do not support** (e.g. Candidate `status` / `kind`, Batch `status`). Adding them would
  mean new read logic; they can be added to the services first.

## Roadmap boundary

| Work Order | Responsibility |
| --- | --- |
| **WO7** (this) | HTTP API |
| WO8 | Import Studio UI |
| WO9 | first real Prowess source ingestion / import / review |
| WO10 | reproducibility and final M3 audit |
