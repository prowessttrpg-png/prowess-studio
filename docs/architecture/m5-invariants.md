# M5 Invariant Catalog (M5-WO1)

Machine-readable twin: `m5-invariants.json` (ids, titles, groups, guards). The permanent M5-WO1 audit
(`apps/studio/tests/unit/m5-wo1-static.test.ts`) requires every id below, each with executing automated guards.
M4 invariants (M4-I01–I188, M4-I162A) are frozen and are not repeated, renumbered or rewritten here.

### M5-I001 — Core Playtest V0.1 Is The Primary Mechanical Source For M5 Except Where Explicit Approved Designer Or Canon Clarification Supersedes It

- **Group:** Source authority
- **Meaning:** The system map, conflicts register and terminology inventory are built from the verified Core Playtest V0.1 bytes; designer clarifications and Canon decisions are recorded with their own authority.
- **Guards:** `packages/prowess-game/src/vocabulary.test.ts`, `apps/studio/tests/unit/m5-wo1-static.test.ts`

### M5-I002 — Unresolved Source Ambiguity Is Preserved Rather Than Silently Reconciled

- **Group:** Source authority
- **Meaning:** Conflicts are recorded UNRESOLVED with both sources; terminology without a ruling (Player Dice, Dodge / Evasion, Arcane / Arcana Rank, Advantage) is never normalized.
- **Guards:** `packages/prowess-game/src/vocabulary.test.ts`, `apps/studio/tests/unit/m5-wo1-static.test.ts`

### M5-I003 — Prowess-Specific Mechanics Do Not Enter The Generic @prowess/rules Package

- **Group:** Boundary
- **Meaning:** @prowess/rules stays model-only and free of Prowess vocabulary (AST audit; control §214).
- **Guards:** `apps/studio/tests/unit/m5-wo1-static.test.ts`, `scripts/m5-wo1-negative-controls.mjs`

### M5-I004 — Prowess Domain Semantics Live In A Dedicated Pure Domain Layer

- **Group:** Boundary
- **Meaning:** @prowess/game depends on @prowess/model and @prowess/rules only; no DB, import, Prisma, UI, framework, Node built-ins, clock, randomness or network (architecture rule; control §215).
- **Guards:** `apps/studio/tests/unit/m5-wo1-static.test.ts`, `scripts/m5-wo1-negative-controls.mjs`

### M5-I005 — Every Canonical Structured Prowess Definition Carries Exact EntityVersion Identity

- **Group:** Definition
- **Meaning:** Envelopes require exact Entity id, EntityVersion id and canonical key; stored Definitions take identity from the exact pinned rule.
- **Guards:** `packages/prowess-game/src/definition-envelope.test.ts`, `packages/prowess-db/tests/integration/prowess-definition-materialization.test.ts`

### M5-I006 — Definition Payload Schema Version Is Explicit And Independent Of EntityVersion

- **Group:** Definition
- **Meaning:** schemaVersion versions the payload contract; reserved kinds refuse a guessed payload.
- **Guards:** `packages/prowess-game/src/definition-envelope.test.ts`

### M5-I007 — Ruleset Provenance Is Preserved Through Exact Prowess Definition Materialization

- **Group:** Materialization
- **Meaning:** Bundles and envelopes carry the exact Ruleset / Manifest / Release and per-pin source provenance.
- **Guards:** `packages/prowess-game/src/definition-bundle.test.ts`, `packages/prowess-db/tests/integration/prowess-definition-materialization.test.ts`

### M5-I008 — Definition Bundles Contain Only Versions Pinned By Their Exact RulesetContext

- **Group:** Materialization
- **Meaning:** Injected or unpinned versions are rejected (NOT_PINNED; control §227).
- **Guards:** `packages/prowess-game/src/definition-bundle.test.ts`, `packages/prowess-db/tests/integration/prowess-definition-materialization.test.ts`, `scripts/m5-wo1-negative-controls.mjs`

### M5-I009 — Definitions From Different Exact Rulesets Are Never Silently Mixed

- **Group:** Materialization
- **Meaning:** Provenance naming another Ruleset / Manifest / Release is rejected; Ruleset isolation is tested against the real resolver.
- **Guards:** `packages/prowess-game/src/definition-bundle.test.ts`, `packages/prowess-db/tests/integration/prowess-definition-materialization.test.ts`, `scripts/m5-wo1-negative-controls.mjs`

### M5-I010 — Compilation Uses Exact Definition Versions And Never Latest/Current Lookup

- **Group:** Compilation
- **Meaning:** Every Composition reference must resolve exactly in the re-validated bundle of the request's exact RulesetContext.
- **Guards:** `packages/prowess-game/src/compilation.test.ts`, `packages/prowess-db/tests/integration/prowess-definition-materialization.test.ts`

### M5-I011 — Prowess Compilation Emits M4 EvaluationPlans Rather Than Reimplementing The M4 Rules Engine

- **Group:** Compilation
- **Meaning:** ProwessCompiledPlan.evaluationPlan is an M4 EvaluationPlan, accepted and executed by M4 orchestration.
- **Guards:** `packages/prowess-game/src/compilation.test.ts`

### M5-I012 — Compilation Performs No Hidden Gameplay Calculation

- **Group:** Compilation
- **Meaning:** The compiler copies authored templates; M4 computes (AST audit: no arithmetic / Math in @prowess/game; controls §225–226).
- **Guards:** `packages/prowess-game/src/compilation.test.ts`, `apps/studio/tests/unit/m5-wo1-static.test.ts`, `scripts/m5-wo1-negative-controls.mjs`

### M5-I013 — Compiled Step Identity And Ordering Are Deterministic

- **Group:** Compilation
- **Meaning:** Step keys derive from AbilityKind, Composition key and fragment key; order is explicit (control §217).
- **Guards:** `packages/prowess-game/src/compilation.test.ts`, `scripts/m5-wo1-negative-controls.mjs`

### M5-I014 — Compilation Preserves A Domain-To-Evaluation-Step Source Map

- **Group:** Compilation
- **Meaning:** One source-map entry per compiled step naming its components and exact Definitions; unmapped steps are rejected.
- **Guards:** `packages/prowess-game/src/compilation.test.ts`

### M5-I015 — Definition And Composition Are Separate Layers

- **Group:** Layers
- **Meaning:** Compositions reference Definitions; changing Composition parameters never mutates a Definition.
- **Guards:** `packages/prowess-game/src/ability-construction.test.ts`

### M5-I016 — Composition And Runtime State Are Separate Layers

- **Group:** Layers
- **Meaning:** Compositions hold no runtime state and are immutable once validated.
- **Guards:** `packages/prowess-game/src/ability-construction.test.ts`

### M5-I017 — Presentation Does Not Own Or Duplicate Prowess Mechanics

- **Group:** Layers
- **Meaning:** No Studio code imports @prowess/game or re-derives its contracts.
- **Guards:** `apps/studio/tests/unit/m5-wo1-static.test.ts`

### M5-I018 — Source Prose Is Never Parsed As Runtime Rule Logic

- **Group:** Source authority
- **Meaning:** @prowess/game has no SourceDocument / rawText access; source text is preserved verbatim by the M3 pipeline.
- **Guards:** `apps/studio/tests/unit/m5-wo1-static.test.ts`, `packages/prowess-db/tests/unit/m5-source-terminology.test.ts`

### M5-I019 — Import Review Does Not Automatically Create Canonical Executable Prowess Rules

- **Group:** Source authority
- **Meaning:** Import / review code never writes the Prowess Definition storage key; only Manifest-pinned structured versions materialize.
- **Guards:** `apps/studio/tests/unit/m5-wo1-static.test.ts`, `packages/prowess-db/tests/unit/m5-source-terminology.test.ts`

### M5-I020 — Canon Governance Is Explicit And Is Never Inferred By A Compiler

- **Group:** Boundary
- **Meaning:** No publish / approve / CanonDecision / ImportDecision operation exists in @prowess/game or the materializer (AST audit with controls).
- **Guards:** `apps/studio/tests/unit/m5-wo1-static.test.ts`

### M5-I021 — Spell Composition Supports Multiple Compatible Spell Effect Branches

- **Group:** Ability Construction
- **Meaning:** Damage + Movement and other multi-Effect Spells validate with explicit order.
- **Guards:** `packages/prowess-game/src/ability-construction.test.ts`

### M5-I022 — Targeting Defines Delivery Geometry And Legal Placement; It Does Not Determine The Applied Effect Or Resolution

- **Group:** Ability Construction
- **Meaning:** Targeting payloads may not carry Effects, outcomes, Saves or resolution (controls §223–224).
- **Guards:** `packages/prowess-game/src/ability-construction.test.ts`, `scripts/m5-wo1-negative-controls.mjs`

### M5-I023 — Mana Efficiency Payment Never Rewrites Listed Cost

- **Group:** Resources
- **Meaning:** A compiled payment keeps listed 17 while ME 6 + MP 11 pay it; ME is never a cost currency.
- **Guards:** `packages/prowess-game/src/compilation.test.ts`, `packages/prowess-game/src/vocabulary.test.ts`

### M5-I024 — Mana Lock Represents Reserved Capacity Rather Than Resource Spending

- **Group:** Resources
- **Meaning:** Mana Lock maps to M4 capacity reservation: reserving never spends current MP.
- **Guards:** `packages/prowess-game/src/compilation.test.ts`

### M5-I025 — Spell And Maneuver Construction Share The Prowess Modular Ability Construction Framework While Retaining Branch-Specific Rules And Catalogs

- **Group:** Ability Construction
- **Meaning:** One composition grammar; branch data and slot kinds stay branch-specific.
- **Guards:** `packages/prowess-game/src/ability-construction.test.ts`

### M5-I026 — Summoning Grants No Unauthored Capability

- **Group:** Ability Construction
- **Meaning:** Summon kinds are reserved with no payload contract and no compiler until authored by their Work Order.
- **Guards:** `packages/prowess-game/src/vocabulary.test.ts`

### M5-I027 — Historical Prowess Definitions Never Resolve Through Latest Or Current Selection

- **Group:** Materialization
- **Meaning:** Historical Manifests / Releases materialize their original versions; materialization loads exact ids only (control §216).
- **Guards:** `packages/prowess-game/src/definition-bundle.test.ts`, `packages/prowess-db/tests/integration/prowess-definition-materialization.test.ts`, `apps/studio/tests/unit/m5-wo1-static.test.ts`, `scripts/m5-wo1-negative-controls.mjs`

### M5-I028 — Prowess Domain Inputs And Outputs Are Immutable Detached Plain Data

- **Group:** Purity
- **Meaning:** Inputs are detached and never frozen in place; outputs are deep-frozen JSON-safe data; getters, functions, cycles and unsafe keys are rejected.
- **Guards:** `packages/prowess-game/src/definition-envelope.test.ts`, `packages/prowess-game/src/ability-construction.test.ts`

### M5-I029 — Prowess Compilation Is Deterministic

- **Group:** Purity
- **Meaning:** Equal inputs give deep-equal outputs; materialization is repeatable and read-only.
- **Guards:** `packages/prowess-game/src/definition-envelope.test.ts`, `packages/prowess-game/src/compilation.test.ts`, `packages/prowess-db/tests/integration/prowess-definition-materialization.test.ts`

### M5-I030 — Changes To The Frozen M4 Foundation Require Explicit Approval

- **Group:** Boundary
- **Meaning:** M4 invariant catalog, definitions, contract version, schema and migrations are pinned to the M5-WO1 baseline.
- **Guards:** `apps/studio/tests/unit/m5-wo1-static.test.ts`

### M5-I031 — Spell And Maneuver Targeting Use Common Targeting Semantics Where Applicable Without Requiring Shared Canonical Targeting Definitions

- **Group:** Ability Construction
- **Meaning:** Spell Radius and Maneuver Radius share semantic shape, never exact identity (control §222).
- **Guards:** `packages/prowess-game/src/ability-construction.test.ts`, `scripts/m5-wo1-negative-controls.mjs`

### M5-I032 — Equivalent AoE Geometry Has The Same Spatial Meaning Across Spell And Maneuver Construction; Attached Effects Determine The Outcome

- **Group:** Ability Construction
- **Meaning:** Both branches use one Targeting geometry contract; outcomes come only from Effects.
- **Guards:** `packages/prowess-game/src/ability-construction.test.ts`

### M5-I033 — Spell Effects And Maneuver Effects Implement A Common Effect Contract But Remain Separate Definition Families

- **Group:** Ability Construction
- **Meaning:** SPELL_EFFECT is never a legal Maneuver Effect (control §220).
- **Guards:** `packages/prowess-game/src/ability-construction.test.ts`, `scripts/m5-wo1-negative-controls.mjs`

### M5-I034 — Spell Traits And Maneuver Traits Implement A Common Trait Contract But Remain Separate Definition Families

- **Group:** Ability Construction
- **Meaning:** SPELL_TRAIT is never a legal Maneuver Trait (control §221).
- **Guards:** `packages/prowess-game/src/ability-construction.test.ts`, `scripts/m5-wo1-negative-controls.mjs`

### M5-I035 — Duration, Conditions, Affinity And Resolution Are Shared Ability-Construction Concepts Whose Legal Content And Consequences May Be Branch-Specific

- **Group:** Ability Construction
- **Meaning:** Shared contracts with branch-specific kinds for Duration and Conditions; Affinity in either branch.
- **Guards:** `packages/prowess-game/src/ability-construction.test.ts`, `packages/prowess-game/src/vocabulary.test.ts`

### M5-I036 — AbilityKind Determines Legal Definition Catalogs And Branch-Specific Rules; It Does Not Replace The Shared Construction Framework

- **Group:** Ability Construction
- **Meaning:** The slot-kind table per AbilityKind decides legality; AbilityKind is explicit.
- **Guards:** `packages/prowess-game/src/ability-construction.test.ts`, `packages/prowess-game/src/vocabulary.test.ts`

### M5-I037 — Evocation Is The Canonical Affinity Name; Emission Is Preserved Only As Historical / Legacy Source Terminology

- **Group:** Terminology
- **Meaning:** EVOCATION is canonical; Emission is rejected as a canonical value and preserved verbatim in sources (controls §218–219).
- **Guards:** `packages/prowess-game/src/definition-envelope.test.ts`, `packages/prowess-game/src/vocabulary.test.ts`, `packages/prowess-db/tests/unit/m5-source-terminology.test.ts`, `packages/prowess-db/tests/integration/prowess-definition-materialization.test.ts`, `scripts/m5-wo1-negative-controls.mjs`

### M5-I038 — A Shared Component Contract Never Makes Cross-Branch Definitions Automatically Interchangeable

- **Group:** Ability Construction
- **Meaning:** Implementing the same contract never satisfies another branch's slot kind.
- **Guards:** `packages/prowess-game/src/ability-construction.test.ts`, `scripts/m5-wo1-negative-controls.mjs`

### M5-I039 — An Affinity-Assisted Maneuver Remains A Maneuver Unless An Explicit Rule Changes Its AbilityKind

- **Group:** Ability Construction
- **Meaning:** Affinity and MP-bearing data never change AbilityKind; AbilityKind is never inferred (control §229).
- **Guards:** `packages/prowess-game/src/ability-construction.test.ts`

### M5-I040 — Ability Conditions And Target Conditions Are Distinct Concepts: Construction Restrictions Do Not Automatically Become Status Effects

- **Group:** Ability Construction
- **Meaning:** Ability Condition payloads may not apply statuses (control §230).
- **Guards:** `packages/prowess-game/src/ability-construction.test.ts`, `scripts/m5-wo1-negative-controls.mjs`
