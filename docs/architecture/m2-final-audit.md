# M2 Final Audit — Ruleset & Canon Governance (M2-WO12)

**Status: audit complete locally; awaiting permanent GitHub CI.** This document audits M2 as one integrated
governance system. M2-WO12 verified the architecture and did not redesign it. It made two approved fixes (F1, F2);
no Prisma migration was added.

```
Entity / EntityVersion / Source
        ↓
Ruleset → Manifest → CanonPolicy → RuleConflict → CanonDecision → ChangeSet → Impact Review
        ↓
Publication → RulesetRelease → MigrationPlan
```

## M2 at a glance

| WO | Delivered | Migration |
|---|---|---|
| WO1 | Ruleset foundation (identity, channel, status, parent lineage) | `add_ruleset_foundation` |
| WO2 | Immutable RulesetManifest snapshots of exact Versions | `add_ruleset_manifest` |
| WO3 | Manifest inheritance through exact `parentManifestId`; effective resolution with provenance | `add_manifest_inheritance` |
| WO4 | Immutable CanonPolicy snapshots with Ruleset-scoped source authority (exact → global → UNRESOLVED) | `add_canon_policy` |
| WO5 | RuleConflicts recording disagreements between exact Versions, with evidence | `add_rule_conflicts` |
| WO6 | Immutable CanonDecisions; the only path out of OPEN, race-safe | `add_canon_decisions` |
| WO7 | Immutable ChangeSet proposals; explicit decision translation; LIVE read-only impact | `add_change_sets` |
| WO8 | Review lifecycles; explicit atomic publication; flattened release manifests; SHA-256 composition hash | `add_ruleset_releases` |
| WO9 | Thin, strict HTTP API over the M2 services | — |
| WO10 | Studio governance workspace over the API; viewing-only Ruleset selector | — |
| WO11 | Migration *planning* over exact, hash-verified Releases; no execution | `add_migration_plans` |
| WO12 | This audit; fixes F1 and F2 | — |

**Migration chain:** 17 migrations (8 from M1, 9 from M2). All are hash-pinned by the final static audit, which also
asserts that none were added in WO12, squashed, or reordered. The chain rebuilds from empty on disposable dev and test
databases, and the blocking drift gate reports **No difference detected**.

## Major invariants (and where they are proven)

| Invariant | Evidence |
|---|---|
| Historical records are immutable; later state never rewrites earlier state | Golden history: every object re-read after later Versions, policies, conflicts, decisions, ChangeSets, Releases, and plans is deep-equal to its original |
| Resolution follows exact ids; no hidden "latest" | Final static audit pins the complete allowlist of latest-style reads (named convenience queries, M1 display, WO8's mandated linear-history check); historical paths contain none (mutation-checked) |
| No current/active authority is persisted | Static audit over schema fields and all source (comments excluded); the UI selector is URL-derived and non-persistent |
| Ruleset isolation | Golden-history test: nothing lists across Rulesets; wrong-Ruleset policy, candidate, decision, manifest, and ChangeSet references fail with controlled errors; authority never leaks |
| The database enforces same-scope references | Direct inserts rejected by 8 composite keys (§28) |
| History cannot be destroyed | Direct deletes rejected by RESTRICT across 9 dependency kinds; no M2 key is anything but RESTRICT |
| Approved mutations are atomic | A late-failure test in every mutating area (audit index §25) |
| Concurrency has a single winner | Allocation, decisions, review transitions, first and subsequent publication (§26) |
| Releases are independently verifiable | Hash verifies and recomputes in any order; test-only tampering is detected and blocks planning |
| **Published content is frozen** (F1) | Publishing an editable Version is refused; a published Version cannot be edited |
| Compatibility is never overstated | Plans assign only UNCHANGED / REVIEW_REQUIRED |
| No auto-publish, auto-migration, or forced upgrade | Approvals, decisions, ChangeSets, and policies create no Release; a new Release creates no plan; preview persists nothing |
| No Rules Engine, keyword, authority, or lifecycle "auto-winner" | Static audit over all M2 code |

## The golden history fixture

`packages/prowess-db/tests/integration/fixtures/m2-golden-history.ts` builds one miniature, complete M2 history, using
only the public services:
- Entities A, B, C, with Versions moved out of DRAFT through the lifecycle;
- two SourceDocuments and two SourceReferences;
- M1, P1, C1 → D1 → CS1 (proposed, impact-analysed, approved), then R1;
- M2, P2, C2 → D2 → CS2, then R2;
- MigrationPlan R1 → R2.

It returns every exact id through aliases and cleans up by key prefix. **Intended use:** the baseline regression
fixture for M3/M4. A future suite builds it, does its new work, and asserts the history is still byte-identical.

## Audit scenarios and results (`m2-final-audit.test.ts`, 13 tests — all pass)

1. **Exact original references (§3, §4).** Checked: M1 pins, P1 records, C1 candidates with their evidence, D1's
   selection, CS1's operation (REPLACE A1→A2 against M1), the R1/R2 compositions, and the plan's items and hashes.
2. **Inheritance (§8).** A child manifest's effective composition (explicit B2 plus A1 inherited at depth 1 from M1) is
   unchanged after a newer parent-Ruleset manifest is created. M1 is unchanged, and release manifests are parentless.
3. **Policy reproducibility and source independence (§10, §11).** P1 resolves exact → global → UNRESOLVED inside P1
   only. P2's different authority neither changes P1 nor serves as a fallback. SourceDocument's own
   `authorityStatus` is never written by policies.
4. **Impact (§15, §16).** Repeated analysis is identical and writes nothing (fingerprint of 18 tables). After a
   relationship and a keyword are added through normal services, the live report changes and the ChangeSet does not.
5. **Hashes, tampering, linear history (§18–§20).** Hashes verify and recompute. Tampering is detected and makes plan
   creation fail with `MANIFEST_INTEGRITY_FAILURE`, persisting nothing. Publishing from an older manifest is a
   controlled conflict.
6. **Ruleset isolation (§7).**
7. **Later activity (§9, §17, §21, §22, §24, §55, §56).**
   - **Steps:** a new Version, policy, conflict, decision, and ChangeSet are approved; there is still no Release. A
     preview persists nothing. R3 is published; there is still no new plan.
   - **Then the full historical snapshot is deep-equal.** The old plan is still R1→R2 and never mentions R3.
   - **R1 remains usable:** it verifies, compares, and serves as a plan endpoint.
8. **Concurrency (§26).** Five concurrent manifest and policy creations each yield 1…5. Four concurrent decisions yield
   one. Approve/reject races yield one winner. Four concurrent first publications yield one. Four concurrent second
   publications yield one. There are no orphan manifests.
9. **RESTRICT (§27)** for 9 dependency kinds.
10. **Composite integrity (§28)** for 8 wrong-scope inserts.
11. **F1 content reproducibility (req. 10)** — see below.
12. **F1 negative case (req. 11)** — see below.
13. **F2** — see below.

The final static audit (`m2-final-static.test.ts`, 29 tests) covers §5, §6, §41–§45, §50–§54, and §62, plus an
index of the transaction and concurrency regression tests. The WO1–WO11 audits remain in force.

## Fixes discovered and made in WO12

### F1 — published content could be edited (fixed; approved Option A)
**Defect.**
- A Release pins Version ids, and its hash covers ids only.
- `updateDraftEntityVersion` could still edit a DRAFT Version pinned by a published Release.
- The Release kept verifying while its content changed (demonstrated by a probe on the golden history).

**Fix.** Publication now refuses a final composition that pins an editable Version:
`RULESET_RELEASE.MUTABLE_VERSION_PINNED` (409).
- **Where:** checked inside the publication transaction, under the Ruleset lock, before any write.
- **What it never does:** promote or modify a Version, or affect development manifests.

**Clarification surfaced during the fix.**
- The approved rule said "DRAFT". However, requirement 6 ("no lifecycle path returns a non-DRAFT Version to DRAFT")
  is **false in M1**: `IN_REVIEW → DRAFT` is the send-back path.
- To achieve the stated purpose, the refused set is **derived** from the lifecycle graph: DRAFT plus any status that
  can reach DRAFT. That is {DRAFT, IN_REVIEW} today.
- A unit test pins both the derived set and the fact that IN_REVIEW is the only transition into DRAFT.
- Narrowing to DRAFT only (accepting the gap), or removing M1's send-back path, would each be a one-line change if
  preferred.

**Tests.**
- **Content regression:** a published, frozen Version rejects `updateDraftEntityVersion` (`ENTITY_VERSION.IMMUTABLE`).
  Its row and the Release are byte-identical, and the hash verifies.
- **Negative case:** a DRAFT pin and an IN_REVIEW pin are both refused, with complete rollback.
- **Final composition counts:** a base pinning a mutable Version publishes once the ChangeSet replaces it, and the
  mutable Version is untouched.

**Fixture impact.** Every publishing test now moves its fixture Versions DRAFT → IN_REVIEW → APPROVED through the
normal lifecycle (the service in DB tests, the HTTP status route in E2E), never by direct writes. This covers the
WO8, WO9, WO10 E2E, and WO11 suites and the golden fixture.

### F2 — evidence-protecting refusal surfaced as a raw database error (fixed)
**Defect.** Removing a SourceReference cited by a RuleConflictCandidate was correctly refused by RESTRICT, but it
surfaced as Prisma P2003 (an opaque 500 over HTTP).

**Fix.** `removeSourceReference` translates **only** a P2003 on `rule_conflict_candidates_source_reference_fkey` into
`SOURCE_REFERENCE.IN_USE` (409).
- The RESTRICT key is unchanged, and evidence is never detached.
- Any other P2003, and any other error, passes through unchanged to the generic 500.

**Tests.**
- Pure unit tests of the translator (the known constraint, other constraints, other errors).
- A real-PostgreSQL test: referenced removal → `IN_USE` with conflict evidence identical; unreferenced removal still
  succeeds.

Both new codes are in the domain vocabulary, the exhaustive HTTP map, and the error audits.

## API and UI

- **API:** the WO9 route inventory, strictness, error boundary, and "latest" semantics are unchanged and covered by
  `m2-api-static` and the six M2 API integration suites (71 API tests in total, M1 included).
- **UI:** the WO10 Playwright governance suite covers:
  - the full flow, through publication, hash verification, and compare;
  - historical URLs in a fresh browser context;
  - the selector (no writes, unchanged database fingerprint);
  - explicit vs. effective manifests, authority resolution, stale publication, and hash mismatch;
  - mobile.

  The `m2-ui-static` audit forbids "Current/Active" wording and edit/delete controls on historical pages. In WO12 only
  its fixtures changed (Versions promoted per F1).

## M1 regression

The M1 audit gates (static, DB, API) pass. The Entity, Version history, Alias, Keyword, Relationship, and Source suites
pass within the integration totals. The Compendium and Version History E2E specs are unchanged.

## Test totals (local CI replica)

| Suite | Tests |
|---|---|
| `@prowess/model` unit | 448 |
| `@prowess/ui` unit | 21 |
| `@prowess/db` unit | 46 |
| DB integration (real PostgreSQL) | 361 |
| Studio unit / static audits | 800 |
| Studio API integration | 71 |
| Playwright | existing M0/M1 suites plus the M2 governance spec |

## Performance sanity (flagged, not changed)

- **Impact analysis issues a few queries per operation.** It is bounded (1 to 100 operations, one-hop relationships,
  manifest inheritance walked level by level with a visited set). Acceptable at Phase-1 sizes.
- **The UI resolves Entity and Version labels per id**, cached per page session. Acceptable for internal volumes;
  batch endpoints may help later.
- **List endpoints page over full service results** (see technical debt).
- **No unbounded recursion was found.** Inheritance resolution and descendant discovery use visited sets.

## Security and safety sanity

- `DEVELOPMENT_MODE` and database URLs never appear in client components (static audit).
- Unexpected errors are opaque 500s (tested with injected Prisma codes, SQL, and paths).
- The destructive test reset is guarded and refuses non-test targets (CI gate).
- **Authentication is intentionally deferred.**

## Known technical debt and deferred work

1. **List pagination:** Phase-1 API list pagination runs over ordered service results, not database-native
   pagination. It must move to the database before large imports or public API use.
2. **SourceReference picker:** RuleConflict candidates take an optional SourceReference **id**; there is no rich
   per-Version picker yet.
3. **MigrationPlan exposure:** no HTTP route or UI, because creation migrations don't exist yet.
4. No authentication or authorization.
5. No Rules Engine, so migration compatibility stays conservative.
6. No Source Import pipeline (M3).
7. No public-player UX.
8. **Lifecycle semantics:** M1 allows `IN_REVIEW → DRAFT`. F1 accounts for it; whether to keep the send-back path is a
   future lifecycle decision.

## M3 readiness assessment

| Requirement | Status |
|---|---|
| Stable Entity/Version foundation | ✅ M1 audit gates green; Versions immutable once out of the editable states |
| Source provenance | ✅ SourceDocuments and References; evidence protected (RESTRICT, F2) |
| Ruleset snapshotting | ✅ Immutable manifests; exact inheritance |
| Canon governance | ✅ Policies, conflicts, and decisions: explicit, immutable, isolated |
| Immutable publishing | ✅ Flattened, hash-verifiable Releases; frozen content (F1) |
| Legacy preservation | ✅ Old Releases retrievable, verifiable, comparable; plans pinned |
| API/UI boundaries | ✅ Thin strict API; API-only UI (audited) |
| Zero drift | ✅ No difference detected |
| Green CI | ⏳ Pending permanent GitHub CI for this branch |

**Readiness decision:** the platform is **ready for M3 — Source & Import Core** once permanent GitHub CI is green on
this branch. M3 should build on the golden history fixture as its regression baseline.
