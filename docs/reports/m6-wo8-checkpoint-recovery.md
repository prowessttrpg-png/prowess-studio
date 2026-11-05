# M6-WO8 checkpoint and recovery assessment

Date: November 4, 2026 (America/Los_Angeles). Status: **PAUSED, INCOMPLETE, NOT READY FOR PUBLICATION**.

This document records an inspection and preservation checkpoint requested by the user. No implementation, test execution, push, PR, or merge was performed during this checkpoint. The only repository addition during the checkpoint is this report; existing implementation and failing/unverified work are preserved together.

## Repository state found

- Repository: `prowessttrpg-png/prowess-studio`.
- Branch: `m6-wo8`.
- HEAD on arrival: `d005fc30c8c7e175896898c1973e6d3bda144869`.
- Verified WO8 baseline: `d005fc30c8c7e175896898c1973e6d3bda144869` (WO7 merge / PR #69).
- WO8 commits on arrival: **0** (`git rev-list baseline..HEAD`).
- Uncommitted files on arrival: **60** = **31 modified tracked files + 29 untracked new files**.
- The tracked-only diff on arrival was 895 insertions and 162 deletions across 31 files; this excluded all new files and was not a total implementation diff.
- No staged work on arrival. The working tree survived the prior execution-environment outage.
- The checkpoint commit preserves all 60 existing files plus this report, including incomplete tests and gate changes. Its exact commit SHA, complete diff totals, and bundle checksum are recorded in the accompanying recovery manifest and checkpoint response.

## What exists in code

| Area | Actual implementation | Verification status |
| --- | --- | --- |
| Strict Character Maneuver draft | Ordered stable Action use keys, exact component references, explicit attachments/scopes, rejection of client prices and Spell-only fields | Focused domain coverage passed on an earlier worktree snapshot |
| Shared M5/M4 adapter | Reuses authored-Ability, cost, execution-contract compiler and M4 evaluation; Character-owned subject without synthetic canonical Definition | Implemented; final-tree equivalence still pending |
| Exact WO6 binding | Current Attack Library identity and selected damage profile passed through the existing bridge, retaining Weapon/Attack provenance | Focused identity tests passed; database/API binding unverified |
| Construction | Martial Action-block capacity, full constituent Powerful Blow costs, per-Action targeting and scoped Traits, global component capacity and minimum Effect | Focused tests passed; final full regression pending |
| Amendment A | Optional versioned protected Action AP floor, capped Condition stage, subsequent Signature reduction, AP/MP minimums | Four required examples and focused cases passed |
| Performance | Exact structured Condition contract, actual Skill rank, once-per-Maneuver MP discount, separate preparation AP, ordinary-slot exemption, missing-content catalog status | Focused rank/preparation/duplicate/override tests passed; no production Release updated |
| Persistence | Separate Maneuver revision model/migration/current FK; shared header, Character-row lock, CAS and active count; loadout-version guard | Builds completed; fresh migration application succeeded; lifecycle and races not proven |
| Service/API | Create, detail, catalog, draft save, validate, finalize, rebuild, retire; error mapping; server shared-roster response | Eight route files and three API tests exist; API runtime tests not completed |
| Tests | 24 focused domain cases; nine DB lifecycle cases; one historical migration-compatibility case; three API cases; static checks | Test source exists; existence is not a passing result |
| Documentation/governance | Architecture document, governed content candidate, baseline/hash registry, invariant entries I099–I128, schema/API registries, preliminary static gate | Partial; latest static run is red; controls/CI not integrated |

The candidate content helper is authoring preparation, not published canon. The named nine builder steps exist as domain vocabulary only; that does **not** mean a nine-step UI exists.

## What is planned or absent

- No Maneuver builder React components or new/detail/edit pages.
- No Maneuver client DTOs/calls or completed shared Abilities UI integration.
- No compact Maneuver rows in the Character Sheet.
- No WO8 UI/component tests or six required Playwright scenarios.
- No WO8 negative-control script.
- No WO8 entry in the permanent CI gate inventory/workflow.
- No completed `m6-wo8-implementation-report.md`.
- No final-tree full unit/regression, lifecycle/race/API/E2E verification, historical controls, new controls, production build, or Prisma drift result.

## Evidence inspected, with limits

No tests were rerun during this checkpoint. These are saved log results from the implementation session, not a claim that this checkpoint commit is green. Counts overlap and must not be added together.

| Saved evidence | Observed result | Interpretation |
| --- | --- | --- |
| `domain-wo8.log` | **24 passed, 3 files** | Latest completed focused WO8/Amendment run; subsequent catalog/guard and documentation edits were made |
| `phase-a-verified.log` | **356 passed, 4 files** | Earlier phase-A checkpoint, including historical characterization; predates later changes |
| `identity-goldens.log` | **322 passed, 2 files** | Earlier identity plus 313-case historical characterization; predates later changes |
| `m5-baseline.log` | **337 passed, 2 files** | Earlier historical regression check; not final-tree verification |
| `final-goldens.log` | Only a RUN header | Interrupted/uncompleted, **not a pass** |
| `all-game.log` | Only a RUN header | Does not substantiate any full-suite test total |
| `phase-b-build.log` | model/rules/import/game/db build steps all Done | Successful package-build evidence before latest edits; not Studio production build |
| `db-typecheck.log`, `studio-typecheck.log`, `typecheck.log` | No-error compiler output | Earlier compiler invocations; no final-tree certification |
| `phase-b-migrations.log`, `fresh-dev-migrations.log`, `fresh-test-migrations.log` | All migrations successfully applied | Actual PostgreSQL 14.5 emulation; fresh application only, not lifecycle/upgrade/drift proof |
| `wo8-db-direct.log` | **P2028 fixture startup failure, 9 skipped** | No lifecycle tests passed in that attempt |
| `phase-b-runtime.log` | 400+ exact Definitions seeded; Release ready; no test completion summary | Interrupted after fixture setup; **zero verified completed WO8 lifecycle/race cases** |
| `static-pre-ui.log` | **3 failed, 41 passed, 44 total** | Latest completed combined WO7/WO8 static run; checkpoint preserves failures |
| `lint.log` | One unused-import error | The import was later removed, but no subsequent clean lint run is evidenced |

An earlier conversational claim of a 1700-test full game pass is **not substantiated by the surviving `all-game.log`** and is excluded from verified totals here. Prisma validation/generation had been reported successful during the session, but this checkpoint does not rerun them or convert fresh-migration success into schema drift proof.

### Three known static failures

1. WO7 historical schema restoration hash: read-only comparison shows one extra trailing blank line after stripping the marked WO7/WO8 additions. The original migration is unchanged. This needs a narrow schema-marker/whitespace correction, not a broad frozen-gate exemption.
2. WO8 exact-reference assertion searches for the literal `findBundleDefinition(bundle, ref)` although the adapter uses a different local variable. The assertion is mismatched; inspect the actual exact-reference behavior before adjusting it.
3. WO8 capacity assertion searches for `construction.outputs.access.martialRankValue`, which is not the actual compiler spelling. Adjust to an evidence-based guard without weakening capacity tests.

No failure was fixed during this checkpoint. The staged whitespace check also reports an existing new blank line at EOF in `packages/prowess-db/src/character/signature-context.ts:41`; that work is preserved unchanged.

## Remaining phases

| Phase | Checkpoint status | Remaining work |
| --- | --- | --- |
| A — domain and equivalence | Substantial implementation exists; earlier focused/equivalence runs passed | Resolve static assertion mismatches narrowly; rerun targeted domain + historical characterization on the actual continuation tree |
| B — persistence and API | Code and migration exist; runtime checkpoint not passed | Verify historical upgrade, draft/finalize/rebuild/retire, shared Spell/Maneuver last-slot race, stale/loadout guards, exact Release behavior and API routes; preserve WO7 behavior |
| C — Studio UI | **Not started** | Nine-step editor, exact Action catalog/sequence and scopes, Review/Inspector/Finalize, detail/history, shared Abilities and Sheet integration; component and six E2E scenarios |
| D — final verification/report | Partial documentation only | Finish meaningful invariants/gates/control script and CI inventory, run required checks/controls once on final tree, prove drift No differences, complete implementation report |

Phase B must establish lifecycle and race behavior before Phase C begins. No completion percentage is claimed because runtime verification and the entire UI remain.

## Why execution took too long

The logs and session record support the following causes, but do not support an exact minute-by-minute allocation of the seven-plus hours:

1. **Environment/database investigation expanded excessively.** Native PostgreSQL could not be launched under the available root/user-namespace restrictions. Package installation/extraction, multiple connection probes, and several emulated-VM runners were tried. The fallback is actual PostgreSQL 14.5 in a VM, while CI uses PostgreSQL 16; it is slow and does not remove the need for representative verification.
2. **Repeated fresh setup discarded useful test state.** Multiple runners reconstructed migrations and reseeded the broad test world. The WO8 fixture includes over 400 exact Definitions from existing complete catalogs, adding substantial setup work before any lifecycle assertion.
3. **Logging obscured early failures.** An earlier piped-log runner did not reliably preserve stderr/completion, so an actual P2028 transaction-start failure was treated as a possible hang and prompted additional probes and waits. Direct file descriptors later exposed the error. A bounded explicit test-DB-only Prisma timeout option was added; it is infrastructure support and remains unverified on the final tree.
4. **Retry/status activity exceeded useful bounds.** Repeated polling, probes, runner changes and historical-suite reruns did not produce the missing Phase-B acceptance result. No more emulator experimentation is recommended as the default continuation.
5. **Checkpoint discipline was insufficient.** No WO8 commit was made during the implementation session. That left 60 files uncommitted through an outage. Documentation/registry and preliminary static work also advanced while the mandatory lifecycle checkpoint remained unresolved, creating incomplete secondary work.
6. **The execution environment disconnected.** Test sessions were lost. It is accessible for this checkpoint, but its earlier long-running sessions are no longer recognized. A process-list query also failed, so this report does not claim an exhaustive live-process inventory.

The excessive time was not evidence of completed verification. I should have created a recoverable checkpoint and reported the database blocker earlier.

## Shortest safe continuation path

1. Resume **this checkpoint**, not a new WO8 implementation. Use the local commit or verified full-branch bundle; keep the baseline unchanged and review the exact diff.
2. Establish one working native PostgreSQL 16 local/test environment with the existing test-database guard. Reuse it for migration, DB and API checks. If that is unavailable, keep Phase B explicitly blocked instead of extending VM/probe retries.
3. In a later authorized implementation turn, correct the three known static failures narrowly and rerun only the focused domain tests plus historical characterization and the focused WO8 DB/migration/API tests, with the relevant WO7 regression. Diagnose the first concrete failure before another full reseed.
4. Only after Phase B passes, build the missing UI by reusing WO7 presentation/transport patterns. Retain existing compiler, exact references, schema, service and tests unless a concrete failure requires a change.
5. Add missing WO8 controls and CI integration, finish documentation, then perform the required final verification once against the finished tree. Commit at meaningful checkpoints. Do not publish until the user separately approves the concrete locally verified result.

This is a recommendation only. No continuation is authorized by this checkpoint response. Implementation remains paused.

## Exact implementation file inventory on arrival

Counts by area: Studio 13, game 23, database 15, model 1, documentation 8. All paths below are relative to the repository. This report is one additional checkpoint-only file.

- `apps/studio/app/api/characters/[characterId]/maneuvers/[maneuverId]/builder/route.ts` — new
- `apps/studio/app/api/characters/[characterId]/maneuvers/[maneuverId]/draft/route.ts` — new
- `apps/studio/app/api/characters/[characterId]/maneuvers/[maneuverId]/finalize/route.ts` — new
- `apps/studio/app/api/characters/[characterId]/maneuvers/[maneuverId]/rebuild/route.ts` — new
- `apps/studio/app/api/characters/[characterId]/maneuvers/[maneuverId]/retire/route.ts` — new
- `apps/studio/app/api/characters/[characterId]/maneuvers/[maneuverId]/route.ts` — new
- `apps/studio/app/api/characters/[characterId]/maneuvers/[maneuverId]/validate/route.ts` — new
- `apps/studio/app/api/characters/[characterId]/maneuvers/route.ts` — new
- `apps/studio/src/api/errors.ts` — modified
- `apps/studio/tests/integration/fixtures/m6-wo3-character-world.ts` — modified
- `apps/studio/tests/integration/m6-wo8-signature-maneuvers-api.test.ts` — new
- `apps/studio/tests/unit/m6-wo7-static.test.ts` — modified
- `apps/studio/tests/unit/m6-wo8-static.test.ts` — new
- `docs/architecture/m6-api-routes.json` — modified
- `docs/architecture/m6-approved-m5-changes.json` — modified
- `docs/architecture/m6-invariants.json` — modified
- `docs/architecture/m6-invariants.md` — modified
- `docs/architecture/m6-maneuver-builder.md` — new
- `docs/architecture/m6-schema-changes.json` — modified
- `docs/architecture/m6-wo8-baseline.json` — new
- `docs/architecture/m6-wo8-governed-content-candidate.md` — new
- `packages/prowess-db/prisma/migrations/20261104010000_m6_wo8_signature_maneuvers/migration.sql` — new
- `packages/prowess-db/prisma/schema.prisma` — modified
- `packages/prowess-db/src/character/index.ts` — modified
- `packages/prowess-db/src/character/signature-context.ts` — new
- `packages/prowess-db/src/character/signature-maneuver-repository.ts` — new
- `packages/prowess-db/src/character/signature-maneuver-service.ts` — new
- `packages/prowess-db/src/character/signature-spell-repository.ts` — modified
- `packages/prowess-db/src/character/signature-spell-service.ts` — modified
- `packages/prowess-db/src/character/weapon-repository.ts` — modified
- `packages/prowess-db/src/client.ts` — modified
- `packages/prowess-db/src/index.ts` — modified
- `packages/prowess-db/tests/fixtures/m6-wo3-character-release.ts` — modified
- `packages/prowess-db/tests/fixtures/m6-wo8-maneuvers.ts` — new
- `packages/prowess-db/tests/integration/m6-wo8-migration-compat.test.ts` — new
- `packages/prowess-db/tests/integration/m6-wo8-signature-maneuvers.test.ts` — new
- `packages/prowess-game/src/ability/compile.ts` — modified
- `packages/prowess-game/src/ability/duration-conditions.ts` — modified
- `packages/prowess-game/src/ability/maneuver-cost.ts` — modified
- `packages/prowess-game/src/character-signature-maneuver-world.test.ts` — new
- `packages/prowess-game/src/character-signature-maneuver.test.ts` — new
- `packages/prowess-game/src/character/signature-maneuver-catalog.ts` — new
- `packages/prowess-game/src/character/signature-maneuver.ts` — new
- `packages/prowess-game/src/character/signature-spell-catalog.ts` — modified
- `packages/prowess-game/src/construction/composition.ts` — modified
- `packages/prowess-game/src/construction/legality.ts` — modified
- `packages/prowess-game/src/construction/maneuver-context.ts` — new
- `packages/prowess-game/src/content-updates/m6-wo8-amendment-a.ts` — new
- `packages/prowess-game/src/definition/authored-ability-payload.ts` — modified
- `packages/prowess-game/src/definition/duration-condition-payload.ts` — modified
- `packages/prowess-game/src/definition/maneuver-cost-policy.ts` — modified
- `packages/prowess-game/src/definition/trait-payload.ts` — modified
- `packages/prowess-game/src/effect/compile.ts` — modified
- `packages/prowess-game/src/index.ts` — modified
- `packages/prowess-game/src/m6-wo8-amendment.test.ts` — new
- `packages/prowess-game/src/targeting/compile.ts` — modified
- `packages/prowess-game/src/testing/m6-wo8-maneuver-world.json` — new
- `packages/prowess-game/src/testing/signature-maneuver-fixtures.ts` — new
- `packages/prowess-game/src/vocabulary/construction.ts` — modified
- `packages/prowess-model/src/errors.ts` — modified
