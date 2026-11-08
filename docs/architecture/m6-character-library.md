# M6-WO11 — Character Library / Save / Load

Status: implemented on local branch `m6-wo11` from certified `main` `bacdc776304ca5061358735629c20653609e0840` (WO10 PR #72; merged-main CI #265, 16/16 including Tier 2). **Not certified.** WO11 becomes final only after its published tree passes the complete required GitHub Actions workflow in a same-commit run, which needs separate authorization.

Invariants: M6-I173 – M6-I179 (`docs/architecture/m6-invariants.md`). Gate: `M6-WO11` (controls-2). Report: `docs/reports/m6-wo11-implementation-report.md`.

## 1. Purpose and boundary

A player can:

- find any saved Character;
- tell a Draft from a playable Character;
- close Studio;
- resume later from the last server-confirmed state, in a fresh browser session.

The terms are used narrowly:

- **Save.** A supported edit or play operation was accepted by its EXISTING server authority:
  - creation and profile → the WO3 Character service;
  - advancement → WO4;
  - Sheet resources, notes and portrait → WO5;
  - loadout → WO6;
  - Signature Abilities → WO7 / WO8;
  - play → WO10.
- **Load.** Reading the same Character id against its pinned Release. Opening is a read.

WO11 adds no game mechanic, no storage, no migration and no route. It changes four things:

1. It extends the existing Library read with search, status filter and paging.
2. It makes the creation wizard's save and resume semantics explicit.
3. It guards against stale responses.
4. It proves load / resume end to end.

Out of scope (separate product decisions):

- portable import / export;
- named save slots;
- rollback;
- cloning;
- archiving or deletion;
- accounts and sharing;
- the WO12 vertical slice.

## 2. Baseline inventory (what already persisted)

| Area | Already persisted (owning authority) | Reproducible gap found | WO11 change |
| --- | --- | --- | --- |
| Library | `GET /api/characters` (page, pageSize; count + page queries; `updatedAt desc, id asc`) | Index called `listCharacters()` once (50 rows) — no way to reach row 51+; no search / status; only a name link | Search, status filter and paging on the server (one predicate); paging UI; status actions; short id; latest-response guard |
| Creation draft | Character row, choices tables, `lockVersion` (WO3 explicit Save & Continue) | Reopen always started at Concept. In a two-write save (profile then choices), a failed second write left the client on the OLD version, so any retry went stale. Edits made during a save were overwritten. A lost response was reported as a failure. Double clicks could submit twice. Leaving did not warn about unsaved edits | `continuationStep`; each acknowledged write adopted with its version; partial-failure message plus retry of only the rest; unknown outcome → read and compare; one save at a time; `beforeunload` / in-app link guard; late-response id guard |
| Completed sheet | WO4 advancement, WO5 play state / notes / portrait, WO6 loadout, WO7 / WO8 ability revisions, WO9 cards | None (already write-free reads keyed by id; pages keyed by `characterId`) | Proven by DB / browser tests |
| Live play | WO10 runtime, ledger, versions, idempotency | None (reads write nothing; same-key replay) | Proven by DB / browser tests |

## 3. Library query contract

`GET /api/characters` adds these parameters:

- **`q`** — case-insensitive literal name text.
  - Trimmed at both ends; inner spaces and punctuation stay literal.
  - Empty or whitespace-only means no filter.
  - At most 120 characters after trimming (the name limit).
  - `%`, `_` and `\` are escaped before Prisma's `contains`. Prisma compiles `contains` to `ILIKE '%…%'` WITHOUT escaping, which the WO11 DB test caught.
- **`status`** — `ALL` (default), `DRAFT` or `CORE_COMPLETE`.

The rules:

- Unknown keys, a repeated `q` / `status`, an invalid status or an over-long `q` → 400 `API.INVALID_QUERY` (existing convention). The service re-validates the same rules as `CHARACTER.INVALID_INPUT`.
- One predicate (`characterListWhere`) is used by BOTH `countCharacters` and `selectCharacterPage`. It is applied to the whole collection before `skip` / `take`.
- The order is unchanged (`updatedAt desc, id asc`), so paging an unchanged dataset has no omissions or duplicates.
- Without `q` / `status`, the request and response are exactly the WO3 contract. The client sends no new parameter when the filter is empty or `ALL`.
- Rows are summaries only (`id, name, level, status, updatedAt, release`). No sheet, ability or play evaluation is run for a Library page.

The timestamp is `characters.updated_at`. It changes only on a Character-record write: profile, creation choices, completion or advancement. The Library labels it "Record updated (UTC)". Sheet, play, ability and loadout writes do not change it, and opening never does.

## 4. Library UI (`/characters`)

- **Controls.** "Search by name" (debounced 250 ms; Enter submits) and a Status radio group. Changing either resets to page 1. Previous / Next with "Page n of N" and the filtered total; a page past the end offers a jump to the last page.
- **States.** Loading, empty library ("No Characters yet"), no matches, and read failure with "Try again" (retries the same query) are distinct.
- **Latest response wins.** Each request takes a sequence number; only the newest may update the screen or the error.
- **Row content.**
  - The name links to `/characters/[id]` (the WO3 link).
  - A visible short id tells same-named Characters apart; the full id is in its title.
  - Each action is named by what it does and described by its row header (`aria-describedby`: name + short id), so the name link stays the only link named after the Character.
  - Actions come from the persisted status: a Draft offers **Continue creation** → `/characters/[id]/create`; a completed Character offers **Open sheet** → `/characters/[id]` and **Resume play** → `/characters/[id]/play`.
- **Layout.** The table scrolls inside its own container at narrow widths. Every control is a native, labelled control.

## 5. Save semantics (creation wizard)

| Condition | Behaviour |
| --- | --- |
| Unsaved edits | Validation and Check Character never mark anything saved. "Unsaved changes." is shown until the server acknowledges |
| Saving | The button reads "Saving…"; a ref guard allows one save at a time; success is shown only after the awaited writes |
| Edits during a save | The acknowledged state replaces only the submitted snapshot. Newer edits stay dirty ("Saved what was submitted. Changes made while saving are not saved yet.") and the step does not advance |
| Profile saved, choices failed | The profile acknowledgement (and its new `lockVersion`) is adopted immediately. The message names what is unsaved, and Save & Continue retries ONLY the choices at the acknowledged version. Storage holds the new profile and the old choices; nothing is lost. (WO3's two endpoints are kept; no new combined write was added.) |
| Stale second tab | `CHARACTER.STALE_WRITE` → message and an explicit "Reload the Character" (which discards local edits, as stated). It is never retried automatically |
| Unknown outcome (network, unreadable response, 5xx) | The Character is READ and compared with the submission (order-insensitive). Landed parts are adopted and reported as confirmed; the rest stays unsaved. Nothing is re-sent automatically |
| Leaving | `beforeunload` and an in-app link guard ask before leaving with unsaved edits. Acknowledged drafts are durable in the database (no browser storage) |
| Switching Character | Pages are keyed by `characterId` (remount). The wizard also ignores any response whose id is not the one shown |
| Reopening a Draft | `continuationStep`: a Draft with no saved creation choice starts at Concept, which also covers older drafts. Otherwise it opens at the first step that still has an issue in the SERVER's validation of the saved choices, or at Review when READY or when no issue maps to a step |

Play keeps WO10's model: an unacknowledged commit is retried with the same idempotency key and body, which replays the original event.

## 6. Load contract

| Reopening | Evidence that survives (tested) |
| --- | --- |
| Draft | Same id, exact Release, profile, partial choices (`m6-wo11-library.test.ts` L08 / L10; browser L03) |
| Completed sheet | Status, level, choices; projections recomputed by their authorities (L06 / L10) |
| Loadout and abilities | Equipped weapon and Attack; Spell / Maneuver ids, revision numbers and lifecycle states (an unfinished draft stays DRAFT); Cards on the same sources (L04 DB and browser) |
| Play | Combat phase and turn, sheet resources, movement, reserved MP, ACTIVE Sustained effect, event sequence and versions — identical on two opens; no write (L05 DB and browser) |
| History and versions | Byte-level fingerprint of every Character table unchanged across Library, Character, Sheet, Weapons, Attacks, Abilities, Cards, Play and Events reads, including a Character that never entered play (L06) |
| Release integrity | A newer Release leaves Characters on their pinned Release. An unknown id → `CHARACTER.NOT_FOUND`. An inconsistent stored play reference → `CHARACTER.PLAY_STATE_UNREADABLE` with the row untouched (L10) |

## 7. Data ownership

WO11 introduces no table, column, migration, route or `@prowess/db` export. Every saved field still belongs to its WO3–WO10 service, and the Library reads only the Character row and its Release identity. Browser storage is not used.

## 8. Limitations

- **Search matches the name only.** It does not search concept, notes or abilities.
- **Library state is not in the URL.** A full page reload returns to page 1 with no filter.
- **"Record updated" is the Character record's time, not "last played".** WO11 deliberately adds no activity timestamp: that would be new storage, and an open must not move a Character.
- **The in-app leave guard covers anchor navigation and `beforeunload`.** Programmatic route changes are not intercepted. The wizard itself only navigates after a successful completion, which requires saved state.
