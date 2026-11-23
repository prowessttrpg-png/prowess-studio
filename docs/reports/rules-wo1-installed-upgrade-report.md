# RULES-WO1 — installed-upgrade proof (status: Partially complete)

This adds one verification within RULES-WO1: an installed upgrade from the previous build to the candidate, on
Windows. Nothing else changed. **Do not merge.** RULES-WO2, RULES-WO3 and M7-WO2 were not started. The seven
gameplay rulings stay deferred.

| Record | Value |
| --- | --- |
| Phase H checkpoint (preserved) | tested code `384d1b4be8aef2ffbd5477c32ce0c8334504b718` (tree `8470554e…`); delivery head `2df9e8758bfb02b009cd59aebfa2c4f66399d2c0` (tree `d825ef51…`); bundle `rules-wo1-2df9e87.bundle`, SHA-256 `edfd1fbe7b6bcbb3876d1f7aa20bdac54012c27d690aae90dd06e43a37117c23` (unchanged) |
| New candidate | `cc06af1933b3921f71e4c4d8fe57886045072da9` (tree `f5834b72b7b321c9b5a14350a1b2d6aab8916472`). It is the only commit after `2df9e87`, and every local result in §4 comes from it. |
| Change | `.github/workflows/ci.yml` (new job `windows-upgrade`, required by Tier 2; the desktop `node --test` line adds one file), `scripts/distribution/build-windows-installer.ps1` (the artifact also carries the two new proof files), and four new files: `scripts/distribution/upgrade-baseline.json`, `scripts/distribution/verify-windows-upgrade.ps1`, `scripts/distribution/desktop/installed-upgrade.mjs` and its test. There is no application, game, database or migration change. |

## 1. What the check does

1. **Baseline.** `upgrade-baseline.json` names the previous build: `main` `23f3c03e95da4c7a4c1db51449d79754895adecb`
   (tree `11f95d50…`, app 0.1.2, CI run #285, id `44438453243`).
   - The job first downloads that run's installer artifact `prowess-windows-x64-23f3c03…`.
   - If the artifact has expired or is unavailable, it checks out `23f3c03` and builds the installer with that commit's
     own build script.
   - Either way, `verify-windows-upgrade.ps1` checks the installer's build identity, its package identity and its
     SHA-256 digests, and refuses any source commit other than the baseline. The evidence records which source was used.
2. **Prepare with the previous application.** In a clean per-user account, the baseline is installed with `/S`. Its
   launcher is started, and `installed-upgrade.mjs prepare` uses the previous build's own HTTP routes through the
   desktop gateway:
   - first run with the sample rules;
   - an authored Ruleset published as its own Release;
   - two completed Characters built from the Release's creation context, plus one draft Character;
   - a prepared encounter with two sides and both completed Characters;
   - one Character mid-turn: combat begun, round and turn started, a Move spending 1 AP.

   It records every identity, the Release manifests (hash verified), the Characters, sheets, play workspaces
   (versions, resources, combat runtime), play events, the encounter and its events. It also records the workspace's
   rows in 13 tables (Releases and manifests, Characters, play state, resources, runtime, events, encounters, sides,
   participants and encounter events).
3. **Upgrade.** The candidate installer is run over that installation with `/S`, the supported procedure. The desktop
   shortcut must start the candidate, and the previous version's files must still be in place. On its first start the
   candidate's launcher performs its upgrade: a recovery backup, a staged copy of the database, then migrations.
4. **Verify the upgraded application.**
   - The workspace records the candidate's version and migrations, and the upgrade journal has completed.
   - A `before-upgrade` recovery backup exists, and the diagnostics name the candidate commit.
   - Every recorded field is preserved: Release pins and manifest hashes, Characters, sheets, resources, the active
     turn's runtime and AP, every play event and the encounter's sides, participants and events.
   - Every recorded row is still present, with every recorded column equal.
   - Play then continues: another Move is committed in the same turn (AP 3 → 2), and the encounter takes a new command.
5. **Restart.** The candidate is started again. The preserved rows, both continued actions and every Character and
   Release are still there.

Comparison is by recorded fields and columns. A later version may *add* fields and columns, but it may not lose or
change what the previous version stored. So the check stays useful for future upgrades: move `upgrade-baseline.json`
forward to the build that players have installed.

**Kept separate:** the installed smoke (`windows-installed`, DIST-WO1) still runs its own backup / restore,
content-pack transfer and restart checks. The new job restores nothing. The DIST-WO1 standard-user Windows 11
lifecycle check (`verify-windows-lifecycle.ps1`) is unchanged and stays separately deferred.

## 2. What was run here, and what is pending

**Local (Linux; no Windows machine here):**

- **HTTP-level upgrade, using the same proof code:**
  - The previous application (a build of `23f3c03`) ran on a disposable `*_test` database seeded the way the demo
    workspace is, with the WO12 sample Release. `prepareUpgradeState` ran against it.
  - The previous server was then stopped and the candidate's migrations were applied. They are the same chain
    (31 migrations), so nothing new was applied.
  - The candidate server ran `verifyUpgradedState`; it was then restarted and ran `verifyAfterRestart`. All passed (§4).
  - Two tamper runs, run on `cc06af1` itself (a clean detached checkout), fail as intended. (A first pair was run
    before that commit existed, at HEAD `2df9e87` with the same proof module uncommitted; it is superseded.) Raising a Character's AP between the two builds fails at the sheet resources.
    Deleting one encounter participant fails at the encounter's side membership.
  - This stands in for the launcher's desktop upgrade. It does not exercise the installer, the desktop gateway or
    the launcher's staged-copy migration.
- **Static:**
  - `actionlint` passes on the workflow.
  - PowerShell 7.4 parses both scripts with no errors.
  - The new `node --test` file checks the comparison rules, the baseline record and the CI wiring: Tier 2 requires
    `windows-upgrade`, and the artifact carries the proof files.
- **Full required local gates on the new candidate (§4).**

**Pending until hosted CI runs (publication is blocked):** `windows-package`, `windows-installed` (the smoke,
including backup / restore) and the new `windows-upgrade` (the actual Windows installer upgrade). Also pending: Tier 2,
the rest of the hosted CI, the identified installer and your walkthrough. None of the Windows checks has run yet. The
PowerShell script has been parsed but not executed.

## 3. Review notes

- The job grants `actions: read` only to download the baseline artifact from its own run. The token is never passed to
  the proof.
- The baseline path follows the earlier DIST-WO2 upgrade wiring (download by `run-id`), and adds the build-from-source
  fallback so the check does not stop working when the artifact expires (about 90 days after 19 Nov 2026).
- The timeout is 75 minutes, enough for a fallback baseline build (the installer build job allows 45 minutes) plus two
  installs and three launches.
- The proof drives only routes the previous build already had (M2 governance, M6 creation and play, M7-WO1
  encounters). Each request is sent once and checked against its exact status.
- If the baseline and the candidate carry the same app version, the check refuses to run rather than pass vacuously,
  because the launcher would not upgrade.

## 4. Verification of `cc06af1`

All results below are from **one commit**: `cc06af1933b3921f71e4c4d8fe57886045072da9` (tree
`f5834b72b7b321c9b5a14350a1b2d6aab8916472`), checked out clean, run locally on 23 Nov 2026 in one uninterrupted run
(working tree clean before and after), plus the reruns marked below on the same commit.

| Check | Result |
| --- | --- |
| Lint / architecture (14 rules, 7 packages) / typecheck / production build | pass |
| Studio unit | **3980 / 3981 in the run**: one 5 s timeout in `m3-final-static` ("no .docx … in reachable history"), which reads the whole git history; it was the first suite after a container restart (cold disk cache). Alone it passes in 1.9 s; the **whole Studio unit suite rerun on the same commit: 3981 / 3981**. No code was changed between the two. |
| Game (`@prowess/game`) | **1939 / 1939** |
| DB unit | **193 / 193** |
| Model / rules (M4) / import / ui | 513 / 659 / 128 / 21 — all passed |
| Desktop and distribution (`node --test`) | **5 / 5** (2 boundary + 3 new installed-upgrade tests) |
| DB integration (2 shards, fresh migrated databases) | **309 + 352 = 661 / 661** |
| Studio integration | **247 / 247** |
| **Playwright — complete suite, one run, fresh test database** | **118 / 118 passed** (18.6 min) |
| Negative controls | RULES-WO1 **13/13**, M6-WO1 **18/18**, PRE-M7-WO1 **13/13**, M7-WO1 **10/10** — every mutation caught and restored byte for byte |
| New-kinds transfer proof | pass |
| Previous-build restore proof | pass — backup written by main `23f3c03` (app 0.1.2), 1,192,157 bytes, SHA-256 `dede0125e09a23254936304c80e0d98edb11fc2f3f60fb87256a2d372b97043a`; all 69 tables identical; both Character sheets equal |
| Migrations | Fresh: 31 applied, no Prisma drift. Upgrade from the populated earlier chain: no drift; no pre-existing table changed. |
| 390 px timing (P06) | editor ready 373 ms; preview round trip 90 ms |
| **Installed-upgrade proof logic (HTTP level, separate run)** | pass — a `23f3c03` Studio server prepared 2 Releases, 3 Characters, an encounter with 2 participants and a Character mid-turn (AP 3 after a Move); the candidate server preserved every recorded field and all rows in 13 tables (808 manifest entries, 4 play events, 5 encounter events, …), committed a Move (AP 2) and an encounter command (version 6), and kept them after a restart. Two tamper runs (AP raised; a participant deleted) failed as intended — **run on `cc06af1` itself** (clean detached checkout; each log names the candidate commit). An earlier pair, made before `cc06af1` was committed (HEAD `2df9e87` with the then-uncommitted proof module, the same content as committed: blob `463a2b5`), is superseded and kept only as history. Not the Windows installer, launcher or gateway. |
| Workflow / PowerShell static checks | `actionlint` clean; both scripts parse with PowerShell 7.4 (0 errors) |

Local substitutions are unchanged from earlier checkpoints (migrations applied with `psql` from the committed files; drift
checked with the official WebAssembly schema engine; the transfer and previous-build proofs run copies of their scripts,
changed only in the migrate step). An earlier attempt at this run was cut off by a container restart before any
result and was restarted from the beginning.

**Not run here (pending hosted CI, blocked by publication):** hosted CI; Tier 2; `windows-package`; `windows-installed`
(installed smoke, including backup / restore); **`windows-upgrade` (the actual Windows installed upgrade)**; the
installed About check. The DIST-WO1 standard-user Windows 11 lifecycle check remains separately deferred.
