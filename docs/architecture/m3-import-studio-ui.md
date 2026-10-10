# Import Studio UI (M3-WO8)

**Status: implemented; awaiting CI verification.** The internal Prowess Studio workspace over the approved
`/api/import` surface (WO7). It adds no import mechanics, no API route, no schema change and no migration: every
review mutation is the one WO7 ImportDecision command, and the server stays authoritative.

```
APPROVED FOR IMPORT
        ≠
CANON

REVIEW COMPLETE
        ≠
PUBLISHED

IMPORT CONFLICT
        ≠
RULESET RULECONFLICT
```

Extraction ≠ Canon · a match suggestion ≠ acceptance · Approved for Import ≠ Canon · Import Conflict ≠ M2
RuleConflict · Review Complete ≠ published or imported content. These distinctions are written into the status labels,
help text and boundary notes, and pinned by `tests/unit/m3-import-ui-static.test.ts`.

## Navigation and routes

Developer navigation gains **Import** (`/developer/import`), and **Sources** now opens the Import source browser. The
Developer landing page links the Import Studio. Nothing is added to the Compendium or player-facing navigation.

| Route | Purpose |
| --- | --- |
| `/developer/import` | landing: registered Source Snapshots, recent Batches, Browse Sources / Create Import Batch / Continue Review |
| `/developer/import/sources` | registered Snapshots (document, label, file, size, content hash, registered time) |
| `/developer/import/sources/[snapshotId]` | Source Inspector (`?section=&page=&node=&start=&end=&row=&col=`) |
| `/developer/import/batches` | Batch list (paged) and the guided Create Batch form (`?snapshot=` prefills the source) |
| `/developer/import/batches/[batchId]` | the review workspace (`?candidate=&page=&matchRun=&historyPage=`) |

An Import sub-navigation (Import Home / Sources / Batches, `aria-current`) sits beside the workspace inside the
existing Studio shell — no separate application shell.

## Import landing and sources

The landing lists registered Snapshots (Phase 1: the Source Document list, then each document's Snapshots — the WO7
Snapshot list is per document) and the ten most recent Batches with status and extractor. Empty states explain the
next valid action.

**No upload (deliberate Phase-1 limitation).** The Studio operates on already-registered, already-ingested Source
Snapshots. Browser DOCX / PDF upload is not implemented because the platform has no approved blob-storage lifecycle;
there is no file input, no fake Upload button, and no base64 source storage. The UI says so: "Document upload is not yet
available in the Phase 1 Studio. Registered source snapshots and structures can be reviewed here." Original file bytes
are never offered for download (they are not stored). A later platform milestone may add upload / blob management.

## Source Inspector

Outline (section hierarchy as nested, keyboard-operable buttons with heading level and sub-section count), ingestion
state and structure hash, and the selected section's direct content (paged, 50 per page): block text **verbatim**
(whitespace and line breaks preserved), tables rendered from their WO1 structure (header cells, row / column spans,
nested tables), and asset placements as provenance metadata only — image bytes are not stored, so nothing is rendered
as a broken image, and nothing is OCR'd or interpreted. "View in Source" links from a Candidate select its section and
emphasize the exact node, text offsets (`<mark>`) or table cell.

## Create Batch workflow

Source Snapshot · Scope (Whole Snapshot / Section Subtree — the root section is chosen from the source outline and its
path shown; no UUID pasting) · Extractor, presented by name with its technical identity:

- **Structural Extraction** `prowess.structural@1` — "Identifies Sections, Tables and Root Content. Does not interpret
  Prowess rules."
- **Semantic Foundation** `prowess.semantic-foundation@1` — "Identifies explicit Formula, Requirement and Keyword
  declarations. Extracted terms remain unresolved until review."

Optional exact review context (Ruleset + comparison Manifest), label and description. Only WO7-accepted fields are sent.
After creation the workspace opens; if the API reports an identical existing Batch (`created: false`) the UI opens that
Batch and says so — it never pretends a duplicate was created.

## Batch workspace

```
┌─────────────────────────────────────────────────────────────────────┐
│ Prowess Studio                                          [Ruleset]   │
├──────────────┬─────────────────────────────┬────────────────────────┤
│ Developer    │ Import Batch                │ Inspector              │
│              │                             │                        │
│ Import       │ Review 34 / 57              │ FORMULA                │
│ Sources      │                             │ Spell AP               │
│ Batches      │ #17 FORMULA  UNREVIEWED     │                        │
│              │ #18 KEYWORD  APPROVED       │ Source Evidence        │
│ Source       │ #19 FORMULA  CONFLICT       │ ...                    │
│ Outline      │                             │                        │
│              │ [Prev] [Next]               │ [Approve] [Reject]     │
└──────────────┴─────────────────────────────┴────────────────────────┘
```

- **Header**: label, status, the lifecycle (Created → Extracting → Ready for Review → Reviewing → Review Complete, current
  step marked), source, scope with section path, extractor name + key@version, exact comparison context, created time,
  extraction output hash; ids / fingerprints / hashes behind a "Technical details" disclosure with copy controls.
- **Context / source pane**: Extraction Integrity (✓ stored candidate set matches output hash / ⚠ verification mismatch —
  separate from workflow status, read-only), the explicit MatchRun selector and "Analyze Entity Matches", and the selected
  Candidate's **Source Evidence** (section path, the exact node with highlighted offsets or table cell, verbatim excerpts,
  View in Source) — visible beside the Candidate so review never requires navigating away.
- **Queue**: Review progress from the derived server summary ("Reviewed n / total", every status, unresolved), then
  Candidates in **source order** (never sorted by confidence or status), 25 per page via WO7 pagination — the full corpus
  is never fetched. Each row: ordinal, label, kind, extraction confidence, review status, section context. Previous /
  Next Candidate and page controls. There are no status / kind filters: WO7 has no server-side filters, and a page-only
  filter would misrepresent the Batch.
- **Inspector**: the Candidate (kind, label, confidence, status, structured payload, schema, fingerprint, created, raw
  payload disclosure), Match Analysis, Conflict Evidence and the Review actions.
- **History**: the selected Candidate's history and the paged Batch decision history.

Confidence ("Confidence: HIGH") and review status ("Approved for Import") are separate badges with different shapes and
words; color only supplements text.

### Candidate views

- **Formula**: left side, expression, qualifier, unresolved source terms, functions, form — "Source terms remain unresolved.
  The formula is not evaluated or executed."
- **Requirement**: marker, authored text, unresolved source terms, clause — no Affinity / Rank / RequirementDefinition.
- **Keyword**: authored label, normalized review label, source declaration — "Extracted Keyword evidence does not grant
  mechanics."
- **Structural** (SECTION / TABLE / ROOT_CONTENT): structural facts — "review infrastructure, not a finished rule".
- **Entity**: proposed type / canonical key — a proposal only.

### Matching and conflict evidence

The MatchRun is chosen explicitly. With exactly one run it is shown for convenience, with its id and a note that nothing
is stored as "current"; matching never runs automatically. Outcomes are shown distinctly (EXACT_MATCH as "Exact Entity
Match … via canonical key / alias", POTENTIAL_MATCH as "Potential Match (not accepted)", NO_MATCH, INSUFFICIENT_IDENTITY,
NOT_APPLICABLE); suggestions keep the returned order with basis, score and exact comparison Version; a comparison Version
never implies content agreement. Duplicate-group membership reads "potentially the same Entity identity — not a delete
instruction". With a run selected, WO6 conflict signals involving the Candidate are shown with the members' payloads
side by side (Equivalent duplicate / Potential content conflict / Uncomparable duplicate) — "No automatic winner"; no
client-side schema conversion is attempted.

### Import decisions

Actions are derived from the SHARED `IMPORT_DECISION_RULES` in `@prowess/model` (display aid only — the browser keeps no
workflow graph of its own; an offered action can still be refused by the server):

- ENTITY / ENTITY_FIELD: Classify as Matched · Classify as New Entity · Mark Import Conflict · Needs Mapping · Reject;
  then Approve Matched / Approve New Entity for Import. Never UNREVIEWED → APPROVED.
- FORMULA / REQUIREMENT / KEYWORD: Approve Semantic for Import · Mark Import Conflict · Needs Mapping · Reject (a semantic
  Candidate in NEEDS_MAPPING has no path back to APPROVED — the WO6 graph is unchanged).
- UNKNOWN / REFERENCE / RELATIONSHIP: Needs Mapping · Reject — never an approval.

One shared decision form collects only the fields of the chosen type: basis (exact automated match / one of the
suggestions — **nothing preselected** / manual override via the existing Entity search), exact MatchRun + assessment
evidence and its exact comparison Version, duplicate-group evidence for Mark Import Conflict, and a rationale (required for
Reject and manual override — enforced before submission and by the server). Every submission carries the exact
displayed Candidate fingerprint and never a server-controlled field. Approvals are a quick inline confirm; Reject asks for
explicit confirmation. On success the status message receives focus, the queue / summary / history refresh, and
(optionally) the next Candidate is selected. A stale-state error (`DECISION_CONFLICT`, `INVALID_TRANSITION`,
`INVALID_EVIDENCE`) refreshes the Candidate and explains that review state changed. Controlled errors show readable copy and
the safe domain code — never raw JSON or internals.

### History, completion and read-only Batches

Histories are immutable timelines (sequence, decision, from → to, target, basis, rationale, time, pinned evidence) with
no edit or delete. "Complete Review" is available only when the derived summary shows no unresolved Candidates (the
API stays authoritative); its confirmation shows Approved / Rejected / Unresolved counts and states: "Completing review
freezes this review workflow. It does not publish or create Canon content." A Review Complete Batch is read-only: source,
Candidates, evidence, matching / conflict views, integrity and history remain; no command is shown.

## Responsive behavior

Below 900px the workspace becomes one column with tabs:

```
[QUEUE] [SOURCE] [DETAILS] [HISTORY]
```

Every action stays available; selecting a Candidate opens DETAILS. Tables scroll inside their own container, so the page
never needs a horizontal layout.

## Accessibility

Semantic buttons, links, labels, fieldsets and legends; `aria-current` for the selected Candidate / section / nav item and
lifecycle step; `role="tablist"` / `tab` / `tabpanel` on narrow screens; status text never depends on color; visible
focus outlines; native `<dialog>` confirmations with focus management; no single-key shortcuts.

## Architecture

```
Import Studio (app/developer/import)
      ↓
typed client (src/api-client/import.ts)  — GET / POST only, relative /api/import URLs, envelope + error parsing
      ↓
/api/import (WO7 routes)
      ↓
@prowess/db services
```

UI code never imports `@prowess/db`, Prisma, repositories or `@prowess/import`; only the client layer calls `fetch`.
Pages are client components (as the M2 governance workspace), Suspense-wrapped where they read URL state.

## Tests

Component tests (`m3-import-ui.test.tsx`), client tests (`m3-import-api-client.test.ts`), the static audit
(`m3-import-ui-static.test.ts`), and Playwright (`tests/e2e/import-studio.spec.ts`): landing, Source Inspector, create /
extract / semantic review / completion with a no-materialization check, match review with suggested and manual
classification, and mobile tabs + accessibility basics. Fixtures with no UI (an ingested Snapshot, Entities, an
ENTITY-candidate Batch) are seeded before the browser starts through the guarded `@prowess/db` test client;
there is no production `/seed` route.

## Roadmap boundary

| Work Order | Responsibility |
| --- | --- |
| **WO8** (this) | usable Import Studio interface |
| WO9 | ingest and review the first real Prowess source document |
| WO10 | final M3 reproducibility / audit gate |

A later platform milestone may add browser upload / blob management.
