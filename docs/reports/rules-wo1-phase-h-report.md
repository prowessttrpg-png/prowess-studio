# RULES-WO1 — Phase H report: the remaining ordinary authoring gaps, Maneuver Radius, the Maneuver proof and the Cone Draft (status: Partially complete)

Branch `rules-wo1-complete-game-authoring`, based on `main` `23f3c03`. It continues from the verified Phase G checkpoint
`6b14c9c` (code candidate `0729b70`); that report, its evidence and its package are unchanged. **Do not merge.**
RULES-WO2, RULES-WO3 and M7-WO2 were not started.

| Record | Value |
| --- | --- |
| Final candidate | `384d1b4be8aef2ffbd5477c32ce0c8334504b718` (tree `8470554e7ecfa49a4e7afef3f1d8d953a16e0e90`). Every result in §6 comes from this commit. |
| Earlier candidates kept as evidence | `0729b70` (Phase G) and `df76bb6` (Phase F) — their results stay recorded against them. |
| Commits | `git log 6b14c9c..384d1b4` |
| Acceptance | `docs/architecture/rules-wo1-acceptance.md` — R11 and R18 re-decided; §3 unchanged except where noted. |
| Outstanding | Publication and the draft PR; hosted CI with Tier 2 and both Windows installer jobs; the identified installer and your walkthrough; the seven gameplay rulings (§4); creating the Cone Draft in your own workspace (§5). |

## 1. Inventory: ordinary workflows that still needed technical fields or syntax

Every authorable kind's editing descriptor was walked field by field (nested groups, list items and variants included), in
addition to the guided component editors. Before Phase H these still needed a typed expression, a typed key or code, or
the recursive data editor:

| Kind | Field | Was | Now |
| --- | --- | --- | --- |
| CORE_RESOLUTION (Core roll, Skill Check, automatic success, Saving Throw, Attack Roll, Initiative) | natural result per roll mode | typed expression (`max(r1, r2)`) | **as rolled / the higher / the lower of two dice**, built from the roll mode's natural rolls; another stored expression is kept and shown |
| CORE_RESOLUTION | comparison operator; compared against | typed `>=`; typed token | chosen ("meets or exceeds the difficulty"; Difficulty Class / target Dodge) |
| CORE_RESOLUTION | critical threat / hit / damage | typed tokens | chosen from the lists |
| CORE_RESOLUTION (Stat Mastery) | what it grants | typed token | chosen (Advantage) |
| ABILITY_CONSTRUCTION_RULE | five slot Formulas | typed expression + typed input names | **contributions over the slot's named inputs** (for example "base effects", "trades") |
| ABILITY_CONSTRUCTION_RULE | Affinity Authority / Casting Condition capacity source | typed tokens | chosen |
| ABILITY_CONSTRUCTION_RULE | Condition, Maneuver cost, Effect execution and Active Magic policies | recursive data editor ("advanced") | **guided**: numbers, yes / no, choices per Martial rank and per Duration, Maneuver components chosen by name, open questions in plain words, written authority; absent until added, and "Add" can start from the Core Playtest ruling |
| ACTION_IMPROVEMENT | "Only when" condition | recursive data editor | **always / only when a play-time check holds**, the check named in plain words (decided at use; play records it and does not evaluate it yet) |
| ACTION_IMPROVEMENT | new AP cost model | typed token | chosen |
| ACTION_IMPROVEMENT (rule operation) | operation data | recursive data editor | **written details** (no rule executes an operation; shown, never run) |
| ACTION, RESOURCE, TERRAIN, CREATURE_SIZE | Rule notes | recursive data editor | **written notes**: a heading in plain words and text; never run (no consumer reads them; all shipped content holds none) |
| AFFINITY v2 | Strength / Weakness "matches any Keyword" | typed Keyword keys | Keywords chosen by name |
| AFFINITY_PROGRESSION | conflict key | typed `M5-SC-…` | open question typed in plain words ("M5 SC 044") |
| SPELL / MANEUVER_TARGETING | Skill-rank tables; a distance reading one | kept, not editable; "rank × STR" had no contributions view | **values by Skill rank** (Skill and ranks chosen by name) and an **input × input** contribution |

**What remains, deliberately:**

- *Optional technical inspection*, kept separate: the read-only "Advanced: inspect the Definition as JSON" panel and its
  explicitly enabled developer editing; "Advanced expression" in the Formula editor; "Section keys (advanced)" without
  an imported rulebook.
- *Engine clamp arithmetic*: four policy helper Formulas written with `min` / `max` (for example "the Condition cap",
  "the Attack floor") have no contributions view; they stay as written, editable only as an advanced expression, and the
  reader requires their exact inputs. Their game-facing values (caps, minimums, reductions) are guided numbers.
- *Free written text* that is written text by nature (themes, notes, open questions, example forms, removal methods) is
  typed as text.
- *SUMMON_ACTION_MODEL* is a reserved, non-authorable kind (the catalog marks it not authorable; the capability registry
  says so). Its required behaviour — the action model, when the Summon acts, its own AP, who owns AP / HP / MP, Counter
  Actions and dismissal — is authored on each Summon engine (SUMMON_TYPE → "Who acts and who pays", browser P04), so no
  duplicate editor was built.

## 2. Maneuver Radius

- The published Radius is unchanged by default: **Martial Rank Base (Trained 5 / Expert 10 / Master 15 ft) × STR**
  (`rank_base * str`). Rendering it rewrites nothing (unit test).
- The Targeting editor now edits **values by Skill rank** (name, Skill, rank rows) and composes **"rank base × STR"** as one
  contribution (an input × another input); renaming a table renames the distance input that reads it.
- **Preview** of a saved Targeting: a sample rank, Stats and choices give each distance through M4 — the same Formula,
  rank row and default choices the builders bind. Game test: the preview equals the Maneuver builder's Targeting compiler
  at Trained, Expert and Master; a missing rank or Stat is named, never guessed.
- **Browser P14** (isolated WO12 test world): new revision → the table and contribution are shown → a *deliberate*
  isolated change Expert 10 → 12 → Save (validation PASS; stored formula unchanged) → preview Expert / STR 4 = 48 ft,
  Master = 60 ft, Trained / STR 3 = 15 ft → reopen (12 kept) → published in a test Release → a Character built on the
  earlier Release keeps its Release and an identical sheet.

## 3. Maneuver proof

**Browser P15**: a new Maneuver Condition ("Planted Stance": only when the Maneuver makes an attack roll; play check
"feet planted"; −1 AP) is authored in game language, published in a test Release, and a Character on that Release builds a
Maneuver through the real builder: the exact equipped Long Blade Attack (its own targeting), an Effect, Instant, and the
new Condition. The server's evaluation is valid, the cost drops by exactly 1 AP when the Condition is added, the
Condition's play-time restriction is carried (deferred to the play runtime), and the Maneuver is finalized (Revision 1).

## 4. Gameplay decisions — still deferred

The seven rulings stay open and nothing was invented: Cannot Move This Turn (−1 or −2 AP), Once per Mission (−5 AP versus
the 3 AP cap), Environmental Lock (−1 to −3 AP), Material (benefit), Risk (above −10%), Focus (GM-set value) and the
Permanent Duration (access and cost). The authoring controls for established rules do not depend on them.

## 5. Cone Attack Conversion — Draft only

- **Your workspace was not accessible from this session.** The linked computer exposes only the `prowess-studio`
  folder (a source checkout and outputs); the installed app's workspace database is not in it and no database port is
  reachable. So no Draft was created in your workspace and **no claim is made about your Characters**.
- **The procedure is proven** on the normal revision service in an isolated test world (**browser P16**): from the
  published revision (formula `5 * martial_rank`), "Create New Revision" → Calculated values → "Replace input martial_rank"
  → Martial Rank Value → Apply → Save Draft. The Draft's formula is `5 * martialRankValue`; everything else is identical;
  the published revision and every Release pin are unchanged; the Draft is in no manifest (not published).
- In your workspace: open *Cone Attack Conversion* (confirm it is the revision whose Length reads `5 * martial_rank`),
  then follow the same steps (walkthrough T32). The payload is also in the package
  (`cone-attack-conversion-revision-2.json`).

## 6. Verification

### 6.1 Final candidate `384d1b4`

All results below are from **one commit**: `384d1b4be8aef2ffbd5477c32ce0c8334504b718` (tree
`8470554e7ecfa49a4e7afef3f1d8d953a16e0e90`), checked out clean, run locally on 22 Nov 2026 in one uninterrupted run.
The working tree was clean before and after.

| Check | Result |
| --- | --- |
| Lint / architecture (14 rules, 7 packages) / typecheck / production build | pass |
| Studio unit | **3981 / 3981** |
| Game (`@prowess/game`) | **1939 / 1939** |
| DB unit | **193 / 193** |
| Model / rules (M4) / import / ui | 513 / 659 / 128 / 21 — all passed |
| Desktop boundary (`node --test`) | 2 / 2 |
| DB integration (2 shards, fresh migrated databases) | **309 + 352 = 661 / 661** |
| Studio integration | **247 / 247** |
| **Playwright — complete suite, one run, fresh test database** | **118 / 118 passed** (21.8 min), including P11–P13 and the new **P14** (Maneuver Radius), **P15** (Maneuver proof) and **P16** (Cone Draft) |
| Negative controls | RULES-WO1 **13/13**, M6-WO1 **18/18**, PRE-M7-WO1 **13/13**, M7-WO1 **10/10** — every mutation caught and restored byte for byte |
| New-kinds transfer proof | pass (R1 / R2 packs, idempotent replay, unchanged after restart) |
| Previous-build restore proof | pass — backup written by main `23f3c03` (app 0.1.2), 1,192,179 bytes, SHA-256 `a2a0922bdeb36f483b6e296d22be04cb57ab65f2c2797c3f862eedfe8b0b3b66`; 31 migrations identical; all 69 tables; 2 encounters, 3 participants, 8 events re-read; both Character sheets equal |
| Migrations | Fresh: 31 applied, no Prisma drift. Upgrade from the populated earlier chain: no drift; no pre-existing table changed. |
| 390 px timing (P06) | editor ready 317 ms; preview round trip 60 ms |

Local substitutions are unchanged from earlier checkpoints (migrations applied with `psql` from the committed files; drift
checked with the official WebAssembly schema engine; the transfer and previous-build proofs run copies of their scripts,
changed only in the migrate step). A first attempt at this run was stopped before any test result because the container
restarted and the database was down; it was restarted from the beginning on the same commit.

**Not run here:** hosted CI; Tier 2; both Windows installer jobs (including the installed upgrade from an installed earlier
build); the installed smoke test. All four are blocked by publication.

## 7. Publication (still blocked)

Repository access has not changed in this session, so the push was not retried. Once access exists: push the branch,
open a draft PR, let the required CI, Tier 2 and both Windows installer jobs run (including the installed upgrade), and
hand the `windows-package` installer (run, commit, SHA-256) to you for the walkthrough. Stop before merge.
