# M4 Keyword Resolution (M4-WO4)

**Status:** M4-WO4 — Keyword Resolution Foundation. Invariants M4-I40 – M4-I50 are catalogued, with their automated
guards, in `m4-rules-engine-core.md`.

## Purpose

**A Keyword is metadata — a rule hook. It does nothing mechanically unless another explicit rule references it.**

M4-WO4 answers three questions about an evaluated object, and only these:

- does it have Keyword K?
- which exact Keywords are present?
- which sources contributed Keyword K?

It never answers "what does Fire do". It assigns no numbers, effects, stack counts, priorities, implications or
removals to any Keyword.

Code: `packages/prowess-rules/src/keyword/` (`resolve.ts`, `query.ts`). It is pure and lives inside `@prowess/rules`,
which still depends only on `@prowess/model`. There is no database access, persistence, route or UI, and no new
dependency.

```
M1 KeywordDefinition / EntityKeyword / EntityVersionKeyword
              │
              ▼
Application layer reads exact Keyword metadata (existing M1 services)
              │
              ▼
┌──────────────────────────────┐
│        @prowess/rules        │
│ KeywordContribution          │
│ ResolvedKeywordSet           │
│ deterministic aggregation    │
│ exact membership lookup      │
│ provenance                   │
└──────────────────────────────┘
              │
              ▼
Future: Requirements (WO5) · Modifiers (WO6) · Spell validation · rule predicates
```

## No implicit mechanics

```
Keyword "Fire"
      │
      ├── identifies metadata
      ├── may be queried by explicit rules
      │
      └── X does NOT automatically:
             deal damage
             burn
             change damage type
             apply conditions

Explicit Rule / Modifier
      │
      ▼
"If Fire is present, then ..."

Only that explicit rule creates mechanics.
```

The same holds for categories. A category is organizational metadata. `Elemental` does not imply `Fire`, and `Fire`
does not imply `Elemental`. Nothing infers category membership or repairs it. There is no Keyword hierarchy,
inheritance, implication, negation, suppression, immunity or removal. Many contributors of one Keyword never become
"Fire ×2". Keywords have no priority and are never ordered by supposed mechanical importance.

## M1 remains the Keyword authority

M1 owns Keyword identity, definitions, categories, assignments and canonical keys. `KeywordDefinition` is a stable,
**non-versioned** record: its `id` is the identity, and there is no EntityVersion behind it. So WO4 introduces no
version model of its own. Where a Keyword was assigned to an EntityVersion, that version appears as the
*contribution's* provenance.

The engine never looks a Keyword up. Whether a Keyword id exists is an application / materialization concern; the pure
engine can only reject a reference that is structurally malformed.

## KeywordReference

Exactly M1's identity fields, supplied verbatim from the `KeywordDefinition`:

| Field | Meaning |
| --- | --- |
| `keywordId` | the KeywordDefinition id: the identity |
| `canonicalKey` | M1 canonical key: a stable semantic handle, compared exactly and never re-normalized (`Fire`, `fire` and `keyword.FIRE` are invalid or different) |
| `categoryId` | the definition's zero-or-one category, or null: metadata only |

Display name, description and aliases are never part of a reference; a reference carrying `name` is rejected. Resolving
authored text or aliases to an exact Keyword belongs outside the pure layer.

## KeywordContribution

```
KeywordContribution {
  keyword:  KeywordReference
  source:   { sourceType, sourceKey, sourceId?, provenance? }
  ordinal?: non-negative integer
}
```

Sources are generic. `sourceType` is a caller-chosen context key such as `entity_version`, `entity` or
`runtime.effect`, and the engine never interprets it. **Source identity is exactly (`sourceType`, `sourceKey`).**
`sourceId` (an opaque persisted id) and `provenance` (the M4-WO1 `RuleProvenance`) describe the source but are not its
identity. A contribution need not map to a persisted Entity.

## Aggregation

```ts
resolveKeywords(contributions, { ruleset? }): RuleEngineResponse<ResolvedKeywordSet>
```

```
Source A ──► Keyword K1
Source B ──► Keyword K1
Source C ──► Keyword K2
                 │
                 ▼
        Keyword Resolution
                 │
                 ▼
Resolved Set:
K1
 ├─ Source A
 └─ Source B

K2
 └─ Source C
```

```
ResolvedKeywordSet { keywords: ResolvedKeyword[] }
ResolvedKeyword    { keyword: KeywordReference, contributors: { source, ordinal }[] }
```

Each exact Keyword appears once, with every contributor. An empty list is a valid empty set. The result comes back in
the M4-WO1 envelope via the WO1 `evaluate()` boundary (evaluation kind `keyword.resolve`). A supplied RulesetContext is
recorded as response provenance and never searched: it does not supply Keywords.

**Deduplication** is by exact `keywordId`. UUIDs follow the M4-WO1 UUID policy (case-insensitive), and canonical keys
are never case-folded.

**Duplicate contributions (policy A):** identical contribution records, meaning the same Keyword, the same source and
the same ordinal, collapse into one contributor. Contradictory duplicates fail closed. There is no "winner" and no
precedence.

**Fail-closed integrity checks.** Each returns status INVALID and no set:

| Condition | Code |
| --- | --- |
| malformed reference: missing or non-UUID id, invalid canonical key, invalid category id, extra field | `KEYWORD_RESOLUTION.INVALID_REFERENCE` |
| malformed contribution or source, non-plain data, prototype-shaped key, accessor, unknown field | `KEYWORD_RESOLUTION.INVALID_CONTRIBUTION` |
| one source described two ways (sourceId / provenance), or contributing one Keyword with two ordinals | `KEYWORD_RESOLUTION.INVALID_CONTRIBUTION` |
| one `keywordId` with different canonical key or category | `KEYWORD_RESOLUTION.IDENTITY_CONFLICT` |
| two `keywordId`s claiming one canonical key | `KEYWORD_RESOLUTION.CANONICAL_KEY_CONFLICT` |

These are VALIDATION messages (category STRUCTURE): malformed caller input is not an engine crash, and `RULE_ENGINE.*`
stays reserved for internal failures. The namespace is `KEYWORD_RESOLUTION.*`, never M1's `KEYWORD.*` DomainError
codes, so a code always has one meaning. Structural problems are reported in input order. Conflicts are grouped and
reported in sorted identity order, so conflict reports never depend on input order. M2 / M3 authority, Canon and
import confidence play no part.

## Ordering: semantic vs storage

- **Keywords:** `canonicalKey` ascending, then `keywordId`, in UTF-16 code-unit order through an explicit comparator.
  There is no locale collation, no case conversion and no default `sort()`.
- **Contributors:** an explicit `ordinal` declares that order is semantically meaningful. Contributors with ordinals
  come first, ascending, followed by those without, in (`sourceType`, `sourceKey`) code-unit order.
- Database row order, array order and object-property order never change a successful result.

## Exact lookup

```ts
findResolvedKeywordById(set, keywordId)                 → ResolvedKeyword | null
findResolvedKeywordByCanonicalKey(set, canonicalKey)    → ResolvedKeyword | null
hasKeywordById(set, keywordId)                          → boolean
hasKeywordByCanonicalKey(set, canonicalKey)             → boolean
```

These functions are pure, produce no trace and never change the set. The contributors of a found Keyword are on the
returned entry. Lookup by canonical key is a binary search over the ordered set. Lookup by id scans the Keywords, never
the contributions, and keeps no cached index, because there is no module-level state. There is no alias, display-name,
case-folding, prefix or fuzzy matching. `null` / `false` means exactly "not in this set", with no fallback to a latest,
Canon or global Keyword. Every public structure is plain JSON data: no `Set` or `Map` crosses the boundary.

## Provenance and trace

A resolved Keyword answers "why is this Keyword present?" through its contributors, each keeping its source id and
`RuleProvenance`. The trace is machine-readable and informational only:

```
1        keywords          keyword.resolve
1.1      keyword.0         keyword.present        keyword_id · canonical_key
1.1.1    contributor.0     keyword.contribution   source_type · source_key   (+ provenance)
1.1.2    contributor.1     keyword.contribution   …
```

Step order follows Keyword order, then contributor order. Step keys are positional, because M1 canonical keys have no
length limit and trace step keys do. There is no prose. Explanation composition belongs to M4-WO9.

## Contexts

WO4 does not redesign or scan Actor, Build or Runtime contexts. Their `keywords` lists are generic key sets, not Keyword
identity. A caller that wants exact Keyword presence supplies exact contributions. Nothing is inferred from arbitrary
context properties.

## Security, immutability, determinism

- Input is inspected with the M4-WO1 plain-data guards: no class instances, Maps, accessors or prototype-shaped keys,
  and caller getters are never invoked.
- Results are deep-frozen and detached from the input.
- The same contributions in any order give a byte-identical response.
- Nothing reads a clock, randomness, the network or persistence.

## M1 / M3 / M2 / M3-WO3 boundaries

- **M1** is the authority. The narrow DB test reads real assignments through the existing `listEntityVersionKeywords`
  / `listEntityKeywords` services, maps them to contributions, resolves them, and confirms every Keyword table is
  unchanged. No new DB service exists.
- **M3**: semantic-extraction Keyword candidates and import review (batches, decisions, match runs) are never read.
  Only materialized M1 Keyword data belongs here.
- **WO2**: resolution never asks which Keyword is current. Keywords are passed explicitly.
- **WO3**: Keywords are not Formula variables. Any "Keyword present → number" behavior is an explicit M4-WO6 Modifier.

## Handoff

```
ResolvedKeywordSet
       │
       ├── Fire
       ├── Damage
       └── Zone
       │
       ▼
M4-WO5 Requirement Engine

Requirement:
KeywordPresent(Fire)

       │
       ▼
true / false
```

WO4 supplies exact membership only. Compound logic (all of / any of / not) is M4-WO5. "If Fire then +10%" is an M4-WO6
Modifier. What Spell Keywords such as Damage, Zone or Sustained hook into is defined by the Spell system.

## Limitations

M4-WO4 does not implement: Keyword authoring, persistence, aliases or text matching; hierarchy or implication;
negation or removal; stack mechanics; game effects; Requirements; Modifiers; Resources; Spell mechanics; a merge
helper (concatenate contribution lists and resolve again); a KeywordSet fingerprint; HTTP APIs; Studio UI. No schema
change, no migration.
