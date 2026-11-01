# M6-WO5 Implementation Report — Digital Character Sheet

PAS-10 M6-WO5, implemented on branch `m6-wo5` from main `d13efd8767a7a1dbef3debb53d879b23f7218446` (M6-WO4 merged,
with its CI timeout correction). Local implementation and verification only — not pushed, no PR, not merged.
Architecture: [m6-digital-character-sheet.md](../architecture/m6-digital-character-sheet.md). Invariants M6-I045 …
M6-I056: [m6-invariants.md](../architecture/m6-invariants.md). Design reference:
[m6-wo5-field-manual-character-sheet-mockup.png](../design/m6-wo5-field-manual-character-sheet-mockup.png).

## 1. Test Totals

Final local verification (fresh `prowess_studio_test`, all migrations applied, every package built):

| Suite | Result | Change since M6-WO4 |
| --- | --- | --- |
| @prowess/model unit | 513 passed (27 files) | — |
| @prowess/ui unit | 21 passed (1 file) | — |
| @prowess/import unit | 128 passed (5 files) | — |
| @prowess/rules unit (M4) | 659 passed (17 files) | — (M4 source unchanged) |
| @prowess/game unit | 998 passed (41 files) | +10 |
| @prowess/db unit | 145 passed (19 files) | — |
| @prowess/db integration | 578 passed (52 files) | +11 |
| Studio unit | 3271 passed (94 files) | +57 |
| Studio API integration | 221 passed (34 files) | +5 |
| Playwright | 55 passed, 0 flaky | +5 |
| Lint / architecture (13 rules) / typecheck / gate inventory / harness self-test / production build | pass | |
| Negative / mutation controls | 414 / 414 caught and restored across 19 scripts | +33 (M6-WO5) |

The first full run found one DB-integration failure: the `@prowess/db` export allowlist guard
(`entity-version-lifecycle.test.ts`) had not been given the twelve WO5 exports. They were added deliberately (with a
source check that the sheet repository never writes `entity_versions`), and the full DB integration suite was re-run on
a freshly reset database: 578 / 578.

New WO5 suites: `packages/prowess-game/src/character-sheet.test.ts`, `packages/prowess-db/tests/integration/
m6-wo5-character-sheet.test.ts`, `…/m6-wo5-migration-compat.test.ts`, `apps/studio/tests/unit/m6-wo5-static.test.ts`,
`…/m6-wo5-sheet-ui.test.tsx`, `apps/studio/tests/integration/m6-wo5-character-sheet-api.test.ts`,
`apps/studio/tests/e2e/m6-character-sheet.spec.ts` (sheet values + inline resources + notes + reload; portrait upload →
zoom → drag → save → reload → replace → remove; an advanced Level 6 Character; a newer Release that changes nothing;
two-page print with a PDF page count).

## 2. Architecture Gate

`M6-WO5 — Digital Character Sheet` (`scripts/ci/gates.json`, job `controls-2`, a step in the consolidated
`.github/workflows/ci.yml`; no `m6-wo5.yml`). The static gate (27 assertions) verifies: the schema registry entry and
that removing the marked WO5 additions restores the M6-WO4 schema; the WO3 / WO4 migrations untouched; no derived value,
equipment, ability or encounter table; image bytes only in `character_portrait_images`; RESTRICT and no trigger change;
one sheet builder that reads only bundle + ruleset + profile; the service builds from the Character's own Release and
its reads never write; notes read only into the notes view; sheet writes only to sheet tables; play-state validation
before the compare-and-set; per-row lockVersions; PNG / JPEG / WebP by signature and full decode with the size limit;
stored bytes never transformed; framing never touches the bytes; cover-fit aspect math; protected image serving; no
database / rules imports or arithmetic in the sheet UI; Accuracy / Dodge terminology; the equipment and effects
boundaries; the Sheet as default view; print in print mode; routes, methods, strict bodies and error mapping; the
approved M5 registry; M4 unchanged; invariants, documents and CI wiring.

## 3. Controls

`scripts/m6-wo5-negative-controls.mjs` — 33 mutation controls (≥ 24 required by §121) on the shared harness: frontend
max HP / Skill score / Save arithmetic, obsolete formula text, To-Hit terminology, stretched portrait, Sheet not
default, client-submitted maximum / Character Die / Skill score / Level, validation skipped, overheal accepted, latest
Release, a second profile builder, Performance omitted, an unavailable value guessed, a score from the wrong rank,
notes and Action Notes altering mechanics, frozen Ancestry / starting Stats editable, Affinity progression bypassed,
resources in advancement history, stale resource / portrait writes, destructive framing, SVG accepted, size limit
bypassed, bytes on the Character row, equipment / ability domains introduced, image served without nosniff. The
inventory grows from 381 to 414 across 19 scripts; every earlier control is unchanged and still caught.

## 4. Schema And Migration

Migration `20261101010000_m6_wo5_character_sheet_state` adds five tables — `character_play_states`,
`character_resource_states`, `character_sheet_notes`, `character_portraits`, `character_portrait_images` — registered
in `docs/architecture/m6-schema-changes.json` and marked in `schema.prisma` (three `// M6-WO5 back-relation` lines on
`Character`). FKs: each table → `characters(id)` or its parent sheet row, all `ON DELETE RESTRICT ON UPDATE RESTRICT`.
Primary keys: `character_id` (composite `character_id, resource_key` for resource states); no extra indexes. CHECKs:
lockVersion ≥ 1 (three tables), possessions is a JSON array, framing within zoom 1–5 / offsets −1…1, image metadata
all-or-nothing with only PNG / JPEG / WebP up to 8 MB. No trigger or function is created or replaced; no existing table
changes. `m6-wo5-migration-compat.test.ts` upgrades a WO4 database with real data and proves nothing else changes.
The local sandbox has no Prisma schema engine, so `prisma migrate diff` (drift) runs only in GitHub Tier 2.

## 5. Approved M5 Change

`docs/architecture/m6-approved-m5-changes.json` (M6-WO5): `index.ts` exports the sheet API; added
`character/sheet.ts` and `character-sheet.test.ts`. No Definition kind, reader, validator or compiler changes.

## 6. Earlier Gates Adjusted (exact, registered)

- M6-WO4 static: its frozen-file check uses `expectedFrozenHash` (accepts only a later registered hash); its schema
  check strips WO4 and every LATER registered Work Order's marked additions; its invariant check reads the first 44.
- M6-WO3 static: no change needed beyond the WO4 adjustments (registry-driven).
- M2 final static: the four WO5 sheet commands join the reviewed public-surface list.
- M4-WO7 static: reads the certified schema (`frozenSchemaText`, registered later additions removed).
- DB `entity-version-lifecycle`: the twelve WO5 exports join the reviewed allowlist; the sheet repository is proven not
  to write `entity_versions`.
- WO3 / WO4 UI and E2E specs: a completed Character now opens on the Sheet, so they select the Advancement tab first.
- `@prowess/db` declares `sharp@0.35.4` (already installed via Next.js) for portrait decoding.

## 7. Known Limitations

See the architecture document §10: Concentration capacity, Attunement and Carry & Weight are unavailable until the Release
defines Character rules for them; possessions are freeform text until M6-WO6; no Granted Effect instances exist yet;
advancement does not refill current resources; print overflow is decided by a line / row budget. M5-SC-042 … 053
remain unresolved.
