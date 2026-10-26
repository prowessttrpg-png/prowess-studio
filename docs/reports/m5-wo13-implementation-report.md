# M5-WO13 — Active Magic Runtime (Sustain, Mana Lock, Concentration, Channeling & Active Effects) — local implementation report

Status: LOCAL IMPLEMENTATION AND LOCAL VERIFICATION ONLY. Nothing is published; no pull request is opened; no further
milestone is started. Local success is not publication authorization and not FINAL PASS.

## Baseline, authority and files

1. **Actual baseline SHA:** `feed5df72187f4c2c7a896d8dc2a6338ad96ac1a` — `Merge pull request #53 from prowessttrpg-png/m5-wo12`. This environment cannot fetch from GitHub (403), so the merge commit was reconstructed byte-for-byte from the GitHub API's signed commit payload (its hash verifies as `feed5df…`; tree `8ed9bfd…` equals the WO12 head tree). Merged-main CI at this SHA was verified green on GitHub: Prowess Studio CI #213 plus M5-WO7 / WO8 / WO9 / WO10 / WO11 / WO12 workflows (7 / 7 check runs successful).
2. **Branch:** local `m5-wo13` from that baseline; one local commit (SHA in the delivery message). Working tree clean before starting.
3. **Source authority:** explicit designer rulings (the M5-WO13 work order) → CanonDecisions (none relevant) → Core Playtest Packet V0.1 MAGIC section (read from the user's connected copy: MANA EFFICIENCY, MANA LOCK and its example, SPELL AP COST, CHANNELING SPELLS, DURATION, INSTANT / TIMED / SUSTAINED SPELLS, Sustain Formula, Permanent Sustain Condition, CONCENTRATION, Capacity, Save, DC table, When to Roll, Failure) → permanent M5-WO1–WO12 mechanics. Older Chapter statements are superseded provenance only.
4. **Files created (16):** `packages/prowess-game/src/ability/active-magic.ts`; `definition/active-magic-policy.ts`; `content/core-playtest-v0.1/active-magic.ts`; `testing/active-magic-fixtures.ts`; `active-magic-golden.test.ts`; `active-magic-contracts.test.ts`; `packages/prowess-db/tests/unit/m5-wo13-inspector-fixture.test.ts`; `packages/prowess-db/tests/integration/prowess-active-magic-history.test.ts`; `apps/studio/tests/unit/m5-wo13-static.test.ts`; `apps/studio/tests/integration/m5-wo13-active-magic-api.test.ts`; `apps/studio/tests/integration/fixtures/m5-wo13-active-magic-traces.json`; `docs/architecture/m5-active-magic-runtime.md`; `docs/architecture/m5-wo13-baseline.json`; `docs/reports/m5-wo13-implementation-report.md`; `scripts/m5-wo13-negative-controls.mjs`; `.github/workflows/m5-wo13.yml`.
5. **Files modified (11):** `packages/prowess-game/src/index.ts` (exports); `definition/ability-construction-payload.ts` (optional `activeMagicPolicy`); `testing/effect-execution-fixtures.ts` (optional extra Effects and Spell Duration — absent options leave every WO12 fixture identity unchanged; the WO12 Inspector fixture still regenerates identically); `docs/architecture/m5-invariants.json` / `.md` (M5-I316–I337); `docs/architecture/m5-core-playtest-source-conflicts.md` (SC-052 / 053 / 054); `apps/studio/tests/unit/m5-wo1-static.test.ts`, `m5-wo2-static.test.ts` (WO13 module and content delegated to the WO13 gate, with comments); `m5-wo9-static.test.ts`, `m5-wo12-static.test.ts` (invariant counts annotated for the append); `.github/workflows/ci.yml` (WO13 gate after WO12).
6. **Files removed:** none.
7. **DB / migration status:** no Prisma schema, migration, generated client or persistence change; active-magic state is transient caller-held data. The static gate re-hashes the frozen M4 sources, schema, migrations and API routes against `m5-wo13-baseline.json`. No data-model blocker and no M4 foundation change request.
8. **Architecture reused:** WO12 `executeAbilityResolution` (persistent outcomes); WO10 `evaluateSpellCost` (Final Spell MP / AP, PRO); WO9 Duration Definitions (`futureRuntime`); WO3 `compileRuntime` / `buildRuntimeContexts` / `readRuntimeRun` (AP SPEND, ME-eligible MAGICAL_PAYMENT, RESERVE / RELEASE_CAPACITY); WO2 `compileCoreResolution` (Prowess SAVING_THROW); M4 FORMULA, Resource engine and orchestration; the existing `POST /api/rules/evaluate`.

## Active Effect lifecycle

9. **Active Effect contract:** identity, caster, exact Spell and policy refs, Ruleset, WO12 execution key, pinned persistent outcomes, Duration Definition / concept / remaining rounds / dismissal, Sustain (Final MP, PRO, Sustain MP, Sustain AP, ME eligibility, last payment), Concentration requirement, Mana Lock, ticks, activation round, status, end reason, ended-by, source map (docs §3).
10. **Lifecycle states:** ACTIVE, PENDING_MAINTENANCE, PENDING_CONCENTRATION, ENDING (transient), ENDED; never inferred from missing fields; ended Effects keep their provenance.
11. **Duration handling:** the exact WO9 concept and `futureRuntime` decide everything; INSTANT (or non-persisting) creates no state; only outcomes with operations other than NO_EFFECT persist; Permanent stays deferred (SC-045); Maneuvers refused (SPELL_ONLY).
12. **Rounds expiration:** `remainingRounds` from the authored `rounds` parameter; 3 → 2 → 1 → 0 at explicit ROUND_END; 0 → ENDED / EXPIRED.
13. **Combat expiration:** only an explicit BOUNDARY COMBAT_END ends COMBAT Effects (COMBAT_ENDED); round ends never do.
14. **Scene expiration:** BOUNDARY SCENE_END → SCENE_ENDED, SCENE Effects only.
15. **Mission expiration:** BOUNDARY MISSION_END → MISSION_ENDED, MISSION Effects only.
16. **Timed dismissal:** NOT_DISMISSIBLE by default (policy per Duration); refused, state unchanged.
17. **Sustained dismissal:** FREE_ACTION: ENDED / DISMISSED, slot (and any linked lock) released, no AP spent.

## Sustain

18. **Sustain formula:** M4 `max(1, floor(final_mp / pro))` over WO10's Final MP (17 / 4 → 4; 18 / 4 → 4; 4 / 5 → 1); re-executed on every transition so an arbitrary held amount is refused.
19. **Sustain AP:** policy `sustainApPerRound` 1, spent through WO3 SPEND per Effect per MAINTENANCE.
20. **ME interaction:** WO3 ME-eligible MAGICAL_PAYMENT: ME first (5 vs ME 3 → 3 ME + 2 MP; 4 vs ME 5 → 4 ME, ME 1 left); the Sustain Cost is never reduced. WO13 never refreshes ME (WO3 START_OF_ROUND does).
21. **MP fallback:** the remainder is paid from MP by the same WO3 payment.
22. **Payment atomicity:** each upkeep is staged and adopted only if AP and mana are both legal; failure restores the staged Resources exactly — no partial mutation, no negative value (5 MP + 1 AP vs ME 1 / MP 2 / AP 3 → nothing spent, ENDED / SUSTAIN_UNPAID).
23. **Multiple Sustain effects:** each pays its own upkeep in stable identity order when all are affordable; no shared or free maintenance.
24. **Maintenance selection:** some-but-not-all affordable → PENDING_MAINTENANCE_SELECTION with the exact legal identities, no mutation; the controller's ordered selection is paid all-or-nothing; unselected Effects end SUSTAIN_UNPAID; the engine never chooses.

## Mana Lock

25. **Mana Lock architecture:** WO3 RESERVE_CAPACITY / RELEASE_CAPACITY on MP; nothing spent, current MP untouched; M4's permanent "current may remain above available maximum" contract is reused (no clamp invented).
26. **Lock amount authority:** only an exact policy rule (`FINAL_SPELL_MP` or `FIXED`); the canonical policy has none → activation fails closed (M5-SC-052). Test fixtures pin explicit TEST rules.
27. **Multiple locks:** stack per Active Effect (Max 50: 10 + 15 → available 25; A ends → 35).
28. **Current / Maximum MP behaviour:** Max 40 / current 40, lock 12 → available 28, current 40; base Maximum MP never overwritten.
29. **Capacity release:** any end reason releases exactly that Effect's reservation; current MP does not refill (16 stays 16, available 28 → 40).

## Concentration and Channeling

30. **Concentration capacity:** M4 `1 + floor(RES / 2)` (RES 1 → 1, 2 → 2, 3 → 2, 4 → 3, 5 → 3, 6 → 4); over-capacity starts are refused, nothing auto-terminated; the stat-table "+1 per 3 RES" discrepancy recorded as M5-SC-054 and resolved by the work-order ruling.
31. **Concentration DC:** M4 `8 + 2 × max(0, consumers − 1)` counting the disrupted consumer (1 → 8 … 4 → 14).
32. **Concentration Save:** WO2 Prowess SAVING_THROW from an explicit roll; no roll → PENDING_INPUT; success booleans and impossible rolls refused.
33. **Interruption triggers:** structured TAKES_DAMAGE, GRAPPLED, RESTRAINED, KNOCKED_PRONE, FORCIBLY_MOVED, STUNNED, DAZED, FAILED_RELEVANT_SAVE, MAGICAL_DISRUPTION, MULTIPLE_UNSTABLE_EFFECTS, and the GM's CONCENTRATION_TEST_REQUIRED; prose refused.
34. **Failure scope:** default DISRUPTED_EFFECT — only that Effect ends (CONCENTRATION_FAILED) with its own lock / slot.
35. **Global concentration break:** only the explicit `failureScope: ALL` ends every consumer (and fails a Channel).
36. **Channel state:** Spell ref, WO10 Final AP, invested AP, this round's AP, Concentration slot, MP payment UNRESOLVED (M5-SC-053), status; Ruleset-pinned.
37. **AP accumulation:** WO3 AP SPEND per CHANNEL_INVEST (1 … remaining); overpayment refused; a round ending with no progress abandons the Channel.
38. **Interruption:** a failed Save fails the Spell, loses all progress (restart 0 / 6), refunds nothing; a passed Save keeps progress.
39. **One-channel limit:** a second CHANNEL_START is refused (CHANNEL_LIMIT).
40. **Completion:** reaching the Final AP completes immediately (3 + 2 = 5): Channel removed, slot released, `readyToResolve: true`; no MP paid (SC-053).
41. **Active Effect tick architecture:** structured outcome `timing` → ACTIVE_EFFECT_TICK_DUE on the matching TIMING event; nothing applied; no canonical Effect carries a timing yet.
42. **Summon integration:** summons follow their exact Duration metadata (Sustained → Sustain + Concentration; Timed → neither); no summon runtime or active-summon cap built.

## Provenance, history and safety

43. **Rules Inspector:** Concentration capacity / used / DC; MP reserved / available maximum / current; per Effect source Spell, Ruleset, Duration, remaining rounds, Sustain (MP, AP, payment source), Concentration, Mana Lock, lifecycle; Channel tree (Spell, required / invested / remaining AP, slot, status).
44. **Source maps:** every resource change names the Active Effect / Channel, rule, resource, operation, amount, before / after, reservation and available maximum, Ruleset and WO3 subject; `formulaEvaluations`, `runtimeEvaluations` and the Save's core plan carry every M4 plan and context.
45. **Exact Ruleset:** state, Effects and Channel pin Ruleset, Ability, Duration and policy versions; another Ruleset or policy is refused; nothing is recompiled.
46. **Historical reproducibility:** R1 Sustain AP 1 kept after R2's policy says 2 (pure and over real stored Releases); R1 transitions replay identically on a re-materialized R1.
47. **Determinism:** no RNG, no clock, no global registry; equal requests give deep-equal results.
48. **Serialization:** JSON-safe state and traces; the Inspector fixture regenerates byte-identically.
49. **Security:** getters, functions, cycles, `__proto__`, unknown fields, forged identities / casters / amounts / statuses, negative amounts, prose triggers and success booleans are refused.
50. **SC-042:** unchanged, UNRESOLVED.
51. **SC-046:** unchanged, UNRESOLVED.
52. **SC-047:** unchanged, UNRESOLVED.
53. **SC-048:** unchanged, UNRESOLVED (still fails closed as WO11 left it).
54. **SC-049:** unchanged, UNRESOLVED.
55. **SC-050:** unchanged, UNRESOLVED.
56. **SC-051:** unchanged, UNRESOLVED.
57. **SC-052 (created):** Generic Mana Lock amount has no exact structured formula — UNRESOLVED, fails closed.
58. **SC-053 (created):** Standard Spell MP payment timing during Channeling is not structurally defined — UNRESOLVED; no MP paid.
59. **Invariant additions:** M5-I316–M5-I337 (group "Active Magic Runtime"), each guarded by executing tests that cite it plus the static gate and mutation controls; M5-I001–I315 unchanged. Also M5-SC-054 recorded (RESOLVED_BY_DESIGNER).

## Verification

60. **Golden fixtures:** `active-magic-golden.test.ts` — 35 passed.
61. **Unit tests:** `active-magic-contracts.test.ts` — 22 passed; static gate 34 passed (17 forbidden-snippet detections included); Inspector fixture 1. Repository unit totals (`pnpm -r test:unit`): 5,170 passed — model 513, ui 21, import 128, rules 659, game 910, db 96, Studio 2,843.
62. **Integration tests:** `prowess-active-magic-history.test.ts` (1) and `m5-wo13-active-magic-api.test.ts` (7) passed against a real PostgreSQL `prowess_studio_test`.
63. **Negative controls (50 categories):** each maps to an executing guard — Instant / Timed / Sustained lifecycle (goldens), Sustain formula / rounding / minimum / AP / ME-first / ME-not-discount / atomicity / unpaid / selection (goldens + contracts), Mana Lock spend / refund / base-max / client amount / release / unresolved amount (goldens + contracts), capacity stat / rounding, Save engine, DC base / +2 / disrupted counting, failure scope / severe break, Concentration-as-Condition (static), Channel limit / AP spending / zero-AP round / immediate completion / lost progress / no refund (goldens + contracts), wall clock / Combat by rounds / guessed boundaries (goldens + static), latest / cross-Ruleset (contracts + DB history + static), negative AP / ME / MP / Max MP (contracts + WO3), WO10 / WO12 duplication, Damage / Condition application, freeform timing, success booleans (static + contracts), unresolved conflicts (static register).
64. **Mutation controls:** `scripts/m5-wo13-negative-controls.mjs` — all **30** caught and reverted (Sustain minimum removed; normal rounding; pre-WO10 MP; MP before ME; Sustain AP omitted; unpaid Sustain kept active; partial mutation on failed upkeep; engine auto-chooses survivors; Timed Sustain; Timed Concentration; universal Timed dismissal; Instant retained; Mana Lock spends current MP; lock end refunds MP; lock not released; capacity removed; slots from PRO; DC progression altered; disrupted Effect removed before the DC; every failure breaks all; Channeling ignores Concentration; two Channels; Channel progress kept after failure; zero-AP round continues; delayed completion; negative investment; wall-clock expiry; latest lookup; held Sustain trusted; cross-Ruleset accepted). Each mutates real source, requires a behavioural guard failure, restores byte-for-byte and re-runs green; the working-tree hash was identical before and after. One control first failed as "infrastructure" because its guard threw a TypeError instead of an assertion; the golden was hardened (`channelResult?.status`) and all 30 re-ran green.
65. **Architecture audit:** `m5-wo13-static.test.ts` 34/34; root architecture check passed (12 import-boundary rules, 8 packages, no cycles); M4 sources, Prisma schema / migrations and the API route inventory hash-identical to the WO13 baseline; every WO1–WO12 static gate green.
66. **M4 regression:** M4 final controls 3 / 3 caught; all M4 gates inside the unit / integration suites green.
67. **WO1 regression:** static gate green; 17 / 17 controls caught.
68. **WO2 regression:** static gate green; 18 / 18 controls caught.
69. **WO3 regression:** static gate green; 21 / 21 controls caught.
70. **WO4 regression:** static gate green; 34 / 34 controls caught.
71. **WO5 regression:** static gate green; 29 / 29 controls caught.
72. **WO6 regression:** static gate green; 16 / 16 controls caught.
73. **WO7 regression:** static gate green; 22 / 22 controls caught.
74. **WO8 regression:** static gate green; 8 / 8 controls caught.
75. **WO9 regression:** static gate green (invariant count annotated 337); 12 / 12 controls caught.
76. **WO10 regression:** static gate green; 18 / 18 controls caught.
77. **WO11 regression:** static gate green; 26 / 26 controls caught.
78. **WO12 regression:** static gate green (sequence check scoped to M5-I001–I315); 26 / 26 controls caught; WO12 Inspector fixture regenerates identically.
79. **Lint:** `pnpm -r lint` passed (max-warnings 0).
80. **Typechecks:** `pnpm -r typecheck` passed for every package and Studio.
81. **Production build:** `pnpm -r build` passed (Next production build completed).
82. **Prisma validation:** not runnable here — the engine download from `binaries.prisma.sh` returns 403. No schema / migration file changed (hash-guarded).
83. **Prisma generation:** not runnable here (same reason).
84. **Prisma drift:** unverified locally (same reason); must report "No differences" in permanent CI.
85. **DB integration:** full `@prowess/db` integration suite: 513 of 523 passed, including the new WO13 history test. The 10 failures are exclusively the Prisma migration-ledger assertions (M1 audit, M2-WO1–WO8, M3-WO1) that read `_prisma_migrations`, absent because the schema is applied with `psql`; no ledger rows were fabricated.
86. **API integration:** full Studio integration suite: 165 tests passed (WO13 API traces A–F: 7 tests, every table fingerprint unchanged).
87. **Playwright:** **45 / 45** on a freshly rebuilt test database. The run inside the verification script (database left populated by the DB / API suites) and one earlier fresh run each had one unrelated M1 UI timing / layout failure (compendium pagination; version-history narrow-width stacking), a known local flake pattern; WO13 changes no UI code.
88. **Environment limitations:** pushes, fetches and the GitHub API are refused from this environment (earlier publications went through a git bundle the user pushed; the baseline merge commit was reconstructed from its signed payload); Prisma engines cannot be downloaded; the test DB is built with `psql` from the committed `migration.sql` files, so the 10 Prisma migration-ledger assertions cannot pass locally. No mock or fabricated pass is used.
89. **GitHub verification pending:** after separate authorization — publish `m5-wo13`, open a draft PR, verify Prisma validate / generate / drift ("No differences"), package / game / Studio tests, DB / API integration, M4, WO1–WO12, the new `M5-WO13 audit — Active Magic Runtime` step and `m5-wo13.yml`, build and Playwright; then (separately authorized) merge and merged-main CI.
90. **Acceptance criteria status:** every acceptance criterion is implemented and locally verified. Pending permanent infrastructure: Prisma validate / generate / drift, the 10 migration-ledger assertions, GitHub CI. Local success is not publication authorization and not FINAL PASS.
