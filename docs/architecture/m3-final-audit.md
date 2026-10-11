# M3 — Source & Import Core: Final Audit (M3-WO10)

**Status: audit gate implemented; awaiting permanent CI.** This is the formal M3 closure document. M3 is declared
complete only after permanent GitHub CI is green on this Work Order.

## 1. M3 purpose

M3 turns real source documents into **reviewable, reproducible import evidence** — and stops there. It preserves exactly
what a source says (byte-exact Snapshots, verbatim structure), analyzes it deterministically (structural and semantic
extraction, identity matching, conflict evidence), and records explicit human review decisions. It never decides what a
Prowess rule *is*: nothing it does creates or changes an Entity, EntityVersion, definition, Canon decision or Ruleset.

## 2. Work Orders

| WO | Delivered |
| --- | --- |
| WO1 | Source Document & Source Structure Foundation — Snapshots, the deterministic DOCX parser, structure hashing |
| WO2 | Import Batch & Extraction Candidate Foundation — pinned Batches, immutable Candidates, fingerprints |
| WO3 | Structural Segmentation & Automated Extraction — exact extractor registry, `prowess.structural@1`, output hash |
| WO4 | Entity Matching, Normalization & Duplicate Detection — immutable MatchRuns, assessments, suggestions, duplicate groups |
| WO5 | Formula, Requirement & Keyword Semantic Extraction — `prowess.semantic-foundation@1` |
| WO6 | Conflict Detection & Import Review Decisions — derived conflict signals, append-only ImportDecisions |
| WO7 | Import HTTP API — 28 strict thin routes under `/api/import` |
| WO8 | Import Studio UI — Developer → Import workspace |
| WO9 | First real Prowess source import & validation (Core Playtest Packet V0.1) |
| WO10 | Final integration, historical reproducibility & audit gate (this document) |

## 3. Final architecture

```
SOURCE LAYER
────────────────
SourceDocument
      ↓
SourceSnapshot
      ↓
Source Structure

ANALYSIS LAYER
────────────────
ImportBatch
      ↓
ExtractionCandidates
      ↓
MatchRun
      ↓
Conflict Evidence

EDITORIAL LAYER
────────────────
ImportDecision
      ↓
Candidate Review State
      ↓
Review Complete

BOUNDARY
════════════════
NO DOMAIN MATERIALIZATION IN M3

Future:
Approved Candidate
      ↓
Domain-specific materialization
      ↓
Entity / EntityVersion / Definition
      ↓
Canon / Ruleset governance
```

Package layering (unchanged; enforced by `scripts/check-architecture.mjs`, no cycles):

```
@prowess/model  ←  @prowess/import  ←  @prowess/db  ←  HTTP (/api/import)  ←  Import Studio (via the typed client)
```

`@prowess/import` is pure (no database, network, clock, randomness, locale or AI); UI code never imports `@prowess/db`,
Prisma, repositories or `@prowess/import`.

## 4. Model inventory

| Layer | Prisma models (exact names) |
| --- | --- |
| Source | `SourceDocument` (M1), `SourceSnapshot`, `SourceSnapshotIngestion`, `SourceSection`, `SourceBlock`, `SourceTable`, `SourceAsset`, `SourceAssetPlacement`, `SourceContentNode` |
| Analysis | `ImportBatch`, `ExtractionCandidate`, `ExtractionCandidateSource`, `ImportMatchRun`, `CandidateMatchAssessment`, `CandidateMatchSuggestion`, `CandidateDuplicateGroup`, `CandidateDuplicateGroupMember` |
| Editorial | `ImportDecision` |
| Derived (never stored) | Import batch summary, extraction result, conflict signals, review summary |

**SourceDocument** is the conceptual source identity; **SourceSnapshot** is one exact byte version of it (several Snapshots
may belong to one Document).

## 5. Table ownership

| Domain | Tables | Mutable? | Mutation authority |
| --- | --- | --- | --- |
| Source structure | `source_snapshots`, `source_snapshot_ingestions`, `source_sections`, `source_blocks`, `source_tables`, `source_assets`, `source_asset_placements`, `source_content_nodes` | immutable after ingestion (insert-only; one atomic ingestion per Snapshot) | WO1 services (`ingestSourceSnapshot`, `ingestSourceStructure`) |
| Batches | `import_batches` | insert-only identity; workflow fields set only by extraction (`status`, `extraction_output_hash`, `extracted_at`) and review (`status`) | WO2 create, WO3 extraction commit, WO6 review |
| Extraction | `extraction_candidates`, `extraction_candidate_sources` | content immutable; only `status` changes, and only with a decision | WO2 / WO3 (insert); WO6 (status) |
| Matching | `import_match_runs`, `candidate_match_assessments`, `candidate_match_suggestions`, `candidate_duplicate_groups`, `candidate_duplicate_group_members` | immutable analysis snapshots (insert-only) | WO4 `analyzeImportBatchMatches` |
| Review | `import_decisions` | append-only | WO6 `reviewImportCandidate` / `completeImportReview` |

## 6. Public M3 service surface (frozen)

| Group | Services |
| --- | --- |
| Source structure | `createSourceSnapshot`, `getSourceSnapshot`, `listSourceSnapshots`, `findSourceSnapshotByContentHash`, `ingestSourceSnapshot`, `parseDocxStructure`, `ingestSourceStructure`, `hashSourceStructure`, `getSourceSnapshotIngestion`, `getSourceStructure`, `getSourceSection`, `listSourceSectionChildren`, `getSourceSectionContent`, `getSourceBlock`, `getSourceTable`, `getSourceAsset`, `listSourceAssets`, `listSourceAssetPlacements` |
| Import Batch | `createImportBatch`, `getImportBatch`, `getImportBatchSummary`, `listImportBatches`, `recordExtractionCandidates`, `getExtractionCandidate`, `listExtractionCandidates` |
| Extraction | `extractImportBatch`, `getExtractionResult`, `verifyExtractionOutput` |
| Matching | `analyzeImportBatchMatches`, `getImportMatchRun`, `listImportMatchRuns`, `getCandidateMatchAssessment`, `listCandidateMatchAssessments`, `listCandidateDuplicateGroups` |
| Conflict analysis | `analyzeImportConflicts` (derived, read-only) |
| Import review | `reviewImportCandidate`, `getImportDecision`, `listImportDecisionsForCandidate`, `listImportDecisionsForBatch`, `getImportReviewSummary`, `completeImportReview` |

No M3 service offers a "latest" convenience read. `findSourceSnapshotByContentHash` is an exact content-hash lookup.

## 7. HTTP surface

28 route files / 32 handlers under `/api/import` (matrix in `m3-import-api.md`, pinned route-by-route): GET reads plus six
named POST commands — register Snapshot metadata, create Batch, extract, create MatchRun, record one ImportDecision,
complete review. No PATCH / PUT / DELETE, no status / approve / reject / materialization / RuleConflict route. Strict body /
query / UUID validation; every handler maps errors centrally; unknown errors fail closed to an opaque 500.

## 8. Import Studio

Developer → Import (`m3-import-studio-ui.md`): source browsing and the Source Inspector, Create Batch, explicit extraction,
the paged source-ordered review queue, structured Candidate views with side-by-side source evidence, explicit MatchRun
selection (no auto-acceptance), conflict evidence, the single decision form (backend authoritative; action availability
from the shared `IMPORT_DECISION_RULES`), decision history, guarded completion, read-only completed Batches, mobile tabs
(QUEUE / SOURCE / DETAILS / HISTORY), accessibility. Network only through `src/api-client/import.ts`.

## 9. Invariant catalog

- **M3-I01** Exact Source Snapshot — a Snapshot is identified by its exact bytes (SHA-256); identical bytes reuse it.
- **M3-I02** Structure Determinism — the same bytes always produce the same structure and `structureHash`; structurally equivalent bytes may share a `structureHash` while remaining distinct Snapshots.
- **M3-I03** Source Immutability — ingested structure never changes; nothing later writes source tables.
- **M3-I04** Batch Exact Context — a Batch pins Snapshot, structure hash, scope, extractor key / version / config and comparison context; identical context is reused.
- **M3-I05** Extraction Determinism — re-extraction reproduces ids, fingerprints, ordinals, payloads, anchors and the output hash; a new extractor version is a new Batch.
- **M3-I06** Candidate Provenance — every Candidate cites the exact source node, offsets, excerpt and table cell.
- **M3-I07** Candidate Content Immutability — only `status` ever changes, and only through an ImportDecision.
- **M3-I08** MatchRun Snapshot Semantics — a MatchRun pins Batch, candidate-set hash, catalog hash, comparison Manifest and matcher identity; later catalog changes create new runs, never rewrite old ones.
- **M3-I09** No Implicit Match Acceptance — suggestions and exact matches are evidence; only a recorded decision classifies.
- **M3-I10** Import Conflict ≠ RuleConflict — Candidate CONFLICT never creates an M2 RuleConflict.
- **M3-I11** ImportDecision Append-Only — sequence 1..n per Candidate, never updated or deleted; exact retries are idempotent.
- **M3-I12** Explicit Review Transitions — the fixed workflow graph; APPROVED / REJECTED terminal; concurrent contradictions cannot both win.
- **M3-I13** Approved ≠ Canon — approval changes no EntityVersion lifecycle, policy, conflict, decision, Manifest or Release.
- **M3-I14** Completed ≠ Published — Review Complete only freezes review.
- **M3-I15** No Materialization — no Entity / Version / Alias / definition / RuleConflict / CanonDecision is created from Candidates.
- **M3-I16** Historical Reproducibility — earlier Snapshots, Batches, Candidates, MatchRuns and decisions re-read identically BY CONTENT after later activity.
- **M3-I17** No Hidden Latest — every historical operation uses an explicit id or exact pinned context.
- **M3-I18** Source Version ≠ Ruleset Version — a new Snapshot creates no EntityVersion, Ruleset, Manifest, Release or MigrationPlan.
- **M3-I19** Real Source Not Required by CI — permanent CI runs only synthetic fixtures; the Rulebook is not in the repository.
- **M3-I20** Domain / Governance Isolation — source / import operations write only M3 tables.

## 10. Coverage matrix

Each row lists automated guards (the final static audit verifies that every listed file exists and that at least one of
them cites the invariant id).

| Invariant | Integration (DB) | API | UI / Playwright | Static / unit |
| --- | --- | --- | --- | --- |
| M3-I01 | `m3-final-audit.test.ts`, `source-structure.test.ts` | `m3-import-api.test.ts` | — | `m3-source-structure-static.test.ts` |
| M3-I02 | `m3-final-audit.test.ts`, `source-structure.test.ts` | — | — | `m3-source-structure-static.test.ts` |
| M3-I03 | `m3-final-audit.test.ts`, `structural-extraction.test.ts` | — | — | `m3-source-structure-static.test.ts` |
| M3-I04 | `m3-final-audit.test.ts`, `import-batch.test.ts` | `m3-import-api.test.ts` | — | `m3-import-static.test.ts` |
| M3-I05 | `m3-final-audit.test.ts`, `structural-extraction.test.ts`, `semantic-extraction.test.ts` | — | — | `extraction.test.ts`, `semantic.test.ts` |
| M3-I06 | `m3-final-audit.test.ts`, `semantic-extraction.test.ts` | — | `import-studio.spec.ts` | `m3-import-ui-wo9-regressions.test.tsx` |
| M3-I07 | `m3-final-audit.test.ts`, `import-review.test.ts` | — | — | `m3-import-review-static.test.ts` |
| M3-I08 | `m3-final-audit.test.ts`, `entity-matching.test.ts` | `m3-import-api.test.ts` | — | `m3-entity-matching-static.test.ts` |
| M3-I09 | `m3-final-audit.test.ts`, `entity-matching.test.ts` | — | `import-studio.spec.ts` | `m3-import-ui.test.tsx` |
| M3-I10 | `m3-final-audit.test.ts`, `import-review.test.ts` | — | — | `m3-import-review-static.test.ts` |
| M3-I11 | `m3-final-audit.test.ts`, `import-review.test.ts` | `m3-final-api-audit.test.ts` | — | `m3-import-review-static.test.ts` |
| M3-I12 | `m3-final-audit.test.ts`, `import-review.test.ts` | `m3-import-api.test.ts` | `import-studio.spec.ts` | `review.test.ts` |
| M3-I13 | `m3-final-audit.test.ts` | — | `import-studio.spec.ts` | `m3-import-ui-static.test.ts` |
| M3-I14 | `m3-final-audit.test.ts` | `m3-final-api-audit.test.ts` | `import-studio.spec.ts` | `m3-import-ui-static.test.ts` |
| M3-I15 | `m3-final-audit.test.ts`, `semantic-extraction.test.ts` | — | `import-studio.spec.ts` | `m3-import-api-static.test.ts` |
| M3-I16 | `m3-final-audit.test.ts` | `m3-final-api-audit.test.ts` | — | — |
| M3-I17 | `m3-final-audit.test.ts` | — | — | `m3-final-static.test.ts` |
| M3-I18 | `m3-final-audit.test.ts` | — | — | `m3-final-static.test.ts` |
| M3-I19 | — | — | — | `m3-final-static.test.ts`, `m3-wo9-real-source-static.test.ts` |
| M3-I20 | `m3-final-audit.test.ts`, `import-review.test.ts` | `m3-import-api.test.ts` | — | `m3-final-static.test.ts` |

The **Golden M3 Import Lifecycle** (`packages/prowess-db/tests/integration/m3-final-audit.test.ts`) is the single
end-to-end reference: SOURCE → STRUCTURE → BATCH → EXTRACTION → MATCHING → CONFLICT EVIDENCE → REVIEW → COMPLETED, with
per-stage table write-boundary checks and a content-level re-read of the whole S1 / B1 history after later Snapshots,
Batches, MatchRuns, Versions, Aliases and decisions. It reuses the existing fixture helpers (DOCX builder, M2 golden
cleanup) rather than duplicating large fixtures; the existing large-structure / large-candidate / large-catalog tests
remain the performance sanity guards.

## 11. Historical reproducibility rules

1. History is re-read by content (source text, table values, payloads, anchors, assessments, evidence, rationale, status
   history) — id equality alone is not reproducibility.
2. Nothing historical is rewritten: later work creates new Snapshots, Batches, MatchRuns or decisions.
3. Every historical read uses an explicit id or the exact pinned context (Batch → Snapshot, MatchRun → catalog /
   Manifest, decision → evidence). The only descending read in M3 is a Candidate's own decision sequence.

## 12. Source / governance separation

Source and import operations write only M3 tables (per stage: ingestion → `source_*`; extraction → `import_batches`,
`extraction_*`; matching → match tables; review → `import_decisions` + Candidate / Batch status). All M2 governance tables
and M1 domain tables stay byte-identical except for fixture prerequisites a test deliberately creates.

## 13. Source version ≠ Ruleset version

A new SourceSnapshot (changed bytes — even with an identical `structureHash`) is a new source record. It does not create
an EntityVersion, Ruleset, Manifest, Release or MigrationPlan, replace Canon or migrate content.

## 14. Approved ≠ Canon

"Approved for Import" means only that a Candidate passed import review and may be used by a later materialization stage.

## 15. Review Complete ≠ Published

"Review Complete" freezes one Batch's review; nothing is published, imported into the game or materialized.

## 16. Materialization boundary

**M3 stops at the Approved Import Candidate.** Turning imported source into EntityVersions, FormulaDefinitions,
RequirementDefinitions or KeywordDefinitions — and any resulting M2 RuleConflict — requires a separately-specified,
domain-specific materialization system.

## 17. Real-source validation (WO9)

The architecture was validated on the real ~99 MB working Rulebook, **Prowess Core Playtest Packet V0.1** (98,897,516
bytes, SHA-256 `21fa6771ebdbb984941e55e45adaa8a7b6747555645530854ad401540ecde54d`, structure hash
`3d9a429c8a52c493141f4c5a8971a098d7e84e65262aeb88f461fef18d9bf1e7`): 2,487 sections, 14,269 content nodes, 13,461
blocks, 772 tables, 36 assets / 36 placements; 2,800 structural Candidates; a semantic survey of 92 Formulas, 289
Requirements and 244 Keywords; and a completed CASTING COMPONENTS review (13 Approved for Import, 3 Rejected, Review
Complete), with zero domain / governance mutation. Page count: UNAVAILABLE FROM SOURCE METADATA. Full record:
`docs/import-reports/m3-wo9-core-playtest-v0.1.md` (preserved as historical evidence; pinned by the final static audit).

## 18. Known M3 limitations

- No browser source upload and no source-byte blob lifecycle: SourceSnapshot identity is preserved by hash, metadata and
  structure; the original bytes stay externally supplied for re-ingestion (developer commands `pnpm import:source` /
  `pnpm import:verify-real-source`, explicit local file only). Prowess Studio does not permanently store the DOCX.
- No OCR or image interpretation.
- No domain materialization.
- The semantic extractor is intentionally conservative (see §19).
- No Entity extractor in the official registry (ENTITY Candidates exist only via test-only committed extractions).
- Server-side Candidate filtering is limited (no kind / status filters).
- Incomplete / working source documents are allowed and preserved as-is.
- Page count depends on the source's own metadata (absent in the real Rulebook).

## 19. Post-M3 backlog (unprioritized; not implemented in M3)

Semantic extraction grammar refinements (a new extractor version would be required):
- conjunction-leading requirement fragments from comma-splitting ("or vocalize");
- `½` fractions;
- parenthetical formula qualifiers ("(rounded down)");
- simple single-term assignments ("X = PRO");
- following-line formula qualifiers ("Round down." / "Minimum 1 AP.").

Platform:
- durable source-file storage / browser upload;
- server-side Candidate kind / status filters if needed at scale;
- Source outline search / collapse for very flat documents.

Domain:
- domain-specific materialization of Approved Candidates (separately specified).

## 20. M3 closure statement

M3 — Source & Import Core provides byte-exact, reproducible source records; deterministic structural and semantic
extraction with exact provenance; immutable identity-matching and conflict evidence; append-only, explicit human review;
a strict HTTP API and an Import Studio over it — validated on the real Prowess Core Playtest Packet V0.1 — without
materializing domain content or touching Canon governance. **M3 is complete once permanent GitHub CI passes this audit
gate.**
