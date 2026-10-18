# WORK ORDER READY FOR CI VERIFICATION — M5-WO4

Affinity Identity, Rank, Authority, Keyword Alignment & Cost Modifier Foundation. This is not FINAL PASS: permanent
merged-main GitHub CI has not run yet. M5-WO5 has not been started.

## 1. Base Commit / Branch

- Base: `main` at `bc71cc5738435dd308b274a0ab735489772cf0e1` (the M5-WO3 merge), verified against `origin/main` before
  any change and again before commit — main had not advanced.
- Branch: `m5-wo4`, one commit on top of the base.

## 2. Source Authority

Precedence unchanged: (1) designer rulings — the M5-WO4 work order §5–§75; (2) CanonDecisions (none new); (3) Core
Playtest V0.1; (4) older material. Locators re-read from the verified Core Playtest bytes (SHA-256 prefix `21fa6771`,
`prowess-docx-structure@1.0.0`, 2,487 sections): s118–s120, s161, s624, s626, s627, s678–s687, s716–s733 (plus s69–s71,
s436, s438, s441–s442 for the Movement amendment). Where the quick reference (s687) and the chapters (s716–s733) group
Strengths differently (Enhancement, Manipulation), the work order's explicit tables are structured; source text is
unchanged.

## 3. Designer Clarifications Applied

- Affinity is shared by SPELL and MANEUVER; it never changes AbilityKind (§5).
- Shared: identity, ownership, rank, Strength / Weakness Keywords, alignment, access (§6).
- Spell MP fragment only; Maneuver cost application and Summon cost are later Work Orders (§7–§9).
- Keywords may come from any component, explicitly (§61–§66).
- Movement terminology and M5-SC-034 Sprint ruling (§10–§19).

## 4. Movement Terminology Amendment

Post-WO3 canon amendment applied in WO4 (WO3 history not rewritten — the WO3 architecture doc gained a dated amendment
note; the WO3 completion report is untouched):

- `core.derived.base_movement`: expression `5` (ft) — the authored standard creature value.
- `core.derived.final_movement` → `core.derived.movement`, statistic `MOVEMENT`: `base_movement * agi + bonuses`.
- Move grants `movement`; Sprint grants `movement * 4`.
- `CREATURE_SIZE.movementAdjustment` → `baseMovement` (must be null).
- "Final Movement" / "Total Movement" are LEGACY terminology → Movement; no TOTAL_MOVEMENT / FINAL_MOVEMENT statistic.
- Standard character unchanged: Base 5 ft, AGI 4 → Movement 20 ft → Sprint 80 ft. Content `revisions` record the
  amendment. WO2 / WO3 Inspector fixtures regenerated — only derived-statistic `order` positions changed.

## 5. M5-SC-034 Resolution

`RESOLVED_BY_DESIGNER` (authority M5-WO4 §12–§14). Sprint Allowance = Movement × 4 per execution; two Sprints are
80 + 80, never × 4 × 4. The WO3 entry text is kept and the ruling appended. M5-I112.

## 6. M5-SC-033 Status

`UNRESOLVED`, retitled "Base Movement Values By Creature Size". Known: Movement = Base Movement × AGI, standard Base
Movement 5 ft. Unknown: Size values. `baseMovement` must be null; occupied space never implies Base Movement. No value
invented. M5-I113.

## 7. M5-SC-035 Status

New, `UNRESOLVED`: starting rank of a new Level 9 Affinity. `GAIN_NEW_AFFINITY` has `startingRank: null`,
`conflictKey: "M5-SC-035"`; profiles that reach it validate as `REQUIRES_CANON`, never VALID. M5-I119.

## 8. Invariant Supersession

M5-I073 → SUPERSEDED by M5-I075 (unchanged). M5-I075 → SUPERSEDED by M5-I111 (`status` / `supersededBy` in JSON, a
Status line in the markdown). Nothing deleted or renumbered.

## 9. Files Created

- `packages/prowess-game/src/affinity/{compile,definitions,profile,results}.ts`
- `packages/prowess-game/src/definition/affinity-payload.ts`, `vocabulary/affinity.ts`
- `packages/prowess-game/src/content/core-playtest-v0.1/affinity.json`
- `packages/prowess-game/src/testing/{affinity-fixtures,affinity-run}.ts`
- `packages/prowess-game/src/{affinity-golden,affinity-contracts}.test.ts`
- `packages/prowess-db/tests/integration/prowess-affinity-history.test.ts`
- `packages/prowess-db/tests/unit/m5-wo4-inspector-fixture.test.ts`
- `apps/studio/tests/unit/{m5-wo4-static.test.ts,m5-wo4-audit-helpers.ts}`
- `apps/studio/tests/integration/m5-wo4-affinity-api.test.ts`, `fixtures/m5-wo4-affinity-plans.json`
- `scripts/m5-wo4-negative-controls.mjs`
- `docs/architecture/{m5-affinity-structured-rules.md,m5-wo4-baseline.json,m5-wo4-completion-report.md}`

## 10. Files Modified

- Game: `vocabulary/{core,families,terminology}.ts`, `definition/{codes,envelope,payload,runtime-payload}.ts`,
  `compilation/compile.ts`, `internal/order.ts`, `index.ts`, `core-resolution.json`, `runtime-resources.json`.
- Game tests (narrow Movement updates): `core-contracts`, `core-resolution-golden`, `runtime-contracts`,
  `runtime-resources-golden`, `vocabulary`.
- Studio: `m5-wo1-static.test.ts` (150 invariants, `m5-wo[1234]` guard regex), `m5-wo3-static.test.ts` and
  `m5-wo3-audit-helpers.ts` (amended Movement rules, SC-034 resolved, I075 superseded), WO2 / WO3 fixtures (order only).
- `scripts/m5-wo3-negative-controls.mjs` (§176 mutates `baseMovement`).
- Docs: `ci.md`, `m5-core-playtest-source-conflicts.md`, `m5-invariants.{md,json}`,
  `m5-runtime-resources-action-economy.md` (amendment note). `.github/workflows/ci.yml`.

## 11. Files Removed

None.

## 12. Database / Migration Status

No Prisma schema change, no migration (schema hash and migration hashes equal `m5-wo1-baseline.json`). Affinity uses
existing EntityVersion `structuredData.prowessDefinition` (AFFINITY payload schemaVersion 2) under GENERIC_RULE and real
M1 KeywordDefinition rows. No new endpoint (route inventory equals the WO3 baseline). No data-model blocker.

## 13. Canonical Affinity List

EVOCATION, CONJURATION, TRANSMUTATION, DIVINATION, ENHANCEMENT, MANIPULATION — one version-2 Definition each,
`affinity.<name>`. Two executable Definitions of one Affinity fail closed. M5-I114.

## 14. Evocation / Emission Handling

Evocation canonical; "Emission" anywhere in a canonical payload → `LEGACY_TERM_AS_CANONICAL`; no `affinity.emission`;
provenance may carry the legacy pair. M5-I115.

## 15. Affinity Definition Contract

AFFINITY v1 `{ affinity }` (WO1, kept readable, never executable). v2 `{ affinity, identity { text, themes },
strengths[{ strengthKey, matchAny }], weaknesses[{ weaknessKey, matchAny, activationPenaltyPercent, severity|null }],
source }`. Identity is the exact Entity + EntityVersion + canonical key envelope.

## 16. Affinity Rank Contract

`AFFINITY_RANKS = NONE, TRAINED, EXPERT, MASTER` (names only). Order and meaning live in `AFFINITY_RANK_RULE`; compared
by M4 `RANK_AT_LEAST` on authored orders, never strings. NONE ≠ Skill UNTRAINED. M5-I120.

## 17. Rank Rule Content

`affinity.rank_rule`: NONE 0 / 0% / no authority; TRAINED 1 / 10% / 1 Effect, 1 Trait; EXPERT 2 / 20% / 2, 2; MASTER
3 / 30% / 3, 3; `authorityMinimumRank: TRAINED`. Reader requires capacity exactly at and above the minimum. M5-I121.

## 18. Character Affinity Profile

`{ primaryAffinity, affinities[{ affinity ref, identity, rank, role PRIMARY|SECONDARY, acquisition { level, optionKey }
| null }] }`. Exact executable bundle refs only; no version mixing; identical duplicates collapse, conflicting ones fail
(`DUPLICATE_AFFINITY_OWNERSHIP`); exactly one PRIMARY; detached and frozen; ordered PRIMARY-first then canonical key.
M5-I116.

## 19. Primary Affinity

Chosen at Level 1 at NONE: Strength / Weakness identity active, discount 0%, no Authority capacity. M5-I117.

## 20. Secondary Affinity

A real whole Affinity — own Definition, rank and access; never weakened for being Secondary.

## 21. Affinity Progression

`affinity.standard_progression` (s161) interpreted generically by `validateAffinityProgression`: L1 primary NONE, L3
primary TRAINED, L6 EXPERT or Secondary TRAINED, L9 upgrade / promote / gain-new (unresolved). Returns VALID / INVALID
/ REQUIRES_CANON, the matching path, the next Level's options (structural), and explicit provenance-backed overrides.
Verified: L1 NONE, L3 TRAINED, L6 EXPERT, L6 TRAINED+Secondary valid; L2 MASTER, L3 Secondary, L4 EXPERT, L6 MASTER,
L3 NONE invalid. No hidden maximum. M5-I117–I119.

## 22. Strength Rule Contract

`{ strengthKey, matchAny: exact canonical Keyword keys }` → ANY exact Keyword present.

## 23. Weakness Rule Contract

`{ weaknessKey, matchAny, activationPenaltyPercent, severity | null }`; each checked independently.

## 24. Standard Weakness Severity

`affinity.weakness_severity`: MINOR 10, MODERATE 20, MAJOR 30 — reference content.

## 25. Exact Weakness Percentage Handling

`activationPenaltyPercent` is authoritative; finite, ≥ 0, 0 legal and preserved, no 100% cap. M5-I124.

## 26. Divination +15% Handling

Exactly 15 with `severity: null`. Note: M4 percentage math is IEEE-754, so 100 × 1.15 = 114.99999999999999; the golden
asserts M4's exact value (≈115, never 110 / 120). WO4 does not round (M5-SC-028 stays with the cost pipeline).

## 27. Keyword Contributions

Each component Definition's authored `keywords` → M4 KEYWORD contributions with source
`prowess.<contract>` / componentKey / EntityVersion id / rule provenance, ordinal = component position. Targeting,
Effects, Traits, Durations, Ability Conditions all contribute. Composition-level `keywords` do not. M5-I131.

## 28. Exact Keyword Matching

KEYWORD_PRESENT by exact KeywordDefinition id from the caller's M1 catalog; unknown keys fail closed
(`UNKNOWN_KEYWORD`); no case folding, substring, alias or display name anywhere in the Affinity layer (audited).
Geometry never contributes. M5-I123, M5-I132.

## 29. Governing Affinity

The composition's explicit `affinity` component; must be the exact owned Version; rank from the profile. Missing →
`GOVERNING_AFFINITY_REQUIRED`; not owned → `GOVERNING_AFFINITY_NOT_OWNED`. Never auto-selected. M5-I133–I135.

## 30. Alignment Classification

STRENGTH / WEAKNESS / STRENGTH_AND_WEAKNESS / NEUTRAL, with every rule's matched flag, matched Keywords and
contributors kept.

## 31. Strength Discount Logic

One UNIQUE `REDUCE_PERCENT`, condition ANY Strength rule, operand = rank-rule percent (0 at NONE).

## 32. Multiple Strength Handling

Applied once: Expert DIRECT_DAMAGE + AREA_EFFECT 20 → 16, never 12.8. M5-I122.

## 33. Highest Weakness Logic

M4 MODIFIER: target 0, one `MAX` per Weakness conditioned on its Keywords → highest matched %; one `INCREASE_PERCENT`
whose operand is bound to that result. No foundation change needed. M5-I125, M5-I126.

## 34. Strength + Weakness Ordering

Strength phase 1, Weakness phase 2 in one M4 step: 100 → 80 → 104 (never 110). M5-I127, M5-I128.

## 35. No-Rounding Boundary

17 at Trained → 15.3. No rounding anywhere in the Affinity layer (audited). M5-I129.

## 36. Affinity Authority

Explicit `authority: { authority: AFFINITY_AUTHORITY | ARCANE_AUTHORITY }` on the composition; Affinity Authority →
M4 RANK_AT_LEAST (≥ TRAINED) + capacity + per-Effect specialization (Strength, Weakness-with-penalty, or explicit grant).
Failures are not-satisfied results. M5-I136.

## 37. Effect Capacity

1 / 2 / 3 via M4 NUMERIC_COMPARE `<=`; 3 Effects at Expert not satisfied, never truncated. M5-I137.

## 38. Trait Capacity

Base 1 / 2 / 3, same mechanism; Trait exchange deferred. M5-I138.

## 39. Arcane Authority Boundary

ARCANE_AUTHORITY → `ARCANE_AUTHORITY_NOT_IN_SCOPE` (Arcana capacity is later Spell Creation work).

## 40. Authority Non-Stacking

Arcana Expert + Affinity Expert under Affinity Authority → 2, never 4. M5-I139.

## 41. Trait Access

`AFFINITY_ACCESS` → M4 `ALL(ENTITY_OWNED, RANK_AT_LEAST, KEYWORD_PRESENT…)`. Owns Expert / needs Expert → satisfied;
owns Trained → not satisfied (valid result). Access carries no cost. M5-I141.

## 42. Effect Access

Same primitive (any requirement key, optional required Keywords against an explicit composition); unowned Affinity →
ownership-only predicate → not satisfied.

## 43. Spell MP Affinity Fragment

`SPELL_AFFINITY_COST { composition, costTarget: LISTED_MP_COST, baseCost }` → target `spell.listed_mp_cost`.

## 44. AP Boundary

No AP target, resource or operand in any Affinity plan; AP stays a later MP-derived rule. M5-I143.

## 45. ME / Payment Boundary

Affinity changes listed MP; ME never appears in the plan and later pays the listed cost. M5-I142.

## 46. Maneuver Affinity Boundary

`SPELL_AFFINITY_COST` refuses MANEUVER (`SPELL_AFFINITY_COST_SPELL_ONLY`); Maneuvers use ALIGNMENT and ACCESS.
M5-I144, M5-I145.

## 47. Summon Reuse Boundary

Definitions, rank rule, profile and ALIGNMENT / ACCESS subjects are subject-neutral; no Summon cost implemented.

## 48. M4 Keyword Mapping

One KEYWORD step for the Ability (plus one per Effect for Authority); M4 aggregates, orders and keeps contributors; the
reader uses M4's `findResolvedKeywordById`.

## 49. M4 Requirement Mapping

Rules → `ANY(KEYWORD_PRESENT)`; Authority → `RANK_AT_LEAST`, `NUMERIC_COMPARE`; specialization → `ANY(rules…,
SET_CONTAINS grants)`; access → `ALL(ENTITY_OWNED, RANK_AT_LEAST, KEYWORD_PRESENT)`.

## 50. M4 Modifier Mapping

Weakness selection (`MAX` × n) and cost (`REDUCE_PERCENT` phase 1 → `INCREASE_PERCENT` phase 2, operand bound). Keyword
sets reach conditions through bindings into `facts.keywords`.

## 51. Compilation Source Map

One entry per step: role, component keys, exact Definitions (governing Affinity, `affinity.rank_rule`, contributing
component Definitions). Steps ordered in fixed blocks (`AFFINITY_ORDER`) — no position arithmetic.

## 52. Provenance

Requirement / modifier nodes carry Affinity or rank-rule RuleProvenance; contributions carry EntityVersion ids; the
reading names each matched Keyword's contributing component and Definition. Explanation through M4 `buildExplanation`
(tested in game, API and fixture). M5-I146.

## 53. Historical Reproducibility

Pure (R1/R2 fixtures) and real-database (Release R1 → R2 pins Evocation v2 → R1 re-materialized and re-evaluated
deep-equal plan, run and result). No latest / current lookup. M5-I147.

## 54. Ruleset Isolation

R1 and R2 interleaved / concurrent each use their own Definition and rank rule (pure: 80 / 75 / 80 / 100; DB: 104 /
120); a bundle under another Ruleset is refused.

## 55. New M5 Invariants

M5-I111–M5-I150 appended after M5-I110 in `m5-invariants.{md,json}`, each with executing guards; M5-I001–I150 present.

## 56. Tests Added

- `affinity-golden.test.ts` (36), `affinity-contracts.test.ts` (36) — @prowess/game 240 → 312.
- `m5-wo4-static.test.ts` (137 incl. per-file audits and 41 in-memory controls).
- `m5-wo4-inspector-fixture.test.ts` (1), `prowess-affinity-history.test.ts` (2), `m5-wo4-affinity-api.test.ts` (3).

## 57. Golden Fixtures

All §175–§198 goldens pass: Movement 5 → 20, Sprint 80 (+80); rank 0/10/20/30; capacity 1/2/3 (Effects and Traits);
16; 16 not 12.8; 26; +30 only; 104; 15.3; Divination 115 (IEEE ≈); NONE 20 / 26; NEUTRAL; look-alike Keyword no match;
Authority valid / not satisfied / non-stacking; Trait access satisfied / not; historical; cross-Ruleset.

## 58. Static Architecture Audit

Permanent `M5-WO4 audit — Affinity identity, rank, authority & keyword alignment`: AST rules over every @prowess/game and
@prowess/rules production file (Affinity switches, Emission, fuzzy / case-folding, stacking, netting, order, rounding,
hidden percent math, auto-governing, multi-Affinity stacking, capacity addition, free Traits, AP, ME, geometry, latest /
current, global state, DB access, Total Movement, old Movement term, Affinity terms in M4) and content rules over
affinity / core / runtime content; M4 tree hash = WO2 baseline; schema / migrations / routes; terminology; register;
invariants; doc sections and diagrams; CI step.

## 59. Negative Controls

`scripts/m5-wo4-negative-controls.mjs`: 24 behavioural controls (§243–§265 plus M5-SC-034 reverted) — all caught and
restored byte-for-byte. Notes: §256, §257 and §263 are guarded statically (WO4 has no Trait cost, no AP and no registry
for a behavioural "latest" mutation to act on); §263's pure functions only see one bundle, so the static latest/current
rule is the historical guard there. WO1 (17), WO2 (18), WO3 (21) and M4-final controls re-run green.

## 60. Security / Plain-Data Audit

Getters, functions, cycles, `__proto__`, NaN, Infinity, negative percentages, unknown ranks, foreign refs, version
mixing, conflicting duplicates and malformed Keyword catalogs are rejected for payloads, profiles, progression input and
compilation requests.

## 61. Immutability / Serialization

Validated profiles and plans are detached and frozen; inputs unchanged after compilation; plans, runs and readings
JSON round-trip deep-equal; repeated evaluation deep-equal.

## 62. M4 Regression

@prowess/rules byte-identical (tree hash = WO2 baseline, 65 files); 659 rules tests and all M4 static gates pass.

## 63. M5-WO1 Regression

Definition architecture, composition, branch catalogs and source mapping unchanged; AFFINITY v1 still valid; WO1 audit
green (now covering 150 invariants).

## 64. M5-WO2 Regression

Stats, dice, ranks, attack, save, Dodge, Character DC, derived values unchanged; WO2 audit and controls green; fixture
regenerated (order positions only).

## 65. M5-WO3 Regression

Resources, action economy, allowance, Initiative, roll signals, ME/MP payment unchanged; only the Movement terminology /
Sprint clarification applied; WO3 audit and 21 controls green.

## 66. Documentation

`m5-affinity-structured-rules.md` (37 sections, §286–§291 diagrams), register, invariants, terminology, ci.md, WO3
amendment note, WO4 baseline, this report.

## 67. Local Verification

| Check | Result |
| --- | --- |
| lint / architecture / typecheck | pass |
| unit (ui 21, model 513, import 128, rules 659, game 312, db 88, studio 2,482) | 4,203 pass |
| DB integration | 503 / 513 — the 10 failures are the known migration-ledger tests (local DB built by psql, no `_prisma_migrations`) |
| Studio API integration | 116 / 116 |
| M5-WO1 / WO2 / WO3 / WO4 audits | pass |
| M4-final, WO1, WO2, WO3, WO4 negative controls | all caught and restored |
| non-test reset refusal | refused correctly |
| production build | pass |
| Playwright | 45 / 45 |

## 68. Environment Limitations

- Prisma engine download blocked (403): `prisma validate`, `generate`, drift check and the guarded `db:reset:test`
  could not run locally; the test DB was rebuilt by applying migration SQL with psql, which is why the 10 ledger tests
  fail locally. CI runs all of these.
- `pnpm install --frozen-lockfile` was not re-run (no dependency change).
- The cloud workspace cannot push to GitHub; delivery is a git bundle.

## 69. GitHub Verification Needed

Push `m5-wo4`, open the PR, confirm every gate (including Prisma validate / generate / drift "No differences", guarded
reset, the new M5-WO4 gate and Playwright), merge, and confirm merged-main CI is green before FINAL PASS.

## 70. Acceptance Criteria Status

Met locally: every §300 criterion except those that need GitHub — Prisma drift zero and merged-main CI (pending). No
M4 FOUNDATION CHANGE REQUEST and no DATA MODEL BLOCKER were needed. Open for the designer: M5-SC-033 (Size Base
Movement values) and M5-SC-035 (Level 9 new-Affinity starting rank).
