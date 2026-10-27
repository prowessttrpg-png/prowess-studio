# M0–M5 Application Audit — M5-CLOSEOUT-01 (Architecture, Technical Debt & Performance)

Status: AUDIT ONLY. No application code, test, workflow, schema or mechanic was changed. Every timing below is either a
GitHub Actions measurement (labelled **GH**) or a local measurement on this 2-vCPU cloud container (labelled **LOCAL**).
Projections are labelled **ESTIMATE** and are not measurements. Mechanics are frozen; M5-SC-042 and M5-SC-046 through
M5-SC-053 remain UNRESOLVED; M5-SC-054 remains resolved by the M5-WO13 ruling.

## 1. Baseline SHA

- **Audited baseline:** `0847ca7fa3d2b4cfb70d12a9186ed40a162a0d9a` — `Merge pull request #54 from prowessttrpg-png/m5-wo13`
  (tree `028a859e204906e199707b30a05f3d542910452f`, parents `feed5df…` and `fc08186…`). This is the M0–M5
  PRE-OPTIMIZATION BASELINE.
- **Reconstruction procedure (this environment cannot fetch from GitHub — HTTP 403):** the commit's signed payload and
  PGP signature were read from the GitHub API (`git/commits/0847ca7…`, `verification.verified: true`); the commit object was
  rebuilt as `payload headers + gpgsig header + body` and written with `git hash-object -t commit -w`. **Verification:** the
  recomputed object hash is exactly `0847ca7fa3d2b4cfb70d12a9186ed40a162a0d9a`; its tree `028a859…` is byte-identical to the
  locally held WO13 head `fc08186…` tree, so the reconstructed `main` is the canonical `main`. Local `main` and
  `origin/main` were pointed at it; the working tree was clean.
- **Audit branch:** `m5-closeout-01-audit` (from that baseline; only this report is added).
- **Merged-main verification at baseline (GH):** Prowess Studio CI #215 success (4,763 s) and M5-WO7 #58, WO8 #15, WO9
  #11, WO10 #9, WO11 #6, WO12 #4, WO13 #2 all success; PR #54's eight checks (CI #214 + seven WO workflows) success.
- **Baseline totals:** unit 5,170 (model 513, ui 21, import 128, rules 659, game 910, db-unit 96, Studio 2,843); DB
  integration 523 / 523 in CI; Studio API integration 165; Playwright 45; mutation / negative controls 280 (M4 final 3 +
  M5-WO1…WO13 277, WO7's 22 included); invariants M5-I001–M5-I337; conflict register: 10 UNRESOLVED (SC-042, SC-044,
  SC-046–SC-053) plus RESOLVED_BY_DESIGNER entries including SC-054.

## 2. Repository Structure

981 tracked files; `.git` 12 MB (pack 2.98 MiB). Production / test lines of code (LOCAL, `git ls-files`):

| Package | Role | Prod LOC | Test LOC |
| --- | --- | ---: | ---: |
| `@prowess/model` | domain types, enums, validators | 5,538 | 2,300 |
| `@prowess/ui` | shared UI primitives | 397 | 200 |
| `@prowess/import` | source / import pipeline (pure) | 1,959 | 943 |
| `@prowess/rules` | M4 generic Rules Engine (frozen) | 7,782 | 4,763 |
| `@prowess/game` | M5 Prowess mechanics (pure) | 15,585 | 6,515 (+ `src/testing` fixtures) |
| `@prowess/db` | Prisma persistence, M1–M3 services, materialization | 11,286 | 14,106 |
| `@prowess/test-fixtures` | placeholder (one constant) | 9 | 0 |
| `apps/studio` | Next.js app, 83 API route handlers, 58 TSX / 116 TS files | 11,494 | 18,465 |

Scripts: 14 mutation / negative-control scripts, `check-architecture.mjs`, env helpers. Workflows: `ci.yml` plus seven
dedicated `m5-wo7.yml` … `m5-wo13.yml`.

## 3. Current Package Graph

```
model ← ui
model ← import
model ← rules (M4, frozen)
model, rules ← game (M5, pure)
model, import, rules, game ← db (Prisma)
model, rules, ui, db ← studio   (studio → db → game: game is reached transitively, never imported directly — M5-I017)
test-fixtures (no dependents)
```

The architecture check (12 import-boundary rules, 8 packages) reports no violations or cycles. No package imports a large
surface for a single helper beyond the intentional M4 plain-data duplication (§16).

## 4. Current CI Graph

On every `pull_request` and every push to `main`, **eight workflows start at once, each on its own runner**, each doing a
full checkout → pnpm → Node → install:

| Workflow | Job | Service | Setup | Work |
| --- | --- | --- | --- | --- |
| `ci.yml` (Prowess Studio CI) | `ci` (1 job, 57 steps, **all sequential**) | Postgres | DBs, Prisma validate / generate / migrate ×2 / drift, package build | lint → arch → typecheck → package unit → DB integration → Studio unit → API integration → 18 M1 / M4 gate steps → 14 M5 gate steps → guarded reset → Playwright install → production build → Playwright |
| `m5-wo7.yml` … `m5-wo9.yml` | 1 job each | none | install, build model / rules / game | that WO's game tests + static + controls |
| `m5-wo10.yml` … `m5-wo13.yml` | 1 job each | Postgres | install, migrate, build packages | that WO's game tests + static + Inspector fixture + DB history + API + controls |

No workflow declares `concurrency`, `timeout-minutes`, job dependencies or artifacts. Caching: `actions/setup-node`
`cache: pnpm` (install takes 2–3 s, so the store cache hits). No Next.js, Playwright-browser or test-result cache.

## 5. Current Workflow Timings (GH)

Merged-main run for the baseline (CI #215 + the seven WO workflows, all started 21:55:40Z, queue ≈ 3 s):

| Workflow | Duration |
| --- | ---: |
| Prowess Studio CI #215 (`ci` job) | **4,760 s (79.3 min)** |
| M5-WO12 #4 | 1,092 s |
| M5-WO13 #2 | 533 s |
| M5-WO11 #6 | 463 s |
| M5-WO10 #9 | 150 s |
| M5-WO7 #58 | 141 s |
| M5-WO8 #15 | 82 s |
| M5-WO9 #11 | 79 s |

**Total PR verification wall-clock = total merged-main wall-clock ≈ the `ci` job (72–79 min);** the WO workflows run in
parallel and finish earlier. Runner time per push ≈ 4,760 + 2,540 = **7,300 s (≈ 122 runner-minutes)**; a WO cycle (PR +
merge) ≈ 4 runner-hours. `ci` growth per Work Order: CI #210 / #211 (WO11 PR / main) 2,515 / 2,328 s → #212 / #213 (WO12)
3,254 / 3,774 s → #214 / #215 (WO13) 4,310 / 4,763 s: **+9 to +15 minutes per Work Order**, almost all of it new mutation
controls and repeated test executions.

`ci` #215 time by phase (sums of step durations, GH):

| Phase | Seconds | Share |
| --- | ---: | ---: |
| Setup (containers, checkout, Node, install, Prisma validate / generate / migrate ×2 / drift, package build) | 69 | 1.4% |
| Lint 25 · architecture 0 · typecheck 30 | 55 | 1.2% |
| Package unit 502 · DB integration 204 · Studio unit 47 · API integration 40 | 793 | 16.7% |
| M1 / M4 gate steps (18 steps) | 66 | 1.4% |
| **M5 gate steps (WO1 … WO13, 14 steps)** | **3,663** | **77.0%** |
| ↳ of which mutation / negative controls | 2,399 | 50.4% |
| ↳ of which re-running tests already run above | ≈ 1,264 | 26.6% |
| Guarded reset 14 · Playwright install 21 · production build 39 · Playwright 35 | 109 | 2.3% |

## 6. Test Execution Matrix

How often each test physically runs per push (`ci` job + dedicated workflows):

| Suite | Base step in `ci` | Re-run in `ci` gate | Re-run in dedicated WO workflow | Physical runs |
| --- | --- | --- | --- | ---: |
| **entire `@prowess/game` suite (910 tests)** | Unit tests (packages) | M5-WO1 gate (`pnpm --filter @prowess/game run test:unit`, 337 s) | — | **2** |
| WO2–WO6 golden / contract game files | unit | own gate (+ canon-rulings gate re-runs core / runtime / affinity / vocabulary) | — | 2–4 (`vocabulary.test.ts` 4) |
| WO7, WO8, WO9 game files + static | unit / Studio unit | own gate | m5-wo7 / wo8 / wo9 | 3 |
| WO10–WO13 golden + contracts | unit | own gate | m5-wo10 … wo13 | 3 |
| WO2–WO13 DB Inspector fixtures | unit (db) | own gate | m5-wo10 … wo13 (for WO10–13) | 2–3 |
| WO2–WO13 DB history tests | DB integration | own gate | m5-wo10 … wo13 | 2–3 |
| WO2–WO13 Studio API tests | API integration | own gate | m5-wo10 … wo13 | 2–3 |
| M1 / M4 static, DB and API gate files | Studio unit / DB / API | own gate | — | 2 |
| WO5–WO13 static gates | Studio unit | own gate | dedicated (WO7–13) | 2–3 |
| WO7 negative controls (22) | — | — | **m5-wo7 only** | 1 |
| All other control scripts | — | own gate | dedicated (WO8–13) | 1–2 |
| Playwright (45) | — | — | — | 1 |

## 7. Duplicate Test Executions

The assertions are not duplicated; the **physical executions** are. In the `ci` job alone (GH, step logs of #215):

| Duplicate execution | Seconds |
| --- | ---: |
| Whole game suite re-run in the WO1 gate | 337 |
| WO-specific game files re-run in WO2–WO13 gates (WO12 188, WO13 110, WO11 45, WO9 34, WO8 28, WO10 23, others ≈ 30) | ≈ 458 |
| DB Inspector fixtures re-run (WO12 103, WO11 62, WO13 43, WO10 28, others ≈ 10) | ≈ 246 |
| DB history tests re-run (WO12 26, WO11 16, WO13 14, WO10 10, others ≈ 20) | ≈ 86 |
| Studio static / API / M1 / M4 gate re-runs | ≈ 135 |
| **Total duplicate physical execution in `ci`** | **≈ 1,260 s (21 min)** |

Plus the seven dedicated workflows (≈ 2,540 runner-seconds per push) re-run their WO's gate a further time on separate
runners. They do not lengthen wall-clock (parallel) but double runner cost; their only unique content is the WO7 negative
controls.

## 8. Mutation Control Timing

GH (CI #215, time from each gate's last test to its last control line): M4 final 6 s · WO1 68 · WO2 91 · WO3 86 · WO4 150 ·
WO5 145 · WO6 75 · WO8 21 · WO9 33 · WO10 111 · WO11 262 · **WO12 680** · **WO13 677** — **≈ 2,405 s (40 min), 50% of
`ci`**, all serial.

Execution model (all 13 M5 scripts, LOCAL code reading): for every control → spawn a full Vitest process for the
**baseline** guard, write the mutation, spawn Vitest again (**mutated**), restore, compare bytes, spawn Vitest a **third** time
(**restored**). ≈ 3 processes × 277 M5 controls ≈ **830 Vitest launches per `ci` run**. Measured costs (LOCAL):

- Fixed Vitest start-up + TypeScript transform of `@prowess/game`: **1.9–2.2 s per launch** (`vocabulary.test.ts`: wall
  1.93–2.18 s, test time ≈ 1%).
- A single targeted WO13 golden: **≈ 4.1 s per launch** (Duration 3.74 s: 56% test, 37% transform).
- Baseline runs repeat the same guard: WO10 17 controls / 8 distinct guards; WO11 26 / 14; WO12 26 / 20; WO13 30 / 21.
- The post-restore re-run is logically redundant with the byte-for-byte restoration check plus the green baseline.
- Controls mutate the shared working tree, so they cannot run in parallel inside one checkout.
- Every launch re-transforms the same sources; no Vitest worker, transform cache or fixture is reused across controls.

All 280 controls still guard existing source (anchors matched exactly for WO13; every script's restoration check passed
at baseline); no control was found to target removed code.

## 9. DB Setup Timing (GH)

Postgres service container 20–29 s per job (8 jobs per push). Prisma validate 2 s, generate 3 s, migrate deploy 2–6 s per
database, drift check 1 s, guarded reset 8 s. DB integration runs **serially** (`--maxWorkers 1` behaviour; per-file sum
175 s ≈ step 204 s). Slowest DB files: `structural-extraction` 32 s, `prowess-effect-execution-history` 23 s,
`source-structure` 19 s, `entity-matching` 14 s, `prowess-maneuver-cost-history` 13 s, `prowess-active-magic-history` 10 s.

## 10. Playwright Timing (GH)

Browser install 21 s (no cache) · tests 35 s (45 passed, 33.5 s). `playwright.config.ts`: `fullyParallel: true`,
`retries: 1` in CI, `webServer.command: "pnpm run build && next start"`, so Playwright builds the Next app a second time
after the `Build (production)` step (to confirm whether Next's cache makes it cheap).

## 11. Build Timing (GH)

Workspace package build 11–18 s (per job; done in 5 of 8 workflows) · production build 39 s (Next compile 7.4 s). Package
`dist/` output includes compiled **test files and test fixtures** (game 35 `*.test.js` + `testing/`, model 27, rules 17,
import 5) because each `tsconfig.json` includes all of `src`.

## 12. Dependency-Install Timing (GH)

`pnpm install --frozen-lockfile` 2–3 s in every workflow (pnpm store cache hit); Node setup 5–12 s; pnpm setup 1–2 s;
checkout 1–2 s. Install is not a bottleneck; repeating it eight times is a runner-cost, not wall-clock, issue.

## 13. Prisma Timing

GH: validate 2 s, generate 3 s, migrate deploy 2 + 3 s, drift 1 s ("No difference detected"). LOCAL: unavailable (engine
download 403); the local test DB is built with `psql` from the committed migrations, so the 10 migration-ledger assertions
fail locally only.

## 14. Application Hot Paths

CPU profiles (LOCAL, V8 inspector; 242-Definition WO13 fixture bundle, 352 KB):

| Operation | Time | Dominated by |
| --- | ---: | --- |
| `createProwessDefinitionBundle` (one call) | 151 ms | envelope / payload re-validation of all 242 Definitions |
| `compileAbilityDefinition` (simple Spell) | 888 ms | **85% bundle re-creation** (≈ 4.7 rebuilds per compile) |
| `evaluateSpellCost` | 1,110 ms | compile + bundle rebuilds |
| `executeAbilityResolution` | 1,184 ms | compile + evaluate + bundle rebuilds |
| WO13 ACTIVATE | 2,503 ms | 72% bundle re-creation (≈ 12 rebuilds), 24% plain-data checks; M4 evaluation 12% |
| WO13 MAINTENANCE / ROUND_END | 519 / 165 ms | WO3 plan compile, bundle rebuild |

Inside bundle creation: `legacyTermUses` (recursive legacy-terminology scan of every payload string, allocating a path
array per node) is **44–47% of all time**; `checkPlainData` / `hasUnsafeDataProperties` over the whole request (bundle
included) 23–24%; duplicate-version detection is O(n²) (`accepted.some(...)` per envelope). Whole-file profile of
`maneuver-cost-golden.test.ts`: **68% of its 32 s is `createProwessDefinitionBundle`**. Since the game suite (343 s) and
the DB Inspector fixtures (145 s) dominate the unit step and every mutated control re-runs such tests, this one hot path
drives most M5 CI time.

## 15. Duplicated Domain Logic

- **Bundle re-validation per compiler.** Every compiler entry (`compilation`, `core`, `affinity`, `construction/legality`,
  `targeting`, `effect`, `ability/compile`, `maneuver-cost`, `effect-execution`, `active-magic`) re-runs
  `createRulesetContext` + `createProwessDefinitionBundle` + `checkPlainData` on the same immutable bundle it received.
- **Authored Ability compiled twice per WO13 activation** (once inside `evaluateSpellCost`, once inside
  `executeAbilityResolution`); WO12 deliberately recompiles to avoid trusting a caller plan, so `compileAbilityExecution` +
  `executeAbilityResolution` compile twice.
- **Content revision chain.** Each WO re-authors `ABILITY_CONSTRUCTION_RULE` by spreading the previous WO's
  (`ACTIVE_MAGIC_CONTENT` ← `EFFECT_EXECUTION_CONTENT` ← `MANEUVER_COST_CONTENT` ← …); correct, but the canonical rule is
  only assembled by following the chain.
- **Plain-data guards duplicated** between `@prowess/rules/src/internal/plain-data.ts` (140 lines) and
  `@prowess/game/src/internal/plain-data.ts` (153 lines). This is **intentional and documented** (M4 internals are not public;
  M5-WO1 §73) — keep.

## 16. Duplicated Validation

- Full-request `checkPlainData` (including the 352 KB bundle) is repeated at each nested compiler boundary.
- Ruleset-provenance equality (`canonicalJsonOf(… rulesetProvenance)`) is hand-written in 8 places in `@prowess/game`.
- Each WO static gate (WO1–WO13) independently re-parses every `@prowess/game` file with the TypeScript compiler API and
  re-hashes the frozen M4 / Prisma inventory (WO1–WO4 statics ≈ 3.6–5.2 s each); cheap individually.

## 17. Duplicated Compilation

See §14–15: ≈ 4.7 bundle rebuilds per Ability compile, ≈ 12 per WO13 activation; two Ability compiles per activation; WO2
core compile per roll input in WO12 (by design). In tests: each mutation launch re-transforms TypeScript (≈ 1.4 s) and
rebuilds fixtures from scratch.

## 18. Duplicated Database Access

- **Per-row inserts in loops** inside transactions: `createRulesetManifest` (one `rulesetManifestEntry.create` per entry —
  242 inserts for the WO13 fixture manifest), change-set operations, canon-decision selections, rule-conflict candidates,
  migration-plan items, extraction candidates. Bulk paths already exist elsewhere (`createMany` in extraction / import-match).
- **Release resolution reads the release twice** (`verifyRulesetReleaseManifestHash` then `getRulesetRelease`).
- Release / manifest materialization (`materializeProwessDefinitionsFromRelease`) reads pinned EntityVersions in one bulk
  query (good) but is recomputed on every call; Releases are immutable, so an exact-identity cache keyed by
  `releaseId + manifestHash` is possible later (never "latest").
- No N+1 read pattern was found on hot read paths; reads are chunked with `in` filters.

## 19. Dead-Code Candidates (confirmed by whole-repository identifier search)

Truly unreferenced declarations (declared once, used nowhere, not routes / pages): 15 —
`apps/studio`: `presentation.ts` `isTerminalStatus`, `STATUS_ORDER`, `sectionForPath`; `workspace.tsx` `SectionHeading`;
`api-client/governance.ts` `getLatestPolicy`, `listAuthorityRecords`; `api-client/import.ts` `listSectionChildren`,
`getMatchRun`; `@prowess/db` `selectEntityAliasById`; `@prowess/model` `isImportBatchStatus`,
`isExtractionCandidateStatus`, `MANUAL_FOUNDATION_EXTRACTOR_KEY`, `STRUCTURAL_CANDIDATE_KINDS`, `isMigrationChangeType`,
`isMigrationCompatibilityClassification`. Each needs a final check against documentation / API-contract intent before
removal. A further ≈ 106 value exports are used only inside their own file (unnecessary `export`), and ≈ 49 are exported
through a package index but have no consumer (public surface; review, not dead).

## 20. Obsolete Compatibility Candidates

- `@prowess/test-fixtures`: a placeholder package exporting one version constant, with no dependents.
- Compiled tests / fixtures inside package `dist/` (§11).
- Historical temporary workflows (`WO7 temporary …`, `M0-WO3 Prisma Verification Gate`) are already deleted from the tree;
  only their run history remains.
- Legacy-terminology scanning (`legacyTermUses`) is still required (it guards against superseded vocabulary); it is
  expensive, not obsolete.

## 21. Package Dependency Issues

No cycles, no boundary violations. Observations: Studio reaches `@prowess/game` transitively through `@prowess/db`
(materialization) — acceptable, but M6 should keep game evaluation server-side; the empty `@prowess/test-fixtures` package
adds a build / lint / typecheck / test entry for nothing. No barrel export is causing measurable reach.

## 22. Frontend Cleanup Candidates

- **Two HTTP clients:** `app/compendium/_lib/api-client.ts` (M1, 313 lines, own `CompendiumApiError`) and
  `src/api-client/http.ts` (M2+, `apiGet` / `apiList` / `apiPost`). Consolidate before M6 builds more UI on either.
- 35 of 58 TSX files are client components (`"use client"`); acceptable for the current tooling UI; M6 should decide its
  server / client boundary deliberately.
- Placeholder pages `characters`, `gm`, `world`, `publishing`, `studio` (one `page.tsx` each) — M6 owns them; leave.
- Studio unit tests run all files under `jsdom` (pure static audits opt into `node` per file) — fine.

## 23. Database Optimization Candidates

Bulk `createMany` for manifest entries and similar loops (§18, MEDIUM impact on DB-heavy tests and on M6 authoring); single
release read in release resolution (LOW); exact-identity materialization cache for Releases (defer to M6 with
characterization tests). No index change is proposed — no slow query was observed.

## 24. CI Optimization Candidates

See §33. Headline: remove the ≈ 21 minutes of duplicate physical execution in `ci`, cut mutation-control process launches
by ≈ two thirds, run independent phases as parallel jobs, retire the seven dedicated workflows after folding WO7's controls
into the main pipeline, cancel superseded PR runs.

## 25. Caching Opportunities

- **Validated-bundle reuse (application):** remember bundles produced by `createProwessDefinitionBundle` (a module-level
  `WeakSet` / `WeakMap` keyed by the exact deep-frozen bundle object), so a compiler handed an already-validated, frozen
  bundle skips re-validation. Keyed by object identity of an immutable value — never by "latest" or by Ruleset id alone.
- Release materialization cache keyed by `releaseId + manifestHash` (§18, later).
- CI: Playwright browsers (`~/.cache/ms-playwright`), Next build cache (`.next/cache`), built workspace packages as an
  artifact shared between jobs; pnpm store is already cached.

## 26. Parallelization Opportunities

- `ci` is one 57-step serial job: lint / architecture / typecheck / static gates, package unit suites, DB + API integration,
  mutation controls and build + Playwright are independent and can be separate jobs.
- `pnpm -r test:unit` runs packages one after another (game 343 s then db-unit 145 s, …).
- Mutation controls can be sharded across jobs, each with its own checkout (isolation by separate working trees).
- DB integration runs serially; parallelism needs per-worker schemas or databases — MEDIUM risk, later.

## 27. Flaky-Test Findings

- GH: no flake recorded on `main` in the recent history (CI #188–#215 failures were genuine development failures on WO7 /
  WO8 branches; one manual re-run). Playwright runs with `retries: 1` in CI, which could hide a flake; the CI summary
  showed none.
- LOCAL: two M1 Playwright specs failed intermittently (`compendium.spec.ts:136` pagination assertion
  `not.toEqual` on a shared database; `version-history.spec.ts:326` narrow-width stacking measurement off by ≈ 30 px). Both
  passed on re-runs against a freshly reset database. Likely causes: test data shared across specs under `fullyParallel`
  (application / test-isolation) and viewport-dependent layout (environment). Not yet stabilized — CLOSEOUT-03 item.

## 28. Correctness Risks

- Any bundle-reuse cache must recognise only bundles the factory itself produced and froze; a structurally equal but
  caller-built object must still be validated (otherwise unvalidated data could skip the injection / mixing checks).
- Removing the dedicated WO7 workflow without moving its 22 controls would silently drop protection.
- Dropping the post-restore control re-run is safe only while the byte-identical restoration check remains.
- Path-filtered PR checks must never become the merge gate.

## 29. Security Risks

None found that weaken current guarantees: plain-data guards (accessors, functions, cycles, prototype keys,
non-finite numbers) run at every public entry. The optimizations above must keep validation at public boundaries — only
re-validation of an already-validated frozen value may be skipped.

## 30. Ruleset / Versioning Risks

Exact pinning is enforced at every layer (RulesetContext, bundle provenance, EntityVersion identity, WO12 / WO13 state).
Risks introduced by caching are covered in §28. `getLatestPolicy` in the Studio API client (unused) names a "latest
CanonPolicy" lookup — a legitimate M2 governance concept, not a rules path, but worth removing with the other unused client
functions to avoid confusion.

## 31. Unresolved Canon Conflicts

Unchanged by this audit: M5-SC-042, M5-SC-044, M5-SC-046, M5-SC-047, M5-SC-048, M5-SC-049, M5-SC-050, M5-SC-051,
M5-SC-052, M5-SC-053 (UNRESOLVED); M5-SC-054 RESOLVED_BY_DESIGNER by the M5-WO13 ruling. No new rule or architecture
conflict was discovered.

## 32. Proposed Refactor Candidates (CLOSEOUT-02)

| ID | Change | Impact | Risk | Category |
| --- | --- | --- | --- | --- |
| R1 | Reuse validated bundles: factory-produced frozen bundles are recorded (WeakSet); compilers skip re-validation of exactly those objects; all other input validated as today | HIGH | MEDIUM | CODE |
| R2 | Make bundle validation itself cheaper without changing outcomes: O(n) duplicate detection (Set of version ids); `legacyTermUses` without per-node path allocation (build the path only on a hit) | MEDIUM | LOW | CODE |
| R3 | Avoid repeating the full-request `checkPlainData` at nested compiler boundaries when the input was already checked by the outer entry (internal entry points) | MEDIUM | MEDIUM | CODE |
| R4 | WO13 activation: compile the authored Ability once and feed WO10 and WO12 readers from the same compiled plan (internal API; public contracts unchanged) | MEDIUM | MEDIUM | CODE |
| R5 | Remove the 15 unreferenced declarations; drop unnecessary `export`s of file-local helpers | LOW | LOW | CODE |
| R6 | Remove (or explicitly keep with a purpose) the placeholder `@prowess/test-fixtures` package | LOW | LOW | ARCHITECTURE |
| R7 | Exclude `*.test.ts` and `src/testing/` from package `dist/` builds (separate build tsconfig) | LOW | LOW | BUILD |
| R8 | Consolidate the two Studio HTTP clients behind `src/api-client/http.ts` | MEDIUM | LOW | FRONTEND |
| R9 | `createMany` for manifest entries, change-set operations, canon-decision selections, rule-conflict candidates, migration-plan items (preserving order and returned identities) | MEDIUM | MEDIUM | DATABASE |
| R10 | Single release read in `resolveRulesetContextFromRelease` | LOW | LOW | DATABASE |
| R11 | Shared helper for Ruleset-provenance equality in `@prowess/game` (8 hand-written copies) | LOW | LOW | CODE |
| Keep | M4 / M5 plain-data duplication (intentional; M4 frozen) | — | — | DOCUMENTATION |
| Defer | Release materialization cache keyed by `releaseId + manifestHash` (M6, with characterization tests) | MEDIUM | MEDIUM | DATABASE |
| Defer | Any M4 engine change (none needed; M4 evaluation is ≈ 12% of the profiled paths) | LOW | HIGH | ARCHITECTURE |

## 33. Proposed CI Changes (CLOSEOUT-03)

| ID | Change | Impact | Risk | Category |
| --- | --- | --- | --- | --- |
| C1 | Stop re-running suites already executed by the base steps: WO gates keep their static assertion that each required golden / contract / Inspector / history / API file exists and is included in the base run, and run only what is unique to them (static gate, controls) | HIGH (≈ 21 min) | LOW | CI |
| C2 | New mutation-control harness: run all guards green once (or rely on the preceding green suite), then only the mutated run per control; keep the byte-for-byte restoration check; drop the redundant post-restore run; group controls by guard file | HIGH (≈ 60–65% of 40 min) | LOW–MEDIUM | TEST |
| C3 | Shard controls across parallel jobs, each with its own checkout | HIGH | MEDIUM | CI |
| C4 | Split `ci` into parallel jobs: static (lint, architecture, typecheck, all static gates) · package unit (matrix) · DB + API integration (Postgres) · controls shards · build + Playwright; share built packages via an artifact | HIGH | MEDIUM | CI |
| C5 | Retire `m5-wo7.yml` … `m5-wo13.yml` after moving the WO7 controls into the main pipeline (assertions unchanged; ≈ 2,540 runner-s per push saved) | HIGH (runner cost) | LOW | CI |
| C6 | `concurrency: { group: pr-${{ github.ref }}, cancel-in-progress: true }` on `pull_request` only; never on `main` | MEDIUM | LOW | CI |
| C7 | Run package unit suites in parallel (`--workspace-concurrency`) or as matrix jobs | MEDIUM | LOW | CI |
| C8 | Playwright: cache browsers; reuse the production build instead of building again in `webServer`; investigate the two local flakes and document root causes | LOW | LOW | TEST |
| C9 | Three tiers: Tier 1 (static + affected unit), Tier 2 (full merge gate, all assertions), Tier 3 (clean certification without caches) | HIGH | MEDIUM | CI |

## 34. Expected Risk per Change

LOW: R2, R5, R6, R7, R8, R10, R11, C1, C5, C6, C7, C8. MEDIUM: R1 (validation bypass must be identity-exact), R3 (must
keep every public entry guarded), R4 (internal API change), R9 (ordering / returned ids), C2 (control semantics), C3 / C4
(job isolation, artifact correctness), C9 (tier membership must never drop assertions from Tier 2). HIGH: none proposed.

## 35. Expected Impact per Change (ESTIMATE unless stated)

- C1: removes ≈ 1,260 s of measured duplicate execution from `ci`.
- C2: removes ≈ 2 of every 3 Vitest launches (≈ 550 launches); on the measured 2,405 s of controls ≈ −1,500 s.
- R1 + R2: bundle creation is 68–72% of the profiled M5 paths (measured); expected 2–3× faster game / Inspector suites and
  mutated runs.
- C3 + C4 + C7: wall-clock becomes the longest job instead of the sum.
- Combined ESTIMATE: merge-readiness wall-clock from ≈ 75 min to ≈ 12–20 min, runner time per push from ≈ 122 to ≈ 40–60
  runner-minutes, with no assertion removed. To be measured after each change (before / after / %).

## 36. Recommended Implementation Order

1. CLOSEOUT-02 (code, one PR, behavior-preserving, each step behind characterization tests): R2 → R1 → R3 → R11 → R5 / R6 /
   R7 → R10 → R8 → R9 → R4 (R4 and R9 last; drop either if review prefers).
2. CLOSEOUT-03 (CI, separate PR): C1 + C5 (with WO7 controls moved) → C2 → C6 → C7 → C4 → C3 → C8 → C9.
3. CLOSEOUT-04: clean certification and pre / post comparison.

## Appendix A — Proposed exact CLOSEOUT-02 scope

Branch `m5-closeout-refactor`. In scope: R1, R2, R3, R4, R5, R6, R7, R8, R9, R10, R11, each with before / after timing and
the full suite green before and after. Characterization tests first for: bundle refusal paths (injection, mixing,
duplicates, legacy terms, unsafe data — existing tests extended where an exact case is missing), bundle reuse only for
factory-produced frozen bundles, WO13 activation outputs (byte-identical traces before / after R4), manifest / change-set
ordering and identities before / after R9. Out of scope: any formula, outcome, cost, Targeting, Effect, Sustain,
Concentration, validation-outcome or eligibility change; M4; schema / migrations; CI.

## Appendix B — Proposed exact CLOSEOUT-03 scope

Branch `m5-closeout-ci`. In scope: C1–C9 plus the CI report `docs/reports/m0-m5-ci-optimization-report.md`. Every
assertion and every control remains executed in the Tier 2 merge gate; a static "assertion inventory" test proves each
historical gate's files and controls are still run. Out of scope: deleting tests or controls, weakening architecture gates,
path filters on the merge gate, mutable-database caching.

## Appendix C — Measurement sources

GH: Actions API `actions/runs?head_sha=…` and job step timings for `0847ca7…` (merged main) and `fc08186…` (PR #54); step
logs of CI #215 for per-file and per-control timing; run history (336 runs). LOCAL: Vitest launch timing, V8 CPU profiles of
`compileAbilityDefinition`, WO13 ACTIVATE and `maneuver-cost-golden.test.ts`, repository identifier index for dead code,
`git ls-files` line counts. Limitations: no local Prisma engines; local runner is 2 vCPU (GitHub's is larger), so local
absolute times are not comparable to GH; Playwright double-build in CI not yet confirmed from logs.
