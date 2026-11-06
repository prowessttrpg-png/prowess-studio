# M6-WO9 — Character Ability Card System implementation report

Status: Phase D implementation and focused local verification complete. **Not certified.** WO9 is final only after its published source tree passes the complete required GitHub Actions workflow (Tier 2) in a fresh same-commit run, which needs separate publication authorization. No PR, merge, `main` change, canonical Release change or later Work Order is authorized by this report.

Architecture: `docs/architecture/m6-ability-card-system.md`. Invariants: M6-I129 – M6-I150.

## 1. Phases and checkpoints

| Phase | Commit | Tree | Content |
| --- | --- | --- | --- |
| Baseline | `fd6d89aa71007f4d4e9561755cbb5e9c10ea7987` | — | Certified `main` (CI run 42132773265, 16 jobs green) |
| A | `cac67673a4e0fbf61e9996c86293864ae28a2758` | `a6ecf244c622d097ae8d10148732e766c4ec2fec` | Card Presentation Contract v1, semantic rules model, Card Rules Language, Spell / Maneuver projections (one additive WO8 change: the evaluation retains its execution groups) |
| B | `11c21e881600fa7e6d0f31aa9abb783fa15eee02` | `046f77ea82665bbebe2a05f1d606d3d67bd36d0f` | Weapon / Attack / General Action / Mage Art cards, `ACTION_IMPROVEMENT` v1 and evaluation, read-only DB card services |
| C | `7cddc7fcb95fcd5480503c3827d8c1d2ee714189` | `4a8842e434e1efd3fc5ad10dad10e76d2bf6f281` | Studio Card Library, five-mode viewer, Action Directory, progression drawer, print, Sheet links, two read-only routes |
| D | see checkpoint | see checkpoint | Invariants, permanent gate, 46 mutation controls, CI registration, documentation |

Local tags `m6-wo9-phase-a`, `-b`, `-c`, `-d` and all recovery bundles are preserved.

## 2. What the system does

- **Cards.**
  - Signature Spell / Maneuver cards from the WO7 / WO8 evaluations: current, draft and historical revisions. Retired Abilities are presented as historical.
  - Weapon and Attack cards from the WO6 Attack Library for the current loadout.
  - General Action cards from the Release's ACTION Definitions.
  - Mage Art: an unavailable domain.
- **Rules language.** Deterministic templates over the semantic model. Saving Throws are keyed to the defender (C4); the five chain behaviors, delivery / NOT_DELIVERED, triggers / NOT_TRIGGERED and independent Maneuver groups are proven against the M5-WO12 executor.
- **Action Improvements.**
  - An additive `ACTION_IMPROVEMENT` kind (C1) with an exact parent ACTION, independent M4-evaluated prerequisites and supported / reference / unsupported modifications.
  - Five progression states that require authoritative evidence: FUTURE only for a Level within the Release's range; UNAVAILABLE only for proven impossibility; everything else UNRESOLVED.
- **APIs.** `GET /api/characters/:id/cards` and `GET /api/characters/:id/actions` — strict, Character-scoped, read-only.
- **Studio.**
  - Card Library with search, category filter and opt-in history.
  - Viewer: Illustrated, Tactical, Front / Back, Combined and Print.
  - Progression drawer with focus trap and restore; Action Directory.
  - Digital-only Sheet links.
- **Print.** 4 × 6 in card pages with numbered continuations, duplex pairs, snapshot identity on every page, and a combined Letter layout. Validated in real Chromium layout and PDF (C5).

## 3. Phase D — permanent protection

**Invariants.** M6-I129 – M6-I150 (22 rows) cover:
- contract and provenance;
- no card authority;
- deterministic language;
- Saving Throw keying, the five behaviors and per-target paths;
- Maneuver groups and Powerful Blow;
- exact costs;
- Weapon / Attack identity;
- the improvement contract, prerequisites, progression evidence and unsupported operations;
- Mage Art;
- revision distinctions;
- strict APIs;
- viewer accessibility;
- drawer and directory authority;
- print;
- Sheet and historical compatibility.

Every row names existing guards, the WO9 static gate and the mutation script; the static gate checks that.

**Static gate.** `apps/studio/tests/unit/m6-wo9-static.test.ts` (19 tests, prefix `W9-`):
- M5-WO1 / WO3 audits of every game card module;
- exact card-key templates;
- cost copying only from usable evaluations;
- Saving Throw and chain templates;
- Maneuver group rendering;
- loadout-only Weapon / Attack cards;
- the improvement contract, prerequisite evaluation and progression derivations;
- unsupported-operation handling;
- Mage Art;
- revision handling in the service and Studio;
- routes (GET, strict query, UUID) and a write-free service;
- a Studio card-UI audit (no domain imports, no writes, no arithmetic on card values);
- viewer modes, drawer and focus behavior;
- print CSS and pagination structure;
- Sheet integration;
- the invariant catalog.

**Registration.**
- **Gate:** `M6-WO9 — Character Ability Card System`, added to `scripts/ci/gates.json` (41 gates) and to the consolidated `controls-2` job in `.github/workflows/ci.yml`. No new workflow was created.
- **Gate inventory test:** `apps/studio/tests/unit/ci-gate-inventory.test.ts` keeps every historical assertion and now expects 617 controls across 23 scripts. It also checks that the WO9 browser suite sits in the Playwright `testDir` that the e2e job runs (`pnpm run test:e2e`). `playwright test --list` discovers the 6 `m6-cards.spec.ts` tests (77 tests in 17 files).

**Gate suites.**
- Game: card language, projection and Phase B tests; the WO9 and WO6 registry guards; the Spell / Maneuver cost goldens.
- Database: the DB card-library integration test.
- Studio: the WO9 static gate, the card UI tests and the card API integration test.

**Mutation controls.** `scripts/m6-wo9-negative-controls.mjs` — 46 controls on the CLOSEOUT-03 harness. Each one gets a green baseline per guard, one uniquely anchored real source edit, the intended guard failing for the named reason, and byte-for-byte restore plus a whole-tree check. Coverage:

| Area | Controls |
| --- | --- |
| Release attribution; other-Release re-evaluation; retired-as-current; ability links to drafts / history; retired / draft as usable; unknown-key fallback | 01–07 |
| Weapon / Attack / damage-profile substitution | 08–10 |
| Browser cost math; plausible zero for unresolved values (UI and game) | 11–13 |
| Inverted Saving Throw language (Spell and Weapon Attack); SUCCESS_ONLY and BRANCH transitions; a dropped chain Effect; NOT_TRIGGERED; NOT_DELIVERED | 14–20 |
| Spell semantics on Maneuver groups; Powerful Blow order | 21–22 |
| Fabricated Mage Art | 23 |
| Prerequisite bypass; FUTURE / UNAVAILABLE / UNRESOLVED misclassification; unsupported operation applied; non-overridable parent; ineligible improvement changing AP; improvement on every Action | 24–31 |
| Card reads writing the database; API accepting client values; API write route | 32–34 |
| Mode change dropping the card; drawer Escape and focus restore; drawer group order | 35–38 |
| Print snapshot identity, dropped blocks, clipping, unmarked continuations, duplex pairing | 39–43 |
| Sheet link to a non-current revision, missing hand, links on paper | 44–46 |

No historical guard was weakened or rewritten.

**Integration correction.** None was needed. Phase D changed no product source; the Phase A – C behavior is preserved.

## 4. Verification

**Local results (real):**

| Suite | Result |
| --- | --- |
| Studio unit / static (all, including the WO9 gate and gate inventory) | 3614 / 3614 (102 files) |
| WO9 gate game suites (card language, projection, Phase B, WO9 / WO6 registries, cost goldens) | 118 / 118 (7 files) |
| DB integration: WO7 + WO8 + WO9 (+ WO7 / WO8 migration compatibility) | 28 / 28 (5 files) |
| Studio API integration: WO7 + WO8 + WO9 | 10 / 10 (3 files) |
| Playwright full suite (`pnpm run test:e2e` against the production build), including the 6 WO9 browser / print tests | 77 / 77 (17 files; the 6 `m6-cards.spec.ts` tests passed) |
| M6-WO9 mutation controls | 46 / 46 caught and restored (17 baseline + 46 mutation runs; working tree unchanged) |
| Production build (`next build`) | success |
| Lint / typecheck / architecture check | 0 / 0 / passed (13 rules, 7 packages) |
| Prisma schema validation | valid |

From earlier phases, and unchanged by Phase D (no product source changed):
- full `@prowess/game` suite: 1794 / 1794 (Phase B);
- WO7 controls: 68 / 68 and WO8 controls: 36 / 36 (Phase C, after the Sheet changes).

**Pending in CI (not claimed as passed):**
- the complete same-commit GitHub Actions run (Tier 2): every DB / API matrix shard, every historical control script (the 571 historical controls plus WO9's 46), Prisma migrate / drift, the full Playwright job and the merge-readiness summary.

## 5. Scope reconciliation

**Completed.** Every approved WO9 capability:
- contract and provenance;
- the language with C4;
- Spell / Maneuver / Weapon / Attack / General Action cards;
- the Mage Art unavailable state;
- the `ACTION_IMPROVEMENT` contract (C1) and its progression states;
- read-only services and APIs;
- Card Library, five-mode viewer, progression drawer, Action Directory and Sheet links;
- 4 × 6 print with continuations (C5);
- the no-art placeholder (C3) and the test-only target-selection hook (C2).

**Intentional deferrals (recorded, not invented):**
- **Release-only Action Directory:** the directory is Character-scoped. A Release-only view needs a service that evaluates without a Character.
- **Card descriptions:** Weapon, Attack and General Action authored descriptions are unavailable pending an authoritative text source.
- **Mage Arts:** mechanics are not implemented; the domain is unavailable.
- **Canonical Action Improvements:** none published. The improvement rows in tests are test-only fixtures.
- **Temporary encounter modifiers:** unsupported without an authoritative evaluation context.
- **Summon cards:** future scope.
- **Presentation test world:** composes three isolated test Releases. These are fixtures, not canonical content. Release scoping is proven by the DB and API suites.

**Unmet acceptance requirements:** none known locally. Final acceptance depends on the pending same-commit CI run.
