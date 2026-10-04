# Entity — the stable identity layer (M1-WO1)

**Status: implemented and verified.** The permanent GitHub Actions CI workflow passed against this component when its Work Order was approved, and the M1 audit gate (`docs/audits/m1-completion-audit.md`) re-checks its invariants. Earlier revisions of this document recorded it as "not yet verified" because the authoring sandbox could not run Prisma or a browser; that limited only *local* verification and is resolved by CI.

## What an Entity represents

An `Entity` is the stable identity object used throughout Prowess. It
answers exactly one question: **"what Prowess concept is this?"** —
independent of any particular historical rules/lore version of that
concept.

```
Entity
  id: 3fa85f64-5717-4562-b3fc-2c963f66afa6
  entityType: SPELL_EFFECT
  canonicalKey: spell.effect.damage.direct
```

Future real Entities will include things like Direct Damage, Mana
Efficiency, Strength, Arcana, Human, Longsword, Silver Company, and Silver
City — but M1-WO1 does not seed any of them (see "No Prowess content
seeding yet" below).

## What an Entity deliberately does not contain

An `Entity` has almost no mutable state by design, and in particular never
holds:

- a display name
- a description
- rules text
- mechanical values
- lore text
- a status
- a version number
- Spell configuration or other balance data

All of the above describe **content about** an Entity at a point in time,
not the Entity's identity — they belong on `EntityVersion` (M1-WO2, not yet
implemented). Renaming "Direct Damage" to something else in the future, or
changing its rules text, must never require touching the Entity row at
all — only a new `EntityVersion` pointing at the same `id`.

## Entity vs. EntityVersion

```
Entity        = stable identity     (this Work Order)
EntityVersion = changing/versioned content, pointing back at an Entity (M1-WO2)
```

This is the core architectural rule PAS-10 establishes for the whole
Compendium system, and M1-WO1 implements only the first half.

## UUID identity

`Entity.id` is a Postgres-native `uuid` column (`@default(uuid())
@db.Uuid` in Prisma, DB-generated via `gen_random_uuid()` — no extension
required, available in PostgreSQL 16 core), following the same convention
established for `SystemMigrationProbe` in M0-WO3:

- **opaque** — carries no meaning of its own;
- **immutable** — never reassigned after creation;
- **the actual relational identity** — every foreign key referencing an
  Entity (starting with `EntityVersion` in M1-WO2) points at this column,
  never at the canonical key, a name, or an integer sequence.

## Canonical key

`canonicalKey` is the stable, machine-readable, namespace-aware identity
string — e.g. `spell.effect.damage.direct`, `resource.mana_efficiency`,
`stat.strength`. Its purpose is to give Entities a human-legible, version-
control-friendly identifier that doesn't depend on the (changeable)
display name — the same purpose git commit messages vs. commit hashes
serve, loosely speaking: the UUID is the real identity; the canonical key
is the stable, readable handle developers and content authors actually
reference.

A canonical key must never encode:
- a version number
- a source-document location
- a page number
- a book chapter

If any of those changed, it would force an identity change, which defeats
the point of having a stable identity layer at all.

### Format

Two or more lowercase, alphanumeric-and-underscore segments separated by
single periods: `segment.segment` at minimum, with as many further
`.segment`s as a namespace needs. Validated centrally by
`@prowess/model`'s `isValidCanonicalKey()` / `CanonicalKey.parse()`
(`packages/prowess-model/src/canonical-key.ts`) — this is the one place
the grammar is defined; nothing hardcodes specific subsystem namespaces, so
future ones (`stat.*`, `skill.*`, `race.*`, ...) need no change here.

Valid: `stat.strength`, `skill.arcana`, `resource.mana_efficiency`,
`spell.effect.damage.direct`.

Invalid: `Direct Damage` (spaces/uppercase), `SPELL.DAMAGE` (uppercase),
`spell..damage` (empty segment), `spell` (single segment — not
namespace-aware).

The database's own `UNIQUE` constraint on `canonical_key` remains the
authoritative guard against duplicates — the TypeScript-level validation
is a fast, clear rejection at the application boundary, not a replacement
for it (a race between two concurrent creates is still correctly caught by
Postgres and mapped to the same domain error — see "Error handling"
below).

## EntityType

A controlled enum, kept in exact lockstep between `@prowess/model`
(`packages/prowess-model/src/entity-type.ts` — the framework-independent
source of truth the application layer validates against) and Prisma's own
`EntityType` enum (`packages/prowess-db/prisma/schema.prisma`):

```
GENERIC_RULE
SYSTEM
RESOURCE
SPELL_EFFECT
SPELL_TRAIT
TARGETING
KEYWORD
```

Deliberately the smallest useful Phase 1 set. The architecture anticipates
(but does not yet implement) future additions — `STAT`, `SKILL`, `RACE`,
`WEAPON`, `ARMOR`, `MANEUVER`, `SUMMON`, `MAGE_ART`, `PAC`, `ORGANIZATION`,
`LOCATION`, `PERSON`, `CREATURE`, `WORLD_CONCEPT` — added only when a
concrete Work Order needs them, in both places at once.

## Repository / service responsibilities

```
domain (callers)
  -> @prowess/db's entity service   (packages/prowess-db/src/entity/service.ts)
       validates input against @prowess/model's controlled types
       maps Prisma's unique-constraint violation to a domain error
  -> entity repository               (packages/prowess-db/src/entity/repository.ts)
       Prisma queries only, no business rules
  -> Prisma / PostgreSQL
```

Only the **service** is part of `@prowess/db`'s public surface
(`createEntity`, `getEntityById`, `findEntityByCanonicalKey`, all
re-exported from the package's own `index.ts`). The repository is an
internal implementation detail — callers never import it directly, and it
is not re-exported. This is what keeps Prisma isolated inside persistence
infrastructure: nothing outside `@prowess/db` imports `@prisma/client`,
the generated client, or any Prisma type.

Three operations only, deliberately — no larger service framework for what
M1-WO1 needs. `EntityVersion` operations begin in M1-WO2.

### `created_by` / `archived_at` — deliberately deferred

PAS-10 allows optional audit metadata on Entity "only if they fit the
existing architecture cleanly." No actor/identity system exists yet
anywhere in this platform, so `createdBy` is omitted entirely rather than
adding a column with no real identity behind it — that would be fake
ownership infrastructure, not a real feature. This is an explicit,
documented deferral, not an oversight: when an actor/identity system
exists, `createdBy` (and similar fields) should be added deliberately at
that point, informed by whatever that system's actual shape turns out to
be.

## Error handling

Three domain error codes, defined in `@prowess/model`
(`packages/prowess-model/src/errors.ts`) as a `DomainError` class carrying
a stable `code` string — framework-independent, usable by the service
layer today and by any future API layer without duplicating the
vocabulary:

| Code | Thrown by | When |
| --- | --- | --- |
| `ENTITY.NOT_FOUND` | `getEntityById` | No Entity exists with that UUID (explicit-identity lookup — absence is exceptional) |
| `ENTITY.CANONICAL_KEY_CONFLICT` | `createEntity` | The canonical key is already registered to a different Entity |
| `ENTITY.INVALID_TYPE` | `createEntity` | The supplied `entityType` isn't a recognized `EntityType` |
| `ENTITY.INVALID_CANONICAL_KEY` | `createEntity` | The supplied `canonicalKey` fails shape validation |

**`findEntityByCanonicalKey` returns `null`, not an error, when nothing
matches** — a search-style lookup may legitimately find nothing; this is
an expected outcome, not an exceptional one. Contrast with
`getEntityById`, where looking up by explicit identity implies the caller
expects the row to exist.

An opaque Prisma error (e.g. a raw `P2002` unique-constraint violation)
never leaks past the service boundary — `createEntity` catches it and
re-throws the documented `ENTITY.CANONICAL_KEY_CONFLICT` instead.

## No Prowess content seeding yet

The migration introduces the `entities` table and `EntityType` enum only —
no rows. Tests use clearly synthetic fixtures (`test.rule.example`,
`test.resource.*`, etc.), all cleaned up after the suite runs. Real Prowess
content import begins in a later Work Order.

## Scope boundary for M1-WO1

Explicitly out of scope, to begin in later M1 Work Orders:
`EntityVersion`, display names, descriptions, rules text, statuses,
aliases, Keywords, relationships, Sources, the Compendium Entity Browser,
the final Entity HTTP API, Rulesets, Canon, Spell mechanics.
