# M7 Invariant Catalog (M7-WO1)

Machine-readable twin: `m7-invariants.json`. The permanent M7-WO1 gate (`apps/studio/tests/unit/m7-wo1-static.test.ts`)
requires every id below, each naming existing automated guards. M4, M5 and M6 invariants are frozen and are not repeated here.

### M7-I001 — One Exact Release Per Encounter

- **Group:** Release
- **Meaning:** An encounter is prepared on exactly one published Release, chosen explicitly and never changed (database trigger); compatibility is exact Release identity — never a name, payload resemblance or content-pack receipt.
- **Guards:** `apps/studio/tests/unit/m7-wo1-static.test.ts`, `packages/prowess-db/tests/integration/m7-wo1-encounter-foundation.test.ts`, `apps/studio/tests/integration/m7-wo1-encounter-api.test.ts`, `scripts/m7-wo1-negative-controls.mjs`

### M7-I002 — Only Completed Characters On That Release Join

- **Group:** Roster
- **Meaning:** ADD_PARTICIPANT re-reads the Character on every command: unknown, DRAFT, other-Release and duplicate references are refused; the database independently requires the Character's own Release (trigger) and one membership per Character (unique key).
- **Guards:** `apps/studio/tests/unit/m7-wo1-static.test.ts`, `packages/prowess-db/tests/integration/m7-wo1-encounter-foundation.test.ts`, `apps/studio/tests/integration/m7-wo1-encounter-api.test.ts`, `scripts/m7-wo1-negative-controls.mjs`

### M7-I003 — A Membership Is A Reference, Never A Resource Copy

- **Group:** Authority
- **Meaning:** Encounter rows store no HP, AP, MP, ME, Counter Action, Active Magic or initiative value and lock nothing; no encounter module writes a Character table, so roster edits leave the Character row, sheet play state, play runtime and play events byte-identical.
- **Guards:** `apps/studio/tests/unit/m7-wo1-static.test.ts`, `packages/prowess-db/tests/integration/m7-wo1-encounter-foundation.test.ts`, `scripts/m7-wo1-negative-controls.mjs`

### M7-I004 — Side And Membership Integrity Is Server-Side

- **Group:** Roster
- **Meaning:** Sides and memberships belong to exactly one encounter (composite keys); forged cross-encounter ids are not found; a side with members is never removed silently; duplicate side names in one encounter are refused.
- **Guards:** `apps/studio/tests/unit/m7-wo1-static.test.ts`, `packages/prowess-db/tests/integration/m7-wo1-encounter-foundation.test.ts`, `apps/studio/tests/integration/m7-wo1-encounter-api.test.ts`, `scripts/m7-wo1-negative-controls.mjs`

### M7-I005 — One Version Transition Per Command

- **Group:** Concurrency
- **Meaning:** Every roster or lifecycle command compare-and-sets the encounter row on (id, lock_version, PREPARATION) inside its transaction; concurrent commands from one version produce exactly one transition and the other is refused as stale.
- **Guards:** `apps/studio/tests/unit/m7-wo1-static.test.ts`, `packages/prowess-db/tests/integration/m7-wo1-encounter-foundation.test.ts`, `apps/studio/tests/integration/m7-wo1-encounter-api.test.ts`, `scripts/m7-wo1-negative-controls.mjs`

### M7-I006 — Retries Never Repeat

- **Group:** Concurrency
- **Meaning:** Each command (including create) carries a client idempotency key that is unique across all encounters; a retry of the same request returns the original event and applies nothing; the same key with another request is refused.
- **Guards:** `apps/studio/tests/unit/m7-wo1-static.test.ts`, `packages/prowess-db/tests/integration/m7-wo1-encounter-foundation.test.ts`, `apps/studio/tests/integration/m7-wo1-encounter-api.test.ts`, `apps/studio/tests/unit/m7-wo1-encounter-ui.test.tsx`, `scripts/m7-wo1-negative-controls.mjs`

### M7-I007 — A Command Commits Whole Or Not At All

- **Group:** Atomicity
- **Meaning:** The version claim, the roster change and the one history event are one transaction; a failure after an intermediate write leaves the encounter unchanged.
- **Guards:** `packages/prowess-db/tests/integration/m7-wo1-encounter-foundation.test.ts`, `scripts/m7-wo1-negative-controls.mjs`

### M7-I008 — Reads And Refusals Write Nothing

- **Group:** Atomicity
- **Meaning:** Encounter reads, candidate search, history and readiness write nothing; readiness is derived on every read and is never accepted as input; refused commands leave every table unchanged.
- **Guards:** `apps/studio/tests/unit/m7-wo1-static.test.ts`, `packages/prowess-db/tests/integration/m7-wo1-encounter-foundation.test.ts`, `apps/studio/tests/integration/m7-wo1-encounter-api.test.ts`

### M7-I009 — Archived Encounters Are Read-Only History

- **Group:** History
- **Meaning:** ARCHIVED is terminal: the service and database triggers refuse any change to an archived encounter or its roster; encounters are never deleted; the command history is append-only.
- **Guards:** `apps/studio/tests/unit/m7-wo1-static.test.ts`, `packages/prowess-db/tests/integration/m7-wo1-encounter-foundation.test.ts`, `apps/studio/tests/integration/m7-wo1-encounter-api.test.ts`, `scripts/m7-wo1-negative-controls.mjs`

### M7-I010 — No Combat In Encounter Preparation

- **Group:** Boundary
- **Meaning:** M7-WO1 has no initiative, round, turn, cost, target or damage state and no enabled combat control; readiness always reports combat as unavailable and never claims combat can begin.
- **Guards:** `apps/studio/tests/unit/m7-wo1-static.test.ts`, `apps/studio/tests/unit/m7-wo1-encounter-ui.test.tsx`, `apps/studio/tests/e2e/m7-wo1-encounters.spec.ts`

### M7-I011 — Encounters Are Workspace State

- **Group:** Distribution
- **Meaning:** Encounter rows are part of the desktop workspace backup and restore into an independent database with identical memberships, Release references and Character state; they are never part of a content pack.
- **Guards:** `apps/studio/tests/unit/m7-wo1-static.test.ts`, `scripts/distribution/verify-m7-wo1-encounter-restore.mjs`, `.github/workflows/ci.yml`

### M7-I012 — The Encounter UI Holds No Authority

- **Group:** Presentation
- **Meaning:** The encounter frontend talks only to the Studio HTTP API through its typed client; eligibility, Release compatibility and readiness are shown exactly as the server decides them.
- **Guards:** `apps/studio/tests/unit/m7-wo1-static.test.ts`, `apps/studio/tests/unit/m7-wo1-encounter-ui.test.tsx`, `apps/studio/tests/e2e/m7-wo1-encounters.spec.ts`
