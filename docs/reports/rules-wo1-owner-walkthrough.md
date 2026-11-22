# RULES-WO1 — owner walkthrough (pending your acceptance)

This is the guide for your hands-on check of Complete Game Authoring. **Your usability acceptance is pending until you
complete it.** Nothing here records it as done.

## 1. Get the candidate installer

The Windows installer is built by the repository's CI (`windows-package` job) from the PR branch
`rules-wo1-complete-game-authoring`. It cannot be built in the cloud session that wrote this guide (that session has no
Windows machine), so:

1. Open the PR's CI run on GitHub.
2. Download the installer artifact from the `windows-package` job.
3. Note the run's commit. That is the candidate's source commit.

If the PR is not open yet, the branch has not been published (see the recovery report). In that case there is no
candidate installer yet.

## 2. Install and confirm the build

1. Run the installer. Your existing workspace is kept: no data is removed, and the app is upgraded in place.
   - **Before installing**, use the launcher's "Back up local workspace" link. That gives you a way back.
2. Open Prowess Studio from the launcher.
3. Click **About** in the left navigation.
4. Check these lines:
   - **Version** shows **0.1.3**.
   - **Kind of build** says "Installed desktop app".
   - **Source commit** is the candidate's commit from step 1.
5. Open **Show the list** under "Editors in this build". STAT, CALCULATED_VALUE, ARMOR, SUMMON_TYPE and MISSION_RULE
   should be under **Guided**, and the "Technical editor only" list should be empty.

If the version or commit differ, you are not running the candidate. Stop there and send the About page.

## 3. Representative tasks

Do these in a Ruleset you use for testing. Nothing is published unless you choose to publish.

| # | Area | Task | What you should see |
| --- | --- | --- | --- |
| T1 | Stats | Compendium → Rules Reference → your Release → Topics → Stats → STR → **Create a new value from STR**. Name it "Carry Capacity". Set "Where this rule comes from" to **Test only** and give a reason. Create it. | A guided form with no technical tree. Nothing is typed as a key: click **Suggest a Canonical Key from the Display Name** (the platform never sets the permanent key silently); the other names fill themselves in from the Display Name. The Draft opens with **Preview this rule for a sample Character**. Calculate shows the value and "Test only — not canon". |
| T2 | Stats | On the same Draft, read the **Overview** and **Usage and impact**. | The status lines say whether it is validated, whether it is published in this Release (no, it is a Draft), what it is connected to (the Character sheet), and "Partly used in play". |
| T3 | Skills | Compendium Admin → New Definition → family **SKILL** → kind **SKILL_BENEFIT**. Choose Athletics, **From rank** Trained (picked from a list), and "Adds to the value" Throw Distance. | Ranks and values are chosen by name. If no Throw Distance value exists yet, create one first (kind CALCULATED_VALUE, base "not stated in the rulebook"). Its total then reads "+N ft from bonuses (base not stated)". |
| T4 | Abilities | New Definition → **CONCENTRATION_RULE** (Concentration points `1 + floor(RES / 3)` through the contribution controls; upkeep from the casting AP). Open it from a Release and Calculate with RES 6 and a 5 AP Spell. | 3 points; 2 AP upkeep; 0 / 1 / 2 points → 2 / 1 / 0 AP still paid. "Preview only — combat does not use this rule yet." |
| T5 | Abilities | New Definition → **METAMAGIC**, then **MAGE_ART** (version 2). In a mode, add a **scaling** "By a Level table" (Level 1–4 → 10, 5–8 → 15), a structured **granted benefit** and a **maintenance exception**. Save, then **Preview with sample inputs** at Level 6. | Guided forms. The preview shows 15 for Level 6. The Overview says "Reference only — not used in play yet". |
| T6 | Equipment | New Definition → **ARMOR** (Heavy, Armor 5, Strength 5, AGI limit 5, movement penalty 5 ft, Stealth Disadvantage). For the source, search "armor" and **Add** the section. Save. Use **Preview with sample inputs** with AGI 8 and STR 4. | The source is chosen by its title; the section key is only under "Section keys (advanced)". The preview shows AGI 5 (capped), "Meets the Strength requirement: no", a 5 ft movement penalty and Disadvantage. |
| T7 | Conditions | New Definition → **STATUS_CONDITION** "Burning" with an effect, a duration, a removal, stacking and a **Trigger** (for example "At the start of its turn"). | All chosen from lists. Reference only: play does not apply Conditions yet. |
| T8 | Summons | New Definition → **SUMMON_TYPE** (engine Totem, a tier row named "Tier 1" with 12 MP, casting AP from total MP ÷ PRO, rounded down, minimum 1). Under **Who acts and who pays**, choose the action model and who owns the AP / MP, and add a **Restriction**. Preview with PRO 4 and tier "Tier 1". | Names are typed in plain words (shown as TIER_1). Casting AP 3. "Counts toward Concentration" can be left "Not decided (open question)". |
| T9 | GM rules | New Definition → **MISSION_RULE**, Kind of rule **Roll table**: a d20 table (rows 1–19, 20), then a 6-segment Threat Clock with escalations at 2, 4 and 6. | A table must cover 1–20 exactly (a gap is refused). The preview shows the row for a roll, or the escalations reached for a number of filled segments. |
| T10 | Gameplay | New Definition → **REFERENCE_RULE**, Kind of rule **Points** (for example "Grappling" as rule points). | Written rules or tables only. |
| T11 | Keywords | Compendium Admin → **Keywords**. Create a category and a Keyword. Then **Edit** the Keyword and change its name. | No key is typed. The editor first says where the Keyword is used, and that its key and category never change. A Keyword installed from a content pack is shown read-only. |
| T12 | Publish (optional) | Submit T1 for review, propose it, approve it and publish a new Release. Create a Character on it. | The sheet's Max Load shows the value followed by "(Test value — not canon)". A Character on the earlier Release is unchanged. |
| T13 | GM rules | After T10, open the T9 Mission rule (or make a new one) → **Linked reference rules** → **Add rule** → search for the T10 rule by name → choose it. Save. | The link is chosen and shown by name. Nothing is typed as a key. |
| T14 | Skills | On the T3 benefit, add **Grants Actions** (choose an Action by name) and a **Further prerequisite** group (for example STR at least 3). Publish it (as T12) and open two Characters on that Release: one with Athletics Trained and STR 3+, one without. | **Skill Benefits** on each sheet says whether it applies and, if not, why. Only the eligible Character lists the Action under "Actions from Skills", and its Action card says "Granted by Skills". A Character on the earlier Release is unchanged. |
| T15 | Phone width | Narrow the window to phone width (about 390 px) and repeat T6. | The form fits the width without sideways scrolling, and every field is labelled. |
| T16 | Equipment | New Definition → **AMMUNITION**: choose the Weapon families it fits from the list, rounds per attack and per Burst. Save, then preview with Loading 12 and Reload 5 AP. | 12 attacks (4 Bursts); reload 5 AP over 2 turns (3 AP then 2 AP). Play does not count ammunition yet. |
| T17 | Equipment | New Definition → **WEAPON_MODIFICATION** (for example a quick loader: Reload −1 AP). Preview it on a sample weapon. | The changed values are shown; nothing is fitted to a Character's weapon yet. |
| T18 | Editing | Open an older Spell Effect or Weapon Definition and edit a name field (for example Effect family or Weapon family) and a compatibility rule. | Names are typed in plain words (stored in capitals); compatibility relations and allowed entries are chosen from lists. |
| T19 | Spell Effect (Phase F) | New Definition → **SPELL_EFFECT** "Flame Lash": Damage, Direct, affects a Creature, an attack roll (Ability attack). Add the choices "Dice" (a number, starts at 1, largest 3) and "Damage type" (Fire or Shock). Costs: 2 MP, plus 3 MP for each die after the first. On a success it deals damage (dice and type from the choices); on a failure nothing happens. Instant; needs Arcana (Trained); works with Single Target. | Nowhere asks for a key, a data type or a formula. Validation passes. Once published, a Spell built with it costs 5 MP with one die and 8 MP with two (Single Target 3 MP included). |
| T20 | Mage Art (Phase F) | In a Mage Art (version 2), add a benefit "Stat substitution": the calculation it changes (for example Dodge), the Stat it replaces and the replacement Stat. Try saving it with the same Stat twice. | The same-Stat version is refused; a category with only text is refused too. |
| T21 | Skill benefit preview (Phase F) | Open a Skill benefit with an Affinity prerequisite and its preview. Calculate, then give the sample an Affinity rank and calculate again. | Each benefit shows Applies / Rank not reached / Prerequisites not met, with each group's prerequisites; inputs the sample left out are listed ("read as not owned"). The result matches a Character's sheet with the same Stats, ranks and Affinities. |
| T22 | Condition (Phase F) | New Definition → **STATUS_CONDITION**: an effect "Disadvantage on Attack Rolls" and a trigger "on a failed Resolve Save, 1d4 damage". | Both are chosen from lists; play still does not apply Conditions. |
| T23 | Spell Targeting (Phase G) | New Definition → **SPELL_TARGETING** "Ember Ring", semantic shape Radius: delivered to an area; everything in the area; creatures, objects and the area; add a choice "Size steps" (a size step); range Self; radius a stated distance — add the contribution 10, then 5 × the size choice; starts from the caster; placed from it; no line of sight needed; line of effect required; cover applies. Costs: 4 MP base, then 2 MP for each 5 ft step. | No key, data type or formula syntax is asked for; the radius reads "10 + 5 * size_steps". Validation passes. |
| T24 | Casting Condition (Phase G) | New Definition → **SPELL_CASTING_CONDITION** "Steady Breath": restriction "Steady breath"; may be taken only when the ability affects an area; play check "Breath held" (can hold breath); benefit: reduces the MP cost by 10%. | The play check is marked as recorded for the play runtime. Validation passes. |
| T25 | Build with them (Phase G) | Publish T23 and T24, then build a Spell: Ember Ring + Detect Mana + Instant. Set Size steps to 1, then add Steady Breath. | 6 MP with no steps, 8 MP with one; with Steady Breath the Casting Conditions step shows "Listed reduction 10%" and the cost drops. |
| T26 | Maneuver components (Phase G) | New **MANEUVER_TARGETING** for the performer alone (no cost section); a **MANEUVER_FOUNDATION** "Quick Dash" (Action, movement, bound to that Targeting by search, 1 AP); a **MANEUVER_CONDITION** where the user picks −1 AP or −2 MP. | Each is chosen from lists and plain words; a Maneuver Condition offers only AP / MP reductions. |
| T27 | An Effect's calculated value (Phase G) | Open the Core Playtest **Cone Attack Conversion** Effect. Under "Calculated values", Length reads `5 * martial_rank`. Use "Replace input martial_rank" → Martial Rank Value → Apply. | The value becomes `5 * martialRankValue` — the prepared correction. Do not publish it into your ruleset unless you approve it (report §4). |

## 4. What is deliberately not in RULES-WO1

- Combat does not use the new Concentration rule yet.
- Armor is not equipped on the sheet.
- Conditions are not applied in play.
- Summons are not created or played, and Missions are not generated.
- Metamagic is not offered in the Spell builder, and Job templates are not offered in Character creation.
- Mage Arts are not played (their card stays unavailable); ammunition is not counted and modifications are not fitted in play.
- Ability Condition play checks are recorded but not evaluated in play; the open Condition and Duration questions are listed in
  the acceptance matrix §3. "Rule notes" of Actions, Resources, Creature Sizes and Terrain still use the structured-data
  editor (R18).
- A Skill benefit's granted Action is shown on the sheet and its card, but taking it in play works as before; a situational
  ("only when …") bonus is shown with its condition and is not added to the total.

Each entry's Overview says this in its "Live in play" line. These are later Work Orders (RULES-WO2 / RULES-WO3 / M7-WO2
and on), which were not started.

## 5. Report back

For each task, tell me: done / confusing / broken, plus a screenshot of anything wrong. Include the About page in your
report. I record your acceptance only from that report.
