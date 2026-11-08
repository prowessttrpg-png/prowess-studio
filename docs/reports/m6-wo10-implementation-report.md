# M6-WO10 — Character Play Workspace implementation report

Status: complete local implementation and local verification on branch `m6-wo10`. **Not certified.** WO10 is final only after its published tree passes the complete required GitHub Actions workflow (Tier 2) in a same-commit run, which needs separate publication authorization. No push, PR, merge, `main` change, canonical Release change or later Work Order is authorized by this report.

Architecture: `docs/architecture/m6-character-play-workspace.md`. Invariants: M6-I151 – M6-I172.

## 1. Baseline and checkpoint

| Item | Value |
| --- | --- |
| Certified baseline | `dad46bb25ded0e4e18d6664e8982a5557f9359c1` (`main`, merge of PR #71 / WO9 CI fix; CI run 42324567737 #262 success) — local tag `m6-wo10-baseline` |
| Branch | `m6-wo10` (local only) |
| Final checkpoint | the `m6-wo10` commit that contains this report (local tag `m6-wo10-checkpoint`) — §9 |

## 2. What was built

- **Play domain (`@prowess/game` `play/`).**
  - A closed, versioned operation contract with ten kinds. Every operation is evaluated purely and deterministically.
  - The only Resource path: the M5-WO3 runtime compiler executed by M4, plus `confirmActionPayment`.
  - The pieces below all reuse the existing engines:
    - timing via RESOURCE_TIMING;
    - General Action cost models;
    - Counter Action legality;
    - movement;
    - Weapon Attacks (WO2 Attack Roll);
    - Signature Spells (WO7 + WO12 + WO13) and Signature Maneuvers (WO8 + WO12 independent groups);
    - Active Magic through WO13;
    - manual adjustments, notes and reconciliation.
- **Persistence (`@prowess/db`).**
  - Migration `20261108010000_m6_wo10_character_play_workspace`: a runtime row per Character plus an append-only event ledger. Triggers enforce append-only, Release binding and Release immutability.
  - One-transaction commit: sheet compare-and-set + runtime compare-and-set + one event.
  - Idempotency by key + request hash; optimistic concurrency on both versions.
- **API.** Four strict, registered routes: workspace, preview, operations and events.
- **Studio.**
  - The `/characters/[id]/play` workspace: header, resources, timing, category tabs, the action detail / roll panel, Active Magic, the activity log and the read-only WO9 card drawer.
  - Optional unbiased digital dice.
  - A digital-only link from the Character Sheet.

## 3. Approved M5 changes

These are additive adapters, registered in `m6-approved-m5-changes.json` under M6-WO10 with exact file hashes. Their characterization tests are M6-I171.

- **`ability/effect-execution.ts`.** `Compiled` exported; `executeCompiledResolution`. `executeAbilityResolution` delegates to it unchanged; the WO12 goldens pass, along with a chain-behaviour equivalence test.
- **`character/signature-spell.ts`, `character/signature-maneuver.ts`.** An optional `capture` callback receives the compiled plan of a valid evaluation.
- **`ability/active-magic.ts`.**
  - `transitionActiveMagicWith(request, adapter)` plus the `CharacterSpellIdentity` / adapter types.
  - `transitionActiveMagic` = `With(request, null)`.
  - The strings pinned by M5-I336 are unchanged: the value imports are kept on their original lines and type imports are separate.
- **`index.ts`.** Exports.

## 4. Decisions and genuine blockers

No mechanic was invented. Each gap is surfaced as REFUSED / UNSUPPORTED / REFERENCE_ONLY with its reason:

1. **Character Signature Spells are not bundle Definitions, so WO13 alone cannot activate them.** Resolved by the additive adapter (§3). Without an adapter, WO13 still refuses them; this is proven.
2. **Spell-casting MP is ME-eligible** (M5-SC-004): `SPELL_CASTING_ME_ELIGIBLE = true`. Attack and Maneuver MP are MP-only.
3. **Spell AP** is paid through the Release's ACTION whose cost is VARIABLE-by-SPELL. That Action is found from data, never by name, and charged at the WO10 Final AP. Maneuver and Attack AP are SPENDs by their own source key, so nothing is charged twice.
4. **Standalone Weapon Attack Saving Throws, DEFERRED Attacks and Attacks with an accuracy modifier have no executable binding.** They are REFERENCE_ONLY.
5. **Mana Lock amount (M5-SC-052)** fails closed. **Channel-completion MP (M5-SC-053)** stays UNRESOLVED.
6. **No target state exists.** Damage, healing and effects are authorised and reported but **NOT APPLIED**.
7. **Pending inputs are not persisted.** The client resubmits the full operation and the server recomputes.

## 5. Changes made to satisfy the historical gates

The full historical static suites ran against the new files. The play domain was brought into conformance without weakening any gate:

- **M5-WO1 `mutable-module-state`.** The module-level `WeakMap` evaluation memo became a request-scoped cache that the context carries (`createPlayEvaluationCache`).
- **M5-WO1/WO2 `hidden-math`.**
  - The round counter moved to `internal/round.ts` (`nextRoundOrdinal`), documented as sequence bookkeeping and pinned by W10-I151.
  - The Attack AP/MP listing is read by key (`listedAttackCost`), as M6-WO9 does.
  - Weapon/Attack refs are destructured.
- **M5-WO3 `persistence`.** `commit` → `accept`, `saved` → `onSheet`, and the view fields `persisted` / `persists` → `recorded` / `becomesActiveMagic`.
- **M5-WO3 `action-cost-switch`.** The operation kind `MOVE` (colliding with the ACTION key) became `MOVEMENT` in the contract, migration CHECK, UI and tests.
- **M5-WO3 `resource-name-branch`.** The turn-scoped Movement Allowance location became an explicit storage map (`RUNTIME_HELD_RESOURCES`). Bounds come from the Resource Definition.
- **M5-WO13 M5-I336.** The pinned import lines were restored exactly.
- **M6-WO3 Studio catalog rule.** The Saving Throw Stat list is now served by the server (`defenderStats` from `PROWESS_STATS`).
- **M2-WO3 scope rule.** `ResolutionPanel.tsx` was renamed `ActionDetailPanel.tsx`.
- **M6-WO9 W9-I129–I150.** The register closure check (exactly 150 rows) became a contiguous, duplicate-free sequence of at least 150 rows. WO9's own 22 rows remain pinned exactly. This is the only edit to an earlier gate, and it was needed for any later invariant to exist.

The unpublished migration was edited twice before any publication: the `play_state_version >= 0` CHECK, and the `MOVEMENT` kind. The local databases were altered to match and their checksums updated. A fresh database built from all 29 migrations applied cleanly.

## 6. Permanent protection

- **Invariants.** M6-I151 – M6-I172: 22 rows, each naming existing guards, the WO10 static gate and the mutation script.
- **Static gate.** `apps/studio/tests/unit/m6-wo10-static.test.ts`, 22 tests with the prefix `W10-`. It covers:
  - M5-WO1/WO2/WO3 audits of every play module, with a self-check;
  - the WO3/M4 engine route;
  - provenance and triggers;
  - the closed contract and route registry;
  - preview/commit separation;
  - transaction structure and single-module table ownership;
  - idempotency and concurrency;
  - payment ordering, no double charging and ME eligibility;
  - timing and cost models, Counter Actions and movement;
  - roll and Save semantics, and unbiased dice;
  - Spell/Maneuver separation and the Active Magic authority;
  - no target application;
  - manual adjustment classification;
  - the append-only ledger;
  - Sheet/Card compatibility;
  - the additive adapters;
  - `playUiFindings`, the Studio no-mechanics check;
  - the invariant register.
- **Mutation controls.** `scripts/m6-wo10-negative-controls.mjs`: 52 controls on the CLOSEOUT-03 harness, run against the game play suite, the static gate and the Play UI.
- **CI.**
  - `scripts/ci/gates.json` gate `M6-WO10`: controls-2, tiers [2, 3], 13 suites.
  - A `.github/workflows/ci.yml` step (`PROWESS_EXPECT_CONTROLS=52`).
  - `ci-gate-inventory.test.ts`: 42 gates, 669 controls across 24 scripts.

## 7. Tests added

| Suite | File | Tests |
| --- | --- | --- |
| Game (A–C, manual / reconciliation) | `packages/prowess-game/src/play-workspace.test.ts` | 27 |
| DB integration (D) | `packages/prowess-db/tests/integration/m6-wo10-play-workspace.test.ts` | 7 |
| API integration (D) | `apps/studio/tests/integration/m6-wo10-play-api.test.ts` | 4 |
| Studio UI (E) | `apps/studio/tests/unit/m6-wo10-play-ui.test.tsx` | 11 |
| Static gate | `apps/studio/tests/unit/m6-wo10-static.test.ts` | 22 |
| Browser (F, flows 1–15) | `apps/studio/tests/e2e/m6-play.spec.ts` | 3 |

## 8. Local verification

Results are recorded in §8.1. Local environment limitation: the Prisma engine download (binaries.prisma.sh) is refused (403) by this sandbox's network. The workarounds:

- `prisma generate` / `validate` ran with an offline schema-engine stand-in.
- Migrations were applied with `psql`, with a `_prisma_migrations` row and checksum recorded per migration.
- `prisma migrate deploy` itself could not run locally; CI runs it.

### 8.1 Results

All results below are from local runs on this checkpoint's source (2 CPU sandbox, PostgreSQL 16). Nothing is reported that did not run.

| Check | Result |
| --- | --- |
| Game unit (`@prowess/game` test:unit) | 57 files, 1821 tests passed |
| DB unit (`@prowess/db` test:unit) | 22 files, 164 tests passed |
| Studio unit + static (`@prowess/studio` test:unit) | 104 files, 3687 tests passed |
| DB integration shard 1/2 (fresh database) | 31 files, 298 tests passed |
| DB integration shard 2/2 (fresh database) | 30 files, 329 tests passed |
| Studio API integration | 39 files, 239 tests passed |
| WO10 suites after the final sheet-repository change | DB WO10 + WO5 sheet 16/16; API WO10 4/4; WO5 + WO10 static 49/49 |
| Playwright (production build) | 81 / 81 passed (fresh production build), including the 4 WO10 flows covering browser flows 1–15; the WO9 card, Character Sheet and print suites are unchanged and green |
| `pnpm lint` / `pnpm typecheck` / `pnpm run test:architecture` | clean / clean / 13 rules, 7 packages, no violations |
| Prisma validate | valid (offline engine stand-in) |
| Migrations | all 29 applied cleanly to a freshly created database; local dev/test databases match |
| Gate inventory (`scripts/ci/gate-inventory.mjs`) | 9 suites, 42 gates, 669 controls, 14 checks; every legacy item represented |
| Control-harness self-test | 8 scenarios behave as required |
| M6-WO10 controls | 52 / 52 caught and restored (14 baseline + 52 mutation guard runs; tree unchanged) |
| M6-WO9 controls | 46 / 46 |
| M6-WO8 controls | 36 / 36 |
| M6-WO7 controls | 68 / 68 |
| M6-WO5 controls | 33 / 33 (re-run after the sheet-repository change) |
| M5-WO13 controls | 30 / 30 |
| M5-WO12 controls | 26 / 26 |

Issues found by verification and fixed before this checkpoint:

- **DB public-surface drift guards** (`entity-version-lifecycle`, `change-set`). The four play services were registered with comments, by insertion only, following the WO6–WO9 precedent. `commitCharacterPlayOperation` is excluded by name from the ChangeSet "commit…operation" pattern: it is a play-ledger commit, not a ChangeSet operation.
- **Browser flow 10.** The full-turn flow's Ember Bolt left too little mana for the Sustained Spell, and the engine correctly refused it ("insufficient mana … nothing was paid"). Flow 10 now runs on a fresh Character.
- **WO10 control 36 was not caught at first.** The own-turn reaction was refused only for an empty pool. The game test now asserts the `PLAY.WRONG_TIMING_WINDOW` reason.
- **Duplicate write path.** The sheet compare-and-set was duplicated by `writePlayStateWithin`, which created a duplicate WO5 mutation anchor. There is now one implementation: `writePlayState(…, within?)` runs inside a caller's transaction, and `writePlayStateWithin` delegates to it.
- **Residue between local runs.** A cleanup failure in a DB test was caused by data that a previous Studio integration run left in the shared local database. It was resolved by rebuilding the database before each suite, which matches CI's per-job databases. It was not a WO10 defect.

## 9. Checkpoint

The checkpoint is the `m6-wo10` commit that contains this report, tagged locally `m6-wo10-checkpoint`. A commit cannot contain its own SHA, so its commit SHA, tree SHA and recovery-bundle SHA-256 are recorded in the delivery note and in the Project's checkpoint record (`claude/m6-wo10-checkpoint.md`).

Recovery commits on the branch (all preserved):

- the domain, persistence, service, API, UI and test commits from the implementation;
- `63e1998` — gate, controls and CI registration, plus audit conformance;
- `b7a7dba` — DB drift-guard registration and the browser flow split;
- `146777b` — timing-reason assertion;
- the sheet compare-and-set unification;
- this report.

The bundle is a full bundle of `m6-wo10`, the baseline `dad46bb` and the tags `m6-wo10-baseline` / `m6-wo10-checkpoint`, so it restores without any other repository. It was verified by cloning it into an empty directory and comparing the checked-out tree SHA with the checkpoint's.

Nothing was pushed. No PR was opened and nothing was merged; `main` is untouched. Publication needs separate authorization, and certification needs the complete same-commit GitHub Actions run, including Tier 2.
