# M6-WO12 — Playtest tester walkthrough

This is the first complete playtest of Prowess Studio. You will change one rule as a designer, approve it as a reviewer, publish it, then build a Character on it and play a short combat. You only use Studio's screens: no API calls, SQL, Playwright or browser-storage edits.

It takes about 30–40 minutes. Keep notes in the right-hand column of the checklist (§10): what you expected, what you saw, and anything confusing.

> The content is **test content on an isolated Release** (names such as `spell.targeting.self` are content keys, not polished names). The result of this playtest is "playtest verified on an isolated Release" — it says nothing about governed game content.

## 0. One-time setup (a developer can do this for you)

You need the repository, Node 22, pnpm and a local PostgreSQL (user `postgres`, password `postgres`).

1. Create a disposable database. Its name **must end in `_test`**:

   ```
   createdb -h localhost -U postgres prowess_studio_playtest_test
   ```

2. Apply the migrations, build, and prepare the playtest world (all with the same `DATABASE_URL`):

   ```
   export DATABASE_URL=postgresql://postgres:postgres@localhost:5432/prowess_studio_playtest_test
   pnpm install
   pnpm run db:generate
   pnpm run db:migrate:deploy
   pnpm playtest:wo12 prepare
   ```

   `prepare` prints a **run id**, the **Ruleset name** (`M6-WO12 Playtest <run id>`) and the **Definition to revise**. Write them down. It refuses any database that is not a local `*_test` database.

3. Start Studio against that database:

   ```
   APP_URL=http://127.0.0.1:3000 LOG_LEVEL=warn DEVELOPMENT_MODE=false pnpm build
   cd apps/studio && APP_URL=http://127.0.0.1:3000 LOG_LEVEL=warn DEVELOPMENT_MODE=false ./node_modules/.bin/next start -p 3000
   ```

   Open `http://127.0.0.1:3000`.

To start over at any time: `pnpm playtest:wo12 prepare <the same run id>` (it removes that run first). To remove your run afterwards: `pnpm playtest:wo12 cleanup <your run id>`. A missing run id is refused.

## 1. Designer: revise one rule (Compendium Admin)

1. **Compendium** → **Compendium Admin**.
2. In **Search name, alias**, type `fixture.wo9.effect.maintenance`. Open the row whose **Canonical Key** contains your run id.
3. Under **Create New Revision**, enter a change summary such as `Playtest: the ward costs 3 MP` and choose **Create New Revision from Revision 1**. You are now editing **Revision 2 (Draft)**.
4. Change **Display Name** to `Steady Ward Effect (playtest)`.
5. In **Prowess Definition** → **Cost contributions** → **Cost data**, find `amount`. It shows **4**. Change it to **3**.
6. Set **Change type** to *Mechanical Change*. Choose **Save Draft**. Expect *Draft saved — validation PASS.*
7. Under **Review and Canon hand-off**, choose **Submit for review**. The button changes to **Return to Draft**.
8. Choose **Choose a Ruleset…**, pick your Ruleset (`M6-WO12 Playtest <run id> (Published)`), name the proposal `Cheaper Steady Ward` and choose **Create ChangeSet proposal**. Expect *Proposal "Cheaper Steady Ward" created as a DRAFT ChangeSet.*

## 2. Reviewer: approve and publish (Canon Manager)

1. Choose **Open in Canon Manager**. The ChangeSet page lists one operation, `PIN_ENTITY_VERSION`, with **Proposed revision status: IN_REVIEW**.
2. Choose **Approve revision r2** and confirm. The status becomes **APPROVED**. (Without this, publishing refuses: "would pin editable EntityVersion(s) … (IN_REVIEW)".)
3. Choose **Submit for Review** and confirm, then **Approve** and confirm. Expect *Approved — eligible for publication from the Releases section.*
4. Open **Releases**. In **Publish Release**:
   - **Base Manifest**: the Manifest Release 1 uses. Open **Release 1 — R1** in another tab if unsure; it is usually *Manifest v2*.
   - **Canon Policy**: the only policy.
   - **Approved ChangeSet**: *Cheaper Steady Ward*.
   - **Version label**: `R2`.
5. Choose **Publish Release**, check the summary and choose **Publish**. You land on **Release 2 — R2**.

## 3. Reader: check the rules (Rules Reference)

1. **Compendium** → **Rules Reference** → your Ruleset. Two Releases are listed.
2. **View Latest Release** → *Release 2 — R2*, "Manifest verified".
3. Find **Steady Ward Effect (playtest)**: it says **Pinned Revision 2**.
4. Open the **Long Blade** Weapon and follow one of its **Referenced Definitions**: you stay inside Release 2.
5. Open Release 1 and **Compare with** Release 2: *1 changed revision*.

Nothing on these pages should change anything.

## 4. Player: create a Character (Library)

1. **Characters** → **New Character**. Ruleset: yours. Release: **Release 2** (nothing is preselected). Name it. **Create Character Draft**.
2. **2. Race / Ancestry**: *Orcani (test)*; stat choices AGI and PRO. **Save & Continue** → you are on **Stats**, "All changes saved."
3. **Close the browser tab.** Open Studio again → **Characters** → search your name → the row says **Draft** → **Continue creation**. You come back on **Stats** with 15 of 15 points unspent.
4. Spend the points: STR 3, AGI 3, CON 3, PER 2, RES 2, PRO 2. **Save & Continue**.
5. **Skills**: Race Skill *Athletics (test)*; Free Skill 1 **`skill.martial`**; Free Skill 2 **`skill.arcana`** (these two are the ones the builders use). **Save & Continue**.
6. **Primary Affinity**: *Evocation (test)*. **Save & Continue** → **Complete Core Creation**.

## 5. Grow and equip (Sheet)

1. **Advancement** tab: Level 1 of 10; *Arcane* access shows **Trained**. **Advance Character** → **Next** → add 1 point to PER → **Next** → **Advance Character**. History shows Level 2 "+1 PER".
2. **Sheet** → **Change Weapons** → Main hand **Long Blade**, grip **One-handed** → **Save Weapons**. The Attacks show **Long Blade — Slash, 2 AP, 2d8 Slashing**.

## 6. Build the two Signature Abilities

**Spell**

1. **Abilities** → **New Signature Spell** → name `Steady Ward` → **Start building**.
2. **Authority**: *Arcane Authority*.
3. **Effects**: notice `spell.effect.cleanse` is **Locked — Requires Expert Arcane Authority Skill** (a prerequisite you do not meet).
4. **Targeting**: `spell.targeting.self`. **Effects**: add **Steady Ward Effect (playtest)**. **Duration**: `spell.duration.sustained`.
5. The live panel says **Valid · 3 MP · 1 AP** (Release 1 would have been 4 MP). **Finalize** step → **Finalize Spell** → *Active, Revision 1*.

**Maneuver**

1. **Abilities** → **New Signature Maneuver** → name `Ward Strike` → **Start building**.
2. **Action Selection**: **Add Action** next to *Long Blade · Long Blade — Slash*.
3. **Effects**: **Select** `test.wo8.effect.enhancement`, then **Attach … to** *action1*.
4. **Duration**: **Select** `maneuver.duration.instant`. **Save now**.
5. **Review** shows the cost sequence ending **2 AP / 5 MP**. **Finalize** step → **Finalize Maneuver** → *Revision 1 (current)*.

## 7. Look without touching (Sheet, Cards, print, inspectors)

1. The **Sheet** lists the Spell and *Ward Strike · r1*.
2. **Cards** shows both abilities; **Print current cards** opens the printable cards.
3. **Attacks** → *Slash* → **Inspect damage**: the Weapon revision, "Power Multiplier STR 6 ÷ Power 6 → ×2", **2d8**.
4. Open the Spell → **Inspect cost**: the Effect line links to *Release 2*'s entry; Final MP **3**.

5. Open **Rules Inspector** at `/developer/rules` in a second tab. Choose **Release**, select this run’s Ruleset and its exact **Release 2**. The Character Sheet shows maximum ME 4 and MP 7, and the finalized Spell costs 3 MP. For this build, inspect the predicted payment starting with both pools full.
6. Open **Import plan JSON**, paste the plan below, choose **Use plan JSON**, then **Run Evaluation**. Select **ward · RESOURCE_PAYMENT_APPLY** in the timeline. In **Overview**, write down the remaining ME and MP (1 and 7). Under **Provenance**, confirm the Release ID matches the Character. This evaluation previews the payment without creating a play event.

```json
{
  "steps": [{
    "stepKey": "ward", "order": 1, "operation": "RESOURCE_PAYMENT_APPLY",
    "input": {
      "snapshot": {"resources": [
        {"resourceKey": "resource.me", "kind": "POOL", "minimum": 0, "current": 4, "maximum": 4, "reservedCapacity": 0},
        {"resourceKey": "resource.mp", "kind": "POOL", "minimum": 0, "current": 7, "maximum": 7, "reservedCapacity": 0}
      ]},
      "payment": {"costKey": "MP", "listedAmount": 3, "sources": [
        {"resourceKey": "resource.me", "order": 1}, {"resourceKey": "resource.mp", "order": 2}
      ]}
    }
  }]
}
```

## 8. Play a short combat (Play Workspace)

Your Character Die is a **d4**: type a physical die face from 1 to 4.

1. **Characters** → your row → **Resume play**.
2. **Begin combat** → **Start round** → **Start my turn**. AP 4 / 4.
3. **General Actions** → **action.move** → **Preview (no change)**: nothing is spent. **Commit**: AP 3 / 4, Movement Allowance granted.
4. **Movement** → **Spend movement…** → 5 ft, normal → **Commit**.
5. **Weapon Attacks** → *Long Blade — Slash* → die face **3**, target Dodge **3** → **Commit**. Expect *hit*, and **Damage authorised: 2d8 slashing — NOT APPLIED**. AP 1 / 4.
6. **End my turn** → **End round** → **Start round** → **Start my turn** (AP back to 4).
7. **Spells** → *Steady Ward* → **Commit**. Check the committed Spell entry in the Activity Log and compare the resource balances to your Rules Inspector result: ME 1, MP 7. **Active Magic** shows the ward **active**, sustained.

**Pause in the middle of the turn.** Close the tab. Open Studio again → **Characters** → **Resume play**. Write down AP, MP, ME, the Activity Log and Active Magic. Close and resume **again**: everything must be identical, and nothing new appears in the log.

9. **Maneuvers** → *Ward Strike* → **Commit**: the engine asks for an **attack roll**; nothing is paid yet. Die face **3**, Dodge **3** → **Commit**. AP 1 / 4, MP 2 / 7.
10. **End my turn** → **End round** → **Start round** → **Start my turn**.
11. **Active Magic** → **Pay Sustain upkeep** (1 AP + 1 mana, ME first) → the log says *maintenance: applied*. Then **Dismiss**: the ward **ended**.
12. **End my turn** → **End round** → **End combat**.
13. Check the **Activity Log**: numbered 1 to N with no gap, and no reconciliation warning.

## 9. Try to break it (optional)

- Before **Start my turn**, actions say "start the turn first".
- Type die face **9**: "the roll is not valid for the Character Die", nothing spent.
- Open the Play Workspace in two tabs, act in one, then act in the other: "changed elsewhere", nothing applied.

## 10. Checklist and notes

| # | Step | Passed? | Notes (expected / saw / confusing) |
| --- | --- | --- | --- |
| 1 | Revision 2 saved with 3 MP and submitted | | |
| 2 | Revision approved, ChangeSet approved, Release 2 published | | |
| 3 | Rules Reference shows Release 2, Revision 2, 1 changed revision | | |
| 4 | Draft resumed after closing; Character completed on Release 2 | | |
| 5 | Level 2; Long Blade equipped; Slash 2 AP | | |
| 6 | Spell 3 MP finalized; Maneuver 2 AP / 5 MP finalized | | |
| 7 | Sheet / Cards / print / inspectors consistent | | |
| 8 | Move preview vs commit; attack NOT APPLIED; ward active | | |
| 8b | Two resumes identical | | |
| 8c | Maneuver, upkeep, dismiss, end combat; log 1…N | | |
| 9 | Refusals explained in plain words | | |

When you are done: `pnpm playtest:wo12 cleanup <run id>`.
