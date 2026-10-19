# M5-WO5 Completion Report — Shared Modular Ability Construction Framework

**WORK ORDER READY FOR CI VERIFICATION — M5-WO5**

- **Branch:** `m5-wo5-impl` (fresh build). It is built from baseline `main` = `58a9ba8a517ae25c34b22e864c75d5a6d8809e18`
  (the PR #44 merge). The pre-existing remote `m5-wo5` branch was left untouched.
- **Status:** passes locally. FINAL PASS is reported only after merge and green CI on `main`. M5-WO6 has not been started.
- **Note on the checklist:** the items below follow the approved Work Order v1.0 (§0–§202) and the Martial addendum
  (§A1–§A12). The original text of the §200 report checklist did not survive this session's context compaction, so the
  items below were reconstructed from the Work Order's requirements. Any §200 item not listed here should be raised
  before merge.

## Baseline and boundaries

1. Baseline verified: branch created from `58a9ba8`; `main` was not reset.
2. M4 `@prowess/rules` is byte-identical to the WO2 baseline (65 files, same tree hash). Recorded in
   `m5-wo5-baseline.json`.
3. No M5-WO5 M4 FOUNDATION CHANGE REQUEST was needed.
4. No Prisma schema change and no migration. Schema and migrations are still pinned by `m5-wo1-baseline.json`. No
   M5-WO5 DATA MODEL BLOCKER.
5. No new API endpoint. The route inventory equals the baseline. Plans run through the existing
   `POST /api/rules/evaluate`.
6. No builder UI, no full Character model, and no DB access from `@prowess/game`. Its dependencies are still only
   `@prowess/model` and `@prowess/rules`.
7. No cost, resolution or catalog work (WO6–WO12).
8. No M5-WO5 CANON BLOCKER was raised. Every rule applied is a locked ruling. The one unauthored value (an Arcane
   Rank Value for stack limits) fails closed with `CONSTRUCTION_RULE_UNRESOLVED`; nothing was invented.

## Domain implementation

9. New Definition kind `ABILITY_CONSTRUCTION_RULE`: family ABILITY, schemaVersion 1, entity type GENERIC_RULE.
10. Canonical content `content/core-playtest-v0.1/ability-construction.json` holds one Definition,
    `construction.ability_rules`, with 8 designer rulings, source locators and the conflicts M5-SC-011/015/017/021/022/025.
11. Arcane Authority: the Arcana Skill rank, TRAINED minimum. Capacity is UNTRAINED 0/0, TRAINED 1/1, EXPERT 2/2,
    MASTER 3/3.
12. Affinity Authority: the governing Affinity owned at TRAINED+. Capacity is reused from the WO4 `AFFINITY_RANK_RULE`
    (`capacitySource: AFFINITY_RANK_RULE`) and not duplicated.
13. Authority is explicit (`composition.authority`) and never auto-switched. A Spell without one is `AUTHORITY_REQUIRED`;
    a Maneuver with one is `AUTHORITY_NOT_APPLICABLE`.
14. Casting Condition capacity comes from Arcane Rank only (0/1/2/3), under either Authority.
15. Spell Trait exchange: 1 unused Effect slot → +1 Trait slot. It is explicit and always keeps 1 Effect. Maximum
    trades are Trained 0, Expert 1, Master 2. There is no Maneuver exchange.
16. Martial Rank is the Martial Skill rank: TRAINED minimum, `martialRankValue` 1/2/3, and Effects / Traits /
    Conditions 1/2/3.
17. Affinity is an access layer only. It never substitutes for Martial training and never adds Maneuver capacity.
18. Every Spell and every Maneuver needs at least 1 Effect. There is exactly 1 Targeting slot.
19. A Maneuver needs a Foundation. The `MANEUVER_FOUNDATION` structural v1 contract (`foundationKind`) is activated,
    with no formula and no cost.
20. Component sub-contract `rules.construction`:
    - structured prerequisites (`SKILL_RANK_AT_LEAST`, `AFFINITY_RANK_AT_LEAST`);
    - explicit stacking (`FIXED` or `TRACK_RANK_VALUE`);
    - explicit `affinityAccess`.
21. Stacking: only when explicitly allowed. Stacks use 1 slot within the Definition's own limit. There is no universal
    limit, and separate uses are never merged.
22. Affinity access under Affinity Authority is ANY of:
    - a Strength condition;
    - a Weakness condition;
    - the component's `affinityAccess`;
    - an explicit `accessGrants` entry.

    The KEYWORD steps come from the reused WO4 `AffinityEmitter`.
23. Signature slots: capacity is `core.derived.signature_ability_slots` (= PRO). The default cost is 1. EXEMPT costs 0
    and requires an authored exemption with provenance; none is authored yet.
24. All construction arithmetic is content: five M4 Formula programs in the rule's `formulas`, validated by M4's
    `validateFormulaProgram` with inputs restricted per slot.
25. The compiler uses only KEYWORD, FORMULA and REQUIREMENT. Every comparison is an M4 REQUIREMENT, and every number
    comes from an M4 result.
26. Public API:
    - `compileAbilityConstruction`
    - `readAbilityConstructionRun`
    - `evaluateAbilityConstruction`
27. Error codes `PROWESS_CONSTRUCTION.*`: 10 codes. A malformed request is an error; an illegal construction is an
    INVALID result.
28. Results report:
    - status, access, capacity (effects, traits, conditions, trades), usage;
    - prerequisites, stacking, affinityAccess, signature;
    - per-rule satisfied / outcome, and the failing rule keys.
29. Source map: every step cites its exact Definitions (rule, ladder, rank rule, Signature statistic, component).
30. Exact Ruleset only. A bundle from another Ruleset is refused.
31. Determinism, immutability, plain-data safety and JSON round-trip are all tested.
32. The WO1 structural validation is unchanged. A cross-branch component is still a WO1 `CROSS_BRANCH_DEFINITION`.
33. `AffinityEmitter` is exported for reuse. WO4 behaviour is unchanged (all WO4 tests and 34 controls pass).

## Terminology and invariants

34. Martial Rank was re-classified as the CANONICAL SKILL rank (`MARTIAL_RANK`), by designer clarification.
35. New canonical terms:
    - Effect Capacity
    - Trait Capacity
    - Casting Condition Capacity
    - Maneuver Condition Capacity
    - Signature Ability Slot
    - Effect Stack
36. M5-I156 Spell Authority is appended after I155 and never renumbered.
37. M5-I157 Casting Condition capacity from Arcane Rank only is appended.
38. M5-I158 Martial Trained as the Maneuver minimum is appended.
39. Catalog-length guards were raised from 155 to 158 in the WO1, WO4 and canon-rulings audits. The WO1 guard-path
    pattern now admits `m5-wo5-negative-controls.mjs`.

## Tests

40. Golden fixtures `construction-legality-golden.test.ts`: 49 tests covering §64–§89 and §A5–§A9.
41. Contracts `construction-legality-contracts.test.ts`: 61 tests covering:
    - content, payload and sub-contract validation;
    - request validation;
    - M4 primitives and the source map;
    - history and isolation;
    - plain-data safety, immutability, JSON and determinism.
42. `@prowess/game` suite: 431 tests, all passing.
43. Static audit `m5-wo5-static.test.ts`: 43 tests (AST and content rules, baselines, invariants, terminology, docs,
    CI), including 30 in-memory controls.
44. Inspector fixture `m5-wo5-inspector-fixture.test.ts`, regenerated with `M5_WO5_WRITE_FIXTURE=1`. It holds one
    VALID Spell plan and one INVALID Maneuver plan.
45. DB integration `prowess-construction-history.test.ts`: R1/R2 exact history, re-materialization, concurrent
    isolation, no writes.
46. API integration `m5-wo5-construction-api.test.ts`: plans through the existing endpoint, numbers from M4, no writes,
    and exact ruleset resolution.
47. Negative controls `scripts/m5-wo5-negative-controls.mjs`: 29 controls covering §142–§163, §A11, the invariant
    catalog, terminology and CI. Each one mutates a real file, is caught by a named guard, and is restored byte-for-byte.

## Documentation and CI

48. `docs/architecture/m5-shared-ability-construction.md` has 31 numbered sections and 6 Mermaid diagrams (grammar,
    component contract, Affinity access, M4 sequence, result flow, R1/R2 history).
49. `docs/architecture/ci.md` documents the WO5 gate.
50. A new permanent CI step, **"M5-WO5 audit — Shared modular ability construction"**, sits after the canon-rulings
    gate. No gate was removed.

## Local verification (cloud workspace)

51. `pnpm run lint`: clean (0 warnings).
52. `node scripts/check-architecture.mjs`: passed (12 rules, 8 packages, no cycles).
53. `pnpm run typecheck`: clean.
54. `pnpm run build`: success.
55. Unit tests for all packages:
    - model 513, ui 21, import 128, rules 659, game 431, db 89;
    - studio 2555 (70 files), passing once this report exists.
56. Studio integration: 22 files, 120 tests, all passing.
57. DB integration: 505 pass. The only 10 failures are the known local migration-ledger checks; Prisma's engine
    download is blocked here, so the test DB is built with psql and has no `_prisma_migrations` ledger. CI runs
    `prisma migrate deploy`, so these checks pass there.
58. Negative controls:
    - M5-WO1 17/17, WO2 18/18, WO3 21/21, WO4 + canon rulings 34/34, WO5 29/29;
    - the M4 final controls are restored and identical.
59. Playwright: 45 passed, after a fresh test-schema reset.

## Remaining and deferred

60. The Casting Condition 30% cap and every MP / AP cost: WO10 / WO11.
61. Catalog content (real prerequisites, stacking, Affinity access and Foundations): WO6–WO9.
62. Signature exemptions: none are authored. Adding one is a designer content revision.
63. Arcane Rank Value: not authored. An Arcane-track stack limit fails closed.

## Next steps

64. Push `m5-wo5-impl` and open the PR against `main`.
65. After merge, confirm green CI on `main` and report "M5-WO5 COMPLETE — READY FOR M5-WO6".
66. Do not begin M5-WO6 automatically.
