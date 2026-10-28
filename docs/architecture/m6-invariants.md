# M6 Invariant Catalog (M6-WO1)

Machine-readable twin: `m6-invariants.json`. The permanent M6-WO1 gate (`apps/studio/tests/unit/m6-wo1-static.test.ts`)
requires every id below, each with executing automated guards that cite it. M4 (M4-I01–I188, M4-I162A) and M5 (M5-I001–I337)
invariants are frozen and are not repeated, renumbered or rewritten here.

### M6-I001 — Authored Definitions Use The Existing Entity / EntityVersion Storage

- **Group:** Storage
- **Meaning:** A Prowess Definition is authored as an ordinary Entity plus EntityVersions holding structuredData.prowessDefinition; WO1 adds no table, schema change or migration.
- **Guards:** `apps/studio/tests/unit/m6-wo1-static.test.ts`, `apps/studio/tests/integration/m6-wo1-compendium-authoring-api.test.ts`, `packages/prowess-db/tests/integration/m6-wo1-compendium-authoring.test.ts`, `scripts/m6-wo1-negative-controls.mjs`

### M6-I002 — The Studio UI Never Owns Mechanics Or A Second Definition Catalog

- **Group:** Presentation
- **Meaning:** Definition kinds, allowed EntityTypes, schema versions and option vocabularies are a projection of the M5 registry served by @prowess/db; descriptors hold labels and vocabulary NAMES only; Studio never imports the M5 domain package.
- **Guards:** `apps/studio/tests/unit/m6-wo1-static.test.ts`, `packages/prowess-db/tests/unit/m6-wo1-authoring-catalog.test.ts`, `apps/studio/tests/unit/m6-wo1-authoring-lib.test.ts`, `apps/studio/tests/unit/m6-wo1-compendium-admin-ui.test.tsx`, `scripts/m6-wo1-negative-controls.mjs`

### M6-I003 — Authoring Validates Against The Real M5 Contract On The Server

- **Group:** Validation
- **Meaning:** Validation, Save and Create run @prowess/game's validateStoredProwessDefinition — the same readers the materializer runs; client checks are never authoritative; unsafe input is refused with no authoring bypass.
- **Guards:** `apps/studio/tests/unit/m6-wo1-static.test.ts`, `packages/prowess-game/src/stored-definition-validation.test.ts`, `apps/studio/tests/integration/m6-wo1-compendium-authoring-api.test.ts`, `packages/prowess-db/tests/integration/m6-wo1-compendium-authoring.test.ts`, `scripts/m6-wo1-negative-controls.mjs`

### M6-I004 — Historical Revisions Are Immutable

- **Group:** History
- **Meaning:** Only a DRAFT is editable (M1 atomic guard); any other status is read-only and changes only through Create New Revision; a newer save is never silently overwritten.
- **Guards:** `apps/studio/tests/unit/m6-wo1-static.test.ts`, `apps/studio/tests/integration/m6-wo1-compendium-authoring-api.test.ts`, `packages/prowess-db/tests/integration/m6-wo1-compendium-authoring.test.ts`, `apps/studio/tests/unit/m6-wo1-compendium-admin-ui.test.tsx`, `scripts/m6-wo1-negative-controls.mjs`

### M6-I005 — Ruleset Publication Remains M2-Owned

- **Group:** Governance
- **Meaning:** Authoring never publishes, pins a Manifest or sets an 'active' status: its hand-off creates an ordinary DRAFT ChangeSet through M2's createChangeSet in an explicitly chosen Ruleset.
- **Guards:** `apps/studio/tests/unit/m6-wo1-static.test.ts`, `apps/studio/tests/integration/m6-wo1-compendium-authoring-api.test.ts`, `apps/studio/tests/unit/m6-wo1-compendium-admin-ui.test.tsx`, `scripts/m6-wo1-negative-controls.mjs`

### M6-I006 — Reference Pickers Store Exact Identity

- **Group:** References
- **Meaning:** Pickers search by human discovery fields but store the exact five-field Definition reference; references are checked against the exact EntityVersion, never by name or 'latest'.
- **Guards:** `apps/studio/tests/unit/m6-wo1-static.test.ts`, `apps/studio/tests/integration/m6-wo1-compendium-authoring-api.test.ts`, `apps/studio/tests/unit/m6-wo1-compendium-admin-ui.test.tsx`, `scripts/m6-wo1-negative-controls.mjs`

### M6-I007 — Validation And Preview Do Not Persist

- **Group:** Validation
- **Meaning:** Validate, stored-revision validation, the reference / Keyword searches and the Preview are side-effect free; no validity flag is stored.
- **Guards:** `apps/studio/tests/unit/m6-wo1-static.test.ts`, `apps/studio/tests/integration/m6-wo1-compendium-authoring-api.test.ts`, `apps/studio/tests/unit/m6-wo1-compendium-admin-ui.test.tsx`, `scripts/m6-wo1-negative-controls.mjs`

### M6-I008 — Revision Numbers Are Server-Allocated

- **Group:** History
- **Meaning:** Create New Revision uses the M1 allocator; no route accepts a revision number or status from the client.
- **Guards:** `apps/studio/tests/unit/m6-wo1-static.test.ts`, `apps/studio/tests/integration/m6-wo1-compendium-authoring-api.test.ts`, `packages/prowess-db/tests/integration/m6-wo1-compendium-authoring.test.ts`, `apps/studio/tests/unit/m6-wo1-authoring-lib.test.ts`, `scripts/m6-wo1-negative-controls.mjs`

### M6-I009 — Payload Keywords Come From The Approved Keyword Vocabulary

- **Group:** References
- **Meaning:** Every payload Keyword must be an existing Keyword Definition; Entity-level, EntityVersion-level and payload Keywords stay separate systems.
- **Guards:** `apps/studio/tests/unit/m6-wo1-static.test.ts`, `apps/studio/tests/integration/m6-wo1-compendium-authoring-api.test.ts`, `apps/studio/tests/unit/m6-wo1-compendium-admin-ui.test.tsx`

### M6-I010 — No Definition Kind Is Inferred

- **Group:** Storage
- **Meaning:** An Entity without a stored Prowess Definition is generic content; authoring never infers, attaches or changes a Definition kind from names, text or EntityType.
- **Guards:** `apps/studio/tests/unit/m6-wo1-static.test.ts`, `apps/studio/tests/integration/m6-wo1-compendium-authoring-api.test.ts`, `apps/studio/tests/unit/m6-wo1-compendium-admin-ui.test.tsx`, `scripts/m6-wo1-negative-controls.mjs`
