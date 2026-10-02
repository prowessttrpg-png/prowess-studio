# Keyword Foundation (M1-WO5)

**Status: implemented, not yet verified by GitHub Actions** — same sandbox
limitation as every prior Work Order (see `docs/architecture/database.md`'s
historical blocker note).

## The core rule — read this first

**A Keyword means "this object is tagged with this defined concept." It
does NOT implicitly mean:** add damage, change MP, modify AP, trigger a
Trait, grant resistance, change targeting, or invoke any other mechanical
behavior. Mechanical systems may explicitly *query* Keywords later — no
Keyword may acquire unstated mechanical behavior as a side effect of this
Work Order. Nothing in `@prowess/model` or `@prowess/db`'s Keyword code
computes, triggers, or modifies anything; it only records and retrieves
tags.

## Architecture

```
KeywordCategory
      |
      v
KeywordDefinition
      |
      v
Assignments to Entity or EntityVersion
```

```
KeywordDefinition:
  canonical_key = test.keyword.damage
  name = Damage

Entity: test.rule.example
  Revision 1: Keywords = Damage
  Revision 2: Keywords = Damage, Control
```

The two revisions may differ without changing Entity identity at all —
exactly the same historical-independence principle M1-WO2 established for
every other authored field.

## KeywordCategory

A purely organizational grouping for `KeywordDefinition`s — carries no
mechanical meaning of its own, any more than a Keyword does. Reuses the
exact same `CanonicalKey` grammar/validation as `Entity` and everything
else in this platform (`spell.affinity.emission`-style keys) — no parallel
key format exists. Future category keys might conceptually resemble
`keyword.category.effect` or `keyword.category.damage`; none are hardcoded
or seeded by this Work Order.

Only three operations exist: `createKeywordCategory`, `getKeywordCategory`,
`findKeywordCategoryByCanonicalKey`. No update or delete API yet.

## KeywordDefinition

The reusable Keyword concept itself — one row per concept, reused by every
Entity/EntityVersion tagged with it, never duplicated per target:

```
KeywordDefinition:
  keyword.damage

EntityVersion:
  Direct Damage Revision 2

Assignment:
  Direct Damage Revision 2 -> keyword.damage
```

A Keyword may exist without a Category (`categoryId: null`) — authoring
flexibility is preferred over forcing premature categorization. `deprecated`
defaults to `false` and is **descriptive metadata only** (see "Deprecated
metadata" below).

Four operations: `createKeywordDefinition`, `getKeywordDefinition`,
`findKeywordDefinitionByCanonicalKey`, `listKeywordDefinitions(categoryId?)`
— ordered `canonicalKey ASC`, deterministic whether or not a category
filter is applied.

### Not automatically mirrored into `EntityType.KEYWORD`

M1-WO1's `EntityType` enum already contains a `KEYWORD` value. **No
`Entity` row is automatically created for a `KeywordDefinition` in this
Work Order**, and no `KeywordDefinition` is automatically backed by an
`Entity` row either — `KeywordDefinition.id` is the one clear source of
Keyword identity for now. Whether some Keywords should later also be
represented as broader Entities (for Canon/content-unification purposes)
is an explicit future decision — this Work Order does not decide it by
accident via hidden dual-record creation.

## Assignment vs. definition

Keep these distinct:

```
KeywordDefinition  = the reusable concept itself
Keyword assignment = a statement that a particular target has that Keyword
```

## Entity-level vs. EntityVersion-level assignment

```
Entity-level assignment:        "This Keyword describes the stable identity itself."
EntityVersion-level assignment: "This Keyword applies to this specific historical/versioned representation."
```

Entity-level examples: a creature classification, an organization type, a
Spell Effect's identity classification. Version-level examples: Fire,
Ongoing, Zone, Sustained — specific mechanical classifications capable of
changing between revisions.

**Version-level assignment is the preferred location for any Keyword
describing mechanics that might change by revision.** If a classification
could plausibly differ between Revision 1 and Revision 2 of the same
Entity, it belongs on the Version, not the Entity — Entity-level is
reserved for what genuinely never changes about the stable identity.

**No automatic inference or copying exists in either direction.** Creating
a new EntityVersion does not copy the previous revision's Keywords, and no
Entity-level Keyword is automatically applied to any Version. Every
assignment is the direct, explicit result of a caller calling
`assignKeywordToEntity` or `assignKeywordToEntityVersion` — confirmed by a
dedicated integration test proving a second revision does NOT inherit the
first's Keywords.

## Why two relational models, not one polymorphic one

`EntityKeyword` and `EntityVersionKeyword` are two separate, explicitly-
typed models, each with a real foreign key PostgreSQL can enforce —
deliberately **not** a single table using a `target_type` + `target_id`
polymorphic column. A polymorphic design can't have PostgreSQL verify that
`target_id` actually refers to a row in the table `target_type` claims;
two explicit models can, and do: `EntityKeyword.entityId` is a real FK to
`entities.id`, and `EntityVersionKeyword.entityVersionId` is a real FK to
`entity_versions.id`. The small duplication (two near-identical tables
instead of one) buys real, database-enforced referential integrity instead
of an application-level promise.

Both use a **composite primary key** — `(entityId, keywordId)` and
`(entityVersionId, keywordId)` respectively — rather than a separate
synthetic `id` column. The natural key both identifies the assignment row
and enforces "a target must not contain the same Keyword twice" as a
single database constraint, not a separate uniqueness check layered on top
of an otherwise-meaningless id.

## Assignment source type

```
AUTHORED   - a manually-created assignment. The only kind this Work Order ever produces.
INHERITED  - reserved for a future system that derives an assignment from something else.
CALCULATED - reserved for a future system that computes an assignment from rules/content.
```

`INHERITED` and `CALCULATED` establish the architecture (a dedicated
column, so a later system doesn't need a schema migration just to record
*how* an assignment came to exist) but **nothing in this Work Order ever
produces either kind of row.** A target cannot carry duplicate copies of
the same Keyword under different source types — the uniqueness constraint
is on `(target, keyword)` alone, not `(target, keyword, source)`. If
future provenance genuinely needs multiple contributing sources for one
semantic tag, that should be modeled explicitly when that system is built,
not approximated by allowing duplicate rows now.

## Version lifecycle interaction

Because a Version-level Keyword assignment describes that Version's
*content*, authored assignment/removal follows the exact same DRAFT-only
mutability rule M1-WO3 established for every other authored field:

```
DRAFT EntityVersion      -> authored Keyword assignments may be changed
non-DRAFT EntityVersion  -> authored Keyword assignments are protected
```

A `CANON` Version's semantic Keyword classification cannot be changed
while its rules content remains frozen — for the same reason its
`rulesText` can't be. **Reading is never restricted** —
`listEntityVersionKeywords` works regardless of status; only authored
assignment/removal is gated. `INHERITED`/`CALCULATED` behavior doesn't
exist yet, so there's no mechanism that could bypass this rule even in
principle — the rule only has one real door (`AUTHORED`, via the explicit
service functions), and that door is DRAFT-only.

### The atomic guard, across two tables

M1-WO3's atomic conditional update (`UPDATE entity_versions SET ... WHERE
id = ? AND status = 'DRAFT'`) works because the guarded column and the
guarded condition live in the *same* row of the *same* table. A Keyword
assignment lives in a different table (`entity_version_keywords`), so that
exact trick doesn't directly apply — there's no `status` column on *this*
table to condition an `UPDATE` on.

Instead: `packages/prowess-db/src/entity-version-keyword/repository.ts`
runs a short transaction that takes a row lock on the `EntityVersion`
itself first —

```sql
SELECT status FROM entity_versions WHERE id = $1 FOR UPDATE
```

— checks the locked status, and only then performs the insert/delete, all
inside that one transaction. The lock is what makes this atomic: Postgres
blocks any concurrent writer to that row — including M1-WO3's own
`transitionEntityVersionStatus`, which does its own conditional `UPDATE
... WHERE id = ? AND status = ?` against the very same row — until this
transaction commits or rolls back. A status transition racing against a
Keyword assignment is therefore fully serialized by Postgres itself, not
by application-level check-then-act logic. No distributed lock, no
polling, no retry loop — the same reliance on the database's own
concurrency control that M1-WO3 used, just applied across two tables
instead of one.

The DRAFT check itself reuses `@prowess/model`'s `canMutateEntityVersionContent`
— the same one authoritative function M1-WO3 introduced — rather than a
second, parallel `=== "DRAFT"` comparison living in this Work Order's code.

## Reverse lookup

Two separate functions, never merged:

```
findEntitiesByKeyword(keywordId)         -> Entity-level matches only
findEntityVersionsByKeyword(keywordId)   -> EntityVersion-level matches only
```

Both are deliberately **0..many**, never exactly one, and neither
arbitrarily picks a "first" result when several exist — e.g.
`keyword.alpha` assigned to both Entity A and Entity B means
`findEntitiesByKeyword` returns both. **Neither function infers a
"current" EntityVersion.** Ruleset/current-version selection doesn't exist
yet (that's M2) — a Version-level reverse lookup returns every matching
historical revision across every Entity, with no attempt to guess which
one (if any) would be "the" relevant one for some hypothetical Ruleset.

## No implicit mechanics — verified, not just asserted

Beyond the documentation above, a dedicated integration test actually
creates an EntityVersion with specific `structuredData`/`rulesText`,
assigns a Keyword to it, and re-fetches the Version to confirm
`structuredData`, `status`, `rulesText`, and `revisionNumber` are all
byte-for-byte unchanged. The same is proven for removal. Keyword
assignment touches only the `entity_keywords`/`entity_version_keywords`
tables — never a column on `Entity` or `EntityVersion` itself.

## Deprecated metadata

`KeywordDefinition.deprecated` is **descriptive metadata only** in
M1-WO5. Setting it `true`:

- does **not** automatically delete or hide existing assignments;
- does **not** automatically prevent new assignments;
- has **no other behavioral effect** anywhere in this Work Order.

Actual deprecation governance (warnings, blocking new assignments,
migration tooling) belongs to a later Canon system — this field exists now
so that system has somewhere to read from later, without this Work Order
pretending to implement governance it doesn't.

## Error codes

| Code | Thrown by | When |
| --- | --- | --- |
| `KEYWORD_CATEGORY.NOT_FOUND` | `getKeywordCategory` | No Category exists with that UUID |
| `KEYWORD_CATEGORY.CANONICAL_KEY_CONFLICT` | `createKeywordCategory` | The canonical key is already in use |
| `KEYWORD_CATEGORY.INVALID_INPUT` | `createKeywordCategory` | Invalid canonical key or empty `name` |
| `KEYWORD.NOT_FOUND` | `getKeywordDefinition` | No Keyword exists with that UUID |
| `KEYWORD.CANONICAL_KEY_CONFLICT` | `createKeywordDefinition` | The canonical key is already in use |
| `KEYWORD.INVALID_INPUT` | `createKeywordDefinition` | Invalid canonical key or empty `name` |
| `KEYWORD_ASSIGNMENT.DUPLICATE` | `assignKeywordTo{Entity,EntityVersion}` | This target already carries this Keyword |
| `KEYWORD_ASSIGNMENT.INVALID_SOURCE` | `assignKeywordTo{Entity,EntityVersion}` | `source` isn't a recognized `KeywordAssignmentSource` |
| `ENTITY.NOT_FOUND` (reused) | `assignKeywordToEntity`, `createKeywordDefinition` (bad `categoryId` reuses `KEYWORD_CATEGORY.NOT_FOUND` instead — see below) | The target Entity doesn't exist |
| `ENTITY_VERSION.NOT_FOUND` (reused) | `assignKeywordToEntityVersion` | The target EntityVersion doesn't exist |
| `ENTITY_VERSION.IMMUTABLE` (reused) | `assignKeywordToEntityVersion`, `removeKeywordFromEntityVersion` | The Version is not `DRAFT` |

Every "reused" code above is a deliberate choice, each following the same
precedent already established in M1-WO1 through M1-WO3: a missing-target
or protected-content condition is the same condition that code already
names, so it's reused rather than duplicated under a new Keyword-specific
name. In particular, `assignKeywordToEntityVersion` reuses
`ENTITY_VERSION.IMMUTABLE` rather than a parallel
`KEYWORD_ASSIGNMENT.VERSION_PROTECTED`-style code, per this Work Order's
own explicit instruction to use "the same lifecycle semantics established
in M1-WO3."

Keyword assignment removal (`removeKeywordFromEntity`/
`removeKeywordFromEntityVersion`) is **idempotent** when the target
doesn't already carry the Keyword — it succeeds silently rather than
throwing a "not found" error, since no dedicated assignment-not-found code
was named for this Work Order and "the Keyword is not assigned" is already
the post-condition a caller removing it wants.

## Repository / service responsibilities

```
domain (callers)
  -> keyword-category service     (packages/prowess-db/src/keyword-category/service.ts)
  -> keyword-definition service    (packages/prowess-db/src/keyword-definition/service.ts)
  -> entity-keyword service         (packages/prowess-db/src/entity-keyword/service.ts)
  -> entity-version-keyword service  (packages/prowess-db/src/entity-version-keyword/service.ts)
       the only one with the atomic DRAFT guard
  -> each module's own repository.ts (Prisma only, internal, not exported)
  -> Prisma / PostgreSQL
```

Only each service's public functions are part of `@prowess/db`'s public
surface, all re-exported from the package's own `index.ts` alongside
Entity/EntityVersion/EntityAlias's operations.
