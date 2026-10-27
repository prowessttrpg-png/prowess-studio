# M5-CLOSEOUT-02: Behavior-Preserving Code Consolidation & Refactor (Report)

| | |
|---|---|
| Branch | `m5-closeout-refactor` |
| Base | `0847ca7a3d2b4cfb70d12a9186ed40a162a0d9a` (main, WO13 merged) |
| Scope | R1–R11 from the CLOSEOUT-01 audit, run in the audited order: R2 → R1 → R3 → R11 → R5–R7 → R10 → R8 → R9 → R4 |
| Status | Implemented and verified locally. **Not pushed, no PR, not merged.** CLOSEOUT-03 has not been started. |

Every timing in this report is **LOCAL**: one cloud VM with 2 vCPU, Node 22 and PostgreSQL 16. Each figure gives its
workload and iteration count. No GitHub CI figure is claimed, and none should be inferred from these local absolute times.

## 1. Outcome per item

| Item | Result | Summary |
|---|---|---|
| R2 | **DONE** | Legacy-term lookup now uses an immutable token index instead of a linear inventory scan. Duplicate detection is a Set keyed on the exact five identity fields instead of an O(n²) scan. Outcomes are identical. |
| R1 | **NOT ADOPTED (architectural conflict)** | Reusing an identity-proven bundle needs a module-level registry (`WeakSet` / `WeakMap`). The M5-WO1 audit forbids mutable module state in `@prowess/game` (`mutable-module-state`), and nothing stateless can prove an object came from the factory. Implemented, measured, rejected by the WO1 gate, and backed out. |
| R3 | **DONE (stateless form)** | Plain-data scans that an enclosing boundary had already run, earlier in the same call, are no longer repeated. Every public entry keeps its own boundary. |
| R11 | **RETAINED (gate-pinned)** | The 8 provenance comparisons are literal anchors in the WO8, WO10 and WO11 static gates and in the WO10, WO11 and WO13 mutation controls. |
| R5 | **DONE** | Removed 15 unreferenced declarations and internalized 65 file-local exports. |
| R6 | **RETAINED (gate/CI-pinned)** | Removing `@prowess/test-fixtures` would require editing CI workflow filters and the M1, M4-WO1 and M5-WO1 static gates. |
| R7 | **DONE** | `model`, `import` and `game` now build through `tsconfig.build.json`, which excludes tests (and, for `game`, `src/testing`). Every non-test emitted file is byte-identical. |
| R10 | **RETAINED (M4 gate-pinned)** | The M4-WO2 static audit pins Release mode to `verifyRulesetReleaseManifestHash` followed by `getRulesetRelease`, imported from the release index. |
| R8 | **DONE** | Both Studio HTTP clients now share one `fetch` transport. Each client keeps its own error semantics. |
| R9 | **PARTIAL** | Manifest entries are written with one multi-row insert. Change-set, canon-decision and migration-plan writes stay row-at-a-time because the M2 gates pin them. Rule-conflict candidates also stay row-at-a-time because there is nothing material to gain. |
| R4 | **NOT ADOPTED (architectural conflict)** | Compiling once needs either a new internal entry point in `active-magic.ts` or a cache. The WO13 static gate (M5-I336) pins `active-magic.ts` to the public `evaluateSpellCost(` / `executeAbilityResolution(` (one call each) and forbids `compileAbilityDefinition` there. A cache would be module state, and passing a precompiled plan through the public functions would be a caller-supplied bypass. |

### R2: cheaper bundle validation (`9c8e351`)

`vocabulary/terminology.ts`
- `LEGACY_BY_TOKEN` is a frozen, null-prototype record built once from the frozen inventory.
- It maps each token to the **first** LEGACY entry in inventory order, which is exactly the entry the former `find`
  returned. The null-`canonicalTerm` semantics are unchanged.
- It is not module state: it is computed during module evaluation and frozen.

`bundle/bundle.ts`
- Duplicate detection uses a `Set` keyed on `JSON.stringify([entityId, entityVersionId, canonicalKey, definitionKind,
  systemFamily])`, the same five fields that `isSameExactDefinition` compares.
- Check order, codes, paths and messages are unchanged.

### R1: why it was not adopted

Version 1 sealed the factory's deep-frozen output in a module-private `WeakSet`. It reused the validated outcome only for
the exact instance under the same canonical Ruleset input. Measured result: WO13 activate went from 818 to 405 ms.

The M5-WO1 audit (`apps/studio/tests/unit/m5-wo1-audit-helpers.ts`) flags any module-level `new Map/Set/WeakMap/WeakSet`
or `let` in `@prowess/game` as `mutable-module-state`. The 3 WO1 game-rules checks and 3 WO1 permanent negative
controls failed.

The directive forbids trust inferred from shape or flags. Without a registry, no stateless mechanism can prove factory
provenance:
- a symbol brand is not plain data and fails every boundary;
- a class instance is not plain data either;
- hiding the state in a closure would evade the rule's letter while defeating its intent.

So the optimization stopped there, as the directive requires. The attempt is kept on local branch
`closeout02-attempt-r1r3` for review; it is not proposed.

### R3: stateless form (`1faa23b`)

`createProwessDefinitionBundle` (public) still runs `checkPlainData` over its whole input. After that passes, envelopes
are read with `readEnvelope(…, containerChecked = true)`, so each one is not inspected again. Only the factory passes
`true`; the public envelope reader and the stored-definition reader still inspect.

`createBundleWithinCheckedRequest(ruleset, definitions, rulesetFromRequest)` is internal: it is not in the package's
explicit `index.ts` surface.

| | |
|---|---|
| Used by | The Construction, Targeting, Effect, Affinity, core/runtime (`readCoreBundle`) and compilation compilers. Each one returned on any `checkPlainData` problem over its complete request earlier in the same call, and reads `definitions` with `own`. |
| Also used by | `effect-execution`, `active-magic` and `maneuver-cost`. These pass M4's normalized context, which is inspected inside the function. If that context is not clean, the public factory runs, so the problems reported are exactly the ones it always reported. For the two property-access call sites, the internal path is taken only when `definitions` is an own property; otherwise the original expression runs. |
| Still validated in full | Ruleset context, envelopes, payloads, legacy terms, pins, provenance and duplicates. |
| Not changed | `ability/compile.ts` keeps the public factory call that the WO8/WO9 static gates and the WO9 "bypass Ruleset isolation" mutation control anchor on. |

### R5: dead code and exports (`6c8f59a`, `e1a3853`)

**Removed: 15 declarations.** In every case the definition was the only occurrence in the repository (source, tests,
scripts, fixtures, docs).

| Package | Removed |
|---|---|
| Studio | `isTerminalStatus`, `STATUS_ORDER`, `sectionForPath`, `SectionHeading`, `getLatestPolicy`, `listAuthorityRecords`, `listSectionChildren`, `getMatchRun` |
| db | `selectEntityAliasById` |
| model | `isImportBatchStatus`, `isExtractionCandidateStatus`, `MANUAL_FOUNDATION_EXTRACTOR_KEY`, `STRUCTURAL_CANDIDATE_KINDS`, `isMigrationChangeType`, `isMigrationCompatibilityClassification` |

The API routes that the removed Studio wrappers called are unchanged and still tested.

**Internalized: `export` dropped from 65 value declarations.** Each is used only inside its own file. None is referenced
anywhere else, and none has a static-gate or mutation-control anchor on its line.

| Package | Files |
|---|---|
| db | 18 |
| game | 9 (internal modules; none is in the package surface) |
| import | 1 |
| Studio | 3 |

### R7: dist contents (`fa1827b`)

| Package | Files before → after | Size before → after |
|---|---|---|
| `@prowess/model` | 231 → 150 | 1,240 → 844 KB |
| `@prowess/import` | 51 → 36 | 320 → 212 KB |
| `@prowess/game` | 366 → 208 | 3,324 → 1,976 KB |

These are fresh builds with each config. Every non-test file is byte-identical.

Four `content/core-playtest-v0.1/*.json` files are no longer emitted, because only tests import them. Every consumer
(static gates, mutation controls and DB tests) reads them from `src`. The packages expose only `"."`, so
`dist/testing` was never importable by name. `@prowess/rules` (M4) is untouched and still ships its tests.

### R8: Studio HTTP (`8737a21`)

`src/api-client/http.ts` gains `fetchJsonBody(path, init?)`. It reports network failure and an unreadable body as
values, and calls `fetch(path)` when no `init` is given.

| | Governance `request` | Compendium `apiGet` / `listEntities` |
|---|---|---|
| Transport | `fetchJsonBody` | `fetchJsonBody` |
| Query builder | shared `query` | shared `query` (identical for its parameter types) |
| `fetch` call | sends `method` / `headers` / `body` | `fetch(path)` with no `init` |
| Unreadable body | `INVALID_RESPONSE` | `NETWORK_ERROR`; `listEntities` still lets the parse error propagate |
| Error body | normalized | passed through unchanged |
| Envelope shape | checked | not checked |

### R9: manifest entries (`dbc0a38`)

`insertManifestSnapshotInTransaction` (manifest creation and M2-WO8 publication) now writes entries with one
`createMany`, in the supplied order, inside the same transaction.

| Property | Preserved? |
|---|---|
| Row count | Yes |
| Associations | Yes |
| Read order | Yes (reads order by Entity key / Entity id) |
| Atomicity | Yes |
| Duplicate violation | Yes: the named unique violation, mapped to `DUPLICATE_ENTITY` |
| Composite-FK rejection | Yes: `P2003`, nothing persisted |
| Row identities | Never returned or used |
| `created_at` | Still stamped during the allocating transaction and never decreasing in input order. It may now be equal across entries where it used to differ by microseconds. No read orders by it. |

## 2. Characterization added (all written and passing before the code they protect)

| Commit | File | Pins |
|---|---|---|
| `2bbe57b` | `packages/prowess-game/src/closeout-characterization.test.ts` + `src/testing/closeout-characterization.json` | 30 SHA-256 hashes of canonical JSON, generated on `0847ca7`, covering: bundle acceptance, ordering and refusals (valid, reversed, duplicates, legacy term, injected version, other Ruleset, non-array); Ability compile/evaluate, Spell cost, Maneuver cost plan and result, and execution plan and resolution; nested-boundary refusals (unsafe getter, mixed Ruleset, foreign bundle, `__proto__`, legacy-term bundle); WO13 traces (activate, maintenance, concentration, instant, Mana Lock, Channel start/invest, canonical fail-closed refusals). Also: legacy-term lookup equals the baseline linear scan for every inventory term × 7 spelling variants plus non-terms, and a pure SHA-256 verified against FIPS vectors. |
| `f1ef8cc` (+R3) | `packages/prowess-game/src/closeout-trust-boundary.test.ts` | Exact bundle vs. JSON reconstruction; another Ruleset; tampered and legacy reconstructions; caller trust markers; getter or cycle around an exact bundle at every boundary, including a nested compiler called directly; frozen look-alikes; internal continuation vs. public factory, including the exact fallback problems. |
| `646d4ac` | `apps/studio/tests/unit/closeout-http-client-characterization.test.ts` | Both clients' exact `fetch` call shapes, success values, network and unreadable-body errors, error-body handling, and query strings. |
| `27e1602` | `packages/prowess-db/tests/integration/closeout-manifest-bulk.test.ts` | 242-entry manifest (shape, order, ids, associations, `created_at`, Manifest-mode resolution); DB duplicate → named violation and `DUPLICATE_ENTITY`; composite-FK `P2003`; atomicity; local timing. |

No existing test or fixture was modified. Only new test files were added.

## 3. Equivalence evidence

- The baseline-pinned characterization hashes are unchanged at every commit.
- The legacy-term reference-equality test passes.
- The trust-boundary suite was written before R3 and passes after it.
- All existing goldens pass unchanged: WO1–WO13 goldens and contracts (game 914 baseline tests), WO13's 35 golden plus 22
  contract tests, the API trace fixtures (`m5-wo9`–`m5-wo13` JSON) and the DB history tests.
- All 14 negative and mutation control suites still catch every control (m4-final, plus WO1 17, WO2 18, WO3 21, WO4 34,
  WO5 29, WO6 16, WO7 22, WO8 8, WO9 12, WO10 18, WO11 26, WO12 26, WO13 30). The tracked-tree hash before and after
  the controls is identical.

## 4. Timings (LOCAL; 2 vCPU VM; Node 22; PostgreSQL 16)

Hot paths are medians from a vitest harness on the WO13 fixture (242 Definitions):
- bundle: 7 iterations;
- every other workload: 5 iterations, after one warm-up.

All rows were re-measured back to back by checking out each commit.

| Workload (median, ms) | `0847ca7` + characterization | after R2 (`9c8e351`) | after R3 (`1faa23b`) | final (`dbc0a38`) |
|---|---|---|---|---|
| bundle from a fresh JSON copy | 109 | 41 | 32 | 30 |
| bundle from the same object | 105 | 37 | 26 | 26 |
| `compileAbilityDefinition` (WO13 sustained Spell) | 619 | 294 | 198 | 184 |
| `evaluateSpellCost` | 732 | 384 | 317 | 292 |
| `executeAbilityResolution` | 818 | 400 | 299 | 281 |
| WO13 `ACTIVATE` transition | 1,689 | 862 | 626 | 605 |

| Workload | Before | After |
|---|---|---|
| `@prowess/game` full suite (`vitest run --maxWorkers=2`, 1 run each) | 246.7 s (914 tests) | 129.3 s after R2 (914); 100.8 s final (921) |
| `createRulesetManifest` with 242 entries (median of 5, 3 runs) | 321 / 321 / 338 ms | 227 / 228 / 240 ms |
| Studio HTTP (R8) | — | No material timing change; it is a code-consolidation item |

The full local verification (§5) took 30 minutes end to end, including all 14 control suites. The runs differ, so no
earlier local figure is directly comparable.

## 5. Verification (final commit, fresh database)

| Check | Result |
|---|---|
| Build (pre and post), lint, architecture, typecheck (all packages) | pass |
| Unit — `@prowess/model` | 513 / 513 |
| Unit — `@prowess/ui` | 21 / 21 |
| Unit — `@prowess/import` | 128 / 128 |
| Unit — `@prowess/rules` (M4) | 659 / 659 |
| Unit — `@prowess/game` | 921 / 921 (914 baseline + 7 trust-boundary) |
| Unit — `@prowess/db` | 96 / 96 |
| Unit — Studio | 2,849 / 2,849 (2,843 baseline + 6 R8 characterization) |
| DB integration | 517 / 527. The 10 failures are the known environment-blocked Prisma migration-ledger tests (identical set at baseline). |
| API integration | 165 / 165 |
| M4 regression (m4-final controls, M4 statics, rules unit) | pass; the M4 golden JSON is locale/timezone-identical |
| M5-WO1–WO13 regression (goldens, contracts, statics, DB/API traces) | pass |
| Static audits (M1–M5 statics within Studio unit) | pass |
| Negative / mutation controls (14 suites) | all caught and restored; tracked-tree hash identical |
| Playwright | 45 / 45 |

**Prisma and environment limits:**
- The Prisma engines cannot be downloaded here (HTTP 403).
- The test database is built from the committed `migration.sql` files with `psql`.
- The 10 migration-ledger assertions (`_prisma_migrations`) therefore fail locally only. They are reported, not simulated.

## 6. Retained candidates and reasons

| Item | Reason |
|---|---|
| R1 | Requires module state forbidden by the M5-WO1 audit. |
| R4 | Pinned by the WO13 M5-I336 static gate; would otherwise need module state or a caller-supplied bypass. |
| R6 | Removal touches CI workflow filters and the M1, M4-WO1 and M5-WO1 static gates. |
| R10 | Call graph pinned by the M4-WO2 static audit (M4 is frozen). |
| R11 | Literal anchors in the WO8/WO10/WO11 statics and the WO10/WO11/WO13 controls. |
| R9 remainder | M2 write-inventory gates (change-set, canon-decision, migration-plan); no material gain (rule-conflict candidates). |
| `@prowess/model` file-local exports | Its `export *` surface is its public contract, including the documented limits and guards. |
| M4 helper duplication | M4 is frozen; the directive keeps the helpers separate. |
| Type-only exports, and `RUNTIME_VARIABLE_SOURCE_KINDS` | The latter is used only as a type, so lint requires the export. |

## 7. Architectural conflicts surfaced

Three audit recommendations collide with existing permanent gates:
- **R1/R4 vs. the M5-WO1 `mutable-module-state` rule and the WO13 M5-I336 call-shape gate.** Identity-based reuse and
  compile-once are not expressible without module state or new entry points in the WO13 module.
- **R10 vs. the M4-WO2 call-graph audit.**
- **R9 and R11 vs. the M2 write-inventory gates and the M5 literal anchors.**

If those optimizations are wanted, each needs an explicit decision to amend the corresponding gate (for example, a
sanctioned immutable-identity registry, or a WO13 gate that allows a sanctioned internal compile-once entry point).
None was amended here.

## 8. Unchanged by construction

- Mechanics, formulas, outcomes and costs: unchanged.
- M4 (`packages/prowess-rules`): 0 files changed.
- Prisma schema and migrations: 0 files changed.
- CI workflows (`.github/`): 0 files changed.
- Negative-control scripts: 0 files changed.
- Content: 0 files changed.
- Existing tests: 0 modified.
- M5-SC-042 and M5-SC-044–053 stay open and untouched; M5-SC-054 stays resolved.
