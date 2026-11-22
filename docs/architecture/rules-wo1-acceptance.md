# RULES-WO1 — acceptance criteria R01–R28: reconciled status

**Overall status: Partially complete.**

Outstanding:

- publication and the draft PR;
- hosted CI, including Tier 2 and both Windows installer jobs;
- the owner's walkthrough acceptance;
- the open gameplay questions in §3, including the Ability Condition and Permanent Duration decisions;
- publishing the prepared Cone Attack Conversion correction (needs the owner's approval);
- the remaining structured-data fields listed under R18.

**Candidate:** `0729b70775527237148ba85d6d332ab42162199f` (tree `cbbabad38c8b51685b3dca21ac130262c8604e75`). Every local result in §4 comes from that one commit.

**How this was reconciled.** The R01–R28 text below is the owner's, restored on 20 Nov 2026. In Phase F the owner's full
work order, including the narrative sections §4–§8, was attached; it is kept in the private project (never in the
repository). Every criterion below was re-checked against those sections — in particular §5 (no typed property names,
data types, IDs, locators or formulas; "a recursive object editor with friendly labels is still insufficient"), §6D
(Spells, Maneuvers, Mage Arts and Summons), §7 (one record per rule, lossless round trip) and §8 (a new component is
selectable and evaluated in the existing builder or preview) — and against the Core Playtest packet, read on the owner's
machine.

**Phase G.** R10, R11 and R18 were re-decided again after the remaining component editors were built (Targeting,
Duration, Casting / Maneuver Conditions, Foundations and an Effect's calculated values). Every allegedly undefined Ability
Condition requirement was re-checked against the source and the conflict register (§3): missing play-time support was
separated from undecided design, and the established portions were made authorable.

**Phase F reopenings.** R10, R11, R12, R14, R15 and R18 were reopened: their earlier evidence showed the workflows
existed, but Effects and Traits were still edited through contribution keys and recursive data editors, Mage Art benefits
were a category plus prose, Conditions said what they did only in text, and Summons had no hosts or access. R08 and R21
were updated: the Skill-benefit preview did not use the sheet's evaluation (a defect, now fixed).

**Correction from the Phases C/D matrix.** That matrix marked some criteria "verified locally" where the evidence was only
that a form existed and saved text. In particular:

- prerequisites that were stored but never evaluated;
- Summon action rules held only as prose;
- Condition triggers held only as prose;
- Mage Art scaling and benefits held only as text;
- no ammunition or modifications at all;
- Keyword editing missing.

Each of these is now implemented and tested as structure, or marked plainly below.

## 1. Support by family: authoring, validation, preview and live execution

| Family | Structured authoring (guided, no typed keys) | Validation (M5 reader) | Preview | Live execution |
| --- | --- | --- | --- | --- |
| Resolution, Stats, derived statistics | yes | yes | before / after rule preview | **live** |
| Calculated values (CALCULATED_VALUE) | yes | yes | sample Character | **partial**: sheet only |
| Skill benefits (SKILL_BENEFIT) | yes: rank, value additions with an optional situation, granted Actions by name, prerequisite groups (ALL / ANY) of Level, Stat, Skill rank or Affinity rank | yes | sample Character, with Affinity ranks — **the sheet's own evaluation** (Phase F) | **partial**: the sheet evaluates rank and prerequisites, adds unconditional bonuses, and lists granted Actions; the Action card marks the grant. Using the Action in play is unchanged. |
| Creation, advancement, Skills, Affinities | yes | yes | wizard / builders | **live** |
| Job templates | yes | yes | written | reference only |
| Actions, resources, terrain, size | yes | yes | play | **live** (terrain hazards and Massive size partial) |
| Spells, Maneuvers, construction rules | Whole Spells / Maneuvers: yes. **Every component in game language:** Effects and Traits (Phase F); Targeting, Durations, Casting / Maneuver Conditions and Foundations, and an Effect's calculated values (Phase G) | yes | builders (newly authored Effect, Targeting and Casting Condition are offered and costed — browser P11, P12) | **live** |
| Metamagic | yes | yes | written | reference only |
| Concentration rule (owner override) | yes | yes | capacity / upkeep | reference only; combat keeps the earlier policy |
| Mage Arts v2 | yes: modes; scaling by a Level table or a Formula over Stats and Level; **benefits with validated mechanics per kind** (Stat substitution: calculation and replacement Stat; range multiplier: target and multiplier; immunity, Advantage, sense, Counter Action, resource); structured maintenance exceptions; written text alongside | yes | scaling at a Level | reference only; the card stays unavailable |
| Weapons, Attacks, Equipment traits | yes | yes | library | **live** |
| Armor | yes | yes | AGI cap, Strength, movement, stealth | reference only |
| **Ammunition** (new) | yes: the weapon families it fits (by name), rounds per attack and per Burst | yes | Loading, Bursts, and Reload AP split over turns | reference only; play does not count rounds |
| **Weapon modifications** (new) | yes: structured changes (reload AP, loading, to-hit, damage dice, loud radius, range) plus written text | yes | the changes on a sample weapon | reference only |
| Conditions | yes: effects and triggers that **say what they do** (Advantage / Disadvantage on a roll, a modifier, damage, a resource change, a prevention, or written only), duration, removal, when it acts, stacking, structured triggers (on hit, failed save with its Stat, entering an area, start / end of turn, end of round) | yes | written | reference only; play does not apply Conditions |
| Summons (all 7 engines) | yes: tiers, costs, sustain, limits, who acts, who owns AP / MP, its own AP, Counter Actions, structured restrictions, dismissal, **hosts (what it is placed on or bound to) and access (prerequisite groups)**, plus written rules | yes | casting and sustain costs | reference only |
| Missions and gameplay reference rules | yes: roll tables, Threat Clocks, Intel, rule points, linked rules | yes (tables must cover every roll) | roll / clock | reference only |
| Keywords | create; **edit name, description and "deprecated"** (key and category never change; imported Keywords are read-only) | yes (stale edits refused) | usage shown before editing | live (names only) |

## 2. R01–R28

| ID | Criterion | Status | Evidence and limits |
| --- | --- | --- | --- |
| R01 | Source identity, governing overrides, verified GitHub baseline and exact CI recorded. | **Verified locally**; candidate CI pending | **Recorded:** source identity, overrides OV-01–OV-04, and the baseline `23f3c03`.<br>**Baseline CI:** run #285, all 18 jobs, verified by the owner.<br>**Candidate CI:** not run (R26). |
| R02 | Full source/system inventory covers every established family, including those absent/reserved in today's catalog. | **Verified locally** | The coverage inventory and §1. The capability registry has an entry for every kind, pinned by `rules-wo1-capabilities.test.ts`. Ammunition and modifications were added in this phase. SUMMON_ACTION_MODEL stays reserved, because its content is structured on each engine. |
| R03 | Installed generic-editor discrepancy reproduced or explained with build/route evidence; packaged build displays the intended UI. | **Explained; installed check hosted verification pending** | **Explanation:** loading each commit's own descriptors shows DIST-WO1/WO2 used the generic STAT editor.<br>**Installed check:** the installed smoke test (About page identity and guided kinds) runs only in the CI `windows-package` job. |
| R04 | All six Stat pages support readable descriptions, existing impacts, and adding a new relationship without technical fields. | **Verified locally** | **Browser "R04":** all six Stat pages, no writes, and a new value from AGI that already reads AGI. |
| R05 | Create Carry Capacity from Strength, configure a labelled test calculation, preview, publish and display it on a new test Character; no canonical formula invented. | **Verified locally** | **Browser V01–V05** and DB integration. The value is labelled TEST_ONLY. |
| R06 | Edit Throw Distance with its actual Skill/Stat dependencies and conditional applicability preserved. | **Verified locally** (game, DB, UI); no browser edit journey | **Calculation:** unstated base; Trained +5 ft per STR, Expert +5.<br>**Situations:** a bonus that applies only in a situation is stored with its condition and shown, never silently added. |
| R07 | Change/remove a Strength contribution and replace an input with another Stat; source references, impact graph and previews remain correct. | **Verified locally** | **Removal:** browser S01–S06 (preview, publication, impact graph and an R1 Character unchanged).<br>**Replacement:** browser "R04" (AGI → CON through the server rename).<br>**Not covered:** publishing a replaced input. |
| R08 | Create/edit progression choices and a Skill's Trained/Expert/Master benefit, including an Action and prerequisites. | **Verified locally** (authoring, validation, evaluation, sheet, Action card **and preview**); using a granted Action in play is unchanged | **Evaluation:** prerequisite groups (ALL / ANY) are evaluated by the shared Action-improvement evaluation (Level / Stat through NUMERIC_COMPARE; Skill and Affinity rank through the M6-WO4 rank check). An undecidable one is UNRESOLVED and is never granted.<br>**Phase F — preview = sheet:** the authoring preview runs the sheet's own `skillBenefitsForCharacter` on the sample (`skillBenefitsForSample`), passes the same eligibility to the calculated values, takes Affinity ranks, and names each input the sample left out. The old preview passed no eligibility, so a gated benefit never applied there (defect fixed).<br>**Tests:**<br>- game `rules-wo1-skill-benefit-preview.test.ts`: a real Character's sample equals its sheet (eligible / ineligible, ALL / ANY, Affinity ranks, granted Actions, gated values); missing inputs reported;<br>- DB "Phase D (R08)": both Characters' samples equal their sheets;<br>- preview panel and sheet UI tests; transfer proof. |
| R09 | Create/edit Affinity access, Keywords and component compatibility using readable controls. | **Verified locally** | **Keyword editing (new):**<br>- edits are presentation only, compare-and-set (a stale edit is refused and writes nothing);<br>- usage is shown first;<br>- an imported Keyword is refused plainly (the DIST-WO2 guard still applies).<br>Evidence: DB integration, browser P07, UI test and the transfer proof.<br>**Compatibility rules:** built from lists and pickers (UI test). |
| R10 | Compose a Spell with Effects, targeting, Traits, conditions and duration; child creation returns without losing parent changes. | **Verified locally** | **Phase F:** Effects and Traits in game language; browser **P11** authors "Flame Lash", publishes it in Release 2 and builds it into a Spell: 1 die = 5 MP, 2 dice = 8 MP from the server.<br>**Phase G:** Spell Targeting, Durations and Casting Conditions in game language; browser **P12** authors "Ember Ring" (an area around the caster, radius 10 ft + 5 ft per size step composed from contributions, 4 MP + 2 MP per 5 ft step) and "Steady Breath" (only when the Spell affects an area; −10% MP), publishes both in Release 2 and builds them into a Spell: 0 steps = 6 MP, 1 step = 8 MP, and the server lists and applies the 10% reduction. Every stored payload is accepted by the real M5 reader in unit tests (`rules-wo1-component-rules-ui`).<br>**Existing:** `pre-m7-wo1-guided-authoring.spec.ts`, `m6-signature-spell.spec.ts`. |
| R11 | Compose a Maneuver with foundation actions, attached Effects, costs, conditions and rank constraints. | **Verified locally** for authoring; a newly authored Maneuver component is not yet built into a Maneuver in a browser journey | **Phase F:** a Maneuver Effect can inherit the Maneuver's own roll, carry an Affinity-rank reduction and change how the Maneuver targets.<br>**Phase G:** Maneuver Targeting (no cost of its own), Maneuver Durations, Maneuver Conditions (AP or MP reductions only; an AP-or-MP choice) and non-attack Foundations (movement, defence, interaction, bound to an exact Maneuver Targeting) in game language — browser **P13** stores each exactly in its M5 contract; unit tests validate each with the M5 reader. A Weapon Attack Foundation stays derived from its Weapon and Attack.<br>**Existing:** `m6-signature-maneuver.spec.ts`. |
| R12 | Author a Mage Art with modes, scaling and maintenance exceptions; distinguish supported previews from unavailable play activation. | **Verified locally** (authoring, validation, preview); play activation unavailable by design | **Structured parts:** Level-table or Formula scaling (coverage-checked), maintenance exceptions, and — Phase F — **benefits with validated mechanics** per kind: a Stat substitution names the calculation it changes and the replacement Stat (they must differ); a range multiplier names what it multiplies and by how much; an immunity names an exact Condition or a damage type; an Advantage names its roll (and only a Skill Check names a Skill). A category plus prose is refused.<br>Evidence: game tests (every kind; ten refusals) and browser P08 (a Stat substitution, then the preview at a Level).<br>**Play:** the card stays UNAVAILABLE. |
| R13 | Author weapon/attack, armor/shield and property rules, with scaling and requirements preserved. | **Verified locally** (authoring, validation, preview); ammunition and modifications not executed in play | **Existing:** weapons, attacks and traits (M6). Armor is covered by browser P02.<br>**New:**<br>- **Ammunition**, fitted to families by name, with the reload split from the source example "5 AP as 3 + 2"; browser P09.<br>- **Weapon modifications**, with game tests.<br>**Shields:** weapon profiles, as in M6. |
| R14 | Author Conditions/durations/triggers and the revised Concentration capacity/upkeep model; include 6 RES and 5 casting-AP examples. | **Verified locally** (authoring, validation; Concentration preview); Conditions not applied in play | **Triggers:** structured.<br>**Outcomes (Phase F):** each effect and trigger says what it does — Advantage / Disadvantage on a roll, a modifier, damage dice and type, a resource change, what it prevents — or "written only" for GM judgment. Browser **P10** (Disadvantage on Attack Rolls; damage on a failed Resolve Save) and game tests.<br>**Concentration:** RES 6 → 3; a 5 AP cast → 2 AP upkeep; 0 / 1 / 2 points → 2 / 1 / 0 AP. |
| R15 | Per-family journeys cover Summon Entity, Totem, Persistent Construct, Bound Summon, Manifested Entity, Fusion and Equipment Summoning authoring. | **Verified locally** (authoring, validation, cost preview); no Summon runtime | **Browser P04:** all seven engines; Phase F adds a Bound Summon's hosts (creature, object) and an access group (Level 3).<br>**Game tests:** each engine, action and resource ownership, restrictions, hosts (each once, from the target categories) and access (the Skill-benefit prerequisite grammar).<br>**Trait access:** a Summon trait names the engines that may take it. |
| R16 | Author Mission grade/type tables, a Threat Clock template, rewards/complications and linked reference rules without raw field trees. | **Verified locally** | Browser P03 and P05, and the transfer proof. |
| R17 | Every family has a readable reference view and truthful publication/preview/consumer/runtime status. | **Verified locally** | The entry Overview and the Rules Reference Status panel, both from the capability registry. The registry wording was updated for Skill benefits, Mage Art previews, ammunition and modifications. |
| R18 | Standard workflows require no payload keys, raw JSON, technical formula syntax, IDs or manually entered source locators. | **Verified locally for Spell / Maneuver authoring; partially verified overall** | **Game language:** every Spell and Maneuver component — Effects and Traits (Phase F); Targeting, Durations, Casting / Maneuver Conditions, Foundations and an Effect's calculated values (Phase G). On these paths nothing asks for a property name, a contribution key, a data type, a recursive data editor or Formula syntax (unit tests assert it; browser P11–P13). Formulas are composed from contributions by the server; an Effect's inputs are named the way its reader requires. Ability Condition requirements are chosen from the compiled mechanics ("the ability affects an area") and play checks are named in plain words (play does not evaluate them yet).<br>**Still technical (missing implementation):** "Rule notes" of Actions, Resources, Creature Sizes and Terrain, and the reserved Summon action model, still use the structured-data editor; a Targeting's Skill-rank tables are kept but not edited.<br>**Advanced only:** "Section keys (advanced)" without an imported rulebook; the Formula expression. |
| R19 | Lossless round-trip, stale-write protection, atomic multi-record changes and safe cancel/unsaved-child recovery are verified. | **Verified locally** | DB integration Phase D (every new kind stored exactly, a stale save refused), the M2 atomic ChangeSet gates, the PRE-M7 child round trip, the transfer proof, and Keyword compare-and-set. |
| R20 | Invalid refs, cycles, malformed formulas, invalid units, out-of-range values and invalid tables fail with actionable errors and no unintended writes. | **Verified locally** | Game tests and DB tests (an invalid Draft cannot be submitted). Negative controls (§4). |
| R21 | Previews are read-only, use shared evaluators and exact candidate refs, and agree with supported published consumers. | **Verified locally** | **Read-only:** DB row-count checks.<br>**Shared evaluators:** all arithmetic goes through M4, including the reload split and Mage Art scaling.<br>**Agreement:** the Carry preview equals the published sheet; **Phase F:** the Skill-benefit preview equals the sheet for eligible and ineligible samples, ALL / ANY groups, Affinity ranks and granted Actions (game and DB tests). |
| R22 | R2 publication leaves R1 Characters, encounters, play state, Active Magic and history unchanged. | **Verified locally** | Browser V05, DB R08, and the transfer proof (R1 Character rows, play runtime and events, and the encounter are identical). |
| R23 | New records and links survive pack transfer into an independent workspace; preview remains read-only and replay remains idempotent. | **Verified locally** | **Transfer proof:** 14 new or activated kinds, the Mission → reference link, and idempotent replay. An imported Keyword stays read-only while a later pack installs. |
| R24 | Restart, upgrade and independent backup/restore preserve the new authoring data and old workspace data. | **Previous-build restore verified locally; installed Windows upgrade hosted verification pending** | **New proof** `verify-rules-wo1-previous-build-restore.mjs`: a backup written by **main `23f3c03` (app 0.1.2)'s own code**, from its own workspace, is accepted and restored by the candidate. Every table is identical, the encounters and Character rows match, and the Character sheets match the previous build's.<br>**Relabelled:** the transfer proof's backup step is now described as a *version-tag* check (this build's code, an older tag). |
| R25 | Desktop and 390 px layouts, keyboard use, labels/focus, empty/error states and representative performance measurements are verified. | **Verified locally for the RULES-WO1 editors** | Browser P06 (timings in §4). Older screens are covered by their own milestones' tests. |
| R26 | Existing gates plus new behavior tests pass; exact candidate CI includes Tier 2 and both Windows installer jobs. | **Local gates verified; hosted CI blocked** | Publication is refused by the session's git proxy. |
| R27 | Owner walkthrough can complete representative tasks without developer instructions; owner acceptance is recorded separately and never fabricated. | **Owner acceptance pending** | The walkthrough has tasks T1–T18. |
| R28 | Implementation report, coverage matrix, decisions, invariants, API/schema registries, evidence and PR are complete; no merge or M7-WO2 start. | **Complete locally; PR blocked** | **API routes:** 6 RULES-WO1 routes (two new Keyword routes).<br>**Migrations:** none.<br>**Approved-M5-change registry:** updated.<br>Not merged. RULES-WO2, RULES-WO3 and M7-WO2 were not started. |

## 3. Unresolved gameplay questions (recorded, not answered)

| Topic | Open question |
| --- | --- |
| Carry Capacity | The canonical formula is not supplied (test content only). |
| Throw Distance | The base is not stated. |
| Concentration | Reassignment while active (Q-01); a save policy under OV-03 (Q-02); whether Sustained Summons and Mage Arts use point allocation (Q-03); Expert Arcana +1 (Q-04). |
| Summons | Whether each engine counts toward Concentration (left "Not decided" per engine). Engine-specific runtime rules wait for a Summon runtime. |
| Mage Arts | D1–D3: cost shape, structured effects, and activation / Signature investment. |
| M5-SC-052 / M5-SC-053 | Mana Lock amount; Channel-completion MP. |
| Massive size and terrain hazards | Massive's movement adjustment; hazard effects (pending canon). |
| Ability Conditions — M5-SC-043 | **Cannot Move This Turn:** s2020 (Common Conditions) lists −1 AP; s2099 (Movement Conditions) lists −2 AP for the same restriction. Decision needed: which value. |
| Ability Conditions — M5-SC-044 | **Once per Mission:** s2020 lists −5 AP, but ruling SC-025 caps a Maneuver's Conditions at 3 AP — is it −3 AP (capped), or an exception to the cap? **Environmental Lock:** "−1 to −3 AP" — what sets the value (fixed per authored Condition by severity, or chosen in play)? **Material (s674):** "the benefit depends on the Material used" — what benefit does a Material give? **Risk (s675):** "−10% MP or more" — what earns more than −10%? **Focus (s675):** "GM-set reduction" — may the ruleset author fix it per authored Focus Condition (within the rank cap)? Established and authorable now: an exact Delayed (−10% MP), Environmental (−15% MP) or Weapon Lock (−1 AP) instance naming its subject (unit tests). |
| Durations — M5-SC-045 | **Permanent (s657 "special rules only"):** which requirement grants it and what it costs. s662's indefinite Sustain is a different rule. |
| Cone Attack Conversion | Meaning established (5 ft × Martial Rank; Expert 10 ft, Master 15 ft; the Trained 5 ft row cannot be reached because the Effect requires Martial Expert). The defect is representation only (`martial_rank`). The correction is prepared as a new revision and proven in an isolated test Release; publishing it into the owner's ruleset awaits approval. |
| Ammunition | How many rounds a magazine or quiver holds is not stated generally (weapons state Loading). Play does not count rounds. |

## 4. Evidence (one commit)

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

**Superseded runs, not combined with the above:**

- `2f62e05` (`2f62e05b435cdb20ae04f28f02e511a2a6c5c3ec`): Everything passed except two items: (1) the M6-WO1 control "allow an Effect resolution field on Targeting" could not apply its mutation, because its anchor (the Targeting descriptor's Geometry field) moved when the guided Targeting editor replaced it — the control was re-anchored in `0729b70` with the same mutation and guard; (2) one Playwright journey (M6-WO10 "a full turn …") timed out after 5 s waiting for the Play Workspace on its first page load (114 / 115); re-run alone on the same build it passed (4 / 4), and it is unaffected by Phase G. Logs are kept with the run.
- `df76bb6` (Phase F): fully verified — Studio unit 3952, game 1927, DB unit 191, DB integration 661, Studio integration 247,
  Playwright 113 / 113, all controls, transfer, previous-build and migration proofs passed (Phases F and G report §5.2).
  These results remain evidence for that candidate.
- `ef18499` (Phase E) and earlier: see the Phase E and Phases C/D reports.
