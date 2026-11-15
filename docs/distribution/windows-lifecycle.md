# DIST-WO1 Windows lifecycle verification

This run upgrades the verified 0.1.0 installer to an internal 0.1.1 candidate and tests how installation, recovery, and removal affect saved play. Keep the original 0.1.0 installer folder, including its manifest and build record. The expected installer SHA-256 is `982bed23fe02dc60048dea4f53955ba24c29aa366ec4df4134dfac1ecbd68ad9`.

## Export the completed playtest Character

1. On **ProwessProof**, open the Character you used for the walkthrough on **Release 2 — R2**.
2. On the **Character Sheet**, upload a sample PNG or JPEG using **Upload portrait image**. Use an image you are comfortable putting in a test backup.
3. If the encounter ended, choose **Resume play → Begin combat → Start round → Start my turn**, then cast **Steady Ward** again. Leave the turn open with the ward **active**. If you need mana to cast again, use **Resources → Manual adjustment (player / GM)** to restore enough mana for the test. Leave exactly one sample Character mid-turn.
4. In the Prowess launcher window, open **Manage Workspace → Back up local workspace**. Save or copy the backup to **Public Documents** (`$env:PUBLIC\Documents` in PowerShell) with the name `Prowess-Lifecycle-Playtest.prowess-backup`. The backup is used locally by the verifier.

## Build and transfer 0.1.1

From the account with Git and NSIS installed, extract the new checkpoint ZIP and run this in the extracted folder:

```powershell
git clone --branch dist-wo1-windows-launcher .\Prowess-DIST-WO1-lifecycle.bundle Prowess-DIST-WO1-lifecycle
Set-Location .\Prowess-DIST-WO1-lifecycle
$nsis = Join-Path $env:USERPROFILE 'Downloads\nsis-3.12\nsis-3.12\makensis.exe'
$documents = Join-Path $env:PUBLIC 'Documents'
$candidate = Join-Path $documents 'Prowess-Lifecycle-0.1.1'
$build = Join-Path $PWD 'scripts\distribution\build-windows-installer.ps1'
powershell.exe -NoProfile -ExecutionPolicy RemoteSigned -File $build -OutputDirectory $candidate -MakeNsis $nsis
```

If your NSIS compiler is in a different folder, use its full path for `$nsis`. The candidate folder should contain `ProwessStudio-0.1.1-…-Windows-x64.exe`, `installer-build.json`, `prototype.json`, and the verification scripts. Copy the original 0.1.0 artifact folder to Public Documents too. The previous verification used the `Prowess-Installer-20261111-141213` folder in Public Documents.

## Run in a clean Windows standard account

Use a fresh standard Windows account, such as **ProwessLifecycle**, with no prior Studio installation or app data. Keep your existing **ProwessProof** workspace for the playtest. The lifecycle verifier installs, upgrades, and uninstalls the application on the fresh account. Some browser tabs can open while the steps run.

In Windows PowerShell on the fresh account, paste:

```powershell
$documents = Join-Path $env:PUBLIC 'Documents'
$old = Join-Path $documents 'Prowess-Installer-20261111-141213'
$candidate = Join-Path $documents 'Prowess-Lifecycle-0.1.1'
$backup = Join-Path $documents 'Prowess-Lifecycle-Playtest.prowess-backup'
$evidence = Join-Path ([Environment]::GetFolderPath('DesktopDirectory')) 'Prowess-Lifecycle-Evidence'
$verify = Join-Path $candidate 'verify-windows-lifecycle.ps1'
powershell.exe -NoProfile -ExecutionPolicy RemoteSigned -File $verify -PreviousArtifact $old -CandidateArtifact $candidate -PlaytestBackup $backup -EvidenceDirectory $evidence
```

On success, restart Windows, sign back in to the same test account, then run:

```powershell
$candidate = Join-Path $env:PUBLIC 'Documents\Prowess-Lifecycle-0.1.1'
$evidence = Join-Path ([Environment]::GetFolderPath('DesktopDirectory')) 'Prowess-Lifecycle-Evidence'
$verify = Join-Path $candidate 'verify-windows-lifecycle.ps1'
powershell.exe -NoProfile -ExecutionPolicy RemoteSigned -File $verify -CandidateArtifact $candidate -EvidenceDirectory $evidence -AfterReboot
Compress-Archive -LiteralPath $evidence -DestinationPath "$evidence.zip" -Force
```

Upload the single **Prowess-Lifecycle-Evidence.zip** from the test account Desktop. If the first run fails, stop there and zip the evidence folder if it exists. Otherwise send the first error line. The evidence folder contains artifact identities, status and fingerprints. The exported backup stays on your machine.

## Coverage

The verification checks the empty workspace, port conflicts, a second launcher invocation and a second authenticated session, launcher crash recovery, and restore on a second installation. It compares the original backup rows to independently queried Character, portrait, exact Release, ability revision, and play ledger rows. It checks rejected backups, staged upgrade failure, a real 0.1.0-to-0.1.1 upgrade, downgrade refusal, uninstall/reinstall, and persisted play state after reboot. It records the count of non-loopback IPv4 interfaces probed.

Additional Windows cases are tracked in the acceptance matrix, including an unrelated PostgreSQL instance, separate Studio and database crashes, interrupted initialization and restore, browser-based isolation, and offline, Unicode-path, and disk/permission conditions. CI remains required for acceptance.
