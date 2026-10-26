# M5-WO12 — Effect Chain Execution & Runtime Resolution Routing — local implementation report

Status: LOCAL IMPLEMENTATION AND LOCAL VERIFICATION ONLY. Nothing is published; no pull request is opened; M5-WO13 is not
started. Local success is not publication authorization.

## Baseline, authority and files

1. **Actual baseline SHA:** `799996b4700cdcf32c53ed75977581b63fa5c793` — `Merge pull request #52 from prowessttrpg-png/m5-wo11` (merged-main CI #211 seen green on GitHub).
2. **Branch:** local `m5-wo12` from that baseline; one local commit (SHA in the delivery message).
3. **Source authority:** designer rulings → CanonDecisions (none relevant) → Core Playtest Packet V0.1 ("EFFECT CHAINS" s639–s642; Maneuvers §5 "Save Restriction by Martial Rank"; Projectile delivery) → permanent M5-WO1–WO11 mechanics.
4. **Designer ruling applied:** M5-SC-014 — an Effect with no listed Chain Behavior: failure ends the chain (pinned as `defaultChainBehavior: SUCCESS_ONLY`). M5-SC-042 / 046 / 047 / 048 untouched and still UNRESOLVED.
5. **Files created (17):** `packages/prowess-game/src/ability/effect-execution.ts`; `definition/effect-chain-payload.ts`; `definition/effect-execution-policy.ts`; `content/core-playtest-v0.1/effect-execution.ts`; `testing/effect-execution-fixtures.ts`; `effect-execution-golden.test.ts`; `effect-execution-contracts.test.ts`; `packages/prowess-db/tests/unit/m5-wo12-inspector-fixture.test.ts`; `packages/prowess-db/tests/integration/prowess-effect-execution-history.test.ts`; `apps/studio/tests/unit/m5-wo12-static.test.ts`; `apps/studio/tests/integration/m5-wo12-effect-execution-api.test.ts`; `apps/studio/tests/integration/fixtures/m5-wo12-effect-execution-traces.json`; `docs/architecture/m5-effect-chain-execution.md`; `docs/architecture/m5-wo12-baseline.json`; `docs/reports/m5-wo12-implementation-report.md`; `scripts/m5-wo12-negative-controls.mjs`; `.github/workflows/m5-wo12.yml`.
6. **Files modified (11):** `packages/prowess-game/src/index.ts` (exports); `definition/authored-ability-payload.ts` (Spell `effectChain` validated by `readEffectChain`); `definition/ability-construction-payload.ts` (optional `effectExecutionPolicy`); `docs/architecture/m5-invariants.json` / `.md` (M5-I294–I315); `docs/architecture/m5-core-playtest-source-conflicts.md` (SC-014 application; SC-049 / 050 / 051); `apps/studio/tests/unit/m5-wo1-static.test.ts`, `m5-wo2-static.test.ts` (WO12 module delegated to its own gate, with comments); `m5-wo9-static.test.ts`, `m5-wo11-static.test.ts` (invariant counts annotated for WO12's append); `.github/workflows/ci.yml` (WO12 gate after WO11).
7. **Files removed:** none.
8. **DB / migrations:** no Prisma schema, migration, generated client or persistence change; the static gate re-hashes the frozen M4 sources, schema, migrations and API routes against `m5-wo12-baseline.json`.
9. **Architecture reused:** WO8 `compileAbilityDefinition` / `readAbilityDefinitionRun` (with WO5–WO9 inside it); WO2 `compileCoreResolution` / `buildCoreResolutionContexts`; WO6 Projectile delivery; WO7 Effect resolution, Save Profiles and outcomes; WO11 Maneuver resolution-group structure; M4 REQUIREMENT / FORMULA / MODIFIER and orchestration; the existing `POST /api/rules/evaluate`.

## Execution architecture

10. **Two stages:** `compileAbilityExecution(request)` compiles and evaluates the exact authored Ability (must be VALID) and builds the execution plan; `executeAbilityResolution(request + execution)` recompiles (a caller plan is never trusted) and executes against explicit runtime inputs.
11. **Execution key:** `rulesetId:manifestId:abilityEntityVersionId:subjectKey`; every input must carry it.
12. **Policy:** `effectExecutionPolicy` lives in the Ruleset's versioned `ABILITY_CONSTRUCTION_RULE` (default chain behavior, Martial skill key, Martial Save control map, authority list). Missing policy → `PROWESS_EXECUTION.MISSING_POLICY`; nothing is assumed.
13. **Authored chain contract:** Spell `composition.branch.effectChain = { failurePolicy, nodes? }`; nodes name exact Effect Uses (componentKey), once each.
14. **Behavior source:** each node records `AUTHORED`, `CHAIN_FAILURE_POLICY` (STOP → SUCCESS_ONLY, CONTINUE → CONTINUE) or `RULED_DEFAULT` (M5-SC-014).
15. **Spell chain nodes:** exact Effect Use, Definition, order, resolution, route (OWN / DELIVERY_ATTACK), Save flow, behavior, branch, trigger, successor (next non-destination node), branch-destination flag, outcomes, parameters, Formula values.
16. **Maneuver groups:** each Attack Use, each Powerful Blow and each non-attack action is one group with ONE resolution (ATTACK_ROLL, replacing SAVING_THROW, or NONE) and its attached Effects; groups match WO11's `resolutionGroups` exactly (contract test over six WO11 Maneuvers).
17. **Runtime request keys:** `wo12.<subject>.<target>.<scope>.<kind>`, scope `delivery` / `effect.<effectKey>` / `group.<groupKey>`.
18. **Input kinds:** ATTACK_ROLL `{roller, roll, targetDodge}`, SAVING_THROW `{roller, roll, difficultyClass}`, SAVE_REMOVAL / SAVE_SELECTION `{stat}`; unknown fields refused.
19. **No result claims:** a `success` field is not an input; every hit / miss / critical / Save result is M4's WO2 core resolution of the explicit roll.
20. **No RNG:** WO12 never rolls; a missing input yields `PENDING_INPUT` with a stable request (kind, target, scope, asking party, legal options, Definitions).
21. **Deterministic resume:** supplying the pending inputs and re-executing equals a complete-input run.
22. **Input binding:** inputs for another plan, target, Effect, group or kind are refused (`UNKNOWN_INPUT`); a valid input for an unreached request is reported in `unusedInputs`.
23. **Targets:** explicit, ordered, unique, within the exact Targeting limit; Maneuvers additionally take explicit `groupTargets` per group (per-group limit 1 unless an attached Effect converts targeting).

## Chain behavior

24. **CONTINUE:** next node regardless of result.
25. **SUCCESS_ONLY:** failure terminates (`SUCCESS_ONLY_FAILURE`).
26. **FAILURE_ONLY:** success terminates (`FAILURE_ONLY_SUCCESS`).
27. **STOP:** terminates after the current outcome (`STOP`).
28. **BRANCH:** exactly one destination by result; destinations are skipped by sequential traversal, so the other path never runs (`BRANCH_END`).
29. **Branch validation:** destinations exist, come later in authored order, differ, and are owned by one branch only; display names and dangling keys are refused.
30. **Acyclic:** forward-only destinations; a visited-node guard reports `INVALID_RUNTIME_PATH`.
31. **Triggers:** structured M4 REQUIREMENT (NUMERIC_COMPARE / SET_CONTAINS / ALL / ANY / NONE) over `chain.<earlier>.success|failure`, `chain.previous.*`, `delivery.hit|critical`, `target.*`; prose and unknown / later facts are refused.
32. **NOT_TRIGGERED:** a false trigger emits no outcome and is neither success nor failure; traversal continues (Trigger > Position).
33. **Target facts:** a missing `target.*` fact is a `TARGET_FACT` pending request.
34. **Terminations:** END_OF_CHAIN, STOP, SUCCESS_ONLY_FAILURE, FAILURE_ONLY_SUCCESS, DELIVERY_FAILED, BRANCH_END, NO_REACHABLE_EFFECT, INVALID_RUNTIME_PATH.

## Resolution routing

35. **Normalization:** ATTACK_ROLL hit → SUCCESS, miss → FAILURE; SAVING_THROW target fails → SUCCESS, target succeeds → FAILURE; AUTOMATIC → SUCCESS (the authored Ability evaluated VALID).
36. **Trait RESOLUTION modifications:** honoured from the compiled Effect plan.
37. **Trait TRIGGER modifications:** fail closed (M5-SC-049).
38. **Save flows:** one Save or FIXED → that Save; TARGET_CHOICE → defender chooses; Maneuver MARTIAL_CONTROL → policy by Martial rank; anything else → M5-SC-050.
39. **Multi-target isolation:** per-target cursor, chain-local facts, delivery, visited set and termination.
40. **Projectile delivery:** resolved first per target as an Attack request at scope `delivery`.
41. **Delivery reuse:** an ATTACK_ROLL Effect with `deliveryInteraction: SAME_ATTACK_ROLL` resolves from the delivery roll — no second request.
42. **Delivery miss:** any non-delivery Effect becomes NOT_DELIVERED and the target terminates `DELIVERY_FAILED` — no Save requested, no Automatic Effect applied.
43. **Powerful Blow:** one Attack request per target; attached Effects execute once.
44. **Separate Attacks:** one request per Attack group; each group may target differently.
45. **Inherited resolution:** INHERIT_ABILITY / FOUNDATION_ATTACK Effects resolve from the group with no extra request.
46. **Save replacement:** an OWN Martial Save Effect replaces its group's Attack Roll (no Attack request, no critical); more than one replacing Effect → M5-SC-051.
47. **Automatic on an Attack group:** no authored hit dependency → M5-SC-051 (fail closed).
48. **Critical scoping:** critical comes from the resolving Attack only and reaches only that group's Effects (or the Spell Effect whose roll it was); no Critical Upgrade is synthesized.
49. **Martial TRAINED:** the defender chooses from the full profile.
50. **Martial EXPERT:** the attacker removes one, then the defender chooses from the rest (or the last Save stands).
51. **Martial MASTER:** the attacker chooses.
52. **No engine choice:** an unanswered choice stays PENDING_INPUT; options outside the legal set are refused.

## Outcomes, history and safety

53. **Outcome records:** ordered; target, Effect Use, group, Definition, result, outcome key, exact authored operations (inert; `NO_EFFECT` valid), authored flag, critical, parameters, Formula values, resolving request, Ruleset provenance.
54. **State boundary:** no HP / Armor / Resistance / position / Status Condition / AP / MP / ME / inventory / summon / terrain / zone change; DB and API fingerprints unchanged.
55. **Inspector traces:** per-target node statuses, triggers, transitions and termination; per-group resolution and Effect statuses; every M4 core plan + contexts and trigger plan recorded.
56. **Exact Ruleset:** plan, policy and inputs pinned to the materialized Ruleset; mixed bundles refused.
57. **History:** R1 SUCCESS_ONLY Spell keeps R1 routing after R2 changes it to CONTINUE (pure contract and real stored Releases).
58. **Determinism / immutability:** deep-equal results; inputs untouched; outputs cloned and deep-frozen; JSON-safe.
59. **Safety:** getters, functions, cycles, `__proto__`, unknown fields and forged keys refused.
60. **Unresolved conflicts preserved:** M5-SC-042, M5-SC-046, M5-SC-047, M5-SC-048 unchanged (SC-048 still fails closed exactly as WO11 left it).
61. **New conflicts (fail closed):** M5-SC-049 Trait TRIGGER semantics; M5-SC-050 Save selection without an executable runtime choice; M5-SC-051 unrouted Maneuver resolution combinations.
62. **Invariants:** M5-I294–M5-I315 appended (group "Effect Chain Execution"); M5-I001–I293 unchanged.
63. **WO13 boundary:** no Sustain, Mana Lock, Concentration, Active Effect capacity, maintenance, expiry, Metamagic or chain rewriting.
64. **Performance note:** execution evaluates the compiled authored plan once on M4 (no second WO8 compile).

## Verification

65. **Golden tests:** `effect-execution-golden.test.ts` — 24 passed.
66. **Contract tests:** `effect-execution-contracts.test.ts` — 34 passed.
67. **Static gate:** `m5-wo12-static.test.ts` — 39 passed (19 forbidden-snippet detections included).
68. **Inspector fixture:** `m5-wo12-inspector-fixture.test.ts` — 1 passed (traces A–H regenerate identically).
69. **DB history:** `prowess-effect-execution-history.test.ts` — 1 passed against real PostgreSQL `prowess_studio_test`.
70. **API:** `m5-wo12-effect-execution-api.test.ts` — 9 passed; every core and trigger plan replayed through `POST /api/rules/evaluate`, table fingerprints unchanged.
71. **WO12 totals:** 108 WO12 tests passed (24 golden + 34 contract + 39 static + 1 Inspector fixture + 1 DB history + 9 API).
72. **Negative-control categories (52):** every category maps to an executing guard — chain behaviors (5 goldens), ruled default, branch exclusivity / destinations / cycles / display names (contracts), triggers and NOT_TRIGGERED (goldens + contracts), target facts, normalization (goldens), RNG / success claims / foreign inputs / unknown fields / illegal choices / unused inputs (contracts), multi-target isolation, Projectile reuse / miss (goldens), Powerful Blow / separate Attacks / inherited / Save replacement / support (goldens), WO11 structure match (contract), critical scope (golden), Martial control (goldens), SC-049 / SC-050 / missing policy / INVALID Ability (contracts), state mutation (contracts, DB / API fingerprints, static), latest / cross-Ruleset / history (contracts, DB history, static), immutability / determinism / safety (contracts), WO13 scope (static).
73. **Mutation controls:** `scripts/m5-wo12-negative-controls.mjs` — all **26** caught and reverted: STOP removed; SUCCESS_ONLY inverted; FAILURE_ONLY inverted; both BRANCH paths executed; ruled default ignored; triggers ignored; NOT_TRIGGERED treated as FAILURE; targets share one cursor; Projectile second Attack roll; Save after a delivery miss; caller success boolean trusted; Save normalization inverted; foreign-plan input accepted; internal RNG; HP mutation; Condition instance creation; latest lookup; separate Attacks collapsed; Powerful Blow split; Effects broadcast to every group; critical broadcast; inherited Effect detached; Save replacement ignored; Martial EXPERT bypassed; Martial MASTER bypassed; cyclic chain accepted. Each mutates real source, requires a behavioural guard failure, restores byte-for-byte and re-runs green.
74. **Earlier mutation controls:** all permanent controls re-run serially and green — M4 final 3, M5-WO1 17, WO2 18, WO3 21, WO4 34, WO5 29, WO6 16, WO7 22, WO8 8, WO9 12, WO10 18, WO11 26 (224); with WO12, 250 controls. The working tree hash (status + sha256 of every changed file) was identical before and after all controls.
75. **Architecture audit:** `m5-wo12-static.test.ts` 39/39; root architecture check passed (12 import-boundary rules, 8 packages, no cycles); M4 sources, Prisma schema / migrations and the API route inventory hash-identical to the WO12 baseline; WO1–WO11 static gates green.
76. **Unit totals:** `pnpm -r test:unit` 5,070 passed — model 513, ui 21, import 128, rules 659, game 853, db 95, Studio 2,801.
77. **Lint:** `pnpm -r lint` passed (max-warnings 0).
78. **Typechecks:** `pnpm -r typecheck` passed for every package and Studio.
79. **Production build:** `pnpm -r build` passed (Next production build completed).
80. **Prisma validate / generate:** not runnable here — the engine download from `binaries.prisma.sh` returns 403. No schema / migration file changed (hash-guarded).
81. **Prisma drift:** unverified locally (same reason); must report "No differences" in permanent CI.
82. **DB integration:** full `@prowess/db` integration suite: 512 of 522 passed, including the new WO12 history test. The 10 failures are exclusively the Prisma migration-ledger assertions (M1 audit, M2-WO1–WO8, M3-WO1) that read `_prisma_migrations`, absent because the schema is applied with `psql`; no ledger rows were fabricated.
83. **API integration:** full Studio integration suite: 28 files, 158 tests passed (WO12 API: 9 tests, every table fingerprint unchanged).
84. **Playwright:** repository-standard Playwright run **45/45** passed; WO12 changes no UI code.
85. **Environment limitations:** pushes and the GitHub API are refused from this environment (earlier publications went through a git bundle pushed by the user); Prisma engines cannot be downloaded; the test DB is built with `psql` from the committed `migration.sql` files, so the 10 Prisma migration-ledger assertions cannot pass locally. No mock or fabricated pass is used.
86. **Acceptance:** implementation and every locally supported verification complete. Pending permanent infrastructure: Prisma validate / generate / drift, the 10 migration-ledger assertions, GitHub CI (permanent `ci.yml` incl. the new `M5-WO12 audit — Effect Chain Execution & Runtime Routing` step, and `m5-wo12.yml`). Publication requires separate explicit authorization; M5-WO13 not started.
