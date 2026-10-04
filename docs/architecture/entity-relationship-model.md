# Entity Relationships (M1-WO6)

**Status: implemented and verified.** The permanent GitHub Actions CI workflow passed against this component when its Work Order was approved, and the M1 audit gate (`docs/audits/m1-completion-audit.md`) re-checks its invariants. Earlier revisions of this document recorded it as "not yet verified" because the authoring sandbox could not run Prisma or a browser; that limited only *local* verification and is resolved by CI.

## What EntityRelationship represents

A stable, directed, structural relationship between two Entity identities:

```
Entity A
    |
    v  RELATIONSHIP
Entity B
```

e.g. `Direct Damage REQUIRES Arcana`, `Silver Company BELONGS_TO Silver
City`, `Rule A SEE_ALSO Rule B` — conceptual examples only; this Work
Order seeds no official Prowess relationships.

## Stable identity scope — not EntityVersion

```
EntityRelationship = stable/editorial/structural relationship between identities
```

M1-WO6 implements relationships between stable Entity identities **only**.
It does not implement relationships between specific EntityVersions, and
is not meant to. A relationship created from Entity A to Entity B is a
durable fact about those two concepts — it says nothing about any
particular historical revision of either one, and it doesn't need to:
"Direct Damage relates to Arcana" is true independent of which Revision of
either Entity's rules text happens to be current.

### Why version-specific relationships are intentionally deferred

Version-sensitive or calculation-bearing relationships — "in Revision 3
specifically, this costs 2 fewer MP because of that relationship," or any
other relationship whose *meaning* could change by revision — are
explicitly **out of scope** here and must not be forced into this generic
table. They belong to:

- dedicated version-scoped relationship models;
- `RequirementDefinition`;
- typed subsystem joins;
- Ruleset-specific structures.

None of those exist yet. Stretching `EntityRelationship` to simulate any
of them now (e.g. by encoding a Version id into `metadata`, or adding an
optional EntityVersion foreign key "just in case") would blur a
foundational distinction this platform depends on — so M1-WO6 doesn't add
an EntityVersion foreign key to this table at all.

## No unstated mechanics — same principle as Keywords

An `EntityRelationship` states that a relationship exists. It does **not**
automatically modify MP, modify AP, change damage, grant a Trait, satisfy
a Requirement, determine targeting, alter Character statistics, or
activate a rule — **including when `relationshipType` is literally
`MODIFIES`.** The type name is descriptive, not executable. Future systems
may explicitly *query* a relationship (e.g. "does this Spell Effect have a
`REQUIRES` relationship to this Trait?"); nothing in this Work Order's code
ever acts on one automatically.

Verified, not just asserted: a dedicated integration test creates a
`MODIFIES` relationship between two Entities, each with an EntityVersion
carrying specific `structuredData`, and confirms both Versions' content is
byte-for-byte unchanged afterward.

## RelationshipType — reused, not duplicated

The framework-independent `RelationshipType` M0-WO1 already established
(`packages/prowess-model/src/relationship-type.ts`) already contained
exactly the Phase 1 vocabulary this Work Order needs:

```
REQUIRES
MODIFIES
USES
COMPATIBLE_WITH
INCOMPATIBLE_WITH
PART_OF
BELONGS_TO
SEE_ALSO
```

Reused verbatim — no parallel enum, no duplicated vocabulary. The Prisma
schema's `RelationshipType` enum is kept in exact lockstep with this file
by convention (the same discipline already applied to `EntityType` and
`EntityVersionStatus`); a unit test in `relationship-type.test.ts` and this
Work Order's own tests exercise every value from the domain side, which
would catch the two enums drifting apart if the Prisma side were ever
edited without updating `@prowess/model` to match (or vice versa).

## Directional storage, no automatic inverse

Relationships are stored in **one authoritative direction only**:

```
Entity A
REQUIRES
Entity B
```

is exactly one row. Creating it does **not** automatically create:

```
Entity B
REQUIRED_BY
Entity A
```

Inverse language ("Required By") is a future UI-layer presentation
concern — rendered by reading the *incoming* side of the relationship and
phrasing it accordingly — never a second stored row. A dedicated
regression test creates `A REQUIRES B` and confirms
`getOutgoingRelationships(B)` does **not** contain any mirrored entry.

Every stored relationship is treated as directional for M1-WO6, even for
types a person might intuitively read as symmetric (`SEE_ALSO`). `A
SEE_ALSO B` and `B SEE_ALSO A` are two technically distinct rows if
deliberately authored — no symmetric-pair canonicalization exists or is
attempted in this Work Order.

## Duplicate policy

Prevented: an exact duplicate — same source, same target, same
`relationshipType`:

```
UNIQUE(source_entity_id, target_entity_id, relationship_type)
```

Allowed, explicitly:

```
A USES B
A REQUIRES B          <- different type, same pair: both exist

A REQUIRES B
B REQUIRES A           <- different authoritative direction: both exist
```

If the same pair legitimately needs additional context, that belongs on
the one relationship's `metadata` (or a future specialized model) — never
on a second, duplicate semantic row distinguished only by what's in its
metadata.

## Self-reference policy

`sourceEntityId === targetEntityId` is rejected — `RELATIONSHIP.
SELF_REFERENCE` — checked and thrown at the `@prowess/db` service
boundary **before** anything reaches Prisma, not caught after the fact by
a database constraint. A generic self-relationship isn't useful for the
current vocabulary and is far more likely to represent an authoring
error than a deliberate fact. If a future subsystem genuinely needs a
reflexive relationship, it can define an explicit, documented exception
at that point — this Work Order doesn't guess at what that exception
should look like.

**Deliberately no database `CHECK` constraint for this.** Prisma's schema
language has no first-class `CHECK`-constraint attribute, and hand-adding
one directly into a migration's raw SQL (bypassing what `schema.prisma`
itself describes) risks confusing Prisma's own drift detection on a
*future* migration. Application-layer validation — the same place
canonical-key format, display-name non-emptiness, and every other input
rule in this project already live — handles this cleanly without that
risk.

## Metadata

A lightweight `JSONB` column (Prisma `Json`, `@prowess/model`'s
`JsonObject`), defaulting to `{}` — same present-but-empty-by-default
reasoning as `EntityVersion.structuredData` (M1-WO2). Purpose: editorial
qualifiers, notes, future display information, non-mechanical structured
context. Example: `{ "note": "test relationship" }`.

**`metadata` is non-authoritative for mechanics — this cannot be overstated.**
Do not place `{ "mp_discount": 2 }` or `{ "damage_bonus": 5 }` here and
then have some mechanical system read and act on those values. That would
turn a generic, descriptive field into a hidden calculation input — exactly
what §2's "no unstated mechanics" rule forbids, just smuggled in through
JSON instead of a named column. Calculation-bearing structures receive
dedicated, explicitly-typed models in a later Work Order. A dedicated
integration test proves metadata round-trips exactly, byte-for-byte, with
no interpretation applied to it anywhere in this Work Order's code.

## Incoming vs. outgoing queries

Two separate functions, each returning the relationship paired with the
*counterpart* Entity's stable identity (PAS-10 M1-WO6 §21 — chosen over
returning the bare relationship record alone, for the same reason
`findEntitiesByAlias`/`findEntitiesByKeyword` return their counterpart
Entity too, consistent with this project's established pattern):

```
getOutgoingRelationships(entityId)   -> this Entity as SOURCE, paired with each TARGET
getIncomingRelationships(entityId)   -> this Entity as TARGET, paired with each SOURCE
```

Neither invents a "current display name," a "current Version," or any
Ruleset-resolved value — none of those systems exist yet, and a
relationship query has no business guessing at them. The counterpart is
always stable Entity identity only (id + canonical key), never anything
version-dependent.

Ordered `relationshipType ASC`, then counterpart Entity `id ASC` —
deterministic and documented, independent of database natural row order
(which Postgres never actually guarantees to be stable across queries
without an explicit `ORDER BY` anyway).

## Why typed/calculation-bearing subsystem joins will exist separately later

This table intentionally stays generic and dumb: a directed edge with a
type label and free-form descriptive metadata. That's exactly right for
"Direct Damage relates to Arcana, here's a one-line editorial note about
why" — and exactly wrong for anything a mechanical system needs to
compute with. When Prowess needs, say, a typed `SpellRequiresTrait` join
carrying actual numeric parameters a resolver reads and acts on, that join
deserves its own explicitly-typed model with real, named, validated
columns — not a Keyword-style `relationship_type` string plus a JSON blob
pretending to be structured data. Keeping the generic graph generic, and
building typed joins separately when they're actually needed, is what
keeps each system honest about what it does and doesn't do.

## Repository / service responsibilities

```
domain (callers)
  -> entity-relationship service     (packages/prowess-db/src/entity-relationship/service.ts)
       validates self-reference, type, source existence, target existence
       maps the unique-constraint violation to a domain error
  -> entity-relationship repository   (packages/prowess-db/src/entity-relationship/repository.ts)
       Prisma queries only; both directional list queries
  -> Prisma / PostgreSQL
```

Only the service (`createEntityRelationship`, `getEntityRelationship`,
`getOutgoingRelationships`, `getIncomingRelationships`,
`removeEntityRelationship`) is part of `@prowess/db`'s public surface.

## Error codes

| Code | Thrown by | When |
| --- | --- | --- |
| `RELATIONSHIP.SELF_REFERENCE` | `createEntityRelationship` | `sourceEntityId === targetEntityId` |
| `RELATIONSHIP.INVALID_TYPE` | `createEntityRelationship` | `relationshipType` isn't a recognized `RelationshipType` |
| `RELATIONSHIP.INVALID_SOURCE` | `createEntityRelationship` | The source Entity doesn't exist |
| `RELATIONSHIP.INVALID_TARGET` | `createEntityRelationship` | The target Entity doesn't exist |
| `RELATIONSHIP.DUPLICATE` | `createEntityRelationship` | The exact `(source, target, type)` triple already exists |
| `RELATIONSHIP.NOT_FOUND` | `getEntityRelationship`, `removeEntityRelationship` | No relationship exists with that id |

Source and target failures are deliberately **two distinct codes, never
collapsed into one generic not-found** — a caller should know which side
of the relationship is invalid without having to inspect the
relationship's own fields to figure it out. `getOutgoingRelationships`/
`getIncomingRelationships` return an empty array, not an error, for an
Entity with none — the same "a search finding nothing is not exceptional"
reasoning used throughout this project since M1-WO1.

## Deletion behavior

Both `sourceEntityId` and `targetEntityId` use `onDelete: Restrict` — an
Entity participating in any relationship, as either side, cannot be
physically deleted while that relationship exists. Removing the
relationship itself (`removeEntityRelationship`) deletes only that one
row: it never touches the source Entity, target Entity, any
`EntityVersion`, alias, or Keyword assignment. A dedicated integration
test proves an Entity involved in a relationship is rejected by a direct
deletion attempt, and becomes deletable again (for Entities with no other
history-preserving dependents) once the relationship is removed —
confirming the relationship itself, specifically, was what was blocking
it.

## Version independence

Because relationships belong to stable Entity identity rather than any
particular Version, creating an additional `EntityVersion` for an Entity
that already participates in a relationship must never duplicate, delete,
move, or re-scope that relationship. A dedicated integration test creates
Entity A's first Version, then an `A -> B` relationship, then a second
Version of A, and confirms exactly one relationship still exists,
unchanged, still attached to A's stable identity rather than either
Version specifically.
