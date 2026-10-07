# Ruleset Migration Planning & Legacy Preservation (M2-WO11)

**Status: implemented; awaiting its first CI run.** M2-WO11 builds the migration-*planning* foundation. It compares
two exact published Releases and records immutable assessments of them. It performs **no migration**: nothing is
upgraded, substituted, rewritten, archived, or applied, and no saved-creation models (Spell, Character, Card,
Campaign, Summon, Maneuver) are added before their real persistence exists.

```
Release A ─┐
           ├──► Migration Assessment
Release B ─┘         │
                     ▼
               MigrationPlan  (immutable)
               ├── UNCHANGED
               ├── ADDED_ENTITY
               ├── REMOVED_ENTITY
               └── CHANGED_VERSION
                     │
                     ▼
               REVIEW_REQUIRED where necessary
```

## Planning is not execution

- **Preview:** `previewRulesetMigration({ sourceReleaseId, targetReleaseId })` returns an unpersisted assessment
  and writes nothing. A test proves this by fingerprinting every relevant table before and after.
- **Persistent plan:** `createMigrationPlan({ …, name, description? })` saves the same verified assessment as an
  immutable plan with one item per Entity.
- **Retrieval:** `getMigrationPlan(id)` returns a plan with its items and summary; `listMigrationPlans({ sourceReleaseId?, targetReleaseId? })`
  lists plans by `created_at`, then `id`.
- **No mutation or execution operations.** There is no update, replace, delete, apply, execute, or upgrade
  operation. To assess differently, create another plan. A future, reviewed creation-migration workflow may
  *reference* a plan but must never rewrite it.

## Exact, explicit Releases

The caller always supplies **both** `sourceReleaseId` and `targetReleaseId`. They must be two different published
Releases. Nothing is ever inferred from:
- the latest Release;
- the Ruleset's status;
- an EntityVersion's status;
- the latest Manifest;
- source authority.

A plan pins its two Releases by foreign key **and** records both manifest hashes as verified at creation.

**Compositions** come from the WO8 release service (`getRulesetRelease`). Published Release manifests are already
flattened snapshots, so no inheritance is resolved here.

**Cross-Ruleset comparison** is supported (e.g. Core Playtest → Experimental). It compares the two flattened
compositions structurally and infers no relationship between the Rulesets. The existing WO8 release diff contract
is unchanged.

## Hash verification first

Before any assessment, both Releases are verified with WO8's `verifyRulesetReleaseManifestHash`, the single
authority. There is no second hash implementation. If either Release fails, preview and plan creation are both
refused with `MIGRATION_PLAN.MANIFEST_INTEGRITY_FAILURE` (409) and nothing is persisted. A test corrupts a published
entry (test-only), confirms the refusal on either side, and restores the entry.

## Structural classification

| Change | Meaning | Versions |
|---|---|---|
| `UNCHANGED` | The same EntityVersion id is in both Releases | both, equal |
| `ADDED_ENTITY` | The Entity is absent from the source and present in the target | target only |
| `REMOVED_ENTITY` | The Entity is present in the source and absent from the target | source only |
| `CHANGED_VERSION` | The Entity is in both, with different Version ids | both, different |

**Equality is Version *identity* only.** Nothing is inferred from matching names, keywords, descriptions, or
sources: a different Version id is an explicit historical change.

**No substitution.** If Release A pins X r2 and Release B pins X r5, the plan reports *r2 → r5*. It does not modify
Release A, update any creation, or claim r5 is mechanically compatible.

**Ordering is deterministic:** items are sorted by lowercase Entity id ascending. The result is independent of
insertion order, entry row ids, query order, and timestamps (tested). The assessment (`assessMigration`) is a pure
`@prowess/model` function, and a unit test pins its agreement with WO8's shared `diffCompositions` for every changed
Entity.

**Summary counts are structural only:** `unchanged`, `added`, `removed`, `changed`, `reviewRequired`, `total`. They
are never counts of broken rules or invalid builds.

## Compatibility is not overstated

The full PAS-08 vocabulary is declared, and stored as a Prisma enum, for forward compatibility:
`UNCHANGED`, `RECALCULATE_ONLY`, `VALID_WITH_CHANGES`, `REVIEW_REQUIRED`, `INVALID`, `UNSUPPORTED`.

Without a Rules Engine or creation schemas, M2-WO11 assigns **only**:
- identical Version → `UNCHANGED`;
- added, removed, or changed → `REVIEW_REQUIRED`.

A removed Entity is not automatically `INVALID` for every creation. A static audit pins that the classifier can
produce nothing else.

## Persistence

- **Tables:** `migration_plans` and `migration_plan_items`, created by one Prisma-generated migration with two enums.
  No existing table is altered.
- **Plan foreign keys:** RESTRICT keys to its source and target Releases.
- **Item foreign keys:** RESTRICT keys to its plan and Entity. Its Version references are **composite keys** onto
  `entity_versions(id, entity_id)`, so a referenced Version must belong to the item's Entity. A NULL side skips the
  check.
- **Uniqueness:** `UNIQUE(migration_plan_id, entity_id)` allows at most one item per Entity.
- **No mutable columns:** no `updated_at`, applied, current, active, complete, or status column.
- **Delete protection:** referenced Releases, Entities, and Versions, and a plan with items, cannot be deleted
  (tested).

**Atomic creation.** The plan and every item are written in one transaction. A test makes the *last* item violate
its composite Version key after the plan and an earlier item were inserted, and confirms zero plans, zero items, and
unchanged historical tables.

## Legacy preservation and no forced upgrades

Creating plans, or publishing newer Releases afterwards, never modifies:
- older Releases or their published manifest entries and hashes;
- CanonPolicies or CanonDecisions;
- ChangeSets;
- EntityVersions.

**Tested scenario:**
1. Plan Release 1 → Release 2.
2. Publish Release 3 and add a new Version.
3. Re-read everything:
   - the plan is identical and never mentions Release 3;
   - Release 1's composition, hash, policy, label, and timestamps are identical;
   - Release 1's hash still verifies.

Legacy Releases are never archived, deprecated, or hidden automatically. Legacy content never follows the latest
Ruleset on its own.

## Errors

`MIGRATION_PLAN_ERROR_CODES` (exhaustively mapped in the HTTP status map; no route yet):

| Code | HTTP | Why |
|---|---|---|
| `NOT_FOUND` | 404 | The addressed plan |
| `SOURCE_RELEASE_NOT_FOUND`, `TARGET_RELEASE_NOT_FOUND` | 400 | Referenced in the request |
| `INVALID_INPUT` | 400 | Missing or identical Release ids, name, description, filters |
| `MANIFEST_INTEGRITY_FAILURE` | 409 | A Release fails hash verification |
| `INVALID_VERSION_REFERENCE` | 409 | The database rejected an item's Entity/Version reference |
| `PLAN_CONFLICT` | 409 | The database rejected the plan |

## Future saved-creation migration contract

When saved creations exist, each must preserve:
- the Ruleset Release (or Manifest) context it was made under;
- exact component references where applicable;
- the ability to stay on legacy rules indefinitely;
- explicit migration consent;
- reproducible old calculations where supported;
- a migration comparison before any change is accepted.

```
Saved Creation [future]
   ├── Keep Legacy          stay on the original Release; nothing changes
   ├── Compare              show the MigrationPlan's items that touch this creation
   ├── Migrate              explicitly accept the reviewed changes in place (consent recorded)
   └── Duplicate & Migrate  keep the original; create a migrated copy
```

WO11 documents these semantics only. They are implemented with the creation builders.

## Phase-1 limitations

- **No execution and no compatibility evaluation.** Every structural change is `REVIEW_REQUIRED` until a Rules
  Engine or explicit review can say more.
- **Source and target must differ.** A plan comparing a Release with itself is rejected as meaningless.
- **No HTTP route or UI yet.** The domain, service, and persistence foundation is the deliverable. A Studio
  migration view belongs with the creation-migration tools. The HTTP error map is already complete.
- **Plans load each Release's whole composition.** This is fine at Phase-1 sizes. Large-scale imports should pair
  this with the planned database-level pagination work.
