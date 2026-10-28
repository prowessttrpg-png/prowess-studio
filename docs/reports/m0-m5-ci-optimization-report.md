# M0–M5 CI, Test & Developer-Feedback Optimization (M5-CLOSEOUT-03)

| | |
|---|---|
| Baseline | `f3a5698b0b70968f63f82cfdd6bad8ddb335c20a` (merged `main` after CLOSEOUT-02) |
| Stage 1 | PR #57 (`m5-closeout-ci`, head `3cecf1b`) — merged into `main` as `7f39301` (accepted intermediate checkpoint) |
| Stage 2 | `m5-closeout-ci-stage2` from `7f39301`: retirement of the dedicated WO7–WO13 workflows + this report |
| Scope | C1–C9 (all approved); R6 completed; R1 / R4 / R10 / R11 analysed only |
| Status | Published and measured on GitHub (runs #221–#223); timings below are measured unless marked otherwise. |

Principle applied throughout: optimize execution, not protection. Every permanent assertion that existed at the baseline
still runs; the inventory check (§12) proves it mechanically.

## 1–2. Baseline, branches and publication history

Baseline `f3a5698`. Published in two stages so the legacy and replacement pipelines ran side by side first:

| Step | Commit | Result |
|---|---|---|
| Stage 1 overlap (new CI + legacy WO7–13 workflows) | `65e60c9` (run #220) | legacy green; new jobs failed: no Prisma Client in building jobs, no dev database for DB shard 1 |
| Correction 1 | `8e7c231` (run #221) | every verification job green; tier summaries failed (no checkout for `scripts/ci/require-success.mjs`) |
| Correction 2 | `3cecf1b` (run #222) | all 16 jobs green; all 7 legacy workflows green |
| PR #57 merged | `7f39301` (run #223, `main`) | all 16 jobs green; all 7 legacy workflows green |
| Stage 2 | `m5-closeout-ci-stage2` | retire `m5-wo7.yml` … `m5-wo13.yml`; this report |

Both corrections changed workflow wiring only (no gate, check, control or assertion). The tree of `7f39301` is
identical to `3cecf1b`.

## 3. Old workflow graph (baseline)

```
push / PR ──► ci.yml            one job "ci", ~58 sequential steps:
                                 install → Prisma → build → lint → arch → typecheck → package units (incl. game)
                                 → DB integration → Studio unit → API integration → 18 M1/M4 named steps
                                 (each re-running its files) → 14 M5 named steps (each re-running its game / static /
                                 inspector / history / API files, M5-WO1 re-running the WHOLE game suite) and 13
                                 control scripts → guarded reset → browsers → build → Playwright (which built again)
          ├─► m5-wo7.yml        install → build subset → WO7 files again → WO7 controls (22, ONLY here)
          ├─► m5-wo8.yml / m5-wo9.yml        same pattern (files + controls again)
          └─► m5-wo10…wo13.yml  PostgreSQL → migrate → build → files + history + API again → controls again
```

## 4. New workflow graph

```
static ─────────┐ lint · architecture · typecheck · gate inventory · harness self-test        Tier 1
unit-packages ──┤ model / ui / import / rules / db unit (concurrently)                         Tier 1
unit-game ──────┤ @prowess/game                                                                Tier 1
unit-studio ────┤ Studio UI / component / static audits                                        Tier 1
db-api ─────────┤ Prisma validate · generate · migrate ×2 · drift · API integration ·
                │ guarded reset · safety-guard refusal                       (own PostgreSQL)
db-integration ─┤ shard 1/2, shard 2/2                                       (own PostgreSQL each)
                └──► controls-1 … controls-6   named gates: verify from reports, then controls   (own checkout each)
e2e                one production build → Playwright on that build            (own PostgreSQL)
tier-1             needs the four Tier 1 jobs          "Tier 1 — fast feedback"
tier-2             needs EVERY job                     "Tier 2 — merge readiness" / "Tier 3 — clean certification"
```

`controls-1`: M1 ×3, M4-WO1…WO12 (17 named steps incl. m4-final controls), M5-WO1…WO3 · `controls-2`: M5-WO4, canon
rulings, M5-WO5 · `controls-3`: M5-WO6…WO10 · `controls-4`: M5-WO11 · `controls-5`: M5-WO12 · `controls-6`: M5-WO13.
The split balances the measured control times (§13). Every named gate keeps its exact step name and order.

## 5. Baseline timing (GitHub, measured)

| Run | Commit | `ci` job | Dedicated WO7–13 jobs (sum) | Runner time per push | Critical path |
|---|---|---|---|---|---|
| #215 (push) | `0847ca7` (pre-CLOSEOUT-02) | 4,760 s | 2,540 s | 7,300 s | 4,760 s |
| #217 (push) | `7146ee3` (same code) | 3,617 s | 2,555 s | 6,172 s | 3,617 s |
| #218 (PR) | `930c799` | 2,930 s | 1,642 s | 4,572 s | 2,930 s |
| #219 (push) | `f3a5698` (this baseline) | **2,038 s** | 1,591 s | **3,629 s** | **2,038 s** |

#215 and #217 ran identical code 1,143 s apart: runner variance is large; no single-run comparison is conclusive.

## 6. Optimized timing

**GitHub, measured** (run #222 at `3cecf1b`; run #223 on `main` within a few seconds per job):

| Job | Seconds |
|---|---|
| static | 77 |
| unit-packages / unit-game / unit-studio | 101 / 182 / 52 |
| db-api | 121 |
| db-integration shard 1 / shard 2 | 136 / 131 |
| controls-1 / -2 / -3 / -4 / -5 / -6 (start when the suite jobs finish, ≈ 185 s) | 204 / 228 / 199 / 130 / 132 / 225 |
| e2e (production build + Playwright 45/45) | 113 |
| tier-1 / tier-2 | 6 / 5 |

| Run | Commit | Wall clock | Runner time (sum of jobs) |
|---|---|---|---|
| #221 | `8e7c231` | 6 m 38 s | 2,011 s (tier summaries failed) |
| #222 | `3cecf1b` | 7 m 04 s | 2,042 s |
| #223 | `7f39301` (`main`) | 7 m 04 s | 2,065 s |

**Local measurement** (2-vCPU VM, every job's commands run sequentially on one machine — a simulation of the graph, not
of its parallelism; final local run before publication):

| Stage | Seconds |
|---|---|
| static (build, lint, arch, typecheck, inventory, self-test) | 14 + 22 + 1 + 21 + 0 + 1 |
| unit-packages / unit-game / unit-studio | 81 / 186 / 63 |
| API integration / DB shard 1 / DB shard 2 | 36 / 88 / 64 |
| controls-1 / -2 / -3 / -4 / -5 / -6 (gates incl. verification) | ≈ 137 / 152 / 125 / 75 / 146 / 153 |
| production build / Playwright (prebuilt) | 23 / 33 |

## 7–8. Runner-minutes

| | Per push to `main` |
|---|---|
| Before (#219, measured) | 3,629 s ≈ **60.5 runner-min** (2,038 `ci` + 1,591 dedicated) |
| Before (#215 / #217, measured) | 7,300 s / 6,172 s |
| After, consolidated CI (#222 / #223, measured) | 2,042 s / 2,065 s ≈ **34 runner-min** across 16 jobs (≈ 44 % less) |
| Interim, Stage 1 on `main` (#223) | + ≈ 1,160 s for the seven legacy WO7–13 workflows still running beside it |
| After Stage 2 | the consolidated CI only (the legacy cost disappears) |

The repository is public (standard 4-vCPU runners, not billed). The reduction comes from not running suites twice and
not bootstrapping seven dedicated workflows, partly offset by per-job setup in the 15 parallel jobs.

## 9–10. Critical path

| | |
|---|---|
| Before | **2,038 s ≈ 34 min** (#219; 60–80 min in #215 / #217) |
| After (measured) | **7 m 04 s** (#222 and #223): unit-game 182 s → controls-2 / controls-6 ≈ 228 s → tier-2 5 s; e2e 113 s in parallel |

≈ **4.8× faster** wall-clock feedback; inside the CLOSEOUT-01 target range (12–20 min) with wide margin.

## 11. Duplicate executions removed (per push)

| Duplicate | Before | After |
|---|---|---|
| Named-step re-runs of test files already run by their suite | 143 file executions (100 distinct files): 106 in `ci.yml`, 37 in the dedicated workflows | 0 (gates verify from the authoritative reports) |
| Whole `@prowess/game` suite | 2 (unit step + M5-WO1 step) | 1 |
| Control scripts | 20 runs of 14 scripts (WO8–WO13 twice; WO7 only in its dedicated workflow) | 14 runs, once each |
| Workflow bootstraps (install / build / migrate) | 1 + 7 dedicated | 1 per parallel job, no duplicate workflow |
| Next.js production build | 2 (Build step + Playwright `webServer`) | 1 |
| Control guard re-runs | per control: baseline + mutation + restored re-run | one baseline per distinct guard + mutation |

## 12. Assertion inventory

`scripts/ci/gates.json` (machine-checkable): 9 suites, 32 named gates (M1 ×3, M4-WO1…WO12 incl. the database / HTTP
gates, M5-WO1…WO13, canon rulings), 280 controls, 14 non-vitest checks, 3 explicit retirements with reasons. For every
gate: id, name, job, kind, test files, complete suites, control script + exact count + kind, smoke checks, the previous
workflow / step, tiers (2 and 3).

`scripts/ci/legacy-inventory.json` is a frozen snapshot read from git at `f3a5698` (223 items, 39 named steps across 8
workflows). `scripts/ci/gate-inventory.mjs` proves — in the `static` job and in `ci-gate-inventory.test.ts` — that old ⊆
new, that each gate's step verifies exactly its files and runs its controls with the exact count, that every suite is
run and collected in its job, every check present, and every control script owned by exactly one gate. Negative tests
of the check itself (dropping a file from a step, changing a count, renaming a gate step, removing a collection or a
Prisma command) each produce the expected failure.

## 13. Control harness before / after

`scripts/lib/control-harness.mjs` (C2): per distinct guard command one green baseline on the pristine tree; per control
the mutation run (must fail for the control's own pattern), restore in `finally`, byte-for-byte check; per script a
whole-tree check (git status + bytes of every modified / untracked file before = after). The per-control restored re-run
is replaced by the byte-level proof plus the baseline, as §C2 allows. Self-test: `control-harness.selftest.mjs`.

Local (same VM, sequential, identical commands):

| Script | Controls | Guard runs before → after | Seconds before → after |
|---|---|---|---|
| m4-final | 3 | 7 → 7 (already 1 + N + 1) | 6 → 6 |
| M5-WO1 | 17 | 51 → 32 | 60 → 37 |
| M5-WO2 | 18 | 54 → 33 | 75 → 47 |
| M5-WO3 | 21 | 63 → 37 | 71 → 42 |
| M5-WO4 | 34 | 102 → 62 | 124 → 76 |
| M5-WO5 | 29 | 87 → 56 | 117 → 76 |
| M5-WO6 | 16 | 48 → 25 | 57 → 31 |
| M5-WO7 | 22 | 68 → 25 | 70 → 27 |
| M5-WO8 | 8 | 17 → 9 | 17 → 9 |
| M5-WO9 | 12 | 25 → 13 | 28 → 14 |
| M5-WO10 | 18 | 54 → 27 | 75 → 41 |
| M5-WO11 | 26 | 78 → 40 | 142 → 74 |
| M5-WO12 | 26 | 78 → 46 | 242 → 141 |
| M5-WO13 | 30 | 90 → 51 | 258 → 150 |
| **Total** | **280** | **822 → 463** | **1,342 → 771** |

The 280 "caught" lines are identical, in order, before and after.

## 14. Vitest process starts per push

| | Before | After |
|---|---|---|
| Suites | 9 | 10 (DB integration in two shards) |
| Named-step re-runs | 79 (`ci.yml`) + 26 (dedicated) | 0 |
| Control guards | 754 (`ci.yml`) + 410 (dedicated) | 463 |
| **Total** | **≈ 1,278** | **≈ 473** |

## 15–16. Mutation and negative-control totals

Unchanged: **280** controls — 180 negative (m4-final 3, M5-WO1…WO9 177) and 100 mutation (M5-WO10…WO13). Every
mutation, anchor and expected-failure pattern is byte-identical; `PROWESS_EXPECT_CONTROLS` pins each script's count at
run time and `ci-gate-inventory.test.ts` pins the per-script counts statically. The 22 WO7 controls, previously only in
`m5-wo7.yml`, now run in the permanent pipeline.

## 17. Parallelization model

Jobs, not threads: each `controls-*` job is its own runner and checkout, so no two controls ever mutate the same files
concurrently; inside a job controls run sequentially and restore before the next. Database jobs each own a PostgreSQL
service. Package unit suites run concurrently inside `unit-packages` (independent processes, one report each). DB
integration is sharded (`--shard=k/2`) across two independent databases.

## 18. Caching

| Cache | Key | Tier 3 |
|---|---|---|
| pnpm store (`setup-node`) | lockfile hash | not used |
| Playwright Chromium (`~/.cache/ms-playwright`) | runner OS + exact Playwright version | not used; OS deps always installed |
| Next.js `.next/cache` | lockfile hash + commit (restore: latest for the lockfile) | not used |

Never cached: database state, Ruleset resolution, application runtime state, suite reports (artifacts are per run and
verified against the commit SHA).

## 19. Artifact reuse

- Suite reports: vitest JSON written by the suite job, moved out of the checkout by `collect-reports.mjs` (with suite and
  commit SHA), uploaded per job (7-day retention), downloaded by the gate jobs. `verify-gate.mjs` refuses a report of
  another commit, a missing shard, a missing file, a failed or empty file.
- Production build: built once and served by Playwright **in the same job** — no cross-job artifact, so the exact
  commit / lockfile / configuration identity is structural. `PROWESS_E2E_PREBUILT=1` makes the `webServer` refuse to
  start without `.next/BUILD_ID`.

## 20. Playwright

Second Next.js build removed; browsers cached; app started once by `webServer`; database prepared once per job
(migrations on a fresh service database). The single existing CI retry is unchanged.

## 21. Flaky-test findings (C8)

Reproduced with `playwright test --repeat-each=3` locally:

| Test | Root cause | Action |
|---|---|---|
| `boot.spec` "clicking a nav link …" | `getByRole('link', { name: 'Compendium' })` is a case-insensitive substring match; with existing "test.compendium.entity…" rows it matched 8 links (strict-mode violation). Data-dependent. | Fixed: `exact: true` for the nav links. |
| `version-history.spec` mobile "comparison stacks vertically …" | Geometry read once right after `toBeVisible`; under full-suite parallel load the read could land mid-layout (20/20 green in isolation; 2 of 3 full repeats red). | Fixed: geometry polled until settled; the stacked-layout assertion unchanged. |
| `m2-governance.spec` "the top-bar selector only changes the VIEWING context" | Only on a reused local database with > 100 Rulesets (240 here): the top-bar selector lists the first 100 (`pageSize: 100`), so the new Ruleset is not an option. Product limitation, not timing. | Characterized only (app behaviour is out of CLOSEOUT-03 scope); cannot occur in CI (fresh database per run). Proposed for a later Work Order. |

After the fixes: fresh database 135/135 over three full repeats; reused database only the characterized selector case.

## 22–23. PR and `main` behaviour

`concurrency.group` = `ci-pr-<number>` for pull requests with `cancel-in-progress: true` — a superseded PR run is
cancelled. Every other event (push to `main`, manual, certification) uses `ci-run-<run id>`: unique, never cancelled by a
newer commit, so every `main` run finishes authoritatively.

## 24–26. Verification tiers

- **Tier 1 — fast feedback**: `static`, `unit-packages`, `unit-game`, `unit-studio` (+ `tier-1` summary). Lint,
  architecture, typecheck, inventory, every package / Studio unit suite incl. all static audits. Measured: Tier 1 green at ≈ 3 min (#222, `tier-1` finished 191 s after the run started).
  No path filters (the conservative choice; nothing is skipped by file path). Not merge certification.
- **Tier 2 — merge readiness**: every job (+ `tier-2`, which fails unless every job succeeded — skipped or cancelled
  counts as failure): all suites, DB / API integration, all 32 gates, 280 controls, Prisma validate / generate / migrate /
  drift, guarded reset, production build, Playwright.
- **Tier 3 — clean certification**: the same workflow dispatched with `certification: true` — no pnpm-store, browser or
  Next.js cache; the summary job reports "Tier 3 — clean certification". Branch protection is not configured on `main`
  (checked via the API); renaming jobs therefore breaks no required check.

## 27–28. Retired workflows and replacement mapping

| Retired | Replacement (job · step) |
|---|---|
| `m5-wo7.yml` | `controls-3` · "M5-WO7 audit — Effect framework & Spell/Maneuver contracts" (+ the 22 WO7 controls) |
| `m5-wo8.yml` | `controls-3` · "M5-WO8 audit — Traits & authored Spell/Maneuver definitions" |
| `m5-wo9.yml` | `controls-3` · "M5-WO9 audit — Duration & Ability Condition Framework" (incl. game `dist` import smoke) |
| `m5-wo10.yml` | `controls-3` · "M5-WO10 audit — Final Spell Cost & AP Derivation" |
| `m5-wo11.yml` | `controls-4` · "M5-WO11 audit — Final Maneuver Cost & Attack Floors" |
| `m5-wo12.yml` | `controls-5` · "M5-WO12 audit — Effect Chain Execution & Runtime Routing" |
| `m5-wo13.yml` | `controls-6` · "M5-WO13 audit — Active Magic Runtime" |
| `ci.yml` named steps | the same names in `controls-1…6` (verify + controls); suites in the Tier 1 / database jobs |

Overlap: Stage 1 (merged as `7f39301`) kept the dedicated workflows beside the new graph; runs #222 and #223 show both
green on the same commit, with every replacement step reporting its files verified and its exact control count caught
(WO7 22, WO8 8, WO9 12, WO10 18, WO11 26, WO12 26, WO13 30). Stage 2 deletes the seven files; the m5-wo8 … wo13 static
audits now assert the gate is in `scripts/ci/gates.json` and its dedicated workflow absent.

## 29–33. Blocked CLOSEOUT-02 items — gate classification

| Item | Blocking gate | Classification | Evidence | Proposal (not implemented) |
|---|---|---|---|---|
| R1 validated-bundle reuse | M5-WO1 audit `mutable-module-state` (no module-level `let` / `new Map/Set/WeakMap/WeakSet` in `@prowess/game`) | **TRUE INVARIANT** | The catalog states it outright: M5-I150 / I178 / I212 "… Free Of Global Mutable … State", M5-I029 "Prowess Compilation Is Deterministic". An identity registry *is* global mutable state, and its correctness depends on object identity, not data. | Keep. If ever wanted: a separate architectural WO for ONE audited, allow-listed memo module (immutable values, identity-keyed, characterized equal outputs). Prototype evidence (CLOSEOUT-02, on R2 base): WO13 activate 818 → 405 ms; the stateless R3 already reached 605 ms. |
| R4 one compile per WO13 activation | WO13 static M5-I336 check: exactly one `evaluateSpellCost(` and one `executeAbilityResolution(` in `active-magic.ts`, no `compileAbilityDefinition` | **IMPLEMENTATION PIN** over a true invariant | M5-I336's invariant is "WO13 Does Not Recalculate Spell Cost Or Reexecute Effect Chains". Sharing one compiled authored plan between the WO10 and WO12 entry points still uses exactly those engines; the gate pins the call *shape*. | Amend M5-I336's static check to also admit two non-exported entry points (`…WithPlan`) fed by one `compileAbilityDefinition` of the same request, with a characterization test proving public ≡ internal results. Estimated saving ≈ one Ability compile per activation (≈ 184 ms of ≈ 605 ms locally). Needs explicit approval. |
| R6 placeholder package | CI filters + M1 / M4-WO1 / M5-WO1 static package lists | **IMPLEMENTATION PIN** | Lists of directories, not a protected behaviour. | **Done** (`65e60c9`): package, lockfile importer, CI filters and directory references removed; the import bans in the architecture rules kept; `ci-gate-inventory.test.ts` asserts it stays gone. The one parameterized M1 layering case for that package no longer exists (Studio suite: 2,849 − 1 + 5 new inventory tests = 2,853). |
| R10 single release read | M4-WO2 static audit: Release mode must call `verifyRulesetReleaseManifestHash` then `getRulesetRelease` (imported from the release index) | **IMPLEMENTATION PIN** over true invariants | M4-I19 "Release Context Uses Frozen Composition" and M4-I20 "Release Integrity Verified Before Evaluation" are satisfied *more strongly* by one read whose verified composition is the one used; the audit pins function names. M4 is frozen. | An M4 gate-amendment WO: assert "integrity verdict computed from the same composition the context is built from, before building" instead of the two call names. Saves 1 release + 1 composition query per release resolution. |
| R11 shared provenance helper | WO8 / WO10 / WO11 static `toContain` anchors and WO10 / WO11 / WO13 mutation-control anchors on the literal comparison text | **IMPLEMENTATION PIN** | The invariant is exact provenance equality; the anchors pin its spelling. Moving anchors to a helper keeps every control meaningful. | Re-anchor the static checks and controls on the helper call + body in the same change. No performance value (hygiene only). |

## 34. Proposed future gate amendments

R4 (M5-I336 call shape) and R10 (M4-WO2 call graph) and R11 (anchor text) — each a separately approved architectural
change with characterization first. R1 is not proposed. The top-bar Ruleset selector's 100-item limit (§21) is a
product finding.

## 35. Correctness / security risks and mitigations

| Risk | Mitigation |
|---|---|
| A gate passes on stale or foreign results | Reports carry suite + commit SHA; `verify-gate` refuses another commit, missing shards, absent / failed / empty files; artifacts are per run. |
| Workflow, inventory and gate drift apart | Each gate step names its files; `verify-gate` requires them to equal `gates.json`; `gate-inventory.mjs` + the static test tie both to `ci.yml` and to the legacy snapshot. |
| A tier summary turns partial verification green | `require-success.mjs` fails on any non-success need, including skipped / cancelled. |
| Control residue or concurrent mutation | One checkout per controls job; per-control byte check; whole-tree check; harness self-test. |
| Cache masks an environment problem | Caches are performance-only and absent in Tier 3. |
| Removing a re-run hides an order-dependence | The named re-runs were the same files in the same CI environment; suites still run with their own configuration. A file that only passes in isolation would now be caught by the suite. |
| Reports read as repository content | Reports are moved outside the checkout (found by the local run: M3-I19's path scan saw an in-tree report). |

## 36. Final performance assessment

Identical assertion inventory (machine-proved: 223 legacy items represented), 280/280 controls unchanged (180 negative,
100 mutation), control guard runs −44 % and control time −43 % locally, zero named-step re-runs, one production build,
both local Playwright flakes fixed at their root cause (45/45 on GitHub without new retries). Measured on GitHub: critical
path 2,038 s (≈ 34 min, #219) → 424 s (7 m 04 s, #222 / #223), ≈ 4.8× faster; runner time 3,629 s → 2,042–2,065 s,
≈ 44 % less, before the legacy workflows are removed. Three new-graph runs agree within 30 s of wall clock; the old graph
varied by 1,143 s on identical code.
