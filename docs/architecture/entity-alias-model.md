# EntityAlias — alternate lookup names (M1-WO4)

**Status: implemented and verified.** The permanent GitHub Actions CI workflow passed against this component when its Work Order was approved, and the M1 audit gate (`docs/audits/m1-completion-audit.md`) re-checks its invariants. Earlier revisions of this document recorded it as "not yet verified" because the authoring sandbox could not run Prisma or a browser; that limited only *local* verification and is resolved by CI.

## Canonical key vs. EntityVersion display name vs. EntityAlias

Three different things, easy to conflate:

```
Entity.canonicalKey        = stable machine key
EntityVersion.displayName  = human-facing name for THAT historical revision
EntityAlias.alias          = alternate lookup/reference name for the Entity as a whole
```

```
Entity
  canonical_key: spell.affinity.emission

Revision 1:
  display_name: Evocation

Revision 2:
  display_name: Emission

Aliases:
  Evocation
  Emission
```

The alias layer lets searches and historical terminology resolve to the
same Entity, regardless of which Version's `displayName` currently "has"
that name. Aliases are **not** a replacement for Entity identity (the
UUID), the canonical key, or `EntityVersion.displayName` — they're a third,
separate thing: lookup/discovery metadata.

## Why aliases are Entity-level, not Version-level

A name used across several historical revisions — or one that predates or
survives a terminology change entirely — only needs to be recorded once,
against the stable Entity, not copied into every `EntityVersion` row that
happened to exist while that name was in use. Nothing in this Work Order
copies aliases into `EntityVersion`; the two tables remain entirely
separate.

## Why canonical keys remain stable

`Entity.canonicalKey` keeps every property it had since M1-WO1: unique,
stable, machine-readable, namespace-aware, and the durable human-readable
*machine* key. **Creating an alias never mutates the canonical key, and no
ordinary canonical-key update operation exists in this package at all** —
canonical keys remain stable after Entity creation for the whole of Phase
1. If a genuinely exceptional rename/migration is ever needed, it belongs
to future Canon/administrative tooling, not to ordinary Entity or alias
editing — this Work Order does not build that tooling.

## Normalization

One authoritative function, `@prowess/model`'s `normalizeEntityAlias`
(`packages/prowess-model/src/entity-alias.ts`), used for both aliases and
contexts:

1. Unicode-normalize via `.normalize("NFC")` — canonical composition only.
   Deliberately **not** `"NFKC"` (compatibility normalization): NFKC can
   fold visually-or-semantically-distinct characters together (e.g.
   collapsing full-width characters or certain ligatures into their
   ASCII-ish equivalents), which risks incorrectly conflating two
   different fictional names. NFC only recomposes characters that are
   canonically equivalent (e.g. `"e" + combining-acute` and the single
   precomposed `"é"` codepoint both normalize to the same form) — the
   more conservative choice for a system that must support invented
   terminology, not just real-world languages.
2. Trim leading/trailing whitespace.
3. Collapse any run of internal whitespace to a single space.
4. Lowercase via `.toLowerCase()` — **deliberately locale-independent**
   Unicode lowercasing, not `.toLocaleLowerCase()`. **Alias lookup
   normalization uses locale-independent Unicode lowercase conversion
   because the normalized value is a persistent database key and must be
   reproducible across environments** — every developer machine, CI
   runner, and deployment target must normalize the same input to the
   exact same `normalized_alias`/`normalized_context`, regardless of that
   host's configured locale. `.toLocaleLowerCase()` with no explicit
   locale argument uses the JS runtime's *default* locale, which can
   differ by host; the canonical example is Turkish, where
   `"I".toLocaleLowerCase("tr-TR")` produces `"ı"` (dotless i, U+0131)
   rather than the ASCII `"i"` every other locale produces. A value
   normalized on a Turkish-locale host could then silently fail to match
   — or silently collide differently with — the same alias normalized
   elsewhere. `.toLowerCase()` always applies the same locale-independent
   Unicode default case mapping, everywhere, with no such risk.

Example: `"  Direct   Damage "` → `"direct damage"`.

The **authored** form is always preserved separately and never destroyed —
`alias = "Direct Damage"`, `normalizedAlias = "direct damage"`. Unicode
aliases are fully supported; there is no ASCII restriction, no
transliteration, and no accent stripping.

## Duplicate policy

Prevented: the same Entity registering a normalized duplicate alias within
the same context.

```
Entity A
  "Direct Damage"
  " direct   damage "   <- rejected: same Entity, same normalized form, same (absent) context
```

Allowed: different Entities sharing the same alias.

```
Entity A -> "Ward"
Entity B -> "Ward"
```

Both persist; a lookup for `"Ward"` returns **both** Entities. There is no
global uniqueness constraint on `normalizedAlias` alone — only on
`(entityId, normalizedAlias, normalizedContext)` together.

### The nullable-context pitfall, and how this schema avoids it

A naive `@@unique([entityId, normalizedAlias, context])` with `context`
nullable would silently fail to catch the common no-context case: Postgres
treats `NULL` as distinct from every other `NULL` for uniqueness purposes,
so two rows with the same `(entityId, normalizedAlias)` and **both** a
`NULL` context would **not** violate that constraint at all.

This schema avoids the pitfall with a deliberate normalized-context-key
strategy: `context` (nullable) stores the authored value exactly as given,
for display — but a separate, **`NOT NULL`** `normalizedContext` column
(defaulting to `""` when no context is supplied) is what the actual unique
constraint and lookup matching use. Since `""` is an ordinary, comparable
value (not `NULL`), Postgres's uniqueness semantics work correctly for
every case, context-qualified or not.

## Context

A lightweight, optional qualifier for genuinely ambiguous terminology:

```
alias: "Emission"
context: "Affinity"

alias: "Silver Company"
context: "Organization"
```

No large context taxonomy exists or is implied — `context` is a plain,
nullable string. Two aliases with the same text but different contexts are
treated as fully independent for both duplicate-checking and lookup
purposes (an alias with `context: "Affinity"` and one with
`context: "Organization"` on the same text never conflict with each
other, and a context-qualified lookup only matches within that context).

## Ambiguous lookup — why 0..many, never exactly one

`findEntitiesByAlias(alias, context?)` is designed to return **zero to
many** Entities, never a single "the" result, and never arbitrarily picks
a "first" match when several exist:

```
"Ward" -> Entity A, Entity B
```

Disambiguation (by context, by asking the user, by whatever future
Compendium UI exists) is a later concern — this Work Order's
responsibility ends at returning every genuine match, honestly, including
when there's more than one. A result pairs stable Entity identity with the
specific alias row that matched (`AliasEntityMatch`) — it deliberately does
**not** invent a "current display name" for the Entity, since Rulesets and
current-version resolution don't exist yet (that's M2).

## Canonical-key lookup stays separate

`findEntityByCanonicalKey` (M1-WO1) is completely unchanged and unrelated
to alias lookup — it remains exact, stable, and returns at most one
Entity. Neither function ever falls back to the other. A canonical key is
never treated as "just another alias," and an alias lookup never performs
fuzzy or canonical-key-style matching.

## Why no automatic alias creation exists yet

Alias creation is always explicit, via `createEntityAlias`. Nothing in
this Work Order automatically creates an alias from an `EntityVersion`'s
`displayName` when a new Version is created — doing so would be a hidden
write with no caller intent behind it. Automatic historical-name capture
may be worth considering later, during actual version/canon workflows, if
it turns out to be useful — but that is a deliberate future decision, not
something to bake in now as a side effect.

## No `is_primary` concept

PAS-10 explicitly prefers no primary-alias concept for this Work Order,
and this schema has none: the human-facing *current* name for an Entity
already has a home — `EntityVersion.displayName` — so an alias flagged as
"primary" would be a second, competing answer to a question that field
already answers. `EntityAlias` rows are unordered peers; any future
"preferred name for display" question should be answered by Version/Canon
resolution, not by a flag on an alias row.

## Repository / service responsibilities

```
domain (callers)
  -> @prowess/db's entity-alias service (packages/prowess-db/src/entity-alias/service.ts)
       validates entity exists (delegates to the Entity service — reuse, not duplication)
       validates/normalizes alias and context
       maps the unique-constraint violation to a domain error
  -> entity-alias repository                (packages/prowess-db/src/entity-alias/repository.ts)
       Prisma queries only; the alias-to-Entity join lookup
  -> Prisma / PostgreSQL
```

Only the service (`createEntityAlias`, `listEntityAliases`,
`findEntitiesByAlias`, `removeEntityAlias`) is part of `@prowess/db`'s
public surface, re-exported from the package's own `index.ts` alongside
Entity's and EntityVersion's operations.

## Error codes

| Code | Thrown by | When |
| --- | --- | --- |
| `ENTITY.NOT_FOUND` (reused) | `createEntityAlias` | The parent Entity doesn't exist |
| `ENTITY_ALIAS.DUPLICATE` | `createEntityAlias` | The same normalized alias+context already exists for this Entity |
| `ENTITY_ALIAS.NOT_FOUND` | `removeEntityAlias` | No alias exists with that id |
| `ENTITY_ALIAS.INVALID_INPUT` | `createEntityAlias` | `alias` (or `context`, if supplied) is empty after normalization, or exceeds the documented length limit |

The missing-parent-Entity case reuses `ENTITY.NOT_FOUND` rather than a
parallel `ENTITY_ALIAS.ENTITY_NOT_FOUND`, following the same precedent
already established for `EntityVersion` in M1-WO2.
`ENTITY_ALIAS.INVALID_INPUT` is not one of the two codes M1-WO4's spec
named explicitly (`DUPLICATE`/`NOT_FOUND`) — added for consistency with
Entity's and EntityVersion's own `INVALID_*` pattern rather than leaving
basic input validation uncoded.

## Indexing

`normalized_alias` is indexed for exact-match lookup
(`entity_aliases_normalized_alias_idx`). No full-text search, trigram
matching, or ranking infrastructure exists — M1-WO4 is exact-match only;
broader Compendium search is a later Work Order's responsibility.

## Deletion

Unlike `EntityVersion`, alias deletion **is** supported
(`removeEntityAlias`) — aliases are discovery metadata, not historical
rule snapshots, so removing one loses nothing the M0/M1
history-preservation principle protects. Deleting an alias never touches
the Entity or any `EntityVersion`.
