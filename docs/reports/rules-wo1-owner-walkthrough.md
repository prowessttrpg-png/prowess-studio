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
| T5 | Abilities | New Definition → **METAMAGIC** and **MAGE_ART** (version 2, with a mode's scaling steps). | Guided forms. The Overview says "Reference only — not used in play yet". |
| T6 | Equipment | New Definition → **ARMOR** (Heavy, Armor 5, Strength 5, AGI limit 5, movement penalty 5 ft, Stealth Disadvantage). For the source, search "armor" and **Add** the section. Save. Use **Preview with sample inputs** with AGI 8 and STR 4. | The source is chosen by its title; the section key is only under "Section keys (advanced)". The preview shows AGI 5 (capped), "Meets the Strength requirement: no", a 5 ft movement penalty and Disadvantage. |
| T7 | Conditions | New Definition → **STATUS_CONDITION** "Burning" with an effect, a duration, a removal and stacking. | A guided form; reference only. |
| T8 | Summons | New Definition → **SUMMON_TYPE** (engine Totem, a Tier 1 row with 12 MP, casting AP from total MP ÷ PRO, rounded down, minimum 1). Preview with PRO 4 and tier TIER_1. | Casting AP 3. "Counts toward Concentration" can be left "Not decided (open question)". |
| T9 | GM rules | New Definition → **MISSION_RULE**, Kind of rule **Roll table**: a d20 table (rows 1–19, 20), then a 6-segment Threat Clock with escalations at 2, 4 and 6. | A table must cover 1–20 exactly (a gap is refused). The preview shows the row for a roll, or the escalations reached for a number of filled segments. |
| T10 | Gameplay | New Definition → **REFERENCE_RULE**, Kind of rule **Points** (for example "Grappling" as rule points). | Written rules or tables only. |
| T11 | Keywords | Compendium Admin → **Keywords**. Create a category and a Keyword. | No key is typed. Editing an existing Keyword is not offered, because the platform has no edit service for Keywords. |
| T12 | Publish (optional) | Submit T1 for review, propose it, approve it and publish a new Release. Create a Character on it. | The sheet's Max Load shows the value followed by "(Test value — not canon)". A Character on the earlier Release is unchanged. |

## 4. What is deliberately not in RULES-WO1

- Combat does not use the new Concentration rule yet.
- Armor is not equipped on the sheet.
- Conditions are not applied in play.
- Summons are not created or played, and Missions are not generated.
- Metamagic is not offered in the Spell builder, and Job templates are not offered in Character creation.

Each entry's Overview says this in its "Live in play" line. These are later Work Orders (RULES-WO2 / RULES-WO3 / M7-WO2
and on), which were not started.

## 5. Report back

For each task, tell me: done / confusing / broken, plus a screenshot of anything wrong. Include the About page in your
report. I record your acceptance only from that report.
