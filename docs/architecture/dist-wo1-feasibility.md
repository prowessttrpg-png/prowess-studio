# DIST-WO1 packaged-runtime feasibility checkpoint

Windows verification is pending. The work order's early proof requires a Windows 11 x64 run under an ordinary user account. Use the prototype on a disposable test machine. The player installer and launcher, local session boundary, first-run choices, whole-workspace backup and restore, application updates, and Windows CI acceptance are subsequent work.

## Baseline and packaging choice

The baseline is WO12 merged main, commit f5c277b0692e28b7d47a356f83a140fd5614200c and tree d6de200302327999cbdec909cf6b1ea05f79d7ac. Prowess Studio CI #272 passed all 16 jobs on that commit. The existing gate inventory has 44 gates and 719 controls in 26 scripts.

The build opts into Next.js 16.3.6 standalone output with the monorepo tracing root. The stage includes static/public assets, runtime dependencies, and the Prisma 7.10.0 migration CLI and platform schema engine traced from the frozen pnpm install. The staging script excludes environment files. It writes package-relative link targets so the Windows proof can create junctions at the final location. It also records source commit/tree, build platform, runtime versions, Node checksum, and the shipped migration list. Ordinary Next.js builds retain the default configuration.

The Windows probe uses the existing WO12 preparation command from the build checkout to create a Release in a newly created local test database. It starts only the packaged binaries in child processes with a system-only PATH and explicit loopback configuration. It checks the PostgreSQL version and cluster path, deploys and verifies the shipped migrations, creates a Character draft through Studio's real API, and compares the API response and the exact database row hash across a restart of both processes. The stage contains the production app and migration tooling. Fixture code stays in the build checkout.

## Prototype toolchain

| Input | Pin and origin |
| --- | --- |
| Node and bundled Node license | Node v22.23.4 x64, from the official distribution |
| Windows Node ZIP SHA-256 | cbc74b5e0982c9dbb41525fd8fb5dcd32fbee237863f7829072f4639a1ce5f20 |
| Linux Node tar.xz SHA-256 | 1805bcd35e6815559bd2eb97db438d3fdb0eb3a5e6a977b7c1badca76337e9ce |
| Package manager and dependencies | pnpm 9.15.9 with the repository lockfile |
| Windows PostgreSQL prototype | PostgreSQL 16.14 from @embedded-postgres/windows-x64 16.14.0-beta.17. The staging script verifies the exact npm archive SHA-512 and retains its license and notices. |

The PostgreSQL package pin is for the feasibility probe. Final distribution requires a reviewed runtime with the complete backup/restore toolset and redistribution notices.

## Run the Windows proof

On a disposable Windows 11 x64 test machine, use a clean checkout of the checkpoint and Node extracted from the verified Windows ZIP. Use an ordinary account and retain the Node license beside node.exe. Use a build shell with the extracted Node and its pinned pnpm shim on PATH. Record the exact account privilege and OS build. The stage and disposable data paths must include spaces and non-ASCII characters.

Use the following in PowerShell from the repository root. The build uses a loopback placeholder on port 1. Only the test harness creates and uses a database.

    node --version
    corepack enable pnpm
    pnpm --version
    pnpm install --frozen-lockfile
    $env:DATABASE_URL = 'postgresql://dist_prototype:build@127.0.0.1:1/dist_build_unused'
    $env:APP_URL = 'http://127.0.0.1:3000'
    $env:DEVELOPMENT_MODE = 'false'
    $env:PROWESS_STANDALONE_BUILD = 'true'
    pnpm db:generate
    pnpm build
    npm pack --pack-destination "$env:TEMP" '@embedded-postgres/windows-x64@16.14.0-beta.17'
    $archive = Join-Path $env:TEMP 'embedded-postgres-windows-x64-16.14.0-beta.17.tgz'
    $stage = Join-Path $env:TEMP ('Prowess prototype é ' + [guid]::NewGuid())
    node scripts/distribution/stage-prototype.mjs $stage $archive
    & (Join-Path $stage 'runtime\node.exe') scripts/distribution/verify-windows-prototype.mjs $stage

Check every command's exit code before proceeding. The final command writes evidence.json only after it verifies the installed runtime, Prisma deployment/status/zero drift, exact Release identity, Character draft, and post-restart fingerprint. It retains the isolated test directory and logs for review. Retain the stage and its source metadata with that evidence. The app and PostgreSQL are started from the staged files. Test-content preparation and the independent database fingerprint use the build checkout.

## Verification boundary

The Linux build and stage can exercise package assembly, local link resolution, the packaged schema validator, the native image library, and a production HTTP response. A Linux run cannot satisfy Windows acceptance. Two Linux PostgreSQL startup attempts failed at the loader because libicui18n.so.60 was unavailable, both from the extracted archive and with the package's link hydration command and bundled library path. Database deployment and restart evidence remain pending on Windows.

After the feasibility proof, complete the compiled launcher, installer, data protection and recovery work, then execute W01–W14 against the installed artifact. The final gate and Windows Tier 2 job belong to that verified implementation. The M6-WO12 test-only Release and its guards continue to govern the proof fixture.

[Baseline CI #272](https://github.com/prowessttrpg-png/prowess-studio/actions/runs/42742543959) · [Next.js standalone output](https://nextjs.org/docs/app/api-reference/config/next-config-js/output) · [Prisma migrate deploy](https://www.prisma.io/docs/orm/v7/reference/prisma-cli-reference#migrate-deploy) · [Node distribution](https://nodejs.org/dist/v22.23.4/SHASUMS256.txt) · [PostgreSQL binary package source](https://github.com/leinelissen/embedded-postgres)
