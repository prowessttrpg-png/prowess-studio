# M6-WO11 — Character Library / Save / Load implementation report

Status: complete local implementation and local verification on branch `m6-wo11`. **Not certified.** WO11 is final only after its published tree passes the complete required GitHub Actions workflow (Tier 2) in a same-commit run and the merged-main run; both need separate authorization. Nothing was pushed, no PR was opened, nothing was merged, and `main` is untouched.

Architecture: `docs/architecture/m6-character-library.md`. Invariants: M6-I173 – M6-I179.

## 1. Baseline

| Item | Value |
| --- | --- |
| Base commit (`main`) | `bacdc776304ca5061358735629c20653609e0840` — "Merge pull request #72 from prowessttrpg-png/m6-wo10" (fetched from GitHub and verified) |
| Base source tree | `aacff0066de143da01ed3d02679aa4c74d576bbc` (identical to the WO10 fix commit `16486aa`, which is its ancestor; includes the merged WO3 mutation-anchor fix) |
| Baseline evidence | WO10 PR #72; merged-main CI #265, 16/16 including Tier 2 (as provided) |
| Branch | `m6-wo11`, created from the base (no earlier WO11 branch existed); local tag `m6-wo11-baseline` |
| Checkpoint | the `m6-wo11` commit containing this report; its SHA, tree and bundle checksum are in the delivery note (a commit cannot contain its own SHA) |

## 2. Inventory: what already persisted, the gaps, and the smallest changes

| Area | Already persisted / correct | Reproducible gap | Change |
| --- | --- | --- | --- |
| Library list | `GET /api/characters` (page, pageSize), count + page queries, `updatedAt desc, id asc` | The index requested one page of 50 and offered no paging, so row 51+ was unreachable. No search or status filter. Only a name link | Optional `q` / `status` (one shared predicate, before pagination); paging, search and status UI; status actions; short id; latest-response guard |
| Search | — | Prisma `contains` does NOT escape `%` / `_`. Found by the WO11 DB test: a search for `%` matched 50 rows | `literalLikeText` escapes `\`, `%` and `_` |
| Creation draft save | WO3 explicit Save & Continue with `lockVersion` | The two-write save (profile, then choices) did not adopt the profile acknowledgement, so after a failed second write every retry was stale. Edits made during a save were overwritten. A lost response was reported as a failure. A double click could submit twice. No leave warning | Adopt each acknowledged write; partial message and retry of only the rest; read-and-compare for unknown outcomes; one save at a time; snapshot-based dirty tracking; `beforeunload` and in-app link guard |
| Draft resume | Choices persisted | Reopening always started at Concept | `continuationStep` from the saved choices and the server's validation (fallback: no saved choice → Concept) |
| Character switch | Sheet / Create / Play pages are keyed by `characterId` | (no defect reproduced) | Additional id guard in the wizard; keys pinned by the gate |
| Sheet, loadout, abilities, cards | WO4–WO9 services; write-free reads | None | Proven end to end (DB and browser) |
| Play resume | WO10 runtime, ledger, versions, idempotency | None | Proven end to end (DB and browser) |

There is no schema change, migration, new route or new `@prowess/db` export. `docs/architecture/m6-api-routes.json` and `m6-schema-changes.json` are unchanged because no route or schema was added. The existing `GET /api/characters` gained two optional, backward-compatible query parameters (documented in the route and in the architecture note). No `@prowess/game` file changed, so the approved-M5-changes registry is unchanged.

## 3. API change

`GET /api/characters`:

- **`q`.** Case-insensitive literal name text. Trimmed; an empty or whitespace-only `q` means no filter. At most 120 characters; accepted once.
- **`status`.** `ALL` | `DRAFT` | `CORE_COMPLETE`, default `ALL`; accepted once.
- **Refusals.** Any other key, a repeat, an invalid status or an over-long `q` → 400 `API.INVALID_QUERY`. The service re-validates the same rules as `CHARACTER.INVALID_INPUT`.
- **Old contract.** Without `q` / `status` the request and response are exactly the WO3 contract, and the existing typed client call `listCharacters()` is unchanged.

## 4. Failure and recovery behaviour

See the architecture note, §5. In summary:

- **Partial save.** A failure in the second write keeps the first write (storage holds the new profile and the old choices) and retries only the choices at the acknowledged version.
- **Stale second tab.** Gets a 409 with an explicit reload; there is no automatic retry.
- **Lost play response.** Retried with the same key and body; WO10 replays the original event, so exactly one payment and one event exist.
- **Lost edit response.** The client reads the Character and compares before reporting anything.
- **Late response for another Character.** Ignored.

## 5. Acceptance manifest

| ID | Layer | Test |
| --- | --- | --- |
| L01 | DB | `m6-wo11-library.test.ts` "M6-I173 L01 …": 56 tagged Characters (51 Drafts, 2 complete, `%`, `_`, `\` names); search and paging at page sizes 7 / 10 / 20 / 50; filtered totals; last page and past-the-end; ten tied timestamps ordered by id; literal punctuation; whitespace search; empty result; invalid filter. Plus API: `m6-wo11-library-api.test.ts` and UI: `m6-wo11-library-ui.test.tsx` (paging and reset) |
| L02 | Browser | `m6-library.spec.ts` "L02": two "Twin" Characters, same Level and Release, different loadouts; told apart by id; each Sheet shows its own |
| L03 | Browser | "L03": draft via New Character, explicit save (Ancestry), an unsaved point, new context → Continue creation opens at Stats with the saved choices and without the unsaved point → completed through the UI → Library actions change. Plus UI: continuation unit test |
| L04 | Browser + DB | "L04": Library → Open sheet → exact equipped weapon, Attack rows, Spell, Maneuver at r1 → Spell Card. DB: exact Attack, ability ids, DRAFT spell stays DRAFT, Cards on the same ids |
| L05 | Browser + DB | "L05": timing, paid Move, 5 ft movement, Sustained Spell ACTIVE as Active Magic; Resume play in two fresh contexts → identical versions (6 / play-state), AP, MP, allowance, 6 events, ACTIVE effect; DB rows byte-identical. DB: the same, plus versions and runtime 6 |
| L06 | DB + API | Byte-level fingerprint of all 18 Character tables (plus Release / Version counts) unchanged across Library, Character, Sheet, Weapons, Attacks, Abilities, Cards, Play and Events reads — opened twice — including a Character never in play. API: counts and per-Character `lockVersion` / `updatedAt` unchanged |
| L07 | Browser + API + UI | Browser "L07": tab A saves, stale tab B is refused, A's value survives, B reloads explicitly. API: 409 `CHARACTER.STALE_WRITE` keeps A's concept. UI: Library out-of-order responses; wizard A → B with A resolving late |
| L08 | DB + UI | DB: profile acknowledged at v+1, choices at the old version refused (byte-identical storage), retry at v+1 saves the choices, reopen shows both. UI: injected second-write failure → partial message, retry sends only the choices at version 3 |
| L09 | DB | Move accepted; identical request with the same key → `replayed`, same event id, one event, AP spent once; same key with a different body → `CHARACTER.PLAY_IDEMPOTENCY_CONFLICT` |
| L10 | DB | Characters written with the existing services; a newer Release (revised Ancestry) is published; the Draft and the completed Character, their Sheet and Library rows keep Release 1 byte-for-byte; unknown id → `NOT_FOUND`; a corrupted play reference → `PLAY_STATE_UNREADABLE` with no write |
| L11 | API + UI + Browser | API: WO3 shape, default page size 25, filters, punctuation, whitespace, 8 invalid query forms → 400. UI: the old client call, empty library vs no matches, failure and retry, labelled native controls. Browser: Sheet / Cards / Play deep links in L02–L05; the full Playwright suite (Sheet, Cards, print, Play) re-run |
| L12 | Controls | `scripts/m6-wo11-negative-controls.mjs` (25), including filter-after-pagination (01), a load that writes an event (11), stale responses that win (13, 14) and save success after a failed write (15); plus the legacy controls listed in §7 |

## 6. Permanent protection

- **Invariants.** M6-I173 – M6-I179 (7 rows), each mapped to the DB, API, UI and browser tests above, the static gate and the mutation script.
- **Static gate.** `apps/studio/tests/unit/m6-wo11-static.test.ts` (7 tests, prefix `W11-`).
- **Tests added.** DB `m6-wo11-library.test.ts` (4), API `m6-wo11-library-api.test.ts` (3), UI `m6-wo11-library-ui.test.tsx` (10), static (7), browser `m6-library.spec.ts` (5).
- **CI.**
  - `scripts/ci/gates.json` gate `M6-WO11`: controls-2, tiers [2, 3]. Tests: the DB WO11 and WO3 Character suites, the WO11 static and UI suites, the WO3 Character UI suite and the WO11 API suite.
  - A `.github/workflows/ci.yml` step (`PROWESS_EXPECT_CONTROLS=25`).
  - `ci-gate-inventory.test.ts`: 43 gates, 694 controls (669 + 25) across 25 scripts.
  - The browser spec runs in the existing Playwright job.
- **Historical assertions changed.** None. All 669 historical controls are preserved, including WO10's 52 and the merged WO3 anchor fix. The WO3 Character UI test still pins the index link, the table name and the "Reload the Character" button; the WO11 wizard keeps that label.

## 7. Local verification

Everything below ran locally on this branch (2-CPU sandbox, PostgreSQL 16). Each integration suite ran on a freshly created database that was migrated from all 29 baseline migrations.

| Command | Result |
| --- | --- |
| `pnpm lint` / `pnpm typecheck` / `pnpm run test:architecture` | pass / pass / 13 import-boundary rules, 7 packages, no violations (final tree) |
| `node scripts/ci/gate-inventory.mjs` / control-harness self-test | 9 suites, 43 gates, 694 controls, 14 checks; every legacy item represented / 8 scenarios as required |
| Game unit (`@prowess/game`) | 57 files, 1821 tests passed (no game file changed) |
| DB unit (`@prowess/db`) | 22 files, 164 tests passed |
| Studio unit + static (`@prowess/studio`) | 106 files, 3706 tests passed (final tree). In one earlier full run, the historical `m3-final-static` git-history scan timed out at 5 s under load; it passed alone (31/31) and in both later full runs |
| DB integration shard 1/2, fresh database | 31 files, 293 tests passed |
| DB integration shard 2/2, fresh database | 31 files, 338 tests passed (includes `m6-wo11-library.test.ts`, 4 tests) |
| Studio API integration, fresh database | 40 files, 242 tests passed (includes `m6-wo11-library-api.test.ts`, 3 tests) |
| Playwright, production build, fresh database | 86 / 86 passed, including `m6-library.spec.ts` (5 journeys in genuinely new browser contexts), Sheet, Cards, print and Play |
| M6-WO11 controls | 25 / 25 caught and restored (9 baseline + 25 mutation guard runs; tree unchanged) |
| M6-WO3 / WO4 / WO5 / WO10 controls | 28 / 28, 37 / 37, 33 / 33, 52 / 52 (WO3 includes the merged anchor fix) |
| Prisma validate | valid (offline schema-engine stand-in) |

**Substitutions and unexecuted commands.** `prisma generate` with a real engine, `prisma migrate deploy`, `prisma migrate status` and drift (`migrate diff`) could not run here: the engine download from binaries.prisma.sh is refused with 403 Forbidden (re-tried this session). The substitutes:

- validation ran with an offline engine stand-in;
- every migration was applied with `psql` and recorded in `_prisma_migrations` with its checksum;
- WO11 changes no Prisma schema or migration (`git diff bacdc77 -- packages/prowess-db/prisma` is empty), so there is nothing to drift.

CI runs the real commands. The remaining historical control scripts (M4, M5-WO1–WO13, M6-WO1, WO2, WO6–WO9) were not re-run locally: none of their anchored files changed, so their CI steps are the check. No result above is inferred.

**Found and fixed during verification:**

1. **Literal search.** Prisma's `contains` does not escape `%` or `_` (WO11 DB test). Fixed with `literalLikeText`.
2. **Action-link names.** The full Playwright run showed that the historical WO3 creation test selects a row's Character link by name, and the WO11 action links (accessible names "Open sheet: &lt;name&gt; …") matched it as well. The actions are now named by their action and described by their row (`aria-describedby`), so no historical test changed.
3. **Double-submission control.** WO11 control 19 (remove the double-submission guard) was not caught at first, because separate clicks let React disable the button in between. The test now clicks twice within one React batch, and the control is caught.

## 8. Residual limitations

- **Search scope and URL state.** Search is name-only, and Library filters are not kept in the URL (a reload returns to page 1).
- **"Record updated" timestamp.** It is the Character record's time. Sheet, play and ability activity do not move it, by design: opening must not reorder the Library, and adding activity tracking would be new storage.
- **Leave guard coverage.** It covers link clicks and `beforeunload`, not programmatic navigation.
- **Two creation endpoints remain.** Creation keeps WO3's two endpoints; the declared behaviour is partial-save retention, not a new atomic write.
- **Browser fixtures.** The browser journeys create their Release and configured Characters through the approved `@prowess/db` PostgreSQL test fixtures (test-only keys). A small worker-only JSON loader (`tests/e2e/m6-wo11-fixture-loader.ts`) lets those fixtures import the `@prowess/game` test worlds; no application loader changed.

## 9. Checkpoint

The checkpoint is the `m6-wo11` commit that contains this report. Its SHA, source tree, commit count, clean status, recovery bundle filename, size and SHA-256 are recorded in the delivery note outside this commit, and in the Project record `claude/m6-wo11-checkpoint.md`. The bundle is self-contained (all history to `m6-wo11` plus the `m6-wo11-baseline` tag). It was verified by cloning into an empty directory and checking the branch, the baseline ancestry, the exact HEAD and the tree.

Stopped for publication review: no push, PR or merge.
