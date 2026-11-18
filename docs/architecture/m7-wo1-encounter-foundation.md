# M7-WO1 — Encounter Foundation & Roster

Status: implemented on branch `m7-wo1-encounter-foundation` from `main` `4714d085073b8452bf36d8005978f4d5127212c7`. **Not
certified.** M7-WO1 becomes final only after its published tree passes the complete required GitHub Actions workflow in a
same-commit run, and through the owner's review.

Invariants: M7-I001 – M7-I012 (`docs/architecture/m7-invariants.md`). Gate: `M7-WO1`. Report:
`docs/reports/m7-wo1-implementation-report.md`.

## 0. Verified starting point (E01)

| Record | Value | How it was verified |
| --- | --- | --- |
| PR | #77 merged on 18 Nov 2026 | GitHub PR page: merge commit `4714d08…` |
| Baseline `main` | `4714d085073b8452bf36d8005978f4d5127212c7` | `git fetch origin main`; `origin/main` resolved to it (no later commit) |
| Tree | `fa1ea3512bdfe89ad2eb358ef5726df58c263320` | `git rev-parse origin/main^{tree}`; identical to the PRE-M7-WO1 review candidate's tree |
| Merged-main CI | Run #283 (`44237969975`) on `4714d08…`, conclusion Success | GitHub Actions run page. The page listed 16 jobs with durations and an overall Success; database shards 1/2 and 2/2 appear in its annotations, for 18 checks in all, matching the PR's "18 checks passed". Per-job conclusions were not shown individually. |
| DIST-WO2 predecessor | `16ee5c61edf57efc27af751c68aec681e6fd6c48` | ancestor of the baseline |

The PRE-M7-WO1 implementation report described a local, unpublished checkpoint. It now carries a dated reconciliation
section; its historical text is unchanged.

A green workflow verifies the checks that ran. It does not make Mage Art reference content executable, and it does not
settle the canon questions listed in §7. The DIST-WO1 standard-user Windows 11 manual lifecycle check stays deferred.

## 1. Decision record (ADR-M7-WO1)

**Context.** M7 needs a persistent place where a GM assembles participants and sides before combat. The existing M6
runtime is per Character: `character_resource_states` (the one resource authority, via the sheet play state) and
`character_play_runtimes` / `character_play_events` (standalone combat timing, Movement Allowance, reserved MP, Active
Magic, append-only ledger).

**Decision.**

1. **A new, minimal encounter aggregate** with four tables: `encounters`, `encounter_sides`, `encounter_participants`,
   `encounter_events`. It is workspace state, not published rules content, so it is never part of a content pack.
2. **One exact Release per encounter** (`encounters.ruleset_release_id`, immutable by trigger). This is a conservative
   software boundary for WO1, not a Prowess game rule. A Character joins only when its own `ruleset_release_id` is
   *identical*: never by name, payload resemblance or content-pack receipt. This is checked by the service on every
   command and every readiness read, and by the database (composite key plus trigger).
3. **A membership is a reference.** `encounter_participants` stores `(encounter, release, character, side?)` and nothing
   else: no HP, AP, MP, ME, Counter Actions, Active Magic or initiative, and no lock on the Character. A Character may
   belong to several preparation drafts.
4. **Every command is one transaction** under a compare-and-set of the encounter row on
   `(id, lock_version, status = PREPARATION)`, with one append-only event. This compare-and-set is the single serialization
   point. Idempotency keys are globally unique, so a retried *create* (before an id exists) also replays.
5. **Archived is terminal and read-only.** Database triggers refuse updates to an archived encounter and roster rows
   that would change it. A whole-workspace restore re-inserts them under the existing transfer setting. Encounters are
   never deleted.
6. **Readiness is derived on read.** It is never stored and never an input. It reports blocking items and warnings,
   and always says combat is unavailable in WO1.

**Consequences.** WO2 adds combat state to the encounter, not to the participant rows. The resource authority does not
move. Roster editing cannot alter a Character: the encounter service holds no write path to any Character table.

## 2. Ownership map (recorded from the current code)

| State | Owner (only writer) | Concurrency | History |
| --- | --- | --- | --- |
| Current HP / MP / ME / AP / Counter Actions | `character_resource_states`, through the sheet play state (`sheet-repository.writePlayState`, `writePlayStateWithin`) | `character_play_states.lock_version` | play ledger, for play commits |
| Standalone combat timing, Movement Allowance, reserved MP, Active Magic | `character_play_runtimes.state` (`play-repository.commitPlayOperation`) | `character_play_runtimes.lock_version` | `character_play_events` (append-only) |
| Character identity, Level, exact Release | `characters` (creation and advancement services) | `characters.lock_version` | `character_advancements` (append-only) |
| Signature Spells / Maneuvers | `character_signature_*` (builder services) | per ability | append-only revisions |
| Encounter, sides, memberships | `encounters` / `encounter_sides` / `encounter_participants` (`encounter/repository.applyEncounterCommand`, `insertEncounter`) | `encounters.lock_version` | `encounter_events` (append-only) |

### Routes that can mutate a Character's play-relevant state (for WO2 coordination)

- `PUT /api/characters/:id/play-state`: sheet resource values (manual).
- `POST /api/characters/:id/play/operations`: the play engine (resources, runtime, ledger).
- `POST /api/characters/:id/advance`: Level, and so resource maxima; the play runtime then requires `RECONCILE`.
- `POST /api/characters/:id/spells/*` and `/maneuvers/*` (draft, finalize, rebuild, retire): the abilities the play
  workspace offers.
- `POST /api/characters/:id/weapon-loadout`: the Attacks the play workspace offers.
- `POST /api/characters/:id/creation`, `/finalize`, `/profile`, `/notes`, `/portrait*`: creation and presentation only.

No encounter route calls any of these, and WO1 changes none of them.

## 3. Data contract (version 1)

| Capability | Where |
| --- | --- |
| Stable identity | `encounters.id` (uuid) |
| Name, optional notes | `name` (1–120, trimmed), `notes` (≤ 4000) |
| Exact Release | `ruleset_release_id` (FK, immutable) |
| Status | `PREPARATION` or `ARCHIVED`, plus `archived_at` (CHECK keeps them consistent) |
| Sides | `encounter_sides(id, encounter_id, name 1–80, ordinal)`: `(id, encounter_id)` unique; ordinal allocated once |
| Memberships | `encounter_participants(id, encounter_id, ruleset_release_id, side_id?, character_id)`: unique `(encounter_id, character_id)`; `(encounter_id, ruleset_release_id)` → encounter; `(side_id, encounter_id)` → side (so a cross-encounter side is impossible); trigger requires the Character's own Release |
| Concurrency | `lock_version`, server-managed; every command compare-and-sets it |
| History | `encounter_events(sequence, idempotency_key (globally unique), request_hash, kind, summary, encounter_version, record)`: append-only |

Commands are closed shapes: `UPDATE_METADATA`, `ADD_SIDE`, `RENAME_SIDE`, `REMOVE_SIDE`, `ADD_PARTICIPANT`,
`MOVE_PARTICIPANT`, `REMOVE_PARTICIPANT` and `ARCHIVE`. An unknown kind or field, a derived value (for example
`readiness`), a non-integer version or a non-UUID key is refused before anything is read. A side with members cannot
be removed (`SIDE_NOT_EMPTY`); the user moves or removes its members first, each as a recorded change.

**Character lifecycle mapping.** The Character domain has two states: `DRAFT` (core creation incomplete) and
`CORE_COMPLETE`. Only `CORE_COMPLETE` is eligible. A DRAFT is refused with `CHARACTER_NOT_ELIGIBLE`. An unknown id is
refused with `CHARACTER_NOT_FOUND`, a different Release with `CHARACTER_RELEASE_MISMATCH`, and a second membership with
`DUPLICATE_PARTICIPANT`. Characters have no archived or retired state today. If one is added, the eligibility check in
`commandEncounter` and the readiness derivation are the two places to extend.

**Readiness.** It is derived on every read:

- **blocking:** `NO_SIDES`, `EMPTY_ROSTER`, `UNASSIGNED_PARTICIPANT`, `PARTICIPANT_RELEASE_MISMATCH`,
  `PARTICIPANT_NOT_COMPLETE`, `PARTICIPANT_PLAY_STATE_UNSUPPORTED` (the stored play state cannot be read) and
  `RELEASE_INTEGRITY_FAILED`;
- **warnings:** `EMPTY_SIDE` and `STANDALONE_COMBAT_ACTIVE`.

No minimum number of sides or players is invented. `combat.available` is always `false` in WO1.

## 4. API

| Route | Body / query | Result |
| --- | --- | --- |
| `GET /api/encounters` | `page`, `pageSize`, `q?`, `status?` (ALL / PREPARATION / ARCHIVED) | list rows |
| `POST /api/encounters` | `{ name, notes?, rulesetReleaseId, idempotencyKey }` | `{ committed, replayed, event, encounter }` (201, or 200 on replay) |
| `GET /api/encounters/:id` | — | the encounter, sides, memberships, readiness and recent events |
| `POST /api/encounters/:id/commands` | `{ command, expectedVersion, idempotencyKey }` | `{ committed, replayed, event, encounter }` |
| `GET /api/encounters/:id/characters` | `q?` | candidates with the server's eligibility and reason |
| `GET /api/encounters/:id/events` | `before?`, `limit?` | history, newest first |

The routes use strict bodies and queries and are registered under `M7-WO1` in `m6-api-routes.json`. Errors use the
`ENCOUNTER.*` codes in `@prowess/model`, mapped in `apps/studio/src/api/errors.ts`.

## 5. Studio

- **Navigation.** The primary **Encounters** entry leads to `/encounters`, the list with search, status filter and paging.
- **New encounter.** `/encounters/new` takes a name and notes, then an explicit Ruleset and Release (no preselection).
- **Workspace.** `/encounters/:id` shows:
  - the readiness panel (live region), with "Start combat — not available yet" stated as text, never as a control;
  - details (name and notes), with unsaved-change protection;
  - sides as cards, with rename, remove (disabled with an explanation while occupied), and move or remove for each
    member;
  - an "Not assigned to a side" group;
  - Character search with the server's eligibility and reasons, including a Release mismatch explained in words;
  - history;
  - archive (with confirmation).
- **Links.** Each participant links to its Character sheet and cards, and the Release links to the Rules Reference and
  its topic sections. No editor is duplicated.
- **Submissions.** Each one carries the version it was prepared against and a per-submission key. A lost response is
  retried with the same key. A stale or archived refusal reloads the encounter and explains.

## 6. WO2 boundary (designed, not implemented)

- **Ownership of progression.** WO2 adds encounter combat state: phase, round, side order and current side, kept on the
  encounter (new columns or a 1:1 `encounter_combats` row). It is never kept on the membership rows and never copies
  resources.
- **Standalone timing.** Starting an encounter's combat must refuse, or explicitly hand off, any participant whose
  standalone runtime has `combat.active = true`. It must not reset or end that runtime silently. During encounter
  combat, the standalone `TIMING` operations for that Character are refused by the play service. This is a guard
  added to the play commit path, checked inside the same transaction.
- **One active encounter per Character.** A Character is in at most one *active* encounter. This is enforced by a
  partial unique index on an active-combat membership table, plus a check in every Character play mutation path listed
  in §2. That makes it impossible for two encounters to drive the same Character.
- **Atomicity across participants.** An encounter timing or resolution step compare-and-sets the encounter version and
  each affected Character's play-state and runtime versions in one transaction, and appends one encounter event plus
  each Character's play event. Any miss aborts everything.
- **End of combat and pending decisions.** Pending inputs stay unpersisted, as in WO10. Ending combat closes the
  encounter combat state and runs each participant's authored end-of-combat timing through the existing engine path.
  Nothing outside the engine is invented.

## 7. Rule questions carried forward (not WO1 blockers)

- **Mage Art D1–D3.** Cost shape, structured effects, and activation / Signature investment. These must be decided
  before WO9 enables play.
- **M5-SC-052** (Mana Lock amount) and **M5-SC-053** (Channel-completion MP). Both were open at WO10, and the canon
  registry must be rechecked before any dependent action is enabled.
- **Designer rulings that differ from the shipped Release** (for example Concentration changes). These go through
  governed content and contract changes, and never alter historical Releases.

## 8. Limitations

- There is no combat, initiative, round, turn, targeting, cost or damage. Preparation only.
- Sides have no stored order beyond creation order, and no reordering. Nothing depends on it in WO1.
- Characters have no archived state, so none is checked (see §3).
