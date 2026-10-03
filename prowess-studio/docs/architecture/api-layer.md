# Entity API Layer (M1-WO8)

**Status: implemented, not yet verified by GitHub Actions** — and, for the
first time in this project, **not yet verified by a local production build
either**. See "Sandbox limitations" at the end of this document for why,
and this Work Order's completion report for the full detail.

## Layering

```
Studio UI
    |
    v
HTTP / Next.js App Router route handlers   (apps/studio/app/api/**)
    |
    v
existing service boundaries                 (@prowess/db's public surface)
    |
    v
@prowess/db internals (repository layer)
    |
    v
Prisma / PostgreSQL
```

**Route handlers are adapters, nothing more.** They parse HTTP input,
validate route/query/body *shape*, call an existing `@prowess/db` service
operation, translate the result (or a thrown `DomainError`) into an HTTP
response, and serialize the domain object. They never reimplement Entity
validation, canonical-key validation, lifecycle rules, revision
allocation, alias normalization, Keyword lifecycle rules, relationship
rules, or provenance rules — all of that already exists below the HTTP
layer, built across M1-WO1 through M1-WO7, and this Work Order does not
duplicate a single line of it.

This API is for the Prowess Studio application itself. **It is not yet a
public external developer API** — see "No authentication" below.

## Shared API support layer

`apps/studio/src/api/` — every route handler is thin specifically because
this layer exists:

- `errors.ts` — the complete `DomainError.code` -> HTTP status map, the
  `ApiError` class (for HTTP-level validation failures distinct from
  domain errors), and the one `toErrorResponse` function every route calls
  from its catch block.
- `response.ts` — `apiSuccess`/`apiSuccessList`, the two standard success
  shapes.
- `uuid.ts` — `parseUuidParam`, used before any route-param id reaches a
  service call.
- `pagination.ts` — `parsePaginationParams`, the one place `page`/
  `pageSize` defaults and caps are decided.
- `serialize.ts` — `serializeForApi`, one generic recursive Date-to-ISO
  serializer used by every response.
- `request.ts` — JSON body parsing with graceful 400 handling for
  malformed bodies.

## Standard success shape

Single resource:

```json
{ "data": { ... } }
```

List:

```json
{
  "data": [ ... ],
  "pagination": { "page": 1, "pageSize": 25, "total": 100, "totalPages": 4 }
}
```

Offset/page pagination, not cursor pagination — simpler for the Compendium
UI M1-WO9 will build, and entirely sufficient at Phase 1 data volumes; no
technical reason favored cursor pagination here.

## Standard error shape

```json
{ "code": "ENTITY.NOT_FOUND", "message": "Entity not found: ...", "field": null, "details": null }
```

`field` names the specific input field at fault when applicable (e.g. a
malformed UUID route param); `details` is reserved for future structured
context and is always `null` in M1-WO8. **No Prisma error code, SQL, stack
trace, internal filesystem path, or raw exception ever reaches a response
body** — confirmed by a dedicated regression test
(`tests/integration/error-mapping-api.test.ts`) that inspects the
serialized JSON of every tested error response for exactly these leaks.

## HTTP status mapping

Centralized in `apps/studio/src/api/errors.ts`'s `DOMAIN_ERROR_STATUS_MAP`
— the only place this decision is made.

**Known DomainErrors have explicit HTTP mappings. Unknown/unmapped server
errors fail closed as generic HTTP 500 responses rather than being
misclassified as client errors.** This is enforced at compile time, not
just by convention: `DOMAIN_ERROR_STATUS_MAP` is written as `satisfies
Record<KnownDomainErrorCode, number>`, where `KnownDomainErrorCode` is a
union built directly from `@prowess/model`'s own `*_ERROR_CODES` constants
(never a hand-typed string literal list that could drift). Adding a new
code to any `*_ERROR_CODES` object in `@prowess/model` without adding a
matching entry here is a TypeScript compile error — the type checker
requires a deliberately-chosen status for every known code, rather than
relying on a reviewer to remember. `tests/unit/api-helpers.test.ts` adds a
runtime-level version of the same guarantee, iterating every currently-
known code and asserting each has a real numeric mapping.

At runtime, `statusForDomainErrorCode(code)` returns `undefined` — not a
default status — for any code with no entry. `toErrorResponse` treats that
`undefined` as a fail-closed signal: it returns a generic `500
INTERNAL.UNEXPECTED_ERROR` ("An unexpected server error occurred."),
**never** the original unmapped code, and never falls back to 400. An
unmapped code reaching this path represents an application contract/
configuration omission (a new `DomainError` code shipped without a
deliberately chosen HTTP status) — it is a server-side gap, not bad client
input, and must never be misclassified as one. The same generic 500 shape
is used for a genuinely unexpected non-`DomainError`/non-`ApiError`
failure (a raw bug, a Prisma error that somehow escaped a service's own
mapping, a null dereference, ...) — both paths are logged server-side only
(`console.error`), and neither ever includes the original code, message,
Prisma shape, stack trace, or an internal file path in the response body.

| Status | Meaning | Example codes |
| --- | --- | --- |
| 404 | Explicit resource not found (named by the request's own URL) | `ENTITY.NOT_FOUND`, `ENTITY_VERSION.NOT_FOUND`, `SOURCE_DOCUMENT.NOT_FOUND`, ... |
| 409 | Conflict with current state / duplicate | `ENTITY.CANONICAL_KEY_CONFLICT`, `ENTITY_VERSION.REVISION_CONFLICT`, `ENTITY_VERSION.IMMUTABLE`, `ENTITY_VERSION.INVALID_STATUS_TRANSITION`, `KEYWORD_ASSIGNMENT.DUPLICATE`, `RELATIONSHIP.DUPLICATE`, ... |
| 400 | Invalid input / invalid reference within a request body | `ENTITY.INVALID_TYPE`, `RELATIONSHIP.INVALID_SOURCE`, `RELATIONSHIP.INVALID_TARGET`, `RELATIONSHIP.SELF_REFERENCE`, `API.INVALID_UUID`, `API.INVALID_QUERY`, ... |
| 500 | Unexpected unhandled server failure, OR a known-but-unmapped `DomainError` code (fail-closed, never 400) | anything not a `DomainError` or `ApiError`; any `DomainError` code absent from `DOMAIN_ERROR_STATUS_MAP` |

None of the documented mappings below changed from their original M1-WO8
values — this patch only changes what happens for a code that ISN'T in
this table.

Two deliberate choices worth calling out explicitly:

- **`ENTITY_VERSION.INVALID_STATUS_TRANSITION` -> 409, not 400.** This code
  covers both "the transition was never valid from this status" and "the
  transition lost a race against a concurrent status change" (M1-WO3
  §13) — the second case is a conflict with the resource's current state,
  the same category as `ENTITY_VERSION.REVISION_CONFLICT`, not a
  malformed-request category.
- **`RELATIONSHIP.INVALID_SOURCE` / `INVALID_TARGET` -> 400, not 404.**
  Unlike a resource looked up directly by its own URL segment (which gets
  404 when absent — that's what 404 means here), these identify a
  referenced id *within a request body* that turned out to be invalid —
  the same category as any other malformed request input. Contrast with
  `GET /api/entities/:entityId` on a nonexistent id, which correctly gets
  404, because `:entityId` IS the resource the URL names.

## Pagination

Defaults: `page=1, pageSize=25`. Hard cap: `pageSize<=100` — a request
above the cap is silently clamped down to it (not rejected); a malformed
value (non-numeric, zero, negative, non-integer) IS rejected, with a 400
`API.INVALID_QUERY`, since a caller's typo should surface, not be silently
replaced by a default.

## `GET /api/entities` — filter semantics

| Filter | Form | Semantics |
| --- | --- | --- |
| `entityType` | exact `EntityType` string | Exact match on `Entity.entityType` |
| `canonicalKey` | exact string | Exact match on `Entity.canonicalKey` |
| `search` | free text | Contains-match across `EntityAlias.normalizedAlias` (any context) and `EntityVersion.displayName` (**any revision**, not just `latestRevision`) — see below for why. No fuzzy/trigram/full-text matching. |
| `keyword` | a `KeywordDefinition` UUID | **Entity-level `EntityKeyword` assignments only** — stated limitation, see below. Not a canonical-key form; resolve one first via `GET /api/keywords?canonicalKey=` (not yet implemented as a dedicated lookup, but `GET /api/keywords` + client-side filter works for the small Phase 1 vocabulary). |
| `status` | an `EntityVersionStatus` string | Filters by **`latestRevision.status`** — a list-view convenience, see below. |

### Why `search` checks every revision's `displayName`, not just `latestRevision`'s

Restricting search to only the latest revision would itself privilege one
Version as though it were canonically special for discovery purposes —
exactly the assumption this Work Order is instructed to avoid making.
Someone searching for an Entity's old name should still find it.

### Keyword filter — stated M1-WO8 scope limitation

PAS-10 recommends keyword filtering match "Entity-level OR
`latestRevision`-level" Keywords. **M1-WO8 implements Entity-level only.**
The fuller semantic would require resolving `latestRevision` before the
Entity-level `WHERE` clause can even be built — a materially more
expensive two-phase query, the same class of cost the `status` filter
already pays (see below) — and PAS-10 explicitly permits this narrower
scope with the limitation stated clearly, which this document is doing. **A
Keyword assigned only at the Version level will not currently surface an
Entity through this filter.**

### `status` filters by `latestRevision.status` — explicitly not Canon

This is a **list-view convenience, not global Canon resolution.** An
Entity whose latest revision happens to be `DRAFT` is not thereby
"inactive" in any authoritative sense — it just means the newest revision
is in that state. An Entity with no Versions never matches any `status`
value (there is no `latestRevision` for its status to equal).

### Pagination cost when `status` is combined with other filters

`status` depends on `latestRevision`, a value derived per-entity that
can't be expressed in the database-level Entity `WHERE` clause the other
filters use. When `status` is requested, `@prowess/db`'s `listEntities`
loads every candidate Entity id matching the *other* filters, resolves
`latestRevision` for all of them in one bulk query, and performs the
status match and pagination in application code. This is an accepted,
documented tradeoff for Phase 1 development-scale data — worth revisiting
(e.g. a raw-SQL window-function query) if dataset size grows significantly,
though a future Ruleset/Canon system may make this exact kind of query
obsolete first anyway.

## `latestRevision` — not `currentVersion`, not `canonVersion` (mandatory distinction)

Every Entity list item has this shape:

```json
{
  "entity": { "id": "...", "entityType": "SPELL_EFFECT", "canonicalKey": "..." },
  "latestRevision": {
    "id": "...",
    "revisionNumber": 3,
    "status": "DRAFT",
    "displayName": "..."
  }
}
```

`latestRevision` is deterministically **"the EntityVersion with the
highest `revisionNumber`."** That is the entire definition — a simple,
documented, list-display convenience. It is **never** called
`currentVersion`, `activeVersion`, or `canonVersion` anywhere in this
codebase, and it must never be read as a claim about Canon authority or
Ruleset currentness. Those concepts don't exist yet (M2). If an Entity has
no Versions at all, `latestRevision` is `null` — never omitted, never
defaulted to some placeholder.

## Endpoint map

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/api/entities` | Paginated, filterable list |
| POST | `/api/entities` | Create |
| GET | `/api/entities/:entityId` | Stable identity only |
| GET | `/api/entities/:entityId/versions` | Full history, `revisionNumber ASC` |
| POST | `/api/entities/:entityId/versions` | Create a revision; `revisionNumber` never caller-supplied |
| GET | `/api/entity-versions/:versionId` | Full EntityVersion representation |
| PATCH | `/api/entity-versions/:versionId` | DRAFT-only content update; accepts only `UpdateDraftEntityVersionInput` fields |
| POST | `/api/entity-versions/:versionId/status` | The ONLY way to change lifecycle status |
| GET | `/api/entities/:entityId/aliases` | List |
| POST | `/api/entities/:entityId/aliases` | Create |
| DELETE | `/api/entity-aliases/:aliasId` | Remove |
| GET | `/api/entity-aliases/search?alias=...&context=...` | 0..many matches, never one arbitrary pick |
| GET | `/api/entities/:entityId/keywords` | Entity-level assignments |
| POST | `/api/entities/:entityId/keywords` | Assign (Entity-level) |
| DELETE | `/api/entities/:entityId/keywords/:keywordId` | Remove (idempotent) |
| GET | `/api/entity-versions/:versionId/keywords` | Version-level assignments (never status-gated for reading) |
| POST | `/api/entity-versions/:versionId/keywords` | Assign (Version-level, DRAFT-only) |
| DELETE | `/api/entity-versions/:versionId/keywords/:keywordId` | Remove (DRAFT-only) |
| GET | `/api/keywords` | List, optional `?categoryId=` filter |
| GET | `/api/keywords/:keywordId` | Detail |
| POST | `/api/keywords` | Create |
| GET | `/api/keyword-categories` | List |
| POST | `/api/keyword-categories` | Create |
| GET | `/api/entities/:entityId/relationships` | `{ outgoing, incoming }`, always distinct |
| POST | `/api/relationships` | Create; never auto-creates an inverse |
| DELETE | `/api/relationships/:relationshipId` | Remove |
| GET | `/api/source-documents` | List |
| POST | `/api/source-documents` | Create; no file upload/parsing |
| GET | `/api/source-documents/:sourceDocumentId` | Detail |
| GET | `/api/source-documents/:sourceDocumentId/references` | All References citing this Document |
| GET | `/api/entity-versions/:versionId/sources` | Provenance for a Version |
| POST | `/api/entity-versions/:versionId/sources` | Attach; lifecycle-independent (M1-WO7) |
| DELETE | `/api/source-references/:sourceReferenceId` | Remove |

## UUID and query validation

Every route-param UUID is validated via `parseUuidParam` before any
service call — a malformed id returns `400 API.INVALID_UUID` naming the
field, never an opaque database error. Query parameters (`page`,
`pageSize`, and the entity-list filters) are parsed by the shared
`pagination.ts`/route-local logic before reaching `@prowess/db`; malformed
values are rejected with `400 API.INVALID_QUERY`.

## No authentication (Phase 1 scope)

**No user authentication or permissions are implemented.** This remains an
internal Phase 1 development Studio — there are no fake users, no owner
IDs, nothing that simulates auth. Every route handler is structured as a
thin adapter precisely so authorization can be inserted later (e.g. as
middleware, or a check at the top of each handler) **without rewriting any
domain service** — the service layer already has no concept of a caller
identity to retrofit around.

## Architecture enforcement

`scripts/check-architecture.mjs` gained a new, stricter rule specifically
for `apps/studio/app/api/**`: in addition to the existing ban on importing
Prisma directly, it also forbids any *deep* import into `@prowess/db`
internals (e.g. `@prowess/db/src/entity/repository.js`) while still
permitting the legitimate bare `@prowess/db` import every route uses.
Verified for real, locally: a deliberate direct `@prisma/client` import
and a deliberate deep `@prowess/db/src/client.js` import were both added
to a route file in turn, confirmed to fail the check, then reverted — the
same empirical-verification discipline this project has applied to every
architecture rule since M0-WO4.

## Sandbox limitations

This sandbox still cannot reach `https://binaries.prisma.sh`, so
`packages/prowess-db/generated/prisma/` does not exist here — the same
limitation documented since M0-WO3. What's new and worth stating plainly
for this Work Order specifically: **`apps/studio` now has its first real
dependency on `@prowess/db`**, and because `@prowess/db`'s own `dist/`
cannot be rebuilt here (it's frozen at a much earlier, partial state), `apps/studio`'s
production build **fails locally for the first time in this project** —
not because of a bug in this Work Order's code, but because Next.js's
bundler resolves `@prowess/db`'s compiled output, which is stale. This was
verified directly (the exact failure was inspected, not assumed) and
worked around for verification purposes only via a temporary, reverted
`tsconfig.json` path override that pointed TypeScript at `@prowess/db`'s
real *source* instead of its stale `dist/` — confirming every route
handler's actual calls into `@prowess/db` are structurally correct
against the real service signatures, with zero errors outside the
already-documented cascading categories. See the completion report's
"Local Verification" and "Sandbox Limitations" sections for the complete
account, including why this increases (not decreases) the importance of
the GitHub Actions run actually succeeding for this Work Order.
