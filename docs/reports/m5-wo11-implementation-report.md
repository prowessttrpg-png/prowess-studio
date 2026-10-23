# M5-WO11 — Final Maneuver Cost, Attack Floors & Signature Reduction — local implementation report

Status: LOCAL IMPLEMENTATION VERIFIED WITH ENVIRONMENT LIMITATIONS — READY FOR PUBLICATION REVIEW — NOT FINAL PASS.
Publication (push to `m5-wo11`, pull request, permanent CI, merge) is NOT authorized by the Work Order and has not occurred.
M5-WO12 has not been started.

## Baseline, authority and files

1. **Actual baseline SHA:** `efb4fe7157a6b01a39457cf7cce6b761699f8cb4` — `Merge pull request #51 from prowessttrpg-png/m5-wo10`. Local `main` was reset to the fetched `origin/main` (no local-only commits existed on it), the tree was clean, and the merged-main runs at this SHA were seen green on GitHub: Prowess Studio CI #209, M5-WO7 #52, M5-WO8 #9, M5-WO9 #5, M5-WO10 #3.
2. **Branch:** local `m5-wo11` from that baseline; one local commit (SHA in the delivery message).
3. **Source authority:** designer rulings → CanonDecisions (none relevant) → Core Playtest Packet V0.1 (read from the user's connected copy of `Prowess Core Playtest Packet VO.1.docx`: §3 Maneuver Anatomy, §4 Building a Maneuver incl. the foundation table and Cost Rules, §7 Powerful Blow, §9 Commitment Scaling, §10 Elemental Damage Conversion, §11 Maneuver Conditions, §12 Signature Maneuvers) → permanent M5-WO1–WO10 mechanics.
4. **Designer rulings applied:** M5-SC-025 (total Maneuver Condition discount ≤ 3 AP — consumed through WO9's effective step); M5-SC-026 (AP is set by the exact Attack — each Attack Definition authors its own AP). M5-SC-042 / 044 / 046 / 047 untouched.
5. **Files created (16):**

- `.github/workflows/m5-wo11.yml`
- `apps/studio/tests/integration/fixtures/m5-wo11-maneuver-cost-plans.json` (generated)
- `apps/studio/tests/integration/m5-wo11-maneuver-cost-api.test.ts`
- `apps/studio/tests/unit/m5-wo11-static.test.ts`
- `docs/architecture/m5-final-maneuver-cost.md`
- `docs/architecture/m5-wo11-baseline.json`
- `docs/reports/m5-wo11-implementation-report.md`
- `packages/prowess-db/tests/integration/prowess-maneuver-cost-history.test.ts`
- `packages/prowess-db/tests/unit/m5-wo11-inspector-fixture.test.ts`
- `packages/prowess-game/src/ability/maneuver-cost.ts`
- `packages/prowess-game/src/content/core-playtest-v0.1/maneuver-cost.ts`
- `packages/prowess-game/src/definition/maneuver-cost-policy.ts`
- `packages/prowess-game/src/maneuver-cost-contracts.test.ts`
- `packages/prowess-game/src/maneuver-cost-golden.test.ts`
- `packages/prowess-game/src/testing/maneuver-cost-fixtures.ts`
- `scripts/m5-wo11-negative-controls.mjs`

6. **Files modified (13):**

- `.github/workflows/ci.yml` — new step `M5-WO11 audit — Final Maneuver Cost & Attack Floors` after the WO10 gate; every earlier step retained.
- `packages/prowess-game/src/definition/authored-ability-payload.ts` — additive non-attack foundation profile (`rules.action`: MOVEMENT / DEFENSE + own Targeting) and `readFoundationProfile` (exactly one of `attack` / `action`).
- `packages/prowess-game/src/ability/compile.ts` — WO8 compiler reads foundation profiles through `readFoundationProfile`; Powerful Blow must combine uses of one exact Attack (attacks only); an attack-scoped Effect attaches to exactly one resolution (one Attack use or one whole Powerful Blow). Range-trait handling tolerates non-attack actions.
- `packages/prowess-game/src/definition/effect-payload.ts` — optional, Maneuver-only, FIXED-only `affinityReduction` cost data (exact relevant Affinities, per-rank flat reductions, component minimum).
- `packages/prowess-game/src/definition/ability-construction-payload.ts` — optional `maneuverCostPolicy` read like WO9's `conditionPolicy`.
- `packages/prowess-game/src/index.ts` — WO11 exports.
- `apps/studio/tests/unit/m5-wo1-static.test.ts`, `m5-wo2-static.test.ts` — WO11 module / content added to the existing later-milestone delegation sets (same convention WO7–WO10 used); every earlier file stays covered.
- `apps/studio/tests/unit/m5-wo9-static.test.ts` (invariant count 260 → 293) and `m5-wo10-static.test.ts` (checks the first 260 ids and WO10's own 18 rows; WO11's gate checks the full 1–293 sequence) — annotated, not weakened.
- `docs/architecture/m5-core-playtest-source-conflicts.md` — SC-025 / SC-026 "M5-WO11 application" notes; new M5-SC-048.
- `docs/architecture/m5-invariants.json`, `docs/architecture/m5-invariants.md` — appended M5-I261–M5-I293.

7. **Files removed:** none.
8. **DB / migrations:** no Prisma schema, migration, generated client or persistence change; the static gate re-hashes the frozen M4 sources, schema and migrations against `m5-wo11-baseline.json`.
9. **Architecture reused:** WO8 `compileAbilityDefinition` / `readAbilityDefinitionRun` (WO5 construction & Signature slots, WO6 Targeting, WO7 Effects, WO8 Traits, WO9 Duration / Conditions all through it); WO9 `maneuverAp.effectiveStep` and selected Condition contributions; WO4 `validateAffinityProfile`; M4 FORMULA / MODIFIER / EXPLANATION and orchestration; the existing `POST /api/rules/evaluate` and Inspector.

## Maneuver cost behaviour

10. **Compiler architecture:** `compileManeuverCost(request)` = authored-Ability request + `signatureManeuver` → plain-data check → canonical WO8 compile → MANEUVER only → Signature slot check → exact Ruleset's `maneuverCostPolicy` → appended WO11 steps (see `docs/architecture/m5-final-maneuver-cost.md` §1). `readManeuverCostRun` / `evaluateManeuverCost` read M4's numbers into a frozen result; nothing computes outside M4.
11. **Action / foundation AP:** each authored action use contributes its foundation Definition's exact `costContributions` (FIXED). No authored cost → `UNRESOLVED_CONTRIBUTION`; nothing is priced from "Heavy", a weapon or a name. No canonical foundation catalog exists yet; the packet table (Light 1 · Balanced 2 · Heavy 3 · Move 1 · Block 2) is authored as test Attacks / actions.
12. **Repeated actions:** two uses of one Attack Definition are two contributions and two resolutions unless combined by Powerful Blow.
13. **Effect AP:** each authored Effect instance's AP contributions, once — however many compiled views (resolution groups) contain it.
14. **Effect MP:** same, MP currency; MP exists only where a component lists it.
15. **Cost options:** AP-or-MP = two PER_SELECTION costs (AP, MP) keyed by one TOKEN with no default. The authored Maneuver must select it explicitly (`MISSING_COST_CHOICE`); only the selected amounts apply; the Inspector lists options, per-currency amounts and the selection.
16. **AND costs:** both currencies apply (+2 AP AND +8 MP → both).
17. **Component-specific Affinity:** new structured `affinityReduction` on a FIXED Maneuver Effect cost: highest owned relevant rank's reduction via an M4 MAX modifier, then `max(minimum, amount − reduction)` — once, no global percentage. Fixture: 5 MP, Expert → 3 MP, Master → 2 MP (minimum). The canonical Elemental Damage Conversion is not structured this way and fails closed (M5-SC-048).
18. **Base AP:** M4 MODIFIER sum of all AP contributions; preserved as `ap.baseApCost`.
19. **Base MP:** independent M4 MODIFIER sum of MP contributions; never derived from AP.
20. **Condition AP:** WO9's selected contributions, legality, capacity and choices are consumed, not revalidated.
21. **−3 AP cap:** only WO9's `min(listed, 3)` step is bound; listed −2 −1 −1 → −3 (WO9 also marks that selection INVALID, which WO11 propagates). Once per Mission −5 AP remains deferred (M5-SC-044).
22. **Condition MP:** only WO9's selected MP options (No Counter Action "MP" → −3 MP; AP not also reduced), summed in M4.
23. **MP floor:** final MP = MAX(Base MP − Condition MP, 0): 2 − 3 → 0.
24. **Separate attack-resolution count:** structural — Attack groups (each non-Powerful-Blow Attack use, one per Powerful Blow); non-attack actions do not count.
25. **Attack floor:** post-Condition AP = MAX(Base AP − effective reduction, max(1, resolutions)).
26. **Powerful Blow cost:** every constituent Attack's full AP (Heavy ×2 = 6).
27. **Powerful Blow floor:** one resolution (8 − 3 = 5, floor 1 — never 2).
28. **Mixed:** Powerful Blow Longsword ×2 + Shield Bash → two resolutions, floor 2; the Blow's Armor Break +2 counted once.
29. **Non-attack Maneuvers:** zero resolutions; floor and final minimum 1 (Block 2 + Guard 1 − 3 → 1 AP).
30. **Signature Maneuver:** phase 1 of the final AP step SUBTRACTs the policy's `signatureApReduction` (1).
31. **Signature source:** packet §12 / §3 ("Reduces final AP cost by 1, minimum 1 AP"); the value lives in the Ruleset's versioned `ABILITY_CONSTRUCTION_RULE.maneuverCostPolicy`; assignment is the explicit `signatureManeuver` request field, valid only when the Maneuver occupies a WO5 Signature Ability slot (`slotUse: DEFAULT`). A name never decides it.
32. **Signature ordering:** Base AP → Condition-reduced → floor → post-Condition → Signature → MAX 1, as explicit ordered M4 steps / phases.
33. **Signature floor bypass:** 4 − 2 = 2 (floor 2) → Signature → 1 AP.
34. **Final AP floor:** phase 2 MAX 1.
35. **No 3 AP cap:** no MIN / maximum anywhere; 7-AP Maneuvers report 7 (the B trace reports 5 after Conditions).
36. **Base AP preservation:** Base 5 → final 1 with Signature; `baseApCost` stays 5.
37. **Commitment boundary:** WO11 exposes Base AP for Commitment consumers; it rolls nothing.
38. **Rules Inspector:** traces A–J (basic, high-AP, separate multi-attack, Powerful Blow, AP/MP option, MP-bearing, Condition-capped, Signature, Signature multi-attack, support) in `m5-wo11-maneuver-cost-plans.json`, executed through the existing endpoint. Each carries the attachment structure: actions, resolution groups (kind, constituent actions, repetitions, inherited weapon requirements, attached Effects / Traits), Maneuver-scoped Traits.
39. **Source map:** every WO11 step names the Maneuver, the policy and the exact contributing Definitions and component uses.
40. **Contribution identity:** `source : componentKey : contributionKey` (component-use based).
41. **Duplicate protection:** a repeated identity fails closed; an Effect instance seen through several compiled views is counted once.
42. **Ruleset isolation:** WO8 rebuilds the bundle against the exact Ruleset; WO11 reads its policy from the same bundle; the reader verifies each step's Ruleset. Mixed R1 / R2 context or bundle, and a stale EntityVersion, are refused.
43. **Historical reproducibility:** R1 Push v1 +1 AP vs R2 v2 +2 AP (pure and over real stored Releases); R1 Signature rule unaffected by an R2 rule.
44. **Determinism:** deep-equal plans / runs / results; JSON round-trip replays identically.
45. **Immutability:** inputs untouched; outputs detached and deep-frozen.
46. **Serialization:** JSON-safe plans and results; the Inspector fixture must regenerate byte-identically.
47. **Security:** getters, functions, cycles, `__proto__`, non-boolean Signature assignments, unknown fields (`discount`, `apCostOverride`) and foreign / incomplete runs are refused.
48. **Unresolved conflicts preserved:** M5-SC-042 (still refused by WO8), M5-SC-044, M5-SC-046, M5-SC-047.
49. **New conflict:** M5-SC-048 — Elemental Damage Conversion: canonical WO7 content lists FIXED +4 MP; the packet says +5 MP reduced by relevant Affinity rank (minimum 2), with an element → Affinity table naming an Affinity ("Emission") absent from the catalog. WO11 fails closed on the canonical Definition and adds the exact structured rule a future version can use; WO7's value is not changed.
50. **Invariants:** M5-I261–M5-I293 appended (group "Final Maneuver Cost"), each guarded by executing tests that cite it plus the static gate and mutation controls; the first 260 unchanged.

## Attack binding, attachment and Powerful Blow (amendment)

- **Attack Definition reuse / Attack-use identity:** each action use references an exact foundation Definition (an Attack with its weapon profile, or a non-attack action); its component key is its identity.
- **Automatic weapon requirement:** every Attack resolution group carries `{ kind: "WEAPON", weaponKey, attack, grantsConditionDiscount: false, consumesConditionSlot: false, status: "REQUIREMENT_CONTRACT_ONLY" }`. Whether the character currently has that weapon is runtime (contract only), never invented.
- **Requirement vs Condition / duplicate-restriction prevention:** inherited requirements are never Conditions; a Condition whose restriction is inherent to the Attack (`inherentRestrictionKeys: ["WEAPON_LOCK"]`) is refused (`REDUNDANT_RESTRICTION`); canonical Weapon Lock is additionally still deferred (M5-SC-044).
- **Per-Attack Effect / Trait attachment; Maneuver-scoped handling:** an Effect attaches to exactly one resolution group; Effect-scoped Traits follow their Effect; Ability-wide Traits are Maneuver-scoped. Broadcasting is refused by WO8 and guarded by static / mutation controls.
- **Repeated same-Attack / different-Attack behaviour:** distinct resolutions and independent attachment sets.
- **Powerful Blow compatibility, constituent costs, resolution count, attachment, mixed behaviour:** same exact Attack only, attacks only; full constituent AP; one resolution; its Effects resolve once and cost once; mixed with a separate Attack → two resolutions.
- **Inspector attachment trace:** `cost.structure` in every trace.
- **New negative / mutation controls:** see 54–55.

## Verification

51. **Golden fixtures:** `maneuver-cost-golden.test.ts` — 23 tests.
52. **Unit tests:** `maneuver-cost-contracts.test.ts` — 26 tests; static gate 31 tests; Inspector fixture 1 test.
53. **Integration tests:** `prowess-maneuver-cost-history.test.ts` (1) and `m5-wo11-maneuver-cost-api.test.ts` (11) passed locally against a real PostgreSQL `prowess_studio_test`.
54. **Negative controls (48 + 18 categories):** every required category maps to an executing guard. Behavioural (golden / contracts): Spell compiler / MP ÷ PRO / Spell Affinity % (MANEUVER_ONLY, RESOURCE-free / no-`pro` plan scan, static); name / prose pricing (unpriced foundation → UNRESOLVED; Signature by name never applies); AP-or-MP both / cheapest / missing choice (option goldens + MISSING_COST_CHOICE); AND → OR (Surge golden); raw Condition total / −5 AP Once per Mission / AP-and-MP both (over-cap golden, SC-044 deferral contract, No Counter Action MP golden); GM-set discount (deferred, freeform fields refused); negative MP (MP floor golden); floor bypass by Conditions / Powerful Blow constituents as floor attacks / constituents missing from Base AP / Powerful Blow as an Effect (multi, Powerful Blow, mixed goldens; WO8 keeps it out of Effects); support at 0 AP (J golden); 3 AP cap / high-AP rejection (B golden, contracts); Signature before Conditions / in the cap / taking a slot / reducing MP / not bypassing the floor / below 1 / min applied too early (H, I, support-Signature, phase-order goldens); Base AP overwritten / Commitment reading final AP (commitment golden); MP↔AP conversion (option goldens: only listed alternatives); Elemental with Spell % / Affinity reduction twice (Elemental goldens, one reduction step); latest / cross-Ruleset / stale (R1/R2, mixed context / bundle, stale EntityVersion contracts + DB history); duplicate counting vs legitimate repetition (Powerful-Blow-Effect-once golden, repeated-Attack contract); AP / MP spent, damage / movement / Effect Chain executed (plan scan contracts, fingerprinted DB / API tests, static); input mutation / nondeterminism / executable payload (freeze, determinism, getter / function / cycle / `__proto__` contracts); unresolved conflicts (SC-048 contract, static register checks). Amendment: generic invented Attack (exact foundation Definition required by WO8), lost / discount-bearing / slot-consuming weapon requirement (requirement golden), restated Weapon Lock (REDUNDANT_RESTRICTION contract), Effect / Trait broadcast and missing / unknown targets (attachment contracts, static), Effect cost × Attack count (Powerful-Blow-Effect-once golden), repeated Attacks merged, Powerful Blow mixing types or non-attacks (contracts), Powerful Blow Effect duplicated per constituent, merged attachment sets (different-Attacks golden), cross-Ruleset / stale Attack (contracts).
55. **Mutation controls:** `scripts/m5-wo11-negative-controls.mjs` — all **26** caught and reverted: −3 cap removed; Once per Mission −5 executable; attack floor removed; Powerful Blow constituents counted as separate floor attacks; constituents dropped from Base AP; 3 AP cap; final 1 AP minimum removed; Signature before the floor; Signature prevented from bypassing the floor; Signature reduces MP; Signature as a Condition-stage reduction; AP/MP choice auto-selected; negative MP allowed; MP ÷ PRO; Spell Affinity percentage; damage / runtime; latest lookup; Ruleset provenance bypass; inherited weapon requirement removed; inherited requirement discount-bearing; Effects broadcast; Traits broadcast; Powerful Blow mixing Attack types; Powerful-Blow Effect cost multiplied; repeated Attacks merged without Powerful Blow; attachment identity discarded. Each mutates real source, requires a behavioural guard failure, restores byte-for-byte and re-runs green.
56. **Architecture audit:** `m5-wo11-static.test.ts` 31/31; root architecture check passed (12 import-boundary rules, 8 packages, no cycles); M4 sources, Prisma schema / migrations and the API route inventory hash-identical to the WO11 baseline.
57–67. **Regression:** every earlier permanent gate re-run on the final source:

| Suite (`pnpm -r --workspace-concurrency=1 run test:unit --maxWorkers=2 --testTimeout=60000`) | Files | Tests passed |
| --- | ---: | ---: |
| @prowess/model | 27 | 513 |
| @prowess/ui | 1 | 21 |
| @prowess/import | 5 | 128 |
| @prowess/rules (M4) | 17 | 659 |
| @prowess/game (incl. WO11 goldens 23 + contracts 26) | 29 | 795 |
| @prowess/db unit (incl. WO11 Inspector fixture) | 16 | 94 |
| Studio unit / component / static (incl. M4, M5-WO1–WO11 audits) | 76 | 2,748 |
| **Total** | **171** | **4,958** |

| Mutation controls (run serially; before / after SHA-256 comparison of 999 files found no residual change) | Caught and restored |
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
| M5-WO11 | 26 |
| **Total** | **224** |

57 M4: 659 engine tests, M4 static gates and final controls pass; `packages/prowess-rules/src` unchanged. 58–66 WO1–WO9: all suites and controls pass. The WO8 compiler change (foundation profiles, Powerful Blow compatibility, single-resolution attachment) left every WO8 / WO9 test, fixture and generated Inspector plan unchanged. 67 WO10: Spell semantics untouched; WO10 goldens, contracts, static gate, Inspector fixture and 18 controls pass; the WO10 static gate now checks its own 18 invariants inside the longer catalog.
68. **Lint:** `pnpm -r lint` passed (max-warnings 0).
69. **Typechecks:** `pnpm -r typecheck` passed for every package and Studio, including the new DB / API tests.
70. **Production build:** `pnpm -r build` passed (Next production build completed).
71. **Prisma validate / generate:** not runnable here — the engine checksum download from `binaries.prisma.sh` returns 403. No schema / migration file changed (hash-guarded).
72. **Prisma drift:** unverified locally (same reason); must report "No differences" in permanent CI.
73. **DB integration:** full `@prowess/db` integration suite: 511 of 521 passed, including the new WO11 history test. The 10 failures are exclusively the Prisma migration-ledger assertions (M1 audit, M2-WO1–WO8, M3-WO1) that read `_prisma_migrations`, which does not exist because the schema is applied with `psql`; no ledger rows were fabricated.
74. **API integration:** full Studio integration suite: 27 files, 149 tests passed (WO11 API traces A–J: 11 tests, every table fingerprint unchanged).
75. **Playwright:** the repository-standard Playwright run passed **45/45** on a freshly rebuilt test database. Two earlier runs against the database left populated by the full DB / API integration suites each had one or two navigation `toHaveURL` timeouts in M0 / M1 UI specs (different tests each time: compendium + m1-audit, then boot shell nav); WO11 changes no UI code. Permanent CI runs Playwright on its own database.
76. **Environment limitations:** pushes and the GitHub API are refused from this environment (the earlier WO10 publication went through a git bundle pushed by the user); Prisma engines cannot be downloaded; the test database is built with `psql` from the committed `migration.sql` files, so the 10 Prisma migration-ledger assertions cannot pass locally. No mock or fabricated pass is used.
77. **GitHub verification still required:** after separate authorization — publish `m5-wo11`, open a draft PR, and verify fresh migrations, Prisma drift, package / game / Studio tests, DB / API integration, Playwright, all M4 and M5-WO1–WO10 gates, the new `M5-WO11 audit` step and `m5-wo11.yml`; then (separately authorized) merge and merged-main CI.
78. **Acceptance criteria:** implementation and every locally supported verification complete. Pending permanent infrastructure: Prisma validate / generate / drift, the 10 migration-ledger assertions, GitHub CI. Local success is not publication authorization and not FINAL PASS.
