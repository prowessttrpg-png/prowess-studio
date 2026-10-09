# Conflict Detection & Import Review Decisions (M3-WO6)

**Status: implemented; awaiting CI verification.** Deterministic import-conflict evidence, explicit editorial
classification, an immutable ImportDecision history, and controlled Candidate workflow transitions. Nothing is
materialized: no Entity, EntityVersion, alias, Formula / Requirement / Keyword definition or relationship is created
from a Candidate, and no M2 RuleConflict is created.

```
ExtractionCandidate
       ↓
Automated evidence          (WO4 MatchRuns; WO6 derived conflict signals — never change status)
       ↓
Human ImportDecision        (explicit, append-only, atomic)
       ↓
Candidate Status            (the current workflow state)
```

```
APPROVED
       ≠
CANON
```

**APPROVED** means only: *the Candidate has passed the import review workflow and may be used by a later
materialization / domain-import stage.* It does **not** mean Canon, EntityVersion lifecycle CANON, published, part of a
Ruleset or Manifest, mechanically correct, or balanced.

## Three separate things

| | what | changed by |
| --- | --- | --- |
| automated evidence | MatchRuns (WO4), conflict signals (WO6) | analysis only — never touches a status |
| editorial decision | `ImportDecision` (immutable) | `reviewImportCandidate` only |
| current workflow state | `ExtractionCandidate.status` | only as part of recording a decision |

## Import conflict vs M2 RuleConflict

```
Candidate CONFLICT
       ≠
M2 RuleConflict
```

An M2 RuleConflict is defined over exact EntityVersions. An ExtractionCandidate is source-analysis evidence, not an
EntityVersion, so WO6 never creates a RuleConflict from a Candidate and never fabricates temporary EntityVersions to
satisfy M2 foreign keys. The future flow is:

```
Approved Candidate
       ↓
Domain-specific materialization
       ↓
EntityVersion
       ↓
M2 RuleConflict if still necessary
```

## Conflict signals (derived, read-only)

`analyzeImportConflicts(importBatchId, matchRunId)` — the caller names the exact MatchRun (never a latest / current
one), which must belong to the same Batch (`IMPORT_DECISION.MATCH_RUN_MISMATCH`). One signal per WO4 duplicate group,
in the run's deterministic group order, members by Candidate ordinal:

| Signal | When |
| --- | --- |
| `DUPLICATE_EQUIVALENT` | one shared payload schema key + version, canonically-equal payloads (e.g. the same statement in two places) |
| `POTENTIAL_CONTENT_CONFLICT` | one shared schema, canonically-different payloads |
| `UNCOMPARABLE_DUPLICATE` | the members' schema key / version differ — versions are never translated or guessed |

Only `payloadSchemaKey`, `payloadSchemaVersion` and the canonical payload (`@prowess/import` canonical JSON) are
compared — never ids, anchors, status, confidence or time. A signal says *that* payloads differ, never *which* is
right: "cost 4 vs cost 6" is a POTENTIAL_CONTENT_CONFLICT, not "6 MP is correct", "the newer document wins" or "B is
Canon". Signals never change a status, never create a decision or a RuleConflict, and are never persisted. Equivalent
duplicates are not deduplicated: the reviewer may approve one, both, reject one or defer.

## ImportDecision — append-only history

| Field | Meaning |
| --- | --- |
| `extractionCandidateId`, `importBatchId` | the Candidate (composite key: it belongs to that Batch) |
| `sequenceNumber` | 1, 2, 3 … per Candidate, unique, gap-free |
| `decisionType` | an explicit command (below) |
| `fromStatus` / `toStatus` | the transition applied |
| `candidateFingerprint` | the exact extracted content reviewed — composite key onto the Candidate's own fingerprint |
| `candidateSetHash` | the Batch's `extractionOutputHash` — composite key onto the Batch |
| `matchRunId` / `matchAssessmentId` / `duplicateGroupId` | optional exact evidence (see below) |
| `matchBasis` | `EXACT_MATCH` / `SUGGESTED_MATCH` / `MANUAL_OVERRIDE` (CLASSIFY_MATCHED only) |
| `targetEntityId` / `comparisonEntityVersionId` | the stable Entity and an exact comparison Version, when applicable |
| `rationale` | authored text, stored exactly as given; required for REJECT and MANUAL_OVERRIDE |
| `decisionFingerprint` | `PROWESS_IMPORT_DECISION_V1` (unique) |

Decisions are never updated or deleted. If later source material needs different treatment, a new Snapshot / Batch /
Candidate history exists.

## Decision types and the workflow graph

| Type | Transition | Kinds | Rules |
| --- | --- | --- | --- |
| `CLASSIFY_MATCHED` | → MATCHED | ENTITY, ENTITY_FIELD | `targetEntityId` + `matchBasis` required |
| `CLASSIFY_NEW_ENTITY` | → NEW_ENTITY | ENTITY, ENTITY_FIELD | no target — no Entity is created or reserved |
| `MARK_CONFLICT` | → CONFLICT | identity + semantic | may cite a duplicate group / run / target / comparison Version |
| `MARK_NEEDS_MAPPING` | → NEEDS_MAPPING | all | unknown identity, unsupported schema, ambiguous terms … |
| `REJECT` | → REJECTED | all | rationale required; the Candidate stays stored forever |
| `APPROVE_MATCHED` | MATCHED → APPROVED | ENTITY, ENTITY_FIELD | must name the same Entity as the accepted MATCHED classification |
| `APPROVE_NEW_ENTITY` | NEW_ENTITY → APPROVED | ENTITY, ENTITY_FIELD | no target |
| `APPROVE_SEMANTIC` | UNREVIEWED → APPROVED | FORMULA, REQUIREMENT, KEYWORD | creates no Formula / Requirement / Keyword definition |

```
UNREVIEWED    → MATCHED | NEW_ENTITY | CONFLICT | NEEDS_MAPPING | REJECTED | APPROVED (APPROVE_SEMANTIC only)
MATCHED       → APPROVED | CONFLICT | NEEDS_MAPPING | REJECTED
NEW_ENTITY    → APPROVED | CONFLICT | NEEDS_MAPPING | REJECTED
CONFLICT      → MATCHED | NEW_ENTITY | NEEDS_MAPPING | REJECTED       (never directly APPROVED)
NEEDS_MAPPING → MATCHED | NEW_ENTITY | CONFLICT | REJECTED            (never directly APPROVED)
APPROVED, REJECTED: terminal
```

- **Entity Candidates** (ENTITY / ENTITY_FIELD) must first be classified MATCHED or NEW_ENTITY; "approve" never hides
  identity.
- **Semantic Candidates** (FORMULA / REQUIREMENT / KEYWORD) carry no stable Entity identity and can be approved
  directly. Approving Keyword "Damage" creates no KeywordDefinition and no damage mechanics.
- **Structural Candidates** (UNKNOWN / REFERENCE, and RELATIONSHIP for now) can only be REJECTED or marked
  NEEDS_MAPPING — "a section was found" is never an approved rule.
- CONFLICT and NEEDS_MAPPING must be resolved editorially (classified) before approval, leaving an explicit trail.

There is no generic status setter, no `updateImportDecision`, no delete.

## Evidence pinning and manual override

- `matchRunId` must analyse the same Batch (`MATCH_RUN_MISMATCH`); `matchAssessmentId` must be of that run **and** that
  Candidate; `duplicateGroupId` must be of that run **and** have the Candidate as a member (`DUPLICATE_GROUP_MISMATCH`)
  — enforced in the service and by composite foreign keys (the membership key points at the member row itself).
- **EXACT_MATCH** — the cited assessment must be an EXACT_MATCH whose `matchedEntityId` is the target.
- **SUGGESTED_MATCH** — the target must be one of the cited assessment's suggestions. The reviewer chooses explicitly;
  rank 1 is never chosen automatically.
- **MANUAL_OVERRIDE** — any existing stable Entity, with a mandatory rationale; the MatchRun is never altered to pretend
  the matcher chose it.
- `comparisonEntityVersionId` may only be the exact comparison Version the cited assessment supplied for the target —
  never a newer or "latest" Version. Pinned evidence stays pinned: a later MatchRun or EntityVersion never changes a
  stored decision.

## Atomicity, concurrency, idempotency

One transaction per decision: row-lock the Batch (still READY_FOR_REVIEW / REVIEWING → REVIEWING), compare-and-set the
Candidate (still `fromStatus` with the reviewed fingerprint → `toStatus`), prove the sequence is next, insert the
decision. Either the decision and both status changes commit, or nothing does. Two contradictory concurrent reviews
cannot both succeed — the loser receives `IMPORT_DECISION.DECISION_CONFLICT` (or `INVALID_TRANSITION` once the winner's
status is visible).

`decisionFingerprint` = SHA-256 of `PROWESS_IMPORT_DECISION_V1\n` + canonical JSON of the candidate id, candidate
fingerprint, candidate-set hash, sequence number, from-status, decision type, basis, target, comparison Version, run,
assessment, group and the exact rationale (ids lowercased; no database id or timestamp). An exact retry of a
Candidate's latest decision reproduces that fingerprint and returns the existing decision (`created: false`) — no
duplicate row, also under concurrency. A materially different request is not a retry.

Only `ExtractionCandidate.status` ever changes: payload, schema, confidence, anchors, fingerprint, ordinal, labels and
proposed identity are immutable before and after any review.

## Batch review lifecycle

- The first decision on a READY_FOR_REVIEW Batch moves it to **REVIEWING**, in the same transaction.
- `completeImportReview(importBatchId)`: **REVIEWING → COMPLETED** only when every Candidate is APPROVED or REJECTED
  (checked under the Batch row lock), else `IMPORT_REVIEW.INCOMPLETE`. COMPLETED means "review of this immutable
  extraction set is finished" — not published, not materialized. A COMPLETED Batch accepts no more decisions.
- CANCELLED stays reserved.

## Services (`@prowess/db`; no HTTP routes, no UI)

`reviewImportCandidate`, `getImportDecision`, `listImportDecisionsForCandidate`, `listImportDecisionsForBatch`,
`analyzeImportConflicts`, `getImportReviewSummary(importBatchId, { matchRunId? })` (derived counts; the potential-
conflict count only for an explicitly named run), `completeImportReview`.

## Errors

| Code | HTTP (when exposed) |
| --- | --- |
| `IMPORT_DECISION.NOT_FOUND` / `CANDIDATE_NOT_FOUND`, `IMPORT_REVIEW.BATCH_NOT_FOUND` | 404 |
| `IMPORT_DECISION.INVALID_INPUT` / `INVALID_EVIDENCE` / `INVALID_TARGET_ENTITY` / `MATCH_RUN_MISMATCH` / `DUPLICATE_GROUP_MISMATCH` / `MANUAL_RATIONALE_REQUIRED` | 400 |
| `IMPORT_DECISION.INVALID_TRANSITION` / `DECISION_CONFLICT`, `IMPORT_REVIEW.NOT_READY` / `INCOMPLETE` | 409 |

## Roadmap boundary

| Work Order | Responsibility |
| --- | --- |
| **WO6** (this) | conflict evidence + human review decisions |
| WO7 | HTTP API over the M3 services |
| WO8 | Studio review UI |
| WO9 | first real Prowess import / review using the actual source |
| WO10 | final audit / reproducibility gate |

Domain-specific EntityVersion materialization (and, through it, any M2 RuleConflict) remains outside generic WO6 — a
later M5 / domain-import stage reads APPROVED Candidates and never rewrites them.
