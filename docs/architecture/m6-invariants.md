# M6 Invariant Catalog (M6-WO1, M6-WO2, M6-WO3)

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
- **Guards:** `apps/studio/tests/unit/m6-wo1-static.test.ts`, `apps/studio/tests/integration/m6-wo1-compendium-authoring-api.test.ts`, `apps/studio/tests/unit/m6-wo1-compendium-admin-ui.test.tsx`, `apps/studio/tests/unit/m6-wo1-entity-workspace.test.tsx`, `scripts/m6-wo1-negative-controls.mjs`

## M6-WO2 — Compendium Rules Reference & Structured Browsing

Required by the permanent M6-WO2 gate (`apps/studio/tests/unit/m6-wo2-static.test.ts`).

### M6-I011 — The Rules Reference Is Scoped To One Exact Release

- **Group:** Release Scoping
- **Meaning:** Rules Reference content is Ruleset → exact RulesetRelease → its flattened Release Manifest → the exact EntityVersion each entry pins. Membership is the manifest's entries only; a Release of another Ruleset is never readable under a Ruleset's URL; no inheritance is reconstructed.
- **Guards:** `apps/studio/tests/unit/m6-wo2-static.test.ts`, `packages/prowess-db/tests/integration/m6-wo2-compendium-reference.test.ts`, `apps/studio/tests/integration/m6-wo2-compendium-reference-api.test.ts`, `apps/studio/tests/unit/m6-wo2-rules-reference-ui.test.tsx`, `scripts/m6-wo2-negative-controls.mjs`

### M6-I012 — A Release Pin Is Never Substituted

- **Group:** Release Scoping
- **Meaning:** Every entry shows the revision its Release pins. The Entity's latest revision appears only as an indicator next to the pin and never selects content; an Entity the Release does not pin is an explicit not-in-Release state, never a fallback.
- **Guards:** `apps/studio/tests/unit/m6-wo2-static.test.ts`, `packages/prowess-db/tests/integration/m6-wo2-compendium-reference.test.ts`, `apps/studio/tests/integration/m6-wo2-compendium-reference-api.test.ts`, `apps/studio/tests/unit/m6-wo2-rules-reference-ui.test.tsx`, `scripts/m6-wo2-negative-controls.mjs`

### M6-I013 — Historical Releases Read Identically Over Time

- **Group:** Release Scoping
- **Meaning:** Reading a Release after later revisions and later Releases exist returns exactly what it returned before; nothing is migrated, re-validated or re-resolved on view.
- **Guards:** `apps/studio/tests/unit/m6-wo2-static.test.ts`, `packages/prowess-db/tests/integration/m6-wo2-compendium-reference.test.ts`, `apps/studio/tests/integration/m6-wo2-compendium-reference-api.test.ts`

### M6-I014 — Browsing Facets Are Server-Side And Deterministic

- **Group:** Browsing
- **Meaning:** Search, kind, family, branch, EntityType and Keyword (by id) filter on the server inside one Release, with server paging and a deterministic order (display name, canonical key, Entity id); facet options come from the one M5-derived catalog.
- **Guards:** `apps/studio/tests/unit/m6-wo2-static.test.ts`, `packages/prowess-db/tests/integration/m6-wo2-compendium-reference.test.ts`, `apps/studio/tests/integration/m6-wo2-compendium-reference-api.test.ts`, `apps/studio/tests/unit/m6-wo2-rules-reference-ui.test.tsx`, `scripts/m6-wo2-negative-controls.mjs`

### M6-I015 — Presentation Reuses The One Descriptor Set And Computes Nothing

- **Group:** Presentation
- **Meaning:** Dedicated presenters are the WO1 shared-contract descriptors (plus Affinity); everything else, and any unsupported schema version, renders generically as stored. Generic content has no inferred kind. Costs and formulas are shown as authored, never computed; raw JSON appears only under Developer details.
- **Guards:** `apps/studio/tests/unit/m6-wo2-static.test.ts`, `packages/prowess-db/tests/integration/m6-wo2-compendium-reference.test.ts`, `apps/studio/tests/unit/m6-wo2-rules-reference-ui.test.tsx`, `apps/studio/tests/unit/m6-wo2-reference-lib.test.ts`, `scripts/m6-wo2-negative-controls.mjs`

### M6-I016 — Exact References Are Shown As Authored, Next To The Pin

- **Group:** References
- **Meaning:** An exact Definition reference is reported with the revision it names and the revision this Release pins for that Entity; a mismatch or absence is stated and never rewritten. Referenced By is bounded to the Release and needs no new table; relationships infer no inverse; Related by Keyword is labelled as such.
- **Guards:** `apps/studio/tests/unit/m6-wo2-static.test.ts`, `packages/prowess-db/tests/integration/m6-wo2-compendium-reference.test.ts`, `apps/studio/tests/integration/m6-wo2-compendium-reference-api.test.ts`, `apps/studio/tests/unit/m6-wo2-rules-reference-ui.test.tsx`, `scripts/m6-wo2-negative-controls.mjs`

### M6-I017 — Release Integrity And The Latest Release Come From The Server

- **Group:** Releases
- **Meaning:** Manifest verification is M2's verifyRulesetReleaseManifestHash on the server (a failure is a serious warning). View Latest Release is an explicit action that resolves, by M2 query, to an exact Release URL; no current / active Release pointer exists.
- **Guards:** `apps/studio/tests/unit/m6-wo2-static.test.ts`, `packages/prowess-db/tests/integration/m6-wo2-compendium-reference.test.ts`, `apps/studio/tests/integration/m6-wo2-compendium-reference-api.test.ts`, `apps/studio/tests/unit/m6-wo2-rules-reference-ui.test.tsx`, `scripts/m6-wo2-negative-controls.mjs`

### M6-I018 — Release Comparison Is M2's Composition Diff

- **Group:** Releases
- **Meaning:** Comparison reuses compareRulesetReleases: added, removed and changed-revision entries plus the unchanged count, both Releases in the URL's Ruleset; a changed revision links to the existing revision comparison. No semantic diff is computed.
- **Guards:** `apps/studio/tests/unit/m6-wo2-static.test.ts`, `packages/prowess-db/tests/integration/m6-wo2-compendium-reference.test.ts`, `apps/studio/tests/integration/m6-wo2-compendium-reference-api.test.ts`, `apps/studio/tests/unit/m6-wo2-rules-reference-ui.test.tsx`, `scripts/m6-wo2-negative-controls.mjs`

### M6-I019 — Every Rules Reference URL Names The Exact Release

- **Group:** Navigation
- **Meaning:** Rules Reference routes carry the Ruleset and Release ids; links between entries, comparisons and history keep that Release, so a bookmark always shows the same pins. Nothing remembers a current Release.
- **Guards:** `apps/studio/tests/unit/m6-wo2-static.test.ts`, `apps/studio/tests/unit/m6-wo2-rules-reference-ui.test.tsx`, `apps/studio/tests/unit/m6-wo2-reference-lib.test.ts`, `scripts/m6-wo2-negative-controls.mjs`

### M6-I020 — The Rules Reference Is Read-Only

- **Group:** Boundaries
- **Meaning:** The reference routes export GET only and the reference service performs no write; reading writes nothing (fingerprinted). No schema, migration, M4 or M5 change; no publication, ChangeSet or lifecycle call; editing is a hand-off to Compendium Admin.
- **Guards:** `apps/studio/tests/unit/m6-wo2-static.test.ts`, `packages/prowess-db/tests/integration/m6-wo2-compendium-reference.test.ts`, `apps/studio/tests/integration/m6-wo2-compendium-reference-api.test.ts`, `scripts/m6-wo2-negative-controls.mjs`

### M6-I021 — A Character Is Pinned To One Exact, Immutable Release

- **Group:** Character Identity
- **Meaning:** A Character stores the exact RulesetRelease id it was created on (never a Ruleset id, channel, label or 'latest'); the foreign key is RESTRICT and a database trigger refuses any change of ruleset_release_id. A wrong Release means a new Character Draft.
- **Guards:** `apps/studio/tests/unit/m6-wo3-static.test.ts`, `packages/prowess-db/tests/integration/m6-wo3-character.test.ts`, `apps/studio/tests/integration/m6-wo3-character-api.test.ts`, `packages/prowess-db/tests/integration/m6-wo3-migration-compat.test.ts`, `scripts/m6-wo3-negative-controls.mjs`

### M6-I022 — Every Mechanical Selection Belongs To The Character's Release

- **Group:** Release Isolation
- **Meaning:** Ancestry, Skills and Primary Affinity are exact (entityId, entityVersionId) pairs that the Character's own Release pins, of the expected kind; a revision pinned only by another Release is rejected even when its canonical key matches. Content is never looked up outside the Release.
- **Guards:** `apps/studio/tests/unit/m6-wo3-static.test.ts`, `packages/prowess-db/tests/integration/m6-wo3-character.test.ts`, `apps/studio/tests/integration/m6-wo3-character-api.test.ts`, `packages/prowess-game/src/character-creation.test.ts`, `scripts/m6-wo3-negative-controls.mjs`

### M6-I023 — Derived Statistics Are Recalculated From Stored Inputs

- **Group:** Derived State
- **Meaning:** Only creation inputs are stored (Ancestry, Stat-choice selections, points spent, Skill selections, Primary Affinity). Maximum HP / MP, Dodge, Character DC, Signature Ability capacity and every other derived value are recalculated on read from those inputs and the exact Release; no derived column exists.
- **Guards:** `apps/studio/tests/unit/m6-wo3-static.test.ts`, `packages/prowess-db/tests/integration/m6-wo3-character.test.ts`, `packages/prowess-game/src/character-creation.test.ts`, `scripts/m6-wo3-negative-controls.mjs`

### M6-I024 — Characters Are Player State, Not Compendium Content

- **Group:** Player Separation
- **Meaning:** Characters live in their own typed tables (characters, character_stat_allocations, character_ancestry_stat_choices, character_skill_ranks) added by the one authorized M6-WO3 migration; they are never Entity / EntityVersion rows and the Character services never write Compendium, Canon or Release tables.
- **Guards:** `apps/studio/tests/unit/m6-wo3-static.test.ts`, `packages/prowess-db/tests/integration/m6-wo3-character.test.ts`, `packages/prowess-db/tests/integration/m6-wo3-migration-compat.test.ts`, `scripts/m6-wo3-negative-controls.mjs`

### M6-I025 — Core Creation Completion Freezes The Mechanical Choices

- **Group:** Finalization
- **Meaning:** Completing core creation records coreCreationCompletedAt only after Release integrity verification and a READY server validation; afterwards the creation save is refused (service and database triggers) while name and concept stay editable through the profile path.
- **Guards:** `apps/studio/tests/unit/m6-wo3-static.test.ts`, `packages/prowess-db/tests/integration/m6-wo3-character.test.ts`, `apps/studio/tests/integration/m6-wo3-character-api.test.ts`, `apps/studio/tests/unit/m6-wo3-character-ui.test.tsx`, `scripts/m6-wo3-negative-controls.mjs`

### M6-I026 — Character Writes Use Atomic Optimistic Concurrency

- **Group:** Concurrency
- **Meaning:** Every mutable Character write is a compare-and-set on lockVersion (UPDATE … WHERE id AND lockVersion = expected) that increments it; a stale version is HTTP 409. A creation save replaces the Character fields and every child row in one transaction, so a failure leaves the previous build intact.
- **Guards:** `apps/studio/tests/unit/m6-wo3-static.test.ts`, `packages/prowess-db/tests/integration/m6-wo3-character.test.ts`, `apps/studio/tests/integration/m6-wo3-character-api.test.ts`, `scripts/m6-wo3-negative-controls.mjs`

### M6-I027 — Creation Options Come From Published Release Content

- **Group:** Content Authority
- **Meaning:** Races, Skills, Affinities, the creation rule, Stat bounds, the Character Die and the Skill rank all come from the Character's exact Release through one server creation context; Studio holds no option list, budget or bound, and each option links to its exact Release Rules Reference page.
- **Guards:** `apps/studio/tests/unit/m6-wo3-static.test.ts`, `packages/prowess-db/tests/integration/m6-wo3-character.test.ts`, `apps/studio/tests/unit/m6-wo3-character-ui.test.tsx`, `packages/prowess-db/tests/integration/m6-wo3-authoring-to-character.test.ts`, `apps/studio/tests/unit/m6-wo3-compendium-integration.test.tsx`, `scripts/m6-wo3-negative-controls.mjs`

### M6-I028 — M6-WO3 Creates Level 1 Characters Only

- **Group:** Level Ownership
- **Meaning:** The server sets the Character's Level from the Release's creation rule (Level 1); no create or save input accepts a Level, and no advancement, respec, equipment or ability record exists.
- **Guards:** `apps/studio/tests/unit/m6-wo3-static.test.ts`, `packages/prowess-db/tests/integration/m6-wo3-character.test.ts`, `apps/studio/tests/integration/m6-wo3-character-api.test.ts`, `scripts/m6-wo3-negative-controls.mjs`

### M6-I029 — M4 And M5 Own Every Rules Calculation

- **Group:** Formula Ownership
- **Meaning:** Totals and derived values are produced by @prowess/game through the M4 modifier and Formula engine and the Release's DERIVED_STAT Definitions; no formula is copied into Studio or the database services. The Definition registry changes only by ANCESTRY v1, SKILL v1 and CHARACTER_CREATION_RULE v1 — every other kind is byte-for-byte unchanged.
- **Guards:** `apps/studio/tests/unit/m6-wo3-static.test.ts`, `packages/prowess-game/src/m6-wo3-registry.test.ts`, `packages/prowess-game/src/character-creation.test.ts`, `apps/studio/tests/unit/m6-wo3-compendium-integration.test.tsx`, `scripts/m6-wo3-negative-controls.mjs`

### M6-I030 — A Newer Release Never Changes An Existing Character

- **Group:** No Automatic Migration
- **Meaning:** Publishing a later Release (new Ancestry, Skill or Affinity revisions) leaves every existing Character on its own Release with an identical resolution; nothing rebases a Character.
- **Guards:** `apps/studio/tests/unit/m6-wo3-static.test.ts`, `packages/prowess-db/tests/integration/m6-wo3-character.test.ts`, `apps/studio/tests/integration/m6-wo3-character-api.test.ts`, `scripts/m6-wo3-negative-controls.mjs`
