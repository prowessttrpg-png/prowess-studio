# Canon Policy & Source Authority (M2-WO4)

**Status: implemented; awaiting its first CI run.** M2-WO4 adds Ruleset-scoped
**source-authority** governance as immutable, versioned snapshots. It adds no HTTP API, no UI,
no rule conflicts, no Canon decisions, and no publishing.

## What this is — and is not

Source authority may **inform** later Canon and conflict decisions. It does **not**, here or
anywhere in this work order:

- select an EntityVersion;
- alter a Ruleset manifest or replace an explicit pin;
- override inheritance;
- change an EntityVersion's lifecycle status or make anything Canon;
- change game mechanics.

M2-WO4 creates governance *metadata* and reproducible policy *snapshots* only. Manifest
pinning (M2-WO2) and inheritance (M2-WO3) remain authoritative for composition.

## Two different facts about a source

```
SourceDocument.authorityStatus   descriptive provenance metadata carried by the document itself
                                 (M1; nullable; unchanged by this work order)

SourceAuthorityRecord            Ruleset-specific GOVERNANCE authority inside one exact
                                 CanonPolicy snapshot (new)
```

They are never copied into each other and never synchronized. All of these can be true at once:

```
SourceDocument:                authorityStatus = PLAYTEST_REFERENCE
Ruleset A / Canon Policy 2:    record = GOVERNING
Ruleset B / Canon Policy 1:    record = REFERENCE_ONLY
```

A test sets exactly this, then changes the document's own status and creates a newer policy,
and confirms neither fact moves the other. The Ruleset-scoped record is the governance
authority *for that policy context*.

## CanonPolicy: an immutable snapshot

```
Ruleset
 ├── Canon Policy 1
 │     ├── Source A / global → CURRENT_PRIMARY
 │     └── Source B / global → CURRENT_SUPPLEMENTAL
 │
 └── Canon Policy 2
       ├── Source A / global → SUPERSEDED
       └── Source B / global → CURRENT_PRIMARY
```

A Ruleset has many policies over time. To change source authority you create **policy N+1**;
nothing edits a policy, its records, its scope, its status, or its rationale after creation
(no such operation is exported, and a static audit asserts the exact public surface). A
mandatory test creates Policy 2 and confirms Policy 1 is byte-for-byte unchanged.

`policy_version` is positive, automatically allocated (1, 2, 3 … **per Ruleset**), and never
supplied by a caller (the input type has no field for it; a test smuggles one in to prove it
is ignored). `UNIQUE(ruleset_id, policy_version)` is the final authority. Allocation reuses the
bounded-retry strategy proven for EntityVersion revisions and manifest versions: one
transaction reads the highest version and inserts the next; if another request won the same
number the unique constraint rejects the attempt and it retries (up to 8). A concurrent test
confirms distinct, gap-free versions and no lost policy. Positivity is guaranteed by the
allocator and pinned by tests; no CHECK constraint is used, following M1's convention.

There is **no active-policy pointer** — no `current_policy_id`, `active_policy_id`,
`is_current`, `use_latest_policy`, on any table. `getLatestCanonPolicy` means only *highest
`policy_version`*, a deterministic convenience; it is never "active", "current" or
"effective", and the static audit permits the word "latest" in policy code only as the two
operations named for it.

## SourceAuthorityRecord and scope

One record says: *in this policy, this SourceDocument has this authority within this scope*.
It belongs to one policy and references one SourceDocument, and nothing else — not an Entity,
EntityVersion, SourceReference, or manifest. The link between a rule revision and a source stays
M1's:

```
EntityVersion
   ↓ SourceReference
SourceDocument
   ↑
SourceAuthorityRecord
   ↑
CanonPolicy
   ↑
Ruleset
```

**Authority vocabulary.** `authority_status` reuses the existing `SourceAuthorityStatus`
enum (`GOVERNING`, `CURRENT_PRIMARY`, `CURRENT_SUPPLEMENTAL`, `PLAYTEST_REFERENCE`,
`HISTORICAL`, `SUPERSEDED`, `REFERENCE_ONLY`, `UNRESOLVED`). No second enum exists, and a
static audit fails if a second list of those statuses appears anywhere in source. The
statuses carry meaning for *people and later work*; this work order assigns them no rank and
builds no mechanics from them.

**Scope.** `scope_key` says what rules domain the declaration covers: `global` (the general
authority for the document in this policy) or a dotted machine-readable scope such as
`entity_type.spell_effect`, `entity_type.skill`, `magic.spellcasting`, `world.lore`. The full
taxonomy is deliberately **not** hard-coded. One centralized validator,
`isValidSourceAuthorityScopeKey`, accepts exactly:

- the literal `global`; and
- anything the existing canonical-key grammar accepts.

*Why not `isValidCanonicalKey` alone:* that grammar requires at least two dot-separated
segments, so the single word `global` fails it. Rather than weaken `CanonicalKey` for every
other use, the scope validator adds just the one literal and otherwise **reuses the existing
grammar**, so dotted scopes have no second grammar. Two structural guards keep positions and
ids out of a scope: no purely numeric segment (`page.12`) and no 32-hex segment. A scope may
not contain page or document positions or encode an EntityVersion id.

`UNIQUE(canon_policy_id, source_document_id, scope_key)`: one declaration per document per
scope per policy. The same document may appear in several scopes (`global` →
`CURRENT_PRIMARY` and `entity_type.spell_effect` → `GOVERNING`).

## Resolving authority: specific → global → UNRESOLVED

`resolveSourceAuthority(policyId, sourceDocumentId, scopeKey)`:

1. the declaration at **exactly** the requested scope → `EXACT`;
2. else, if the requested scope is not `global`, the `global` declaration → `GLOBAL_FALLBACK`;
3. else → `UNRESOLVED` (`resolvedScopeKey = null`).

The result records `policyId`, `sourceDocumentId`, `requestedScopeKey`, `resolvedScopeKey`,
`authorityStatus` and `source`, so a caller can see *which scope answered*. `source` is a
domain-only union, deliberately **not** a Prisma enum.

- **UNRESOLVED is derived, never stored.** No row is created for "nothing declared"; a test
  counts rows before and after. It is also not an error and does not require the SourceDocument
  to exist.
- A declaration whose own status is `UNRESOLVED` is still a declaration: it answers `EXACT` and
  blocks the global fallback.
- A specific-scope declaration does **not** imply `global`, and one specific scope never
  answers for another.
- `getSourceAuthorityRecord` is the **exact-only** lookup (`null` if there is no record at that
  scope) — no fallback of any kind.

The rule is a pure, storage-independent function in `@prowess/model`, unit-tested; the
persistence layer only looks up the (at most) two declarations.

## No fallback across policies, and none to a parent Ruleset

Each policy is a **complete historical snapshot**. If Policy 2 does not declare Source A, it
does *not* read Policy 1 — it resolves `UNRESOLVED`. The only fallback is inside the **same**
policy. Likewise a child Ruleset's policy never consults its parent Ruleset's policy:
Ruleset lineage and manifest inheritance (M2-WO1/WO3) do not extend to source authority. Policy
inheritance, if ever wanted, needs an explicit future design. Both are tested, and the
resolution functions are structurally unable to do either: a static audit confirms they look up
declarations inside the one requested policy and never touch another policy, a Ruleset, or a
parent.

## Authority never selects content

- **Manifest independence.** A test pins a DRAFT `A2` whose source is `REFERENCE_ONLY` while a
  CANON `A1` has a `GOVERNING` source, then creates a policy that would favour `A1`. The
  manifest still resolves `A2`, and the manifest and its entries are byte-for-byte unchanged.
- **Inheritance independence.** A child's explicit pin of `A2` resolves over the parent's
  inherited `A1` even when the policy declares `A1`'s source `GOVERNING`; the M2-WO3 trace
  (depth 0, `EXPLICIT`) is unchanged.
- **Lifecycle independence.** Creating a policy changes no EntityVersion status.
- **No inference.** Authority is explicitly authored. It is never derived from a document's file
  date or version label, its reference count, an EntityVersion's CANON status, the latest
  document or version, or a Ruleset's channel or status. The policy code cannot name
  `EntityVersion` selection, manifest or inheritance operations, status, keywords, or
  relationships; a static audit forbids those identifiers, and also restricts its imports to the
  policy repository plus Ruleset and SourceDocument *existence* lookups.

## Creation: atomic and validated

`createCanonPolicy(rulesetId, { name, description?, authorities })` validates, in order,
reporting the first failure and writing nothing:

1. input shape, scope keys, statuses → `INVALID_INPUT` / `INVALID_SCOPE`;
2. the same SourceDocument + scope twice → `DUPLICATE_SOURCE_SCOPE`;
3. the Ruleset exists → `RULESET_NOT_FOUND`;
4. every SourceDocument exists → `SOURCE_NOT_FOUND`;

then writes the policy and **all** records in one transaction. If any step fails — including a
database-level rejection after valid records were already inserted — everything rolls back: no
policy, no records, no version consumed. A test exercises this at the repository layer with a
real foreign-key failure, not only through the service's pre-validation.

An **empty** policy is allowed: it means "no Ruleset-scoped source authority has been declared
in this snapshot", so every lookup resolves `UNRESOLVED`.

## Operations and ordering

`createCanonPolicy`, `getCanonPolicy`, `listCanonPolicies` (headers, `policy_version ASC`),
`getLatestCanonPolicy`, `getSourceAuthorityRecord`, `resolveSourceAuthority`. A Ruleset with
no policies lists as empty; a Ruleset that does not exist is `RULESET_NOT_FOUND`.

Authority records are ordered **`scope_key ASC`, then `source_document_id ASC`** — deterministic,
using the database's own collation for `scope_key` (the same convention as canonical keys) and
the document id as the final tiebreak (a SourceDocument's title is not unique, so it cannot be).

## Errors

Two namespaces: `CANON_POLICY.*` (`NOT_FOUND`, `RULESET_NOT_FOUND`, `INVALID_INPUT`,
`VERSION_CONFLICT`) and `SOURCE_AUTHORITY.*` (`SOURCE_NOT_FOUND`, `INVALID_SCOPE`,
`DUPLICATE_SOURCE_SCOPE`). A missing SourceDocument uses `SOURCE_AUTHORITY.SOURCE_NOT_FOUND`
rather than reusing `SOURCE_DOCUMENT.NOT_FOUND`: the document is referenced *inside a request
body*, so "the thing you referenced does not exist" must be distinguishable from "the resource
you addressed does not exist" (as with `RULESET_MANIFEST.ENTITY_NOT_FOUND`). HTTP statuses are
recorded in the compile-time-exhaustive map before any route exists (404 for the addressed
resources, 409 for `VERSION_CONFLICT`, 400 for body-reference problems); leaving a code
unmapped is a type error — verified. No Prisma error escapes.

## Deletion protection

All three foreign keys are `ON DELETE RESTRICT`: a Ruleset cannot be physically deleted while it
has policies, a policy cannot be deleted while it has records, and a SourceDocument cannot be
deleted while any policy records authority about it. Governance history is never
cascade-deleted. Each is tested against the real constraint.

## Future use, and what is deferred

Later work orders will *use* authority — e.g. rule-conflict modelling and Canon decisions can
read "how authoritative was this source in this Ruleset's policy" to explain and weigh a
conflict. That is deliberately not built here: no authority ranking, no automatic selection, no
conflict resolution. Also deferred: Canon decisions, change sets, releases and publishing, any
notion of an active policy, linking a policy to a manifest (a historical pairing for later
decisions or releases, if needed), policy inheritance, the HTTP API, and UI.
