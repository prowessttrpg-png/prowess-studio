# Ruleset Inheritance & Effective Resolution (M2-WO3)

**Status: implemented; awaiting its first CI run.** M2-WO3 lets a child Ruleset's
manifest inherit Entity pins from a parent Ruleset's manifest — as an exact, historical
**snapshot reference**, never as "whatever the parent's latest manifest is today". It adds
no HTTP API, no UI, no Canon policy, and no publishing.

## Ruleset lineage vs manifest inheritance

These are related but **not the same thing**.

- **Ruleset lineage** (M2-WO1): `rulesets.parent_ruleset_id` says Ruleset C descends from
  Ruleset P. It is metadata and stays authoritative: the lineage graph is acyclic and
  chosen at creation.
- **Manifest inheritance** (this work order): `ruleset_manifests.parent_manifest_id` says
  *this particular manifest* inherits unpinned Entities from *this exact manifest* of the
  parent Ruleset.

A child Ruleset whose manifest has `parent_manifest_id = NULL` inherits **nothing**, even
though its Ruleset has a parent. Lineage alone never activates inheritance; each manifest
opts in explicitly. (A test creates exactly that case and confirms the parent's pins are
invisible to it.)

## Explicit parent-manifest pinning

```
Grandparent Manifest G1
        ↓   parent_manifest_id = G1
Parent Manifest P1
        ↓   parent_manifest_id = P1
Child Manifest C1
```

A manifest names its parent manifest by id when it is created, and that reference never
changes. To change what a child inherits, create a **new** child manifest pointing at a
different parent manifest — exactly as changing a composition means a new manifest
(M2-WO2). No operation sets, changes, or rebases a parent; none is exported, and a static
audit asserts the public surface.

## Why inheriting the parent's latest manifest is forbidden

Suppose a child inherited "the parent's latest manifest". Creating Parent Manifest 2 would
silently change the effective rules of every existing child manifest — a historical
composition would stop being reproducible, and the snapshot guarantee of M2-WO2 would be
hollow one level up. So the rule is: **a child manifest resolves through its pinned parent
manifest, never through a lookup of the parent Ruleset's newest one.**

This is checkable, not just stated. The resolution code lives in its own module
(`ruleset-inheritance/`) that has **no way to ask the question**: it cannot look up a
Ruleset, cannot list or fetch "latest" manifests, and reaches storage through exactly three
manifest-repository functions, all by exact manifest id. A static audit fails if it
imports anything else or mentions any of a list of identifiers (`parentRulesetId`,
`getLatestRulesetManifest`, `selectRulesetById`, `latestRevision`, …). A mandatory
integration test pins this behaviorally: P1 → C1; later P2 is created (and is verifiably the
parent's latest); C1 still resolves through P1; a new C2 pinned to P2 resolves through P2.

## Which manifest may be a parent

If `parentManifestId` is supplied at creation, it must:

1. exist;
2. belong to the Ruleset named by this Ruleset's `parent_ruleset_id` — its **direct**
   parent. A manifest of the grandparent is rejected: inheritance climbs one Ruleset at a
   time, and the recursion reaches the grandparent through the parent's own pinned manifest;
3. be supplied only by a Ruleset that has a parent — a root Ruleset cannot inherit.

All three failures are `RULESET_MANIFEST.INVALID_PARENT_MANIFEST` (one code, because every
case means "that is not a valid thing to inherit from"; the message says which). Nothing is
written on failure: creation stays atomic and the manifest-version concurrency strategy is
untouched.

**Where this is enforced.** A plain foreign key cannot prove "belongs to the parent
*Ruleset*", so the service enforces it. The database guarantees the referenced manifest
exists and — `ON DELETE RESTRICT` — cannot be deleted while a child points at it. A
database-level proof would need a redundant `parent_ruleset_id` column on every manifest
plus two composite keys: disproportionate schema distortion for a rule the service already
enforces, so it was not added. The residual gap is a direct database write that bypasses
the service; resolution follows the stored chain regardless, and the cycle defense below
covers the one structurally dangerous result.

## Override precedence and recursive resolution

```
Child explicit pin
        >
Parent inherited pin
        >
Grandparent inherited pin
```

`resolveEffectiveEntityVersion(manifestId, entityId)`:

1. the requested manifest's own entry for the Entity → return it (depth 0, `EXPLICIT`);
2. otherwise, its pinned parent manifest → check there (depth 1, `INHERITED`);
3. continue up the chain;
4. nothing anywhere → `null`.

Nearest wins, so an explicit child entry always outranks an inherited one. Absence is
`null`, not an error; an unknown requested manifest is `RULESET_MANIFEST.NOT_FOUND`.

## Resolution trace

The result is `RulesetResolutionResult`:

| Field | Meaning |
| --- | --- |
| `entityId`, `entityVersionId` | the exact pin |
| `requestedManifestId` | the manifest the caller asked about |
| `resolvedFromManifestId` | the manifest whose entry supplied the pin |
| `resolutionDepth` | 0 = the requested manifest, 1 = its parent manifest, … |
| `source` | `EXPLICIT` (depth 0) or `INHERITED` (depth > 0) |

That is enough for a future inspector to explain *why* an Entity resolved to a Version
without re-deriving anything. `source` is a domain-only union, deliberately **not** a Prisma
enum: it is a transient result and is never stored.

## Effective composition

`getEffectiveManifestEntries(manifestId)` returns the flattened composition — one result
per Entity pinned anywhere in the chain, nearest wins, each carrying its provenance:

```
Grandparent G1:  A → A1, B → B1
Parent      P1:  B → B2, C → C1
Child       C1:  C → C2, D → D1

Effective C1:    A → A1 (G1, depth 2, INHERITED)
                 B → B2 (P1, depth 1, INHERITED)
                 C → C2 (C1, depth 0, EXPLICIT)
                 D → D1 (C1, depth 0, EXPLICIT)
```

**Ordering** is the Entity's `canonical_key ASC`, then `id` — the same convention as a
manifest's own entries (M2-WO2). It is applied by asking the **database** to order the
resolved Entities, not by a JavaScript string comparison, because the two disagree for keys
containing `.` and `_` under a locale-aware collation; this way the effective order and a
manifest's own order cannot differ. A test confirms they match for a manifest that inherits
nothing, using input in a deliberately different order.

The pure flattening step (`flattenInheritanceChain` in `@prowess/model`) is
storage-independent and unit-tested; the persistence layer only loads the chain and orders
the result.

## No persisted flattened state

Effective entries are **derived on every call** from immutable snapshots; there is no table
for them. A stored copy could drift from its sources, and nothing needs one. A test checks
the live database has no table named like effective / flattened / resolution state.

## Cycle defense

Ruleset lineage is acyclic and each manifest hop climbs it, so a manifest loop is
structurally impossible through supported services. The resolver still defends the stored
chain: it records every manifest it visits, and revisiting one stops with
`RULESET_MANIFEST.INHERITANCE_CYCLE` instead of recursing forever. The integration test
corrupts real rows directly (a two-manifest loop and a self-loop) to prove it. That code
maps to HTTP **500** on purpose: it signals corrupt data, never a caller mistake.

## What has no influence on resolution

Lifecycle status, Source authority, Keywords and EntityRelationships play no part —
explicit manifest composition wins. Tests pin a DRAFT child pin beating an inherited CANON
pin, and a REFERENCE_ONLY-sourced Version beating an inherited GOVERNING one; a static audit
forbids the resolution module from even naming status, authority, keyword, or relationship
identifiers. Likewise it never reads an EntityVersion, so "latest EntityVersion" cannot
leak in (a test makes the Entity's latest version differ from the pinned one).

The earlier **local** operations (`getManifestEntry`, `resolveEntityVersionFromManifest`)
are unchanged: they still return only a manifest's *own* entries. Inheritance is a
separate, explicit operation.

## Historical reproducibility

Everything above serves one guarantee: for an existing child manifest, the effective
composition is a pure function of immutable snapshots. Creating newer parent manifests,
newer EntityVersions, changing a status, or attaching a source cannot change it. Only
creating a *new* child manifest can express a new inheritance.

## Deletion protection

`parent_manifest_id → ruleset_manifests.id` is `ON DELETE RESTRICT`: an inherited manifest
cannot be physically deleted while a child references it (the test uses an empty parent
manifest, so that this constraint — not an entry's — is provably the one refusing). The
existing Ruleset-lineage and manifest foreign keys continue to prevent destructive loss;
nothing cascades.

## Explicitly deferred

Canon policy and decisions; Source authority governance; rule conflicts; change sets;
publishing and releases; any notion of an active or published manifest; migration planning;
HTTP API; UI; Rules Engine.
