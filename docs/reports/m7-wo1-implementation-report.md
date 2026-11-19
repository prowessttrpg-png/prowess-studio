# M7-WO1 — Encounter Foundation & Roster: implementation report

**Branch:** `m7-wo1-encounter-foundation`, from `main` `4714d085073b8452bf36d8005978f4d5127212c7` (tree
`fa1ea3512bdfe89ad2eb358ef5726df58c263320`). Architecture and decision record:
`docs/architecture/m7-wo1-encounter-foundation.md`. Invariants: `docs/architecture/m7-invariants.md` (M7-I001–I012).

**Status: partially complete — ready for review locally, not published.** Every E01–E16 criterion that can run here is met
on the tested commit. E15 (hosted CI, Tier 2, both Windows jobs) is pending, because this session cannot push: the git
proxy refused the push with "repository not in this session's authorized repository set". The branch is delivered as a
verified git bundle (§7). Nothing is merged and no WO2 work has begun.****

## 1. Outcome in plain language

A GM can now open **Encounters** and do the following:

- create an encounter, name it and choose its exact published Release;
- add named sides;
- search for Characters, and add completed Characters from that Release to a side;
- move members between sides (or to "no side"), remove members, and rename or remove sides;
- read a readiness summary;
- save, leave, reopen and archive the encounter.

**What the server enforces:**

- **Release.** Only completed Characters built on the encounter's own Release can join. A Character on another Release
  is shown with an explanation, never silently converted.
- **History.** Every change is one atomic, versioned command with a recorded history entry.
- **Retries and conflicts.** A retried submission never applies twice, and a conflicting edit from another tab is
  refused, reloaded and explained.
- **Archive.** Archiving makes the encounter a read-only historical record.
- **Characters.** Nothing in this order changes a Character's resources, play state, Release, Active Magic or play
  history.

**What M7-WO1 does not do (by design):**

- start combat, roll initiative, run rounds or turns, spend resources or apply results;
- show an enabled "Start combat" control. The readiness panel states that combat arrives with M7-WO2.

**Remaining limitations:**

- Side order is creation order; there is no reordering.
- Characters have no archived state today, so none is checked (architecture §3 says where to add it).
- Hosted CI, including both Windows jobs, has not run for this branch yet (§7).

## 2. Changed files

| Area | Files |
| --- | --- |
| Schema and migration | `packages/prowess-db/prisma/schema.prisma` (marked `M7-WO1` block plus two marked back-relations); `prisma/migrations/20261118010000_m7_wo1_encounter_foundation/migration.sql` (additive: 4 tables; Prisma-generated DDL; CHECKs; 6 trigger functions) |
| Registries | `docs/architecture/m6-schema-changes.json`, `m6-api-routes.json` (`M7-WO1` entries), `scripts/ci/gates.json`, `.github/workflows/ci.yml` |
| Domain | `packages/prowess-model/src/errors.ts` (`ENCOUNTER_ERROR_CODES`); `packages/prowess-db/src/encounter/{repository,service,index}.ts`; `src/index.ts` exports |
| API | `apps/studio/app/api/encounters/**` (5 routes); `apps/studio/src/api/errors.ts` (status for every code) |
| Studio | `apps/studio/app/encounters/**` (list, new, workspace, client); `src/navigation.ts`; `app/globals.css`; `scripts/check-architecture.mjs` (encounter UI rule) |
| Distribution | `scripts/distribution/verify-m7-wo1-encounter-restore.mjs`, `scripts/playtest/m7-wo1-encounter-restore.ts`; `scripts/distribution/desktop/installed-smoke.mjs` (installed encounter persistence) |
| Tests | `apps/studio/tests/unit/m7-wo1-static.test.ts`, `m7-wo1-encounter-ui.test.tsx`; `apps/studio/tests/integration/m7-wo1-encounter-api.test.ts`; `packages/prowess-db/tests/integration/m7-wo1-encounter-foundation.test.ts`; `apps/studio/tests/e2e/m7-wo1-encounters.spec.ts`; `scripts/m7-wo1-negative-controls.mjs`; teardown helpers in both Character fixtures |
| Narrow gate amendments (each commented) | `m1-audit-static` (new error-code family), `m2-api-static` (encounters prefix), `m2-final-static` (`createEncounter`), `m5-wo3-static` and `m6-wo6-static` (registered later routes / marked schema), `entity-version-lifecycle` (export pin), `navigation.test` (Encounters entry), `ci-gate-inventory` (+1 gate, +10 controls) |
| Docs | `docs/architecture/m7-wo1-encounter-foundation.md`, `m7-invariants.{md,json}`, this report; a dated reconciliation section appended to `docs/reports/pre-m7-wo1-implementation-report.md` |

## 3. Acceptance matrix (E01–E16)

Tested commit: `3f6ff2e` (local). "Local" means run in this environment against disposable PostgreSQL 16 databases.

| ID | Required proof | Status | Evidence |
| --- | --- | --- | --- |
| E01 | Baseline, tree, PR #77 merge, exact-main CI; stale publication text reconciled | Met | Architecture §0: `origin/main` = `4714d08…`, tree `fa1ea35…`. PR #77 is merged (merge commit `4714d08…`). Run #283 (`44237969975`) on that commit: Success, 18 checks. The PRE-M7 report gained a dated reconciliation (§10); its history is unchanged. |
| E02 | Fresh and upgrade migrations; Prisma validation; schema drift | Met (local); hosted pending | **Validation:** `prisma validate` passes. **Fresh:** 31 migrations on an empty database, then drift: "No difference detected" (exit 0). **Upgrade:** a populated workspace (Release, 2 Characters, play runtime and events) at the 30-migration chain gets M7-WO1 applied; every pre-existing table is byte-identical (row-hash fingerprint), the 4 new tables are empty, and drift exits 0. **How drift ran here:** Prisma's native engine download is blocked by the egress policy, so drift ran on the **official Prisma WebAssembly schema engine** (`@prisma/schema-engine-wasm`, the CLI's exact engine commit) through the pg adapter. A negative control (a dropped index) returned exit 2. Migrations were applied as SQL (psql), as before. The hosted `db-api` job remains authoritative. |
| E03 | Browser creates an encounter with named sides and ≥ 2 compatible Characters, reopens intact | Met | e2e B01–B03; DB E03; API test 1 |
| E04 | Same-Release joins succeed; different-Release joins fail without changing either side | Met | DB E04 (Character and encounter fingerprints unchanged; database trigger and composite key also refuse); API refusals test; e2e B02 (explained, not offered) |
| E05 | Duplicate, incomplete, missing and lifecycle-ineligible Characters refused | Met | DB E05; API refusals test. DRAFT maps to `CHARACTER_NOT_ELIGIBLE`; there is no archived Character state (architecture §3). |
| E06 | Move / remove memberships and sides with server-side integrity, including forged cross-encounter ids | Met | DB E06 (all four forged-side paths plus forged memberships; composite FK at the database); API refusals test; UI and e2e B04 (an occupied side cannot be removed) |
| E07 | Conflicting edits never overwrite; retries never duplicate records or events | Met | DB E07 (concurrent: one transition; key replay; key conflict; concurrent retries; concurrent creates give one encounter); DB rollback test (a real failure injected at the event insert, after the version claim and the membership insert, leaves everything unchanged); UI test (same key on retry); e2e B04 (stale tab) |
| E08 | Reads, readiness and refused mutations write nothing | Met | DB E08 (table counts and fingerprints); API reads test |
| E09 | Roster operations leave Character resources, play state, Release, Active Magic and play events unchanged | Met | DB E09 (a Character with an active standalone combat stays byte-identical across add, move, rename, remove, metadata and archive); restore proof (source stage asserts the same) |
| E10 | Archived encounters keep inspectable history and reject edits | Met | DB E10 (service and database triggers: update, roster insert / delete, delete, event update all refused); API archived test; e2e B05 |
| E11 | Restart preserves encounter and memberships | Met (local) | Restore proof: a new process on the same database reads identically; DB E11 (new connection); e2e B03 (reload) |
| E12 | Workspace backup restores into an independent database identically | Met (local) | `verify-m7-wo1-encounter-restore.mjs`: the desktop backup format (every public table) restored into a fresh database. Encounters, memberships, Release references and Character rows are identical; the archived freeze and append-only history still hold. Evidence JSON in the package. |
| E13 | Standalone play, Compendium authoring, content packs and Character library regression gates green | Met (local) | §6 |
| E14 | Desktop and 390 px browser evidence of the complete flow and error states | Met | e2e B01–B06 with screenshots (field errors, ineligible explanations, occupied side, stale refusal, archived view; 390 px list, archived workspace, editable workspace and new form, all with 0 px overflow) |
| E15 | Required CI, Tier 2 and both Windows installer checks pass; installed verification exercises encounter persistence | **Pending (hosted)** | The installed smoke now creates an encounter on the demo Release, adds a side, confirms the draft sample Character is refused, and checks the encounter is identical after backup / restore and after restart. It runs only on the Windows CI job, which has not run for this branch. |
| E16 | PR, report, invariants, inventories and evidence complete; no merge, no WO2 | Met locally; the PR is not open (publication blocked, §7) | This report; invariants; registries; nothing merged; no WO2 code |

## 4. Migration and backup / restore evidence

- **Fresh.** A new disposable database gets all 31 migrations; the WebAssembly-engine drift check reports "No difference
  detected" (exit 0).
- **Upgrade.** A populated workspace (23 Releases, 16 Characters and their sheets / play rows) at the 30-migration
  pre-M7 chain gets `20261118010000_m7_wo1_encounter_foundation`. A row-hash fingerprint of every pre-existing table is
  identical before and after (0 tables changed), the four new tables are empty, and drift exits 0.
- **Drift control.** Dropping one index makes the same check report the difference and exit 2.
- **Restart and restore** (`verify-m7-wo1-encounter-restore.mjs`, 29 s):
  - the source has 2 encounters (one archived), 3 memberships and 8 events;
  - a new process on the same database reads identically;
  - the desktop workspace backup restored into an independent database reads identically: encounter views, memberships,
    the Release reference and every Character-owned row;
  - the archived freeze and append-only history are enforced after the restore.
- **Desktop backup coverage.** Automatic: `stage-prototype.mjs` derives the backup table list from the migrations, and
  the restore proof asserts that all four encounter tables are in it.

## 5. Desktop and narrow-screen evidence

Screenshots from the e2e run on the tested commit, against the production build:

- `b01-new-encounter`: field errors, then the Release choice;
- `b02-prepared-desktop`: two sides, two participants, readiness PREPARED with the standalone-combat warning, DRAFT and
  other-Release candidates explained;
- `b03-list`;
- `b04-stale-refused`;
- `b05-archived`;
- `b06-list-390`, `b06-workspace-390`, `b06-editable-390`.

## 6. Verification (local, on the tested commit)

| Check | Result |
| --- | --- |
| `pnpm lint`, `pnpm typecheck`, `scripts/check-architecture.mjs` (14 rules) | pass |
| Gate inventory | consistent: 9 suites, 47 gates, 746 controls |
| `@prowess/game` unit | 1837 pass (unchanged package) |
| `@prowess/rules` unit | 659 pass (M4 unchanged) |
| `@prowess/model` / `import` / `ui` unit | 513 / 128 / 21 pass |
| `@prowess/db` unit | 179 pass |
| Studio unit | 115 files / 3831 pass (includes `m7-wo1-static`, `m7-wo1-encounter-ui`) |
| `@prowess/db` integration, CI-equivalent (2 shards, each on a freshly migrated disposable database) | 308 + 346 = 654 pass (includes `m7-wo1-encounter-foundation`, 10) |
| Studio integration | 41 files / 247 pass (includes `m7-wo1-encounter-api`, 5) |
| Playwright, full suite against the production build | 100 / 100 pass (20.1 min), including B01–B06 |
| M7-WO1 negative controls | 10 / 10 caught and restored |
| PRE-M7-WO1 negative controls (regression) | 13 / 13 caught and restored |
| `prisma validate` | pass |
| Fresh / upgrade migrations and drift | pass (§4) |
| Restart and whole-workspace restore | pass (§4) |
| Hosted CI (Tier 2, Windows installer, installed verification) | **pending** — not run (branch not pushed) |

**Which commit each check ran on.**

- On `3f6ff2e`: typecheck, both integration suites, Playwright, both control sets, the restore proof and the migration
  checks.
- On the same tree minus `3f6ff2e`'s two changes: lint, architecture and the unit suites. Those changes are a one-line
  type fix in the e2e spec and this report; neither is read by a unit suite.

**Why typecheck ran twice.** Its first run failed on that e2e type error. The error was fixed in `3f6ff2e`, and typecheck
then passed.

## 7. Publication and CI

- **Blocked.** `git push` was refused by the session's git proxy: "prowessttrpg-png/prowess-studio is not in this
  session's authorized repository set". No credentials were requested.
- **Delivered instead.** A verified git bundle (the branch and `main`), with recovery and push / PR commands, is
  delivered to the owner. A fresh clone recovered the exact HEAD and tree.
- **To publish.** Add the repository to the session's sources, or push from the owner's machine. Then open the PR and
  let CI run, including Tier 2, the Windows installer build and the installed verification, which now exercises encounter
  persistence (E15). Do not merge under this assignment.

## 8. WO2 readiness note

WO1 fixes the ownership WO2 builds on. The encounter owns roster and lifecycle, and the Character sheet play state
stays the only resource authority. Before enabling "Start combat", WO2 must:

1. add encounter combat state on the encounter (never on memberships);
2. give each Character at most one active encounter, enforced in the database and checked by every Character play
   mutation path listed in architecture §2;
3. define the hand-off from a running standalone combat (refuse or explicitly transfer; never reset);
4. commit encounter timing atomically across every affected participant's play-state and runtime versions, with one
   encounter event plus each Character's play event;
5. implement side initiative and shared side phases through the existing engine timing.

The open rule questions do not block WO1. Each must be rechecked before the order that depends on it:

- Mage Art D1–D3 (WO9);
- M5-SC-052 and M5-SC-053 (Active Magic, WO6);
- later Concentration rulings (governed content changes only).
