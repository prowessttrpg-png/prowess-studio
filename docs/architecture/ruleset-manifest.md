# Ruleset Manifest & EntityVersion Pinning (M2-WO2)

**Status: implemented; awaiting its first CI run.** M2-WO2 gives a Ruleset an
explicit, reproducible composition of exact EntityVersions. It has no HTTP API, no
UI, no inheritance, and no publishing.

## Ruleset vs RulesetManifest

A **Ruleset** (M2-WO1) is a stable identity: a named rules configuration. A
**RulesetManifest** is one *historical snapshot* of what that Ruleset is composed of.

```
Ruleset
  ├── Manifest 1
  │     ├── Entity A → Revision 1
  │     └── Entity B → Revision 3
  │
  └── Manifest 2
        ├── Entity A → Revision 2
        └── Entity B → Revision 3
```

A Ruleset does not own a mutable map of EntityVersions. It has many manifests over
time; each manifest is created once and never edited.

## Exact pinning

A manifest entry means exactly: *within this manifest, use this EntityVersion for this
Entity.* It does **not** mean "the latest version from now on". If Revision 4 of an
Entity is created later, a manifest pinned to Revision 2 still resolves to Revision 2,
and always will; the only way to change a composition is to create a **new** manifest.

A Ruleset therefore never determines content by asking for the latest EntityVersion,
the highest revision number, CANON status alone, or Source authority alone. None of
those is consulted anywhere in manifest code (a static audit scans for the identifiers).

## What is stored

| Table | Columns |
| --- | --- |
| `ruleset_manifests` | `id` (UUID), `ruleset_id`, `manifest_version`, `created_at` |
| `ruleset_manifest_entries` | `id` (UUID), `manifest_id`, `entity_id`, `entity_version_id`, `created_at` |

There is **no** `updated_at` (a snapshot is never edited) and **no**
`current_manifest_id` / `active_manifest_id` / `is_active` / `is_current` anywhere —
not on `rulesets`, not on `entities`, not on `entity_versions`. Both id defaults and
`created_at` follow the M1-WO11 conventions, so the blocking drift gate stays at zero.

## manifest_version

Positive, automatically allocated (1, 2, 3 … **per Ruleset**), never supplied by a
caller (the input type has no field for it, and a test smuggles one in to prove it is
ignored). `UNIQUE(ruleset_id, manifest_version)` is the final authority. Two Rulesets
can each have a manifest version 1. Positivity is guaranteed by the allocator (it
starts at 1) and pinned by tests; no CHECK constraint is used, following M1's
convention, because the project has no evidence yet of how Prisma's drift check treats
CHECK constraints and the drift gate is blocking.

## One Entity per manifest; the Version must belong to the Entity

`UNIQUE(manifest_id, entity_id)` — a manifest pins one Version per Entity.

The core invariant — `EntityVersion.entityId` equals the entry's `entityId` — is
enforced **twice**: by the service (which reports `VERSION_ENTITY_MISMATCH`) and by the
database itself. The entry's reference to the Version is a **composite foreign key**,
`(entity_version_id, entity_id) → entity_versions(id, entity_id)`, so "Entity A pinned
to Entity B's Version" cannot exist even if a row is inserted directly, bypassing the
service (tested). Postgres requires a unique index on the referenced pair, so this
migration adds `entity_versions_id_entity_id_key`. That index imposes no real new
constraint on EntityVersion (`id` is already its primary key); it exists only as the
target of the foreign key.

Because that one constraint also guarantees the Entity exists, there is **no separate
foreign key to `entities`** — which would have been a second, overlapping relation on
`entity_id`. A consequence worth knowing: `Entity` has no `manifestEntries`
back-relation; reach the pins through the Entity's versions.

## Atomic creation

`createRulesetManifest(rulesetId, { entries })` validates first, in order, reporting the
first failure and writing nothing:

1. input shape → `INVALID_INPUT`
2. the same Entity twice → `DUPLICATE_ENTITY`
3. the Ruleset exists → `RULESET_NOT_FOUND`
4. for each entry: the Entity exists → `ENTITY_NOT_FOUND`; the Version exists →
   `VERSION_NOT_FOUND`; it belongs to that Entity → `VERSION_ENTITY_MISMATCH`

then writes the manifest and **all** entries in one transaction. If anything fails —
including a database-level rejection after valid entries were already inserted — the
whole transaction rolls back: no manifest, no entries, and no version number consumed.
A test exercises this at the repository layer with a real foreign-key failure, not just
through the service's pre-validation.

An **empty** manifest is allowed: it cleanly means "this Ruleset currently pins no
Entity content", and no PAS rule forbids it.

## Concurrency

The same bounded-retry strategy as EntityVersion revision allocation: one transaction
reads the Ruleset's highest `manifest_version`, inserts the next, and if another request
won the same number the unique constraint rejects the attempt and it retries against a
fresh maximum (up to 8 attempts). Every round at least one contender wins, so up to 8
*simultaneous* creators for one Ruleset are guaranteed to all succeed with distinct,
gap-free versions; beyond that the request fails with `VERSION_CONFLICT`, which is safe
to retry. A concurrent-creation test checks distinct versions, no lost manifest, and
that every manifest received its entry.

## No mutation after creation

There is **no** operation that adds, removes, or updates entries of an existing
manifest — none is exported, and a static audit asserts the exact public surface. To
change a composition, create a new manifest. All foreign keys are `ON DELETE RESTRICT`:
a manifest's Ruleset, the manifest itself, and every pinned Version cannot be
physically deleted while referenced, so historical composition is never cascade-deleted.

## Operations

`createRulesetManifest`, `getRulesetManifest`, `listRulesetManifests` (headers, ordered
`manifest_version ASC`), `getLatestRulesetManifest`, `getManifestEntry`,
`resolveEntityVersionFromManifest`.

- **Latest Manifest** means the highest `manifest_version` — a deterministic historical
  convenience only. It is not the published, active, or Canon manifest; no such concept
  exists yet.
- `getManifestEntry` / `resolveEntityVersionFromManifest` return `null` when the Entity
  is not pinned in that manifest (a search may find nothing). An unknown manifest is
  `RULESET_MANIFEST.NOT_FOUND`. A Ruleset with no manifests yet lists as empty; a Ruleset
  that does not exist is `RULESET_NOT_FOUND` — different facts.
- Entries are ordered by the pinned Entity's `canonical_key` ASC, then `entity_id` ASC.

## What deliberately has no influence

- **Latest EntityVersion** — never consulted. A test pins A1, creates A2, and confirms
  resolution still returns A1 (after proving the Entity's latest really moved to A2).
- **Parent Ruleset** — ignored. If a child Ruleset has no entry for an Entity, it does
  **not** look in its parent; a regression test pins that. Inheritance begins in M2-WO3.
- **Lifecycle status** — a manifest may pin a DRAFT as readily as a CANON. M2-WO2 is
  composition infrastructure, not publication governance; later publishing or Canon
  policies may restrict eligible states.
- **Source authority** — a GOVERNING source never causes its Version to be selected. A
  test pins a DRAFT with a GOVERNING source while a CANON sibling exists, and the DRAFT
  resolves.
- **Keywords and relationships** — never affect selection; selection is by Version id.

## Errors

One consistent namespace, `RULESET_MANIFEST.*`, covers every manifest failure —
including a missing Ruleset, Entity, or Version — instead of reusing
`RULESET.NOT_FOUND` / `ENTITY.NOT_FOUND` / `ENTITY_VERSION.NOT_FOUND`. `NOT_FOUND`
means "the manifest you asked for does not exist"; `ENTITY_NOT_FOUND` /
`VERSION_NOT_FOUND` mean "something your request *references* does not exist". Callers
and the HTTP map need to tell those apart, and one namespace means one import.

| Code | HTTP (reserved — no route yet) |
| --- | --- |
| `NOT_FOUND`, `RULESET_NOT_FOUND` | 404 (the Ruleset is the resource a request is addressed to) |
| `INVALID_INPUT`, `ENTITY_NOT_FOUND`, `VERSION_NOT_FOUND`, `VERSION_ENTITY_MISMATCH`, `DUPLICATE_ENTITY` | 400 (references inside the request body) |
| `VERSION_CONFLICT` | 409 (lost the allocation race repeatedly; safe to retry) |

The statuses are recorded in the central compile-time-exhaustive map now (leaving them
out is a type error — verified), so a future route need not retrofit them.

## Explicitly deferred

Ruleset inheritance and any "effective manifest" (M2-WO3); Canon policy and decisions;
Source authority governance; rule conflicts; change sets; publishing and releases; any
notion of a current/active/published manifest; migration planning; HTTP API; UI.
