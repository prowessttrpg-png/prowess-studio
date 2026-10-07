# Ruleset & Canon Studio UI (M2-WO10)

**Status: implemented; awaiting its first CI run.** M2-WO10 makes the whole M2 governance workflow
usable in Prowess Studio. It is an **operator interface over the M2 HTTP API** (M2-WO9). It adds no
migration, no persistence semantics, and no business rules in React.

```
Ruleset Overview → Manifest → Canon Policy → Conflict → Decision → ChangeSet → Impact → Approve → Publish → Release
```

## The boundary

```
User intent → src/api-client (fetch, relative /api/…, GET/POST only) → HTTP API → existing M2 services
```

- No page or component imports `@prowess/db`, Prisma, or any repository. This is enforced by
  `scripts/check-architecture.mjs` (rules for `app/developer/` and `src/api-client/`) and by the
  `m2-ui-static` audit.
- Only `src/api-client/http.ts` calls `fetch`. It decodes the `{ data }` / `{ data, pagination }`
  envelopes and turns every non-2xx response, network failure, or malformed payload into one
  `GovernanceApiError` that keeps the server's domain `code`, `status`, and `field`.
- **Nothing is re-implemented in the browser.** That includes manifest resolution, inheritance
  traversal, authority resolution or ranking, decision validation, ChangeSet translation, impact
  traversal, publication, hashing, and release diffing. The static audit forbids the corresponding
  model functions, hashing, `.sort(` (no client-side ranking), and loops over `parentManifestId`.
- **Form affordances are derived, not restated.**
  - Which operation fields appear comes from `@prowess/model`'s own `CHANGE_SET_OPERATION_RULES`.
  - Decision single/multi selection, the MERGE result field, and suggested dispositions come from
    `CANON_DECISION_RULES`.

  The UI therefore cannot drift from the server, and the server still validates every submission.
- **Server responses are authoritative.** After a mutation the UI re-fetches or navigates to the
  created record; it never invents ids, version numbers, or statuses. No client cache framework was
  added.

## Routes

| Route | Content |
|---|---|
| `/developer` | Developer landing; links to the workspace |
| `/developer/rulesets` | Ruleset list (status/channel filters) and **Create Ruleset** (no status field — always DRAFT) |
| `/developer/rulesets/[rulesetId]` | Overview: identity, section counts, named lifecycle commands |
| `…/manifests`, `…/manifests/[manifestId]` | Manifest list and builder; detail with Explicit vs Effective and the resolution inspector |
| `…/policies`, `…/policies/[policyId]` | Policy list and builder; detail with records and the authority resolution tester |
| `…/conflicts`, `…/conflicts/[conflictId]` | Conflict list and authoring; detail with evidence and the decision form |
| `…/decisions`, `…/decisions/[decisionId]` | Decision list; immutable detail |
| `…/change-sets`, `…/change-sets/[changeSetId]` | Manual or from-decision creation; detail with review commands and LIVE impact |
| `…/releases`, `…/releases/[releaseId]` | Release list and Publish; detail with hash verification and compare |

- **Durable URLs.** Every historical record has a stable, ID-based URL; there is one route tree,
  and no record has two pages. Reloading a URL reproduces the record without prior navigation, and
  the E2E suite opens Manifest, Policy, Decision, and Release URLs in a fresh browser context.
- **Workspace chrome.** The `[rulesetId]` layout loads the Ruleset once and renders the workspace
  header plus **section tabs**: a `nav` of links with `aria-current`, horizontally scrollable on
  narrow screens. Every page shows breadcrumbs, e.g.
  Developer › Rulesets › Core Playtest › Conflicts › Affinity naming conflict.
- **Canon Manager is this workspace.** The Developer nav's "Canon Manager" entry points to
  `/developer/rulesets`, next to a new "Rulesets" entry; there is no second copy.
- **Out of scope.** The M0 `/publishing` placeholder is unchanged. A dedicated Publishing
  application remains future work.

## Top-bar Ruleset selector

The M0 placeholder is now a real control. It is purely presentational in `@prowess/ui` (React only),
and `AppShell` supplies the data.

**It is a viewing context only.**
- **What it shows:** the Ruleset in the current URL (`/developer/rulesets/<id>/…`). Choosing another
  navigates to that Ruleset's workspace.
- **What it never does:** it stores nothing, sends no POST/PATCH/DELETE, and has no backend effect.
- **Labelling:** it reads **"Viewing"** with the accessible name "Ruleset to view", never "Active",
  "Current", or "Canon".

Both a component test and an E2E test confirm that choosing a Ruleset sends **no non-GET request**
and leaves a database fingerprint of every M2 table unchanged.

## Lifecycle commands

Only the named commands valid for the current status are rendered, each behind a short
confirmation dialog:

| Record | Status → commands shown |
|---|---|
| Ruleset | DRAFT → Submit for Review; IN_REVIEW → Approve |
| ChangeSet | DRAFT → Submit for Review; READY_FOR_REVIEW → Approve, Reject |

- There is no status dropdown and no generic setter.
- An APPROVED or PUBLISHED Ruleset offers **Publish Release** on the Releases section.
- If the status changed concurrently, the server's `…INVALID_STATUS_TRANSITION` is shown with its
  code.
- Approve, Reject, and Publish are styled as consequential actions. There are no delete operations
  anywhere.

## Sections

**Manifests**
- **Builder:** the operator picks an Entity, then one **exact** Version of it. The Version picker
  shows revision, display name, status, and id, and nothing is preselected (the "latest" is never
  chosen automatically). An empty manifest is allowed and explained ("No explicit pins…").
- **Detail:** **Explicit Entries** (what the manifest itself pins) are shown next to **Effective
  Composition** (from `/effective`, with EXPLICIT/INHERITED, depth, and resolved-from manifest).
- **Resolution inspector:** renders the API's provenance as a trace, or "No resolution".

**Canon Policy**
- Policies are immutable snapshots. "Latest (highest version)" marks only the numerically highest
  policyVersion.
- The builder adds and removes authority-record rows before submission.
- The detail page has a **read-only authority resolution tester** showing requested scope, resolved
  scope, status, and EXACT / GLOBAL_FALLBACK / UNRESOLVED.

**Conflicts**
- Filters: status, severity, type. OPEN/UNDER_REVIEW conflicts are visually emphasized (with text).
- Authoring requires 2–25 candidate rows of exact Versions, plus an optional source reference,
  label, and position summary.
- **Detail:** immutable evidence in revision order, never ranked and never labelled a winner.

**Decisions**
- For OPEN/UNDER_REVIEW conflicts the conflict page offers **Create Canon Decision**: an exact
  policy, a type, a disposition, candidate selection (a radio for SELECT_RULE, checkboxes
  otherwise), a MERGE result Version, and a rationale.
- A **preview** summarizes the decision before submission.
- After creation the conflict re-fetches and shows its terminal status; all candidate evidence stays
  visible.
- **Detail:** immutable — type, disposition, exact policy and conflict, selections, MERGE result,
  rationale. It links to "Propose a ChangeSet from this decision".

**ChangeSets**
- **Two creation paths:**
  - Manual: an operation editor whose fields adapt to the type, with contextual help.
  - From a Canon Decision: the explicit proposal endpoint.
- **Detail:** an immutable proposal with the named review commands.
- **LIVE IMPACT ANALYSIS:** read-only, loaded on demand, grouped into the eight categories, and
  phrased as potential impact. It explains that impact derives from the current database graph and
  may evolve.

**Releases**
- Releases are listed newest-first visually; the API order is ascending.
- **Publish Release** takes a base Manifest, a Canon Policy, an optional APPROVED ChangeSet, a
  version label, and notes. A confirmation dialog shows the full summary and explains that
  publishing creates a new immutable Release and Manifest snapshot.
- **Detail:** the published composition, the full hash, **Verify Manifest Hash** (Verified ✓ or
  **HASH MISMATCH**, with stored and computed hashes in a disclosure — a mismatch is a result, not an
  error), and **Compare** with another release (ADDED / REMOVED / CHANGED VERSION and unchanged
  count; composition only).

**Errors, loading, empty states**
- Every read has a loading state and an error panel with **Retry**.
- Every list has a purposeful empty state.
- Domain errors are shown with readable copy **and** their code (e.g. `RULESET_RELEASE.STALE_CHANGE_SET`).
  The publication errors §42 calls out have specific copy.
- Forms keep their draft after a server error. The policy, conflict, ChangeSet, and manifest forms
  warn before unloading with unsaved content.

## Responsive and accessible

- **Responsive:** section tabs scroll horizontally, forms are single-column, and description lists
  collapse below 900px. The mobile E2E test navigates every section, a conflict, a ChangeSet, and a
  release at 390×844 and asserts no page-level horizontal overflow.
- **Accessible:**
  - semantic headings and labelled form fields;
  - errors announced as alerts;
  - `aria-current` on tabs and breadcrumbs;
  - native `<dialog>` confirmations (focus trap and Escape), with focus moved to the confirm button
    and returned to the trigger;
  - status badges that always contain text, with color only supplementing it.
- **Inspector panel:** the reserved region remains available; Phase 1 renders traces inline instead.

## Phase-1 limitations (known, documented)

- **List pagination is technical debt.** The M2 API pages over each list service's ordered,
  in-memory result (approved in WO9). The UI requests up to 100 records per list. Both must move to
  database-level pagination before large-scale imports or public API use.
- **Entity lookup.** M1's `search` matches aliases and Version display names, and canonical keys are
  matched only exactly. The picker therefore runs both M1 queries and merges them; a fuzzy
  canonical-key search would need an API change.
- **Source references.** Conflict candidates take an optional SourceReference **ID**, because there
  is no per-Version SourceReference picker endpoint scoped to selection. Source *documents* are
  chosen through the existing list endpoint.
- **Labels.** Entity and Version labels in lists are resolved per id through the M1 API, cached per
  page session. This is fine for internal Phase-1 volumes.
- **No authentication.** Authentication and permissions arrive later.
