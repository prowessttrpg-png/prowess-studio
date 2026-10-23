# M5-WO9 — Reconstructed local implementation report

Status: LOCAL IMPLEMENTATION VERIFIED WITH ENVIRONMENT LIMITATIONS — READY FOR PUBLICATION REVIEW — NOT FINAL PASS. Publication is not authorized.

## Baseline and recovery

1. **Actual baseline:** `169f360887277a4b17d761fa606c919c508ee723`, PR #49 / WO8 merged main. GitHub's branch and permanent merged-main workflow [39718727241](https://github.com/prowessttrpg-png/prowess-studio/actions/runs/39718727241) were verified successful at this SHA before reconstruction. Actual repository owner is `prowessttrpg-png`.
2. **Branch:** local `m5-wo9`; clean isolated worktree at `/workspace/scratch/a0ea13c301d7/wo9-reconstructed`. The visible older main checkout was at `53aa50067bb2cc9508a73e690e432cf19cd37d8f` with an untracked nested directory. It was left untouched. `origin/main` was fetched and the new worktree started clean at the verified current merge. No reset of main occurred. The old unpushed WO9 commit was treated as lost and was never looked up, reconstructed or published. The final local commit is identified in the delivery message.
3. **Source authority:** explicit designer rulings and approved WO9 specification, current Core Playtest source verified with the permanent M3 DOCX parser, then existing WO5–WO8 structured content. Source identity is recorded by `docs/import-reports/m3-wo9-core-playtest-v0.1.md`; no private source file or complete text is committed.
4. **Designer rulings:** SC012 (restriction versus Status), SC021 (flat 30%), SC025 (3 AP), SC028 (final netting/rounding deferred), SC041 (ordinary exchange preserved), SC042 (unresolved).

## File manifest

5. **Created:** 17 files:

- `.github/workflows/m5-wo9.yml`
- `apps/studio/tests/integration/fixtures/m5-wo9-ability-plans.json`
- `apps/studio/tests/integration/m5-wo9-ability-api.test.ts`
- `apps/studio/tests/unit/m5-wo9-static.test.ts`
- `docs/architecture/m5-duration-ability-conditions.md`
- `docs/architecture/m5-wo9-baseline.json`
- `docs/reports/m5-wo9-implementation-report.md`
- `packages/prowess-db/tests/integration/prowess-duration-condition-history.test.ts`
- `packages/prowess-db/tests/unit/m5-wo9-inspector-fixture.test.ts`
- `packages/prowess-game/src/ability/duration-conditions.ts`
- `packages/prowess-game/src/content/core-playtest-v0.1/duration-conditions.ts`
- `packages/prowess-game/src/definition/condition-policy.ts`
- `packages/prowess-game/src/definition/duration-condition-payload.ts`
- `packages/prowess-game/src/duration-condition-negative.test.ts`
- `packages/prowess-game/src/duration-condition.test.ts`
- `packages/prowess-game/src/testing/duration-condition-fixtures.ts`
- `scripts/m5-wo9-negative-controls.mjs`

6. **Modified:** 11 files:

- `.github/workflows/ci.yml`
- `apps/studio/tests/unit/m5-wo1-static.test.ts`
- `apps/studio/tests/unit/m5-wo2-static.test.ts`
- `docs/architecture/m5-core-playtest-source-conflicts.md`
- `docs/architecture/m5-invariants.json`
- `docs/architecture/m5-invariants.md`
- `packages/prowess-game/src/ability/compile.ts`
- `packages/prowess-game/src/construction/legality.ts`
- `packages/prowess-game/src/definition/ability-construction-payload.ts`
- `packages/prowess-game/src/definition/payload.ts`
- `packages/prowess-game/src/index.ts`

7. **Removed:** none.
8. **DB/migrations:** no schema, migration, generated client, table or persistence-service changes. M4 source and Prisma files are protected by the WO9 frozen inventory/hash gate.
9. **Architecture reused:** exact Definition envelopes/bundles; existing DURATION/ABILITY_CONDITION and branch families; WO5 prerequisites/capacity/stacking; WO6 Targeting; WO7 Effect duration policy/cost/parameter grammar; WO8 authored Ability compiler and Traits; M4 Requirement/Formula/Explanation/orchestration; existing Release materializer and generic API/Inspector.

## Component behavior

10. **Duration contract:** additive closed `rules.duration`, exact branch, availability, requirements, future-runtime metadata and UNLISTED/AUTHORED cost status.
11. **Spell modes:** INSTANT, ROUNDS, COMBAT, SCENE, MISSION, SUSTAINED, MANA_LOCK, PERMANENT_BY_SPECIAL_RULE. Existing Permanent token is reused without adding an alias family.
12. **ROUNDS:** explicit positive safe integer; zero, negative, fractions, strings, nonfinite values, missing count and unknown parameters rejected. Other modes accept no round count.
13. **Maneuver Duration:** separate MANEUVER_DURATION Definitions; representative source-supported Instant, Until Next Turn, Rounds. No invented prices.
14. **Effect compatibility:** existing exact WO7 `duration.allowed` remains authoritative; Sustain/Mana Lock eligibility is additionally required for those modes. Canonical Reinforce compatibility is preserved; test-only maintenance fixture is explicitly separated from canon.
15. **Trait compatibility:** WO8 closed modifications cannot invent Duration conversion. Duration-scoped Traits need explicit DURATION metadata; Trait/Duration and Duration/Effect/Trait metadata are validated against exact components.
16. **Duration costs:** existing listed-cost grammar only. Current source catalog prices are UNLISTED, not free. Exact authored contributions can be exposed without a final Ability total.
17. **Sustain:** future metadata only; no MP/AP payment, Concentration check, termination or per-round state.
18. **Mana Lock:** future reserved-capacity metadata only; no maximum/current MP or lifecycle mutation. Permanent is separately fail-closed (SC045).
19. **Ability Condition contract:** closed typed applicability, runtime requirements, parameters, exact dependencies/subjects, slot policy, incompatibilities, choice and listed contributions.
20. **Condition/status distinction:** construction restrictions never become target Status Conditions. Existing forbidden status keys remain guarded.
21. **Casting Condition contract:** branch-specific SPELL_CASTING_CONDITION exact references, same historical Ruleset, no unknown parameters or opaque executable supplements.
22. **Casting Components:** Verbal vocalization / 10% listed MP reduction; Somatic movement / 1 AP listed reduction; generic Material deferred until a precise authored subject exists, with no default benefit.
23. **Casting Condition capacity:** existing exact ABILITY_CONSTRUCTION_RULE Arcane capacity, independent of reduction maximum. Both normal Verbal and Somatic consume slots; exemptions require an explicit authored rule.
24. **30% cap:** flat at all ranks. M4 exposes listed/effective/maximum/excess percentage points. Example Charge + Verbal lists 50, exposes effective 30 and excess 20; no Spell MP is calculated.
25. **Requirements:** actual compiled resolution, delivery, area, Duration, targets, Effect families and inherited foundation facts feed M4 Requirement operations. Intrinsic Attack/Save/area/Sustain/creature relevance cannot be removed by a trivial authored applicability. Runtime facts remain REQUIREMENT_CONTRACT_ONLY, with selected parameters and exact subject references retained. Supplied requirement provenance and ownership references are checked against exact historical pins.
26. **MP modifiers:** exact fixed, per-unit and per-selection listed contributions; M4 performs arithmetic. No Affinity/Signature/Metamagic percentage netting.
27. **Somatic:** listed AP reduction only; no final MP/PRO division, rounding or final minimum AP.
28. **Charge:** positive explicit `extraAp`; separate AP commitment and 10%-per-AP listed contribution; no runtime channeling/payment.
29. **Maneuver Condition contract:** exact MANEUVER_CONDITION, restrictions, actual foundation/target applicability, inert encounter requirements, declared parameters and exact provenance.
30. **Maneuver capacity:** existing Martial construction capacity and prerequisites, no second rank table.
31. **3 AP cap:** an attempted listed total above three is invalid; effective listed contribution remains capped at three. No final minimum or attack floor.
32. **Cost choice:** No Counter Action / Cannot Crit require explicit AP OR MP selection; no default or dual benefit. Both canonical alternatives remain authored, only the selected one is output.
33. **Range/GM-set:** Risk, Focus, Environmental Lock, unspecified templates and the old mission benefit remain deferred. Unknown player discount parameters are rejected. Cannot Move This Turn has a source conflict rather than a guessed value.
34. **Authored integration:** all new behavior is appended by the existing WO8 compiler after existing component compilation; no competing complete compiler.
35. **Compiler changes:** narrow Duration/Condition helper; optional additive plan/result surface; typed condition slot behavior and stack checks use WO5. Historical WO8-only plans omit the extension and remain identical.
36. **Source maps:** every new executable step includes authored Ability and component/policy exact references, selected component keys and deterministic requirement/parameter/contribution/cap role names. Generic M4 execution Ruleset provenance remains checked.
37. **Inspector:** stable generated JSON for Spell components and Maneuver MP-choice, containing actual evaluated listed contributions, requirement contracts, parameters, capacities, caps and source maps. Existing generic API handles the plans; no new endpoint or presentation mechanics.
38. **Ruleset isolation:** bundle is reconstructed against the exact request Ruleset; component, dependency, runtime subject and requirement provenance mixing is rejected. No latest/current lookup.
39. **History:** pure R1/R2 tests change both Duration and Condition versions and preserve old output. DB test adds normal published-release history, explicit dependent pin updates and no-write fingerprint checks; its execution requires PostgreSQL.
40. **Determinism:** canonical bundle ordering, explicit authored ordering and stable M4 plans; bundle permutation and repeated evaluation tests pass. No clock/randomness in production mechanics.
41. **Immutability:** request bytes preserved; detached deep-frozen outputs; no mutable registry.
42. **Serialization:** existing authored serialization helpers, normalized JSON round trips, exact five-field refs and explicit choices preserved; unknown discriminants rejected.
43. **Security:** reject functions, getters, symbols, cycles, prototypes, unsafe keys, nonfinite inputs, arbitrary executable prose and unknown fields. Incomplete/forged M4 runs, including absent numeric contribution results, are rejected.
44. **SC042:** additional Affinity Trait capacity remains null/unresolved; allocation fails closed. No capacity value inferred.
45. **Invariants:** appended M5-I225–M5-I242 with domain, negative, static and source-mutation guards. First 224 entries preserved exactly.
46. **Conflict register:** appended unresolved SC043 (Cannot Move 1 versus 2 AP), SC044 (discretionary/underspecified subjects/benefits and mission replacement), SC045 (Permanent access absent). No existing ruling was changed.
47. **Terminology:** existing canonical Duration/Ability Condition vocabularies and Permanent token reused; no new family, no Status Condition merge, no SC042 resolution.
48. **Reference fixtures:** seven Spell and four Maneuver cases required by WO9, including intentionally invalid no-Attack and over-cap cases; additional maintenance, historical, choice, parameter and security coverage. Neutral mechanics are test-only.

## Verification

49. **Unit results:** complete standard local recursive unit run passed **4,796 tests in 163 files**:

| Package | Test files | Tests passed |
| --- | ---: | ---: |
| @prowess/model | 27 | 513 |
| @prowess/ui | 1 | 21 |
| @prowess/import | 5 | 128 |
| @prowess/rules | 17 | 659 |
| @prowess/game | 25 | 703 |
| @prowess/db (unit) | 14 | 92 |
| Studio unit/component/static | 74 | 2,680 |
| Total | 163 | 4,796 |

`@prowess/test-fixtures` has no tests of its own and its standard sentinel script succeeded. Command: `pnpm -r --workspace-concurrency=1 run test:unit --maxWorkers=2 --testTimeout=60000`. WO9-specific game suites contain 92 tests (30 behavioral/contract/history/security tests plus 62 negative controls), the WO9 architecture suite has 18 tests, and its Inspector fixture has one DB unit test; these are subsets of the totals above.

50. **DB/API integration:** attempted the dedicated WO9 history (one test) and API (two tests). All reached the real persistence boundary and were blocked by P1001 / connection refused at local port 5432. No result is claimed as a functional integration pass. All prior DB/API integrations remain for permanent CI rather than running against a nonexistent database.
51. **Behavioral negative controls:** 62 WO9 tests passed, covering the required 40 categories plus extra exact-subject, provenance, choice, deferral, parameter, duplicate and incompatibility cases. Input immutability and ordering controls are also covered by the main suite.
52. **Source mutation controls:** all **180** controls passed. Dedicated WO9 tests all 12 real mutations, requires each guard failure, restores exact bytes and reruns its positive guard after every restoration. It passed again on the final source, including the JSON module import attribute. All earlier M4 and M5-WO1–WO8 scripts passed serially. Full before/after hash comparisons across 917 files found zero residual changes. An interrupted WO5 run left one temporary Martial Rank Value mutation; that JSON file was explicitly restored to baseline and the complete WO5 suite was rerun successfully before continuing.

| Source controls | Caught and restored |
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
| Total | 180 |
53. **Architecture:** 18 WO9 static tests passed; root architecture check passed all 12 boundary rules and eight package circular-dependency checks. WO1/WO2 exclude only the new later-WO helper/content as appropriate, following their existing later-WO delegation convention. New helper boundary coverage is retained in the WO9 audit; no previously covered file or historical assertion is removed. M4/schema/migration inventory and prior invariants are frozen by hash/data comparison.
54. **M4 regression:** 659 generic engine unit tests and all Studio M4 static/component gates passed; final negative controls passed. No generic engine change.
55. **WO1 regression:** unit/static passed; mutation controls passed.
56. **WO2 regression:** unit/static passed; mutation controls passed.
57. **WO3 regression:** unit/static passed; mutation controls passed.
58. **WO4/canon rulings regression:** unit/static passed; mutation controls passed.
59. **WO5 regression:** unit/static passed; mutation controls passed.
60. **WO6 regression:** unit/static passed; mutation controls passed; original WO8 CI mutation anchors retained.
61. **WO7 regression:** unit/static passed; mutation controls passed.
62. **WO8 regression:** unit/static and unchanged generated Inspector fixtures passed; mutation controls passed. Authority, Trait scopes/exchange, inherited actions, Powerful Blow, SC041, SC042 and historical pins preserved.
63. **Lint:** standard recursive lint passed without warnings.
64. **Typechecks:** standard recursive typecheck passed for all packages and Studio, including the new DB/API tests.
65. **Production build:** final standard recursive production build passed and produced Next BUILD_ID and build/app manifests. Explicit disposable build environment supplied; no live database was needed. Direct Node import of the built public game package also passed; both permanent workflows include this compatibility smoke check. The new JSON import explicitly declares its module type, preserving direct CLI consumers as well as Vitest/Next consumers.
66. **Prisma:** validate and generate passed. No migrations/schema changes. Real migration/schema drift attempt returned P1001 because local PostgreSQL is absent; “No differences” remains unverified until permanent infrastructure runs it.
67. **Playwright:** attempted the repository-standard runner. Its server build completed, but Next start failed with `uv_interface_addresses` / ERR_SYSTEM_ERROR while querying host network interfaces. Zero browser tests executed; stopped the blocked runner after confirming that host error. This is not a Playwright pass.
68. **Environment:** Node 24.19.0, pinned pnpm 9.15.9, frozen install succeeded. No psql/postgres/pg_ctl/Docker/Podman binary or listening localhost:5432 service. Runtime interface discovery blocks the Playwright server. No mock replacement or fabricated pass was used.
69. **GitHub verification still required:** workflow changes are local only. No push, PR, workflow dispatch, merge, secrets/settings change or WO10 work. Publication needs the user's separate approval. Dedicated WO9 and permanent PR CI, migrations/drift, DB/API and Playwright must run on permanent infrastructure, followed eventually by separately approved merge and green merged-main CI.
70. **Acceptance:** local implementation and all supported verification are complete. Database/API/drift and Playwright remain explicitly pending permanent infrastructure. The final candidate is committed locally after verification; the delivery supplies its new SHA and a self-contained Git recovery bundle. No publication or merge is authorized. Local success is not FINAL PASS and does not authorize WO10.

## Review notes

The reconstruction corrected missing protections for malformed numeric M4 contribution results, foreign requirement provenance/subjects, and malformed OR branches containing multiple benefits before final verification. Maneuver AP/MP alternatives cannot be silently relabeled ALL. A direct Node smoke check also exposed a missing JSON module type attribute; that compatibility issue was fixed and permanently guarded. Historical audit delegation was kept narrow and reviewed through the new WO9 gate. Source contradictions were recorded and deferred, without changing domain economics. All source, tests, documentation and workflow edits belong to WO9; no unrelated content or migration was introduced.
