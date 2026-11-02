# M6-WO6 — Weapon & Attack Library — Implementation Report

Status: **local implementation and local verification complete**, not published (§189).
Branch `m6-wo6` · base `3cedeab83bb3890bc5b7cc4855b37e9e946094d9` · HEAD: the local M6-WO6 commit on `m6-wo6`.
Architecture: `docs/architecture/m6-weapon-attack-library.md`. Invariants: M6-I057 … M6-I076.

## 1. Scope

Release-pinned Weapon & Attack Library: `WEAPON` and `EQUIPMENT_TRAIT` activated at v1, `ATTACK` added at v1 (family
`EQUIPMENT`, storage `GENERIC_RULE`), `ARMOR` still reserved; 47 baseline Weapon profiles, 141 Attacks and 38 Equipment
Traits as source content (`packages/prowess-game/src/content/core-playtest-v0.1/weapons.json`); a Character Weapon
loadout (one narrow migration); the Character Attack Library with damage preview; Shield modifiers in the one
`buildCharacterMechanicalProfile`; Dual Wield; Unarmed by Martial rank; a Maneuver adapter onto the M5-WO11 Attack
contract; WO1 editors, WO2 Weapon Library, sheet integration, Attack Library tab; five API routes.

Decisions recorded during the Work Order:

- **STATIC bridge** (user decision): one additive M5 field — the foundation damage may carry `scaling: "STATIC"` with
  `power: null, stat: null`; absent = the unchanged M5-WO11 shape. Registered in `m6-approved-m5-changes.json`.
- Attack resolution has a third mode `DEFERRED{reason}` for Pulse Cannon Shock Burst (canon states none).
- Profiles whose canon authors no handedness (Flexible Weapon, Sling, Energy Melee, Improvised) are displayed but never
  equipped by guess.
- Trait use sites are `WEAPON_PROPERTY` / `MOVE_PROPERTY`; the "no damage" outcome is `NO_DAMAGE` (distinct from
  other catalog vocabularies).

## 2. Test Totals

| Suite | Result |
|---|---|
| @prowess/game unit | 1351 passed |
| @prowess/db unit | 146 passed |
| @prowess/model / rules / import / ui unit | 513 / 659 / 128 / 21 passed |
| Studio unit (incl. all static gates) | 3359 passed (96 files) |
| @prowess/db integration | 592 passed (55 files, fresh database) |
| Studio API integration | 225 passed (35 files, fresh database) |
| Playwright E2E | 59 passed (4 new: §165 Long Blade, §166 Shield, §167 Rifle, §168 historical Release) |
| lint / typecheck / architecture / gate inventory / harness self-test | all clean |
| production build | clean |

New WO6 suites: `weapon-definitions` (243), `weapon-library` (46), `weapon-bridge` (9), `weapon-catalog-completeness`
(51), `m6-wo6-registry` (4) in @prowess/game; `m6-wo6-weapon-loadout` (11), `m6-wo6-migration-compat` (2),
`m6-wo6-authoring-to-release` (1) in @prowess/db; `m6-wo6-weapons-api` (4); `m6-wo6-static` (32) and
`m6-wo6-weapon-ui` (13) in Studio; `m6-weapon-library.spec.ts` (4 E2E).

Prisma: the schema engine binary cannot be downloaded in this sandbox, so `prisma validate`, `migrate deploy` and the
drift check run in Tier 2 CI. Locally the full migration chain (incl. WO6) was applied to a fresh database with plain
SQL and every integration suite ran against it; the migration-compat suite proves WO5 Characters are unchanged.

## 3. Architecture Gate

**M6-WO6 — Weapon & Attack Library** is a step of `controls-2` in the consolidated `ci.yml` (no `m6-wo6.yml`):
`verify-gate.mjs M6-WO6` over the 11 WO6 suites, then `PROWESS_EXPECT_CONTROLS=53 node scripts/m6-wo6-negative-controls.mjs`.
`apps/studio/tests/unit/m6-wo6-static.test.ts` guards every §170 assertion (kinds, no generic Attack, Move AP,
explicit scaling, exact identity, no latest lookup, no inventory / ammo / Armor, M5 contract reuse, one profile, M4
for every formula, the WO1 audit with documented allowances, schema / route / approved-M5 registries, invariants, docs,
CI).

Earlier gates updated only where WO6 is explicitly authorized to change what they pin: later-WO allowances for registered
routes, schema back-relations, approved M5 hashes and test-only fixtures; the WO5 sheet service / Equipment slot
expectations (now the loadout); ARMOR as the reserved example kind; the public-surface allowlists.

## 4. Controls

`scripts/m6-wo6-negative-controls.mjs`: **53 controls** (the 48 of §172 plus: range formula duplicated in game code,
client submits derived damage, M5 STATIC foundation accepting a fake Power, reference-only property silently executed,
Unarmed profile not derived from the current Martial rank) — all 53 caught and restored byte-for-byte.
Historical controls (M4-final, M5-WO1 … WO13, M6-WO1 … WO5): all 414 caught and restored (19 scripts, unchanged counts). Inventory 467 controls across 20 scripts.
One historical anchor moved with authorized WO6 code (M6-WO5 "sheet uses latest Release" now mutates
`loadEquippedCharacter(id)`).

## 5. Known Limitations

- No worn Armor, accessories, inventory ownership, loot, shops, crafting, durability, attachments or upgrades.
- No ammunition quantities, magazine state or reload progress; Ammo / Loading / Reload / Loud are authored data only.
- No damage application, encounter turn state, Maneuver Builder UI, Spell Builder or Ability Cards.
- Reference-only properties (Recoil, Precision, Brace, Stagger, Shockwave, Push, Breach …) are shown, not executed.
- Shock Burst resolution DEFERRED; no-handedness profiles are never equipped.
- Selection offers every held Weapon the Release pins (no ownership yet, §77).
- Prisma validate / drift verified in Tier 2 only (sandbox limitation).
