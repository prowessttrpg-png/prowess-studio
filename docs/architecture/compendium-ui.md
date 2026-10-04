# Compendium Entity Browser (M1-WO9)

**Status: implemented and verified.** The permanent GitHub Actions CI workflow passed against this component when its Work Order was approved, and the M1 audit gate (`docs/audits/m1-completion-audit.md`) re-checks its invariants. Earlier revisions of this document recorded it as "not yet verified" because the authoring sandbox could not run Prisma or a browser; that limited only *local* verification and is resolved by CI.

## What this is

The first functional Prowess Entity Browser — replaces the `/compendium`
placeholder with a real, API-backed interface for browsing, searching,
filtering, and inspecting Entities. **This Work Order is read-oriented.**
No create/edit/delete UI exists anywhere in the Compendium — see "No
editing yet" below.

## Architecture

```
Compendium UI (apps/studio/app/compendium/**)
      |
      v
HTTP API (apps/studio/app/api/**, M1-WO8)
      |
      v
@prowess/db service layer
      |
      v
Prisma / PostgreSQL
```

**The Compendium frontend never imports `@prowess/db`, Prisma, or any
database repository — not even indirectly.** Every piece of data it shows
comes from `apps/studio/app/compendium/_lib/api-client.ts`, a small typed
`fetch` wrapper that talks to the M1-WO8 API exclusively. This is enforced
by a dedicated `scripts/check-architecture.mjs` rule (see "Architecture
enforcement" below) — proving, not just asserting, that the API is
genuinely usable as the application's real data boundary.

## Routes

- `/compendium` — the Entity Browser list (replaces the M0-WO1 placeholder).
- `/compendium/entities/:entityId` — Entity detail.

Both render inside the existing Studio `AppShell` (M0-WO5) — the primary
navigation, top bar, and overall shell are unchanged.

## Search semantics

The visible search field calls the real `GET /api/entities?search=...`
query (M1-WO8) — never a client-side filter over a previously-fetched
page. The UI states plainly what it covers: **Entity aliases and
EntityVersion display names (any revision)** — not a fuzzy or full-text
search. This is the exact semantic M1-WO8 implemented; the Compendium adds
no broader interpretation on top of it.

## Filters

- **Entity Type** — exact match, options drawn from `@prowess/model`'s
  `ENTITY_TYPES` (safe to import directly — it's the framework-independent
  domain-types package, not `@prowess/db`).
- **Latest Revision Status** — filters by `latestRevision.status`
  (M1-WO8's documented semantic), labeled exactly that way so nobody reads
  it as Canon/Ruleset resolution. Options from `ENTITY_VERSION_STATUSES`.
- **Canonical Key (exact)** — a dedicated field, kept clearly separate
  from the human-facing `search` field, matching M1-WO8's own distinction
  between exact canonical-key lookup and approximate search.
- **Keyword ID** — accepts a KeywordDefinition UUID directly. The hint
  text states plainly that this matches **Entity-level Keyword assignments
  only**, mirroring M1-WO8's own stated scope limitation (§30) — the
  Compendium does not silently broaden this to also check Latest Revision
  Keywords.

## Pagination

Uses the M1-WO8 API's own pagination — current page, total pages, total
result count, and Previous/Next controls, all sourced from the API
response's `pagination` object. Default page size is 20 (API default is
25; the Compendium's slightly denser default suits its row height better,
still well under the API's 100 cap). `pageSize` is URL-configurable
(`?pageSize=`) specifically so automated tests can exercise pagination
with a small, practical result count rather than needing 20+ fixtures
(PAS-10 M1-WO9 §38 explicitly permits this). The Compendium never fetches
the entire Entity table and paginates in React.

## URL state

Filters, search, and page are reflected in the URL query string:

```
/compendium?search=damage&entityType=SPELL_EFFECT&status=DRAFT&page=2
```

**Parameter names match the API's own query parameter names exactly**
(`entityType`, not a shorthand like `type`) — chosen deliberately over the
Work Order's own illustrative shorthand example, since "use the existing
parameter names from the API where practical" is the more load-bearing
instruction and avoids a silent translation layer between URL state and
API calls. This means refreshing, sharing a link, and using the browser's
back/forward all restore the exact same browse state — verified by a
dedicated E2E test that navigates directly to a filtered URL and confirms
both the filter controls and the result set match.

## `latestRevision` — terminology (mandatory)

The Compendium uses **"Latest Revision"** exclusively, everywhere — list
rows, the detail page's section heading, filter labels, hint text. It
**never** says "Current Version," "Current Rule," "Active Version," or
"Canon Version." This isn't a styling preference: there is still no
Ruleset/current-version resolution system (that's M2), and using any of
those other phrases would misrepresent what the deterministic
highest-`revisionNumber` selection actually means. A dedicated unit test
asserts the forbidden phrases never appear anywhere a Latest Revision is
shown.

## Entity list presentation

Each row shows: the display label (the Latest Revision's `displayName` if
one exists; otherwise the canonical key — **never a fabricated name**),
the canonical key itself, an `EntityTypeBadge`, and either the revision
number + a `VersionStatusBadge`, or an explicit **"No revisions"** label
when the Entity has no Versions. Every row is a real `<Link>` to its own
detail page — open-in-new-tab, browser history, and keyboard navigation
all work because this is semantic navigation, not a click handler on a
non-interactive container.

## Entity detail — section by section

- **Entity Identity** — canonical key, Entity Type, `createdAt`,
  `updatedAt`, and the UUID (shown in a smaller, monospace, secondary
  presentation — rarely the first thing someone wants, but available).
  Deliberately contains **no** versioned content.
- **Latest Revision** — revision number, status, display name, short
  description, rules text, structured data (as formatted JSON via
  `StructuredDataViewer`, scrollable rather than letting large JSON blow
  out the layout), change type, change summary, and its own
  `createdAt`/`updatedAt`. Also shows `Versions: N` — a simple count, not
  a navigable history (M1-WO10's job). If the Entity has no Versions, an
  explicit empty state replaces this whole section — the word "revisions"
  is never silently blank.
- **Aliases** — authored alias text plus optional context, in the API's
  own deterministic order. "No aliases" when there are none.
- **Entity Keywords** and **Latest Revision Keywords** — two entirely
  separate sections with their own headings, preserving the Entity-level
  vs. Version-level distinction M1-WO5 established. Never merged into one
  undifferentiated Keyword list.
- **Outgoing Relationships** and **Incoming Relationships** — likewise
  two separate sections. Each row shows the relationship type, the
  counterpart Entity's canonical key (as a real link to its own detail
  page) and Entity Type, and its metadata (if non-empty) as formatted
  JSON. No inverse relationship is ever invented on either side —
  `getOutgoingRelationships`/`getIncomingRelationships` (M1-WO6) already
  return exactly what was authored, and the Compendium adds nothing to it.
- **Sources for Latest Revision** — explicitly scoped to the Latest
  Revision, never implied to apply to every historical Version. Shows the
  resolved `SourceDocument` title, source type, authority status (with an
  explicit caption: *"Descriptive only — does not control an active
  Ruleset"*), section label, page reference, excerpt note, and version
  label where present. `file_reference` is shown as a labeled, monospace
  **opaque reference** — never opened, fetched, or parsed.

## Detail data loading

Composes the existing M1-WO8 endpoints rather than one large "everything"
endpoint (§27): Entity identity, the Version list, aliases, Entity
Keywords, and relationships all load in **one parallel batch** (none
depends on another). The Latest Revision is derived from the Version list
(already ordered `revisionNumber ASC` by the API — the last element is
the highest revision) without a second request. Once its id is known, a
**second parallel batch** loads its Version-level Keywords and its
Sources.

**SourceDocument titles and the N+1 question:** a `SourceReference` only
carries a `sourceDocumentId`, not the document's title, so rendering
titles requires resolving each referenced document. Rather than changing
the API's response shape for this, `resolveSourceDocuments` (in
`_lib/api-client.ts`) deduplicates the referenced document ids and fetches
each one in parallel — a Version realistically cites a small, bounded
number of distinct documents (typically 0–5), so this is a handful of
parallel requests, not an unbounded or measurably expensive N+1. A
dedicated unit test confirms two references to the *same* document result
in exactly one fetch, not two. No backend change was made for this — the
smallest-necessary-change bar PAS-10 M1-WO9 §27 sets was met by client-side
composition alone.

## Loading / empty / error states

- **Loading**: a plain, accessible message (`role="status"`,
  `aria-live="polite"`) — no layout-shifting spinner animation.
- **Empty**: "No Entities exist" (nothing in the database at all) vs. "No
  Entities match these filters" (filters are active but matched nothing)
  are distinguished based on whether any filter/search value is currently
  set — an empty database never looks like a broken application.
- **Error**: `role="alert"`, shows only the API's own already-sanitized
  `message` (M1-WO8's error contract guarantees this is safe to display —
  the Compendium trusts that contract rather than re-sanitizing), with a
  "Try again" retry action that simply re-runs the same fetch.

## No editing yet

The Compendium contains **zero** create/edit/delete affordances — no
"Create Entity" button, no inline editing of any field, no alias/Keyword/
relationship/Source management UI — even though the M1-WO8 API supports
all of those operations. This Work Order establishes browsing and
inspection only; authoring UX is explicitly out of scope here.

## Shared vs. local components

Truly generic, domain-agnostic presentation primitives live in
`@prowess/ui`: `EntityTypeBadge`, `VersionStatusBadge`, `KeywordChip`,
`EmptyState`, `Pagination` — none of them know what an "Entity" or a
"Keyword" conceptually is beyond the string/number values they're handed.
Everything that understands the Compendium's actual data shapes
(`EntityListRow`, `EntityFilters`, the detail-page sections, the API
client) lives under `apps/studio/app/compendium/`, colocated via Next.js's
`_components`/`_lib` convention (excluded from routing). No Next.js
routing or fetching logic was pushed into `@prowess/ui`.

## Responsive & accessible by construction

- Below the existing 900px Studio shell breakpoint, entity rows and
  detail-page field grids stack vertically instead of forcing a wide row
  layout off-screen.
- Search and every filter control has a real `<label>`.
- Status/type badges always render their text label — never color alone
  (verified by a unit test inspecting the rendered text, not just a CSS
  class).
- Pagination buttons have explicit `aria-label`s ("Previous page"/"Next
  page"); the overall control is a `<nav aria-label="Pagination">`.
- Loading and error states use `role="status"`/`role="alert"` so
  assistive tech is informed without a focus change.
- Every result and every relationship counterpart is a real `<a>` via
  Next.js's `<Link>` — fully keyboard-reachable, with working
  open-in-new-tab and browser history.

## Why Ruleset/current-version selection is still absent

Nothing in this Work Order infers, computes, or displays a "currently
active" rule. `latestRevision` is the one and only deterministic
convenience this UI uses, and it is labeled as exactly that everywhere.
Which EntityVersion is authoritative within a given Ruleset is a question
for M2's Ruleset/Canon system, which doesn't exist yet — the Compendium is
built to not pretend otherwise.

## Update (M1-WO10)

The Entity detail page now includes a full **Version History**, selectable
and URL-addressable historical revisions, actual parent lineage, a
comparison mode, and a clear split between Entity-level and revision-scoped
data. M1-WO9's `LatestRevisionSection` was generalized into
`RevisionSection` (titled "Latest Revision" when showing the latest, and
"Selected Revision — Revision N" otherwise); all M1-WO9 behavior is
preserved. See `version-history-ui.md`.
