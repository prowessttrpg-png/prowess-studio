# Version History UI (M1-WO10)

**Status: implemented and verified.** The permanent GitHub Actions CI workflow passed against this component when its Work Order was approved, and the M1 audit gate (`docs/audits/m1-completion-audit.md`) re-checks its invariants. Earlier revisions of this document recorded it as "not yet verified" because the authoring sandbox could not run Prisma or a browser; that limited only *local* verification and is resolved by CI.

## What this is

M1-WO10 turns the Entity detail page (`/compendium/entities/:entityId`) into
a historical inspection workspace. It extends the M1-WO9 page rather than
adding a second Entity experience, and it keeps one distinction visible
throughout:

```
Entity (stable identity)
   |-- Revision 1   (a historical EntityVersion snapshot)
   |-- Revision 2
   |-- Revision 3
```

**No revision is automatically "current."** There is still no Ruleset or
Canon resolution (that is M2), so the UI never infers one.

## Complete revision history

A **Version History** list shows *every* EntityVersion of the Entity —
none hidden or collapsed. It is ordered **newest first**: the Latest
Revision (also the default selection) sits at the top and the list reads
like a changelog. Each entry shows Revision N, display name, lifecycle
status (as text), created date, change type, and change summary, and is a
real link. The history is a `<nav aria-label="Version History">`.

## Latest vs. Selected Revision

- **Latest Revision** means exactly one thing: the highest `revisionNumber`.
- With no `?revision=` param, the Latest Revision is shown, titled
  **"Latest Revision."**
- Selecting an older revision titles the content area **"Selected Revision —
  Revision N"** and shows an explicit **"Return to Latest Revision"** link.
  The page never silently snaps back to Latest.
- Explicitly selecting the highest revision (`?revision=<highest>`) is still
  labeled "Latest Revision."

The UI uses only: *Latest Revision*, *Selected Revision*, *Revision N*,
*Version History*. It never displays "Current Version," "Current Rule,"
"Active Version/Revision," or "Canon Version." A `CANON` **status** appears
only as the literal lifecycle-status badge and carries no Ruleset authority.
A unit test scans every Compendium source file (comments stripped) for the
forbidden phrases, and the Playwright flow asserts their absence in the
rendered page.

## URL-addressable selection

Selection lives in the query string of the existing route:

```
/compendium/entities/:entityId?revision=2
/compendium/entities/:entityId?revision=1&compareA=1&compareB=2
```

Chosen over `/versions/:versionId` because it integrates with the existing
single route and component, keeps stable Entity data mounted while only the
query changes, and uses the human-meaningful revision number. Refresh,
back/forward, and direct links all work (covered by E2E).

**Validation.** `revision` must be a plain positive integer that matches a
revision *of this Entity* — only this Entity's own Version list is searched,
so another Entity's Version can never be addressed through this URL.
`?revision=999` (or `abc`) renders a **"Revision not found"** state with a
"Return to Latest Revision" link. It does **not** fall back to Latest, since
that would make the URL misleading. Stable identity, the history list, and
the Entity-level sections still render.

## Actual parent lineage (and branch awareness)

The selected revision shows its **Parent** from the real `parentVersionId`,
never from `revisionNumber - 1`. If Revision 3's parent is Revision 1, the
page says **Revision 1**. The parent is a link when it belongs to the same
Entity; a root revision shows "None (no parent revision)"; a
`parentVersionId` that isn't among the Entity's revisions shows
"Unavailable" without inventing a link. No branching graph is drawn — the
UI reports exactly what the data says and nothing beyond it.

## Version Keywords and Version-scoped Sources

For the selected revision the page shows that revision's *own* Keywords
(**Version Keywords — Revision N**; **Latest Revision Keywords** when the
selection is the latest) and *own* SourceReferences (**Sources for Revision
N**; **Sources for Latest Revision** when latest). Selecting Revision 1
never shows Revision 2's Keywords or Sources. Source display keeps M1-WO9's
behavior: SourceDocument title, source type, authority status (captioned
*descriptive only — does not control an active Ruleset*), version label,
section, page, note, and `file_reference` labeled as an opaque reference.

## Stable Entity-level metadata

These sections belong to the Entity, not to a revision, and are grouped in a
visually distinct, captioned block ("The sections below belong to the Entity
itself and stay the same whichever revision is selected"):

- Entity Identity (shown above the revision area)
- Aliases (never tied to whichever revision's name happens to match)
- Entity Keywords
- Outgoing and Incoming Relationships

They load **once** per Entity and are **not refetched** when the selected
revision changes (a unit test counts requests across a revision switch and
asserts the rendered HTML of the block is byte-identical before and after).

## Data loading

- **Stable data** (Entity, Version list, aliases, Entity Keywords,
  relationships): one parallel batch, keyed on `entityId` only.
- **Revision content** comes from the Version list itself, which already
  returns full EntityVersion snapshots — selecting a revision costs no extra
  request for its content. (`GET /api/entity-versions/:id` is therefore not
  called by this UI.)
- **Version-scoped data** (a revision's Keywords and Sources) loads per
  revision through `useVersionDetails`: each is requested at most once per
  page lifetime (a small per-page cache, not a cache framework), and they
  fail independently. A Keyword failure shows a local error with a retry and
  never hides Sources, the revision content, or the Entity.
- **SourceDocument titles**: M1-WO9's deduplicated parallel fetching is
  retained, now with a shared document cache across revisions so two
  revisions citing the same document cost one document request. A failed
  lookup is evicted from the cache so a retry can succeed.

Loading is intentional and local: while a revision's Keywords/Sources load,
the page keeps identity, history, and the revision content visible and shows
a per-section loading message.

## Comparison mode

Two selectors, **Revision A** and **Revision B** (real `<label>`s), compare
any two revisions; the choice is stored in the URL (`compareA`, `compareB`).
Side by side it shows: display name, short description, rules text, status,
change type, change summary, structured data, Version Keywords, and Sources.
Each field states in text whether it is *Identical in both revisions* or
*Differs between revisions* (not color-coded), and every cell is labeled
"Revision A (Revision N)" / "Revision B (Revision M)".

- **Structured data** is shown as readable JSON for each side. Key order
  alone is not treated as a difference. There is **no** mechanical
  interpretation — a changed number is not labeled a buff or nerf.
- **Keywords** are categorized as *Only in Revision A*, *In both revisions*,
  *Only in Revision B* using **KeywordDefinition id**, not rendered text, so
  two different Keywords with the same name stay distinct.
- **Sources** are listed per revision. A different Source does **not** imply
  one revision supersedes another — that belongs to future Canon governance.
- An unknown compare revision shows a clear message; two identical
  selections ask for two different revisions.
- With fewer than two revisions no selectors render, only "Comparison needs
  at least two revisions."

### Limits of comparison

Textual only. No line-level or semantic diff, no three-way merge, no
game-balance analysis, no notion of one revision being "better," newer in
authority, or active. No diff library was added.

## No lifecycle-event history

The database stores each Version's *current* lifecycle status, not a
status-transition log. The UI therefore shows the status each revision
currently has and **never** displays "Approved on…" / "Entered Playtest on…"
or any reconstructed transition timestamp. (A unit test asserts none appear.)
`changeType`/`changeSummary` are shown purely as editorial context; they have
no Canon behavior.

## No Ruleset or current-Version inference

Nothing here computes or displays an "active" revision. Latest Revision is a
deterministic convenience only. Which revision governs a given Ruleset is an
M2 question.

## Responsive and accessible behavior

- Desktop: the history is a left rail beside the selected revision.
  Narrow (<900px): the history stacks above the content and the comparison
  columns stack vertically. Long unbroken tokens (canonical keys, UUIDs,
  titles) wrap instead of forcing horizontal scroll.
- The selected history entry is communicated by the visible word
  "Selected", `aria-current="page"`, and a heavier border — not color alone.
  "Latest Revision" is a visible text tag. Comparison categories ("Only in
  Revision A", etc.) and sameness ("Identical"/"Differs") are text.
- Structured-data panels are labeled, keyboard-focusable scroll regions
  (`role="region"`, `tabindex="0"`).
- A real Playwright viewport regression (390×844) opens an Entity with
  multiple revisions, selects another revision, confirms its content, checks
  there is no horizontal page scroll, confirms the comparison stacks, and
  confirms the shell's navigation toggle still works. This is a functional
  regression, not a WCAG audit.

## Read-only scope

No edit, status-change, create-revision, keyword/source management, delete,
or merge control exists anywhere in the Compendium, even though the M1-WO8
API supports those operations.

## Architecture

All new modules live under `apps/studio/app/compendium/`, so the existing
`apps/studio (app/compendium/)` architecture rule covers them automatically:
they may not import `@prowess/db` (bare or deep) or Prisma. Data comes only
through `_lib/api-client.ts`. Pure logic (`revision-selection.ts`,
`detail-url.ts`) is framework-free and unit-tested directly.
