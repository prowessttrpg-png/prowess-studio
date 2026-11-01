# M6 Invariant Catalog (M6-WO1, M6-WO2, M6-WO3, M6-WO4, M6-WO5, M6-WO6)

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

## M6-WO4 — Character Advancement, Access & Eligibility

### M6-I031 — Advancement Uses The Character's Exact Release

- **Group:** Release Pin
- **Meaning:** Every advancement read, preview and commit resolves the Character's own stored RulesetRelease (manifest-verified before a commit); every Skill, Affinity and component selection must be the exact EntityVersion that Release pins — never a canonical-key match, another revision or a latest pointer.
- **Guards:** `apps/studio/tests/unit/m6-wo4-static.test.ts`, `packages/prowess-game/src/character-advancement.test.ts`, `packages/prowess-db/tests/integration/m6-wo4-advancement.test.ts`, `apps/studio/tests/integration/m6-wo4-advancement-api.test.ts`, `scripts/m6-wo4-negative-controls.mjs`

### M6-I032 — A Character Advances Exactly One Level At A Time

- **Group:** Level Ownership
- **Meaning:** An advancement commits exactly fromLevel → fromLevel + 1, chosen by the server from the Release's Level sequence; no input names a Level, and the database refuses any Level change without the matching advancement row, any skip, repeat or decrement, and any advance of a Character whose core creation is incomplete.
- **Guards:** `apps/studio/tests/unit/m6-wo4-static.test.ts`, `packages/prowess-game/src/character-advancement.test.ts`, `packages/prowess-db/tests/integration/m6-wo4-advancement.test.ts`, `packages/prowess-db/tests/integration/m6-wo4-migration-compat.test.ts`, `apps/studio/tests/integration/m6-wo4-advancement-api.test.ts`, `scripts/m6-wo4-negative-controls.mjs`

### M6-I033 — Advancement Entitlements Are Published Content

- **Group:** Content Authority
- **Meaning:** Stat Points, Skill advancements, the maximum Level, the Character Die and Affinity progression come from the Release's CHARACTER_ADVANCEMENT_RULE, CHARACTER_DIE_PROGRESSION and AFFINITY_PROGRESSION Definitions, which must agree Level for Level; no cadence, cap, die band or option is coded in @prowess/game, the services or Studio.
- **Guards:** `apps/studio/tests/unit/m6-wo4-static.test.ts`, `packages/prowess-game/src/character-advancement.test.ts`, `packages/prowess-game/src/m6-wo4-registry.test.ts`, `packages/prowess-db/tests/integration/m6-wo4-advancement.test.ts`, `scripts/m6-wo4-negative-controls.mjs`

### M6-I034 — Creation State Is Immutable After Advancement

- **Group:** Creation Immutability
- **Meaning:** The completed Level 1 creation choices are never rewritten by advancement: the WO3 freeze and Release immutability stay in the database guard, advancement writes only its own tables, and the Level 1 creation record is still shown as it was.
- **Guards:** `apps/studio/tests/unit/m6-wo4-static.test.ts`, `packages/prowess-game/src/character-advancement.test.ts`, `packages/prowess-db/tests/integration/m6-wo4-advancement.test.ts`, `packages/prowess-db/tests/integration/m6-wo4-migration-compat.test.ts`, `scripts/m6-wo4-negative-controls.mjs`

### M6-I035 — Committed Advancement History Is Append-Only

- **Group:** History
- **Meaning:** Each committed advancement (with its Stat, Skill and Affinity choice rows) is inserted once, atomically with the Level change and a lockVersion compare-and-set; database triggers refuse any UPDATE or DELETE of history and any child row added after its Level is reached.
- **Guards:** `apps/studio/tests/unit/m6-wo4-static.test.ts`, `packages/prowess-db/tests/integration/m6-wo4-advancement.test.ts`, `packages/prowess-db/tests/integration/m6-wo4-migration-compat.test.ts`, `apps/studio/tests/integration/m6-wo4-advancement-api.test.ts`, `scripts/m6-wo4-negative-controls.mjs`

### M6-I036 — Effective Stats Are Derived

- **Group:** Derived State
- **Meaning:** A Stat is baseline + Ancestry + creation + Σ advancement, summed through the M4 modifier engine and bounded by the STAT Definition's maximum; the sum is recalculated on every read and never stored or computed in Studio.
- **Guards:** `apps/studio/tests/unit/m6-wo4-static.test.ts`, `packages/prowess-game/src/character-advancement.test.ts`, `packages/prowess-db/tests/integration/m6-wo4-advancement.test.ts`, `apps/studio/tests/unit/m6-wo4-advancement-ui.test.tsx`, `scripts/m6-wo4-negative-controls.mjs`

### M6-I037 — Skill Ranks Are Derived From The Exact Ladder

- **Group:** Derived State
- **Meaning:** TRAIN_NEW gives an untrained Skill the Release's starting rank and UPGRADE moves an owned Skill exactly one step up the Release's SKILL rank ladder; duplicate training, upgrading an untrained Skill or passing the top rank is refused, and ranks are rebuilt, not stored.
- **Guards:** `apps/studio/tests/unit/m6-wo4-static.test.ts`, `packages/prowess-game/src/character-advancement.test.ts`, `packages/prowess-db/tests/integration/m6-wo4-advancement.test.ts`, `scripts/m6-wo4-negative-controls.mjs`

### M6-I038 — The Affinity Profile Is Derived And M5-Validated

- **Group:** Derived State
- **Meaning:** Automatic Affinity steps store nothing and chosen steps store only the authored option (and exact Affinity); the resulting profile is rebuilt and must pass the existing M5 validateAffinityProfile and validateAffinityProgression at every Level; unresolved canon options are never guessed.
- **Guards:** `apps/studio/tests/unit/m6-wo4-static.test.ts`, `packages/prowess-game/src/character-advancement.test.ts`, `packages/prowess-game/src/m6-wo4-registry.test.ts`, `packages/prowess-db/tests/integration/m6-wo4-advancement.test.ts`, `scripts/m6-wo4-negative-controls.mjs`

### M6-I039 — Derived Values Are Never Persisted

- **Group:** Derived State
- **Meaning:** Final Stats, ranks, the Character Die, Maximum HP / MP and every other derived statistic are recalculated from creation + history against the exact Release on every read; no table stores them and no request may supply them.
- **Guards:** `apps/studio/tests/unit/m6-wo4-static.test.ts`, `packages/prowess-game/src/character-advancement.test.ts`, `packages/prowess-db/tests/integration/m6-wo4-advancement.test.ts`, `apps/studio/tests/integration/m6-wo4-advancement-api.test.ts`, `scripts/m6-wo4-negative-controls.mjs`

### M6-I040 — Eligibility Reuses M5 Structured Prerequisites

- **Group:** Eligibility
- **Meaning:** Component eligibility reads only the structured SKILL_RANK_AT_LEAST and AFFINITY_RANK_AT_LEAST prerequisites M5's readComponentConstructionRules reads, and evaluates them as the same M4 Requirements; no new prerequisite kind and no unlock table exist.
- **Guards:** `apps/studio/tests/unit/m6-wo4-static.test.ts`, `packages/prowess-game/src/character-advancement.test.ts`, `packages/prowess-db/tests/integration/m6-wo4-advancement.test.ts`, `apps/studio/tests/integration/m6-wo4-advancement-api.test.ts`, `scripts/m6-wo4-negative-controls.mjs`

### M6-I041 — Eligibility Is Not Ability Legality

- **Group:** Eligibility
- **Meaning:** An ELIGIBLE component only means the Character meets its structured prerequisites; capacity, structure, stacking, Signature slots and Affinity Authority keyword access remain M5's complete construction compiler's, and the UI says so.
- **Guards:** `apps/studio/tests/unit/m6-wo4-static.test.ts`, `packages/prowess-game/src/character-advancement.test.ts`, `apps/studio/tests/unit/m6-wo4-advancement-ui.test.tsx`, `scripts/m6-wo4-negative-controls.mjs`

### M6-I042 — Rules Text Is Never Parsed For Mechanics

- **Group:** Eligibility
- **Meaning:** Advancement and eligibility read only structured Definition payloads; Rules Text, descriptions and display names never decide an entitlement, a requirement or a verdict.
- **Guards:** `apps/studio/tests/unit/m6-wo4-static.test.ts`, `packages/prowess-game/src/character-advancement.test.ts`, `scripts/m6-wo4-negative-controls.mjs`

### M6-I043 — No Automatic Release Migration Or Respec

- **Group:** No Automatic Migration
- **Meaning:** Publishing a later Release (even with a different advancement schedule) leaves every existing Character, its history, its profile and its next entitlements on its own Release; nothing rebases, re-levels or respecs a Character.
- **Guards:** `apps/studio/tests/unit/m6-wo4-static.test.ts`, `packages/prowess-db/tests/integration/m6-wo4-advancement.test.ts`, `apps/studio/tests/integration/m6-wo4-advancement-api.test.ts`, `scripts/m6-wo4-negative-controls.mjs`

### M6-I044 — The CharacterMechanicalProfile Is The One Bridge

- **Group:** Profile
- **Meaning:** One @prowess/game builder turns creation + history + the exact Release into the CharacterMechanicalProfile; the services, eligibility, access and Studio consume that profile and never assemble Stats, ranks or Affinities themselves.
- **Guards:** `apps/studio/tests/unit/m6-wo4-static.test.ts`, `packages/prowess-game/src/character-advancement.test.ts`, `packages/prowess-db/tests/integration/m6-wo4-advancement.test.ts`, `apps/studio/tests/unit/m6-wo4-advancement-ui.test.tsx`, `scripts/m6-wo4-negative-controls.mjs`

## M6-WO5 — Digital Character Sheet

### M6-I045 — The Character Sheet Consumes The Canonical Mechanical Profile

- **Group:** Profile
- **Meaning:** The sheet's mechanical values come from ONE server read model built by @prowess/game from the M6-WO4 CharacterMechanicalProfile and the Character's exact Release; no second profile, Stat or sheet-statistics builder exists.
- **Guards:** `apps/studio/tests/unit/m6-wo5-static.test.ts`, `packages/prowess-game/src/character-sheet.test.ts`, `packages/prowess-db/tests/integration/m6-wo5-character-sheet.test.ts`, `apps/studio/tests/integration/m6-wo5-character-sheet-api.test.ts`, `apps/studio/tests/unit/m6-wo5-sheet-ui.test.tsx`, `scripts/m6-wo5-negative-controls.mjs`

### M6-I046 — Mechanical Values On The Sheet Are Read-Only Projections

- **Group:** Derived State
- **Meaning:** Stat totals, Saves, Character Die, Character DC, Accuracy, Dodge, Armor, Initiative, Movement, Range, Skill scores, resource maximums and Affinity Authority are server projections of published rules; no request may supply them, Studio only formats them, and a value the Release does not define is shown as unavailable rather than guessed.
- **Guards:** `apps/studio/tests/unit/m6-wo5-static.test.ts`, `packages/prowess-game/src/character-sheet.test.ts`, `packages/prowess-db/tests/integration/m6-wo5-character-sheet.test.ts`, `apps/studio/tests/integration/m6-wo5-character-sheet-api.test.ts`, `apps/studio/tests/unit/m6-wo5-sheet-ui.test.tsx`, `scripts/m6-wo5-negative-controls.mjs`

### M6-I047 — Mutable Play Resources Are Separate From Progression History

- **Group:** Play State
- **Meaning:** Current HP, MP, ME, AP and Counter values live in their own play-state rows with their own optimistic concurrency, are validated against the Release's minimum and derived maximum (refused, never clamped), never stored in creation or advancement history, and never refilled when a maximum changes.
- **Guards:** `apps/studio/tests/unit/m6-wo5-static.test.ts`, `packages/prowess-game/src/character-sheet.test.ts`, `packages/prowess-db/tests/integration/m6-wo5-character-sheet.test.ts`, `packages/prowess-db/tests/integration/m6-wo5-migration-compat.test.ts`, `apps/studio/tests/integration/m6-wo5-character-sheet-api.test.ts`, `scripts/m6-wo5-negative-controls.mjs`

### M6-I048 — Character Notes Never Create Mechanics

- **Group:** Player Text
- **Meaning:** Character Notes, Company / PAC and possessions are stored and shown exactly as written; nothing reads them as rules, numbers or entitlements.
- **Guards:** `apps/studio/tests/unit/m6-wo5-static.test.ts`, `packages/prowess-db/tests/integration/m6-wo5-character-sheet.test.ts`, `apps/studio/tests/unit/m6-wo5-sheet-ui.test.tsx`, `scripts/m6-wo5-negative-controls.mjs`

### M6-I049 — Action Notes Never Create Mechanics

- **Group:** Player Text
- **Meaning:** Action Notes are convenience text only: they never create, cost or resolve an action; Spells, Maneuvers and attacks arrive through their own Work Orders.
- **Guards:** `apps/studio/tests/unit/m6-wo5-static.test.ts`, `apps/studio/tests/unit/m6-wo5-sheet-ui.test.tsx`, `scripts/m6-wo5-negative-controls.mjs`

### M6-I050 — Portrait Framing Is Nondestructive

- **Group:** Portrait
- **Meaning:** The uploaded source image is stored exactly as validated; zoom and offsets are saved as numbers and applied visually, so framing never crops, re-encodes or rewrites the source.
- **Guards:** `apps/studio/tests/unit/m6-wo5-static.test.ts`, `packages/prowess-db/tests/integration/m6-wo5-character-sheet.test.ts`, `packages/prowess-db/tests/integration/m6-wo5-migration-compat.test.ts`, `apps/studio/tests/integration/m6-wo5-character-sheet-api.test.ts`, `apps/studio/tests/unit/m6-wo5-sheet-ui.test.tsx`, `scripts/m6-wo5-negative-controls.mjs`

### M6-I051 — Portraits Are Safe Raster Images Shown At Their Own Aspect Ratio

- **Group:** Portrait
- **Meaning:** Only PNG, JPEG and WebP within the size limit are accepted, by magic bytes and a full decode (never by filename or declared type alone; no SVG); bytes live only in their own table and are served by the application with nosniff and a sandboxing policy; the frame cover-fits the image without stretching it.
- **Guards:** `apps/studio/tests/unit/m6-wo5-static.test.ts`, `apps/studio/tests/integration/m6-wo5-character-sheet-api.test.ts`, `scripts/m6-wo5-negative-controls.mjs`

### M6-I052 — The Sheet Is Exact-Release Scoped

- **Group:** Release Pin
- **Meaning:** Every sheet read and write resolves the Character's own immutable Release; a newer Release never changes an existing Character's sheet and nothing looks up a latest Release.
- **Guards:** `apps/studio/tests/unit/m6-wo5-static.test.ts`, `packages/prowess-game/src/character-sheet.test.ts`, `packages/prowess-db/tests/integration/m6-wo5-character-sheet.test.ts`, `scripts/m6-wo5-negative-controls.mjs`

### M6-I053 — Frozen Character Creation Cannot Be Changed Through The Sheet

- **Group:** Creation Immutability
- **Meaning:** Sheet writes touch only the sheet-state tables; the Character row, its Level 1 creation rows and its Release are never written by any sheet operation.
- **Guards:** `apps/studio/tests/unit/m6-wo5-static.test.ts`, `packages/prowess-db/tests/integration/m6-wo5-character-sheet.test.ts`, `packages/prowess-db/tests/integration/m6-wo5-migration-compat.test.ts`, `apps/studio/tests/integration/m6-wo5-character-sheet-api.test.ts`, `scripts/m6-wo5-negative-controls.mjs`

### M6-I054 — Advancement Cannot Be Bypassed Through The Sheet

- **Group:** Level Ownership
- **Meaning:** The sheet never changes the Level, Skill ranks or Affinity progression; those move only through Advance Character (M6-WO4).
- **Guards:** `apps/studio/tests/unit/m6-wo5-static.test.ts`, `packages/prowess-db/tests/integration/m6-wo5-character-sheet.test.ts`, `scripts/m6-wo5-negative-controls.mjs`

### M6-I055 — Equipment And Ability Panels Are Integration Boundaries

- **Group:** Integration Boundaries
- **Meaning:** Equipment & Gear, Attunement, Carry & Weight and Granted Effects show intentional empty or unavailable states until their owning Work Orders; WO5 adds no equipment, inventory, ability or encounter domain.
- **Guards:** `apps/studio/tests/unit/m6-wo5-static.test.ts`, `apps/studio/tests/unit/m6-wo5-sheet-ui.test.tsx`, `scripts/m6-wo5-negative-controls.mjs`

### M6-I056 — Print Presentation Is Not Rules Authority

- **Group:** Presentation
- **Meaning:** The print view reuses the same components in print mode — no controls, explicit continuation instead of clipping — and no formula text or rule lives in artwork or the stylesheet.
- **Guards:** `apps/studio/tests/unit/m6-wo5-static.test.ts`, `apps/studio/tests/unit/m6-wo5-sheet-ui.test.tsx`, `scripts/m6-wo5-negative-controls.mjs`

### M6-I057 — Every Executable Weapon Move Has Exact Attack Identity

- **Group:** Attack Identity
- **Meaning:** Every Move a Character can use is an exact ATTACK (Entity + EntityVersion) pinned in the same Release as its Weapon; there is no generic Weapon Attack and no Move without an Attack.
- **Guards:** `apps/studio/tests/unit/m6-wo6-static.test.ts`, `packages/prowess-db/tests/integration/m6-wo6-authoring-to-release.test.ts`, `packages/prowess-game/src/m6-wo6-registry.test.ts`, `packages/prowess-game/src/weapon-definitions.test.ts`, `packages/prowess-game/src/weapon-library.test.ts`, `scripts/m6-wo6-negative-controls.mjs`

### M6-I058 — Weapon Moves Own Their AP Cost

- **Group:** Move Cost
- **Meaning:** The AP (and MP) of a Move is authored on its ATTACK and read from it; it is never derived from the Weapon's category, handedness or family.
- **Guards:** `apps/studio/tests/unit/m6-wo6-static.test.ts`, `packages/prowess-game/src/weapon-definitions.test.ts`, `packages/prowess-game/src/weapon-library.test.ts`, `scripts/m6-wo6-negative-controls.mjs`

### M6-I059 — Weapon And Move Properties Remain Distinct

- **Group:** Properties
- **Meaning:** Weapon properties and Move properties are separate exact Equipment Trait uses with their own declared use sites; a trait is accepted only at a site it declares.
- **Guards:** `apps/studio/tests/unit/m6-wo6-static.test.ts`, `packages/prowess-game/src/weapon-definitions.test.ts`, `scripts/m6-wo6-negative-controls.mjs`

### M6-I060 — Every Weapon Declares Power, Static Or Hybrid Scaling

- **Group:** Scaling
- **Meaning:** Each Weapon states POWER, STATIC or HYBRID; a HYBRID Weapon's Attacks each state their own scaling. Nothing infers scaling from a category or name.
- **Guards:** `apps/studio/tests/unit/m6-wo6-static.test.ts`, `packages/prowess-game/src/weapon-definitions.test.ts`, `packages/prowess-game/src/weapon-library.test.ts`, `scripts/m6-wo6-negative-controls.mjs`

### M6-I061 — Static Damage Never Uses Power

- **Group:** Scaling
- **Meaning:** A STATIC Attack's damage is its authored (grip-adjusted) dice; no Power, scaling Stat or Dual Wield Power adjustment is applied, and the Maneuver binding carries power: null, stat: null.
- **Guards:** `apps/studio/tests/unit/m6-wo6-static.test.ts`, `packages/prowess-game/src/weapon-definitions.test.ts`, `packages/prowess-game/src/weapon-library.test.ts`, `scripts/m6-wo6-negative-controls.mjs`

### M6-I062 — Power Scaling Repeats The Full Base Dice Expression

- **Group:** Damage
- **Meaning:** The Release's POWER_SCALING Formulas give the multiplier and the repeated dice count; the full base expression (count and sides) is repeated, never only one die.
- **Guards:** `apps/studio/tests/unit/m6-wo6-static.test.ts`, `packages/prowess-game/src/weapon-library.test.ts`, `scripts/m6-wo6-negative-controls.mjs`

### M6-I063 — Power May Never Fall Below 2

- **Group:** Damage
- **Meaning:** Authored Power is at least 2 and the multiplier Formula reads max(minimum Power, Power) with the Release's minimum.
- **Guards:** `apps/studio/tests/unit/m6-wo6-static.test.ts`, `packages/prowess-game/src/weapon-definitions.test.ts`, `packages/prowess-game/src/weapon-library.test.ts`, `scripts/m6-wo6-negative-controls.mjs`

### M6-I064 — Exact Weapon And Attack Refs Are Release Scoped

- **Group:** Release Pin
- **Meaning:** Every Weapon, Attack and Equipment Trait reference resolves inside the exact Release that pins it; a revision from another Release or an unpinned revision is refused, never substituted.
- **Guards:** `apps/studio/tests/unit/m6-wo6-static.test.ts`, `apps/studio/tests/integration/m6-wo6-weapons-api.test.ts`, `packages/prowess-db/tests/integration/m6-wo6-authoring-to-release.test.ts`, `packages/prowess-db/tests/integration/m6-wo6-weapon-loadout.test.ts`, `packages/prowess-game/src/m6-wo6-registry.test.ts`, `packages/prowess-game/src/weapon-library.test.ts`, `scripts/m6-wo6-negative-controls.mjs`

### M6-I065 — Attack Display Names Are Never Identity

- **Group:** Attack Identity
- **Meaning:** Display names (Bash, Slash) are presentation only; identity, equality and Powerful Blow compatibility use exact Entity + EntityVersion refs.
- **Guards:** `apps/studio/tests/unit/m6-wo6-static.test.ts`, `packages/prowess-game/src/weapon-definitions.test.ts`, `packages/prowess-game/src/weapon-library.test.ts`, `scripts/m6-wo6-negative-controls.mjs`

### M6-I066 — Character Loadout Cannot Mutate Release Identity

- **Group:** Loadout
- **Meaning:** The loadout stores only exact Weapon pairs and the Versatile grip, in its own table with a compare-and-set version; equipping never writes the Character row, its Release, creation, advancement history or sheet state.
- **Guards:** `apps/studio/tests/unit/m6-wo6-static.test.ts`, `apps/studio/tests/integration/m6-wo6-weapons-api.test.ts`, `packages/prowess-db/tests/integration/m6-wo6-migration-compat.test.ts`, `packages/prowess-db/tests/integration/m6-wo6-weapon-loadout.test.ts`, `packages/prowess-game/src/weapon-library.test.ts`, `scripts/m6-wo6-negative-controls.mjs`

### M6-I067 — Two-Handed Weapons Occupy Both Hands

- **Group:** Loadout
- **Meaning:** A Two-Handed Weapon, or a Versatile Weapon held two-handed, leaves no Off hand; a Two-Handed Weapon is never held in the Off hand.
- **Guards:** `apps/studio/tests/unit/m6-wo6-static.test.ts`, `apps/studio/tests/integration/m6-wo6-weapons-api.test.ts`, `packages/prowess-db/tests/integration/m6-wo6-weapon-loadout.test.ts`, `packages/prowess-game/src/weapon-library.test.ts`, `scripts/m6-wo6-negative-controls.mjs`

### M6-I068 — Versatile Grip Is Explicit

- **Group:** Loadout
- **Meaning:** A Versatile Main-hand Weapon needs an explicit grip; a grip on any other Weapon is refused. The Versatile die step applies before Power; a multi-die base fails closed.
- **Guards:** `apps/studio/tests/unit/m6-wo6-static.test.ts`, `packages/prowess-db/tests/integration/m6-wo6-weapon-loadout.test.ts`, `packages/prowess-game/src/weapon-definitions.test.ts`, `packages/prowess-game/src/weapon-library.test.ts`, `scripts/m6-wo6-negative-controls.mjs`

### M6-I069 — Shield Modifiers Are Derived Equipment Effects

- **Group:** Shields
- **Meaning:** While-equipped Armor, Dodge and Movement modifiers enter the one CharacterMechanicalProfile builder as named, sourced equipment bonuses; no derived total is stored, and an unequipped profile is unchanged.
- **Guards:** `apps/studio/tests/unit/m6-wo6-static.test.ts`, `apps/studio/tests/integration/m6-wo6-weapons-api.test.ts`, `packages/prowess-db/tests/integration/m6-wo6-weapon-loadout.test.ts`, `packages/prowess-game/src/weapon-library.test.ts`, `scripts/m6-wo6-negative-controls.mjs`

### M6-I070 — Dual Wield Retains Two Exact Attacks

- **Group:** Dual Wield
- **Meaning:** A Dual Wield sequence keeps the two exact Attacks, each from its own Weapon with its own binding; its AP comes from the Release's Dual Wield Formula (the higher of the two), never a sum or a merged Attack.
- **Guards:** `apps/studio/tests/unit/m6-wo6-static.test.ts`, `packages/prowess-game/src/weapon-bridge.test.ts`, `packages/prowess-game/src/weapon-library.test.ts`, `scripts/m6-wo6-negative-controls.mjs`

### M6-I071 — Dual Wield Is Not Powerful Blow

- **Group:** Dual Wield
- **Meaning:** Dual Wielding is a separate equipment rule; it never forms an M5 Powerful Blow, and Powerful Blow compatibility stays M5-WO11's exact-Attack rule.
- **Guards:** `apps/studio/tests/unit/m6-wo6-static.test.ts`, `packages/prowess-db/tests/integration/m6-wo6-weapon-loadout.test.ts`, `packages/prowess-game/src/weapon-bridge.test.ts`, `packages/prowess-game/src/weapon-library.test.ts`, `scripts/m6-wo6-negative-controls.mjs`

### M6-I072 — Unarmed Is Derived From Martial Rank

- **Group:** Unarmed
- **Meaning:** The Unarmed profile is the Release's Unarmed Weapon for the Character's Martial rank; it is never equipped in a hand or stored as mutable Weapon state.
- **Guards:** `apps/studio/tests/unit/m6-wo6-static.test.ts`, `packages/prowess-db/tests/integration/m6-wo6-weapon-loadout.test.ts`, `packages/prowess-game/src/weapon-library.test.ts`, `scripts/m6-wo6-negative-controls.mjs`

### M6-I073 — Ammunition Definitions Are Distinct From Runtime Ammunition State

- **Group:** Ammunition
- **Meaning:** Ammo, Loading, Reload and Loud are authored trait data only; no ammunition count, reserve or reload progress is stored, and Loud is never inferred from a category.
- **Guards:** `apps/studio/tests/unit/m6-wo6-static.test.ts`, `packages/prowess-db/tests/integration/m6-wo6-migration-compat.test.ts`, `packages/prowess-db/tests/integration/m6-wo6-weapon-loadout.test.ts`, `packages/prowess-game/src/weapon-definitions.test.ts`, `packages/prowess-game/src/weapon-library.test.ts`, `scripts/m6-wo6-negative-controls.mjs`

### M6-I074 — Weapon Preview Never Spends Resources Or Deals Damage

- **Group:** Purity
- **Meaning:** The Attack Library and damage preview are pure: nothing is rolled, spent, applied or written.
- **Guards:** `apps/studio/tests/unit/m6-wo6-static.test.ts`, `apps/studio/tests/integration/m6-wo6-weapons-api.test.ts`, `packages/prowess-db/tests/integration/m6-wo6-weapon-loadout.test.ts`, `packages/prowess-game/src/weapon-library.test.ts`, `scripts/m6-wo6-negative-controls.mjs`

### M6-I075 — Maneuver Attack Binding Reuses The Exact Weapon Attack Contract

- **Group:** Maneuver Bridge
- **Meaning:** A Weapon Attack binds into M5 through the existing foundation reader and MANEUVER_FOUNDATION contract, keeping the exact Weapon + Attack provenance, the Move's own AP, the damage profile and its scaling.
- **Guards:** `apps/studio/tests/unit/m6-wo6-static.test.ts`, `packages/prowess-game/src/weapon-bridge.test.ts`, `scripts/m6-wo6-negative-controls.mjs`

### M6-I076 — No Weapon Or Attack Resolves Through A Latest Revision Lookup

- **Group:** Release Pin
- **Meaning:** Every Weapon and Attack read resolves the exact pinned revision of the Character's or the requested Release; nothing looks up a latest or current revision.
- **Guards:** `apps/studio/tests/unit/m6-wo6-static.test.ts`, `apps/studio/tests/integration/m6-wo6-weapons-api.test.ts`, `packages/prowess-db/tests/integration/m6-wo6-weapon-loadout.test.ts`, `packages/prowess-game/src/weapon-library.test.ts`, `scripts/m6-wo6-negative-controls.mjs`
