# RULES-WO1 — Complete Game Authoring: plan, source register and coverage inventory

Status: **Partially complete.** Phases A–E are built and verified locally on `ef18499`. Still outstanding: publication, hosted CI (with Tier 2 and the Windows installers) and the owner walkthrough. The reconciled R01–R28 status is in `rules-wo1-acceptance.md`. Branch `rules-wo1-complete-game-authoring` from `main`
`23f3c03e95da4c7a4c1db51449d79754895adecb`. This document is the Phase A deliverable: verified baseline, source and
override register, build-identity finding, whole-game coverage inventory, architecture plan and decision ledger. It is
updated at each phase checkpoint.

## 1. Baseline (R01)

| Record | Value | Verification |
| --- | --- | --- |
| M7-WO1 PR | #78, merged | `origin/main` merge commit `23f3c03` ("Merge pull request #78 …") |
| Baseline `main` | `23f3c03e95da4c7a4c1db51449d79754895adecb` | `git fetch origin main`, 19 Nov 2026 |
| Tree | `11f95d50e50b010cf635fada99e4d17e318b6de5` | `git rev-parse origin/main^{tree}`. It equals the M7-WO1 review candidate `27db918`'s tree. |
| Merged-main CI | Run #285 (`44438453243`) on `23f3c03…` | **Passed — all 18 jobs**, independently verified by the owner (19 Nov 2026). This is the BASELINE result; it says nothing about the RULES-WO1 candidate, which has no hosted CI run yet. |
| Prior verified main | `4714d08…` (PRE-M7 PR #77, CI #283, Success) | M7-WO1 report §0 |

Publication from this session is blocked. The git proxy refuses pushes ("repository not in this session's authorized
repository set"). Checkpoints are delivered as verified git bundles until that changes.

## 2. Source identity and override register

| Record | Value |
| --- | --- |
| Primary playtest | The Core Playtest packet supplied by the owner into the connected `prowess-studio/Prowess Playtest Document/` folder (its file name and hash are recorded only in the M3-WO9 import report, per M3-I19) |
| Bytes / SHA-256 | Measured on the owner's machine on 19 Nov 2026; they **match** `docs/import-reports/m3-wo9-core-playtest-v0.1.md` exactly. This is a reaffirmation, not new bytes, so nothing is re-imported. |
| Structure (for inventory) | 126,740 words; 772 tables; 2,487 headings (759 H1, 1,394 H2, 320 H3, 14 H4). These were read on the owner's machine. The text is not committed. |
| Approved parser | `prowess-docx-structure@1.0.0`; recorded structure hash `3d9a429c…`. It is not re-run, because the source bytes are unchanged. |

### Overrides and rulings

| ID | Scope | Governing rule | Supersedes | Status |
| --- | --- | --- | --- | --- |
| OV-01 | Concentration capacity | `1 + floor(RES / 3)`. Example: RES 6 → 3. | Packet s664 "1 + 1 per 2 Resolve". The shipped M5 content (`active-magic.ts`) has `1 + floor(res / 2)`. The post-WO4 rulings batch said "+1 per 3 RES" with no stated base. | Owner-confirmed during this assignment. Applies to new authoring defaults. |
| OV-02 | Sustained Spell AP upkeep | `max(1, floor(casting AP / 2))` per round | Packet "1 AP per round"; shipped `sustainApPerRound: 1` | Owner-confirmed |
| OV-03 | Concentration semantics | An **upkeep-allocation** resource. Each allocated point covers 1 AP of upkeep per round. Points may be split across maintained Effects or stacked on one. Uncovered AP is still paid. MP upkeep and Mana Lock are unaffected. Points are occupied while assigned and return when the Effect ends. | "Maximum number of maintained Effects" (s664 and the M5-SC-007 ruling) | Owner-confirmed |
| OV-04 | Movement | Base Movement = 5 ft × AGI | s156 example "10 × AGI" | Earlier designer ruling (M5-SC-006); unchanged |

Published Releases are immutable. OV-01 to OV-03 reach content only through new Drafts and the governed
Draft → ChangeSet → Release path. The shipped `core-playtest-v0.1` content is a historical fixture and is not edited.

### Questions recorded, not decided

| ID | Question | Blocks |
| --- | --- | --- |
| Q-01 | Cost and timing of **reassigning** Concentration points between Effects that are still active | Runtime lifecycle only (M7-WO6) |
| Q-02 | Whether a Concentration Save policy still exists under OV-03. The packet's DC 8 +2 per effect was tied to the old count model. | Runtime and save previews |
| Q-03 | Whether Sustained **Summons** and **Mage Arts** use OV-03 allocation. The packet says "Sustained Summons count toward Concentration"; s1911 / s1974 count Mage Arts against capacity. | Summon and Mage Art upkeep previews (shown as unresolved) |
| Q-04 | Expert Arcana "+1 Concentration": whether it is still +1 capacity point under OV-01 | Skill benefit preview (the benefit is kept, labelled unconfirmed) |
| Q-05 | Carry Capacity: no formula exists in the packet (s208 lists "lifting" under STR; s… "carry more gear" is prose) | R05 uses an owner-provided value or a **labelled test-only** calculation; nothing canonical is invented |
| Q-06 | Base Throw Distance: Athletics grants "+5 ft per STR" (Trained) and "+5 to Base Throw Distance" (Expert), but no base value is stated | R06 preserves both benefits and their conditions; the base is shown as "not stated in the source" |
| Q-07 | Mage Art D1–D3 (carried forward from PRE-M7) | WO9 play activation |
| Q-08 | M5-SC-052 (Mana Lock amount) and M5-SC-053 (Channel-completion MP) | M7-WO6 |

## 3. The installed-editor discrepancy (R03)

The owner's screenshot shows `/compendium/admin/entities/…/revisions/…` for a STAT. The page has the banner "This kind has
no dedicated authoring descriptor yet" and a recursive field tree (`stat: Text STR`, `source → locators → s20…`).

**Finding (from the code).**

- That banner is `GENERIC_DESCRIPTOR.purpose`. Current source routes STAT v1 to the guided `CORE_KIND_DESCRIPTORS.STAT`.
- That descriptor was introduced in `20bce49` (PRE-M7-WO1 Phase C, 16 Nov 2026), so it is first in `main` at
  `4714d08`.
- At the DIST-WO1 installer commit `332639f` (`apps/studio` 0.1.1) and at DIST-WO2 `16ee5c6` (0.1.2),
  `CORE_KIND_DESCRIPTORS` does not exist, so STAT falls back to the generic editor. **Any installer built before
  `4714d08` shows exactly the screenshot.**
- The application version has been **0.1.2 since DIST-WO2**, so the version alone cannot tell the builds apart. Only the
  launcher's "Download diagnostics" JSON (`commit`, `tree`) identifies the build. That is a file download, not a visible
  screen.

**Decision.** Build identity becomes visible in ordinary UI: an **About this build** page in Studio showing the version, commit, tree and package fingerprint, plus which kinds
this build edits with a guided editor. The installer passes the identity to the
Studio server. The version is bumped so that a new installer is distinguishable.

**Reproduction (Phase B, code level).** Each commit's own `descriptors.ts` was loaded unchanged and asked which editor
it gives a STAT v1 Definition:

| Commit | `apps/studio` version | STAT editor | CALCULATED_VALUE editor |
| --- | --- | --- | --- |
| `332639f` (DIST-WO1) | 0.1.1 | generic technical tree | — (kind did not exist) |
| `16ee5c6` (DIST-WO2) | 0.1.2 | generic technical tree | — |
| `4714d08` (PRE-M7-WO1) | 0.1.2 | guided | — |
| this branch | 0.1.3 | guided | guided |

So two installers both labelled 0.1.2 behave differently, which is consistent with the screenshot. This is not proof of
which build the owner has installed.

**Remaining evidence step.** The owner's own build identity: the launcher's "Download diagnostics" `commit`, or (after
installing this branch) the About page. It is requested, not assumed. A browser reproduction of both builds against one
seeded Release is part of the Phase D installed check.

About is in the main navigation (added in Phase C).

## 4. Whole-game coverage inventory (R02, initial)

**Legend.**

- **Rec / contract:** the authoritative Definition kind and schema.
- **Ed:** guided, game-language editor (G = guided; T = technical recursive tree; — = none).
- **Val:** validated by the M5 contract.
- **Pre:** preview.
- **Pub:** published and in packs.
- **Con:** a named application consumer.
- **Run:** live execution.

This is the Phase A floor. Rows are expanded to individual entries as Phase C proceeds.

| # | Family | Source (H1 sections) | Override | Rec / contract today | Ed | Val | Pre | Pub | Con | Run | RULES-WO1 work |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Gameplay basics and resolution | §§9–26, 93–96 | — | CORE_RESOLUTION, CHARACTER_DIE_PROGRESSION, RANK_LADDER | G (form) | yes | partial | yes | play rolls, sheet | partial | Game-language entry shell; difficulty and critical tables; written procedures |
| 2 | Stats and calculations | §14 and per-Stat effects | OV-04 | STAT, DERIVED_STAT (17 closed statistics) | G (form) | yes | yes (rule preview) | yes | sheet, play | yes | **New authored calculated values** (CALCULATED_VALUE): e.g. Carry Capacity; contributions, conditions, tables; sheet extension area |
| 3 | Character creation and progression | §§27–45 (Races, Jobs) | — | ANCESTRY, CHARACTER_CREATION_RULE, CHARACTER_ADVANCEMENT_RULE, AFFINITY_PROGRESSION | G | yes | wizard | yes | creation, advancement | yes | Job Class templates (absent); starting-gear choices (absent); readable choices and prerequisites |
| 4 | Skills | §§47–76 (13 Skills; Trained / Expert / Master) | — | SKILL, SKILL_RANK | G (identity only) | yes | — | yes | creation | ranks only | **Rank benefits** (grants, bonuses, Actions, Counter Actions, passives, prerequisites), e.g. Athletics Throw Distance |
| 5 | Combat and resources | §§77–105 | OV-02 | ACTION, ACTION_IMPROVEMENT, RESOURCE, TERRAIN, CREATURE_SIZE | G | yes | play | yes | play | partial | Cover, reach and range tables; grappling and flanking as written rules with structured parts |
| 6 | Affinities and Keywords | §§182–185 | — | AFFINITY v1 / v2, AFFINITY_RANK_RULE, AFFINITY_WEAKNESS_SEVERITY; Keywords (no screen) | G | yes | — | yes | builders | yes | Keyword authoring screen; component compatibility |
| 7 | Spell construction | §§152–351 (6 branches: Damage, Healing / Cleanse, Buff, Debuff, Control, Interference) | OV-01 to OV-03 | SPELL_* components, SPELL_DEFINITION, ABILITY_CONSTRUCTION_RULE | G (slots) | yes | builder | yes | Signature Spell builder, play | yes | Branch subdivisions; Metamagic (absent); Concentration upkeep preview |
| 8 | Maneuver construction | §§598–651 | — | MANEUVER_* , MANEUVER_DEFINITION | G (slots) | yes | builder | yes | Signature Maneuver builder | yes | Condition discount scale, AoE conversion, rank constraints |
| 9 | Mage Arts | §§592–597 | Q-07 | MAGE_ART v1 (fixed costs plus prose) | G | yes | — | yes | — (card unavailable) | no | Modes with own scaling and level tables; granted benefits; maintenance exceptions |
| 10 | Equipment | §§106–151 | — | WEAPON, ATTACK, EQUIPMENT_TRAIT; **ARMOR reserved** | G (weapon) | yes | library | yes | sheet, play | yes | **Armor and Shields** (new contract); ammunition and reload; modifications |
| 11 | Conditions and ongoing magic | §§101, 170–181, 631–651 | OV-01 to OV-03 | **STATUS_CONDITION reserved**; Active Magic policy inside ABILITY_CONSTRUCTION_RULE | — | — | — | — | play (WO13 Active Magic) | partial | **Conditions** (new contract); Concentration capacity and upkeep model with preview |
| 12 | Summoning and entity creation | §§354–591 (7 engines) | Q-03 | **SUMMON_TYPE / SUMMON_TRAIT / SUMMON_ACTION_MODEL reserved** | — | — | — | — | — | no | **New contracts per engine**: Summon Entity, Totem, Persistent Construct, Bound Summon, Manifested Entity, Fusion, Equipment Summoning |
| 13 | GM and Mission rules | §§652–759 | — | **MISSION_RULE reserved** | — | — | — | — | — | no | **Mission tables** (grade, type, location, complication, reward, clause: die ranges), Threat Clock templates, Intel Tokens, reference rules |
| 14 | Written reference (all families) | whole packet | — | `shortDescription` / `rulesText` on Entity versions | prose | n/a | — | yes | Rules Reference | n/a | Proper written-rule authoring per entry; truthful status badges |

"Form exists" is not "rule executes". Each row's **Run** column comes from the real consumers, and the entry page shows
it as a status badge (§5.4).

## 4b. Whole-game coverage at the Phase E candidate (R02)

Each family is shown against four separate kinds of support: structured authoring, validation, preview and live
execution. The live column comes from the code-declared capability registry
(`packages/prowess-db/src/compendium-rules/capabilities.ts`, pinned by `rules-wo1-capabilities.test.ts`). Every entry
page states the same in its "Live in play" line. **A guided editor never implies live execution.**

| # | Family | Definition kinds | Structured authoring | Validation | Preview | Live execution |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Gameplay basics | CORE_RESOLUTION, CHARACTER_DIE_PROGRESSION, RANK_LADDER, REFERENCE_RULE | yes | yes | rule preview; table lookup | resolution **live**; reference rules reference only |
| 2 | Stats and calculations | STAT, DERIVED_STAT, CALCULATED_VALUE | yes | yes | rule preview; sample Character | Stats and derived values **live**; calculated values **partial** (sheet) |
| 3 | Creation and progression | ANCESTRY, CHARACTER_CREATION_RULE, CHARACTER_ADVANCEMENT_RULE, AFFINITY_PROGRESSION, JOB_TEMPLATE | yes | yes | wizard | **live**; Job templates reference only |
| 4 | Skills | SKILL, SKILL_RANK, SKILL_BENEFIT (rank; additions, optionally situational; granted Actions; prerequisite groups) | yes | yes | sample Character | ranks **live**. Benefits **partial**: the sheet evaluates rank and prerequisites, adds unconditional bonuses, and lists granted Actions; the Action card marks them. Using an Action in play is unchanged. |
| 5 | Combat and resources | ACTION, ACTION_IMPROVEMENT, RESOURCE, TERRAIN, CREATURE_SIZE | yes | yes | play | **live** (terrain hazards and Massive size partial) |
| 6 | Affinities and Keywords | AFFINITY v1 / v2, AFFINITY_RANK_RULE, AFFINITY_WEAKNESS_SEVERITY; Keywords | yes; Keyword create **and edit** (presentation only; imported ones read-only) | yes | builders; Keyword usage | **live** |
| 7 | Spell construction | SPELL_*, ABILITY_CONSTRUCTION_RULE, METAMAGIC, CONCENTRATION_RULE | yes (compatibility rules from lists and pickers) | yes | builder; Concentration preview | Spells **live**; Metamagic and the Concentration override reference only |
| 8 | Maneuver construction | MANEUVER_* | yes | yes | builder | **live** |
| 9 | Mage Arts | MAGE_ART v1 / v2 (Level-table or Formula scaling, structured benefits and exceptions) | yes | yes | scaling at a Level | reference only (card unavailable) |
| 10 | Equipment | WEAPON (including shield profiles), ATTACK, EQUIPMENT_TRAIT, ARMOR, **AMMUNITION**, **WEAPON_MODIFICATION** | yes | yes | library; Armor; reload split; modified sample weapon | weapons **live**; Armor, ammunition and modifications reference only |
| 11 | Conditions | STATUS_CONDITION (structured triggers) | yes | yes | written | reference only |
| 12 | Summoning | SUMMON_TYPE (7 engines, action model, AP / MP ownership, restrictions, dismissal), SUMMON_TRAIT; SUMMON_ACTION_MODEL reserved | yes | yes | costs | reference only |
| 13 | GM and Missions | MISSION_RULE (roll tables, clocks, Intel, rule points, linked rules) | yes | yes; tables must cover every roll | roll / clock | reference only |
| 14 | Written reference | names, descriptions and rules text; entry pages; title source picker; Rules Reference Status | yes | n/a | Rules Reference | n/a |

**Not modelled in RULES-WO1 (recorded, not hidden):**

- Spell-branch subdivisions as separate contracts;
- difficulty and critical tables as executable rules (they are written REFERENCE_RULE tables);
- every runtime named "reference only" above. Those are later Work Orders.

## 5. Architecture plan

### 5.1 Principles

- **No new engine.**
  - M5 readers remain the only validators.
  - M4 Formula programs remain the only arithmetic.
  - New contracts are additive kinds or versions in `@prowess/game`, through the approved-M5-change registry.
  - M4 stays frozen.
- **Studio renders server projections.** The server translates game-language edits ("Strength adds 5 ft per point") into
  exact payloads and Formula programs through the existing `formula-guide`, and back again.
- **One record per rule.** A Stat page *shows* every rule that reads the Stat (the rule graph). Adding "Carry Capacity"
  from Strength creates **one** calculated-value Definition, not a field on STAT.

### 5.2 New and extended contracts (Phase B / C)

| Contract | Purpose | Consumer in RULES-WO1 |
| --- | --- | --- |
| `CALCULATED_VALUE` v1 | An authored value: name, description, unit, contributions as an M4 Formula over game inputs (Stats, Level, other values, Skill rank), bounds, rounding, optional conditional applicability, display location, and a **canon status** (CANONICAL / OWNER_PROVIDED / TEST_ONLY) | The Character sheet "Additional values" section evaluates published values for the Character's exact Release |
| `SKILL_BENEFIT` v1 (decided in Phase B instead of SKILL v2, so SKILL v1 and every Character that pins it stay untouched; one record per benefit) | One benefit of one exact Skill from a rank onward: additions to named calculated values (M4 Formulas over Stats / Level / derived statistics), granted Actions (exact refs), the written benefit | The calculated-value evaluator adds every applying benefit; the sheet and preview show each addition and the rank it needs |
| `ARMOR` v1 | Armor / Shield: category, Armor value, Strength requirement, Dodge cap, movement and stealth effects, properties | Reference, plus the sheet's equipped Armor (later order) |
| `STATUS_CONDITION` v1 | Condition: effects (written plus structured modifiers), duration model, stacking, removal, triggers | Reference; play later |
| `CONCENTRATION_RULE` v1 (OV-01 to OV-03) | Capacity Formula, upkeep Formula, allocation semantics, open questions | Preview: capacity at a RES; upkeep at a casting AP; allocation → payable AP |
| `SUMMON_ENGINE` family (one versioned contract per engine) | Tiers, dice, static value, stats and derived tables, slots, trait access and costs, MP / AP / sustain Formulas, action model, restrictions | Reference and cost preview |
| `MISSION_TABLE` and `THREAT_CLOCK_TEMPLATE` | Die-range tables (coverage-checked), clock sizes and escalation points, reward and complication rows | Reference and table roll preview (no generation runtime) |
| MAGE_ART v2 | Modes with own costs and scaling tables, granted benefits, maintenance exceptions | Reference and cost preview; play stays unavailable (Q-07) |

Every contract is versioned. v1 content stays readable, and an unknown newer version fails clearly.

### 5.3 Entry shell (Studio)

The pages are Overview, Rules and benefits, Requirements and choices, Preview, Usage and impact, and History and source.
Each entry is found by its familiar name through a search over the catalog. Source locators come from a readable
"source section" picker over the recorded structure, so no "s208" is ever typed. The technical tree stays behind
"Advanced", and no supported task needs it.

### 5.4 Truthful status

| Badge | Derived from |
| --- | --- |
| Saved and validated | The Draft's validation result |
| Published in this Release | The Release pin |
| Previewable | A preview evaluator exists for the kind |
| Connected to | A named consumer registry (code-declared, tested) |
| Live execution | A runtime consumer exists |

### 5.5 Phase B record (what is built)

- **Game (approved-change entry `RULES-WO1`, additive only):** `CALCULATED_VALUE`, `SKILL_BENEFIT` and `CONCENTRATION_RULE`
  at payload version 1 (`definition/rules-authoring-payload.ts`); the evaluator `character/calculated-values.ts` (M4
  `evaluateFormula` for every base and addition, dependency order, cycles refused, missing inputs → unavailable, never
  0); `ability/concentration-preview.ts` (`appliesInPlay: false`). The sheet gains an optional `calculatedValues` list and
  fills the Carry maximum only from a published value placed there; with none published the sheet is byte-identical.
- **Server:** the rule graph links values read by other values and Skill-benefit additions; Stat impacts label authored
  rules ("Calculated value", "Skill benefit") and make them editable; `previewAuthoredRules` evaluates the published
  Release and an in-memory candidate in which Drafts replace pins **or are added** (new rules), writing nothing.
- **Studio:** guided editors for the three kinds (base "not stated in the rulebook" is a choice, never a 0); Stat page
  "Create a new value from STR" opens a value that already reads the Stat and returns to the Release preview; the
  authored-rule preview (sample Character, Skill ranks, Sustained Spells; "Preview only — combat does not use this
  rule yet"); the sheet's Carry maximum and "Additional Values" carry their canon label; **About this build**.
- **Desktop:** the controller passes `PROWESS_APP_VERSION / BUILD_COMMIT / BUILD_TREE / PACKAGE_SHA256` to Studio; the
  app version is 0.1.3.
- **Not yet (Phase C):** readable source-section picker (locators are still typed as section keys), structured Skill
  rank pickers, reading another calculated value from the guided input list, representative published content.

## 6. Phase plan and checkpoints

| Phase | Content | Checkpoint |
| --- | --- | --- |
| A | This document; R03 reproduction; build identity | bundle A |
| B | Entry shell; game-language relationship editor; CALCULATED_VALUE end to end (Carry Capacity, test-only); SKILL rank benefits (Athletics Throw Distance); Concentration rule and preview; About / build page | bundle B |
| C | ARMOR, STATUS_CONDITION, Mage Art v2, Summon engines, Mission tables and clocks, Keywords screen, Metamagic, Job templates; per-family journeys | one bundle per family group |
| D | Packaging and installer test, pack / restart / restore / upgrade, controls, CI, owner walkthrough | final bundle and PR (when publication is possible) |

RULES-WO1 is complete only when Phases A to D meet R01–R28. Phase checkpoints are not completion.
