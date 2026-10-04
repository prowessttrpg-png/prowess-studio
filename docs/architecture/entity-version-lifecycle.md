# EntityVersion Lifecycle & Mutation Rules (M1-WO3)

**Status: implemented and verified.** The permanent GitHub Actions CI workflow passed against this component when its Work Order was approved, and the M1 audit gate (`docs/audits/m1-completion-audit.md`) re-checks its invariants. Earlier revisions of this document recorded it as "not yet verified" because the authoring sandbox could not run Prisma or a browser; that limited only *local* verification and is resolved by CI.

M1-WO2 established historical Versions as independent records. This
document covers the layer M1-WO3 adds on top: **when an existing Version
may be edited, and when it becomes protected.**

## The core distinction

```
Historical independence   = ALWAYS true, for every revision, forever.
                             Creating revision 2 never alters revision 1.

Mutability                 = true ONLY for a Version currently in DRAFT.
                             Every other status is content-protected.
```

These are easy to conflate and are genuinely different claims. M1-WO2's
original documentation blurred them (see `entity-version-model.md`'s
"Historical independence vs. mutability" section for the correction) —
this document exists specifically to keep them distinct going forward.

## Mutation policy

| Status | Content mutable? |
| --- | --- |
| `DRAFT` | **Yes** |
| `IN_REVIEW` | No |
| `APPROVED` | No |
| `PLAYTEST` | No |
| `CANON` | No |
| `DEPRECATED` | No |
| `SUPERSEDED` | No |
| `ARCHIVED` | No |

Only `DRAFT` content may be edited in place. If an `IN_REVIEW` Version
needs content changes, it must first return to `DRAFT` via the allowed
`IN_REVIEW -> DRAFT` transition (see "Lifecycle graph" below) — review
feedback reopens a working revision rather than editing around the review
state. Once a Version has progressed beyond review into `APPROVED` or
later, substantive correction should normally mean creating a **new**
EntityVersion (via `createEntityVersion` with the protected Version as
`parentVersionId` — see M1-WO2), not rewriting history. M1-WO3 does not
implement the UI or Canon workflow that would create that successor
automatically; it only ensures the protected Version itself cannot be
rewritten and remains perfectly valid as a parent (see "Protected Versions
as parents" below).

Centralized in exactly one place:
`@prowess/model`'s `canMutateEntityVersionContent(status)`
(`packages/prowess-model/src/entity-version-lifecycle.ts`) — `true` only
for `DRAFT`. Tests, the service layer, and any future UI all consult this
one function rather than duplicating the `=== "DRAFT"` check independently.

## Always-immutable fields

Never editable after creation, **even while the Version is DRAFT**:

- `id`
- `entityId`
- `revisionNumber`
- `createdAt`
- `parentVersionId`

The last one matters specifically because DRAFT editing must never rewrite
historical ancestry — lineage is fixed at creation time, permanently,
regardless of the Version's current status.

## Draft-editable content

While `status === "DRAFT"`, these fields may be updated via
`@prowess/db`'s `updateDraftEntityVersion(versionId, patch)`:

- `displayName`
- `shortDescription`
- `rulesText`
- `structuredData`
- `changeType`
- `changeSummary`

`patch` is `@prowess/model`'s `UpdateDraftEntityVersionInput` — an explicit
allowlist type, not a generic Prisma update object. There is no code path
from `updateDraftEntityVersion` to an arbitrary Prisma update payload; the
type itself has no field for `id`, `entityId`, `revisionNumber`,
`createdAt`, `parentVersionId`, or `status`, so there's nothing for a
caller to even attempt to smuggle through.

## Status vs. content operations — always separate

```
updateDraftEntityVersion(versionId, patch)          — content only, requires DRAFT
transitionEntityVersionStatus(versionId, target)     — status only, validated against the lifecycle graph
```

There is deliberately no single `updateEntityVersion(...)` accepting both
arbitrary content and a status change. Collapsing the two into one
generic endpoint is exactly the kind of escape hatch future Canon/
permission logic (M2) could be bypassed through — keeping them separate
now means that boundary never has to be retrofitted later.

## `updated_at`

Added in M1-WO3 (M1-WO2 deliberately omitted it — there was nothing yet
for it to track before a mutation policy existed). Same timezone
convention as every other timestamp in this schema (`TIMESTAMPTZ(6)`,
UTC). Updates automatically, via Prisma's `@updatedAt`, whenever
`updateDraftEntityVersion` successfully changes DRAFT content. It does
**not** imply that a protected, non-DRAFT Version can be mutated — a
protected Version's `updatedAt` simply stops changing once it leaves
DRAFT, the same as any other field on that row.

## The CANON distinction (read this twice)

`EntityVersionStatus.CANON` does **not** mean "this is globally the active
Prowess rule." It means only that this particular Version has reached the
CANON lifecycle state — a statement about *this row's own history*, not
about system-wide authority.

Later M2 Rulesets and Ruleset Manifests determine which exact
EntityVersion is authoritative *within a given Ruleset*. A Ruleset could
reference a `PLAYTEST` Version, or an older `CANON` Version, or (once
`SUPERSEDED`) exclude a Version entirely — none of that is decided by the
`status` field alone, and none of it is implemented yet.

**No global `is_current`, `is_active_rule`, or `current_version_id` field
exists anywhere in this schema, and none should ever be added to
`EntityVersion` itself.** That kind of "which Version is active" question
belongs entirely to the Ruleset/Ruleset Manifest layer (M2/PAS-08), which
hasn't been built yet.

## Lifecycle graph

The one authoritative transition graph —
`@prowess/model`'s `ENTITY_VERSION_TRANSITIONS`
(`packages/prowess-model/src/entity-version-lifecycle.ts`):

```
DRAFT
 |-> IN_REVIEW
 `-> ARCHIVED

IN_REVIEW
 |-> DRAFT
 |-> APPROVED
 `-> ARCHIVED

APPROVED
 |-> PLAYTEST
 |-> DEPRECATED
 `-> ARCHIVED

PLAYTEST
 |-> CANON
 |-> SUPERSEDED
 `-> DEPRECATED

CANON
 |-> SUPERSEDED
 `-> DEPRECATED

SUPERSEDED
 `-> ARCHIVED

DEPRECATED
 `-> ARCHIVED

ARCHIVED
     terminal - no outgoing transitions
```

This is a **lifecycle-control graph only**. It does not implement Ruleset
publication, Canon Authority, ChangeSets, permissions, or release
management — those belong to M2/PAS-08.

### Review reopening

`IN_REVIEW -> DRAFT` is explicitly allowed — this is how review feedback
returns an existing working revision to an editable state. **Once
`APPROVED` is reached, there is no path back to `DRAFT`.** If
approved/published-like content later needs mechanical changes, the
architecture expects creation of a new EntityVersion (with the old one as
`parentVersionId`), not a backward transition.

### Protected Versions as parents

A protected (non-DRAFT) Version remains perfectly valid as a
`parentVersionId` for a brand-new DRAFT Version — in fact this is expected
to be the *common* case: future rule revisions will typically originate
from a `CANON` or `PLAYTEST` Version, not from another DRAFT. Creating the
child never touches the parent; the parent's status, content, and
`updatedAt` are all unaffected.

```
Revision 1 (CANON)
        |
        v (parent)
Revision 2 (DRAFT)
```

## Error codes

| Code | Thrown by | When |
| --- | --- | --- |
| `ENTITY_VERSION.IMMUTABLE` | `updateDraftEntityVersion` | The Version's current status isn't `DRAFT` |
| `ENTITY_VERSION.INVALID_STATUS_TRANSITION` | `transitionEntityVersionStatus` | The requested transition isn't in the lifecycle graph, **or** the status changed concurrently between validation and the atomic write committing |

**Deliberate choice:** the race-loss case reuses
`ENTITY_VERSION.INVALID_STATUS_TRANSITION` rather than a parallel
"transition conflict" code — from the caller's perspective both mean
exactly the same thing: the transition requested is not valid for the
Version's actual current status, whether that was true at the moment of
the request or became true microseconds later. See `@prowess/model`'s
`errors.ts` for the equally-deliberate precedent this follows (M1-WO2's
reuse of `ENTITY.NOT_FOUND` for a missing parent Entity).

## Atomic conditional-update strategy

Both guarded operations use the same pattern: a single SQL `UPDATE`
statement whose `WHERE` clause names both the target row **and** the
exact precondition being relied on, so there is no window between
"check" and "write" for a concurrent operation to invalidate:

```sql
-- Content mutation (packages/prowess-db/src/entity-version/repository.ts,
-- updateDraftEntityVersionContentAtomic):
UPDATE entity_versions SET ... WHERE id = ? AND status = 'DRAFT';

-- Status transition (transitionEntityVersionStatusAtomic):
UPDATE entity_versions SET status = ? WHERE id = ? AND status = ?;
```

Both are expressed as Prisma `updateMany` calls (not `update`), since
`updateMany`'s `where` clause can include the status precondition directly
— `update` only accepts a unique identifier. A `count: 0` result means the
conditional didn't match anything; the service layer re-reads the row to
distinguish "doesn't exist" from "exists but the precondition no longer
holds," and maps each to the correct domain error
(`ENTITY_VERSION.NOT_FOUND` / `ENTITY_VERSION.IMMUTABLE` for content;
`ENTITY_VERSION.INVALID_STATUS_TRANSITION` for status).

**Why this is sufficient without a Postgres trigger or distributed lock:**
Postgres's own row-level locking already serializes two concurrent
`UPDATE`s to the same row — one simply waits for the other to commit, then
evaluates its own `WHERE` clause against the now-current state. The
database itself is what makes this atomic; the application code's job is
only to phrase the conditional correctly and interpret a zero-row result
honestly, never to implement the mutual exclusion itself.

## Architecture boundaries (unchanged)

```
@prowess/model
    lifecycle graph + canMutateEntityVersionContent (no Prisma, no Next.js, no React)

@prowess/db
    repository.ts    - the two atomic UPDATE primitives, Prisma-only, internal
    service.ts        - validates against the graph, maps errors, the only public surface

apps/studio
    no direct Prisma, unchanged from M1-WO1/M1-WO2
```

`scripts/check-architecture.mjs`'s existing rules needed no changes for
M1-WO3 — the new files live inside already-covered directories
(`packages/prowess-model/src/`, `packages/prowess-db/src/`).
