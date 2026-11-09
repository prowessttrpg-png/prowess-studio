# M6-WO12 — First Complete Playtest Vertical Slice

Status: implemented on local branch `m6-wo12` from certified `main` `923ed7c039ff344a8f5644cfb8e432179512121e` (WO11 PR #73; merged-main CI #267). **Not certified.** WO12 becomes final only after its published tree passes the complete required GitHub Actions workflow (Tier 2, including the new browser-evidence step) in a same-commit run, which needs separate authorization.

Result label: **playtest verified on an isolated Release.** Nothing in this work order touches a canonical Release or shared canonical game content (see §8).

Invariants: M6-I180 – M6-I189 (`docs/architecture/m6-invariants.md`). Gate: `M6-WO12` (controls-2) plus the `M6-WO12-BROWSER-EVIDENCE` check in the e2e job. Tester walkthrough: `docs/playtest/m6-wo12-tester-walkthrough.md`. Report: `docs/reports/m6-wo12-implementation-report.md`.

## 1. Purpose

WO1–WO11 each proved one capability. WO12 proves they connect: one designer change flows through review and publication into one exact Release, and one player-created Character on that Release builds, equips, inspects, plays, pauses, resumes and finishes a short combat with the same two abilities throughout. The identities that carry the journey are:

| Identity | Created by | Carried through |
| --- | --- | --- |
| Ruleset `M6-WO12 Playtest <run>` | the preparation command | every step |
| Release 2 (`R2`) | the designer and the reviewer, in Studio (V01) | Rules Reference, creation, both builders, Sheet, Cards, play |
| Revision 2 of the maintenance Effect (4 → 3 MP) | Compendium Admin (V01) | the Spell's price (V06), its cost inspector (V09) and the cast (V10) |
| The Character | the Library and creation wizard (V03) | V04–V12 |
| The Long Blade "Slash" Attack | the loadout (V05) | the Maneuver (V07), the damage inspector (V09) and the play attack (V10) |
| The Spell and the Maneuver ids | the real builders (V06, V07) | Sheet, Cards and print (V08), play (V10–V12) |

## 2. The journey (V01–V12)

`apps/studio/tests/e2e/m6-playtest.spec.ts` is one named, serial journey through the real Studio UI, the production build and PostgreSQL. It runs twice; each run prepares a new world and uses fresh browser contexts.

| Step | What a person does | What is checked |
| --- | --- | --- |
| V01 | Compendium Admin → Create New Revision of the maintenance Effect → change its authored cost (4 → 3 MP) and name → Save Draft → Submit for review → Propose to the Ruleset → Canon Manager: **Approve revision r2** (WO12 gap fix) → Submit for Review → Approve → Releases: publish R2 from Release 1's Manifest with the ChangeSet | R2 is Release 2 of the Ruleset and its Manifest pins exactly the new revision |
| V02 | Rules Reference → the Ruleset → View Latest Release → the revised entry → a Weapon's structured reference → Release 1's entry → compare R1 and R2 | exact Release URL, "Pinned Revision 2", a reference resolved inside R2, R1 still Revision 1, "1 changed revision"; no write request; fingerprint unchanged |
| V03 | Library → New Character on R2 → Ancestry saved → leave; a fresh session → Continue creation → Stats, Skills, Affinity → Complete Core Creation | the Draft resumes at Stats with nothing spent; the Character is complete and pinned to R2 |
| V04 | Advancement tab → Advance to Level 2 (+1 PER) → Abilities | access shows Trained; history; Signature capacity 0 / 4. A component whose prerequisite the Character does not meet is shown locked with its reason (checked in V06) |
| V05 | Sheet → loadout → Long Blade, one-handed | the exact Weapon revision is equipped; the Slash Attack row (2 AP) |
| V06 | Abilities → New Signature Spell → Arcane Authority, Self, the revised Effect, Sustained → Finalize | 3 MP (R2's price), Active Revision 1; every component link is R2's revision |
| V07 | New Signature Maneuver → Add the Long Blade Slash Action → Effect → Duration → Finalize | the real builder and backend; 2 AP / 5 MP; Revision 1 on R2 |
| V08 | Sheet, Card Library, Card print | no write request; fingerprint unchanged |
| V09 | Attacks → Inspect damage on Slash; Spell → Inspect cost; Rules Inspector → exact R2 → evaluate the ward payment | the Weapon revision, the server's damage steps and expression; the Effect link is R2's entry at revision 2; Inspector ME/MP balances match the subsequent committed Spell event; no write; fingerprint unchanged |
| V10 | Play: Begin combat → Start round → Start turn → Move (preview, then commit) → 5 ft movement → the Slash Attack (raw d4 face 3, GM Dodge 3) → End turn / round → Start round / turn → cast the Spell | preview spends nothing and advances no version; AP / MP / ME per operation; the authorised damage is the inspected expression and NOT APPLIED; the ward is ACTIVE Active Magic; event ids recorded |
| V11 | Close mid-turn with the ward held; open the Library twice in fresh sessions → Resume play | identical versions, resources, events and Active Magic both times; no write; fingerprint unchanged |
| V12 | Continue: the Maneuver (its Attack Roll asked for, then answered with a raw face) → end turn / round → next turn → Pay Sustain upkeep → Dismiss → end turn / round / combat | nothing paid while input is missing; maintenance and dismissal recorded; the UI history equals the ledger (sequences 1…N, every event on R2, final runtime version = last event's) |

The journey never fulfils a route, never runs a fake server, never writes a Character row, never pre-finalizes a build and never substitutes a result. Evidence reads (fingerprints, the event ledger) go to PostgreSQL directly and are compared around the read-only steps.

### Evidence

The journey writes `apps/studio/test-results/m6-wo12-evidence.json`: the commit SHA, the step list and, per run, the prepared world and one row per step with its evidence (ids, versions, prices, resources, raw dice, results, fingerprints). The local evidence of this checkpoint is reproduced in the report.

## 3. Failure cases (separate spec)

`apps/studio/tests/e2e/m6-playtest-failures.spec.ts` sets up its own world with the approved test fixtures and exercises:

| Case | Proven |
| --- | --- |
| F1 a newer Release | Library, Spell price (4 MP, not the newer 2 MP), component links and the play price stay on Release 1; New Character lists both Releases and preselects neither |
| F2 draft / invalid / retired abilities | none is offered for play; a direct commit of a draft, a retired ability or a substituted revision number is refused in words; nothing written |
| F3 timing, rolls, resources | outside the turn every turn Action says "start the turn first"; an out-of-range d4 face is refused ("the roll is not valid for the Character Die"); a missing Attack Roll is asked for and nothing is paid; a third 2-AP Attack after 4 AP is refused; nothing written |
| F4 a lost commit response | the real server commits, the acknowledgement is dropped; the player is told the retry is safe; the retry replays the original event; one event, one AP |
| F5 two tabs, same names | the stale tab is refused ("changed elsewhere"), applies nothing and reloads; two same-name Characters show two short ids and two separate histories |

F4 is the only interception, and the request reaches the real server before its reply is dropped.

## 4. Gap fixes found by the slice

1. **No way to approve a revision in Studio.** Publication refuses a pinned revision that is DRAFT or IN_REVIEW (`MUTABLE_VERSION_PINNED`), but no screen could move IN_REVIEW → APPROVED, so the designer → Release path could not be completed by a person. Fix: the Canon Manager ChangeSet page shows each proposed revision's status and, only while it is IN_REVIEW, a confirmed **Approve revision rN** command (`app/developer/rulesets/_components/revision-review.tsx`). It calls the existing M1 lifecycle endpoint `POST /api/entity-versions/:id/status { status: "APPROVED" }` (the endpoint Compendium Admin already uses for "Return to Draft") through a new client file `src/api-client/review.ts`, so the M2 audited command list in `governance.ts` is unchanged. Approval publishes nothing.
2. **A lost play acknowledgement was reported as "Could not reach the server."** The real HTTP client wraps a network failure as `CharacterApiError(NETWORK_ERROR)`, so the WO10 "retry safely with the same request key" notice was unreachable in a browser (the WO10 unit test threw a plain `TypeError`). The key was kept, so a retry was already safe, but the player was not told. Fix: unknown outcomes (`isUnknownOutcome`, the WO11 helper: network, unreadable response, 5xx) get the safe-retry notice.
3. **Fixture Ruleset name.** `seedCharacterRelease` gained an optional `rulesetName` so the playtest Ruleset is recognisable to a tester. No behaviour changes for existing callers.

No schema change, migration, route or `@prowess/db` export was added; no `@prowess/game` file changed.

## 5. Preparation command

```
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/prowess_studio_playtest_test pnpm playtest:wo12 prepare [runId]
DATABASE_URL=… pnpm playtest:wo12 status
DATABASE_URL=… pnpm playtest:wo12 cleanup <runId>
```

- Refuses any database that is not a local `*_test` database (the shared guard) and any database whose migrations are not all applied.
- `prepare` removes the same run first (repeatable), seeds about 400 test-only Definitions and publishes Release 1, and writes `.playtest/m6-wo12-<run>.json` (git-ignored). It creates no Character, ChangeSet, Release 2, ability or play event — those are the tester's.
- `cleanup <runId>` removes that run only with the shared fixture teardown (which lifts the append-only guards only for the rows it deletes).
- The journey uses the same function (`preparePlaytestWorld`), so the human and the automated path start from identical worlds.

## 6. CI wiring

- **Gate `M6-WO12` (controls-2).** It verifies the DB suite `m6-wo12-vertical-slice.test.ts`, the WO10 play suite, the WO12 static, review UI and browser-evidence suites and the M2 UI static audit from the authoritative reports, then runs `scripts/m6-wo12-negative-controls.mjs` (25 controls).
- **Naming.** In CI the gate and its step are called "M6-WO12 — First Complete Vertical Slice", and the DB suite is `m6-wo12-vertical-slice.test.ts`: the M3-I19 audit forbids the word "Playtest" anywhere in workflow files (it guards against a step that assumes the private Playtest source exists).
- **Browser evidence (e2e job).** After `End-to-end tests (Playwright)`, the step `M6-WO12 browser evidence (vertical slice journey)` runs `node scripts/ci/verify-browser-evidence.mjs M6-WO12`. It reads Playwright's JSON report (`playwright-report/results.json`, now always written) and the journey evidence. It fails if either is absent, if a WO12 test is missing, skipped, failing or only flaky, if the evidence names another commit, or if fewer than two complete runs in two worlds are recorded. The e2e job still builds once and Playwright serves that build (`PROWESS_E2E_PREBUILT=1`). The e2e job is in Tier 2's `needs`, so any of these fails Tier 2.
- **Inventory.** 44 gates and 719 controls (694 + 25) across 26 scripts, plus the new check.

## 7. Data ownership

Every write in the slice is made by the existing owning service: M1 lifecycle and WO1 authoring (revision), M2 (ChangeSet, Release), WO3 (Character), WO4 (advancement), WO6 (loadout), WO7 / WO8 (abilities), WO10 (play). WO12 adds no storage.

## 8. Governed-content boundary

Per `docs/architecture/m6-wo8-governed-content-candidate.md`, test fixtures are never installed as a fallback for a shared Release, and no price or eligibility is invented or relaxed. The slice therefore runs on an **isolated Release built from the shared test fixtures** (keys `test.m6wo12.<run>.*`): the WO3 Character content, the WO4 advancement rule, the WO6 Weapon catalog, the WO7 Spell fixture world and the WO8 Maneuver fixture world, including the separately approved WO8 cost policy fixture. The designer's 4 → 3 MP change is an authored revision inside that isolated Ruleset, not a change to shared content.

**Missing governed content** — required before the same journey can be run on a governed Release:

- A governed Character Creation Rule, Ancestry and Skill set (the slice uses the WO3 test Ancestry and Skills), and a governed Character Advancement Rule.
- Governed Spell components with runtime contracts: the maintenance-eligible buff Effect, Self targeting and the Sustained duration. The slice uses the WO7 / WO9 fixture versions, whose display names are their content keys.
- The approved `M6-WO8-A` Maneuver cost-policy extension, governed Maneuver Effects and Durations, and designer-priced Movement, Defense and Interaction Foundations (see the WO8 candidate).
- Human display names for the fixture components (the builders show content keys such as `spell.targeting.self`).
- The governance decision itself: choosing the target Ruleset / Release and reviewing the content through the normal ChangeSet path.

## 9. Limitations

- **Isolated, not canonical.** The journey proves the product path, not the game balance of governed content.
- **Human testing.** The tester walkthrough is written for a person, but no person has run it as part of this assignment; the automated journey drives the same UI.
- **Fixture names.** Component names are content keys, which makes the builders harder to read for a tester.
- **Positions are not tracked.** Movement is recorded as distance and terrain; targets are labels.
- **Play outcomes are authorised, not applied.** Damage and Effect outcomes are shown as NOT APPLIED for the GM to apply.
