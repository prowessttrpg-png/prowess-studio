# M6-WO3 Implementation Report — Character Domain Model & Character Creation

Branch `m6-wo3` from `main` 89b0834020dcdc6f8ffc9a1483eeb871b5625077. Local implementation and verification only
(PAS-10 M6-WO3 §119): nothing is pushed, no pull request is opened, nothing is merged.

Architecture: `docs/architecture/m6-character-domain.md`. Invariants: M6-I021 … M6-I030
(`docs/architecture/m6-invariants.md` / `.json`).

## 1. Scope Delivered

- Release-first Character persistence (four typed tables, one migration, database guards), exact Release pin, no
  automatic Release following.
- Registry extension exactly as authorized: `ANCESTRY` v1, `SKILL` v1, new `CHARACTER_CREATION_RULE` v1 (CHARACTER).
- Pure creation validator / capability / M5-derived preview in `@prowess/game`; persistence, Release loading,
  integrity verification and transactions in `@prowess/db`; thin API routes; the Studio wizard.
- WO1 authoring descriptors and editors and WO2 Rules Reference presentation for the three kinds.

## 2. Schema And Migration

Migration `20261029010000_m6_wo3_character_foundation`: `characters`, `character_stat_allocations`,
`character_ancestry_stat_choices`, `character_skill_ranks`; RESTRICT foreign keys (Release; composite exact
EntityVersion pairs for Ancestry, Primary Affinity and Skills); CHECK constraints; triggers
`CHARACTER_RELEASE_IMMUTABLE` and `CHARACTER_CORE_FROZEN`. Registered in `docs/architecture/m6-schema-changes.json`;
the earlier frozen gates compare the schema with exactly the marked WO3 additions removed (byte-identical to the
M6-WO2 certified hash) and the migration chain without exactly the registered WO3 migration.

## 3. Approved M5 Changes

`docs/architecture/m6-approved-m5-changes.json` lists the five changed `@prowess/game` files (families, payload
dispatch, compiler table, index exports, the core-contracts assertion for ANCESTRY / SKILL) and the added files with
their exact hashes; earlier gates accept only those. `src/m6-wo3-registry.test.ts` proves every other pre-WO3 kind
specification is byte-for-byte unchanged (`src/testing/m6-wo3-registry-baseline.json`, generated from the base commit).

## 4. Test Totals

Final local verification (fresh `prowess_studio_test`, all migrations applied, every package built):

| Suite | Result |
| --- | --- |
| @prowess/model unit | 513 passed (27 files) |
| @prowess/ui unit | 21 passed (1 file) |
| @prowess/import unit | 128 passed (5 files) |
| @prowess/rules unit (M4) | 659 passed (17 files) |
| @prowess/game unit (M5 + WO3) | 958 passed (38 files) |
| @prowess/db unit | 144 passed (19 files) |
| @prowess/db integration | 555 passed (48 files) |
| Studio unit | 3148 passed (90 files) |
| Studio API integration | 211 passed (32 files) |
| Playwright | 48 passed |
| Lint / architecture (13 rules) / typecheck / gate inventory / harness self-test / production build | pass |
| Negative / mutation controls | 344 / 344 caught and restored across 17 scripts (M6-WO3: 28) |

New WO3 suites: `packages/prowess-game/src/character-creation.test.ts`, `packages/prowess-game/src/m6-wo3-registry.test.ts`,
`packages/prowess-db/tests/integration/m6-wo3-character.test.ts`, `…/m6-wo3-authoring-to-character.test.ts`,
`…/m6-wo3-migration-compat.test.ts`, `apps/studio/tests/unit/m6-wo3-static.test.ts`, `…/m6-wo3-character-ui.test.tsx`,
`…/m6-wo3-compendium-integration.test.tsx`, `apps/studio/tests/integration/m6-wo3-character-api.test.ts`,
`apps/studio/tests/e2e/m6-character-creation.spec.ts`.

## 5. Architecture Gate

`M6-WO3 — Character Domain Model & Character Creation` (`scripts/ci/gates.json`, job `controls-2`, step in the
consolidated `.github/workflows/ci.yml`; no `m6-wo3.yml`). The static gate verifies: Characters are not Entity records;
the exact Release is persisted and immutable; no latest-Release lookup; exact composite references; no derived column;
lockVersion compare-and-set and one transaction; service + database freeze; Level is server-owned; no formula, catalog,
budget or bound in Studio or the database services; the frontend imports no database / domain package; exact Release
Rules Reference links; no equipment / ability / advancement feature; route registry and methods; error mapping; the
approved M5 change registry; M4 unchanged; invariants, documents and CI wiring.

## 6. Controls

`scripts/m6-wo3-negative-controls.mjs` — 28 mutation controls on the shared CLOSEOUT-03 harness (the 24 required by §109
plus: frontend database import, finalization without integrity verification, non-executable Affinity, rule links
without the exact Release). All pre-WO3 controls are unchanged; the inventory grows from 316 to 344 across 17 scripts.

## 7. Known Limitations

As listed in `m6-character-domain.md` §9 (deferred by §115). Prisma `migrate diff` / drift cannot run in this sandbox
(the engine download is blocked); the migration SQL mirrors Prisma's output and is applied by the local substitute;
Tier 2 runs `migrate deploy` and the drift check permanently.
