# DIST-WO1 packaged-runtime feasibility checkpoint

Windows verification is pending. The work order's early proof requires a Windows 11 x64 run under an ordinary user account. Use the prototype on a disposable test machine. The player installer and launcher, local session boundary, first-run choices, whole-workspace backup and restore, application updates, and Windows CI acceptance are subsequent work.

## Baseline and packaging choice

The baseline is WO12 merged main, commit f5c277b0692e28b7d47a356f83a140fd5614200c and tree d6de200302327999cbdec909cf6b1ea05f79d7ac. Prowess Studio CI #272 passed all 16 jobs on that commit. The existing gate inventory has 44 gates and 719 controls in 26 scripts.

The build opts into Next.js 16.3.6 standalone output with the monorepo tracing root. The stage includes static/public assets and the runtime dependencies from that build. A separate migration directory carries the Prisma 7.10.0 CLI, its installed dependency graph from the frozen pnpm install, the platform schema engine, and the database configuration and migrations. The staging script excludes environment files. It writes package-relative link targets so the Windows proof can create junctions at the final location.

The build command creates a new detached worktree of the clean source commit, installs the frozen lockfile, generates Prisma, and builds production Studio there. After a successful build, it verifies the clean source again and writes the commit, tree, Next.js build ID, toolchain and output SHA-256 into the ignored build directory. Staging checks that record against the checkout and the standalone and static output before and after copying. The package manifest includes the verified build record, the staged payload SHA-256, runtime versions, Node checksum, and the shipped migration list. The proof records a separate manifest SHA-256.

The Windows probe uses the existing WO12 preparation command from the build checkout to create a Release in a newly created local test database. It starts only the packaged binaries in child processes with a system-only PATH and explicit loopback configuration. It checks the PostgreSQL version and cluster path, deploys and verifies the shipped migrations, creates a Character draft through Studio's real API, and compares the API response and the exact database row hash across a restart of both processes. The stage contains the production app and migration tooling. Fixture code stays in the build checkout.

The Windows build and stage at `bb4bf93` passed, then `initdb` failed when Windows encoded the accented path as `0xe9` during UTF-8 bootstrap. The revised probe creates two ASCII-named directory junctions under its ASCII temporary parent. They point to the packaged PostgreSQL runtime and the accented disposable profile. PostgreSQL opens the same staged binaries, data, and logs through those paths. Studio and Prisma still launch from the original package path with spaces and an accented character. The probe checks that PostgreSQL reports UTF-8 and that its data directory resolves to the owned cluster. The evidence records the physical and PostgreSQL paths. Unicode parent directories for the junctions remain outside this prototype check.

At `4063122`, PostgreSQL initialized and reached loopback readiness on Windows 11 build 26200. The probe timed out waiting for `pg_ctl start` with captured pipes, then shut down the owned database. The startup command now sends both output streams to `pg-ctl-start.log`. The server still writes to `postgres.log`, and the probe retains both the bounded `pg_ctl` readiness check and its own query of the owned database.

At `244e380`, PostgreSQL startup and the ownership query passed on Windows. Prisma then failed to load the `@prisma/studio-core/data/bff` export during schema validation. The migration stage now copies complete installed package directories and their package-local links. The Windows probe validates the staged CLI and schema before initializing PostgreSQL.

At `ebf55ad`, Windows applied and checked all 29 migrations with zero schema drift and created the test Release. Studio could load the sharp JavaScript entry point but its Windows add-on failed with `ERR_DLOPEN_FAILED`. The add-on's import table names `libvips-42.dll` and `libvips-cpp-8.18.6.dll`. Staging now copies the full frozen `@img/sharp-win32-x64` package and checks both libraries are present. The probe renders a PNG with the packaged Node and sharp before starting PostgreSQL.

## Prototype toolchain

| Input | Pin and origin |
| --- | --- |
| Node and bundled Node license | Node v22.23.4 x64, from the official distribution |
| Windows Node ZIP SHA-256 | cbc74b5e0982c9dbb41525fd8fb5dcd32fbee237863f7829072f4639a1ce5f20 |
| Linux Node tar.xz SHA-256 | 1805bcd35e6815559bd2eb97db438d3fdb0eb3a5e6a977b7c1badca76337e9ce |
| Package manager and dependencies | pnpm 9.15.9 with the repository lockfile |
| Windows PostgreSQL prototype | PostgreSQL 16.14 from @embedded-postgres/windows-x64 16.14.0-beta.17. The staging script verifies the exact npm archive SHA-512 and retains its license and notices. |
| Windows Visual C++ runtime | Versioned x64 Microsoft.VC143.CRT files from the build toolchain's redistributable directory. The staged manifest records the exact version and each DLL's SHA-256. |

The PostgreSQL archive imports MSVCP140.dll and VCRUNTIME140.dll. Supply the eligible x64 CRT DLLs from the build toolchain's versioned Visual Studio redist directory. Verify their Microsoft signatures on the build machine. Staging places the DLLs next to the packaged executables for app-local loading. The PostgreSQL package pin is for the feasibility probe. Final distribution requires a reviewed runtime with the complete backup/restore toolset and redistribution notices.

## Run the Windows proof

Use a disposable native x64 Windows 11 workstation or VM and sign in with a standard local user account. Have Git, Windows PowerShell, the pinned Node distribution with Corepack and its license, build-time registry access, and read access to the versioned x64 Visual Studio redistributable directory. Put the extracted Node on the build shell's PATH. The probe reads the packaged Node process's Windows access token, verifies the OS and native architecture, and requires an unelevated token with no effective Administrator role or linked administrator token.

Use the following in PowerShell from the clean checkpoint checkout. The build uses a loopback placeholder on port 1. The test harness creates its disposable database during the proof.

    $build = Join-Path $env:TEMP ('Prowess-build-' + [guid]::NewGuid().ToString('N').Substring(0,8))
    node scripts/distribution/build-prototype.mjs $build
    if ($LASTEXITCODE -ne 0) { throw 'The prototype build failed.' }
    npm pack --pack-destination "$env:TEMP" '@embedded-postgres/windows-x64@16.14.0-beta.17'
    if ($LASTEXITCODE -ne 0) { throw 'The pinned PostgreSQL archive is unavailable.' }
    $archive = Join-Path $env:TEMP 'embedded-postgres-windows-x64-16.14.0-beta.17.tgz'
    $stage = Join-Path $env:TEMP ('Prowess prototype é ' + [guid]::NewGuid())
    $crt = '<versioned Visual Studio redist path>\x64\Microsoft.VC143.CRT'
    node (Join-Path $build 'scripts\distribution\stage-prototype.mjs') $stage $archive $crt
    if ($LASTEXITCODE -ne 0) { throw 'The prototype could not be staged.' }
    & (Join-Path $stage 'runtime\node.exe') (Join-Path $build 'scripts\distribution\verify-windows-prototype.mjs') $stage
    if ($LASTEXITCODE -ne 0) { throw 'The Windows feasibility proof failed.' }

Keep the build checkout for staging and fixture preparation. Stage a fresh package for each proof so its physical payload can be verified before link materialization. The proof writes evidence.json after checking the packaged runtime, Prisma deployment and zero drift, and the exact Character draft and Release across a restart. The report includes the OS build, architecture, process token status, source and package identities, and both database fingerprints. It retains the isolated test directory and logs for review.

## Verification boundary

Run the portable regression checks with `node --test scripts/distribution/prototype-evidence.test.mjs`. They cover missing and stale build records, source and output mismatches, package hashes, and acceptance rules for Windows host and process reports. Windows acceptance requires the actual Windows run. Two earlier Linux PostgreSQL startup attempts failed at the loader because libicui18n.so.60 was unavailable.

After the feasibility proof, complete the compiled launcher, installer, data protection and recovery work, then execute W01–W14 against the installed artifact. The final gate and Windows Tier 2 job belong to that verified implementation. The M6-WO12 test-only Release and its guards continue to govern the proof fixture.

[Baseline CI #272](https://github.com/prowessttrpg-png/prowess-studio/actions/runs/42742543959) · [Next.js standalone output](https://nextjs.org/docs/app/api-reference/config/next-config-js/output) · [Prisma migrate deploy](https://www.prisma.io/docs/orm/v7/reference/prisma-cli-reference#migrate-deploy) · [Node distribution](https://nodejs.org/dist/v22.23.4/SHASUMS256.txt) · [PostgreSQL binary package source](https://github.com/leinelissen/embedded-postgres) · [Microsoft app-local CRT deployment](https://learn.microsoft.com/en-us/cpp/windows/deployment-in-visual-cpp) · [Windows token elevation types](https://learn.microsoft.com/en-us/windows/win32/api/winnt/ne-winnt-token_elevation_type) · [Windows process and native architecture](https://learn.microsoft.com/en-us/windows/win32/api/wow64apiset/nf-wow64apiset-iswow64process2)
