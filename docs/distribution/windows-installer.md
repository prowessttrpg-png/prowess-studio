# Prowess Studio on Windows

## Player installation

1. On Windows 11 x64, sign in to your ordinary account. Use the supplied Prowess Studio Windows installer and its matching SHA-256. The build described here is for internal testing.
2. Run the installer and wait for it to finish. Open **Prowess Studio** from the desktop or Start menu.
3. The launcher opens Studio in your default browser. Choose **Demo — sample rules** to work with the included playtest Release, or **Start with an empty workspace** to create an empty database. The demo uses a sample Release and is also labelled in Rules Reference.
4. Use **Open Studio** to open another tab. Use **Manage Workspace** for backup, restore, or diagnostics. Use **Quit** in the launcher when you want to close both Studio and its database.

### Backup and recovery

- In **Manage Workspace**, select **Back up local workspace** and save the downloaded `.prowess-backup` file. The backup contains game data, including portrait bytes. Keep it somewhere you control.
- To restore, open the destination workspace. For a fresh installation, choose **Start with an empty workspace** first. Select the backup in **Manage Workspace**, then choose **Restore local workspace** and confirm. Restore replaces the active workspace after checking a staging database. Open Studio again from the launcher when the restore finishes.
- Installation files live under `%LOCALAPPDATA%\Prowess Studio`. The active workspace and recovery backups live under `%LOCALAPPDATA%\Prowess Studio Data`. Ordinary uninstall retains the workspace.
- If a database or Studio process stops, quit and reopen the launcher. If a new version cannot open your workspace, use **Previous Prowess Studio** in the Start menu to try the last installed version. A successfully upgraded workspace requires a compatible current version. Keep any files in the data folder for recovery, and use **Download diagnostics** to report the failure.

## Maintainer packaging

Build on native Windows x64 from a clean Git checkout. Install Git and NSIS 3.12 on the maintainer machine. The build downloads verified Node, Go, PostgreSQL and Microsoft CRT archives. Use a short ASCII temporary directory on the build machine.

```powershell
.\scripts\distribution\build-windows-installer.ps1 `
  -OutputDirectory C:\ProwessBuild\artifact `
  -MakeNsis 'C:\Program Files (x86)\NSIS\makensis.exe'
```

The output directory contains the unsigned installer, `installer-build.json`, the production payload manifest and the installed-artifact verification files. Record the installer bytes and SHA-256 from the build record. A different installer SHA-256 requires its own evidence.

Copy the artifact directory to a clean Windows 11 x64 standard account. Open Windows PowerShell in that directory and run the following. The verification uses the installed Node binary and an isolated PATH, and leaves the disposable test installation available for inspection.

```powershell
.\verify-windows-installer.ps1 `
  -ArtifactDirectory . `
  -EvidenceDirectory "$env:USERPROFILE\Desktop\Prowess-Installed-Evidence"
```

Open and use the desktop shortcut interactively for the W01–W14 matrix in the implementation report. Record OS build, privileges, package identity and any failed cases. A build-runner result uses `-BuildRunner` and is recorded separately from clean Windows 11 evidence.

### Redistributables and build inputs

| Input | Version and provenance | Record or notice |
| --- | --- | --- |
| Node | Official Windows x64 22.23.4 ZIP | Archive and executable SHA-256, `payload/runtime/Node-LICENSE.txt` |
| pnpm | 9.15.9 through Corepack | Source lockfile and build stamp |
| PostgreSQL | 16.14 from `@embedded-postgres/windows-x64@16.14.0-beta.17` | Registry archive SHA-512, accompanying notices under `payload/runtime/postgres` |
| Microsoft VC143.CRT | Microsoft Visual Studio x64 14.44.35112 app-local redistributable | Microsoft-signed DLLs, archive and DLL SHA-256 in the manifests |
| Go | Official Go 1.27.4 Windows amd64 ZIP | Archive SHA-256, `Go-LICENSE.txt` |
| NSIS | 3.12 Unicode stub | Compiler version in the build record |
| Application dependencies | Versions in `pnpm-lock.yaml` | Installed dependency license files in the staged production and migration packages |
