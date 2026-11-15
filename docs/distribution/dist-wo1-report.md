# DIST-WO1 local implementation checkpoint

The standard-user feasibility proof passed on Windows 11 Home x64 build 26200. It used commit `30db02767dc1039c1deaef58b740cfcbdfaa41b9`, PostgreSQL 16.14 and the production Studio package. All 29 migrations applied with zero drift. The package rendered a PNG and preserved the same Character and Release after Studio and PostgreSQL both restarted. The proof archive SHA-256 is `d8d946d7c3924fccd689dc82d9d56d41885c8075ad7c8da5d25edb7033730cf6`. See [the feasibility record](../architecture/dist-wo1-feasibility.md).

The local implementation adds a per-user installer, native launcher, authenticated loopback gateway, owned PostgreSQL workspace, demo and empty first-run choices, and backup, restore, and staged upgrade. The implementation uses the existing Studio production server and application database schema. The only new table is `public.prowess_local_owner` in the separate PostgreSQL maintenance database. There are no new workspace migrations. The desktop endpoints are `/__prowess_desktop/{launch,session,control,status,waiting,manage,setup,backup,restore,diagnostics,quit}`. The existing Studio routes keep their contracts. The compiled launcher uses the Go standard library. Node, PostgreSQL, NSIS and the app-local Microsoft CRT are pinned distribution inputs. The staged controller uses the repository's existing `pg` dependency.

## Verification

| Check | Local result |
| --- | --- |
| Production build and staging | Fresh worktree build with Node 22.23.4, pnpm 9.15.9, generated Prisma Client, Next.js 16.3.6 standalone, and the desktop proxy |
| Workspace smoke | Linux packaged runtime and PostgreSQL 16.14 in disposable directories with spaces and accented characters. Both first-run choices passed. The demo created a Character pinned to its Release, backed up and restored the same row, refused a truncated backup and an old browser session, and reopened the same Character after shutdown. The first run reached readiness in approximately 8 seconds in this environment. |
| Browser regression attempt | The local Chromium process could not create its process singleton socket in the execution environment. The hosted Studio API was reachable in ordinary deployment mode. The two existing WO12 interactive journeys require a browser-capable runner. |
| Windows binaries | The Windows x64 production build generated the NSIS 3.12 installer. Temporary worktree cleanup hit a long path after the installer and build record were written. The build script now handles long dependency paths and preserves the installer’s success status if cleanup fails. |
| Distribution regression checks | `node --test scripts/distribution/prototype-evidence.test.mjs scripts/distribution/desktop/desktop-boundary.test.mjs` passed 16 tests. `PROWESS_EXPECT_CONTROLS=6 node scripts/distribution/desktop/negative-controls.mjs` caught all six controls and restored every source file. |
| Permanent inventory | `node scripts/check-architecture.mjs` and `node scripts/ci/gate-inventory.mjs` passed. The existing 44 named gates and 719 historical controls remain in the consolidated workflow. The static job gains the DIST-WO1 boundary tests and controls. Tier 2 and Tier 3 gain Windows package and installed-artifact jobs. |

### Windows installed-artifact smoke

The uploaded `Prowess-Installed-Evidence-20261111-142749.zip` contains the passing `installed-evidence.json` and `workspace-smoke.json` reports. Its SHA-256 is `797092fa040fd0b89916278435f2a668ecd1497ba84b5437191527c1522610d4`. The verifier and installed launcher ran natively on Windows 11 Home x64 build 26200 with standard-user tokens. The verifier required a fresh per-user install and workspace and checked the installer, launcher, manifest, and bundled Node digests. The report's source tree and ordered migration inventory match the tested checkout.

| Field | Recorded value |
| --- | --- |
| Tested source commit | `66a1e423223dd0f54428735d57f620b4877396f5` |
| Tested source tree | `bf199d2becdebd38d34275146ba9a05ad0bca41d` |
| Installer | `ProwessStudio-0.1.0-ae53aa13bba4-Windows-x64.exe` |
| Installer SHA-256 | `982bed23fe02dc60048dea4f53955ba24c29aa366ec4df4134dfac1ecbd68ad9` |
| Installer size | 104,871,392 bytes |
| Staged package SHA-256 | `ae53aa13bba4c02ec11f3d5336d6eb0610a7a762a2a22858bf1e62fb67196254` |
| Payload manifest SHA-256 | `328855195d713fe0b3d85cf75076a0ad7a9892e3a2b5356f6187a7b8b2b21fed` |
| Migrations | 29 |
| Install and first-run timings | 82,583 ms for installation and 19,993 ms from initial smoke connection to database-backed readiness |
| Sample Character | `f7a1743f-8b8c-49a0-98ba-cca497de09be` |
| Sample Release | `376355f5-f4b6-4843-822b-5f972926cb27` |
| Restored Character row SHA-256 | `ff41d8bb999503b4c11f285600378e9f7d7f053247ad8ed26d7a21d60273845d` |

The smoke passed per-user installation and shortcut registration, demo first run, local HTTP isolation, Character creation with the expected Release, exact row comparison after backup and restore, refusal of a truncated backup and a stale browser session, and equality of the Character response after a full launcher restart. A separate user screenshot shows the installed Studio dashboard open in Edge on loopback. The uploaded archive contains verifier reports. The installer executable and the backup row are outside that archive, so the verifier's recorded checksum and fingerprint checks provide those results.

### Interactive Windows playtest

The tester confirmed completion of the full interactive walkthrough on the installed Windows build. They previously confirmed that a saved Character was still editable after relaunch and that the Play Workspace opened. The completed walkthrough covers the demo rule revision through Release 2, Character creation and loadout, ability building, combat, and mid-turn resume. This is tester-reported evidence. The walkthrough's optional negative cases and a Windows reboot have no separate result recorded.

## Acceptance matrix

| ID | Evidence and next verification |
| --- | --- |
| W01 | Per-user installation, desktop shortcut registration, and launcher start passed on a clean Windows 11 standard account. In the instructed relaunch check the tester returned to the dashboard and could still edit their Character. |
| W02 | Windows installed smoke passed demo first run, and the tester completed the demo journey on Windows. Both choices passed the local packaged runtime smoke. The interactive Windows empty-workspace choice remains pending. |
| W03 | Windows installed smoke created a draft Character on the expected Release and recovered the exact Character response after restart. The tester completed the UI walkthrough covering finalization, loadout, Spell, Maneuver, and mid-turn resume. Windows reboot and an independent mid-turn database fingerprint remain pending. |
| W04 | Per-user lifecycle lock and authenticated duplicate invocation implemented. Pending real double-shortcut and two-tab Windows test. |
| W05 | Ephemeral loopback ports, exact storage owner checks and bounded startup. Pending occupied-port and unrelated-process Windows test. |
| W06 | Owned process job, bounded close and interruption detection implemented. Pending Windows crash and interrupted initialization tests. |
| W07 | Windows same-workspace backup and restore preserved the exact Character row. A second clean Windows installation and mid-turn fingerprint, portrait, and event evidence remain pending. |
| W08 | Windows installed smoke refused a truncated backup and a stale session. Interrupted staging and executable-object-bearing backup cases remain pending. |
| W09 | Recovery snapshot, isolated migration, and checked pointer activation implemented. Pending real old-to-new installer and UI evidence. |
| W10 | Downgrade guard, upgrade journal and prior version shortcut implemented. Pending injected failures and recovery on Windows. |
| W11 | Installer stores user data outside its uninstall directory. Pending Windows uninstall/reinstall test. |
| W12 | Windows installed HTTP checks rejected hostile Host and Origin, unauthenticated requests, cross-site writes, replay, and a stale session. Browser-based isolation and non-loopback connection checks remain pending. |
| W13 | Windows 11 standard-user feasibility and installed smoke passed. Offline use, Unicode installation paths, low disk, and read-only paths remain pending. |
| W14 | Local build, architecture and permanent inventory checks passed. Full CI and the existing WO12 interactive journeys remain pending. |

See the [installer and recovery guide](windows-installer.md) for artifact build and independent Windows verification commands. This checkpoint has no published branch, PR, dispatched CI run, public installer, merge, or signature.
