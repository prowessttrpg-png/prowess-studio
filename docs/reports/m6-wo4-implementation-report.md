# M6-WO4 Implementation Report — Character Advancement, Access & Eligibility

PAS-10 M6-WO4, implemented on branch `m6-wo4` from main `77f9430f68caf60babfb0c54496090d5ace11f86` (M6-WO3 merged).
Local implementation and verification only — not pushed, no PR, not merged. Architecture:
[m6-character-advancement-access.md](../architecture/m6-character-advancement-access.md). Invariants M6-I031 … M6-I044:
[m6-invariants.md](../architecture/m6-invariants.md).

## 1. Test Totals

Final local verification (fresh `prowess_studio_test`, all migrations applied, every package built):

| Suite | Result | Change since M6-WO3 |
| --- | --- | --- |
| @prowess/model unit | 513 passed (27 files) | — |
| @prowess/ui unit | 21 passed (1 file) | — |
| @prowess/import unit | 128 passed (5 files) | — |
| @prowess/rules unit (M4) | 659 passed (17 files) | — (M4 source unchanged) |
| @prowess/game unit (M5 + WO3 + WO4) | 988 passed (40 files) | +30 |
| @prowess/db unit | 145 passed (19 files) | +1 |
| @prowess/db integration | 567 passed (50 files) | +12 |
| Studio unit | 3214 passed (92 files) | +66 |
| Studio API integration | 216 passed (33 files) | +5 |
| Playwright | 50 passed, 0 flaky | +2 |
| Lint / architecture (13 rules) / typecheck / gate inventory / harness self-test / production build | pass | |
| Negative / mutation controls | 381 / 381 caught and restored across 18 scripts | +37 (M6-WO4) |

New WO4 suites: `packages/prowess-game/src/character-advancement.test.ts`, `…/m6-wo4-registry.test.ts`,
`packages/prowess-db/tests/integration/m6-wo4-advancement.test.ts`, `…/m6-wo4-migration-compat.test.ts`,
`apps/studio/tests/unit/m6-wo4-static.test.ts`, `…/m6-wo4-advancement-ui.test.tsx`,
`apps/studio/tests/integration/m6-wo4-advancement-api.test.ts`, `apps/studio/tests/e2e/m6-character-advancement.spec.ts`
(Level 1 → 2 and 2 → 3 through the UI; a complex Level 5 → 6; a newer Release with a different schedule that changes
nothing for the Character; history display).

## 2. Architecture Gate

`M6-WO4 — Character Advancement, Access & Eligibility` (`scripts/ci/gates.json`, job `controls-2`, a step in the
consolidated `.github/workflows/ci.yml`; no `m6-wo4.yml`). The static gate verifies: the schema registry entry and that
removing the marked WO4 additions restores the M6-WO3 schema byte-for-byte; the WO3 migration untouched; choices-only
advancement tables with composite exact-version FKs and RESTRICT; the one-Level CHECK and Level / append-only triggers;
the repository's single compare-and-set transaction that never touches creation rows; exact-Release resolution with
manifest verification before commit; no caller-supplied Level; one profile builder; no hard-coded Level, cadence, die
or option; M4 modifiers / Requirements and the M5 Affinity validators in use; exact pins; eligibility from M5 structured
prerequisites only (no new kind, no unlock table, no Rules Text); Studio imports and arithmetic; the client contract;
the Level 1 creation record; route registry, methods and thinness; error mapping; the approved M5 change registry; M4
unchanged; invariants, documents and CI wiring.

## 3. Controls

`scripts/m6-wo4-negative-controls.mjs` — 37 mutation controls (≥ 28 required by §138) on the shared CLOSEOUT-03 harness:
Level skip, hard-coded maximum, coherence dropped, history skip, client-supplied Level, database Level jump, extra
schema version; Stat Points over / under the entitlement, STAT maximum bypassed, Studio Stat arithmetic, local point
counting, hard-coded cadence; Skill training stacking, rank skipping, required count ignored, double advancement;
automatic Affinity step as a choice, M5 validator verdict ignored, unresolved option guessed; another revision accepted,
latest Release, integrity verification skipped; stale lockVersion, history rewritten, creation rows rewritten, database
history edits allowed, derived value persisted, second profile builder, client-sent Level, Advance enabled before READY;
eligibility pin dropped, unrelated Skill satisfies, unmet = eligible, new prerequisite kind, Rules Text parsed, unlock
table. The inventory grows from 344 to 381 across 18 scripts; every pre-WO4 control is unchanged and still caught.

## 4. Schema And Migration

Migration `20261031010000_m6_wo4_character_advancement` adds `character_advancements`,
`character_stat_advancements`, `character_skill_advancements`, `character_affinity_advancement_choices` (registered in
`docs/architecture/m6-schema-changes.json`, marked in `schema.prisma`), CHECK constraints, a replaced `characters_guard`
(Release immutable and creation freeze kept; Level only +1 with its advancement row) and append-only guards. No
existing table, column or migration changes; `m6-wo4-migration-compat.test.ts` applies it over the WO3 chain.

## 5. Approved M5 Changes

Registered in `docs/architecture/m6-approved-m5-changes.json` (M6-WO4): `CHARACTER_ADVANCEMENT_RULE` v1 activated in
`vocabulary/families.ts`, its reader dispatched in `definition/payload.ts`, `compile.ts` maps it to no compiler,
`index.ts` exports the WO4 API, and the WO3 registry test excludes the later kind. Added: the payload reader,
`character/advancement.ts`, `character/eligibility.ts`, `character/requirements.ts`, fixtures and tests. No existing
M5 reader, validator or compiler result changes (`m6-wo4-registry.test.ts`: the other 41 kinds are byte-identical).

## 6. Scope Boundaries

Not changed: M4 Formula semantics, M5 construction legality, M2 publication. Not built: automatic Release migration,
respec, unlock tables, new prerequisite kinds, prose parsing, Spells, Maneuvers. M5-SC-042 … 053 remain unresolved.
The WO2 control-hardening commit (`b2f0a0f`) is not folded into this Work Order (§144).

## 7. Known Limitations

See the architecture document §11. The canonical Core Playtest content ships no authored Character Creation or
Advancement Rule yet; all tests use test-only rules under `test.*` canonical keys.
