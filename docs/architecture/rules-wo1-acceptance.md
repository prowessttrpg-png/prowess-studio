# RULES-WO1 — acceptance criteria R01–R28: reconciled status

**Overall status: Partially complete.**

Four things are outstanding:

- publication and the draft PR;
- hosted CI, including Tier 2 and both Windows installer jobs;
- the owner's walkthrough acceptance;
- the open gameplay questions in §3.

**Candidate:** `ef184993841c4a450db50cc454f5940ac6fad763` (tree `729c477d5d3f239ec435d7b46c23328d194fec80`). Every local result in §4 comes from that one commit.

**How this was reconciled.** The R01–R28 text below is the owner's, restored on 20 Nov 2026. The work order's narrative
sections (§4–§8) are not stored in the project or the repository, so this reconciliation was checked against two things:

- the criteria themselves;
- the Core Playtest packet, read on the owner's machine: Conditions in Combat, the Summoning chapters, Mage Arts,
  Mechanical Ranged Weapons (Ammo, Loading, Reload) and the crafting modification slots.

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
| Skill benefits (SKILL_BENEFIT) | yes: rank, value additions with an optional situation, granted Actions by name, prerequisite groups (ALL / ANY) of Level, Stat, Skill rank or Affinity rank | yes | sample Character | **partial**: the sheet evaluates rank and prerequisites, adds unconditional bonuses, and lists granted Actions; the Action card marks the grant. Using the Action in play is unchanged. |
| Creation, advancement, Skills, Affinities | yes | yes | wizard / builders | **live** |
| Job templates | yes | yes | written | reference only |
| Actions, resources, terrain, size | yes | yes | play | **live** (terrain hazards and Massive size partial) |
| Spells, Maneuvers, construction rules | yes | yes | builders | **live** |
| Metamagic | yes | yes | written | reference only |
| Concentration rule (owner override) | yes | yes | capacity / upkeep | reference only; combat keeps the earlier policy |
| Mage Arts v2 | yes: modes; scaling by a Level table or a Formula over Stats and Level; structured benefits; structured maintenance exceptions; written text alongside | yes | scaling at a Level | reference only; the card stays unavailable |
| Weapons, Attacks, Equipment traits | yes | yes | library | **live** |
| Armor | yes | yes | AGI cap, Strength, movement, stealth | reference only |
| **Ammunition** (new) | yes: the weapon families it fits (by name), rounds per attack and per Burst | yes | Loading, Bursts, and Reload AP split over turns | reference only; play does not count rounds |
| **Weapon modifications** (new) | yes: structured changes (reload AP, loading, to-hit, damage dice, loud radius, range) plus written text | yes | the changes on a sample weapon | reference only |
| Conditions | yes: effects, duration, removal, when it acts, stacking, **structured triggers** (on hit, failed save with its Stat, entering an area, start / end of turn, end of round) | yes | written | reference only; play does not apply Conditions |
| Summons (all 7 engines) | yes: tiers, costs, sustain, limits, **who acts, who owns AP / MP, its own AP, Counter Actions, structured restrictions, dismissal**, plus written rules | yes | casting and sustain costs | reference only |
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
| R08 | Create/edit progression choices and a Skill's Trained/Expert/Master benefit, including an Action and prerequisites. | **Verified locally** (authoring, validation, evaluation, sheet and Action card); using a granted Action in play is unchanged | **Evaluation:** prerequisite groups (ALL / ANY) are evaluated by the shared Action-improvement evaluation (Level / Stat through NUMERIC_COMPARE; Skill and Affinity rank through the M6-WO4 rank check). An undecidable one is UNRESOLVED and is never granted.<br>**Tests:**<br>- DB integration "Phase D (R08)": an eligible and an ineligible Character, bonuses, the Action grant, and an R1 Character unchanged;<br>- game tests;<br>- sheet UI test;<br>- transfer proof. |
| R09 | Create/edit Affinity access, Keywords and component compatibility using readable controls. | **Verified locally** | **Keyword editing (new):**<br>- edits are presentation only, compare-and-set (a stale edit is refused and writes nothing);<br>- usage is shown first;<br>- an imported Keyword is refused plainly (the DIST-WO2 guard still applies).<br>Evidence: DB integration, browser P07, UI test and the transfer proof.<br>**Compatibility rules:** built from lists and pickers (UI test). |
| R10 | Compose a Spell with Effects, targeting, Traits, conditions and duration; child creation returns without losing parent changes. | **Verified locally** (existing) | `pre-m7-wo1-guided-authoring.spec.ts`, `m6-signature-spell.spec.ts`. |
| R11 | Compose a Maneuver with foundation actions, attached Effects, costs, conditions and rank constraints. | **Verified locally** (existing) | `m6-signature-maneuver.spec.ts` and the Maneuver construction editors. |
| R12 | Author a Mage Art with modes, scaling and maintenance exceptions; distinguish supported previews from unavailable play activation. | **Verified locally** (authoring, validation, preview); play activation unavailable by design | **Structured parts:** Level-table or Formula scaling (coverage-checked), structured benefits, and exceptions. Evidence: game tests and browser P08 (preview at a Level).<br>**Play:** the card stays UNAVAILABLE. |
| R13 | Author weapon/attack, armor/shield and property rules, with scaling and requirements preserved. | **Verified locally** (authoring, validation, preview); ammunition and modifications not executed in play | **Existing:** weapons, attacks and traits (M6). Armor is covered by browser P02.<br>**New:**<br>- **Ammunition**, fitted to families by name, with the reload split from the source example "5 AP as 3 + 2"; browser P09.<br>- **Weapon modifications**, with game tests.<br>**Shields:** weapon profiles, as in M6. |
| R14 | Author Conditions/durations/triggers and the revised Concentration capacity/upkeep model; include 6 RES and 5 casting-AP examples. | **Verified locally** (authoring, validation; Concentration preview); Conditions not applied in play | **Triggers:** now structured, rather than timing text.<br>**Concentration:** RES 6 → 3; a 5 AP cast → 2 AP upkeep; 0 / 1 / 2 points → 2 / 1 / 0 AP. |
| R15 | Per-family journeys cover Summon Entity, Totem, Persistent Construct, Bound Summon, Manifested Entity, Fusion and Equipment Summoning authoring. | **Verified locally** (authoring, validation, cost preview); no Summon runtime | **Browser P04:** all seven engines.<br>**Game tests:** each engine, plus action and resource ownership and the restrictions. |
| R16 | Author Mission grade/type tables, a Threat Clock template, rewards/complications and linked reference rules without raw field trees. | **Verified locally** | Browser P03 and P05, and the transfer proof. |
| R17 | Every family has a readable reference view and truthful publication/preview/consumer/runtime status. | **Verified locally** | The entry Overview and the Rules Reference Status panel, both from the capability registry. The registry wording was updated for Skill benefits, Mage Art previews, ammunition and modifications. |
| R18 | Standard workflows require no payload keys, raw JSON, technical formula syntax, IDs or manually entered source locators. | **Verified locally**, with two noted options | **Plain words or lists for:**<br>- every name field (older M6 fields too);<br>- Skills and ranks in prerequisites;<br>- rank ladders;<br>- Weapon families;<br>- compatibility relations and allowed entries;<br>- restriction names.<br>The M6-WO1 browser journey was updated to the new interaction; the server still refuses malformed raw tokens (M5 reader tests and API tests).<br>**Two options remain, neither needed for a standard workflow:**<br>- "Section keys (advanced)", for a workspace without an imported rulebook;<br>- the Formula expression, which is shown and can be edited, but the contribution controls cover authoring. |
| R19 | Lossless round-trip, stale-write protection, atomic multi-record changes and safe cancel/unsaved-child recovery are verified. | **Verified locally** | DB integration Phase D (every new kind stored exactly, a stale save refused), the M2 atomic ChangeSet gates, the PRE-M7 child round trip, the transfer proof, and Keyword compare-and-set. |
| R20 | Invalid refs, cycles, malformed formulas, invalid units, out-of-range values and invalid tables fail with actionable errors and no unintended writes. | **Verified locally** | Game tests and DB tests (an invalid Draft cannot be submitted). Negative controls (§4). |
| R21 | Previews are read-only, use shared evaluators and exact candidate refs, and agree with supported published consumers. | **Verified locally** | **Read-only:** DB row-count checks.<br>**Shared evaluators:** all arithmetic goes through M4, including the reload split and Mage Art scaling.<br>**Agreement:** the Carry preview equals the published sheet. |
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
| Ammunition | How many rounds a magazine or quiver holds is not stated generally (weapons state Loading). Play does not count rounds. |

## 4. Evidence (one commit)

All results below are from **one commit**: `ef184993841c4a450db50cc454f5940ac6fad763` (tree
`729c477d5d3f239ec435d7b46c23328d194fec80`), checked out clean, run locally on 20–21 Nov 2026.

The container restarted partway through the run. When it did:

- lint, architecture checks, typecheck, the build and every unit suite had already finished on this commit;
- the remaining steps were re-run from the start, on the same clean commit.

| Check | Result |
| --- | --- |
| Lint / architecture (14 rules, 7 packages) / typecheck / production build | pass |
| Studio unit | **3938 / 3938** |
| Game (`@prowess/game`) | **1910 / 1910** |
| DB unit | **191 / 191** |
| Model / rules (M4) / import / ui | 513 / 659 / 128 / 21 — all passed |
| Desktop boundary (`node --test`) | 2 / 2 |
| DB integration (2 shards, fresh migrated databases) | **309 + 352 = 661 / 661** |
| Studio integration | **247 / 247** |
| **Playwright — complete suite, one run, fresh test database** | **111 / 111 passed** (19.2 min) |
| Negative controls | RULES-WO1 **13/13**, M6-WO1 **18/18**, PRE-M7-WO1 **13/13**, M7-WO1 **10/10**. Every mutation was caught and restored byte for byte, and the working tree was unchanged. |
| New-kinds transfer proof | pass |
| Previous-build restore proof | pass (details below) |
| Migrations | Fresh: 31 applied, with no Prisma drift. Upgrade from a populated earlier chain: 0 pre-existing tables changed, no drift. |
| 390 px timing (P06) | editor ready 265 ms; preview round trip 104 ms |

**New-kinds transfer proof.**

- Two content packs:
  - R1: 743,781 bytes.
  - R2: 772,340 bytes.
- The receiver holds all 14 new or activated kinds, and the Mission → reference link.
- Replaying a pack is idempotent.
- An imported Keyword's edit is refused (IMPORTED_READ_ONLY) and the row is unchanged, while R2 still installs.
- After a restart, nothing has changed.
- The version-tag backup / restore leaves 69 tables unchanged.

**Previous-build restore proof** (`verify-rules-wo1-previous-build-restore.mjs`).

- The backup was written by main `23f3c03` (tree `11f95d5…`, app 0.1.2) using its own code.
- The backup is 1,192,145 bytes, SHA-256 `93a421ee…9e55`.
- It was restored by the candidate (app 0.1.3, clean tree): 31 migrations on both sides, identical.
- All 69 tables are identical after the restore.
- The candidate's code re-reads 2 encounters, 3 participants and 8 events, and they match.
- The Character sheets match the previous build's for both Characters.
- Reading the restored workspace writes nothing.

**Local substitutions** are unchanged from earlier checkpoints:

- migrations are applied with `psql` from the committed `migration.sql` files;
- drift is checked with the official WebAssembly schema engine;
- the transfer and previous-build proofs run copies of their scripts, changed only in the migrate step.

**Not run here:**

- hosted CI;
- Tier 2;
- both Windows installer jobs (including the installed upgrade from an installed earlier build);
- the installed smoke test.

All four are blocked by publication.

**Superseded runs, not combined with the above:**

- `eb1307f`: everything passed except one DB-integration audit, which did not yet list the two Keyword services. That is
  fixed in `ef18499`.
- Before that, `5c2ae52` and earlier: see the Phases C/D report.

