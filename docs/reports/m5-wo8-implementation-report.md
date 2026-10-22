# M5-WO8 implementation report

Status: IMPLEMENTATION UNDER VERIFICATION — not FINAL PASS.

| # | Required report topic | Result / implementation |
|---|---|---|
| 1 | Actual baseline commit | 283a7c3f064307d0a2385daf995ad936b2b74e58; WO7 PR #48; baseline main workflows verified green. |
| 2 | Branch | m5-wo8. |
| 3 | Source authority | Designer > approved CanonDecision > current Core Playtest > permanent WO1–WO7 > older Chapter Book. |
| 4 | Designer rulings applied | SC041 option 1 (base three, approved exchanges can exceed it); SC024 Widen Area +5 ft/+6 MP. |
| 5 | Files created | Trait/authored payload contracts, ability compiler, reference fixtures, four domain suites, DB history and Inspector fixture tests, API integration, static audit, mutation script, dedicated workflow, architecture documentation and this report. |
| 6 | Files modified | Definition vocabulary/dispatch, scope inventory, shared Trait selection, parameter-reader export, construction stacking, public exports, invariant/conflict catalogs, historical audit delegation, permanent CI. |
| 7 | Files removed | None. |
| 8 | Database / migration status | Existing EntityVersion JSON and exact materializer; no schema or migration change. |
| 9 | Trait Definition contract | Typed rules.trait plus permanent component envelope/construction/cost contracts. |
| 10 | Trait family model | Explicit SHARED/SPELL/MANEUVER; no inferred sharing. |
| 11 | Trait scope model | ABILITY_WIDE/EFFECT_SPECIFIC/TARGETING/RESOLUTION with explicit selected component. |
| 12 | Trait parameters | WO7 COUNT/TOKEN/FLAG; defaults, bounds, increments; unknown/type/null/token rejection. |
| 13 | Trait access | Permanent Skill/Affinity prerequisites, explicit authority, Strength-only Keyword match. |
| 14 | Trait compatibility | Effect families, foundation categories, incompatible Traits, radius capability, exact branch. |
| 15 | Trait stacking | Permanent WO5 stacking limits; repetition on the same target uses declared stacks. |
| 16 | Spell Trait capacity | Normal base cap three via exact WO5 track, explicit approved exchanges; additional Affinity capacity separate. |
| 17 | Maneuver Trait capacity | Existing WO5 Martial rows reused; no newly invented cap. |
| 18 | Spell Definition contract | First-class versioned complete authored composition. |
| 19 | Spell Targeting structure | Exactly one canonical exact Targeting selection. |
| 20 | Spell Effect ordering | Explicit unique order preserved in serialization and compilation. |
| 21 | Spell authority | Explicit ARCANE_AUTHORITY or AFFINITY_AUTHORITY; no automatic best-rank selection. |
| 22 | Spell structural validation | Permanent WO5–WO7 and typed Trait/Duration requirements. |
| 23 | Duration representation | Exact reference; positive rounds only for ROUNDS; no runtime maintenance. |
| 24 | Maneuver Definition contract | Sibling type with ordered actions, attached Effects, Traits, restrictions and Duration. |
| 25 | Attack/action foundation | Typed inherited targeting/range/attack roll/weapon damage; every action checked. |
| 26 | Powerful Blow representation | Committed action group; combined damage source; attached Effects resolve once; no Effect slot. |
| 27 | Maneuver Effect capacity | One per Martial Rank through existing construction; WO7 stacking retained. |
| 28 | Maneuver Skill access | Permanent prerequisites; no class-based shortcuts. |
| 29 | Maneuver structural validation | Exact action/attachment/Effect checks and inherited-profile compatibility. |
| 30 | Ruleset isolation | Rebuilt exact bundle, exact authored/selected references and provenance. |
| 31 | Historical reproducibility | Pure version regression plus real stored R1/R2 Release history test. |
| 32 | Determinism | Equal exact inputs yield equal plans/results; no clock/random lookup. |
| 33 | Immutability | Detached frozen outputs; inputs unchanged. |
| 34 | Serialization | Validated canonical plain JSON; lossless selected references and semantic ordering. |
| 35 | Security | Closed rules; unsafe JSON/getters/functions/cycles/prototype pollution rejected; no executable prose. |
| 36 | Compilation source map | Every M4 step cites exact source Definitions and authored owner. |
| 37 | Rules Inspector fixtures | Generated real Spell/Maneuver plans through existing evaluation API; detailed M4 explanations. |
| 38 | New invariants | M5-I213–M5-I224. |
| 39 | Conflict register changes | SC041 resolved by designer; SC042 missing additional Affinity Trait capacity stays explicit. |
| 40 | Terminology changes | No canonical renames; legacy scope terms retained compatibly. |
| 41 | Golden tests | Six required objects plus Widen Area and Shared Trait checks. |
| 42 | Unit tests | Authored grammar, parameters, access, compatibility, stacks, identity, security, serialization, Inspector. |
| 43 | Integration tests | DB historical Releases and no-write snapshots; API Inspector evaluation and no-write snapshots. |
| 44 | Static architecture audit | WO8 source/inventory/CI guard plus existing architecture boundaries. |
| 45 | Negative controls | All 26 required behavioral cases plus eight real source mutations. |
| 46 | M4 regression | Required unchanged in full permanent CI. |
| 47 | WO1 regression | Required unchanged, with explicit delegation of new typed modules to WO8 audit. |
| 48 | WO2 regression | Required unchanged. |
| 49 | WO3 regression | Required unchanged. |
| 50 | WO4 regression | Required unchanged. |
| 51 | WO5 regression | Required unchanged, including Expert three / Master five exchange fixtures. |
| 52 | WO6 regression | Required unchanged; radius-capability contract reused. |
| 53 | WO7 regression | Required unchanged; Effect parameter grammar and compilers reused. |
| 54 | Documentation | docs/architecture/m5-traits-authored-abilities.md plus invariant/conflict catalogs. |
| 55 | CI gate | Dedicated m5-wo8.yml and named full permanent CI gate. |
| 56 | Local verification | Final full game regression, WO8 contracts, full Studio unit/component suite, Inspector fixture, mutation controls, lint, architecture, typechecks and production build pass. |
| 57 | Environment limitations | Local PostgreSQL is unavailable (ECONNREFUSED on 127.0.0.1:5432); real DB/API integration, drift and Playwright remain permanent-CI requirements. |
| 58 | GitHub verification needed | Dedicated gate, PR CI and merged-main permanent CI, drift, old gates, build and Playwright. |
| 59 | Acceptance criteria status | IMPLEMENTATION UNDER VERIFICATION; not FINAL PASS. Stop before next work order. |

## Verification record

Local verification on the completed implementation:

| Check | Observed result |
|---|---|
| Final full game regression | 23 files / 611 tests passed. |
| Final WO8 domain contract suites | 4 files / 69 tests passed. |
| Full Studio unit/static/component suite | 73 files / 2,649 tests passed. |
| Inspector plan fixture consistency | 1 test passed against the generated fixture. |
| Source mutation controls | All 8 mutations detected; exact source restored; positive guard passed after each restore. |
| Lint / architecture / whitespace | Passed; 12 import-boundary rules and 8 packages, no violations. |
| Game build / DB typecheck / Studio typecheck | Passed. |
| Production Next.js build | Passed with explicit production environment and disposable build connection URL. Initial attempts exposed missing local DATABASE_URL and a stale Turbopack persistence cache; no application changes were needed. |
| Earlier full M4 rules regression | 17 files / 659 tests passed (local timeout override 60 seconds for slow-host sanity fixtures). |
| Earlier package regressions | Model 513; UI 21; import 128; DB unit 91 tests passed. |
| Database / API integration, Prisma drift, Playwright | Not verified locally: PostgreSQL unavailable. Must pass permanent GitHub CI. |

The user-approved WO8 work order is marked APPROVED FOR IMPLEMENTATION, identifies m5-wo8 from verified main after WO7 / PR #48, and explicitly requires dedicated WO8 CI, PR CI, merge and merged-main CI. The SC041 designer ruling is applied. An initial publication attempt was rejected by automatic approval review because it retained older M4-only authorization. No remote branch or PR was created by that rejected attempt. The original approved WO8 work order and subsequent conversation context were recovered before retrying the same publication path. Automatic approval review rejected that retry too: it treated the recovered WO8 authorization as untrusted and the retained trusted authorization as M4-only. No WO8 remote tree, branch, commit or PR was created. Explicit current-conversation approval is required before publishing the WO8 source/test/documentation/workflow payload; no alternate upload path was attempted.

Baseline main remains 283a7c3f064307d0a2385daf995ad936b2b74e58. The permanent CI run 39666499214 and dedicated WO7 run 39666499248 on that baseline are successful. No WO8 completion claim is made; permanent PR and merged-main verification remain required.

## Exact file inventory

| Status | File |
|---|---|
| Modified | `.github/workflows/ci.yml` |
| Created | `.github/workflows/m5-wo8.yml` |
| Created | `apps/studio/tests/integration/fixtures/m5-wo8-ability-plans.json` |
| Created | `apps/studio/tests/integration/m5-wo8-ability-api.test.ts` |
| Modified | `apps/studio/tests/unit/m5-wo1-static.test.ts` |
| Created | `apps/studio/tests/unit/m5-wo8-static.test.ts` |
| Modified | `docs/architecture/m5-core-playtest-source-conflicts.md` |
| Modified | `docs/architecture/m5-invariants.json` |
| Modified | `docs/architecture/m5-invariants.md` |
| Created | `docs/architecture/m5-traits-authored-abilities.md` |
| Created | `docs/reports/m5-wo8-implementation-report.md` |
| Created | `packages/prowess-db/tests/integration/prowess-authored-ability-history.test.ts` |
| Created | `packages/prowess-db/tests/unit/m5-wo8-inspector-fixture.test.ts` |
| Created | `packages/prowess-game/src/ability-definitions.test.ts` |
| Created | `packages/prowess-game/src/ability-negative.test.ts` |
| Created | `packages/prowess-game/src/ability-security.test.ts` |
| Created | `packages/prowess-game/src/ability/compile.ts` |
| Modified | `packages/prowess-game/src/compilation/compile.ts` |
| Modified | `packages/prowess-game/src/construction/composition.ts` |
| Modified | `packages/prowess-game/src/construction/legality.ts` |
| Created | `packages/prowess-game/src/content/core-playtest-v0.1/traits.ts` |
| Created | `packages/prowess-game/src/definition/authored-ability-payload.ts` |
| Modified | `packages/prowess-game/src/definition/effect-payload.ts` |
| Modified | `packages/prowess-game/src/definition/payload.ts` |
| Created | `packages/prowess-game/src/definition/trait-payload.ts` |
| Modified | `packages/prowess-game/src/index.ts` |
| Created | `packages/prowess-game/src/testing/ability-definition-fixtures.ts` |
| Created | `packages/prowess-game/src/trait-contracts.test.ts` |
| Modified | `packages/prowess-game/src/vocabulary/construction.ts` |
| Modified | `packages/prowess-game/src/vocabulary/families.ts` |
| Created | `scripts/m5-wo8-negative-controls.mjs` |
