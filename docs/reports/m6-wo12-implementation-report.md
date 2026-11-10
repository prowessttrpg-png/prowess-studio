# M6-WO12 — First Complete Playtest Vertical Slice: implementation report

Status: complete local implementation and local verification on branch `m6-wo12`. **Not certified.** WO12 is final only after its published tree passes the complete required GitHub Actions workflow (Tier 2, which now includes the WO12 browser-evidence step) in a same-commit run and the merged-main run; both need separate authorization. Nothing was pushed, no PR was opened, nothing was merged, `main` is untouched and no shared canonical game content was changed.

Result label: **playtest verified on an isolated Release.**

Architecture: `docs/architecture/m6-wo12-playtest-vertical-slice.md`. Tester walkthrough: `docs/playtest/m6-wo12-tester-walkthrough.md`. Invariants: M6-I180 – M6-I189.

### Run 268 repair on PR #74

The results below describe the original local checkpoint. PR CI on that checkpoint found a V08 fingerprint mismatch after Sheet / Cards / print, with zero browser writes. Its aggregate hash could not identify the changed row retrospectively. The old witness included a global EntityVersion count. The revised integration test demonstrates the interference with two real fixture worlds: preparing the second world changes that count while the first world's protected rows remain identical. The new witness hashes each table separately and includes the exact Manifest pins and Version rows for the selected Ruleset. A committed event in the protected Character must still change the witness.

The walkthrough now exercises the actual Rules Inspector on R2 and compares its ME-first ward-payment result with the persisted Spell event. Cleanup requires a valid run ID; the isolation test checks the surviving world's Character, Release and ledger. The multi-screen WO8 Maneuver, WO11 draft/resume and baseline WO7 simple Spell journeys have individual 120-second budgets following 30-second deadlines in run 268. Locator assertions, retries, both required complete WO12 runs and the same-commit evidence verifier are retained. Use the final delivery note and the corrected SHA's CI for verification results.

Run 269 passed 91 browser tests. The remaining primary journey stopped in V09: the payment plan sent uppercase sheet display keys to the M4 resource engine, which returned INVALID. The spec waited for a balance row that could never appear; the second serial journey was skipped. The follow-up uses the runtime context keys `resource.me` and `resource.mp` in both the walkthrough and the Inspector journey, checks the child result for SUCCESS before reading the balances, and bounds waits on the Inspector tab. The ledger comparison still uses the Character resource keys ME and MP.

## 1. Baseline

| Item | Value |
| --- | --- |
| Base commit (`main`) | `923ed7c039ff344a8f5644cfb8e432179512121e` — "Merge pull request #73 from prowessttrpg-png/m6-wo11" |
| Base source tree | `53a16555e6283a005a847d7d076e02ab7dccfe8c` |
| Baseline evidence | WO11 PR #73; merged-main CI #267 (as provided) |
| Protection at baseline | M6-I001 – M6-I179; 43 gates; 694 controls across 25 scripts |
| Branch | `m6-wo12` from the base; local tag `m6-wo12-baseline` |
| Checkpoint | the `m6-wo12` commit containing this report; its SHA, tree and bundle checksum are in the delivery note (a commit cannot contain its own SHA) |

## 2. What was built

| Deliverable | Where |
| --- | --- |
| The journey V01–V12 (one named serial spec, two runs, evidence table) | `apps/studio/tests/e2e/m6-playtest.spec.ts` |
| Failure cases F1–F5 | `apps/studio/tests/e2e/m6-playtest-failures.spec.ts` |
| Preparation command | `pnpm playtest:wo12 prepare / status / cleanup` → `scripts/playtest/wo12-world.ts` (+ `register.mjs`, `ts-hooks.mjs`) over `packages/prowess-db/tests/fixtures/m6-wo12-playtest.ts` |
| Gap fix: reviewer approval | `apps/studio/app/developer/rulesets/_components/revision-review.tsx`, `apps/studio/src/api-client/review.ts`, ChangeSet detail page |
| Gap fix: safe-retry notice | `apps/studio/app/characters/_components/play/PlayWorkspace.tsx` |
| Fixture option | `seedCharacterRelease(..., { rulesetName })` |
| DB suite | `packages/prowess-db/tests/integration/m6-wo12-vertical-slice.test.ts` (7 tests) |
| Static gate, UI and verifier suites | `apps/studio/tests/unit/m6-wo12-static.test.ts` (12), `m6-wo12-review-ui.test.tsx` (3), `m6-wo12-browser-evidence.test.ts` (5) |
| Browser evidence verifier | `scripts/ci/verify-browser-evidence.mjs` (+ Playwright JSON reporter) |
| Mutation controls | `scripts/m6-wo12-negative-controls.mjs` (25) |
| CI | gate `M6-WO12` in controls-2; check `M6-WO12-BROWSER-EVIDENCE` in the e2e job; inventory 44 gates / 719 controls / 26 scripts |

No schema change, migration, route or `@prowess/db` export; no `@prowess/game` file changed (the approved-M5-changes registry is unchanged).

## 3. Gap fixes (found by driving the slice as a person)

| Gap | Reproduction | Fix |
| --- | --- | --- |
| A designer's revision could not reach a Release through Studio | Compendium Admin can Submit for review and propose a ChangeSet; the ChangeSet can be approved; publishing then refuses: "would pin editable EntityVersion(s) … (IN_REVIEW)". No screen moved IN_REVIEW → APPROVED (only the API could) | **Approve revision rN** on the Canon Manager ChangeSet page, IN_REVIEW only, confirmed, via the existing M1 lifecycle endpoint; `governance.ts` unchanged |
| A lost play acknowledgement read "Could not reach the server. (NETWORK_ERROR)" | F4: the request commits on the server, the reply is dropped. The client wraps fetch failures as `CharacterApiError(NETWORK_ERROR)`, so the WO10 safe-retry notice (reached only by a raw `TypeError` in its unit test) never showed | Unknown outcomes (`isUnknownOutcome`) show the safe-retry notice; the key was already kept, and the retry replays (one event, one AP) |
| The playtest Ruleset was indistinguishable from other fixture Rulesets | Ruleset names were `M6-WO3 Characters <timestamp>` | optional `rulesetName` → `M6-WO12 Playtest <run>` |

## 4. Evidence table (local)

Produced by the full local Playwright run against the production build at commit `481fbab` (the implementation commit; this report is the only later change). Both runs passed every step; the verifier accepted the report and the evidence (`M6-WO12 browser evidence verified for 481fbab…: 2 journey runs × 12 steps`). Values are identical across the two runs except the ids.

| Step | Run 1 (world `e2emw8td0dn1`, 210 s) | Run 2 (world `e2emw8thi9a2`, 205 s) |
| --- | --- | --- |
| V01 | revision `df3342f1` (r2, MP 4 → 3) · ChangeSet `c0a71f23` · Release 2 `440aeff0` pins `df3342f1` | revision `af5fa9a8` · ChangeSet `0a2d9947` · Release 2 `15a62c09` pins `af5fa9a8` |
| V02 | Pinned Revision 2; Release 1 Revision 1; "1 changed revision"; reference followed inside R2; 0 writes; fingerprint `c7bcc88e…` unchanged | same; fingerprint `61c71038…` unchanged |
| V03 | Character `497464be` on R2; reopened at Stats with 15 of 15 unspent; completed in a second context | Character `fc9679d4`; same |
| V04 | Level 2 (+1 PER); "Trained (needs Trained) — Available"; Signature capacity 0 / 4 | same |
| V05 | Long Blade `f96ff7e1`, one-handed; Slash 2 AP, 2d8 Slashing | Long Blade `d2816987`; same |
| V06 | Spell `50b34666` r1: 3 MP · 1 AP, Sustained, Effect `df3342f1`; `spell.effect.cleanse` locked (Expert Arcane) | Spell `b03b7373`; same |
| V07 | Maneuver `4d64fcdb` r1: 2 AP / 5 MP on the equipped Slash | Maneuver `5bb02bfd`; same |
| V08 | Sheet, Card Library, print (23 cards); 0 writes; fingerprint `b7f45155…` unchanged | 0 writes; `5ed86d92…` unchanged |
| V09 | damage steps "Base 1d8 SLASHING → Power Multiplier STR 6 ÷ Power 6 → ×2 → 2d8"; Effect link = R2 entry at `df3342f1`; final 3 MP; 0 writes; fingerprint unchanged | same |
| V10 | preview: AP 4/4, versions unchanged; Move → AP 3/4; 5 ft; Slash: raw face 3, Dodge 3 → "hit (natural 3, total 8)", "2d8 slashing — NOT APPLIED"; Spell cast: ME 4 → 1, MP 7/7, ward ACTIVE; 11 event ids | same (11 different event ids) |
| V11 | two fresh resumes identical: runtime 11 / play-state 5, AP 3/4, MP 7/7, ME 1/4, 11 events, ward active; 0 writes; fingerprint unchanged | same |
| V12 | Maneuver: Attack Roll requested and nothing paid, then face 3 / Dodge 3 → AP 3 → 1, MP 7 → 2; maintenance applied; dismissed (ENDED); out of combat; 21 events, sequences 1–21, all on R2; final runtime version = last event's | same |

## 5. WO1–WO11 coverage matrix

| WO | Capability | Exercised in the journey | Failure-case / DB coverage |
| --- | --- | --- | --- |
| WO1 | Compendium Admin authoring, revision, validation, review hand-off | V01: new revision, structured cost edit, validation PASS, submit, ChangeSet proposal | DB I181 (authoring services, IN_REVIEW unpublishable) |
| WO2 | Rules Reference: exact Release, pinned revision, references, comparison | V02 (read-only, fingerprinted) | — |
| WO3 | Character creation wizard on an exact Release | V03 (draft, partial save, completion) | F1 (no preselected Release) |
| WO4 | Advancement and access | V04 (Level 2, +1 PER, Arcane access) | DB I183 (unmet prerequisite refused at finalize) |
| WO5 | Character Sheet, resources | V05, V08 | — |
| WO6 | Weapon loadout, Attack Library, damage inspector | V05, V09 (inspector operands = play outcome expression) | — |
| WO7 | Signature Spell builder and cost evaluation | V06 (3 MP from R2; locked prerequisite shown) | DB I182 (price pinned after R3), DB I183 (capacity) |
| WO8 | Signature Maneuver builder (real backend) | V07 | F2 (draft / retired refused) |
| WO9 | Card Library and print | V08 (read-only) | — |
| WO10 | Play Workspace: timing, actions, movement, attacks, spells, maneuvers, Active Magic, ledger, idempotency | V10, V12 | F2, F3, F4, F5; DB I183, I184 |
| WO11 | Library, save / load, resume | V03 (resume a Draft), V11 (resume play twice) | F5 (same names); DB I185 |
| WO12 | Reviewer approval; safe-retry notice | V01; F4 | DB I181; UI suite |

## 6. Permanent protection

- **Invariants** M6-I180 – M6-I189 (JSON and Markdown registries), each naming its guards.
- **Gate `M6-WO12`** ("M6-WO12 — First Complete Vertical Slice" in CI; controls-2, tiers 2 / 3): the WO12 DB suite, the WO10 play suite, the WO12 static / review UI / browser-evidence suites and the M2 UI static audit, verified from the authoritative reports; then 25 mutation controls, including the five the work order names:

| Required regression | Controls |
| --- | --- |
| switching to the latest Release | 07 (advancement / signature rules), 08 (play context) |
| substituting an ability revision | 09 (Spell revision number), 10 (Maneuver revision Release) |
| skipping the real builder | 02 (Spell finalized in the DB), 03 (Maneuver finalized by API) |
| double-charging on retry | 11 (server replay check removed), 12 / 13 (client treats an unknown outcome as a failure / discards the key) |
| writing during resume | 14 (Play Workspace), 15 (Sheet) |

  The others: journey route fulfilment (01), direct Character write (04), dropped second run (05), lost fingerprint (06), approval for a Draft (16), double approval (17), wrong status (18), approval moved into the audited command list (19), skipped / wrong-commit / single-run evidence accepted (20–22), verifier step removed (23), JSON reporter removed (24), preparation without the database guard (25).
- **Browser evidence in Tier 2.** The e2e job's new step fails when the WO12 report or evidence is absent, a test is missing / skipped / failing / flaky-only, the evidence names another commit, or fewer than two complete runs are recorded. The e2e job reuses its one production build.
- **Historical assertions changed:** the CI inventory test's totals (694 → 719 controls, 43 → 44 gates) and its title; the controls-2 job title gained "M6-WO12". All 694 historical controls are preserved; no historical anchor changed.

## 7. Local verification

All runs are local, in this container, against PostgreSQL 16, on the implementation commit `481fbab` (tree identical to the checkpoint except this report).

| Check | Result |
| --- | --- |
| Lint (`pnpm lint`) | ✅ 0 problems (`--max-warnings=0`) |
| Typecheck (`pnpm typecheck`) | ✅ |
| Architecture (`pnpm run test:architecture`) | ✅ 13 rules, 7 packages, no violations |
| Gate inventory | ✅ 9 suites, 44 gates, 719 controls, 15 checks; every legacy item represented |
| Control-harness self-test | ✅ 8 scenarios |
| Package units: model / ui / import / rules | ✅ 513 / 21 / 128 / 659 |
| `@prowess/game` units | ✅ 1,821 (57 files) |
| `@prowess/db` units | ✅ 164 (22 files) |
| Studio units | ✅ 3,731 (109 files) |
| DB integration, fresh database per shard | ✅ shard 1: 302 (32 files, includes the 7 WO12 tests); shard 2: 336 (31 files) |
| Studio API integration, fresh database | ✅ 242 (40 files) |
| Prisma validate | ✅ (offline engine stand-in; engine downloads are blocked here) |
| Prisma generate / migrate deploy / drift | ⛔ blocked locally (engine download refused); no schema or migration changed — CI-only |
| Production build (`pnpm build`) | ✅ |
| Playwright, full suite against that build | ✅ 92 passed, ❌ 1 failed: `compendium.spec.ts` "full flow" — a client navigation did not complete within 5 s while the WO12 worlds were being seeded in parallel. Re-run alone: 4 / 4 passed. WO12 does not touch the Compendium browser; recorded as a load-sensitive flake (CI retries once) |
| WO12 journey (2 runs) and failure spec (5) | ✅ all passed in that run |
| Browser evidence verifier | ✅ verified for `481fbab` |
| Mutation controls | ✅ WO12 25 / 25; WO11 25 / 25; WO10 52 / 52; WO3 28 / 28; WO1 18 / 18 — every file restored, tree unchanged |
| The remaining historical control scripts | not re-run: none of their files changed (checked by anchor search); CI runs all 26 |
| GitHub Actions | ⏳ not run (publication requires separate authorization) |

Defects found and fixed during verification: the M3-I19 audit forbids the word "Playtest" in workflow files, so the CI gate / step names and the DB suite file avoid it (§6 of the architecture note); the DB suite was renamed `m6-wo12-vertical-slice.test.ts` and re-run.

## 8. Human testing

No person has run the tester walkthrough as part of this assignment; I cannot perform a manual human test. The automated journey drives exactly the screens the walkthrough names (the walkthrough's labels were taken from those screens), but it is not a substitute for a person's judgement of clarity. Recommended next step: one tester follows `docs/playtest/m6-wo12-tester-walkthrough.md` on a disposable database and fills in its checklist.

## 9. Residual limitations

- **Isolated Release only.** The content is the shared test fixtures under `test.m6wo12.<run>.*`; see "Missing governed content" in the architecture note. No governed Release was used, created or changed.
- **Fixture display names** are content keys (`spell.targeting.self`, `test.wo8.effect.enhancement`), which a tester will find terse.
- **The journey takes about four minutes per run** (two runs plus the failure spec add roughly ten minutes to the e2e job).
- **The approval control re-reads only its own revision.** The neighbouring "To: rN — … (IN_REVIEW)" label uses the existing label cache and can show the old status until the page is reloaded; the control's own status line is authoritative.
- **Outcomes are authorised, not applied**, and positions are not tracked (unchanged WO10 scope).

## 10. Certification checklist

| Requirement | Status |
| --- | --- |
| One Ruleset, one exact published Release, one player-created Character, one equipped Attack, the same two player-authored abilities connect V01–V12 | ✅ (evidence §4) |
| Real Studio UI, production build, real PostgreSQL; no route fulfilment, fake server, pre-finalized build, direct Character write or substituted result in the journey | ✅ (static W12-I186; controls 01–06) |
| Failure cases separate: newer Release, draft / invalid / retired, missing roll, insufficient resources, wrong timing, lost response with idempotent retry, two tabs / same names, human-readable outcomes | ✅ (F1–F5) |
| Repeatable preparation for a designated disposable DB; run-scoped setup / cleanup | ✅ (`pnpm playtest:wo12`; DB I180) |
| Human walkthrough without API / SQL / Playwright / storage edits | ✅ written; ❌ not yet tried by a person |
| Governed-content boundary honoured and labelled | ✅ |
| Evidence table V01–V12, fingerprints around read-only steps, second full run in a fresh world | ✅ |
| Invariants after M6-I179, WO12 gate, mutation controls for the five named regressions | ✅ |
| Browser evidence registered with the e2e job; absent / skipped / wrong-SHA / failing evidence fails Tier 2; one production build reused | ✅ locally (verifier and its suite); CI run pending authorization |
| 43 historical gates and 694 controls preserved | ✅ |
| Same-commit GitHub Actions run (Tier 2) and merged-main run | ⏳ requires separate authorization |

## 11. Checkpoint

The checkpoint commit, tree, commit count and bundle (filename, size, SHA-256, fresh-clone verification) are recorded in the delivery note, outside the commit. Browser evidence for the final checkpoint SHA is produced after committing and is likewise recorded there.
