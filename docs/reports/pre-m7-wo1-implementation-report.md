# PRE-M7-WO1 — Compendium authoring and cleanup: implementation report

**Branch:** `pre-m7-wo1-compendium-authoring-and-cleanup`, from `main` `16ee5c6` (tree `91bbd6d`). The recovery report is
`docs/reports/pre-m7-wo1-recovery.md`, and the architecture and coverage map is
`docs/architecture/pre-m7-wo1-compendium-authoring.md`.

**Status: Partially complete — ready for owner review of what is delivered.** The pull request is not open yet because
this environment cannot push (§9).

What is delivered and verified:

- topic sections;
- "What this affects" for every Stat;
- editing the owning rule;
- the guided Formula editor;
- the side-effect-free preview;
- guided editors for eight more kinds;
- the governed Strength → Armor demonstration, through the UI and across machines, restart and restore;
- the consumer audit;
- the gate, controls and invariants.

What is not finished:

- Guided editors for nine kinds whose payloads are deeply nested unions. They stay on the structured editor (still no
  raw JSON).
- The Mage Art and whole-ability add-flows, which are recorded as decisions in §7 and not invented.
- Hosted CI, including Tier 2 and Windows, which needs the owner's push.

## 1. Phases

| Phase | Result |
| --- | --- |
| A — recovery and review | Fresh clone of `main` `16ee5c6`. The 21 commits / 82 files merged since M6-WO12 (DIST-WO1, DIST-WO2) are reviewed in the recovery report. |
| B — model and services | Sections (`@prowess/model`); the rule graph, Stat impacts, rule usage and preview (`@prowess/db` `compendium-rules`); four registered routes. |
| C — navigation and editors | Topics, sections and Stat pages; the guided Formula editor; guided descriptors and table, list and boolean inputs; the preview panel; Release context through Compendium Admin. |
| D — demonstration and audit | Strength → Armor UI journey (S01–S06); pack transfer, restart and restore proof; consumer and cache audit. |
| E — hardening and verification | Architecture corrections found by the historical gates (§3); 390 px fixes; gate, controls and invariants; full verification (§8). |

## 2. Acceptance matrix (C01–C22)

| ID | Criterion | Status | Evidence |
| --- | --- | --- | --- |
| C01 | Recovery from GitHub and review since M6-WO12 | Met | recovery report |
| C02 | Coverage map: every kind mapped to section, editor, validator, tests and limitations; reserved kinds identified | Met | architecture doc §2; `pre-m7-wo1-static` (one home section; reserved = unsupported); `pre-m7-wo1-descriptors` (generic list pinned); rule-control C02 (source vocabulary = M5 reader) |
| C03 | Topic sections with deep links, search, Release context, back navigation | Met | section pages; e2e S01; screenshots 03–07 |
| C04 | Guided editors for all editable types, no raw JSON | Partial | 8 kinds newly guided (STAT, DERIVED_STAT, RANK_LADDER, SKILL_RANK, CHARACTER_DIE_PROGRESSION, AFFINITY_WEAKNESS_SEVERITY, TERRAIN, CREATURE_SIZE) on top of WO1–WO6. 9 kinds remain on the structured editor, which uses typed controls and never raw JSON (architecture doc §2). |
| C05 | Mage Art and Maneuver add-flows with exact references and child-Draft return | Not done — decision needed | architecture doc §7 |
| C06 | Stats → Strength → "What this affects" from real rule dependencies, direct and indirect | Met | rule-control C06; e2e S01, S05 |
| C07 | Edits the real owning rule Draft (change, replace, add, remove) | Met | e2e S03 (remove); rule-control C07 (replace, add, divisor) |
| C08 | Safe Formula round-trip, advanced fallback, validation of cycles and undeclared or unused inputs | Met | `pre-m7-wo1-formula-guide` (corpus round-trip, lossless or declines); rule-control C08 |
| C09 | Side-effect-free preview through the shared engine | Met | rule-control C07–C09 (values, nothing written); e2e S03 (no Release, no Character change) |
| C10 | R1 → R2 through the normal UI and governed publication | Met | e2e S03–S04 |
| C11 | R1 Character unchanged; new R2 Character uses R2 | Met | e2e S06 (sheet and row fingerprint); rule-control C10–C11 |
| C12 | Exact-Release reads after publication | Met | e2e S05 |
| C13 | Pack export/import into an independent database | Met (local) | `verify-pre-m7-wo1-transfer.mjs`: receiver R1 reads Armor, R2 does not; Armor 2 / 0 |
| C14 | Restore and restart | Met (local) | same script: resume in a new process, and resume on a database restored from the desktop workspace backup — identical |
| C15 | Consumer authority audit and cache keys | Met | architecture doc §6 |
| C16 | Data safety: lossless saves, no auto-save, concurrency, imported content protected, no publication bypass | Met | Saves still use `expectedUpdatedAt` (unchanged); guided inputs keep stored keys they do not show; preview and Formula routes write nothing (gate); imported lineages stay read-only (DIST-WO2, unchanged); publication only through the unchanged ChangeSet → Release flow (e2e S04). |
| C17 | Accessibility | Met for new UI | Labelled controls (`aria-label` on every table cell input), live regions for preview and parse results, real buttons and links, `aria-current` breadcrumbs. No automated axe run (not in the toolchain). |
| C18 | 390 px layout | Met | All new pages and the revision workspace have 0 px horizontal overflow at 390 px (measured). The pre-existing overflow from long canonical keys and titles was fixed. |
| C19 | Performance (measured only) | Met | Production build, local PostgreSQL, 1280 px: topics 239 ms, section 252–263 ms, Stat page 428 ms, entity workspace 286 ms (navigation to settled). Preview of 5 examples × 2 evaluations returns in under a second. |
| C20 | Findings ledger | Met | §4 |
| C21 | Verification (all suites, Tier 2, Windows) | Local: met. Hosted: pending | §8 |
| C22 | Branch published and PR opened, stopped before merge | Blocked | §9 |

## 3. Architecture decisions made during hardening

The historical gates caught three places where the first implementation crossed an established boundary. Each was fixed
by moving the code, not by weakening the gate:

1. **The Studio may not parse Formulas.** The M4-WO1–WO4 gates require this, and the first implementation did parse them
   in the Studio.
   - The guided view now runs on the server.
   - `@prowess/db` reads only the engine-validated tree, through the public `validateFormulaProgram`.
   - The editor calls `POST /api/compendium-rules/formula`.

   An attempt to place the module inside `@prowess/rules` was reverted: sixteen gates pin M4 byte-for-byte, and M4
   stays frozen.
2. **The Rules Reference is read-only.** The M6-WO2 gate requires GET only and no authoring client, and the first Stat
   page wrote. Now:
   - The Stat page links to Compendium Admin.
   - The Draft is created there by an explicit action, from the revision the Release pins.
   - The preview lives in the Draft workspace.
3. **No M5 vocabulary values or kind names in Studio sources or the catalog** (the M6-WO1 gate).
   - The Formula-source mirror moved to a documented module, pinned against the M5 reader.
   - Kind-specific labels and editability now come from the server (`roleLabel`, `editable`).
   - The editor's source details use a structural map, following the WO6 precedent.

The narrow gate amendments are each commented and limited to this Work Order's registered paths:

- `m2-api-static`: the `compendium-rules` prefix, like the earlier later-milestone prefixes;
- `m4-wo3-static`: two registered Formula-authoring paths;
- `m6-wo2-static`: one GET path;
- `m6-wo2-reference-lib`: the newly dedicated kinds;
- `ci-gate-inventory`: +7 controls, +1 gate;
- `later-milestone-routes`: the registry key.

## 4. Findings ledger

| # | Finding | Resolution |
| --- | --- | --- |
| F1 | `/compendium` was one technical list of 403 entries with no topic structure | Topic sections over the same pinned revisions |
| F2 | No way to see what a Stat affects; DERIVED_STAT and STAT used the generic editor | Rule graph and Stat page; guided descriptors |
| F3 | The reference presenter silently rendered nothing for a field type it did not list | Exhaustive switch with a `never` check; formulas shown as written |
| F4 | The Studio catalog fixture was stale for vocabularies added earlier in this branch | Regenerated through the existing writer (`M6_WO1_WRITE_FIXTURE=1`) |
| F5 | The first guided Formula parsed in the browser (boundary breach) | Moved server-side (§3.1) |
| F6 | The first Stat page wrote from the Rules Reference (boundary breach) | Link to Compendium Admin (§3.2) |
| F7 | `NONE` became a served vocabulary value; a Dashboard attribute fallback used it | Fallback renamed `UNCHECKED` (presentation-only attribute) |
| F8 | Long canonical keys and titles widened the page at 390 px (pre-existing) | Wrapping rules; 0 px overflow measured |
| F9 | The preview examples table could widen its card (flex `min-width`) | `min-width: 0` on the panel and its children |
| F10 | `prisma migrate deploy` cannot run here (engine download refused) | The local transfer proof applied migrations with the session's SQL script; the committed script uses `migrate deploy` as DIST-WO2 does (CI) |
| F11 | The M5 Formula-source lists are not exported by `@prowess/game` | Documented mirror plus a two-direction reader test (C02), rather than editing frozen M5 |

## 5. Data safety and constraints

- **No balance change.**
  - The demonstration runs only in isolated test Rulesets (`test.m6wo12.<run>.*`, and `test.pm7rule.*` in the DB test).
  - Each run is cleaned up by run id.
  - No shipped content, migration, schema or M4/M5 source changed.
- **No new persistence.** The preview candidate is never stored. The Formula operation is pure.
- **No arbitrary code.** There is no `eval` or `new Function`. Formulas are only read by the M4 validator and printed.
- Request bodies are allow-listed and bounded (≤12 examples, ≤20 Drafts, ≤2000-character expressions, ≤50 terms).
- `returnTo` accepts same-app `/compendium/` paths only.
- Disposable-database guards are kept in every new script (`*_test` on loopback only). No secrets or databases are in the
  bundle.

## 6. Screenshots and walkthrough

- **Before:** `/compendium` (one list of 403), Compendium Admin, and the generic STRENGTH_ARMOR editor.
- **After:**
  - landing, Release page and topics;
  - Stats, the STR "What this affects" page, the reserved Magic note and Keywords;
  - the entity workspace opened from a Stat;
  - the rank-ladder and creature-size guided editors;
  - the guided Formula editor;
  - the preview (STR 3/5: 1 → 0, STR 6/8: 2 → 0);
  - the 390 px revision workspace.

These are delivered alongside this report.

**Walkthrough (the e2e journey):**

1. Compendium → Rules Reference → Ruleset → Release → Browse by topic → Stats → STR.
2. Armor reads `floor(str / 3)` → Edit this rule.
3. Create New Revision from Revision 1.
4. Remove the contribution, which leaves `0`. Save Draft (PASS).
5. Calculate preview: Armor 1 → 0, with nothing published.
6. Submit for review → ChangeSet → approve revision → approve ChangeSet → Publish Release 2.
7. R2's STR page no longer lists Armor.
8. A new Character on R2 has Armor 0; the R1 Character still has 2, and its rows are byte-identical.

## 7. Open decisions for the owner

- **Mage Art.** It needs an M5 payload contract before any editor can exist.
- **Whole authored abilities** (`SPELL_DEFINITION`, `MANEUVER_DEFINITION`). Decide whether the Compendium should author
  them, and if so specify the guided add-component and child-Draft flow.
- **The guided Formula in `@prowess/db`.** It uses `validateFormulaProgram` for the tree. If you prefer the presentation
  module inside `@prowess/rules`, that means formally reopening frozen M4.
- **The remaining structured-editor kinds** are listed in the architecture doc §2, each with the reason it is not yet
  guided.

## 8. Verification (local)

| Check | Result |
| --- | --- |
| `pnpm lint`, `pnpm typecheck`, `scripts/check-architecture.mjs` | pass |
| Studio unit (112 files / 3778 tests) | pass |
| `@prowess/rules` unit (659) | pass (unchanged) |
| `@prowess/db` unit (24 files / 179) | pass |
| `@prowess/db` integration: rule-control and WO1/2/3/6 authoring and reference | pass (23) |
| PRE-M7-WO1 controls (7 mutations) | all caught and restored |
| Gate inventory | consistent: 46 gates, 730 controls |
| Production build | pass |
| Playwright: Strength → Armor journey | pass (≈ 48 s) |
| Playwright: compendium, Compendium Admin, Rules Reference specs | pass |
| Transfer, restart and restore proof | pass (≈ 48 s; 3 disposable databases created and dropped) |
| Full Playwright suite, full studio and db integration | see the final summary for the result of the complete run |
| Prisma validate / migrate drift, Tier 2, Windows installer and installed checks | **pending hosted CI** (engines and a Windows host are not available here) |

## 9. Publication

The work is committed on the branch locally and delivered as a verified git bundle. This session has no authenticated
access to GitHub: the `gh` token is invalid and the proxy refuses credentials. The owner pushes the branch and opens
the PR with the commands in the final summary.

Stop point: nothing is merged and no M7 work has begun.
