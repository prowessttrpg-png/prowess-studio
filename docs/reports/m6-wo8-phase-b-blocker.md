# M6-WO8 Phase B infrastructure blocker — two-attempt stop

Date: November 4, 2026 (America/Los_Angeles).

Status: **PHASE A VERIFIED; PHASE B BLOCKED; STOPPED FOR REVIEW**.

## Preserved phase boundary

- Work Order baseline: `d005fc30c8c7e175896898c1973e6d3bda144869`.
- Resumed checkpoint: `37d17f39df6ca1fa44ebc28560b8f3d17abd18ee`.
- Verified Phase A checkpoint: `debc3446c56bfed73b025953cbe5966aa8f8db31`.
- Phase A passing evidence: **448 tests / 9 files** (404 domain/regression/equivalence plus 44 WO7/WO8 static cases), successful model/rules/game build, game lint/typecheck, and clean whitespace check. Detailed suite counts and evidence hashes are in `m6-wo8-phase-a-checkpoint.md`.

No Phase B code change, database test suite, UI implementation, full regression, push, PR, or merge followed that boundary. Phase B performed only the bounded environment preflight and two attempts below. This blocker report is the only additional repository change after the verified Phase A commit.

## Exact blocker

The existing test configuration targets `localhost:5432/prowess_studio_test`, but no PostgreSQL service accepts that connection. No alternative DATABASE_URL or TEST_DATABASE_URL was configured in the process environment. No system PostgreSQL executable, Docker/Podman executable, PostgreSQL socket directory, or Docker socket was available in the preflight. Previously extracted PostgreSQL 16 binaries still exist, but the available unprivileged launch path cannot change groups. The current user namespace maps only UID 0 (`0 0 1`).

This prevents establishing the one consistent PostgreSQL 16 environment required for Phase B. The prior PostgreSQL 14.5 emulator was not restarted or substituted. No further database infrastructure troubleshooting is authorized by the two-attempt protocol in this turn.

## Both failed attempts

| Attempt | Action | Exact result | Progress |
| --- | --- | --- | --- |
| 1 | Connect with the actual project test URL using the real pg driver; require `SHOW server_version_num` to identify PostgreSQL 16 | `ECONNREFUSED` on both `::1:5432` and `127.0.0.1:5432` | No connection or server-version query completed |
| 2 | Initialize the existing native PostgreSQL 16 binaries as an unprivileged user with `runuser -u nobody -- .../initdb` | Exit **1**, `runuser: cannot set groups: Operation not permitted` | initdb did not execute; no cluster was initialized |

Both attempts failed to establish PostgreSQL 16, without meaningful infrastructure progress. There was no third attempt, package install, emulator retry, privilege escalation, port cycling, or database reset.

Machine-readable results (preserved in the recovery package):

```json
{
  "attempt": 1,
  "status": "FAILED",
  "target": "localhost:5432/prowess_studio_test",
  "code": "ECONNREFUSED",
  "message": "",
  "causes": [
    {
      "code": "ECONNREFUSED",
      "address": "::1",
      "port": 5432
    },
    {
      "code": "ECONNREFUSED",
      "address": "127.0.0.1",
      "port": 5432
    }
  ]
}
```

```json
{
  "attempt": 2,
  "operation": "Initialize native PostgreSQL 16 as an unprivileged user",
  "command": [
    "runuser",
    "-u",
    "nobody",
    "--",
    "/workspace/scratch/fbaf3d41cc21/wo8-tools/postgres/usr/lib/postgresql/16/bin/initdb",
    "-D",
    "/workspace/scratch/fbaf3d41cc21/wo8-tools/resume-phase-b/postgres16/data",
    "--username=postgres",
    "--auth-local=trust",
    "--auth-host=trust"
  ],
  "returncode": 1,
  "stdout": "",
  "stderr": "runuser: cannot set groups: Operation not permitted\n",
  "uidMap": "0          0          1"
}
```

Evidence hashes:

- `attempt-1.json`: `8063cf85073616c5659451addcd827f7928f9fd97171fa99a28c58cf6af2ab2c`.
- `attempt-2.json`: `eb6bd23c67e5a03bc559f1f63d03a383833f1466bb8c06315128736b4e3ff092`.

## Shortest safe continuation

Use this existing branch in an environment that already provides native PostgreSQL 16 at a test-database URL accepted by the existing repository guard (normally local `prowess_studio_test`). Supplying that environment is the next prerequisite; do not weaken the guard or substitute an older database. Preserve this checkout/commit or restore the full-history recovery bundle rather than restarting WO8.

Once that prerequisite is resolved and continuation is reviewed, resume Phase B's focused migration/history, lifecycle, shared Signature race, historical Release and API checks. Use the same PostgreSQL 16 environment throughout. Do not start Phase C until Phase B passes and has its own verified checkpoint. Phase C's UI and Phase D's controls/CI/final verification/report remain pending.

The full permanent suite is intentionally deferred to the final boundary. This stop is required by the user's Two-Attempt Blocker and Recovery Protocol, which overrides general instructions to continue until WO8 is complete.
