# RULES-WO1 — Phases F and G report: every Spell / Maneuver component in game language (status: Partially complete)

Branch `rules-wo1-complete-game-authoring`, based on `main` `23f3c03`. It continues from the Phase E checkpoint `7607610`;
that report, its evidence and its ZIP are unchanged. **Do not merge.** RULES-WO2, RULES-WO3 and M7-WO2 were not started.

| Record | Value |
| --- | --- |
| Final candidate | `0729b70775527237148ba85d6d332ab42162199f` (tree `cbbabad38c8b51685b3dca21ac130262c8604e75`). Every result in §5 comes from this commit. |
| Earlier candidate kept as evidence | `df76bb6` (`df76bb63bbe96cfadad7e9c8439978f2e6710bff`, tree `6bc90480c25d4f2dd58feb5b516a5f7433b000b1`) — Phase F, fully verified (§5.2). |
| Commits | Phase F: `git log 7607610..df76bb6`. Phase G: `git log df76bb6..0729b70`. |
| Reconciled against | The owner's full work order (kept in the private project as `claude/rules-wo1-work-order.md`), including §5: "a recursive object editor with friendly labels is still insufficient". |
| Acceptance | `docs/architecture/rules-wo1-acceptance.md` — R10, R11 and R18 re-decided in Phase G. |
| Outstanding | Publication and the draft PR; hosted CI with Tier 2 and both Windows installer jobs; the owner's walkthrough; the gameplay decisions in §3; publishing the Cone correction (§4); the remaining structured-data fields listed under R18. |

## 1. What Phase F completed (verified on `df76bb6`)

| Item | Built | Evidence |
| --- | --- | --- |
| Effects and Traits in game language | A guided editor replaced the generic Effect form: what it does, how it resolves, the choices made when it is used (named in plain words), costs, what happens on a success or a failure, how long it lasts, what it takes to build with it. Contribution keys are generated; renaming a choice renames everything that reads it; stored fields the editor does not show are kept. | Unit `rules-wo1-component-mechanics-ui`; browser **P11** "Flame Lash" (published, built into a Spell: 1 die 5 MP, 2 dice 8 MP from the server). |
| Mechanical relationships | Mage Art benefits carry validated mechanics per kind; Condition effects and triggers say what they do; Summons name their hosts and access. Reference only in play. | Game `rules-wo1-reference` (Phase F block); browser P04, P08, P10. |
| Skill-benefit preview = the sheet | The preview runs the sheet's own evaluation, with Affinity ranks as sample inputs, and names every input the sample left out. | Defect fixed (the old preview never applied a benefit with prerequisite groups). Game and DB tests; both R08 Characters' samples equal their sheets. |

## 2. What Phase G completes

| Item | Built | Evidence |
| --- | --- | --- |
| **Targeting** (Spell and Maneuver) | How it is delivered; how many targets (one, several chosen from a number choice, an area, a chain); what it can target; the choices made when it is used (a size step, a number, yes / no, an option), named in plain words; range (self, touch, the caster's Spell range, a stated distance, set by the Effect, a special rule as written); the size of the area (length, width, radius — a stated distance, set by the Effect, or waiting on a named open question); where it starts (including Aura centres) and how it is placed; line of sight, line of effect and cover; a Spell Targeting's MP (exactly one base cost, plus per size step, per extra target or per option). A Maneuver Targeting has no cost of its own (the Effect that uses it owns the AP / MP). Distances are Formulas composed from contributions by the server and may read the component's own size choices. Renaming a choice renames the cardinality, costs and distance inputs that read it. | Unit `rules-wo1-component-rules-ui` (stored payloads accepted by the real M5 reader); browser **P12** "Ember Ring" and **P13** "Own Footing". |
| **Durations** | The Duration from the list; its play-time markers (Sustain, Mana Lock, Concentration) follow from it automatically; when it may be chosen (checks on the ability's own mechanics); whether the rules list a cost, and the cost (a Rounds Duration is priced per round); "waits on an open rules question" with the question named. | Unit tests (Sustained, Rounds with a cost per round, Permanent waiting on M5-SC-045); browser **P13** (Scene). |
| **Casting and Maneuver Conditions** | The restriction in plain words; when it may be taken (checks on the compiled mechanics: always, makes an attack roll, calls for a Saving Throw, affects an area, is Sustained, lasts / can target / includes an Effect of / uses a foundation of …, all-of or any-of); what play must confirm, named in plain words (recorded for the play runtime, which does not evaluate it yet); the user's choices; the benefit (reduces MP by a percentage, reduces AP, reduces MP, commits extra AP — a Maneuver offers only AP / MP reductions), with the currency following from the meaning; "the user picks one benefit"; slot use, incompatible restrictions, dependencies; waiting on an open question (no benefit). | Unit tests (Verbal-style, AP-or-MP Maneuver Condition, deferred Material); browser **P12** "Steady Breath" (only when the Spell affects an area; the server lists and applies its 10% reduction) and **P13** "Charge First". |
| **Foundations** | A non-attack action (movement, defence, interaction) bound to an exact Maneuver Targeting chosen by search, with its AP / MP. A Weapon Attack Foundation stays derived from its Weapon and Attack. | Unit test; browser **P13** "Quick Dash" (bound to the Targeting authored in the same journey). |
| **An Effect's calculated values** | Formulas (for example a cone's length) are named in plain words and composed from contributions; their inputs are Stats, the Martial Rank Value and the Effect's own number choices, named in lowerCamel by the server, as the Effect reader requires. | Unit test (the published Cone's input replaced in the editor gives `5 * martialRankValue`); DB formula-guide test. |
| **Formula editing defect fixed** | Two contributions added in quick succession could lose the first: the second was rebuilt from the server's reading of the expression before the first. Contributions are now edited only from a current reading. | Found by browser P12; regression unit test fails without the fix. |
| **M5 change (registry RULES-WO1)** | Closed lists exported only — component availability, Condition meanings, the Concentration marker, the construction facts an applicability may read, Foundation action categories, Effect formula sources. No behaviour changes; the readers use the same lists. | Registry and `rules-wo1-static` updated; game suite. |

## 3. Ability Condition requirements: missing implementation versus undecided design

Checked against the Core Playtest packet (read on the owner's machine), the M5 conflict register and existing rulings.

**Missing implementation, not design.** An Ability Condition's *runtime* requirements (can vocalize, can perform
somatic motion, has moved 10 ft first, a use is still available …) are play-time checks. Play does not evaluate them yet.
That never blocked authoring: they are now named in plain words and stored for the play runtime. *Applicability* reads
facts the compiler already decides (attack roll, Saving Throw, area, Sustained, Duration, targets, Effect families,
foundation categories); it is guided and enforced at construction.

**Established and now authorable.** M5-SC-044 keeps the *generic* templates deferred, but says exact authored subjects
can use the typed framework. An exact **Delayed** (s675, −10% MP), **Environmental** (s675, −15% MP) or **Weapon Lock**
(s2020, −1 AP) Condition naming its trigger, environment or weapon type is authored and accepted (unit tests).

**Undecided design — the owner's decisions needed** (each recorded in the acceptance matrix §3; nothing invented):

| Rule | Source passage | Missing fact | Decision needed |
| --- | --- | --- | --- |
| Cannot Move This Turn (M5-SC-043) | s2020 Common Conditions: −1 AP; s2099 Movement Conditions: −2 AP | which value applies | −1 AP or −2 AP? |
| Once per Mission (M5-SC-044) | s2020: −5 AP; designer ruling SC-025 caps a Maneuver's Conditions at 3 AP | how the listing meets the cap | −3 AP (capped) or an exception to the cap? |
| Environmental Lock (M5-SC-044) | s2020: "−1 to −3 AP", terrain, weather, elevation, cover, darkness | what fixes the value | fixed per authored Condition by severity, or chosen in play? |
| Material (M5-SC-044) | s674: "the benefit depends on the Material used and the spell design" | any benefit | what does a Material give (a percentage, AP, by material type)? |
| Risk (M5-SC-044) | s675: "−10% MP or more" | what earns more than −10% | the scale above −10%? |
| Focus (M5-SC-044) | s675: "GM-set reduction" | the value | may the ruleset author fix it per authored Focus Condition, within the rank cap? |
| Permanent Duration (M5-SC-045) | s657: "special rules only"; s662's indefinite Sustain is a different rule | the access rule and the cost | which requirement grants Permanent, and its price? |

## 4. Cone Attack Conversion

- **Intended formula — established.** The packet states the length as "5 ft × Martial Rank" with Trained 5 ft / Expert
  10 ft / Master 15 ft, and the Effect requires Martial Expert. The published content authors exactly that
  (`5 * martial_rank`, reading the Martial Rank Value).
- **Defect — representation only.** The Effect reader accepts only lowerCamel input names, so this Effect never compiles.
  No formula, value or balance changes; the compiler contract is unchanged.
- **Correction — prepared as a new revision.** Same expression, source, rounding, minimum (5) and unit (ft), with the input
  named `martialRankValue` — exactly what the guided editor now produces when the input is replaced with the Martial Rank
  Value. The payload is in the recovery package (`cone-attack-conversion-revision-2.json`).
- **Demonstrated in an isolated test Release** (game test `rules-wo1-cone-conversion`): the new revision compiles; Expert →
  10 ft, Master → 15 ft; at Trained the Effect is unavailable (it requires Martial Expert), so the table's 5 ft Trained row
  is never reached — recorded as a content observation, not changed. The published revision is untouched and a different
  version.
- **Historical Releases.** Every Release that already contains the defective revision keeps it (Releases are immutable).
  In this repository that is the Core Playtest reference content and the test / demo worlds built from it
  (`m6-wo8-maneuver-world.json`, the studio builder fixture, the WO12 playtest world and the desktop demo prepared from it).
  No Maneuver using it could ever be built, so no Character holds it.
- **Not done (needs approval):** publishing the correction into the owner's ruleset, and correcting the bundled demo / test
  content for future worlds. The owner's own database was not opened.

## 5. Verification

### 5.1 Final candidate `0729b70`

All results below are from **one commit**: `0729b70775527237148ba85d6d332ab42162199f` (tree
`cbbabad38c8b51685b3dca21ac130262c8604e75`), checked out clean, run locally on 22 Nov 2026 in one uninterrupted run.
The working tree was clean before and after.

| Check | Result |
| --- | --- |
| Lint / architecture (14 rules, 7 packages) / typecheck / production build | pass |
| Studio unit | **3970 / 3970** |
| Game (`@prowess/game`) | **1932 / 1932** |
| DB unit | **191 / 191** |
| Model / rules (M4) / import / ui | 513 / 659 / 128 / 21 — all passed |
| Desktop boundary (`node --test`) | 2 / 2 |
| DB integration (2 shards, fresh migrated databases) | **309 + 352 = 661 / 661** |
| Studio integration | **247 / 247** |
| **Playwright — complete suite, one run, fresh test database** | **115 / 115 passed** (19.2 min), including P11, **P12** and **P13** |
| Negative controls | RULES-WO1 **13/13**, M6-WO1 **18/18**, PRE-M7-WO1 **13/13**, M7-WO1 **10/10** — every mutation caught and restored byte for byte |
| New-kinds transfer proof | pass (R1 / R2 packs, idempotent replay, imported Keyword read-only, unchanged after restart) |
| Previous-build restore proof | pass — backup written by main `23f3c03` (app 0.1.2), 1,192,179 bytes, SHA-256 `c360fc93bf9322b64bbeafd09337ec7a660dde3e8303aeb0684c4a4ce2ea5ba2`; all 69 tables identical; 2 encounters, 3 participants, 8 events re-read; both Character sheets equal |
| Migrations | Fresh: 31 applied, no Prisma drift. Upgrade from the populated earlier chain: no drift. |
| 390 px timing (P06) | editor ready 239 ms; preview round trip 88 ms |

Local substitutions are unchanged from earlier checkpoints (migrations applied with `psql` from the committed files; drift
checked with the official WebAssembly schema engine; the transfer and previous-build proofs run copies of their scripts,
changed only in the migrate step).

**Not run here:** hosted CI; Tier 2; both Windows installer jobs (including the installed upgrade from an installed earlier
build); the installed smoke test. All four are blocked by publication.

**Superseded run on `2f62e05` (`2f62e05b435cdb20ae04f28f02e511a2a6c5c3ec`), not combined with the above.** Everything passed
except two items: (1) the M6-WO1 control "allow an Effect resolution field on Targeting" could not apply its mutation,
because its anchor (the Targeting descriptor's Geometry field) moved when the guided Targeting editor replaced it — the
control was re-anchored in `0729b70` with the same mutation and guard; (2) one Playwright journey (M6-WO10 "a full turn …")
timed out after 5 s waiting for the Play Workspace on its first page load (114 / 115); re-run alone on the same build it
passed (4 / 4), and it is unaffected by Phase G. Logs are kept with the run.

### 5.2 Earlier candidate `df76bb6` (Phase F)

Run 22 Nov 2026 on a clean checkout. The container restarted during the M6-WO1 negative controls; the one mutation it
left in place (`DefinitionReferencePicker.tsx`) was restored with `git checkout`, and every check after it was run again on
the same clean commit.

| Check | Result |
| --- | --- |
| Lint / architecture (14 rules, 7 packages) / typecheck / production build | pass |
| Studio unit | 3952 / 3952 |
| Game | 1927 / 1927 |
| DB unit | 191 / 191 |
| Model / rules (M4) / import / ui / desktop | 513 / 659 / 128 / 21 / 2 — all passed |
| DB integration (2 shards, fresh databases) | 309 + 352 = 661 / 661 |
| Studio integration | 247 / 247 |
| Playwright, complete suite, one run | 113 / 113 (17.8 min) |
| Negative controls | RULES-WO1 13/13, M6-WO1 18/18 (re-run after the restart), PRE-M7-WO1 13/13, M7-WO1 10/10 |
| New-kinds transfer proof | pass |
| Previous-build restore proof | pass — backup by main `23f3c03` (app 0.1.2), 1,192,157 bytes, SHA-256 `dcab5fad…7142`; all tables identical; sheets equal |
| Migrations | fresh: no drift; upgrade from the populated earlier chain: no drift |

Superseded: `77c4225` — everything passed except three browser journeys that still used the old Effect form
(M6-WO1 admin journey, PRE-M7 G02, WO12 playtest run 1; run 2 did not run). Fixed in `df76bb6`. On that run the Studio
unit suite had one load timeout (M3-I19 history scan) that passed on `df76bb6`.

## 6. Publication (still blocked)

The session's git proxy still refuses `prowessttrpg-png/prowess-studio` (not retried). The recovery package has a
complete-history bundle and `RECOVERY.md`. Once access exists: push, open a draft PR, let the required CI, Tier 2 and both
Windows installer jobs run, run the installed upgrade check, and hand the `windows-package` installer (run, commit,
SHA-256) to the owner for the walkthrough. Stop before merge.
