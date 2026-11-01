# M6-WO6 — Weapon & Attack Library

PAS-10 M6-WO6 makes Weapons and their Moves structured, Release-pinned Compendium content and connects them to the
Character: a Weapon loadout, a Character Attack Library with a damage preview, Shield modifiers in the one mechanical
profile, and one adapter into the existing M5-WO11 Maneuver Attack contract.

```text
Release
↓
WEAPON Definition (Moveset = exact ATTACK refs)
↓
exact ATTACK Definitions (+ exact EQUIPMENT_TRAIT uses)
↓
Character Weapon Loadout (exact Weapon pairs + Versatile grip)
↓
Character Attack Library (preview only)
↓
M5 exact Attack contract (bindWeaponAttackToManeuver)
```

Invariants M6-I057 … M6-I076 (`m6-invariants.md`). Gate: **M6-WO6 — Weapon & Attack Library** in `ci.yml`
(`apps/studio/tests/unit/m6-wo6-static.test.ts`, `scripts/m6-wo6-negative-controls.mjs`).

## 1. Definition Kinds

| Kind | Status | Family | Storage | Reader |
|---|---|---|---|---|
| `WEAPON` | reserved → **v1** | `EQUIPMENT` | `GENERIC_RULE` | `definition/equipment-payload.ts` |
| `ATTACK` | **new, v1** | `EQUIPMENT` | `GENERIC_RULE` | `definition/equipment-payload.ts` |
| `EQUIPMENT_TRAIT` | reserved → **v1** | `EQUIPMENT` | `GENERIC_RULE` | `definition/equipment-payload.ts` |
| `ARMOR` | still **reserved** | `EQUIPMENT` | — | — |

No M1 EntityType changed. Closed vocabularies live in `packages/prowess-game/src/vocabulary/equipment.ts` and reach the
authoring UI only through the authoring catalog.

- **WEAPON v1:** `familyKey`, `profileKind` (`STANDARD` / `UNARMED` / `IMPROVISED`), `equipmentRole` (`WEAPON` /
  `SHIELD`), `martialRankKey` (Unarmed only), `category` (`LIGHT` / `BALANCED` / `HEAVY`; null only for Unarmed),
  `handedness` (`ONE_HANDED` / `TWO_HANDED` / `VERSATILE`, or null when canon authors none — never equipped by guess),
  `scalingModel` (`POWER` / `STATIC` / `HYBRID`, mandatory), `power` (≥ 2; null on STATIC), `scalingRule` (exact
  POWER_SCALING trait use), `versatileRule` (exact DIE_STEP trait use, iff VERSATILE), `exampleForms`,
  `weaponProperties`, `moveset` (ordered, unique exact ATTACK refs), `requirements`, `equippedModifiers`,
  `grantedFeatures` (reference-only), `source`.
- **ATTACK v1:** `moveKey`, `weaponFamilyKey`, `apCost`, `mpCost`, `damageProfiles[]` (`{profileKey, dice{count,sides},
  damageType}` — several = selectable, never auto-selected), `scaling` (only on a HYBRID Weapon's Attacks),
  `resolution` (`ATTACK_ROLL{onMiss}` / `SAVING_THROW{savingThrowStat, dc, onFailure, onSuccess}` /
  `DEFERRED{reason}`), `targeting` (`MELEE` / `CLOSE {reachFeet}`, `RANGED_MULTIPLIER {stat, feetPerPoint, area}`,
  `LINE` / `CONE {lengthFeet}`), `moveProperties`, `accuracyModifier`, `requirements`, `source`.
- **EQUIPMENT_TRAIT v1:** `traitKey`, `useSites` (`WEAPON_PROPERTY` / `MOVE_PROPERTY`), `executionStatus`
  (`EXECUTABLE` / `REFERENCE_ONLY` / `DEFERRED`), declared `parameters`, `contract` (present **iff** EXECUTABLE),
  `summary` (inert text), `source`.

There is no circular reference: an Attack carries the stable `weaponFamilyKey`; the Weapon carries the exact Attack
refs. The runtime identity of a Weapon Attack is the pair *exact Weapon ref + exact Attack ref*.

## 2. Damage

`equipment/damage.ts` previews; it never rolls, spends or applies.

1. **Versatile** (two-handed grip of a VERSATILE Weapon): the Release's DIE_STEP table steps a single-die base
   **before** Power. A multi-die base fails closed (§31).
2. **STATIC**: the authored (grip-adjusted) dice are final — "Static damage — STR scaling not applied".
3. **POWER**: the Release's POWER_SCALING Formulas (M4 `evaluateFormula`): multiplier
   `1 + floor(stat_score / max(minimum_power, power))` and dice count `base_count * multiplier` — the full base
   expression repeats (Heavy Blade 2d6 at STR 5 → 4d6). The Dual Wield effective Power is the Release's own Formula.

HYBRID Weapons declare scaling per Attack (Arc Bow / Mana Chakram / Energy Melee POWER, Pulse Cannon STATIC).

## 3. Properties

Executable contracts (complete, machine-readable): `CLOSE_QUARTERS`, `REACH` (10 ft), `ARMOR_PIERCE` (declared amount),
`POST_HIT_SAVE` (Sweep → Tripped, Hook → pull 5 ft; Saves vs the attacker's Character DC), `DIE_STEP` (Versatile),
`SAVE_AREA_FIRE` (Auto: AGI Save, full / half), `AUTHORED_BURST` (listed damage is final; Accuracy −2),
`POWER_SCALING`, `DUAL_WIELD`. Everything else (Ammo, Loading, Reload, Loud, Recoil, Precision, Brace, Reinforced …) is
`REFERENCE_ONLY` data shown as "not executed by WO6"; no behaviour is guessed and no rules text is parsed. Crossbows
author no Loud. The Library index checks coherence: an Auto Move must resolve exactly as its trait's Saving Throw, a
Burst Move must carry exactly the trait's Accuracy adjustment.

## 4. Loadout

`character_weapon_loadouts` (migration `20261102010000_m6_wo6_character_weapon_loadout`, registered in
`m6-schema-changes.json`) stores only the CHOICE: Main-hand and Off-hand exact Entity + EntityVersion pairs and the
Versatile Main-hand grip, with a `lockVersion` compare-and-set (stale → 409). Nothing derived, no ammunition, ownership
or inventory. `resolveWeaponLoadout` validates against the Character's exact Release on every read and write: exact pin,
held profile, authored handedness, explicit Versatile grip, Two-Handed occupies both hands and is never Off-hand, and
requirements through M4 (`requirementMet`, `rankAtLeast`, `numericCompare`). An illegal loadout → 422.

## 5. Shields

Shields are `equipmentRole: SHIELD`, One-Handed Weapon profiles with Moves and `equippedModifiers`. While equipped,
`equipmentContextOf` passes them to the ONE `buildCharacterMechanicalProfile`: Dodge / Movement as named, sourced
explicit bonuses (`category: EQUIPMENT`), Armor through an M4 modifier over the Release's Armor base. Unequipped, the
profile is byte-identical to M6-WO5. Shield + Weapon is never Dual Wielding.

## 6. Dual Wield

A sequence is one exact Attack from each hand. Eligibility: both hands hold WEAPON-role one-handed grips, and each
category row's Martial rank / STR minimum (the Release's DUAL_WIELD rule). AP = the rule's `max(ap_a, ap_b)`; each
POWER-scaled Attack's Power = `power + adjustment + increment * sequence_index` (an explicit index — no turn state).
STATIC damage is untouched. It never forms a Powerful Blow (`powerfulBlow: false`).

## 7. Unarmed

Four `UNARMED` Weapon profiles (Untrained 8 / Trained 7 / Expert 6 / Master 5). The Character's CURRENT Martial rank
(the Skill named by the Release's ABILITY_CONSTRUCTION_RULE `maneuver.martial.skillKey`) selects the profile; it is
never stored and never equipped. Expert grants the Grapple rule as reference text; Master Moves carry Reinforced.

## 8. Character Attack Library

`buildCharacterAttackLibrary({ bundle, characterProfile, loadout })` — pure and deterministic. Unarmed, Main-hand,
Off-hand and Dual Wield sequences; each Attack carries exact Weapon + Attack refs, AP / MP, every damage preview with
its steps, range (ranged feet through an M4 MULTIPLY modifier), resolution, Accuracy adjustment, Weapon / Move
properties, not-executed properties, requirements, eligibility and Release provenance. Capability:
`WEAPON_LIBRARY_READY` / `NO_WEAPONS` / `INCONSISTENT_CONTENT` and `ATTACK_LIBRARY_READY` / `MISSING_REQUIRED_CONTENT`.

## 9. Maneuver Bridge

`bindWeaponAttackToManeuver` projects one Character Attack onto the existing M5-WO11 foundation contract
(`readFoundationProfile`, `MANEUVER_FOUNDATION` payload with `foundation.ap` = the Move's own AP). The one approved
additive M5 change (`m6-approved-m5-changes.json`): the foundation damage may carry `scaling: "STATIC"` with
`power: null, stat: null`; absent `scaling` keeps the M5-WO11 meaning exactly. Saving-Throw, Line / Cone and deferred
Attacks are refused with a structured reason. Powerful Blow compatibility stays M5's exact-Attack rule.

## 10. API

| Route | Purpose |
|---|---|
| `GET /api/characters/:id/weapons` | loadout, capability and the Release's held Weapon options with eligibility |
| `GET /api/characters/:id/attacks` | the Character Attack Library |
| `PUT /api/characters/:id/weapon-loadout` | `{expectedVersion, mainHand, mainHandGrip, offHand}` only |
| `GET /api/compendium-reference/rulesets/:r/releases/:rel/weapons` | exact-Release Weapon Library |
| `GET /api/compendium-reference/rulesets/:r/releases/:rel/attacks` | exact-Release Attack Library |

Registered in `m6-api-routes.json`. Studio adds dedicated WEAPON / ATTACK / EQUIPMENT_TRAIT editors (catalog options,
exact reference pickers), a Rules Reference Weapon Library with filters and Weapon / Attack detail pages, the sheet's
Main-hand / Off-hand slots with a loadout editor, compact Attack rows in Actions, and an Attack Library tab with the
damage inspector. Studio formats server values only.

## 11. Known Limitations

- No worn Armor, accessories, inventory ownership, loot, shops, crafting, durability, attachments or upgrades.
- No ammunition quantities, magazine state or reload progress; Ammo / Loading / Reload / Loud are authored data only.
- No damage application, encounter turn state, Maneuver Builder UI, Spell Builder or Ability Cards.
- Reference-only properties (Recoil, Precision, Brace, Stagger, Shockwave, Push, Breach / structure …) are not executed.
- Shock Burst's resolution is DEFERRED (canon states none). Flexible Weapon, Sling, Energy Melee and Improvised
  profiles author no handedness, so they are shown but never equipped.
- The Library offers every held Weapon the Release pins (no ownership restriction yet, §77).
