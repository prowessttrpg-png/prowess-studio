# M6 Character Domain — Core Character Creation (PAS-10 M6-WO3)

M6-WO3 adds the first persistent **player** domain to Prowess Studio. A Character is the player's *choices* against one
exact, immutable published Release; it never contains a copy of the rules and never becomes Compendium content.

```
Designer:  Compendium Admin → author Ancestry / Skill / Character Creation Rule → Canon → publish Release
Player:    Characters → New Character → choose exact Release → wizard → Save & Continue → Complete Core Creation
Character: exact Release forever (no automatic migration)
```

Completion means **Core Creation Complete** — identity, Release, Ancestry, Level 1, Stats, starting Skills, Primary
Affinity, derived preview and Signature Ability capacity. Equipment, Ability construction, advancement and the
Character Sheet runtime state belong to later M6 Work Orders.

Invariants: M6-I021 … M6-I030 (`m6-invariants.md`). Gate: `apps/studio/tests/unit/m6-wo3-static.test.ts`. Controls:
`scripts/m6-wo3-negative-controls.mjs`.

## 1. Character Schema

One authorized migration, `20261029010000_m6_wo3_character_foundation`, adds four typed tables (registered in
`docs/architecture/m6-schema-changes.json`, marked `// >>> M6-WO3` … `// <<< M6-WO3` in `schema.prisma`; four
back-relation lines carry `// M6-WO3 back-relation`). No existing table, column, type or constraint changes; the
migration compatibility test upgrades an M6-WO2 database and proves every pre-existing row and structure is identical.

| Table | Purpose | Key constraints |
| --- | --- | --- |
| `characters` | name, concept, `ruleset_release_id`, `level`, exact Ancestry and Primary Affinity pairs, `core_creation_completed_at`, `lock_version` | FK → `ruleset_releases` RESTRICT; composite FKs `(version id, entity id)` → `entity_versions(id, entity_id)` RESTRICT; `level >= 1`, `lock_version >= 1`, non-blank name, both-or-neither pair checks |
| `character_stat_allocations` | points spent per Stat | PK `(character_id, stat)`; `points_spent >= 0` |
| `character_ancestry_stat_choices` | the player's Stat for a choice grant | PK `(character_id, grant_key, stat)`; the amount is never stored |
| `character_skill_ranks` | exact SKILL revision, rank key, `source_kind` (token: `ANCESTRY`, `FREE`), `source_grant_key` | composite FK to the exact Skill revision; unique `(character_id, skill_entity_id)` |

Database guards (plpgsql triggers): `characters_guard` raises `CHARACTER_RELEASE_IMMUTABLE` on any change of
`ruleset_release_id`, and `CHARACTER_CORE_FROZEN` on any mechanical / completion / Level change after completion; the
three child tables raise `CHARACTER_CORE_FROZEN` on insert, update or delete for a completed Character.

Nothing derived is persisted: there is no Maximum HP / MP, Dodge, Movement, Action Points, Character DC, Signature slot,
current resource, inventory, Spell, Maneuver or Ability column or table.

## 2. Exact Release Pin

- `rulesetReleaseId` is set on create from the explicitly chosen Release and can never change (service + trigger). A
  wrong Release means a new Character Draft.
- Every read and write resolves the Character's rules with `materializeProwessDefinitionsFromRelease(c.rulesetReleaseId)`
  — the M4-WO2 / M5 materializer, which verifies the Release Manifest hash on every load. Nothing looks up a Ruleset's
  latest Release or an Entity's latest revision.
- Completing core creation additionally runs M2's `verifyRulesetReleaseManifestHash`; a failure refuses completion
  (`CHARACTER.RELEASE_INTEGRITY_FAILED`).
- Publishing a newer Release never changes an existing Character: its stored choices and its resolution are identical
  (database, API and E2E tests).

## 3. Creation Content Contracts

The M5 Definition registry is extended exactly as authorized (§10), characterized by
`packages/prowess-game/src/m6-wo3-registry.test.ts` against `packages/prowess-game/src/testing/m6-wo3-registry-baseline.json`:

| Kind | Change | Payload v1 |
| --- | --- | --- |
| `ANCESTRY` | reserved → v1 | `baseHp`, `baseMp`, `statGrants[]` (`FIXED {grantKey, stat, amount}` / `CHOOSE_DISTINCT {grantKey, count, amount, allowedStats}`), `skillGrants[]` (`{grantKey, rankKey, selectionKind FIXED / CHOOSE_FROM / CHOOSE_ANY, count, options: exact SKILL refs}`), `source` |
| `SKILL` | reserved → v1 | `ladderKey` (the certified Skill rank ladder, `SKILL`), `source` |
| `CHARACTER_CREATION_RULE` | new, `CHARACTER` family, v1 | `startingLevel`, `statPointBudget`, `freeTrainedSkillCount`, `startingSkillRankKey`, `requiredAncestryCount` (= 1), `requiredPrimaryAffinityCount` (= 1), `source` |

Every other kind specification is byte-for-byte unchanged. Stat minimum / maximum are NOT in the creation rule — they
are the Release's `STAT` Definitions. The Character Die is the Release's `CHARACTER_DIE_PROGRESSION`; the starting Skill
rank is a rank of the Release's Skill `RANK_LADDER`. Narrative racial features stay Rules Text; there is no racial
feature engine.

The new kinds join the ONE descriptor set: WO1 Compendium Admin authors them through structured editors (integer fields,
a Stat-grant editor, a Skill-grant editor that picks exact SKILL references) and WO2's Rules Reference presents them
through the same descriptors (Base HP / MP, readable grants, creation values, required selections).

## 4. Creation Validator

`validateCharacterCreation({ bundle, ruleset, candidate })` in `@prowess/game` (`src/character/creation.ts`) is pure,
deterministic and side-effect free; it returns `{ status: READY | INCOMPLETE | INVALID, issues[], capability, resolved,
derivedPreview }`. Issues carry `code` (`PROWESS_CHARACTER.*`), `severity` (`ERROR` refuses a save; `INCOMPLETE` is
allowed in a Draft), `path`, `message` and the exact source Definition.

- **Capability** (`getCharacterCreationCapability`): `READY` or `MISSING_REQUIRED_CONTENT` with every missing
  requirement — one Character Creation Rule, the six STATs, the Character Die progression, the required Derived Stats,
  the Skill rank ladder, at least one Ancestry, Skill and executable Affinity. Content is located by Definition kind,
  never by name, and never outside the Release.
- **Exact selections:** Ancestry, Skills and Primary Affinity are `{ entityId, entityVersionId }` pairs that must equal
  the Release's pin and be of the expected kind; a matching canonical key or a newer revision is `NOT_IN_RELEASE`.
- **Stats:** integers ≥ 0 for the six Stats only; Ancestry FIXED grants apply once; CHOOSE_DISTINCT choices are exactly
  `count` different allowed Stats; points spent > budget is an error, < budget is incomplete; every final Stat must lie
  within its STAT Definition's bounds.
- **Skills:** each Ancestry grant is satisfied exactly (FIXED, CHOOSE_FROM exact revisions, CHOOSE_ANY any Release
  Skill); exactly `freeTrainedSkillCount` FREE Skills; no Skill twice (training never stacks); ranks come from the
  Release's ladder.
- **Primary Affinity:** exactly one, `AFFINITY`, of an executable schema version (v2).

## 5. Derived Preview

Totals (baseline + Ancestry + allocated, points spent / remaining) are M4 modifier evaluations, and the derived
statistics (Maximum HP, Maximum MP, Signature Ability capacity, Dodge, Character DC, Movement, …) are the M5 core
resolution of the Release's own `DERIVED_STAT` Definitions orchestrated by M4 — from `level`, the Character Die, final
Stats, the Ancestry's Base HP / MP and the Skill ranks. No formula exists in Studio or `@prowess/db`. The preview is
recalculated on every read and never stored, so it cannot drift.

Worked example (test fixture "Orcani", Release R1): Stats STR 6 AGI 5 CON 4 PER 3 RES 3 PRO 4, Maximum HP 14, Maximum MP
7, Signature Ability capacity 4, Character Die d4. The same choices on a Release whose Ancestry revision has Base HP 12
preview Maximum HP 16 — and an R1 Character stays at 14.

## 6. Concurrency

Every mutable write (creation save, profile, completion) is a compare-and-set:
`UPDATE … WHERE id = ? AND lock_version = expected [AND core_creation_completed_at IS NULL]` that sets
`lock_version = expected + 1`; zero rows → `CHARACTER.STALE_WRITE` (409), `CHARACTER.CORE_FROZEN` (409) or
`CHARACTER.NOT_FOUND` (404). A creation save claims the version, then replaces the Ancestry / Affinity fields and every
child row inside ONE transaction; an injected late failure leaves the previous build intact. Concurrent saves with one
`lockVersion`: exactly one succeeds.

## 7. API

Thin Next.js routes over `@prowess/db` (registered under `M6-WO3` in `docs/architecture/m6-api-routes.json`):

| Route | Purpose |
| --- | --- |
| `GET /api/characters` | minimal index (name, Level, exact Release, status, last update) |
| `POST /api/characters` | create a Draft: `name`, `concept`, `rulesetReleaseId` only (strict body); the Release must be capable; Level comes from the Release's rule |
| `GET /api/characters/:id` | stored choices + server resolution with exact provenance + display names |
| `PUT /api/characters/:id/profile` | name / concept at `expectedLockVersion` (allowed after completion) |
| `GET /api/characters/:id/creation-context` | one normalized context: Release, capability, creation rule, Stats, Character Die, rank ladder, derived statistics, Ancestries, Skills, Affinities |
| `POST /api/characters/:id/validate` | side-effect-free check of an unsaved candidate |
| `PUT /api/characters/:id/creation` | Save & Continue: `expectedLockVersion` + candidate; ERROR → 422 `CHARACTER.INVALID_CREATION` |
| `POST /api/characters/:id/finalize` | Complete Core Creation: integrity + READY + lockVersion |
| `GET /api/character-creation/releases/:releaseId/capability` | READY / MISSING_REQUIRED_CONTENT for an exact Release |

The candidate accepts only `ancestry`, `ancestryStatChoices`, `statAllocations`, `skills`, `primaryAffinity`; a
`level`, rank or derived value is refused (400).

## 8. UI Wizard

`/characters` (index), `/characters/new` (Ruleset → Release chosen explicitly — nothing preselected — with the
capability shown before create), `/characters/:id` (pinned Release, status, Review, editable profile) and
`/characters/:id/create` (wizard): **Concept → Race / Ancestry → Stats → Skills → Primary Affinity → Review**.

Every option is from the creation context; every number shown (Base / Ancestry / Allocated / Final, Points Remaining,
free Skill count, derived statistics) is the server's resolution, re-checked (debounced) after each change. Stat-choice
selectors are distinct; already-chosen Skills are disabled; only executable Affinities are offered; each option and each
Review rule links to its exact Release Rules Reference page. **Save & Continue** is explicit (lockVersion; a stale save
offers a reload), **Check Character** validates the unsaved candidate, **Complete Core Creation** is enabled only when
the saved Character is READY. A completed Character's wizard is read-only. The frontend imports no database, Prisma or
domain package (`scripts/check-architecture.mjs`, gate).

## 9. Known Limitations

Deferred by design (§115): Job Class presets; gear / equipment / weapons; current HP / MP and other runtime state;
Character, Skill and Affinity advancement; secondary Affinities; Signature Ability, Spell and Maneuver records; respec;
Release migration; accounts / ownership; Character deletion / archive; import / export. There is no authentication:
Characters are application records. M5-SC-042…053 remain unresolved and are not touched by Character creation.

**M6-WO4 update.** Character, Skill and Affinity advancement (Levels 2 → maximum, secondary Affinities) now exist —
see [m6-character-advancement-access.md](m6-character-advancement-access.md). Creation as described here is unchanged:
the Level 1 creation rows stay frozen, and the `characters` guard keeps Release immutability and the creation freeze
while its Level rule now allows exactly one +1 step per committed advancement. Everything else listed above remains
deferred.
