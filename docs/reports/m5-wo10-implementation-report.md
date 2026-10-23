# M5-WO10 — Final Spell Cost, Percentage Netting & AP Derivation — local implementation report

Status: LOCAL IMPLEMENTATION VERIFIED WITH ENVIRONMENT LIMITATIONS — READY FOR PUBLICATION REVIEW — NOT FINAL PASS.
Publication (push to `m5-wo10`, pull request, permanent CI, merge) is NOT authorized by the Work Order and has not occurred.
M5-WO11 has not been started.

## Baseline, authority and file manifest

1. **Actual baseline SHA:** `d5c0f6c61a5e26b59248cccebde7ad2fa4e0b839` — `Merge pull request #50 from prowessttrpg-png/m5-wo9` (verified current `origin/main` after WO9).
2. **Branch:** local `m5-wo10`, created from the baseline. One local commit; its SHA is reported in the delivery message.
3. **Source authority:** (1) designer rulings; (2) CanonDecisions (none relevant to final cost); (3) Core Playtest V0.1 — s645 TOTAL MP FORMULA and s650 Spell AP ("round down, minimum 1"); (4) permanent M5-WO1–WO9 structured mechanics. Older Chapter Book material is not promoted.
4. **Designer rulings applied:** M5-SC-028 (all percentage modifiers combine into ONE net percentage, applied once, final MP rounded normally once — now applied, recorded in the register); M5-SC-021 (flat 30% Casting Condition cap, consumed through WO9's effective value); M5-SC-042 left UNRESOLVED.
5. **Files created (15):**

- `.github/workflows/m5-wo10.yml`
- `apps/studio/tests/integration/fixtures/m5-wo10-spell-cost-plans.json` (generated)
- `apps/studio/tests/integration/m5-wo10-spell-cost-api.test.ts`
- `apps/studio/tests/unit/m5-wo10-static.test.ts`
- `docs/architecture/m5-final-spell-cost.md`
- `docs/architecture/m5-wo10-baseline.json`
- `docs/reports/m5-wo10-implementation-report.md`
- `packages/prowess-db/tests/integration/prowess-spell-cost-history.test.ts`
- `packages/prowess-db/tests/unit/m5-wo10-inspector-fixture.test.ts`
- `packages/prowess-game/src/ability/spell-cost.ts`
- `packages/prowess-game/src/content/core-playtest-v0.1/spell-cost.ts`
- `packages/prowess-game/src/spell-cost-contracts.test.ts`
- `packages/prowess-game/src/spell-cost-golden.test.ts`
- `packages/prowess-game/src/testing/spell-cost-fixtures.ts`
- `scripts/m5-wo10-negative-controls.mjs`

6. **Files modified (8):**

- `.github/workflows/ci.yml` — new step `M5-WO10 audit — Final Spell Cost & AP Derivation`, after the WO9 gate; every earlier step retained.
- `apps/studio/tests/unit/m5-wo1-static.test.ts`, `apps/studio/tests/unit/m5-wo2-static.test.ts` — the two WO10 files added to the existing later-milestone delegation sets (same convention WO7–WO9 used: authored Formula content and its compiler are covered by the dedicated WO10 gate); every earlier file stays covered.
- `apps/studio/tests/unit/m5-wo9-static.test.ts` — invariant-count assertion 242 → 260 (only line changed, annotated).
- `docs/architecture/m5-core-playtest-source-conflicts.md` — SC-028 application note; new SC-046, SC-047 (UNRESOLVED).
- `docs/architecture/m5-invariants.json`, `docs/architecture/m5-invariants.md` — appended M5-I243–M5-I260.
- `packages/prowess-game/src/index.ts` — public exports of the WO10 API and policy.

7. **Files removed:** none.
8. **Database / migrations:** no Prisma schema, migration, generated client, table or persistence-service change. WO10 is pure compile/evaluate. The static audit re-hashes the frozen M4 sources, Prisma schema and migrations from the WO9 baseline inventory and fails on any change.
9. **Existing architecture reused:** WO8 canonical authored compiler `compileAbilityDefinition` (which already composes WO5 legality, WO6 Targeting, WO7 Effects, WO8 Traits and WO9 Duration/Conditions); WO4 `compileAffinity` (SPELL_AFFINITY_COST subject) for Strength matching and highest-Weakness selection; WO9 `durationConditions` summary steps (listed contributions, `spellMpPercent.effectiveStep`); WO2 character PRO; M4 FORMULA / MODIFIER / REQUIREMENT / KEYWORD / EXPLANATION and orchestration; the generic `POST /api/rules/evaluate` endpoint and Rules Inspector.

## Final Spell cost behaviour

10. **Compiler architecture:** `compileSpellCost(request)` → plain-data validation → canonical WO8 compile (refused if WO8 refuses) → SPELL only → exact PRO → appends WO10 steps to the authored plan: one FORMULA per contribution, MODIFIER `base_mp`, MODIFIER `net_percent`, FORMULA `unrounded_mp`, REQUIREMENT `non_negative`, FORMULA `final_mp`, FORMULA `base_ap`, MODIFIER `final_ap`, EXPLANATION. `primaryStepKey` = final MP. `readSpellCostRun` reads an executed M4 run back into a typed, deep-frozen result; `evaluateSpellCost` composes both. Step keys `wo10.<spell>.<stage>`.
11. **Targeting:** WO6 `targeting.outputs.cost` — LISTED base, PER_STEP and PER_SELECTION contributions. BASE_DEFERRED and a selected PER_ADDITIONAL_TARGET count fail closed (`UNRESOLVED_CONTRIBUTION`, M5-SC-046: no authored base count).
12. **Effects:** each compiled WO7 Effect plan's `costContributions` with the use's exact selection — FIXED, PER_UNIT (`max(0, units − included) × rate`), PER_SELECTION. Canonical Direct Damage 3 Character Dice × 4 MP + Single Target 3 = 15 MP.
13. **Traits:** each compiled WO8 Trait's `costs`, plus an exact `COST` / `ADD` modification of a selected count (2 stacks → +2 MP). `COST` MULTIPLY / SET have no authored total-Spell-cost meaning and fail closed.
14. **Duration:** WO9 listed-value steps are bound, never recomputed. Durations whose WO9 status is UNLISTED contribute nothing (not priced, not "free" by assumption).
15. **Flat special modifiers:** WO9 Casting Condition MP_REDUCTION is a flat SUBTRACT on the base; AP_REDUCTION / AP_COMMITMENT go to the AP stage. Nothing is priced from prose, names, slot labels or geometry.
16. **Constructed base MP:** one M4 MODIFIER (target `spell.base_mp_cost`) — ADD per MP contribution, SUBTRACT per exact flat reduction; M4 reports each stage's before/after.
17. **Affinity:** `compileAffinity` is called once with the authored composition; its keyword, Strength, Weakness and Weakness-selection steps are included; its net-percentage modifiers (Strength SUBTRACT 10/20/30; Weakness ADD highest selected) are re-hosted verbatim in the Spell net percentage. The WO4 listed-cost step and WO4 net step are excluded, so Affinity is consumed exactly once.
18. **Casting Conditions:** listed contributions are consumed from WO9 only; WO9 validators are not duplicated.
19. **30% cap:** the net percentage SUBTRACTs WO9's `spellMpPercent.effectiveStep` (`min(listed, 30)`). Verbal + Anchored + Limited Use (COMBAT) listed 45% → effective 30% → 20 × 70% = 14 MP. No rank-based 20/30/40% cap exists.
20. **Other percentage modifiers:** Charge's −10% per extra AP arrives through the WO9 effective Condition value. No freeform percentage input exists; Signature / Metamagic / legacy modifiers are not applied (architecture doc §17; M5-SC-047).
21. **Net percentage:** one M4 MODIFIER (target `spell.net_cost_percent`, start 100). The structured operation, not a label, owns the sign.
22. **M5-SC-028:** Strength −20% + Weakness +10% + Verbal −10% → 80% → 20 MP → 16 MP (never 20 × .8 × 1.1 × .9 = 15.84). Sequential application is never compiled; equivalent Condition orderings give identical net, unrounded and final MP.
23. **Unrounded final MP:** FORMULA `base * net / 100`, `rounding: NONE` (13.5, 11.7 are exposed unrounded).
24. **Final MP rounding:** the only rounding FORMULA (role `spell-final-mp-rounding`): `floor(unrounded + 0.5)` — normal rounding, 0.5 up, exact for base × integer percent ÷ 100. 15 × 90% = 13.5 → 14; the legacy example 13 × 0.9 = 11.7 → 12 (not 11). Every other WO10 FORMULA declares `rounding: NONE`.
25. **Final MP output:** `finalMpCost` — the authoritative Spell MP cost for later systems. A REQUIREMENT before rounding fails closed (`NEGATIVE_FINAL_MP`) on a negative unrounded value; there is no clamp and no MP floor.
26. **PRO:** the caster's exact integer PRO (≥ 1) from the WO2 character contract. Missing, zero, fractional or non-numeric PRO → `INVALID_PRO`; never defaulted.
27. **Base AP:** FORMULA `max(1, floor(final_mp / pro))`, bound to the final-MP step only. 17 MP / PRO 4 → 4; 14 MP / PRO 4 → 3 (floor of 3.5, never 4).
28. **AP floor:** final AP MODIFIER ends with MAX 1.
29. **Somatic:** −1 AP after base AP: 17 MP / PRO 4 → 4 → 3 AP; 2 MP / PRO 5 → 1 → stays 1.
30. **Charge:** its −10% per extra AP joins the single net percentage; its +N AP commitment applies after base AP (20 MP → 18 MP; 4 + 1 = 5 AP). No Channeling.
31. **Other AP modifiers:** exact AP contributions of Effects / Traits / Duration, if authored, apply in the same post-base stage in deterministic order.
32. **Final AP:** `finalApCost`, with the full modifier breakdown.
33. **No 3 AP cap:** 36 MP / PRO 5 → 7 AP. The WO9 3 AP cap applies only to Maneuver Condition listed contributions and is untouched.
34. **ME boundary:** no ME input exists (unknown fields refused); ME never reduces cost.
35. **Resource mutation:** no RESOURCE step, no persistence; MP, ME and AP are never spent or reserved. DB/API tests fingerprint every table before and after.
36. **Channeling:** AP above the turn economy is reported as is; nothing is split or accumulated.
37. **Sustain:** not executed.
38. **Mana Lock:** receives a final constructed MP value; reservation/lifecycle is WO13.
39. **Maneuver:** refused with `SPELL_ONLY`; final Maneuver cost is WO11.
40. **Effect Chain:** not executed (WO12).

## Provenance, determinism and safety

41. **Source map:** every WO10 step has an entry naming the authored Spell and each exact contributing Definition (component, policy or Affinity), with deterministic roles (`spell-cost-contribution`, `spell-net-cost-percent`, `spell-final-mp-rounding`, …).
42. **Rules Inspector:** traces A–H (simple, Affinity-aligned, Strength + Weakness, Casting Condition 13.5 → 14, Affinity + Conditions, Somatic, Charge, high-AP) are generated as `m5-wo10-spell-cost-plans.json` and executed through the existing `POST /api/rules/evaluate`; no new endpoint or UI.
43. **Ruleset isolation:** every contribution comes from the exact materialized Ruleset; reading verifies each step's response Ruleset against the plan's provenance; a Spell compiled against another Ruleset's bundle is refused.
44. **Historical reproducibility:** R1 Trait v1 (+2 MP) / R2 Trait v2 (+4 MP); R1 keeps 13 MP after R2 publishes 15 MP, pure and over real stored Release history.
45. **Deduplication:** each contribution is identified by source + component key + contribution key; a repeated identity fails closed (`DUPLICATE_CONTRIBUTION`). The canonical compiler emits unique identities, so this is a structural guard enforced by the static audit rather than a reachable fixture.
46. **Determinism:** equal requests give deep-equal plans, runs and results; plans replay through M4 after a JSON round-trip.
47. **Immutability:** inputs are never mutated; outputs are detached and deep-frozen.
48. **Serialization:** plans and results are JSON-safe; the fixture generator requires byte-identical regeneration.
49. **Security:** getters, functions, symbols, cycles, unsafe keys (`__proto__`), non-plain objects, unknown fields and incomplete or foreign M4 runs are refused.
50. **SC-042:** still UNRESOLVED; a non-empty additional Affinity Trait allocation is still refused by WO8.
51. **Invariants:** M5-I243–M5-I260 appended (group "Final Spell Cost") with executing guards; the first 242 entries are unchanged.
52. **Conflict register:** SC-028 "M5-WO10 application" bullet; new M5-SC-046 (Multi-Target additional-target base count) and M5-SC-047 (Signature Spell MP discount), both UNRESOLVED.
53. **Terminology:** no new term families; existing Spell / Affinity / Casting Condition vocabulary reused.

## Verification

54. **Golden tests:** `spell-cost-golden.test.ts` — 23 tests (constructed base, Effect scaling, Trait COST/ADD, provenance, normal rounding, legacy 11.7 → 12, Affinity Strength / Weakness / combined, 45% → 30%, one rounding step, Affinity once, ordering, AP floor/division/Somatic/no cap/Charge, AP from final MP only).
55. **Unit tests:** `spell-cost-contracts.test.ts` — 20 tests (R1/R2, interleaving, cross-Ruleset, PRO, negative MP, SC-046, COST MULTIPLY, Maneuver, SC-042, freeform/ME fields, Signature, RESOURCE-free plan, plain-data safety, freeze, determinism, foreign run). Static audit 23 tests; Inspector fixture 1 test.
56. **Integration tests:** `prowess-spell-cost-history.test.ts` (1 DB test) and `m5-wo10-spell-cost-api.test.ts` (9 API tests) — run locally against a real PostgreSQL `prowess_studio_test` and passed (see 74–75).
57. **Negative controls (the 40 categories):** 1 sequential percentages — golden trace E + control; 2 percentage twice — golden one-net-step + control; 3 Affinity double-count — golden Affinity-once + control; 4 floor rounding — golden 13.5/11.7 + control; 5 multiple rounding — golden one-rounding + static; 6–7 component / intermediate rounding — static `rounding: NONE` audit + control; 8 raw Condition total — golden 45% + control; 9 rank caps — static + control; 10–11 Affinity / Weakness reimplementation — static (only `compileAffinity`; `selectWeakness` forbidden); 12 freeform percentage — contracts; 13 prose Signature — contracts + static + control; 14 legacy modifier — contracts SC-046 / COST MULTIPLY; 15 ME — contracts + static + control; 16–18 MP/ME/AP spending — contracts RESOURCE-free + static; 19 AP before final MP — golden; 20 AP rounded normally — golden floor(3.5) + control; 21 Somatic before AP — golden + control; 22 Somatic below 1 — golden; 23 3 AP cap — golden trace H + control; 24 default PRO — contracts + control; 25 invalid PRO — contracts; 26 negative clamped — contracts; 27–31 Sustain / Mana Lock / Channeling / Concentration / Effect Chain — static + Sustain control; 32 Maneuver cost — contracts + control; 33 latest lookup — static + control + R1/R2; 34 cross-Ruleset — contracts; 35 stale EntityVersion — R1/R2 pure and DB history; 36 duplicate — static (item 45); 37 ordering — golden + determinism; 38 input mutation — contracts; 39 executable payload — contracts safety; 40 SC-042 — contracts + static.
58. **Mutation controls:** `scripts/m5-wo10-negative-controls.mjs` — all **18** controls caught and reverted (net → sequential multiplication; final MP floor; intermediate rounding; raw Condition total instead of WO9 effective 30%; rank caps; WO4 listed-cost step kept; Affinity applied twice; ME subtraction; AP capped at 3; AP modifiers applied to MP instead of base AP; AP floor removed; AP division rounded normally; Sustain; final Maneuver cost; latest lookup; Ruleset provenance bypass; name-based Signature discount; default PRO). Each mutates real WO10 source/policy, requires the targeted guard to fail for an assertion reason, restores the file byte-for-byte and re-runs the guard green. During development one control (AP division rounded normally) was initially NOT caught because 17/4 = 4.25 rounds the same either way; a 14 MP / PRO 4 → 3 AP golden was added and the control now fails as required.
59. **Architecture audit:** `m5-wo10-static.test.ts` 23/23; root architecture check passed (12 import-boundary rules, 8 packages, no cycles).
60–69. **Regression:** All earlier permanent gates were re-run on the final source:

| Suite (standard `pnpm -r --workspace-concurrency=1 run test:unit --maxWorkers=2 --testTimeout=60000`) | Files | Tests passed |
| --- | ---: | ---: |
| @prowess/model | 27 | 513 |
| @prowess/ui | 1 | 21 |
| @prowess/import | 5 | 128 |
| @prowess/rules (M4) | 17 | 659 |
| @prowess/game (incl. WO10 goldens 23 + contracts 20) | 27 | 746 |
| @prowess/db unit (incl. WO10 Inspector fixture) | 15 | 93 |
| Studio unit / component / static (incl. WO1–WO10 audits) | 75 | 2,708 |
| **Total** | **167** | **4,868** |

Source mutation controls, run serially with a full before/after SHA-256 comparison of 984 tracked/untracked files (zero residual changes other than the intentional edits listed in items 5–6):

| Controls | Caught and restored |
| --- | ---: |
| M4 final | 3 |
| M5-WO1 | 17 |
| M5-WO2 | 18 |
| M5-WO3 | 21 |
| M5-WO4 | 34 |
| M5-WO5 | 29 |
| M5-WO6 | 16 |
| M5-WO7 | 22 |
| M5-WO8 | 8 |
| M5-WO9 | 12 |
| M5-WO10 | 18 |
| **Total** | **198** |

60. **M4:** 659 engine tests, M4 static gates and final controls pass; `packages/prowess-rules/src` unchanged (hash-guarded). 61–69 WO1–WO9: every unit/static suite and mutation-control script passes. The first full unit run exposed that the WO1/WO2 audits apply to every game file and flagged the new WO10 Formula content, and the WO3 audit flagged `currency === "MP"` comparisons as a Resource-name branch; the WO10 files were delegated per the existing convention and the comparisons replaced by a structured currency → operation vocabulary lookup, after which every suite passed. WO8/WO9 generated Inspector fixtures are unchanged.
70. **Lint:** `pnpm -r lint` passed (max-warnings 0).
71. **Typechecks:** `pnpm -r typecheck` passed for all packages and Studio, including the new DB/API tests.
72. **Production build:** `pnpm -r build` passed (Next build completed).
73. **Prisma:** `prisma validate` / `generate` cannot run here — engine checksum download from `binaries.prisma.sh` returns 403. No schema or migration file changed (hash-guarded). Drift is unverified locally.
74. **DB integration:** local PostgreSQL 16 started; `prowess_studio_test` rebuilt from the committed `migration.sql` files via `psql` (Prisma migrate unavailable). WO10 history test passed. Full `@prowess/db` integration suite: 510 of 520 passed; the 10 failures are exclusively the "migration is applied and finished" ledger assertions (M1 audit, M2-WO1–WO8, M3-WO1), which read Prisma's `_prisma_migrations` table — absent because the schema was applied with `psql`, not `prisma migrate deploy`. This is an environment limitation, not a functional pass of those 10 tests; no ledger rows were fabricated.
75. **API integration:** WO10 API traces A–H passed (9 tests) through `POST /api/rules/evaluate` with table fingerprints unchanged. Full Studio integration suite: 26 files, 138 tests passed.
76. **Playwright:** the repository-standard Playwright run (Chromium, built Next server against the local test DB) passed **45/45**.
77. **Environment limitations:** pushes and GitHub API calls return 403 from this environment; Prisma engine binaries cannot be downloaded; the test database was built with `psql` rather than `prisma migrate deploy`. No mock or fabricated pass was used.
78. **GitHub verification still required:** after separate authorization — push `m5-wo10`, open a draft PR, and verify fresh migrations, Prisma drift, package/game/Studio tests, DB/API integration, Playwright, the new `M5-WO10 audit` gate and the dedicated `m5-wo10.yml` workflow, then (separately authorized) merge and merged-main CI.
79. **Acceptance criteria:** implementation and all locally supported verification complete; Prisma validate/generate/drift, the 10 migration-ledger assertions and permanent CI remain pending GitHub infrastructure. Local success is not publication authorization and not FINAL PASS.
