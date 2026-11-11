# DIST-WO1 local implementation checkpoint

The standard-user feasibility proof passed on Windows 11 Home x64 build 26200. It used commit `30db02767dc1039c1deaef58b740cfcbdfaa41b9`, PostgreSQL 16.14 and the production Studio package. All 29 migrations applied with zero drift. The package rendered a PNG and preserved the same Character and Release after Studio and PostgreSQL both restarted. The proof archive SHA-256 is `d8d946d7c3924fccd689dc82d9d56d41885c8075ad7c8da5d25edb7033730cf6`. See [the feasibility record](../architecture/dist-wo1-feasibility.md).

The local implementation adds a per-user installer, native launcher, authenticated loopback gateway, owned PostgreSQL workspace, demo and empty first-run choices, and backup, restore, and staged upgrade. The implementation uses the existing Studio production server and application database schema. The only new table is `public.prowess_local_owner` in the separate PostgreSQL maintenance database. There are no new workspace migrations. The desktop endpoints are `/__prowess_desktop/{launch,session,control,status,waiting,manage,setup,backup,restore,diagnostics,quit}`. The existing Studio routes keep their contracts. The compiled launcher uses the Go standard library. Node, PostgreSQL, NSIS and the app-local Microsoft CRT are pinned distribution inputs. The staged controller uses the repository's existing `pg` dependency.

## Verification

| Check | Local result |
| --- | --- |
| Production build and staging | Fresh worktree build with Node 22.23.4, pnpm 9.15.9, generated Prisma Client, Next.js 16.3.6 standalone, and the desktop proxy |
| Workspace smoke | Linux packaged runtime and PostgreSQL 16.14 in disposable directories with spaces and accented characters. Both first-run choices passed. The demo created a Character pinned to its Release, backed up and restored the same row, refused a truncated backup and an old browser session, and reopened the same Character after shutdown. The first run reached readiness in approximately 8 seconds in this environment. |
| Browser regression attempt | The local Chromium process could not create its process singleton socket in the execution environment. The hosted Studio API was reachable in ordinary deployment mode. The two existing WO12 interactive journeys require a browser-capable runner. |
| Windows binaries | Go 1.27.4 cross-compiled the Windows amd64 GUI launcher. NSIS 3.12 compiled an installer with a fixture archive. The actual production installer build and installed use need a native Windows environment. |
| Distribution regression checks | `node --test scripts/distribution/prototype-evidence.test.mjs scripts/distribution/desktop/desktop-boundary.test.mjs` passed 16 tests. `PROWESS_EXPECT_CONTROLS=6 node scripts/distribution/desktop/negative-controls.mjs` caught all six controls and restored every source file. |
| Permanent inventory | `node scripts/check-architecture.mjs` and `node scripts/ci/gate-inventory.mjs` passed. The existing 44 named gates and 719 historical controls remain in the consolidated workflow. The static job gains the DIST-WO1 boundary tests and controls. Tier 2 and Tier 3 gain Windows package and installed-artifact jobs. |

## Acceptance matrix

| ID | Evidence and next verification |
| --- | --- |
| W01 | Native launcher and installer compile checks. Pending real shortcut launch on clean standard-user Windows 11. |
| W02 | Both choices passed the local packaged runtime smoke. Pending interactive Windows first run and full demo journey. |
| W03 | Local exact Character and Release recovery after restart. Pending Windows UI finalization, loadout, Spell, Maneuver, mid-turn effect and reboot evidence. |
| W04 | Per-user lifecycle lock and authenticated duplicate invocation implemented. Pending real double-shortcut and two-tab Windows test. |
| W05 | Ephemeral loopback ports, exact storage owner checks and bounded startup. Pending occupied-port and unrelated-process Windows test. |
| W06 | Owned process job, bounded close and interruption detection implemented. Pending Windows crash and interrupted initialization tests. |
| W07 | Same-workspace local backup/restore preserved the exact Character fingerprint. Pending second clean installation and mid-turn fingerprint, portrait and event evidence. |
| W08 | Truncated backup and stale session refusal passed locally. Pending Windows interrupted staging and executable-object-bearing backup cases. |
| W09 | Recovery snapshot, isolated migration, and checked pointer activation implemented. Pending real old-to-new installer and UI evidence. |
| W10 | Downgrade guard, upgrade journal and prior version shortcut implemented. Pending injected failures and recovery on Windows. |
| W11 | Installer stores user data outside its uninstall directory. Pending Windows uninstall/reinstall test. |
| W12 | Local HTTP checks rejected hostile Host and Origin, unauthorized access, replay, and stale session. Pending Windows browser and non-loopback access checks. |
| W13 | Standard-user Windows 11 feasibility proof passed. Pending production installer on a clean offline account, including Unicode, low disk and read-only paths. |
| W14 | Local build, architecture and permanent inventory checks passed. Full CI and the existing WO12 interactive journeys remain pending. |

See the [installer and recovery guide](windows-installer.md) for artifact build and independent Windows verification commands. Record installation time and actual installer byte size from the produced artifact. This checkpoint has no published branch, PR, dispatched CI run, public installer, merge, or signature.
