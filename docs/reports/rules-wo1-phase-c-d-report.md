# RULES-WO1 — Phases C and D report and recovery record (stop before merge)

Branch `rules-wo1-complete-game-authoring`, based on `main` `23f3c03e95da4c7a4c1db51449d79754895adecb`. This report covers
Phases C and D. **RULES-WO1 is not complete.** Three things are still outstanding:

- publication and hosted CI on the candidate;
- the Windows installer check;
- the owner's walkthrough acceptance.

Nothing is merged, and RULES-WO2, RULES-WO3 and M7-WO2 were not started.

## 0. Identity and recovery

| Record | Value |
| --- | --- |
| Baseline `main` | `23f3c03e95da4c7a4c1db51449d79754895adecb` (tree `11f95d50e50b010cf635fada99e4d17e318b6de5`) |
| Baseline CI | Run **#285** on `23f3c03…`: **all 18 jobs passed** — independently verified by the owner. This is the *baseline*, not the candidate. |
| Phase B checkpoint (preserved) | commit `0456ec573845426e5ff01e54f78ac5ca4c33f480`, tree `ba12ccd69ccafe5c9884012be02f4a9cca28670c` |
| Phase B ZIP (kept unchanged) | `rules-wo1-phase-b-0456ec5.zip`, SHA-256 `f61803fcceb6426cbed7bfc4764f4d5e4e897943ffcef0a765030b20944d77be`; extracts cleanly; its bundle (SHA-256 `663fd456199f5d4588c9564fb9b9aacfb46a3b1343222f0a36ade961005cde44`) passes `git bundle verify` |
| Phase C/D commits | 71fdfa2 → 476b0e0 (15 commits; `git log 0456ec5..476b0e0`) |
| Interim recovery checkpoint | `b86ab3d` (tree `5e68c01…`): ZIP `rules-wo1-recovery-b86ab3d.zip`, SHA-256 `f69d92b5d97abdda0784dd9a9153fb5cb785e3cb1653308ddcc8cb7faf120bb0`; bundle SHA-256 `f28f358aadc3d174ff7094215b70af7938c266dd0578045649b1cda65796b905` (preserved before the Phase D fixes) |
| **Verified code candidate** | `476b0e079c04a3894cd356c282270cc550882cbd` · tree `d000b4d6ee64c202471b90a41035d8f897c256bd` |
| Report commit | the commit that adds this file (documentation only; no code or test change) |
| Phase D bundle / ZIP | see §8 (checksums recorded there) |

Publication is still blocked. `git push` → 403 from the session's git proxy: "prowessttrpg-png/prowess-studio is not in
this session's authorized repository set". The draft PR and hosted CI are therefore **outstanding**. §8 gives the
push / PR commands.

## 1. What Phases C and D deliver

| Area | Delivered |
| --- | --- |
| Remaining rule families | **Activated:** ARMOR, STATUS_CONDITION, SUMMON_TYPE (7 engines), SUMMON_TRAIT, MISSION_RULE (roll tables, Threat Clocks, Intel, rule points).<br>**Added (v1):** METAMAGIC, JOB_TEMPLATE, REFERENCE_RULE (written gameplay tables / rule points).<br>**Also:** MAGE_ART version 2 (mode scaling steps, granted benefits, maintenance exceptions).<br>SUMMON_ACTION_MODEL stays reserved, because the action economy is a field of the engine.<br>All of this is additive, under the registered approved-M5-change entry `RULES-WO1`. |
| Validation | Every family is validated by its M5 reader. Roll tables must cover every roll exactly once (a gap or overlap is refused with the row and the expected number). Clock escalations must fall inside the clock and in order. Summon sustain fields must agree with the engine's sustain mode. A Job template's Skills must be exact SKILL references. |
| Previews (all M4 arithmetic, all "Preview only — play does not use this rule yet") | **Armor:** AGI cap for Dodge, Strength requirement, movement penalty and stealth. **Summon:** casting AP from total MP ÷ PRO, sustain costs. **Mission / reference table:** row for a roll. **Threat Clock:** escalations reached. |
| Ordinary-user interface | **Source-section picker:** search by title; keys only under "Section keys (advanced)"; a loading state; a no-rulebook note.<br>**Entry page:** Overview, Rules and benefits, Requirements and choices, Preview, Usage and impact, History and source.<br>**Readable relationships:** "It reads" / "Used by" in game words.<br>**Pickers:** Skill-rank and calculated-value pickers by name; identity fields fill themselves from the Display Name; the Canonical Key is filled by one "Suggest" click (it is never derived silently, per the M6-WO1 gate).<br>**Definition preview:** labels fields in words (no payload keys).<br>**Keywords screen:** create and list, with the key shown before creation. |
| Truthful capability indicators | A code-declared registry (`packages/prowess-db/src/compendium-rules/capabilities.ts`) is served with the catalog. It is pinned by `rules-wo1-capabilities.test.ts`: every kind is listed; REFERENCE_ONLY kinds are not read by any runtime directory. The entry Overview shows the following, each derived from a real source: validated; published in this Release; preview; connected to; live in play. |
| About this build | **About** is in the main navigation. The page shows the version, kind of build, source commit and tree, and the guided / technical editor lists. |
| Distribution and persistence | `scripts/distribution/verify-rules-wo1-transfer.mjs` and a new CI step. It covers all 12 new / activated kinds, published in one ChangeSet as Release 2 on top of a Release 1 that has an encounter and saved play state, through:<br>- content-pack export → preview → install on a fresh receiver;<br>- restart (state unchanged);<br>- desktop backup written as 0.1.2 and inspected / restored by 0.1.3 (the upgrade proof);<br>- restart (unchanged). |
| Gates | RW1-I001–I012; 6 gate test files; 13 negative controls; Phase C browser spec `rules-wo1-reference-editors.spec.ts`. |

## 2. Confirmed rules boundaries (unchanged)

- **Carry Capacity** stays explicitly TEST-ONLY ("Test value — not canon"). No canonical formula was invented. The test
  proof uses `25 × STR` and `1 × STR`, both labelled TEST_ONLY.
- **Throw Distance**'s base is stated as unknown. The total reads "+N ft from bonuses (base not stated)".
- **Concentration** follows the owner-approved override:
  - capacity `1 + floor(RES / 3)`;
  - upkeep `max(1, floor(casting AP / 2))`;
  - 1 point covers 1 AP.

  It is preview only — combat keeps the earlier policy. Reassignment, saves, refunds and the summon / Mage Art
  exceptions remain recorded as open questions, not inferred.
- No preview claims that combat or play uses a new rule.

### Unresolved rules questions (recorded, not decided)

| Question | Status |
| --- | --- |
| Carry Capacity | The canonical formula is not supplied; only test content exists. |
| Throw Distance | The base is not stated. |
| Concentration | Reassignment while an Effect continues, saves, refunds, and the summon / Mage Art exceptions are open. |
| Summons | Whether a Summon counts toward Concentration is a field left "Not decided" per engine. |
| Mage Art D1–D3 | Cost shape, structured effects and activation / Signature investment are open. |
| M5-SC-052 and M5-SC-053 | Mana Lock amount, and Channel-completion MP. |

## 3. Whole-game coverage (authoring vs live execution)

The final matrix is in `docs/architecture/rules-wo1-complete-game-authoring.md` §4b. All 14 families have guided create /
edit, M5 validation and a preview or presentation.

**Live in play:**

- resolution, Stats and derived statistics, creation and progression, Skill ranks, combat resources, Affinities, Spells,
  Maneuvers, Weapons.

**Partly live:**

- calculated values and Skill-benefit additions (on the sheet only);
- terrain hazards and Massive size.

**Reference only (stated on every entry page):**

- Job templates, Metamagic, the Concentration override, Mage Arts, worn Armor, Conditions, Summons, Mission rules and
  written reference rules.

**Not modelled (recorded):**

- ammunition / reload and weapon modifications;
- Spell-branch subdivisions as separate contracts;
- difficulty / critical tables as executable rules (they are written tables);
- Keyword editing (the platform has no Keyword edit service).

## 4. R01–R28 (restored)

The owner re-supplied the criteria. They are recorded verbatim, each with a reconciled status, in
`docs/architecture/rules-wo1-acceptance.md`.

| Status | Criteria |
| --- | --- |
| Verified locally | R01, R02, R04, R05, R06, R07, R10–R17, R19–R23, R25 |
| Verified locally, with a hosted part pending | R03 (installer UI), R24 (Windows upgrade) |
| Incomplete | **R08**: granted Actions are not yet applied on the sheet; further prerequisites are authored but not evaluated, so the benefit is not applied (and says so).<br>**R18**: 13 older M6 token fields still take typed tokens; see the acceptance file. |
| Incomplete in part (blocked) | **R09**: Keyword editing has no platform service. |
| Blocked | **R26** and **R28**: hosted CI and the PR need publication. |
| Owner acceptance pending | **R27** |

## 5. Verification on the candidate (local, this session)

All results below are from **one commit**: `476b0e079c04a3894cd356c282270cc550882cbd` (tree
`d000b4d6ee64c202471b90a41035d8f897c256bd`). The working tree was clean before and after the run. The run was local, in
this session, on 20 Nov 2026.

| Check | Result |
| --- | --- |
| Lint (all packages, `--max-warnings=0`) | pass |
| Architecture (14 import-boundary rules, 7 packages, no cycles) | pass |
| Typecheck (all packages) | pass |
| Production build (`pnpm build`, Next 16) | pass |
| Studio unit | **3926 / 3926** |
| Game (`@prowess/game`) | **1899 / 1899** |
| DB unit | **189 / 189** |
| Model / rules (M4) / import / ui | 513 / 659 / 128 / 21 — all passed |
| Desktop boundary (`node --test`) | 2 / 2 |
| DB integration (2 shards, fresh migrated `prowess_studio_test` each) | **307 + 352 = 659 / 659** |
| Studio integration | **247 / 247** |
| **Playwright — complete suite, one run, fresh test database** | **108 / 108 passed** (19.3 min) |
| Negative controls | RULES-WO1 **13/13**, M6-WO1 **18/18**, PRE-M7-WO1 **13/13**, M7-WO1 **10/10** — every mutation caught; every file restored byte for byte; working tree unchanged |
| New-kinds transfer proof (`verify-rules-wo1-transfer.mjs`) | pass. Packs R1 (743,781 B, SHA-256 `f438a365…2a99`) and R2 (768,254 B, SHA-256 `0fdbbf4e…7ce4`). The receiver holds all 12 kinds and the exact Mission → Grappling link. Replay is "Already installed" with no writes. Restart unchanged. Backup 0.1.2 → restore 0.1.3: 69 tables, unchanged. |
| Migrations | Fresh: 31 applied, Prisma drift "No difference detected". Upgrade from a populated pre-M7 chain: 0 pre-existing tables changed, drift none. |
| 390 px timing (P06) | editor ready 252 ms; reference preview round trip 95 ms |

**How this was run locally.** The local substitutions are the same as at earlier checkpoints:

- Migrations are applied with `psql` from the committed `migration.sql` files, because Prisma engines cannot be
  downloaded here; the drift check uses the official WebAssembly schema engine.
- The transfer proof runs a copy of the script whose only change is that migrate step.

**Not run here:**

- hosted CI;
- Tier 2;
- the two Windows installer jobs;
- the installed smoke test.

All four are blocked, because the branch cannot be published from this session.


### Earlier runs, superseded and not combined with the above

| Commit | Complete browser run | What it showed | What changed |
| --- | --- | --- | --- |
| 2479a86 | 102 / 104 | Two failures. (1) M6-WO1 Compendium Admin: the plain-words name change had also converted old token fields. (2) M1-WO9 Compendium search / filter. | (1) Plain words were limited to RULES-WO1 name fields (`b86ab3d`). (2) See the Compendium finding below. |
| 86943ea → ab2f456 | 102 / 104 each | Phase C test data (a positive movement penalty), a Mission rule name typed as a token, and M1-WO9 failures | Fixed in ab2f456 / 737c454 |

## 5b. Compendium search / filter finding (M1-WO9)

**Captured.** A diagnostic script logged the URL changes and the `/api/entities` request order:

1. The search is typed.
2. Within the 300 ms debounce, the Entity Type is chosen. The URL becomes `?search=…&entityType=SPELL_EFFECT` and the
   filtered list loads.
3. About 200 ms later the pending search write lands. The URL becomes `?search=…` and the filter is gone.

**Baseline comparison.** `main` `23f3c03` was built in a separate worktree, with its own isolated database (same schema,
same migrations) and server port. It reproduced the same failure, 3 runs out of 3. The browser code is byte-identical
between the baseline and the branch.

**Cause (application, not the test).** The debounce timer used the URL writer captured when it was armed, which did not
include the new filter. A second defect was in the same component: the page label could say "Page 2" while page-1 rows
were still shown, which is the pagination test's failure. A slow, superseded response could also replace a newer one.

**Fix (`cb16356`).**

- The timer uses the newest writer, and skips a search that a filter change already wrote.
- Each result records the exact query it answers, so the list and the label never disagree, and stale responses are
  dropped.

**Regression tests.** `tests/unit/compendium-search-filter.test.tsx`: all three pass now, and the filter and pagination
tests fail against the previous code. On the fixed build, the diagnostic keeps the filter 5 runs out of 5.

No sleep, retry or relaxed assertion was added. The M1 browser test is unchanged.


**Not run here:**

- hosted CI on the candidate (publication is blocked);
- the Windows `windows-package` job and the installed smoke test (no Windows host; the installer is built only by CI).

The installed smoke test (`scripts/distribution/desktop/installed-smoke.mjs`) now requires two things:

- the installed `/about` page shows this commit, tree and app version;
- the catalog shows STAT, CALCULATED_VALUE, ARMOR, SUMMON_TYPE and MISSION_RULE as authorable, with capabilities.

Because no installer exists yet, the guided editors are **not yet verified in the actual Windows installer** (hosted verification pending).

## 6. Defects found and fixed during Phase D verification (selection)

| Defect | Found by | Fix |
| --- | --- | --- |
| The Definition preview listed raw payload keys (`armorValue` …) for every kind (since M6-WO1) | new browser test P02 | The preview labels fields with the editor's labels or the field name in words. A UI test pins this. |
| The source picker showed the title search, then swapped it for the no-rulebook note, so the input detached while typing | browser test P02 | The picker shows a loading state first, then exactly one of the two. |
| Keywords were created with a key made from the name, but the key was not shown | review | The permanent key is shown before creation. |
| M1 export-surface list missing the three new read-only services | DB integration | Listed with their read-only justification |
| Compendium filter lost during the search debounce; page label shown with another page's rows (M1, pre-existing on main) | browser runs; diagnostic; baseline build | §5b |
| A Mission rule's name had to be typed as a token | browser test P03 | Fills itself from the Display Name |
| Mission shape names collided with existing vocabulary values (TABLE, REFERENCE) under the M6-WO1 no-vocabulary gate | unit gate | The shapes were renamed **ROLL_TABLE** / **POINTS** (parts `rollTable` / `points`). The gate is unchanged. |

No gate, timeout or validation was weakened.

## 6b. Added in Phase D to meet R04–R25

| Criterion | Addition |
| --- | --- |
| R15 | All seven Summon engines, tested in the game and in the browser |
| R16 | Linked reference rules on Mission and gameplay rules (exact links, chosen by name) |
| R08 | Skill-benefit prerequisites |
| R17 | Status panel on the Rules Reference entry |
| R19 / R20 | Lossless-round-trip and stale-save DB tests, and an invalid draft refused at submission |
| R23 | Replay-idempotence and link checks in the pack proof |
| R25 | 390 px, keyboard, empty / error state and timing browser test |
| R04 / R07 | All six Stat pages, and input replacement, in the browser |

## 7. Owner walkthrough (pending)

`docs/reports/rules-wo1-owner-walkthrough.md` covers getting the installer, installing (back up first) and checking
About. Tasks T1–T15 cover Stats, Skills, abilities, equipment, Summons, GM rules, Keywords and phone width. **Your usability acceptance is
pending until you complete it.**

## 8. Publication (outstanding) and recovery

Blocked. The session's git proxy refuses `prowessttrpg-png/prowess-studio`: it is not in the authorized repository
set. Repeated push attempts have stopped until access changes.

**Recovery package:** `rules-wo1-phase-d-<commit>.zip`. It contains a complete-history bundle of the branch and the
baseline, plus `RECOVERY.md`. The checksums are recorded in `RECOVERY.md` and in the handoff message, because a file
cannot contain its own hash.

**Once access is available:**

1. Push the branch:
   ```
   git fetch <bundle> rules-wo1-complete-game-authoring:rules-wo1-complete-game-authoring
   git push -u origin rules-wo1-complete-game-authoring
   ```
2. Open a draft PR:
   ```
   gh pr create --draft --base main --head rules-wo1-complete-game-authoring --title "RULES-WO1 — Complete game authoring (draft, do not merge)"
   ```
3. Let the required CI, Tier 2 and both Windows installer jobs run.
4. Download the `windows-package` installer and record its run, commit and SHA-256.
5. Hand the installer to the owner for the walkthrough.

Do not merge. Do not start RULES-WO2, RULES-WO3 or M7-WO2.
