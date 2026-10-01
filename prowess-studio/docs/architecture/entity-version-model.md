# EntityVersion — the versioned content layer (M1-WO2)

**Status: implemented, not yet verified by GitHub Actions** — same sandbox
limitation as M1-WO1 (see `docs/architecture/database.md`'s historical
blocker note). Local verification covered everything that doesn't require
the generated Prisma client — see this Work Order's completion report.

## Entity vs. EntityVersion

```
Entity        = stable identity                        (M1-WO1)
EntityVersion = historical/versioned representation of that identity (M1-WO2)
```

```
Entity (canonical_key: test.rule.versioned)
  Revision 1 — displayName: "Test Rule", structuredData: { value: 10 }
  Revision 2 — displayName: "Test Rule", structuredData: { value: 20 }
```

Both revisions belong to the same Entity. Everything that describes *what
this concept currently looks like* — display name, description, rules
text, structured content, status — lives on `EntityVersion`, never on
`Entity`. M1-WO2 does not alter the M1-WO1 Entity model at all beyond
adding the inverse `versions` relation field.

## Revision numbering

`revisionNumber` is a positive integer, unique per Entity
(`UNIQUE(entity_id, revision_number)`) — never the row's identity (that's
still `id`, a UUID, same convention as `Entity`). Two different Entities
may both have a revision 1:

```
Direct Damage   → revision 1
Mana Efficiency → revision 1
```

This is valid and expected — each Entity's revisions are numbered
independently.

### Allocation & concurrency strategy

Callers never supply a revision number — `createEntityVersion(entityId,
input)` always allocates `max(existing revisionNumber for this Entity) + 1`
automatically (starting at 1 for a brand-new Entity).

Two concurrent calls for the *same* Entity will race: both read the
current max, both compute the same "next" number, and Postgres's own
`UNIQUE(entity_id, revision_number)` constraint — not application logic —
is what authoritatively decides which `INSERT` wins. The loser doesn't
fail outright: `@prowess/db`'s repository layer
(`packages/prowess-db/src/entity-version/repository.ts`) catches exactly
that constraint violation and retries — re-reading the now-updated max and
trying again — up to **5** bounded attempts. This is deliberately simple
(no distributed locks, no advisory locks, no queueing) because the
realistic contention here is a handful of concurrent authoring requests
for one Entity, not a high-throughput system; one retry resolves the
overwhelming majority of real races. If all 5 attempts are exhausted
(pathological contention), the service maps the final failure to
`ENTITY_VERSION.REVISION_CONFLICT` — the database constraint remains the
final authority either way.

**Not yet executed** — like every other `@prowess/db` integration test in
this project, this test cannot run in this sandbox (it imports the
generated Prisma client, which this sandbox cannot produce — see "Sandbox
limitations" in the completion report). A dedicated integration test is
written (`tests/integration/entity-version.test.ts`'s concurrency case)
that fires several concurrent `createEntityVersion` calls for one Entity
and asserts all of them succeed with distinct, gapless revision numbers
and that the Entity ends up with exactly that many persisted rows — no
duplicate, no silently lost write. The GitHub Actions run this Work
Order's completion report requests is what will actually confirm this.

## Status field

`status` supports the full controlled `EntityVersionStatus` set (unchanged
since M0-WO1): `DRAFT`, `IN_REVIEW`, `APPROVED`, `PLAYTEST`, `CANON`,
`DEPRECATED`, `SUPERSEDED`, `ARCHIVED`. Defaults to `DRAFT`.

**M1-WO2 establishes the field and its controlled values only.** No
lifecycle-transition rules (which statuses may move to which) and no
immutability enforcement (e.g. that a `CANON` row can never be edited)
exist yet — that is explicitly M1-WO3's responsibility. Nothing in this
Work Order should be read as deciding that `CANON`/`PLAYTEST`/`SUPERSEDED`
rows are editable or uneditable; that decision hasn't been made yet.

## Display-name ownership

`displayName` is required and lives on `EntityVersion`, never `Entity` —
terminology can change across a concept's history ("Evocation" becoming
"Emission," say) while the underlying Entity identity stays exactly the
same. Validated as a non-empty string
(`@prowess/model`'s `isValidDisplayName`) before anything reaches Prisma;
an empty/missing value throws `ENTITY_VERSION.INVALID_INPUT`.

## `structuredData` purpose

A PostgreSQL `JSONB` column (Prisma `Json`), defaulting to an empty object
`{}` — chosen deliberately over `null`-able: every EntityVersion
conceptually "has" structured data, even if empty for now, so a
present-but-empty value is a cleaner contract for consumers than a
three-state null/empty/populated field.

Purpose: a home for variable, subsystem-specific structured content that
*future* schemas will validate — `base_mp`, `damage_parameters`,
`range_parameters`, and the like. **None of those schemas are implemented
in M1-WO2** — the column exists, nothing yet defines or enforces its
internal shape.

**`structured_data` must never become a substitute for relational
architecture.** Entity relationships, Keywords, Sources, Rulesets, and
aliases all get dedicated relational models in their own later Work
Orders — none of them belong inside this JSON blob, no matter how
tempting it is to "just add a field" here instead of a new table.

## Parent lineage

`parentVersionId` is an optional self-reference to another `EntityVersion`:

```
Revision 1
    ↓
Revision 2
    ↓
Revision 3
```

Enforced same-Entity only — `createEntityVersion` rejects a
`parentVersionId` that doesn't exist or belongs to a different Entity
(`ENTITY_VERSION.INVALID_PARENT`), at the **service** boundary, not the
database schema: a plain foreign key can express "this id must exist in
`entity_versions`," but not "and it must share this exact row's
`entity_id`" — that requires an application-level check. A Version being
its own parent is guarded defensively in the same validation function,
though it isn't actually reachable through `createEntityVersion` today
(a new Version's `id` doesn't exist until after it's created) — the check
is there so it isn't forgotten if a future mutation path (M1-WO3) ever
allows setting `parentVersionId` after the fact.

No branching/merge-version UI exists or is implied by this field yet.

## Snapshot behavior

Each persisted `EntityVersion` is a self-contained, immutable snapshot.
Creating revision 2 never alters revision 1 — there is no operation
anywhere in `@prowess/db` that mutates an existing `EntityVersion` row's
content. This is why the Prisma model has no `updatedAt` column, unlike
`Entity`: nothing exists yet to update. A dedicated integration test
(written, not yet executed — see "Sandbox limitations" above) creates two
revisions with different `structuredData`, then re-fetches both and
asserts revision 1's value is unchanged by revision 2's creation.

## EntityVersion error codes

| Code | Thrown by | When |
| --- | --- | --- |
| `ENTITY.NOT_FOUND` (reused, see below) | `createEntityVersion` | The parent Entity doesn't exist |
| `ENTITY_VERSION.NOT_FOUND` | `getEntityVersion` | No Version exists with that UUID |
| `ENTITY_VERSION.REVISION_CONFLICT` | `createEntityVersion` | Bounded retry (see above) was exhausted |
| `ENTITY_VERSION.INVALID_PARENT` | `createEntityVersion` | `parentVersionId` doesn't exist or belongs to a different Entity |
| `ENTITY_VERSION.INVALID_INPUT` | `createEntityVersion` | `displayName` is empty, or an explicitly-supplied `status`/`changeType` isn't a recognized value |

**Deliberate choice, as instructed:** a missing parent Entity reuses
`ENTITY.NOT_FOUND` rather than a parallel `ENTITY_VERSION.ENTITY_NOT_FOUND`
— it's exactly the same condition M1-WO1 already named (an Entity lookup
by id found nothing), so reusing it avoids two codes for one meaning.
`ENTITY_VERSION.INVALID_INPUT` is not one of the three codes M1-WO2's spec
named explicitly (`NOT_FOUND`/`REVISION_CONFLICT`/`INVALID_PARENT`) — it
was added for consistency with `Entity`'s own `INVALID_TYPE`/
`INVALID_CANONICAL_KEY` pattern (validate at the service boundary, before
Prisma, with a named code) rather than leaving basic input validation
uncoded.

## Why content is not stored on Entity

Repeating the core M1-WO1/M1-WO2 architectural rule for emphasis: `Entity`
answers "what is this concept?"; `EntityVersion` answers "what did/does it
look like, as of this revision?" Collapsing the two would mean every
terminology change, rules clarification, or balance patch requires
mutating the one row every relationship in the system points at — exactly
the fragility a stable identity layer exists to prevent.

## Repository / service responsibilities

```
domain (callers)
  -> @prowess/db's entity-version service   (packages/prowess-db/src/entity-version/service.ts)
       validates displayName/status/changeType/parent lineage
       delegates "does the parent Entity exist?" to the Entity service (reuse, not duplication)
       maps the exhausted-retry revision conflict to a domain error
  -> entity-version repository               (packages/prowess-db/src/entity-version/repository.ts)
       Prisma queries only; owns the bounded-retry revision allocation transaction
  -> Prisma / PostgreSQL
```

Only the service (`createEntityVersion`, `getEntityVersion`,
`listEntityVersions`, `getLatestEntityVersion`) is part of `@prowess/db`'s
public surface. The repository's `insertEntityVersionAtRevision` (the
no-allocation, no-retry primitive the higher-level function is built on)
is not re-exported from the package, but is imported directly by this Work
Order's own integration tests to deterministically exercise the real
`(entity_id, revision_number)` unique constraint — a legitimate, same-package
white-box use, not a crossing of the public boundary.

Four operations only, deliberately — no update or delete. M1-WO2's job is
creating and retrieving historical snapshots; M1-WO3 owns whatever narrow,
deliberate mutation rules come later.
