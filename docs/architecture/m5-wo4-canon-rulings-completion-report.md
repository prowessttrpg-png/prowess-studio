# M5 — Post-WO4 Canon Rulings Amendment (M5-SC-033, M5-SC-035)

A small amendment applied after M5-WO4 merged (PR #42, `main` = `2dece48`). It applies two designer rulings. It is not
M5-WO4 rework and does not start M5-WO5. There is no schema change, no migration and no new endpoint. `@prowess/rules`
(M4) is untouched.

## 1. Rulings Applied

- **M5-SC-033 — Base Movement Values By Creature Size.** "Different Sized Creatures have different base Size Scaling
  for Movement. (Medium is 5ft x AGI, Large is 10ft x AGI, Huge is 15 ft x AGI)". The designer also answered: Small is
  5 ft, and Massive is TBD. Status: `RESOLVED_BY_DESIGNER`.
- **M5-SC-035 — Starting Rank Of New Level 9 Affinity.** "If you gain a new Affinity at 9, it is Trained. All Affinity
  level from themselves." Status: `RESOLVED_BY_DESIGNER`.
- **M5-SC-036 — Base Movement Of Massive Creatures.** This conflict is new and `UNRESOLVED`.

The register keeps every earlier entry verbatim. Each ruling is appended as an amendment.

## 2. Size Base Movement

| Size | Occupied space (s442) | `baseMovement` | Movement at AGI 4 |
| --- | --- | --- | --- |
| SMALL | 5 ft | `{ feet: 5 }` | 20 ft |
| MEDIUM | 5 ft | `{ feet: 5 }` | 20 ft |
| LARGE | 10 × 10 ft | `{ feet: 10 }` | 40 ft |
| HUGE | 15 × 15 ft | `{ feet: 15 }` | 60 ft |
| MASSIVE | 20 × 20 ft or larger | `null` (M5-SC-036) | fails closed |

- `core.derived.base_movement` is now `size_base_movement`. It has one variable, whose source is the new kind
  `CREATURE_SIZE_BASE_MOVEMENT`.
- The compiler copies the exact `baseMovement.feet` of the character's CREATURE_SIZE Definition as a literal. It also
  cites that Definition (`creature-size.<SIZE>`) in the source map.
- Movement is unchanged: `base_movement * agi + bonuses`. Sprint is also unchanged: `movement * 4`.
- `CharacterCore.creatureSize` is optional. When it is omitted, the Size is `STANDARD_CREATURE_SIZE` (MEDIUM). This
  means every existing character, fixture and golden keeps the same numbers.
- An unknown Size is refused with `PROWESS_CORE.INVALID_CHARACTER`.
- A Massive character fails with `PROWESS_CORE.SIZE_BASE_MOVEMENT_PENDING_CANON`. No value is guessed.
- The Size values are authored data. They happen to match occupied space for Large and Huge, but occupied space is
  never read as Base Movement (M5-I113, M5-I152).
- The WO2 DB history test now pins the five CREATURE_SIZE Definitions in its core Release. This is because
  BASE_MOVEMENT reads them.

## 3. Level 9 New Affinity

- `GAIN_NEW_AFFINITY` is `startingRank: "TRAINED"`, `conflictKey: null`. `affinity.json` no longer defers anything.
- Each Affinity ranks independently. Three Level 9 outcomes validate `VALID`:
  - Primary Trained → Expert → Master.
  - Primary Expert, plus one Secondary at Trained.
  - Three Affinities, all at Trained.
- A new Level 9 Affinity at NONE, EXPERT or MASTER is `INVALID`.
- The progression interpreter keeps its fail-closed contract. Any option whose authored starting rank is null still
  returns `REQUIRES_CANON`. A contract test pins this.
- M5-I119 is SUPERSEDED by M5-I151. It is kept, not deleted.

## 4. Invariants

- **M5-I151:** A New Level 9 Affinity Starts At Trained And Every Affinity Ranks Independently.
- **M5-I152:** Base Movement Is Authored Per Creature Size And Is Never Derived From Occupied Space; Massive Remains
  Pending Canon.
- **M5-I119:** now SUPERSEDED by M5-I151.

## 5. Remaining Conflicts

- **M5-SC-036:** Base Movement of Massive creatures is `UNRESOLVED`. It needs a designer value, or a rule for
  "20 ft × 20 ft or larger".
- Every other conflict listed as open in M5-WO4 §37 keeps its status: M5-SC-028, M5-SC-011, M5-SC-026 and M5-SC-027.

## 6. Verification

- **Tests:**
  - The game goldens and contracts were updated.
  - New Size goldens cover Small, Medium, Large, Huge, Massive and an unknown Size.
  - New Level 9 contracts were added.
- **Audits:**
  - The WO3 and WO4 content audits were amended to the rulings.
  - The new permanent CI step "M5 canon rulings audit — Size Base Movement & Level 9 Affinity rank" runs
    `m5-canon-rulings-static.test.ts`.
- **Negative controls:** `scripts/m5-wo4-negative-controls.mjs` gained the canon-rulings controls. §260 now mutates
  toward a non-Trained or unresolved rank.
- **Fixtures:** the WO2, WO3 and WO4 Rules Inspector fixtures regenerate unchanged, because the standard character is
  Medium.
