# RULES-WO1 — Phase E report: completed authoring scope (status: Partially complete)

Branch `rules-wo1-complete-game-authoring`, based on `main` `23f3c03`. It continues from the preserved Phases C/D
checkpoint `5c2ae52`; that report, its evidence and its ZIP are unchanged. **Do not merge.** RULES-WO2, RULES-WO3 and
M7-WO2 were not started.

| Record | Value |
| --- | --- |
| Verified candidate | `ef184993841c4a450db50cc454f5940ac6fad763` (tree `729c477d5d3f239ec435d7b46c23328d194fec80`). Every local result below comes from this commit. |
| Phase E commits | `9a6e9f0` → `ef18499` (`git log 5c2ae52..ef18499`). `9a6e9f0` is the checkpoint of work recovered after an interrupted session. |
| Preserved earlier archives | Phase B `rules-wo1-phase-b-0456ec5.zip`; interim `rules-wo1-recovery-b86ab3d.zip`; Phases C/D `rules-wo1-phase-d-5c2ae52.zip` (SHA-256 `ef1ea2a6…82d0`). |
| Acceptance | `docs/architecture/rules-wo1-acceptance.md` gives R01–R28 with reconciled statuses, and support split into authoring, validation, preview and live execution. |
| Outstanding | Publication and the draft PR, hosted CI with Tier 2 and both Windows installer jobs, the owner's walkthrough, and the open gameplay questions (acceptance §3). |

## 1. What Phase E completes

| Item | What is built | Live-execution limit (stated in the app) |
| --- | --- | --- |
| **Skill benefits** | **Evaluation** (`character/skill-benefits.ts`):<br>- whether the Skill's rank is held;<br>- prerequisite groups (ALL / ANY) of Level, Stat, another Skill's rank and Affinity rank, using the shared Action-improvement evaluation;<br>- granted Actions checked against the exact revision the Release pins.<br>**Where it shows:** the sheet's Skill Benefits panel says whether each benefit applies and why not; "Actions from Skills" lists only real grants; the Action Directory marks "Granted by Skills". A situational bonus keeps its condition and is shown, not added. | Taking a granted Action in play works as before. |
| **Plain-language editing** | **Name fields:** every one, older M6 fields included, is typed in plain words and stored as the exact token.<br>**Chosen from lists:** Skill, rank, rank-ladder, Weapon-family and Skill-prerequisite fields.<br>**Compatibility rules:** built with a relation list and Definition / Keyword pickers.<br>**Readable text:** restriction names, and variant-switch confirmations that name fields in words.<br>**Unchanged:** the server's strict validation of raw payloads. The M6-WO1 browser journey now shows the server refusing an empty name instead of a lowercase token. | — |
| **Keyword editing** | **Change:** name, description and "deprecated" only; the canonical key and category never change.<br>**Safeguards:** usage (Definitions, Releases, assignments) is shown first; compare-and-set refuses a stale edit; a Keyword installed from a content pack is refused plainly (the DIST-WO2 database guard also refuses).<br>**Routes:** two, registered (`/api/keywords/{id}/presentation`, `/usage`). | Names change everywhere they are shown. Mechanics never change, because they refer to the key. |
| **Mage Arts v2** | Scaling by a Level table (every Level covered, in order) or a Formula over Stats and Level; structured benefits (immunity, advantage, sense, Stat substitution, range multiplier, Counter Action, resource); structured maintenance exceptions; written text alongside each. Preview: scaling at a Level. | The card stays unavailable. |
| **Summons (all 7 engines)** | Who acts (the action model), who owns AP / MP, the Summon's own AP and Counter Actions, structured restrictions (the source's "no actions without a trait", "no extra actions", "no improvisation", "no MP refund", maximum active), and dismissal. Written rules are kept alongside. | No Summon runtime. |
| **Conditions** | Structured triggers: on hit, on a failed Save (with its Stat), on entering an area, start / end of turn, end of round. | Play does not apply Conditions. |
| **Ammunition (new kind)** | The weapon families it fits (chosen by name), rounds per attack and per Burst, plus text. Preview: attacks per Loading, Bursts, and the Reload AP split over turns — the source's example of 5 AP as 3 + 2. | Play does not count rounds. |
| **Weapon modifications (new kind)** | Structured changes (reload AP, loading, to-hit, damage dice, loud radius, range) plus text. Preview: the changes on a sample weapon. | Not fitted to a Character's weapon. |
| **Upgrade evidence** | **New:** `verify-rules-wo1-previous-build-restore.mjs`. A backup written by main `23f3c03`'s own code (app 0.1.2), from its own workspace, is restored by the candidate. All tables are identical, the encounters and Character rows match, and the sheets match the previous build's.<br>**Relabelled:** the old backup step is a *version-tag* check. | The installed Windows upgrade needs CI. |

## 2. Verification

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


## 3. Defects found and fixed in Phase E

| Defect | Found by | Fix |
| --- | --- | --- |
| Editing a Keyword installed from a content pack failed with a raw database error | Transfer proof | A plain IMPORTED_READ_ONLY refusal; the editor shows the Keyword read-only. |
| The ammunition browser test only passed if another spec had seeded Weapons first | Running the spec in isolation | The test seeds and removes its own isolated world. |
| Registry characterization did not list the two new equipment kinds | Game suite | The lists were updated. |
| A whole-item list field (Mage Art scaling) added a malformed row | Browser P08 | The row now starts as the field's own initial value. |

## 4. Publication (still blocked)

The session's git proxy still refuses `prowessttrpg-png/prowess-studio`. The recovery package below has a
complete-history bundle and `RECOVERY.md` with the push and draft-PR commands. Once access exists:

1. Push the branch.
2. Open a draft PR.
3. Let the required CI, Tier 2 and both Windows installer jobs run.
4. Run the installed Windows upgrade check.
5. Hand the `windows-package` installer, with its run, commit and SHA-256, to the owner for the walkthrough.

Stop before merge.
