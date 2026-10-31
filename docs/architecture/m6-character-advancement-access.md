# M6-WO4 — Character Advancement, Access & Eligibility

PAS-10 M6-WO4. Starting main `77f9430f68caf60babfb0c54496090d5ace11f86` (M6-WO3 merged). This document describes how a
completed Level 1 Character (M6-WO3) advances one Level at a time to the maximum Level its Release defines, how its
present mechanical state is rebuilt, and how the reusable access / eligibility layer reports what it may build from.
Invariants M6-I031 … M6-I044 are catalogued in [m6-invariants.md](m6-invariants.md).

## 1. Overview

```
Character row (exact RulesetRelease pin, Level, lockVersion)
  + frozen Level 1 creation rows (M6-WO3)
  + append-only advancement rows (one per Level reached)
        │  @prowess/db reshapes rows only (progression.ts)
        ▼
@prowess/game buildCharacterMechanicalProfile(bundle of the EXACT Release, creation, history)
        │  replay: WO3 creation validator → one applyAdvancement per committed record
        │  Stats via M4 evaluateModifiers · ranks via the exact ladder · Affinity via M5 validators
        │  derived values via compileCoreResolution + orchestrateRulesEvaluation (M4)
        ▼
CharacterMechanicalProfile ──► preview / advance · access summary · component eligibility · Studio
```

Nothing derived is stored; every read recalculates it under the Character's own Release.

## 2. Advancement Content

`CHARACTER_ADVANCEMENT_RULE` v1 is a new active CHARACTER Definition kind (no compiler — it is read, not compiled):

```json
{ "levels": [{ "level": 2, "statPoints": 1, "skillAdvancements": 0 }, …], "source": { … } }
```

The reader (`definition/advancement-payload.ts`) fails closed: `levels` non-empty and strictly ascending, Levels ≥ 1,
counts whole and ≥ 0. The playtest cadence (L2 1/0, L3 1/1, L4 1/0, L5 1/1, L6 1/1, L7 1/0, L8 1/1, L9 1/1, L10 2/1) is
authored content (test fixtures here), never code. The Character Die stays in `CHARACTER_DIE_PROGRESSION` and Affinity
progression stays in `AFFINITY_PROGRESSION`; the advancement rule does not repeat them.

A Release is **ADVANCEMENT_READY** when it is creation-ready (M6-WO3) and pins exactly one coherent advancement rule;
`getCharacterCapability` lists every missing requirement (`CREATION_READY` vs `ADVANCEMENT_READY`). The WO1 editor
authors the rule as a Levels table and the WO2 Rules Reference presents it through the same descriptor.

## 3. Cross-Definition Coherence

`readAdvancementContent` refuses a Release whose content disagrees:

- the advancement rule's Levels must be exactly the Character Die progression's Levels after the creation Level;
- every Level (creation Level included) must resolve a Character Die;
- the creation rule's starting Skill rank must be a rank of the Skill ladder;
- every `AFFINITY_PROGRESSION` Level must be a Character Level, and the creation Level must choose the Primary Affinity.

The maximum Level is the last Level of that sequence (`c.levels.at(-1)`); no `10` exists in code (M6-I033).

## 4. Advancement Records

Schema additions (registered in `m6-schema-changes.json`, marked `// >>> M6-WO4` in `schema.prisma`; migration
`20261031010000_m6_wo4_character_advancement`):

| Table | Stores |
| --- | --- |
| `character_advancements` | `character_id`, `from_level`, `to_level`, `lock_version_before`, `created_at`; unique (`character_id`, `to_level`) |
| `character_stat_advancements` | points spent per Stat (> 0) |
| `character_skill_advancements` | `TRAIN_NEW` / `UPGRADE` on an exact SKILL EntityVersion (composite FK) |
| `character_affinity_advancement_choices` | the authored option key and, when it names one, the exact Affinity (composite FK) |

Only **choices** are stored — no rank, die, final Stat or derived value (M6-I039). Every FK is RESTRICT. Database
guards:

- CHECK `to_level = from_level + 1`, `points_spent > 0`, the nullable Affinity pair together;
- `characters_guard` (replaced): Release immutable, creation freeze kept, and a Level change only by exactly +1, only
  for a completed Character, only when the matching advancement row exists (`CHARACTER_LEVEL_GUARD`);
- `character_advancements_guard`: INSERT only at the completed Character's present Level; UPDATE / DELETE refused
  (`CHARACTER_ADVANCEMENT_IMMUTABLE`); child rows may only join an advancement still being committed.

## 5. Derived Profile

`buildCharacterMechanicalProfile` (the one builder, M6-I044) replays creation through the WO3 validator, then each
committed record through `applyAdvancement` (the same validation a new advancement gets), and checks the stored Level
equals where the history ends (`HISTORY_INVALID` otherwise). The profile carries Level, maximum Level, Character Die,
base HP / MP, Stats (baseline, Ancestry, creation, advancement, final, bounds, Stat Mastery), Skill ranks with source
and history, Affinities with acquisition and history, the M5 Affinity profile, derived statistics, Signature capacity,
the construction context and provenance.

- **Stats** — sums through M4 `evaluateModifiers` (`sourceType: "character.level_advancement"`); the STAT
  Definition's maximum bounds the result; Stat Mastery is an M4 Requirement over the Release's STAT_MASTERY thresholds.
- **Skills** — `TRAIN_NEW` gives the creation rule's starting rank; `UPGRADE` steps exactly one rank up the exact ladder;
  duplicate training, upgrading an untrained Skill, passing the top rank and advancing one Skill twice in a Level are refused.
- **Derived values** — `compileCoreResolution` + `orchestrateRulesEvaluation` under the Release's Formulas.

## 6. Affinity Progression

The Level's `AFFINITY_PROGRESSION` step decides the Affinity entitlement:

- no step → no choice allowed;
- a REQUIRED step with one Primary `RANK_UP` option is **automatic** (Level 3 Primary Trained) — nothing is stored;
- otherwise the player chooses one authored option (Level 6 Primary Expert or a Secondary at Trained; Level 9 the
  advanced options), naming the exact Affinity when the option needs one.

Options whose starting rank is unresolved canon (`conflictKey`) are refused, never guessed. Every resulting profile
must pass the existing M5 `validateAffinityProfile` and `validateAffinityProgression` (status `VALID`) — persisted
choices alone are never proof (M6-I038).

## 7. Concurrency

`advanceCharacter` loads the Character and its history from one RepeatableRead snapshot, verifies the Release manifest
(M2), previews against the exact Release, then `commitAdvancement` runs ONE transaction:

1. compare-and-set `lock_version` where `id`, `lock_version = expected`, core creation complete and `level = fromLevel`;
2. insert the advancement row and its Stat / Skill / Affinity choice rows;
3. move the Character to `toLevel`.

A stale version is 409 `CHARACTER.STALE_WRITE`; any failure rolls back everything. Two concurrent advances produce
exactly one new Level.

## 8. Access and Eligibility

- **Access summary** (`characterAccessSummary`): the Arcane Authority and Martial tracks — the exact Skill the Release's
  `ABILITY_CONSTRUCTION_RULE` names, at the Character's rank, against the rule's minimum — each owned Affinity's
  Authority against the Affinity rank rule's minimum, and Signature capacity.
- **Component eligibility** (`evaluateComponentEligibility`, `listComponentEligibility`): reads only the structured
  `SKILL_RANK_AT_LEAST` / `AFFINITY_RANK_AT_LEAST` prerequisites M5's `readComponentConstructionRules` reads and
  evaluates them as the same M4 `RANK_AT_LEAST` / `ENTITY_OWNED` Requirements. Status `ELIGIBLE`, `INELIGIBLE` or
  `UNRESOLVED`; each requirement reports `{ kind, required, actual, satisfied, source }`. A selection that is not the
  Release's exact pin is `UNRESOLVED`.
- **Access changes**: the preview reports track changes and newly eligible / ineligible components.

Eligibility is not legality (M6-I041): capacity, structure, stacking and Signature slots remain M5's construction
compiler's. There is no unlock table and Rules Text is never read (M6-I040, M6-I042).

## 9. API

| Method | Route | Body / query |
| --- | --- | --- |
| GET | `/api/characters/:id/advancement` | — (profile, next entitlements, Skill / Affinity targets, history) |
| POST | `/api/characters/:id/advancement/preview` | `{ choices }` — writes nothing |
| POST | `/api/characters/:id/advance` | `{ expectedLockVersion, choices }` |
| GET | `/api/characters/:id/access` | — |
| GET | `/api/characters/:id/eligible-definitions` | `definitionKind`, `includeLocked`, `page`, `pageSize` (≤ 100) |

`choices` is `{ statAllocations, skillAdvancements: [{ action, skill }], affinityChoice: { optionKey, affinity } | null }`.
No input names a Level, rank, die or derived value. Errors: `CORE_CREATION_INCOMPLETE` 409, `MAX_LEVEL` 409,
`ADVANCEMENT_INCOMPLETE` 409, `ADVANCEMENT_NOT_CAPABLE` 409, `STALE_WRITE` 409, `INVALID_ADVANCEMENT` 422.
`GET /api/characters/:id` now also returns `profile`, `profileIssues`, `advancementHistory` and `advancementCapability`.

## 10. UI

- `/characters/:id` — for a completed Character: Level, Character Die, Stats with where every point came from, Skills,
  Affinities, derived values, the Access panel and the advancement history; "Advance Character" or "Maximum Level
  Reached". After Level 1 the WO3 creation review moves into a "Level 1 creation record" disclosure, unchanged.
- `/characters/:id/advance` — Next Level → Stat Points → Skill Advancement → Affinity Progression → Review → Advance
  Character. Steps the Level grants nothing for are skipped; every number is the server's (debounced preview); Advance
  Character is enabled only for a READY preview; a stale write offers a reload.

## 11. Known Limitations

- No respec, no undo of an advancement, no automatic migration to a newer Release (M6-I043) — by design.
- Eligibility covers the two M5 structured prerequisite kinds only; full Ability legality stays in the M5 builders.
- Spells, Maneuvers, equipment and inventory are not part of this Work Order.
- Unresolved canon items (M5-SC-042 … 053) remain unresolved; options that depend on them are refused, never guessed.
- The canonical Core Playtest content does not yet ship an authored `CHARACTER_ADVANCEMENT_RULE`; tests use test-only
  rules under `test.*` keys.
