# PRE-M7-WO1 — Compendium authoring and cleanup: implementation report

**Branch:** `pre-m7-wo1-compendium-authoring-and-cleanup`, from `main` `16ee5c6` (tree `91bbd6d`). The recovery report is
`docs/reports/pre-m7-wo1-recovery.md`, and the architecture and coverage map is
`docs/architecture/pre-m7-wo1-compendium-authoring.md`.

**Status: implementation complete locally; publication blocked.** Every C01–C20 criterion is met with local evidence.
Hosted CI (Tier 2, Windows, the Prisma migrate / drift job) has not run, because this environment cannot push (§9). The
pull request is not open, nothing is merged, and no M7 work has begun.

Delivered and verified:

- topic sections, and "What this affects" for every Stat;
- editing the owning rule, the guided Formula editor and the side-effect-free preview;
- guided editors for **every** authorable kind and schema version — no kind is left on the generic editor;
- reusable Spell and Maneuver Definitions authored in the Compendium from exact component revisions, with a
  child-Draft round trip;
- Mage Art authoring and reference (`MAGE_ART` payload version 1), with three rule decisions open for the owner (§7);
- the governed Strength → Armor demonstration through the UI and across machines, restart and restore;
- the consumer audit, and the DB test-isolation fix (F12, F13);
- the gate, 13 negative controls and the invariants.

## 1. Phases

| Phase | Result |
| --- | --- |
| A — recovery and review | Fresh clone of `main` `16ee5c6`. The 21 commits / 82 files merged since M6-WO12 (DIST-WO1, DIST-WO2) are reviewed in the recovery report. |
| B — model and services | Sections (`@prowess/model`); the rule graph, Stat impacts, rule usage and preview (`@prowess/db` `compendium-rules`); four registered routes; catalog vocabularies for every guided field. |
| C — navigation and editors | Topics, sections and Stat pages; the guided Formula editor; guided descriptors for every kind (recursive controls); `AbilityDefinitionEditor` and the child-Draft flow; the preview panel. |
| D — demonstration and audit | Strength → Armor UI journey (S01–S06); guided-authoring journey (G01–G02); pack transfer, restart and restore proof; consumer and cache audit. |
| E — hardening and verification | Architecture corrections found by the historical gates (§3); DB isolation fix; MAGE_ART v1 through the approved-M5-change process; gate, controls, invariants; full verification (§8). |

## 2. Acceptance matrix (C01–C22)

| ID | Criterion | Status | Evidence |
| --- | --- | --- | --- |
| C01 | Recovery from GitHub and review since M6-WO12 | Met | recovery report |
| C02 | Coverage map: every kind mapped to section, editor, validator, tests and limitations; reserved kinds identified | Met | architecture doc §2; `pre-m7-wo1-static` (one home section; reserved = unsupported; MAGE_ART now authorable); rule-control C02 (each guided Formula input list equals what its M5 reader accepts: derived, roll, Initiative, movement grant) |
| C03 | Topic sections with deep links, search, Release context, back navigation | Met | section pages; e2e S01; screenshots 03–07 |
| C04 | Guided editors for all editable types, no raw JSON | Met | §2.1. `pre-m7-wo1-descriptors`: every key of every shipped payload is described by its kind's guided form, recursively; no authorable kind or version is on the generic editor. `pre-m7-wo1-guided-editors-ui`: rendering never rewrites a stored payload; an edit changes only that value; a shape switch asks first. Advanced fallback kept for exceptional nested data. |
| C05 | Mage Art and Maneuver add-flows with exact references and child-Draft return | Met | e2e G01 (Mage Art authored, PASS, reopens intact); e2e G02 (Spell → Create a new effect → returns with the exact revision and the unsaved description); UI tests W1-ABILITY (Spell / Maneuver slots, parameters, attachments, Powerful Blow) and W1-MAGE-ART; game `pre-m7-wo1-mage-art` (16 tests). Mage Art D1–D3 use the documented defaults (§7). |
| C06 | Stats → Strength → "What this affects" from real rule dependencies, direct and indirect | Met | rule-control C06; e2e S01, S05 |
| C07 | Edits the real owning rule Draft (change, replace, add, remove) | Met | e2e S03 (remove); rule-control C07 (replace, add, divisor) |
| C08 | Safe Formula round-trip, advanced fallback, validation of cycles and undeclared or unused inputs | Met | `pre-m7-wo1-formula-guide` (corpus round-trip, lossless or declines); rule-control C08 |
| C09 | Side-effect-free preview through the shared engine | Met | rule-control C07–C09 (values, nothing written); e2e S03 (no Release, no Character change) |
| C10 | R1 → R2 through the normal UI and governed publication | Met | e2e S03–S04 |
| C11 | R1 Character unchanged; new R2 Character uses R2 | Met | e2e S06 (sheet and row fingerprint); rule-control C10–C11. The R1 4 MP / R2 3 MP Ward comparison is still a regression fixture. |
| C12 | Exact-Release reads after publication | Met | e2e S05 |
| C13 | Pack export/import into an independent database | Met (local) | `verify-pre-m7-wo1-transfer.mjs`: receiver R1 reads Armor, R2 does not; Armor 2 / 0 |
| C14 | Restore and restart | Met (local) | same script: resume in a new process, and on a database restored from the desktop workspace backup — identical |
| C15 | Consumer authority audit and cache keys | Met | architecture doc §6. MAGE_ART adds no consumer: the compiler maps it to null and the card stays UNAVAILABLE (`pre-m7-wo1-static` pins that only `payload.ts` and `index.ts` import its reader). |
| C16 | Data safety: lossless saves, no auto-save, concurrency, imported content protected, no publication bypass | Met | Saves use `expectedUpdatedAt` (unchanged); guided inputs keep keys they do not show; optional engine policies stay absent until set; the child-Draft stash is this tab only, one use, 24 h, never sent to the server, and the parent stays unsaved until the designer saves (e2e G02); preview and Formula routes write nothing; imported lineages stay read-only; publication only through ChangeSet → Release (e2e S04). |
| C17 | Accessibility | Met for new UI | Labelled controls, fieldsets with legends for every nested group, live regions for preview and parse results, real buttons and links, `aria-current` breadcrumbs. Vocabulary options are shown as readable labels. No automated axe run (not in the toolchain). |
| C18 | 390 px layout | Met | 0 px horizontal overflow at 390 px on the new pages and the revision workspace (measured). |
| C19 | Performance (measured only) | Met | Production build, local PostgreSQL, 1280 px: topics 239 ms, section 252–263 ms, Stat page 428 ms, entity workspace 286 ms. Preview of 5 examples × 2 evaluations under a second. |
| C20 | Findings ledger | Met | §4 |
| C21 | Verification (all suites, Tier 2, Windows) | Local: met. Hosted: pending | §8 |
| C22 | Branch published and PR opened, stopped before merge | Blocked (no GitHub credentials here) | §9 |

### 2.1 Editor coverage — the nine kinds that were on the structured editor

All nine are schema version 1, the only version their M5 readers support. AFFINITY version 2 (the authoring version of
AFFINITY) and the newly activated MAGE_ART v1 are listed too.

| Kind (version) | Controls added | Kept as advanced data |
| --- | --- | --- |
| CORE_RESOLUTION (1) | Procedure (roll shape, Stat Mastery, Initiative); natural selection per roll mode; total Formula with the roll or Initiative input list; bonus target; comparison; optional critical; requires-Skill; Mastery levels and the rolls it applies to; tiebreak steps | — |
| ACTION (1) | Timing; AP cost by model (fixed, range, minimum, variable with determiner, none); other costs; payment policy; movement grant with its Formula | — |
| ACTION_IMPROVEMENT (1) | Exact ACTION reference; prerequisite and modification variants (new AP cost, rules text) | the optional condition |
| RESOURCE (1) | Kind; maximum source; refresh and expiry targets; spending; ceiling; overflow; usage restrictions | — |
| AFFINITY_RANK_RULE (1) | Rank rows; authority | — |
| AFFINITY_PROGRESSION (1) | Per-Level steps: mode and options (choose primary, rank up, gain Affinity) | — |
| ABILITY_CONSTRUCTION_RULE (1) | Named formulas; Spell, Maneuver and Signature groups; cost rows | the four optional engine policies, absent until set |
| SPELL_DEFINITION (1) | Name, description, composition key, Affinity, authority, Keywords; slots for targeting, effects, traits (with scope), casting conditions and duration, each an exact revision with its declared parameters; construction options; additional Affinity traits; "Create a new …" | the advanced effect chain |
| MANEUVER_DEFINITION (1) | As Spell, plus Foundation actions, Effect-to-action attachments and Powerful Blow | — |
| AFFINITY (2) | Identity, themes, Strength and Weakness lists | — |
| MAGE_ART (1) | Art key; activation AP / MP; maintenance AP / MP and optional special cost text; Active Effect window; modes with optional own costs and rules text; source | — |

## 3. Architecture decisions made during hardening

The historical gates caught three places where the first implementation crossed an established boundary. Each was fixed
by moving the code, not by weakening the gate:

1. **The Studio may not parse Formulas.** The guided view runs on the server; `@prowess/db` reads only the
   engine-validated tree through `validateFormulaProgram`; the editor calls `POST /api/compendium-rules/formula`. M4
   stays frozen.
2. **The Rules Reference is read-only.** The Stat page links to Compendium Admin, where the Draft is created by an
   explicit action and the preview lives.
3. **No M5 vocabulary values or kind names in Studio sources or the catalog.** Mirrors live in a documented module
   pinned against the M5 readers; labels and editability come from the server.

MAGE_ART v1 changed frozen M5 (`@prowess/game`) through the existing approved-change process, not by editing a gate:
the exact hashes of the 8 changed and 2 added files are registered under `PRE-M7-WO1` in
`docs/architecture/m6-approved-m5-changes.json`, and `pre-m7-wo1-static` pins that entry.

Narrow gate amendments, each commented and limited to this Work Order:

- `m2-api-static`, `m4-wo3-static`, `m6-wo2-static`, `later-milestone-routes`: the four registered routes;
- `later-milestone-schema`: the approved-change registry accepts the `PRE-M7-WO1` key;
- `m6-wo1-static`: ACTION is a sanctioned picker kind (it is also a resource-kind value);
- `m6-wo1-authoring-lib`, `m6-wo2-reference-lib`: the newly guided kinds; the generic fallback is still asserted for a
  reserved kind and an unknown version;
- `m6-wo9-static`, `m6-wo9-cards-ui`, game registry tests (WO3 / WO4 / WO6 / WO9, card phase B): MAGE_ART is activated
  by a later Work Order; its card stays UNAVAILABLE;
- `entity-version-lifecycle`: the four new `@prowess/db` exports;
- `ci-gate-inventory`: +13 controls, +1 gate.

## 4. Findings ledger

| # | Finding | Resolution |
| --- | --- | --- |
| F1 | `/compendium` was one technical list of 403 entries with no topic structure | Topic sections over the same pinned revisions |
| F2 | No way to see what a Stat affects; DERIVED_STAT and STAT used the generic editor | Rule graph and Stat page; guided descriptors |
| F3 | The reference presenter silently rendered nothing for a field type it did not list | Exhaustive switch with a `never` check |
| F4 | The Studio catalog fixture was stale for vocabularies added in this branch | Regenerated through the existing writer (`M6_WO1_WRITE_FIXTURE=1`) |
| F5 | The first guided Formula parsed in the browser (boundary breach) | Moved server-side (§3.1) |
| F6 | The first Stat page wrote from the Rules Reference (boundary breach) | Link to Compendium Admin (§3.2) |
| F7 | `NONE` became a served vocabulary value; a Dashboard attribute fallback used it | Fallback renamed `UNCHECKED` |
| F8 | Long canonical keys and titles widened the page at 390 px (pre-existing) | Wrapping rules; 0 px overflow measured |
| F9 | The preview examples table could widen its card | `min-width: 0` on the panel and its children |
| F10 | Prisma `migrate deploy` / `migrate diff` cannot run here | Environment, not code: both need the native schema engine from `binaries.prisma.sh`, which the egress policy refuses (403) here and on the linked computer. §8 records what was verified instead. |
| F11 | The M5 Formula-source lists are not exported by `@prowess/game` | Documented mirrors plus reader tests in both directions (C02), rather than editing frozen M5 |
| F12 | `entity-keyword.test.ts` failed in `afterAll` (`source_references_entity_version_id_fkey`) | **Pre-existing test-isolation defect, not a regression.** Reproduced on the unchanged baseline and on the branch in a disposable database: clean → both pass; with another suite's cited `test.` row present → both fail identically. Cause: six M1-era suites deleted every `test.` Entity database-wide, including rows other suites own and cite. Fix: each suite deletes only its own prefix. Assertions, guards and negative cases are unchanged; with the polluting row present all six pass and the row survives. |
| F13 | `entity-version-lifecycle` export pin failed | **Regression from this branch** (new `@prowess/db` exports). The public surface was narrowed to four functions and registered in the pin. |
| F14 | Studio select menus showed raw vocabulary tokens | Readable labels (`formatEnumLabel`); values unchanged |
| F15 | `MAGE_ART` had no contract anywhere (registry, validator, card, compiler, fixtures) | Smallest compatible contract, v1, for authoring and reference only (§7) |

## 5. Data safety and constraints

- **No balance change.** Demonstrations run only in isolated test Rulesets (`test.m6wo12.<run>.*`, `test.pm7rule.*`,
  `test.e2e_pm7.*` Drafts) and are cleaned up by run id or left as unpublished test Drafts in the disposable test
  database. No shipped content, schema or migration changed (`git diff 16ee5c6 -- packages/prowess-db/prisma` is
  empty). M4 is unchanged. M5 changed only through the registered MAGE_ART v1 entry, and no M5 mechanical result changed
  (game suite: 1837 / 1837).
- **No new persistence.** The preview candidate is never stored; the Formula operation is pure; the child-Draft stash
  stays in the browser tab.
- **No arbitrary code.** No `eval` or `new Function`. Formulas are read only by the M4 validator.
- Request bodies are allow-listed and bounded. `returnTo` accepts same-app `/compendium/` paths only.
- Disposable-database guards kept in every script (`*_test` on loopback only). No secrets or databases are in the bundle.

## 6. Screenshots and walkthrough

Delivered alongside this report:

- **Before:** `/compendium` (one list of 403), Compendium Admin, and the generic STRENGTH_ARMOR editor.
- **After:** topics and sections; the STR "What this affects" page; the guided Formula editor; the preview; the 390 px
  workspace; and, new in this pass, the guided editors for the nine kinds, the Mage Art editor (new and saved Draft),
  the Spell child-Draft round trip (child form with the return banner, and the parent with the new exact revision).

**Walkthroughs (e2e):**

1. Strength → Armor (S01–S06): Topics → Stats → STR → Edit this rule → remove the contribution → preview 1 → 0 →
   ChangeSet → Release 2 → R2 no longer lists Armor → a new R2 Character has Armor 0; R1 unchanged.
2. Mage Art (G01): New Definition → MAGE_ART → costs, maintenance, Active Effect window, a mode, source → Validate PASS
   → Create Draft → reload shows every value.
3. Spell (G02): New SPELL_DEFINITION Draft → type a description → "Create a new effect" → New Definition with the kind
   preset and a return banner → create the Effect Draft → back on the Spell with the description kept and the Effect's
   exact revision in the slot, still unsaved.

## 7. Decisions for the owner

Mage Art v1 applies a default for each of these. All are reversible before anything is published:

- **D1 — cost shape.** (a) fixed AP / MP per Art — **applied**; (b) per-Level cost rows; (c) a cost Formula. The M5
  system map mentions "Level-based tables" for Mage Arts, so (b) or (c) may be needed once the rulebook text is checked.
- **D2 — what an Art does.** (a) rules text — **applied**; (b) structured per-Art fields; (c) reuse the Spell Effect
  components.
- **D3 — play.** (a) authoring and reference only; the card stays unavailable — **applied**; (b) also Signature Ability
  investment and play activation, in a later Work Order with its own contract.

Also still open: the guided Formula lives in `@prowess/db` (using `validateFormulaProgram`). Moving it into
`@prowess/rules` would mean formally reopening frozen M4.

## 8. Verification (local, on the final commit)

Run on the final branch commit in this environment (Linux, Node 22.23.4, PostgreSQL 16, production build).

| Check | Result |
| --- | --- |
| `pnpm lint`, `pnpm typecheck`, `scripts/check-architecture.mjs` | pass |
| `@prowess/game` unit | 57 files / 1837 pass (includes `pre-m7-wo1-mage-art`, 16) |
| `@prowess/rules` unit | 659 pass (M4 unchanged) |
| `@prowess/model` / `@prowess/import` / `@prowess/ui` unit | 513 / 128 / 21 pass |
| Studio unit | 113 files / 3798 pass |
| `@prowess/db` unit | 24 files / 179 pass |
| `@prowess/db` integration, CI-equivalent (2 shards, each on a freshly migrated disposable database) | shard 1: 32 files / 302 pass; shard 2: 32 files / 342 pass (644 total, including `m6-wo11-library` and the six isolation-fixed M1 suites) |
| Studio integration | 40 files / 242 pass |
| Playwright, full suite against the production build | 96 / 96 pass (15.8 min), including S01–S06 and G01–G02 |
| PRE-M7-WO1 negative controls | 13 / 13 caught and restored byte-for-byte |
| Gate inventory | consistent: 9 suites, 46 gates, 736 controls, 20 checks |
| Strength → Armor transfer, restart and restore proof | pass (44 s): receiver R1 Armor 2, R2 Armor 0; unchanged after a new process and after a restore into an independent database |
| `prisma validate` | pass |
| `prisma migrate deploy` / `migrate diff` (drift) | **Not runnable here — environment.** Both need the native schema engine, which Prisma downloads from `binaries.prisma.sh`; the egress policy refuses it with 403 here and on the linked computer. The CLI's bundled WebAssembly schema engine is not used by these commands in the `classic` engine mode this project configures. What was verified instead: the branch changes nothing under `packages/prowess-db/prisma` (`git diff 16ee5c6 -- packages/prowess-db/prisma` is empty, so it matches the schema and migration chain that passed hosted drift on `main`); all 30 migrations were applied as SQL to every disposable database used above, and the migration-compatibility and schema suites in the DB integration run pass. The hosted `db-api` job remains the authority. |
| Hosted Tier 2, Windows installer and installed checks | **pending** — run only after the owner pushes |

Two results needed investigation:

- **`entity-keyword.test.ts`** (F12): a pre-existing isolation defect, reproduced on the baseline; fixed.
- **`m6-wo11-library` L01 in a single combined run** (after the browser and Studio integration suites had used the same
  database): it asserts that a global `"_"` search returns only its own Character, so earlier suites' Characters break
  it. The unchanged baseline fails identically on the same database. CI runs this suite on a fresh database, and so
  does the CI-equivalent run above, where it passes. Not a regression; recorded as an order dependence, not changed.

## 9. Publication

The work is committed on the branch and delivered as a verified git bundle. This session has no authenticated GitHub
access, so the owner pushes the branch and opens the PR with the commands in `RECOVERY.md`. Hosted CI then runs Tier 2,
the Windows jobs and the Prisma migrate / drift job; none of them is claimed here.

Stop point: nothing is merged and no M7 work has begun.

## 10. Reconciliation — 18 November 2026 (added by M7-WO1; the sections above are the historical record)

The text above describes the local candidate as it stood before publication; it is kept unchanged. Since then:

- The branch was published and merged as PR #77. The merge commit on `main` is
  `4714d085073b8452bf36d8005978f4d5127212c7` (tree `fa1ea3512bdfe89ad2eb358ef5726df58c263320`, the same tree as the
  reviewed candidate `96d892a`).
- Merged-main CI run #283 (`44237969975`) on that commit concluded **Success**, with 18 checks, including Tier 2, the
  Windows installer build and installed Windows verification.
- The "Publication blocked" status, C22 "Blocked" and the "pending hosted CI" rows above are therefore historical. They
  were true for the local checkpoint and are superseded by this merge and CI result.
- **Still open:**
  - the Mage Art decisions D1–D3 (§7);
  - the deferred DIST-WO1 standard-user Windows 11 manual lifecycle check, which a green Windows CI run does not
    replace.
