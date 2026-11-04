# M6-WO8 Phase A verified checkpoint

Date: November 4, 2026 (America/Los_Angeles).

Resumed the existing `m6-wo8` branch at `37d17f39df6ca1fa44ebc28560b8f3d17abd18ee`, whose baseline is `d005fc30c8c7e175896898c1973e6d3bda144869`. The working tree was clean on resume. No Work Order restart, historical golden update, pricing change, push, PR, or merge occurred.

## Narrow corrections

- Exact-reference checks now assert the actual pinned Foundation lookup and exact Weapon/Attack comparison calls.
- The Action-block guard now checks the actual M4 numeric requirement and the exact `construction.value.outputs.access.martialRankValue` source, including its comparison operator.
- A further mismatched assertion in that same static case now checks both exact Action and inherited-targeting Trait filters using the compiler's actual `scope` representation.
- Removed one extra schema separator blank line so the existing historical schema restoration hash passes unchanged. No migration SQL changed.
- Removed a trailing blank line in the extracted shared context module; `git diff --check` is clean.

No game implementation, canonical content, historical digest file, golden expectation, or frozen-gate expected hash was changed in this phase. These corrections repair mismatched assertions and schema marker whitespace; they do not relax the underlying exact-reference, global-capacity, scope-isolation, or historical equivalence requirements.

## Passing focused verification

- `corepack pnpm install --frozen-lockfile` — successful, pinned pnpm 9.15.9; lockfile unchanged.
- `pnpm --filter @prowess/game... run build` — model, rules, game builds passed.
- `pnpm --filter @prowess/game run lint` — passed.
- `pnpm --filter @prowess/game run typecheck` — passed.
- Combined existing WO7 and new WO8 static tests — **44 passed, 2 files**.
- Focused domain / historical-equivalence / WO6–WO7 regression selection — **404 passed, 7 files**:

| Suite | Result |
| --- | --- |
| `src/character-signature-maneuver-world.test.ts` | 1 passed |
| `src/character-signature-maneuver.test.ts` | 11 passed |
| `src/character-signature-spell.test.ts` | 34 passed |
| `src/m6-wo7-m5-characterization.test.ts` | 314 passed |
| `src/m6-wo8-amendment.test.ts` | 12 passed |
| `src/maneuver-cost-golden.test.ts` | 23 passed |
| `src/weapon-bridge.test.ts` | 9 passed |

Total in this Phase A selection: **448 passing tests across 9 files**. This includes all **313 historical M5 characterization cases**, the historical Maneuver cost goldens, the WO6 bridge, and the Character Spell regression suite. It is focused Phase A verification, not the full permanent suite or a claim of WO8 completion. The exact protected-floor examples, Signature order, MP/preparation behavior, exact Attack identity, per-Action scopes, global capacities, and missing-content behavior are covered by the WO8 domain cases.

## Evidence

Captured stdout/stderr is under `/workspace/scratch/fbaf3d41cc21/wo8-tools/resume-phase-a/`.

- `domain-equivalence.log` — SHA-256 `e8e95b6608f1e74e2ec6906aa651e43cadfcd258234d072f38047d58b6287d04`
- `lint.log` — SHA-256 `3ed33cfa82d023dec17b4a37f74e2c098357c94af5bc20520e5177588ae57b0f`
- `static.log` — SHA-256 `09062defd6d7dcf6ecd4743c78f8a7b72de41aab38b7cd0b7e6a1df5d4ff1c5b`
- `typecheck.log` — SHA-256 `1867a94ff8ea793ed762c4ec480bf3b720b5c7e51e3af260a7004ccffa5925ea`

The first resumed static run corrected the known schema/reference/capacity issues and exposed the additional mismatched scope assertion. After the scope correction, all 44 static cases passed. Successful package build output is also in the tool execution record. No database, API integration, E2E, or full regression suite was run in Phase A.

## Execution safeguards now in force

For the same infrastructure/tool/database/test-environment failure, two attempts without meaningful progress require stopping that blocker, preserving a local commit or Git bundle, reporting both attempts and the exact blocker, identifying the shortest safe continuation, and stopping for review. This overrides general persistence. No identical failed infrastructure attempt was repeated during Phase A; dependency restoration made progress and succeeded.

After each successfully verified phase, create a local checkpoint and report its exact SHA, passing evidence, and remaining work. Do not enter the next phase before the current phase's acceptance requirements pass. Do not use the previous PostgreSQL 14.5 emulator as a substitute for the newly required consistent PostgreSQL 16 environment.

## Remaining work

**Phase B next:** establish one consistent PostgreSQL 16 environment; verify the existing migration/persistence/API code, historical upgrade, shared Signature capacity and race behavior, stale/loadout guards, historical Release pinning, all eight Maneuver routes, and relevant WO7 regression. Preserve a verified Phase B checkpoint before UI work.

**Phase C:** the complete Maneuver UI, Abilities/Sheet presentation, component tests, and six required E2E scenarios remain unimplemented.

**Phase D:** negative controls, permanent CI registration, final permanent regression suite, Prisma drift proof and completed implementation report remain pending.

The earlier recovery assessment remains an immutable account of the paused pre-resume checkpoint. This document records the newly verified Phase A boundary only.
