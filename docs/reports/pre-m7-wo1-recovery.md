# PRE-M7-WO1 — recovery report

Written before any implementation change (Phase A, acceptance C01).

## Remote and baseline

| Item | Value |
| --- | --- |
| Remote | `https://github.com/prowessttrpg-png/prowess-studio.git` (fresh clone; public read over HTTPS) |
| Baseline (`main`) | `16ee5c61edf57efc27af751c68aec681e6fd6c48` — "Merge pull request #76 from prowessttrpg-png/dist-wo2-content-packs" (2026-11-16) |
| Baseline tree | `91bbd6d5dc822ce812cfbb19f2c408627c9f4493` — matches the work order's planning baseline |
| Branch | `pre-m7-wo1-compendium-authoring-and-cleanup`, created from the baseline; local tag `pre-m7-wo1-baseline`. No branch of that name existed on the remote. |
| Ancestry | M6-WO12 merge `f5c277b` and DIST-WO1 merge `332639f` are ancestors of the baseline (`git merge-base --is-ancestor`) |
| Main CI | Merged-main CI #281: 18 / 18 jobs passed, including Tier 2, the Windows x64 installer build and installed-artifact verification. CI #280 passed on the PR #76 candidate `82cf4ec`. Source: the public PR #76 page; the Actions API is not reachable from this session (see below). |

## Changes since M6-WO12 (`f5c277b..16ee5c6`)

21 commits; 82 files, +7,161 / −23.

- **DIST-WO1 (PR #75, merge `332639f`)** — Windows desktop packaging: a Go launcher (`scripts/distribution/desktop/native/`), local gateway with session/loopback protection (`gateway.mjs`), controller, protected installed data directories (`storage.mjs`), bundled PostgreSQL started through ASCII junctions, packaged Prisma CLI and native `sharp`/libvips, an NSIS installer, whole-workspace backup / restore (`backup.mjs`), installed smoke and lifecycle scripts, and two Windows CI jobs (`windows-package`, `windows-installed`). Documentation: `docs/distribution/windows-installer.md`, `dist-wo1-report.md`, `windows-lifecycle.md`, `docs/architecture/dist-wo1-feasibility.md`.
- **DIST-WO2 (PR #76, merge `16ee5c6`)** — exact published-Release transfer through `.prowesspack`: `packages/prowess-db/src/content-pack/` (archive, manifest, graph, catalog, service), migration `20261115010000_dist_wo2_content_packs` (transfer ownership table and PostgreSQL guards that make imported rows read-only), Studio page `/compendium/content-packs`, browser / HTTP / database transfer verification (`scripts/playtest/dist-wo2-*.{ts,mjs}`, `scripts/distribution/verify-dist-wo2-transfer.mjs`) and the restore-order repair `82cf4ec` (play runtime restored before its dependent play events — the P15 finding). Documentation: `docs/architecture/dist-wo2-content-packs.md`, `docs/distribution/content-packs.md`, `content-pack-format.md`.
- No Compendium authoring, rules-engine or Character-domain source changed after M6-WO12 apart from the transfer read-only guards (imported Entity lineages cannot be extended by ordinary authoring commands).

## Repository instructions and toolchain

- No `AGENTS.md` / `CLAUDE.md`; repository rules live in the architecture documents, the invariant registries (`docs/architecture/m6-invariants.{json,md}`, earlier M-series registries), the approved-M5-changes registry, `scripts/ci/gates.json` and the CI workflow (19 jobs including the two Windows jobs).
- The "Two-Attempt Blocker Protocol" appears in the M6-WO8 reports and is followed here.
- Toolchain: Node 22.23.4, pnpm 9.15.9 (`packageManager`), TypeScript 5.9.3, Prisma 7.10.0, PostgreSQL 16. `pnpm install --frozen-lockfile` succeeded.

## Environment limits in this session (recorded, not hidden)

- Prisma engine downloads are refused by the network proxy (`binaries.prisma.sh` 403). `prisma generate` succeeds with `PRISMA_ENGINES_CHECKSUM_IGNORE_MISSING=1` and a stand-in schema-engine path; `migrate deploy` and the drift check cannot run here — migrations are applied with a script that executes each migration's SQL and records it, and those two checks are CI-only.
- The GitHub API (Actions runs, artifacts, PR creation) and authenticated pushes are not available to this session (`gh` token invalid; the git proxy refuses to inject credentials for this repository). Public pages and anonymous clone/fetch work. Opening the PR and running hosted CI therefore need the owner's push (see the final report).
- No Windows host: the installer build and installed-artifact checks run only in hosted CI.

## Existing work preserved

The older checkout `/home/claude/prowess-studio` (branch `m6-wo12`, HEAD `d6006db`) had uncommitted correction work for the superseded WO12 follow-up; it was stashed in place (`stash@{0}`), not discarded, and this assignment uses a separate fresh clone.

## Inaccessible artifacts

CI #275–#281 logs and uploaded artifacts (installer hashes, browser evidence) are not downloadable here; their outcomes are taken from the public PR #75 / #76 pages and the architecture documents. The separately deferred DIST-WO1 standard-user Windows 11 lifecycle check (`docs/distribution/windows-lifecycle.md`) remains open.
