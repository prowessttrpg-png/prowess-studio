# M5 Invariant Catalog (M5-WO1, extended by M5-WO2, M5-WO3, M5-WO4 and the post-WO4 canon rulings)

Machine-readable twin: `m5-invariants.json` (ids, titles, groups, guards, and — since M5-WO3 — the optional `status` /
`supersededBy` metadata of a superseded invariant; an entry without `status` is ACTIVE). The permanent M5-WO1 audit
(`apps/studio/tests/unit/m5-wo1-static.test.ts`) requires every id below, each with executing automated guards.
M4 invariants (M4-I01–I188, M4-I162A) are frozen and are not repeated, renumbered or rewritten here.

### M5-I001 — Core Playtest V0.1 Is The Primary Mechanical Source For M5 Except Where Explicit Approved Designer Or Canon Clarification Supersedes It

- **Group:** Source authority
- **Meaning:** The system map, conflicts register and terminology inventory are built from the verified Core Playtest V0.1 bytes; designer clarifications and Canon decisions are recorded with their own authority.
- **Guards:** `packages/prowess-game/src/vocabulary.test.ts`, `apps/studio/tests/unit/m5-wo1-static.test.ts`

### M5-I002 — Unresolved Source Ambiguity Is Preserved Rather Than Silently Reconciled

- **Group:** Source authority
- **Meaning:** Conflicts are recorded UNRESOLVED with both sources; terminology without a ruling (Player Dice, Dodge / Evasion, Arcane / Arcana Rank, Advantage) is never normalized; a term is normalized only once a ruling exists (Arcane / Arcana Rank: M5-I153).
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

## M5-WO2 — Core Resolution, Ability Scores, Character Dice & Rank Primitives

### M5-I041 — Character Die Is The Canonical Identity For Player Dice And Player Die Legacy Terminology

- **Group:** Terminology
- **Meaning:** Player Die / Player Dice are LEGACY synonyms of Character Die / Dice (M5-SC-002); one progression, no Player Die size (golden §142, control §183).
- **Guards:** `packages/prowess-game/src/core-resolution-golden.test.ts`, `packages/prowess-game/src/core-contracts.test.ts`, `packages/prowess-game/src/vocabulary.test.ts`, `apps/studio/tests/unit/m5-wo2-static.test.ts`, `scripts/m5-wo2-negative-controls.mjs`

### M5-I042 — Standard Character Die Progression Is Exact By Level And Is Structured Data, Not Scattered Hard-Coded Branches

- **Group:** Core Resolution
- **Meaning:** Level 1–10 → d4…d12 comes from the CHARACTER_DIE_PROGRESSION Definition; no level branch exists in code (golden §123).
- **Guards:** `packages/prowess-game/src/core-resolution-golden.test.ts`, `packages/prowess-game/src/core-contracts.test.ts`, `apps/studio/tests/unit/m5-wo2-static.test.ts`

### M5-I043 — Dice Evaluation Consumes Explicit Runtime Roll Results And Introduces No Randomness Into The Deterministic Rules Layer

- **Group:** Core Resolution
- **Meaning:** ProwessDieRollInput is validated against the exact die; no RNG anywhere in @prowess/game or @prowess/rules (control §184).
- **Guards:** `packages/prowess-game/src/core-contracts.test.ts`, `apps/studio/tests/unit/m5-wo2-static.test.ts`, `scripts/m5-wo2-negative-controls.mjs`

### M5-I044 — Half Character Die Uses Half The Die's Maximum Face As A Static Value

- **Group:** Core Resolution
- **Meaning:** HALF_CHARACTER_DIE = faces / 2 as an M4 Formula; no roll (golden §124).
- **Guards:** `packages/prowess-game/src/core-resolution-golden.test.ts`, `apps/studio/tests/unit/m5-wo2-static.test.ts`

### M5-I045 — Prowess Uses Exactly Six Canonical Core Ability Scores: STR, AGI, CON, PER, RES, PRO

- **Group:** Character Core
- **Meaning:** Six STAT Definitions; identities owned by @prowess/game, never by @prowess/rules.
- **Guards:** `packages/prowess-game/src/core-contracts.test.ts`, `apps/studio/tests/unit/m5-wo2-static.test.ts`

### M5-I046 — Standard Ability Scores Are Bounded From 1 Through 10 Unless An Exact Rule Explicitly Overrides The Bound

- **Group:** Character Core
- **Meaning:** STAT Definitions carry minimum 1 / maximum 10; a CharacterCore outside them fails closed, never clamped.
- **Guards:** `packages/prowess-game/src/core-contracts.test.ts`, `apps/studio/tests/unit/m5-wo2-static.test.ts`

### M5-I047 — Rank Ordering And Rank Numeric Effects Are Separate Concepts

- **Group:** Ranks
- **Meaning:** RANK_LADDER holds explicit order; SKILL_RANK holds Skill bonuses; rank requirements compile to M4 RANK_AT_LEAST (control §197).
- **Guards:** `packages/prowess-game/src/core-resolution-golden.test.ts`, `packages/prowess-game/src/core-contracts.test.ts`, `apps/studio/tests/unit/m5-wo2-static.test.ts`, `scripts/m5-wo2-negative-controls.mjs`

### M5-I048 — Base Skill Rank Bonuses Are Untrained 0, Trained +2, Expert +4, Master +6

- **Group:** Ranks
- **Meaning:** SKILL_RANK content; UNTRAINED has attemptAllowed false, separately from its rank (golden §133, control §197).
- **Guards:** `packages/prowess-game/src/core-resolution-golden.test.ts`, `apps/studio/tests/unit/m5-wo2-static.test.ts`, `scripts/m5-wo2-negative-controls.mjs`

### M5-I049 — Skill Checks Use The Stat Chosen For The Character's Approach Rather Than A Stat Permanently Owned By The Skill

- **Group:** Ranks
- **Meaning:** A Skill Check names its Stat explicitly; no Skill → Stat table exists (control §196).
- **Guards:** `packages/prowess-game/src/core-resolution-golden.test.ts`, `apps/studio/tests/unit/m5-wo2-static.test.ts`, `scripts/m5-wo2-negative-controls.mjs`

### M5-I050 — Core Roll Arithmetic Is Executed By M4 Formula And Threshold Resolution By M4 Requirement Rather Than By Hidden Compiler Math

- **Group:** Compilation
- **Meaning:** Totals, selections and statistics are FORMULA steps; comparisons are REQUIREMENT steps; the plan holds no results (control §185).
- **Guards:** `packages/prowess-game/src/core-contracts.test.ts`, `apps/studio/tests/unit/m5-wo2-static.test.ts`, `scripts/m5-wo2-negative-controls.mjs`, `packages/prowess-db/tests/integration/prowess-core-resolution-history.test.ts`

### M5-I051 — Advantage Selects The Higher Of Two Natural Character Die Results And Adds Modifiers Once

- **Group:** Core Resolution
- **Meaning:** max(r1, r2) selects the natural; bonuses enter only the total (golden §131, control §193). Both signals fail closed (M5-SC-032).
- **Guards:** `packages/prowess-game/src/core-resolution-golden.test.ts`, `apps/studio/tests/unit/m5-wo2-static.test.ts`, `scripts/m5-wo2-negative-controls.mjs`

### M5-I052 — Disadvantage Selects The Lower Of Two Natural Character Die Results And Adds Modifiers Once

- **Group:** Core Resolution
- **Meaning:** min(r1, r2) selects the natural; bonuses added once (golden §132).
- **Guards:** `packages/prowess-game/src/core-resolution-golden.test.ts`, `apps/studio/tests/unit/m5-wo2-static.test.ts`

### M5-I053 — Selected Natural Die Result Is Preserved Separately From Final Roll Total

- **Group:** Core Resolution
- **Meaning:** The natural-selection step is its own M4 step, named in plan outputs; criticals read it (control §194).
- **Guards:** `packages/prowess-game/src/core-resolution-golden.test.ts`, `apps/studio/tests/unit/m5-wo2-static.test.ts`, `scripts/m5-wo2-negative-controls.mjs`

### M5-I054 — Attack Rolls Use Character Die + PER + Prowess Accuracy + Explicit Bonuses Unless An Exact Rule Specifies Otherwise

- **Group:** Core Resolution
- **Meaning:** ATTACK_ROLL content total (golden §129, control §186).
- **Guards:** `packages/prowess-game/src/core-resolution-golden.test.ts`, `apps/studio/tests/unit/m5-wo2-static.test.ts`, `scripts/m5-wo2-negative-controls.mjs`

### M5-I055 — Prowess Accuracy Bonus Is floor(PRO / 3) And Remains An Explicit To-Hit Contribution

- **Group:** Core Resolution
- **Meaning:** ACCURACY is its own DERIVED_STAT step and named Formula term (golden §128, control §187).
- **Guards:** `packages/prowess-game/src/core-resolution-golden.test.ts`, `apps/studio/tests/unit/m5-wo2-static.test.ts`, `scripts/m5-wo2-negative-controls.mjs`

### M5-I056 — Dodge Is The Canonical Defense Term; Evasion Is Legacy Terminology For The Same Defense

- **Group:** Terminology
- **Meaning:** Evasion is LEGACY for Dodge (M5-SC-005); no second defense value (control §188).
- **Guards:** `packages/prowess-game/src/core-contracts.test.ts`, `packages/prowess-game/src/vocabulary.test.ts`, `apps/studio/tests/unit/m5-wo2-static.test.ts`, `scripts/m5-wo2-negative-controls.mjs`

### M5-I057 — Base Dodge Is Half Character Die + AGI + floor(PER / 3) Before Other Explicit Modifiers

- **Group:** Derived Statistics
- **Meaning:** DODGE content; the PER term is its own statistic (golden §126, control §189).
- **Guards:** `packages/prowess-game/src/core-resolution-golden.test.ts`, `apps/studio/tests/unit/m5-wo2-static.test.ts`, `scripts/m5-wo2-negative-controls.mjs`

### M5-I058 — A Maximum Natural Character Die Result Creates A Critical Threat But Does Not Automatically Hit

- **Group:** Core Resolution
- **Meaning:** Threat = selected natural == faces via M4 Requirement; success is separate (golden §130, control §195).
- **Guards:** `packages/prowess-game/src/core-resolution-golden.test.ts`, `apps/studio/tests/unit/m5-wo2-static.test.ts`, `scripts/m5-wo2-negative-controls.mjs`

### M5-I059 — Critical Hit Requires Both A Critical Threat And A Successful Attack

- **Group:** Core Resolution
- **Meaning:** Critical Hit is an M4 ALL Requirement of threat and hit; damage deferred (golden §130, control §195).
- **Guards:** `packages/prowess-game/src/core-resolution-golden.test.ts`, `apps/studio/tests/unit/m5-wo2-static.test.ts`, `scripts/m5-wo2-negative-controls.mjs`

### M5-I060 — Saving Throws Use Character Die + Explicit Save Stat + Explicit Bonuses

- **Group:** Core Resolution
- **Meaning:** SAVING_THROW content; any of the six Stats, always explicit (golden §135).
- **Guards:** `packages/prowess-game/src/core-resolution-golden.test.ts`, `apps/studio/tests/unit/m5-wo2-static.test.ts`

### M5-I061 — Targeting Never Selects A Saving Throw; The Applicable Effect Or Rule Does

- **Group:** Core Resolution
- **Meaning:** Targeting payloads may not carry save keys (M5-I022 carried forward, control §200).
- **Guards:** `packages/prowess-game/src/core-contracts.test.ts`, `apps/studio/tests/unit/m5-wo2-static.test.ts`, `scripts/m5-wo2-negative-controls.mjs`

### M5-I062 — Character DC Is Half Character Die + PRO + floor(RES / 3) + Explicit Bonuses

- **Group:** Derived Statistics
- **Meaning:** CHARACTER_DC content with a named Resolve DC Bonus (golden §127, control §190).
- **Guards:** `packages/prowess-game/src/core-resolution-golden.test.ts`, `apps/studio/tests/unit/m5-wo2-static.test.ts`, `scripts/m5-wo2-negative-controls.mjs`

### M5-I063 — Maximum HP Is Base HP From Race Plus CON Before Other Explicit Bonuses

- **Group:** Derived Statistics
- **Meaning:** MAXIMUM_HP = base_hp + con (golden §125, control §191).
- **Guards:** `packages/prowess-game/src/core-resolution-golden.test.ts`, `apps/studio/tests/unit/m5-wo2-static.test.ts`, `scripts/m5-wo2-negative-controls.mjs`

### M5-I064 — Maximum MP Is Base MP From Race Plus RES Before Other Explicit Bonuses

- **Group:** Derived Statistics
- **Meaning:** MAXIMUM_MP = base_mp + res (golden §125, control §192).
- **Guards:** `packages/prowess-game/src/core-resolution-golden.test.ts`, `apps/studio/tests/unit/m5-wo2-static.test.ts`, `scripts/m5-wo2-negative-controls.mjs`

### M5-I065 — Base HP And Base MP Are Racial Starting Values Rather Than Multipliers

- **Group:** Derived Statistics
- **Meaning:** Base HP / MP are CharacterCore inputs added, never multiplied (M5-SC-003).
- **Guards:** `packages/prowess-game/src/core-resolution-golden.test.ts`, `apps/studio/tests/unit/m5-wo2-static.test.ts`, `scripts/m5-wo2-negative-controls.mjs`

### M5-I066 — Strength Grants floor(STR / 3) Natural Armor Before Other Armor Sources

- **Group:** Derived Statistics
- **Meaning:** STRENGTH_ARMOR content (golden §136).
- **Guards:** `packages/prowess-game/src/core-resolution-golden.test.ts`, `apps/studio/tests/unit/m5-wo2-static.test.ts`

### M5-I067 — Agility Grants floor(AGI / 3) Additional AP Capacity Above The Base 3 AP

- **Group:** Derived Statistics
- **Meaning:** AP_AGILITY_BONUS and BASE_AP_CAPACITY content (golden §137).
- **Guards:** `packages/prowess-game/src/core-resolution-golden.test.ts`, `apps/studio/tests/unit/m5-wo2-static.test.ts`

### M5-I068 — Base Range Is 15 Feet Times PER

- **Group:** Derived Statistics
- **Meaning:** BASE_RANGE content, unit ft (golden §138).
- **Guards:** `packages/prowess-game/src/core-resolution-golden.test.ts`, `apps/studio/tests/unit/m5-wo2-static.test.ts`

### M5-I069 — Base Mana Efficiency Equals PRO And Remains A Payment Resource Rather Than A Listed-Cost Modifier

- **Group:** Derived Statistics
- **Meaning:** BASE_MANA_EFFICIENCY = pro; nothing subtracts ME from a listed cost (golden §139, control §199).
- **Guards:** `packages/prowess-game/src/core-resolution-golden.test.ts`, `apps/studio/tests/unit/m5-wo2-static.test.ts`, `scripts/m5-wo2-negative-controls.mjs`

### M5-I070 — Base Signature Ability Capacity Equals PRO

- **Group:** Derived Statistics
- **Meaning:** SIGNATURE_ABILITY_SLOTS content (golden §140).
- **Guards:** `packages/prowess-game/src/core-resolution-golden.test.ts`, `apps/studio/tests/unit/m5-wo2-static.test.ts`

### M5-I071 — Skill Automatic Success Uses Ability Score + Skill Rank Bonus Against DC Without Requiring A Character Die Roll

- **Group:** Core Resolution
- **Meaning:** SKILL_AUTOMATIC_SUCCESS is a dieless, separate plan fragment (golden §134).
- **Guards:** `packages/prowess-game/src/core-resolution-golden.test.ts`, `apps/studio/tests/unit/m5-wo2-static.test.ts`

### M5-I072 — Stat Mastery At Level 10 And Stat 10 Produces Advantage On Applicable Rolls Rather Than A Numeric Modifier

- **Group:** Core Resolution
- **Meaning:** An M4 MODIFIER ROLL_SIGNAL with a level / Stat condition; never a number (golden §141).
- **Guards:** `packages/prowess-game/src/core-resolution-golden.test.ts`, `apps/studio/tests/unit/m5-wo2-static.test.ts`

### M5-I073 — Unresolved Movement Formula Conflict M5-SC-006 Must Not Produce Executable Canonical Movement Math

- **Status:** SUPERSEDED by M5-I075 (M5-WO3). Valid when authored in M5-WO2; the M5-WO3 designer ruling resolved M5-SC-006, so Movement is now executable as 5 ft × AGI. Kept for history — not deleted, not renumbered.
- **Group:** Source Conflicts
- **Meaning:** Movement is DEFERRED_PENDING_CANON; a Movement DERIVED_STAT is refused (control §198).
- **Guards:** `packages/prowess-game/src/core-resolution-golden.test.ts`, `packages/prowess-game/src/core-contracts.test.ts`, `apps/studio/tests/unit/m5-wo2-static.test.ts`, `scripts/m5-wo2-negative-controls.mjs`

### M5-I074 — WO2 Derived Character Statistics Calculate Through M4 Primitives While Runtime Resource Mutation Remains Deferred To The Resource / Action-Economy Work

- **Group:** Derived Statistics
- **Meaning:** Statistics are M4 FORMULA steps; no Resource transition is compiled; exact Release history reproduces them.
- **Guards:** `packages/prowess-game/src/core-resolution-golden.test.ts`, `apps/studio/tests/unit/m5-wo2-static.test.ts`, `packages/prowess-db/tests/integration/prowess-core-resolution-history.test.ts`

### M5-I075 — Base Movement Equals 5 Feet Times AGI Before Size Or Other Explicit Movement Modifiers

- **Status:** SUPERSEDED by M5-I111 (M5-WO4). Valid under the terminology available during M5-WO3; the post-WO3 designer clarification names the authored creature value (5 ft) Base Movement and the product Movement = Base Movement × AGI, with no separate Total / Final Movement statistic. Numerical standard-character output is unchanged. Kept for history — not deleted, not renumbered.
- **Group:** Movement
- **Meaning:** core.derived.base_movement is the M4 Formula `5 * agi` (ft); Final Movement = Base Movement + explicit modifiers; 10 × AGI is never canonical (M5-SC-006 designer ruling; golden §61, controls §174–§175).
- **Guards:** `packages/prowess-game/src/runtime-resources-golden.test.ts`, `packages/prowess-game/src/core-resolution-golden.test.ts`, `packages/prowess-game/src/vocabulary.test.ts`, `apps/studio/tests/unit/m5-wo3-static.test.ts`, `scripts/m5-wo3-negative-controls.mjs`

### M5-I076 — Size-Based Movement Adjustments Are Explicit Structured Rules And Are Never Inferred From Occupied Space

- **Group:** Movement
- **Meaning:** CREATURE_SIZE carries occupied space only and movementAdjustment must be null until M5-SC-033 is resolved (control §176).
- **Guards:** `packages/prowess-game/src/runtime-contracts.test.ts`, `apps/studio/tests/unit/m5-wo3-static.test.ts`, `scripts/m5-wo3-negative-controls.mjs`

### M5-I077 — Advantage And Disadvantage Are Non-Stacking Presence Signals

- **Group:** Roll State
- **Meaning:** Any number of Advantage signals is ADVANTAGE; any number of Disadvantage is DISADVANTAGE; no stronger state exists (control §177).
- **Guards:** `packages/prowess-game/src/runtime-resources-golden.test.ts`, `apps/studio/tests/unit/m5-wo3-static.test.ts`, `scripts/m5-wo3-negative-controls.mjs`

### M5-I078 — If At Least One Advantage And At Least One Disadvantage Apply To The Same Roll, The Roll Resolves Normally Regardless Of Duplicate Counts

- **Group:** Roll State
- **Meaning:** resolveRollSignals resolves by presence, never by netting counts; the WO2 ROLL_MODE_CONFLICT is superseded (controls §178–§179).
- **Guards:** `packages/prowess-game/src/runtime-resources-golden.test.ts`, `packages/prowess-game/src/core-resolution-golden.test.ts`, `apps/studio/tests/unit/m5-wo3-static.test.ts`, `scripts/m5-wo3-negative-controls.mjs`

### M5-I079 — Roll-State Resolution Preserves Every Contributing Advantage And Disadvantage Source For Provenance And Explanation

- **Group:** Roll State
- **Meaning:** RollSignalResolution lists every Advantage and Disadvantage source key and whether cancellation happened (golden §120, control §180).
- **Guards:** `packages/prowess-game/src/runtime-resources-golden.test.ts`, `apps/studio/tests/unit/m5-wo3-static.test.ts`, `scripts/m5-wo3-negative-controls.mjs`

### M5-I080 — HP, MP, ME, AP And Counter Action Are Distinct Runtime Resources

- **Group:** Resources
- **Meaning:** One RESOURCE Definition each (plus the movement-allowance tracker), each its own M4 resource key; nothing stores a combined value.
- **Guards:** `packages/prowess-game/src/runtime-resources-golden.test.ts`, `packages/prowess-game/src/runtime-contracts.test.ts`, `apps/studio/tests/unit/m5-wo3-static.test.ts`

### M5-I081 — Resource Maximum Or Capacity Is Distinct From Current Resource Amount

- **Group:** Resources
- **Meaning:** Maxima are WO2 capacity statistics evaluated by M4 in every plan; current values are runtime input; Definitions hold no current value.
- **Guards:** `packages/prowess-game/src/runtime-resources-golden.test.ts`, `packages/prowess-game/src/runtime-contracts.test.ts`, `apps/studio/tests/unit/m5-wo3-static.test.ts`

### M5-I082 — HP Does Not Refresh Automatically On Turn Or Round Boundaries

- **Group:** Resources
- **Meaning:** resource.hp has no refresh and no expiry; no timing plan touches HP; healing is an explicit RESTORE.
- **Guards:** `packages/prowess-game/src/runtime-resources-golden.test.ts`, `apps/studio/tests/unit/m5-wo3-static.test.ts`

### M5-I083 — MP Does Not Refresh Automatically On Turn Or Round Boundaries

- **Group:** Resources
- **Meaning:** resource.mp has no refresh and no expiry; MP restoration requires an explicit rule.
- **Guards:** `packages/prowess-game/src/runtime-resources-golden.test.ts`, `apps/studio/tests/unit/m5-wo3-static.test.ts`

### M5-I084 — AP Refreshes To Current AP Capacity At The Start Of The Creature's Turn

- **Group:** Action Economy
- **Meaning:** resource.ap REFRESH TO_NOMINAL_MAXIMUM at START_OF_TURN, maximum = BASE_AP_CAPACITY (golden §105).
- **Guards:** `packages/prowess-game/src/runtime-resources-golden.test.ts`, `apps/studio/tests/unit/m5-wo3-static.test.ts`

### M5-I085 — Unused AP Expires At End Of Turn Unless An Explicit Rule Preserves It

- **Group:** Action Economy
- **Meaning:** resource.ap SET_CURRENT to its minimum at END_OF_TURN; an explicit preservation rule keeps it (golden §108, control §181).
- **Guards:** `packages/prowess-game/src/runtime-resources-golden.test.ts`, `apps/studio/tests/unit/m5-wo3-static.test.ts`, `scripts/m5-wo3-negative-controls.mjs`

### M5-I086 — Default Counter Action Capacity Is One And Refreshes At The Start Of Each Round

- **Group:** Action Economy
- **Meaning:** COUNTER_ACTION_CAPACITY = 1 (content); REFRESH TO_NOMINAL_MAXIMUM at START_OF_ROUND (golden §109).
- **Guards:** `packages/prowess-game/src/runtime-resources-golden.test.ts`, `apps/studio/tests/unit/m5-wo3-static.test.ts`

### M5-I087 — Counter Actions Never Accumulate Across Rounds By Default

- **Group:** Action Economy
- **Meaning:** Refresh raises to Capacity and never above; the Counter Action has no generic restoration (control §182).
- **Guards:** `packages/prowess-game/src/runtime-resources-golden.test.ts`, `apps/studio/tests/unit/m5-wo3-static.test.ts`, `scripts/m5-wo3-negative-controls.mjs`

### M5-I088 — Counter Action And AP Are Separate Resources And Are Not Implicitly Interchangeable

- **Group:** Action Economy
- **Meaning:** Separate payment policies (ACTION_POINT_COST / COUNTER_ACTION_COST); a reaction spends no AP and AP spends no reaction.
- **Guards:** `packages/prowess-game/src/runtime-resources-golden.test.ts`, `apps/studio/tests/unit/m5-wo3-static.test.ts`

### M5-I089 — Mana Efficiency Maximum Equals PRO And Current ME Refreshes To That Maximum At The Start Of Each Round

- **Group:** Mana
- **Meaning:** resource.me maximum = BASE_MANA_EFFICIENCY (= pro); REFRESH at START_OF_ROUND (golden §110, control §183).
- **Guards:** `packages/prowess-game/src/runtime-resources-golden.test.ts`, `apps/studio/tests/unit/m5-wo3-static.test.ts`, `scripts/m5-wo3-negative-controls.mjs`

### M5-I090 — Mana Efficiency Is Used Before MP Only For Costs Explicitly Declared ME-Eligible

- **Group:** Mana
- **Meaning:** ME pays ME_ELIGIBLE_MAGICAL_COST at order 0, MP at order 1; a MAGICAL_COST is MP only; meEligible is required (golden §111, control §185).
- **Guards:** `packages/prowess-game/src/runtime-resources-golden.test.ts`, `packages/prowess-game/src/runtime-contracts.test.ts`, `apps/studio/tests/unit/m5-wo3-static.test.ts`, `scripts/m5-wo3-negative-controls.mjs`

### M5-I091 — Mana Efficiency Payment Never Alters The Listed Cost Being Paid

- **Group:** Mana
- **Meaning:** The listed amount is a literal of the M4 payment and is echoed unchanged; nothing binds into it (control §184; extends M5-I023).
- **Guards:** `packages/prowess-game/src/runtime-resources-golden.test.ts`, `packages/prowess-game/src/runtime-contracts.test.ts`, `apps/studio/tests/unit/m5-wo3-static.test.ts`, `scripts/m5-wo3-negative-controls.mjs`

### M5-I092 — Prowess Multi-Resource Payment Is Atomic On Insufficient Resources

- **Group:** Mana
- **Meaning:** M4 payment canPay:false leaves the state unchanged; confirmation returns the original state (golden §107 / §112, control §186).
- **Guards:** `packages/prowess-game/src/runtime-resources-golden.test.ts`, `packages/prowess-game/src/runtime-contracts.test.ts`, `apps/studio/tests/unit/m5-wo3-static.test.ts`, `scripts/m5-wo3-negative-controls.mjs`

### M5-I093 — Reserved MP Capacity Reduces Available Maximum Without Spending Current MP

- **Group:** Mana
- **Meaning:** RESERVE_CAPACITY on resource.mp only changes reservedCapacity (golden §113, control §187).
- **Guards:** `packages/prowess-game/src/runtime-resources-golden.test.ts`, `apps/studio/tests/unit/m5-wo3-static.test.ts`, `scripts/m5-wo3-negative-controls.mjs`

### M5-I094 — Releasing Reserved MP Capacity Restores Capacity But Never Refills Current MP

- **Group:** Mana
- **Meaning:** RELEASE_CAPACITY changes reservedCapacity only (golden §114, control §188).
- **Guards:** `packages/prowess-game/src/runtime-resources-golden.test.ts`, `apps/studio/tests/unit/m5-wo3-static.test.ts`, `scripts/m5-wo3-negative-controls.mjs`

### M5-I095 — Core Runtime Resource Transitions Compile Through M4 Resource Operations And Do Not Reimplement Resource Arithmetic

- **Group:** Compilation
- **Meaning:** Runtime plans contain only FORMULA, REQUIREMENT and RESOURCE_* steps; @prowess/rules is byte-identical to the WO2 baseline.
- **Guards:** `packages/prowess-game/src/runtime-contracts.test.ts`, `apps/studio/tests/unit/m5-wo3-static.test.ts`

### M5-I096 — Prowess AP Is A Spendable Resource Rather Than A Fixed Number Of Action Slots

- **Group:** Action Economy
- **Meaning:** Actions pay their authored AP cost from one AP pool in any order (golden, control §189).
- **Guards:** `packages/prowess-game/src/runtime-resources-golden.test.ts`, `apps/studio/tests/unit/m5-wo3-static.test.ts`, `scripts/m5-wo3-negative-controls.mjs`

### M5-I097 — Core Action Costs Are Versioned Structured Definitions And May Be Overridden Only By Explicit Rules

- **Group:** Action Economy
- **Meaning:** ACTION Definitions hold FIXED / RANGE / MINIMUM / VARIABLE / NONE costs; an override names its source rule; no action-name switch (control §190).
- **Guards:** `packages/prowess-game/src/runtime-contracts.test.ts`, `apps/studio/tests/unit/m5-wo3-static.test.ts`, `scripts/m5-wo3-negative-controls.mjs`, `packages/prowess-db/tests/integration/prowess-runtime-resources-history.test.ts`

### M5-I098 — Move Costs One AP And Provides Movement Allowance Rather Than Permanently Changing Movement

- **Group:** Movement
- **Meaning:** Move pays 1 AP; its PAID follow-on restores the movement-allowance tracker by Final Movement (golden §116).
- **Guards:** `packages/prowess-game/src/runtime-resources-golden.test.ts`, `apps/studio/tests/unit/m5-wo3-static.test.ts`

### M5-I099 — Movement Allowance May Be Split Around Other Actions Until The Purchased Allowance Is Exhausted

- **Group:** Movement
- **Meaning:** MOVEMENT segments spend the allowance; no Move cost is repeated (golden §117).
- **Guards:** `packages/prowess-game/src/runtime-resources-golden.test.ts`, `apps/studio/tests/unit/m5-wo3-static.test.ts`

### M5-I100 — Difficult Terrain Consumes Movement Allowance At Double The Normal Rate Unless An Explicit Rule Overrides It

- **Group:** Movement
- **Meaning:** terrain.difficult allowance cost `distance * 2` (golden §118).
- **Guards:** `packages/prowess-game/src/runtime-resources-golden.test.ts`, `apps/studio/tests/unit/m5-wo3-static.test.ts`

### M5-I101 — Combat Uses Side Initiative And The Player Side Does Not Default To Individual Character Initiative Slots

- **Group:** Combat
- **Meaning:** Initiative orders sides; a side phase is a set the side orders itself (golden §124, control §191).
- **Guards:** `packages/prowess-game/src/runtime-resources-golden.test.ts`, `apps/studio/tests/unit/m5-wo3-static.test.ts`, `scripts/m5-wo3-negative-controls.mjs`

### M5-I102 — Initiative Uses Character Die + Half PER + Half AGI + Explicit Bonuses With No Implicit Rounding

- **Group:** Combat
- **Meaning:** core.resolution.initiative total `natural + per / 2 + agi / 2 + bonuses`, rounding NONE (golden §121, control §192).
- **Guards:** `packages/prowess-game/src/runtime-resources-golden.test.ts`, `apps/studio/tests/unit/m5-wo3-static.test.ts`, `scripts/m5-wo3-negative-controls.mjs`

### M5-I103 — Initiative Ties Resolve By Highest PER, Then Highest AGI, Then Explicit Reroll Requirement

- **Group:** Combat
- **Meaning:** The INITIATIVE Definition's tie-break is applied by comparison; a full tie is REROLL_REQUIRED, never generated (golden §122–§123, control §193).
- **Guards:** `packages/prowess-game/src/runtime-resources-golden.test.ts`, `packages/prowess-game/src/runtime-contracts.test.ts`, `apps/studio/tests/unit/m5-wo3-static.test.ts`, `scripts/m5-wo3-negative-controls.mjs`

### M5-I104 — Surprise Prevents Counter Action Use During The First Round Without Inventing A Fixed AP Penalty

- **Group:** Combat
- **Meaning:** A SURPRISED usage restriction (throughRound 1) on resource.counter_action; AP has none (golden §125, control §194).
- **Guards:** `packages/prowess-game/src/runtime-resources-golden.test.ts`, `apps/studio/tests/unit/m5-wo3-static.test.ts`, `scripts/m5-wo3-negative-controls.mjs`

### M5-I105 — Runtime Rules Evaluation Never Persists Current Combat Resource State As A Side Effect

- **Group:** Boundary
- **Meaning:** No schema change, no endpoint, no persistence path; runtime state is input and output only.
- **Guards:** `packages/prowess-game/src/runtime-contracts.test.ts`, `apps/studio/tests/unit/m5-wo3-static.test.ts`, `packages/prowess-db/tests/integration/prowess-runtime-resources-history.test.ts`

### M5-I106 — Resource And Action-Economy Steps Preserve Exact Prowess Definition And Ruleset Provenance

- **Group:** Provenance
- **Meaning:** One source-map entry per step citing exact RESOURCE / ACTION / TERRAIN / derived Definitions; M4 provenance names exact versions.
- **Guards:** `packages/prowess-game/src/runtime-contracts.test.ts`, `apps/studio/tests/unit/m5-wo3-static.test.ts`, `packages/prowess-db/tests/integration/prowess-runtime-resources-history.test.ts`, `packages/prowess-db/tests/unit/m5-wo3-inspector-fixture.test.ts`

### M5-I107 — Zero HP Is Exposed As Resource Depletion But Full Downed And Death-Save Resolution Remains A Separate Later Subsystem

- **Group:** Resources
- **Meaning:** A REQUIREMENT reports HP at its minimum; no Downed or Death Save logic exists in WO3.
- **Guards:** `packages/prowess-game/src/runtime-resources-golden.test.ts`, `apps/studio/tests/unit/m5-wo3-static.test.ts`

### M5-I108 — Creature Occupied Space And Creature Movement Speed Are Separate Mechanical Concepts

- **Group:** Movement
- **Meaning:** Occupied space is CREATURE_SIZE data; Final Movement never reads it (control §176).
- **Guards:** `packages/prowess-game/src/runtime-contracts.test.ts`, `apps/studio/tests/unit/m5-wo3-static.test.ts`, `scripts/m5-wo3-negative-controls.mjs`

### M5-I109 — Repeated Sprint Execution Must Never Exponentially Multiply Movement

- **Group:** Movement
- **Meaning:** Each Sprint grant reads Final Movement, never the accumulated allowance (golden: two Sprints → 2 × 4 × Movement).
- **Guards:** `packages/prowess-game/src/runtime-resources-golden.test.ts`, `apps/studio/tests/unit/m5-wo3-static.test.ts`

### M5-I110 — Ordinary Action Costs Are Atomic And Do Not Become Multi-Turn Commitments Unless The Action Explicitly Supports Such A Rule

- **Group:** Action Economy
- **Meaning:** A cost the creature cannot fully pay is CANNOT_PAY with the original state; no channeling or debt exists in WO3.
- **Guards:** `packages/prowess-game/src/runtime-resources-golden.test.ts`, `packages/prowess-game/src/runtime-contracts.test.ts`, `apps/studio/tests/unit/m5-wo3-static.test.ts`

### M5-I111 — Movement Equals Base Movement Multiplied By AGI; Base Movement Is A Separate Authored Creature Value

- **Group:** Movement
- **Meaning:** core.derived.base_movement is the authored 5 ft standard value (expression `5`); core.derived.movement is `base_movement * agi + bonuses`; AGI 4 → 20 ft (post-WO3 designer amendment applied in M5-WO4; supersedes M5-I075).
- **Guards:** `packages/prowess-game/src/affinity-golden.test.ts`, `packages/prowess-game/src/core-resolution-golden.test.ts`, `packages/prowess-game/src/runtime-resources-golden.test.ts`, `packages/prowess-game/src/vocabulary.test.ts`, `apps/studio/tests/unit/m5-wo4-static.test.ts`, `scripts/m5-wo4-negative-controls.mjs`

### M5-I112 — Sprint Grants Four Times The Creature's Movement And Does Not Require A Separate Total Movement Statistic

- **Group:** Movement
- **Meaning:** SPRINT grants `movement * 4` per execution (80 ft at AGI 4; two Sprints 80 + 80); no TOTAL_MOVEMENT / FINAL_MOVEMENT statistic exists (M5-SC-034 RESOLVED_BY_DESIGNER).
- **Guards:** `packages/prowess-game/src/affinity-golden.test.ts`, `packages/prowess-game/src/runtime-resources-golden.test.ts`, `packages/prowess-game/src/core-resolution-golden.test.ts`, `apps/studio/tests/unit/m5-wo4-static.test.ts`, `scripts/m5-wo4-negative-controls.mjs`

### M5-I113 — Creature Size May Alter Base Movement Only Through An Explicit Structured Rule; Occupied Space Never Implies Base Movement

- **Group:** Movement
- **Meaning:** CREATURE_SIZE.baseMovement must be null while M5-SC-033 is unresolved; occupied space (Large 10 × 10 ft) is never read as Base Movement.
- **Guards:** `packages/prowess-game/src/runtime-contracts.test.ts`, `apps/studio/tests/unit/m5-wo4-static.test.ts`

### M5-I114 — Prowess Has Exactly Six Canonical Affinity Identities: Evocation, Conjuration, Transmutation, Divination, Enhancement And Manipulation

- **Group:** Affinity Identity
- **Meaning:** affinity.json pins exactly six executable AFFINITY v2 Definitions; a bundle with two Definitions of one Affinity fails closed.
- **Guards:** `packages/prowess-game/src/affinity-contracts.test.ts`, `apps/studio/tests/unit/m5-wo4-static.test.ts`

### M5-I115 — Evocation Is Canonical And Emission Is Historical Legacy Terminology Only

- **Group:** Affinity Identity
- **Meaning:** EVOCATION is the structured token; 'Emission' anywhere in a canonical payload is LEGACY_TERM_AS_CANONICAL; provenance may record the legacy pair.
- **Guards:** `packages/prowess-game/src/affinity-contracts.test.ts`, `apps/studio/tests/unit/m5-wo4-static.test.ts`, `scripts/m5-wo4-negative-controls.mjs`

### M5-I116 — Affinity Ownership And Affinity Rank Are Separate Concepts

- **Group:** Affinity Ownership
- **Meaning:** A CharacterAffinityProfile entry records the exact Definition, its rank and its role separately; NONE is owned without benefit.
- **Guards:** `packages/prowess-game/src/affinity-contracts.test.ts`, `apps/studio/tests/unit/m5-wo4-static.test.ts`

### M5-I117 — A Level 1 Primary Affinity Is Owned At Rank NONE And Becomes Trained At Level 3 Under Standard Progression

- **Group:** Affinity Ownership
- **Meaning:** AFFINITY_PROGRESSION content: Level 1 CHOOSE_PRIMARY at NONE; Level 3 REQUIRED Primary NONE → TRAINED; validateAffinityProgression enforces it.
- **Guards:** `packages/prowess-game/src/affinity-contracts.test.ts`, `packages/prowess-game/src/affinity-golden.test.ts`, `apps/studio/tests/unit/m5-wo4-static.test.ts`

### M5-I118 — At Level 6 Standard Affinity Advancement Is Either Primary Trained To Expert Or A Secondary Affinity At Trained

- **Group:** Affinity Ownership
- **Meaning:** Level 6 is CHOOSE_ONE of PRIMARY_EXPERT and GAIN_SECONDARY_TRAINED; both branches validate, other states do not.
- **Guards:** `packages/prowess-game/src/affinity-contracts.test.ts`, `apps/studio/tests/unit/m5-wo4-static.test.ts`

### M5-I119 — The Starting Rank Of A New Level 9 Affinity Remains Unresolved Until Explicit Canon Resolves M5-SC-035

- **Status:** SUPERSEDED by M5-I151 (post-WO4 canon rulings). Valid while M5-SC-035 was unresolved; the designer has since ruled that a new Level 9 Affinity starts at Trained. Kept for history — not deleted, not renumbered.
- **Group:** Affinity Ownership
- **Meaning:** GAIN_NEW_AFFINITY has startingRank null and cites M5-SC-035; any profile reaching it is REQUIRES_CANON, never VALID by a guessed rank.
- **Guards:** `packages/prowess-game/src/affinity-contracts.test.ts`, `apps/studio/tests/unit/m5-wo4-static.test.ts`, `scripts/m5-wo4-negative-controls.mjs`

### M5-I120 — Affinity Rank Order Is NONE, TRAINED, EXPERT, MASTER And Is Distinct From Other Rank Systems' Numeric Effects

- **Group:** Affinity Rank
- **Meaning:** AFFINITY_RANK_RULE authors explicit orders 0–3, compared by M4 RANK_AT_LEAST; NONE is not the Skill rank UNTRAINED; no string comparison of rank names.
- **Guards:** `packages/prowess-game/src/affinity-contracts.test.ts`, `apps/studio/tests/unit/m5-wo4-static.test.ts`, `scripts/m5-wo4-negative-controls.mjs`

### M5-I121 — Affinity Strength Discount Is 0%, 10%, 20%, 30% For NONE, TRAINED, EXPERT, MASTER Respectively

- **Group:** Affinity Rank
- **Meaning:** The discounts are rank-rule content carried as the REDUCE_PERCENT operand; golden 100 → 100 / 90 / 80 / 70.
- **Guards:** `packages/prowess-game/src/affinity-golden.test.ts`, `packages/prowess-game/src/affinity-contracts.test.ts`, `apps/studio/tests/unit/m5-wo4-static.test.ts`, `scripts/m5-wo4-negative-controls.mjs`

### M5-I122 — Multiple Strength Keyword Matches From One Governing Affinity Apply The Rank Discount Only Once

- **Group:** Affinity Alignment
- **Meaning:** One UNIQUE Strength modifier conditioned on ANY Strength rule; DIRECT_DAMAGE + AREA_EFFECT at Expert: 20 → 16, never 12.8.
- **Guards:** `packages/prowess-game/src/affinity-golden.test.ts`, `apps/studio/tests/unit/m5-wo4-static.test.ts`, `scripts/m5-wo4-negative-controls.mjs`

### M5-I123 — Affinity Strength And Weakness Matching Uses Exact Structured Keyword Identity And Never Fuzzy Text Matching

- **Group:** Affinity Alignment
- **Meaning:** Rules name exact canonical keys; KEYWORD_PRESENT uses the exact KeywordDefinition id from the M1 catalog; an unknown key fails closed; a look-alike identity never matches.
- **Guards:** `packages/prowess-game/src/affinity-golden.test.ts`, `packages/prowess-game/src/affinity-contracts.test.ts`, `apps/studio/tests/unit/m5-wo4-static.test.ts`, `scripts/m5-wo4-negative-controls.mjs`

### M5-I124 — Every Affinity Weakness Owns An Exact Authored Percentage Penalty Rather Than Requiring Severity Inference

- **Group:** Affinity Weakness
- **Meaning:** activationPenaltyPercent is authoritative; severity is an optional reference label (null for Divination Persistent Effects +15%).
- **Guards:** `packages/prowess-game/src/affinity-golden.test.ts`, `packages/prowess-game/src/affinity-contracts.test.ts`, `apps/studio/tests/unit/m5-wo4-static.test.ts`, `scripts/m5-wo4-negative-controls.mjs`

### M5-I125 — When Multiple Weaknesses Of The Same Governing Affinity Match, Only The Highest Applicable Penalty Is Applied Unless An Explicit Rule Says Otherwise

- **Group:** Affinity Weakness
- **Meaning:** One M4 MAX modifier per Weakness selects the highest matched percentage; one INCREASE_PERCENT applies it (Healing +30 & Buff +20 → +30).
- **Guards:** `packages/prowess-game/src/affinity-golden.test.ts`, `packages/prowess-game/src/affinity-contracts.test.ts`, `apps/studio/tests/unit/m5-wo4-static.test.ts`, `scripts/m5-wo4-negative-controls.mjs`

### M5-I126 — All Matched Weaknesses Remain Visible For Provenance Even When Only The Highest Penalty Is Applied

- **Group:** Affinity Weakness
- **Meaning:** The alignment result lists every Weakness rule with matched flag, matched Keywords and contributors.
- **Guards:** `packages/prowess-game/src/affinity-golden.test.ts`, `apps/studio/tests/unit/m5-wo4-static.test.ts`

### M5-I127 — When An Ability Matches Both A Strength And A Weakness, Both Modifiers Apply

- **Group:** Affinity Cost
- **Meaning:** STRENGTH_AND_WEAKNESS classification; both modifiers are APPLIED by M4 (100 → 80 → 104).
- **Guards:** `packages/prowess-game/src/affinity-golden.test.ts`, `apps/studio/tests/unit/m5-wo4-static.test.ts`

### M5-I128 — Affinity Strength Discount Applies Before Affinity Weakness Penalty

- **Status:** SUPERSEDED by M5-I155 (post-WO4 rulings batch). Valid under M5-WO4; the designer ruling on M5-SC-028 nets every percentage cost modifier into one percentage applied once, so there is no "before". Kept for history — not deleted, not renumbered.
- **Group:** Affinity Cost
- **Meaning:** Strength REDUCE_PERCENT is phase 1, Weakness INCREASE_PERCENT is phase 2 of one M4 MODIFIER step; never netted.
- **Guards:** `packages/prowess-game/src/affinity-golden.test.ts`, `apps/studio/tests/unit/m5-wo4-static.test.ts`, `scripts/m5-wo4-negative-controls.mjs`

### M5-I129 — Affinity Modifier Arithmetic Does Not Round; Final Rounding Belongs To The Later Branch Cost Pipeline

- **Group:** Affinity Cost
- **Meaning:** 17 at Trained → 15.3 exactly; no Math.floor / ceil / round / toFixed or Formula rounding in the Affinity layer (M5-SC-028 stays with the cost pipeline).
- **Guards:** `packages/prowess-game/src/affinity-golden.test.ts`, `packages/prowess-game/src/affinity-contracts.test.ts`, `apps/studio/tests/unit/m5-wo4-static.test.ts`, `scripts/m5-wo4-negative-controls.mjs`

### M5-I130 — An Affinity Weakness Normally Changes Cost Rather Than Prohibiting Ability Construction

- **Group:** Affinity Cost
- **Meaning:** A Weakness match never produces an invalid plan or failed step; under Affinity Authority it satisfies Effect access with its penalty.
- **Guards:** `packages/prowess-game/src/affinity-golden.test.ts`, `apps/studio/tests/unit/m5-wo4-static.test.ts`, `scripts/m5-wo4-negative-controls.mjs`

### M5-I131 — Affinity-Relevant Keywords May Be Contributed By Explicit Targeting, Effects, Traits And Other Valid Ability Components

- **Group:** Keyword Contributions
- **Meaning:** Every component Definition's authored keywords enter one M4 KEYWORD step with its exact source (sourceType prowess.<contract>, componentKey, EntityVersion).
- **Guards:** `packages/prowess-game/src/affinity-golden.test.ts`, `packages/prowess-game/src/affinity-contracts.test.ts`, `apps/studio/tests/unit/m5-wo4-static.test.ts`

### M5-I132 — Affinity Does Not Infer Mechanical Keywords From Component Display Names Or Targeting Geometry

- **Group:** Keyword Contributions
- **Meaning:** A RADIUS Targeting without an AREA_EFFECT keyword is NEUTRAL; the compiler never reads semanticShape or names for alignment.
- **Guards:** `packages/prowess-game/src/affinity-golden.test.ts`, `apps/studio/tests/unit/m5-wo4-static.test.ts`, `scripts/m5-wo4-negative-controls.mjs`

### M5-I133 — One Explicit Governing Affinity Is Required For WO4 Executable Affinity Cost Evaluation; No Affinity Is Auto-Selected

- **Group:** Governing Affinity
- **Meaning:** The composition's explicit affinity component governs; null is GOVERNING_AFFINITY_REQUIRED; Primary / highest / first / newest are never chosen.
- **Guards:** `packages/prowess-game/src/affinity-contracts.test.ts`, `apps/studio/tests/unit/m5-wo4-static.test.ts`, `scripts/m5-wo4-negative-controls.mjs`

### M5-I134 — WO4 Does Not Stack Discounts From Multiple Owned Affinities Without An Explicit Future Multi-Affinity Rule

- **Group:** Governing Affinity
- **Meaning:** Only the governing Affinity's rules compile; a second owned Affinity contributes nothing to the plan.
- **Guards:** `packages/prowess-game/src/affinity-contracts.test.ts`, `apps/studio/tests/unit/m5-wo4-static.test.ts`, `scripts/m5-wo4-negative-controls.mjs`

### M5-I135 — The Governing Affinity Must Be An Exact Affinity Owned By The Character Under The Same Exact Ruleset

- **Group:** Governing Affinity
- **Meaning:** Exact ref equality with the profile's owned entry; rank always from the profile; a foreign or unowned version fails closed.
- **Guards:** `packages/prowess-game/src/affinity-contracts.test.ts`, `apps/studio/tests/unit/m5-wo4-static.test.ts`

### M5-I136 — Affinity Authority Requires At Least Trained Rank

- **Group:** Affinity Authority
- **Meaning:** authorityMinimumRank TRAINED compiles to M4 RANK_AT_LEAST; NONE is not satisfied and has no capacity.
- **Guards:** `packages/prowess-game/src/affinity-golden.test.ts`, `apps/studio/tests/unit/m5-wo4-static.test.ts`

### M5-I137 — Affinity Authority Effect Capacity Is One, Two, Three At Trained, Expert, Master

- **Group:** Affinity Authority
- **Meaning:** Rank-rule capacity compared by M4 NUMERIC_COMPARE `<=`; three Effects at Expert are not satisfied, never truncated.
- **Guards:** `packages/prowess-game/src/affinity-golden.test.ts`, `packages/prowess-game/src/affinity-contracts.test.ts`, `apps/studio/tests/unit/m5-wo4-static.test.ts`

### M5-I138 — Affinity Authority Base Trait Capacity Is One, Two, Three At Trained, Expert, Master

- **Group:** Affinity Authority
- **Meaning:** Rank-rule traitCapacity compared by M4; Trait exchange remains later Spell Construction work.
- **Guards:** `packages/prowess-game/src/affinity-golden.test.ts`, `packages/prowess-game/src/affinity-contracts.test.ts`, `apps/studio/tests/unit/m5-wo4-static.test.ts`

### M5-I139 — Arcane And Affinity Authority Capacities Do Not Add Together Unless An Explicit Feature Says Otherwise

- **Group:** Affinity Authority
- **Meaning:** One explicit Authority governs; Arcana data under Affinity Authority leaves capacity 2 at Expert, never 4.
- **Guards:** `packages/prowess-game/src/affinity-golden.test.ts`, `apps/studio/tests/unit/m5-wo4-static.test.ts`, `scripts/m5-wo4-negative-controls.mjs`

### M5-I140 — Affinity Authority Access And Affinity Cost Modification Are Separate Mechanical Concepts

- **Group:** Affinity Authority
- **Meaning:** AFFINITY_AUTHORITY and SPELL_AFFINITY_COST are separate subjects with separate outputs; the composition stores affinity and authority separately.
- **Guards:** `packages/prowess-game/src/affinity-golden.test.ts`, `packages/prowess-game/src/affinity-contracts.test.ts`, `apps/studio/tests/unit/m5-wo4-static.test.ts`

### M5-I141 — Qualifying For A Trait Through Affinity Rank Never Removes That Trait's Cost Or Other Requirements

- **Group:** Affinity Authority
- **Meaning:** AFFINITY_ACCESS yields satisfied / not satisfied only; it carries no cost and changes no cost.
- **Guards:** `packages/prowess-game/src/affinity-golden.test.ts`, `apps/studio/tests/unit/m5-wo4-static.test.ts`, `scripts/m5-wo4-negative-controls.mjs`

### M5-I142 — Spell Affinity Strengths And Weaknesses Modify Listed MP Rather Than Runtime Mana Payment

- **Group:** Branch Boundaries
- **Meaning:** The modifier target is LISTED_MP_COST (spell.listed_mp_cost); ME is never part of the Affinity plan.
- **Guards:** `packages/prowess-game/src/affinity-contracts.test.ts`, `apps/studio/tests/unit/m5-wo4-static.test.ts`, `scripts/m5-wo4-negative-controls.mjs`

### M5-I143 — Affinity Never Directly Modifies Spell AP Unless An Explicit Rule Says So; Its Normal AP Effect Occurs Indirectly Through Later MP-Based AP Derivation

- **Group:** Branch Boundaries
- **Meaning:** No AP target, Resource or operand exists in any Affinity plan.
- **Guards:** `packages/prowess-game/src/affinity-contracts.test.ts`, `apps/studio/tests/unit/m5-wo4-static.test.ts`, `scripts/m5-wo4-negative-controls.mjs`

### M5-I144 — Spell Affinity MP Economics Are Never Automatically Applied To Maneuver AP Or Other Maneuver Costs

- **Group:** Branch Boundaries
- **Meaning:** SPELL_AFFINITY_COST refuses a MANEUVER composition (SPELL_AFFINITY_COST_SPELL_ONLY).
- **Guards:** `packages/prowess-game/src/affinity-contracts.test.ts`, `apps/studio/tests/unit/m5-wo4-static.test.ts`, `scripts/m5-wo4-negative-controls.mjs`

### M5-I145 — Affinity Alignment Semantics Are Shared Across Ability Construction While Branch-Specific Cost And Access Rules Remain Explicit

- **Group:** Branch Boundaries
- **Meaning:** AFFINITY_ALIGNMENT and AFFINITY_ACCESS accept Spell and Maneuver compositions; a Maneuver stays a Maneuver.
- **Guards:** `packages/prowess-game/src/affinity-golden.test.ts`, `packages/prowess-game/src/affinity-contracts.test.ts`, `apps/studio/tests/unit/m5-wo4-static.test.ts`

### M5-I146 — Affinity Definitions, Rank Rules And Keyword Contributions Preserve Exact Ruleset And EntityVersion Provenance

- **Group:** Provenance
- **Meaning:** Every compiled step maps to the exact Affinity / rank rule / component Definitions; contributions carry EntityVersion ids and rule provenance.
- **Guards:** `packages/prowess-game/src/affinity-golden.test.ts`, `packages/prowess-game/src/affinity-contracts.test.ts`, `apps/studio/tests/unit/m5-wo4-static.test.ts`, `packages/prowess-db/tests/integration/prowess-affinity-history.test.ts`

### M5-I147 — Historical Affinity Evaluation Never Resolves Through Latest Or Current Content

- **Group:** Provenance
- **Meaning:** R1 reproduces after R2 pins a new Evocation version; no latest / current lookup exists.
- **Guards:** `packages/prowess-game/src/affinity-golden.test.ts`, `apps/studio/tests/unit/m5-wo4-static.test.ts`, `scripts/m5-wo4-negative-controls.mjs`, `packages/prowess-db/tests/integration/prowess-affinity-history.test.ts`

### M5-I148 — Affinity Compilation Uses Existing M4 Keyword, Requirement And Modifier Primitives Rather Than Reimplementing Them

- **Group:** Compilation
- **Meaning:** Plans contain only KEYWORD / REQUIREMENT / MODIFIER steps; @prowess/rules is byte-identical to the WO2 baseline.
- **Guards:** `packages/prowess-game/src/affinity-contracts.test.ts`, `apps/studio/tests/unit/m5-wo4-static.test.ts`

### M5-I149 — Affinity Cost Compilation Performs No Hidden Percentage Arithmetic In The Prowess Compiler

- **Group:** Compilation
- **Meaning:** The Weakness penalty operand is bound to M4's MAX result; the compiler multiplies, compares and rounds nothing.
- **Guards:** `packages/prowess-game/src/affinity-contracts.test.ts`, `apps/studio/tests/unit/m5-wo4-static.test.ts`, `scripts/m5-wo4-negative-controls.mjs`

### M5-I150 — Affinity Evaluation Is Deterministic, Immutable, JSON-Safe And Free Of Global Mutable Affinity State

- **Group:** Compilation
- **Meaning:** Equal requests give deep-equal plans, runs and readings; inputs are never mutated; interleaved Rulesets never cross-contaminate.
- **Guards:** `packages/prowess-game/src/affinity-golden.test.ts`, `packages/prowess-game/src/affinity-contracts.test.ts`, `apps/studio/tests/unit/m5-wo4-static.test.ts`

### M5-I151 — A New Level 9 Affinity Starts At Trained And Every Affinity Ranks Independently

- **Group:** Affinity Ownership
- **Meaning:** Designer ruling M5-SC-035: GAIN_NEW_AFFINITY has startingRank TRAINED and no conflict key; Primary Master, Primary Expert + one Secondary Trained, and three Affinities Trained are the VALID Level 9 outcomes; a new Level 9 Affinity at any other Rank is INVALID. An option whose starting Rank is unresolved content (null) still validates REQUIRES_CANON, never by a guessed Rank.
- **Guards:** `packages/prowess-game/src/affinity-contracts.test.ts`, `apps/studio/tests/unit/m5-wo4-static.test.ts`, `apps/studio/tests/unit/m5-canon-rulings-static.test.ts`, `scripts/m5-wo4-negative-controls.mjs`

### M5-I152 — Base Movement Is Authored Per Creature Size And Is Never Derived From Occupied Space; Massive Remains Pending Canon

- **Status:** SUPERSEDED by M5-I154 (post-WO4 rulings batch). Valid until the rulings batch; the designer ruling on M5-SC-036 sets Huge to 20 ft (not 15) and Massive to 40 ft. Kept for history — not deleted, not renumbered.
- **Group:** Movement
- **Meaning:** Designer ruling M5-SC-033: CREATURE_SIZE authors baseMovement Small 5 ft, Medium 5 ft, Large 10 ft, Huge 15 ft; core.derived.base_movement reads the character's exact Size Definition through CREATURE_SIZE_BASE_MOVEMENT and cites it; a character with no Size named is MEDIUM; Movement = Base Movement × AGI + bonuses. Massive is null (M5-SC-036) and fails closed with PROWESS_CORE.SIZE_BASE_MOVEMENT_PENDING_CANON. Occupied space is never read as Base Movement.
- **Guards:** `packages/prowess-game/src/runtime-contracts.test.ts`, `packages/prowess-game/src/core-resolution-golden.test.ts`, `apps/studio/tests/unit/m5-wo3-static.test.ts`, `apps/studio/tests/unit/m5-wo4-static.test.ts`, `apps/studio/tests/unit/m5-canon-rulings-static.test.ts`, `scripts/m5-wo4-negative-controls.mjs`

### M5-I153 — Arcane Rank Is The Arcana Skill's Rank; Arcana Rank Is Its Legacy Name

- **Group:** Terminology
- **Meaning:** Designer ruling M5-SC-011: Arcane Rank and Arcana Rank are one rank — the Arcana Skill's rank. The terminology inventory records "Arcane Rank" CANONICAL (token ARCANE_RANK, SKILL family) and "Arcana Rank" LEGACY with canonical term "Arcane Rank". No separate Arcane track exists; Arcane Authority capacity is still later Spell Creation work.
- **Guards:** `packages/prowess-game/src/vocabulary.test.ts`, `apps/studio/tests/unit/m5-wo2-static.test.ts`, `apps/studio/tests/unit/m5-wo4-static.test.ts`, `apps/studio/tests/unit/m5-canon-rulings-static.test.ts`, `scripts/m5-wo4-negative-controls.mjs`

### M5-I154 — Base Movement Is Authored Per Creature Size: Small 5, Medium 5, Large 10, Huge 20, Massive 40 Feet; Never Derived From Occupied Space

- **Group:** Movement
- **Meaning:** Designer rulings M5-SC-033 / M5-SC-036: CREATURE_SIZE authors baseMovement Small 5, Medium 5, Large 10, Huge 20, Massive 40 ft; core.derived.base_movement copies the character's exact Size Definition value (MEDIUM when none is named) and cites it; Movement = Base Movement × AGI + bonuses. A Size whose value is unauthored (null) still fails closed with PROWESS_CORE.SIZE_BASE_MOVEMENT_PENDING_CANON. Occupied space is never read as Base Movement.
- **Guards:** `packages/prowess-game/src/runtime-contracts.test.ts`, `packages/prowess-game/src/runtime-resources-golden.test.ts`, `apps/studio/tests/unit/m5-wo3-static.test.ts`, `apps/studio/tests/unit/m5-wo4-static.test.ts`, `apps/studio/tests/unit/m5-canon-rulings-static.test.ts`, `scripts/m5-wo4-negative-controls.mjs`

### M5-I155 — Percentage Cost Modifiers Combine Into One Net Percentage Applied Once; Final Rounding Is Normal, Once, At The End Of Spell Creation

- **Group:** Affinity Cost
- **Meaning:** Designer ruling M5-SC-028: M4 computes one net percentage — 100 − Strength discount (once) + selected highest Weakness penalty (once) — and applies it once to the listed cost (× net ÷ 100), unrounded. Golden: Master −30% + Weakness +20% → 90% → 20 MP → 18 (never the sequential 16.8). Casting Conditions join the same net sum later; the final normal rounding happens once at the end of Spell creation (Spell cost pipeline).
- **Guards:** `packages/prowess-game/src/affinity-golden.test.ts`, `packages/prowess-game/src/affinity-contracts.test.ts`, `apps/studio/tests/unit/m5-wo4-static.test.ts`, `apps/studio/tests/unit/m5-canon-rulings-static.test.ts`, `scripts/m5-wo4-negative-controls.mjs`

### M5-I156 — Spell Authority Is Explicit: Arcane Authority Reads The Arcana Skill Rank At Trained Or Higher; Affinity Authority Reads The Governing Affinity Owned At Trained Or Higher; Never Auto-Switched

- **Group:** Ability Construction
- **Meaning:** A Spell names its Authority explicitly (ARCANE_AUTHORITY or AFFINITY_AUTHORITY); the compiler never picks the higher one. Arcane Authority reads the Arcana Skill rank on the SKILL ladder (TRAINED minimum) and its Effect / Trait capacity from the ABILITY_CONSTRUCTION_RULE (Trained 1/1, Expert 2/2, Master 3/3). Affinity Authority requires the governing Affinity owned at TRAINED+ and reuses the WO4 AFFINITY_RANK_RULE capacities (never duplicated). A Spell without an Authority is PROWESS_CONSTRUCTION.AUTHORITY_REQUIRED; a Maneuver with one is AUTHORITY_NOT_APPLICABLE. The Spell Trait exchange is explicit (1 Effect slot → 1 Trait slot) and always leaves at least one Effect.
- **Guards:** `packages/prowess-game/src/construction-legality-golden.test.ts`, `packages/prowess-game/src/construction-legality-contracts.test.ts`, `apps/studio/tests/unit/m5-wo5-static.test.ts`, `scripts/m5-wo5-negative-controls.mjs`

### M5-I157 — Casting Condition Capacity Comes From Arcane Rank Only: Untrained 0, Trained 1, Expert 2, Master 3, Under Either Authority

- **Group:** Ability Construction
- **Meaning:** The construction rule authors castingConditions.capacitySource = ARCANE_RANK with Untrained 0 · Trained 1 · Expert 2 · Master 3. The capacity is read from the Arcana Skill rank whatever the Spell's Authority; Affinity rank never adds Casting Condition capacity.
- **Guards:** `packages/prowess-game/src/construction-legality-golden.test.ts`, `packages/prowess-game/src/construction-legality-contracts.test.ts`, `apps/studio/tests/unit/m5-wo5-static.test.ts`, `scripts/m5-wo5-negative-controls.mjs`

### M5-I158 — Martial Trained Is The Maneuver Minimum; Martial Rank Is The Martial Skill Rank; Affinity Never Substitutes For Or Adds Maneuver Capacity

- **Group:** Ability Construction
- **Meaning:** A Maneuver reads the Martial Skill rank (SKILL ladder, TRAINED minimum) with authored Rank Value and Effect / Trait / Condition capacity 1/2/3 at Trained / Expert / Master. A Maneuver needs a MANEUVER_FOUNDATION and at least one Effect; there is no Maneuver Trait exchange. Owning an Affinity grants access to Affinity-gated components only — it never substitutes for Martial training nor adds Maneuver capacity.
- **Guards:** `packages/prowess-game/src/construction-legality-golden.test.ts`, `packages/prowess-game/src/construction-legality-contracts.test.ts`, `apps/studio/tests/unit/m5-wo5-static.test.ts`, `scripts/m5-wo5-negative-controls.mjs`

### M5-I159 — Targeting Determines Range, Area, Target Count, Delivery, Origin And Placement; It Never Determines An Effect's Mechanical Outcome

- **Group:** Targeting
- **Meaning:** A Targeting Definition's `rules.targeting` sub-contract states range model, area measures, cardinality, valid target categories, origin, placement, Line of Sight / Effect and cover policy. TARGETING_FORBIDDEN_KEYS (outcome, damage, healing, status, save, saveProfile, attackRoll …) are refused at any depth (PROWESS_DEFINITION.TARGETING_IMPLIES_OUTCOME); the Targeting result never contains an outcome.
- **Guards:** `packages/prowess-game/src/targeting-golden.test.ts`, `packages/prowess-game/src/targeting-contracts.test.ts`, `apps/studio/tests/unit/m5-wo6-static.test.ts`, `scripts/m5-wo6-negative-controls.mjs`

### M5-I160 — Targeting Never Selects An Attack Roll, Saving Throw Or Save Stat; Resolution Belongs To Effects Even When A Targeting Type Has A Typical Delivery Family

- **Status:** `SUPERSEDED` by `M5-I180` for current canon. Historical Releases remain reproducible.

- **Group:** Targeting
- **Meaning:** Touch and Projectile carry deliveryFamily DIRECT_ATTACK_DELIVERY as a classification only; no Targeting plan contains an Attack Roll, Saving Throw, Save Stat or Save Profile step or value. Cover is EXPOSED_TO_RESOLUTION metadata; the Effect decides Dodge or Save effects.
- **Guards:** `packages/prowess-game/src/targeting-golden.test.ts`, `packages/prowess-game/src/targeting-contracts.test.ts`, `apps/studio/tests/unit/m5-wo6-static.test.ts`, `scripts/m5-wo6-negative-controls.mjs`

### M5-I161 — A Standard Ability Composition Has Exactly One Branch-Specific Targeting Definition, And A Standard Multi-Effect Spell Shares That Targeting Across All Effects Unless An Explicit Modifier Says Otherwise

- **Group:** Targeting
- **Meaning:** The WO1 composition keeps one `targeting` use (never targeting[]). Every component with an explicit TARGETING compatibility rule is checked against that one Targeting by an M4 REQUIREMENT; an explicit `targetingModifiers` entry (a Trait, Metamagic or special rule — later Work Orders) yields MODIFIED_BY_EXPLICIT_RULE.
- **Guards:** `packages/prowess-game/src/targeting-golden.test.ts`, `packages/prowess-game/src/targeting-contracts.test.ts`, `apps/studio/tests/unit/m5-wo6-static.test.ts`, `scripts/m5-wo6-negative-controls.mjs`

### M5-I162 — SPELL_TARGETING And MANEUVER_TARGETING Remain Distinct Exact Definition Families Even When They Share The Same Semantic Geometry

- **Group:** Targeting
- **Meaning:** Both are stored under EntityType TARGETING; the DefinitionKind keeps them apart. A SPELL_TARGETING Definition in a Maneuver composition is the WO1 CROSS_BRANCH_DEFINITION. Spell Radius (5 ft × PRO) and Maneuver Radius (Martial Rank Base × STR) share the RADIUS shape but are different exact Definitions and formulas.
- **Guards:** `packages/prowess-game/src/targeting-golden.test.ts`, `packages/prowess-game/src/targeting-contracts.test.ts`, `apps/studio/tests/unit/m5-wo6-static.test.ts`, `scripts/m5-wo6-negative-controls.mjs`

### M5-I163 — Projectile Is A Canonical Spell Targeting Type Distinct From Single Target, While Its Base MP Cost Remains Deferred Until M5-SC-039 Is Resolved

- **Status:** `SUPERSEDED` by `M5-I179` for current canon. Historical Releases remain reproducible.

- **Group:** Targeting
- **Meaning:** spell.targeting.projectile (semantic PROJECTILE, one primary target, default Spell Range) is its own Definition. Its base contribution is BASE_DEFERRED citing M5-SC-039; the result reports DEFERRED_PENDING_CANON — never 2, 0 or 3 MP.
- **Guards:** `packages/prowess-game/src/targeting-golden.test.ts`, `packages/prowess-game/src/targeting-contracts.test.ts`, `apps/studio/tests/unit/m5-wo6-static.test.ts`, `scripts/m5-wo6-negative-controls.mjs`

### M5-I164 — Trigger-Based And Glyph/Anchor Are Targeting Add-Ons, Not Canonical Base Spell Targeting Types

- **Group:** Targeting
- **Meaning:** Designer ruling M5-SC-029: TARGETING_ADD_ONS are TRIGGER / ANCHOR. The historical WO1 shapes TRIGGERED / ANCHOR stay readable, but a Definition with executable `rules.targeting` using them, or a composition using one, is PROWESS_TARGETING.TARGETING_ADD_ON_AS_BASE. No canonical trigger / glyph / anchor Targeting Definition exists; the +4 / +5 MP source costs are never used.
- **Guards:** `packages/prowess-game/src/targeting-golden.test.ts`, `packages/prowess-game/src/targeting-contracts.test.ts`, `apps/studio/tests/unit/m5-wo6-static.test.ts`, `scripts/m5-wo6-negative-controls.mjs`

### M5-I165 — Default Spell Range Equals 15 Feet Times PER Unless An Exact Targeting Or Ability Rule Overrides It

- **Group:** Targeting
- **Meaning:** DEFAULT_SPELL_RANGE reads the WO2 BASE_RANGE statistic (core.derived.base_range, 15 × PER) through an M4 FORMULA step; the Targeting range Formula adds only declared range extensions. PER 4 → 60 ft.
- **Guards:** `packages/prowess-game/src/targeting-golden.test.ts`, `apps/studio/tests/unit/m5-wo6-static.test.ts`, `scripts/m5-wo6-negative-controls.mjs`

### M5-I166 — Spell Range And Spell Area Are Separate Mechanical Values And Must Never Be Collapsed Into One Distance

- **Group:** Targeting
- **Meaning:** Range is its own step and output; area measures (LENGTH / WIDTH / RADIUS) are separate steps and outputs. PER 5, PRO 3 Radius → placement range 75 ft and radius 15 ft.
- **Guards:** `packages/prowess-game/src/targeting-golden.test.ts`, `apps/studio/tests/unit/m5-wo6-static.test.ts`, `scripts/m5-wo6-negative-controls.mjs`

### M5-I167 — Spell Line Length Equals 15 Feet Times PRO; The Ambiguous Base Line Width Rule Must Remain Deferred Until M5-SC-040 Is Resolved

- **Status:** `SUPERSEDED` by `M5-I183` for current canon. Historical Releases remain reproducible.

- **Group:** Targeting
- **Meaning:** Spell Line LENGTH = 15 × PRO (+ declared length extensions) is an M4 Formula; WIDTH is DEFERRED_PENDING_CANON with the rule text '5 ft wide per 2 Prowess' and conflict M5-SC-040 — no width step, no guessed rounding or minimum.
- **Guards:** `packages/prowess-game/src/targeting-golden.test.ts`, `apps/studio/tests/unit/m5-wo6-static.test.ts`, `scripts/m5-wo6-negative-controls.mjs`

### M5-I168 — Spell Cone Length Equals 10 Feet Times PRO

- **Group:** Targeting
- **Meaning:** Spell Cone LENGTH = 10 × PRO (+ declared length extensions) through an M4 Formula. PRO 3 → 30 ft.
- **Guards:** `packages/prowess-game/src/targeting-golden.test.ts`, `apps/studio/tests/unit/m5-wo6-static.test.ts`, `scripts/m5-wo6-negative-controls.mjs`

### M5-I169 — Spell Radius, Zone Radius And Aura Radius Each Use Five Feet Times PRO Unless An Exact Rule Overrides Them

- **Group:** Targeting
- **Meaning:** Spell Radius, Zone and Aura RADIUS = 5 × PRO through M4 Formulas. Zone authors no Duration; Aura follows its authored source (CASTER by default; SUMMON / OBJECT / ANCHOR listed at +4 MP).
- **Guards:** `packages/prowess-game/src/targeting-golden.test.ts`, `apps/studio/tests/unit/m5-wo6-static.test.ts`, `scripts/m5-wo6-negative-controls.mjs`

### M5-I170 — The Superseded Plus-Three-MP Radius/Zone/Aura Expansion Rule Is Never Used; Widen Area Is A Targeting Trait Costing Six MP And Is Owned By The Trait Subsystem

- **Group:** Targeting
- **Meaning:** Designer ruling M5-SC-024: no Spell Targeting authors an area / radius extension parameter or a radius-extension cost. Radius-capable Targeting carries explicit `radiusCapable: true` metadata for the Widen Area Trait (M5-WO8).
- **Guards:** `packages/prowess-game/src/targeting-contracts.test.ts`, `apps/studio/tests/unit/m5-wo6-static.test.ts`, `scripts/m5-wo6-negative-controls.mjs`

### M5-I171 — Targeting Compatibility Uses Exact Structured Identity Or Explicit Semantic Rules And Never Display-Name Or Prose Inference

- **Group:** Targeting
- **Meaning:** A component's TARGETING compatibility `allow` labels match the Targeting's exact canonical key or its semantic token by exact set membership (M4 SET_CONTAINS); no substring, display-name or description matching exists.
- **Guards:** `packages/prowess-game/src/targeting-golden.test.ts`, `packages/prowess-game/src/targeting-contracts.test.ts`, `apps/studio/tests/unit/m5-wo6-static.test.ts`, `scripts/m5-wo6-negative-controls.mjs`

### M5-I172 — Maneuver Targeting Conversion Is A Maneuver Effect And The Targeting Definition It References Does Not Duplicate The Effect's AP/MP Cost Or Save Profile

- **Group:** Targeting
- **Meaning:** MANEUVER_TARGETING Definitions carry no cost contributions (PROWESS_TARGETING.MANEUVER_TARGETING_COST) and no Save Profile (TARGETING_IMPLIES_OUTCOME). The Conversion Effect (M5-WO7) owns conversion, Save Profile, cost and slot.
- **Guards:** `packages/prowess-game/src/targeting-golden.test.ts`, `packages/prowess-game/src/targeting-contracts.test.ts`, `apps/studio/tests/unit/m5-wo6-static.test.ts`, `scripts/m5-wo6-negative-controls.mjs`

### M5-I173 — Canonical Maneuver Radius Equals Martial Rank Base Times STR, With Rank Bases Five, Ten And Fifteen Feet For Trained, Expert And Master

- **Group:** Targeting
- **Meaning:** Designer ruling M5-SC-018: maneuver.targeting.radius authors the MARTIAL_RANK_BASE rank table (TRAINED 5, EXPERT 10, MASTER 15 ft, Martial Skill) and the Formula rank_base × str, executed by M4. Expert STR 5 → 50 ft; Master STR 10 → 150 ft.
- **Guards:** `packages/prowess-game/src/targeting-golden.test.ts`, `apps/studio/tests/unit/m5-wo6-static.test.ts`, `scripts/m5-wo6-negative-controls.mjs`

### M5-I174 — The Superseded Fixed Strength-Band Maneuver Radius Table Is Never Executed

- **Group:** Targeting
- **Meaning:** The s2030 bands (STR 1–3 → 5 ft, 4–6 → 10 ft, 7+ → 15 ft) appear in no executable content: Trained STR 2 → 10 ft and STR 7 → 35 ft.
- **Guards:** `packages/prowess-game/src/targeting-golden.test.ts`, `apps/studio/tests/unit/m5-wo6-static.test.ts`, `scripts/m5-wo6-negative-controls.mjs`

### M5-I175 — Spell And Maneuver Targeting Geometry Formulas Compile Through M4 Formula Operations Rather Than Hidden Prowess Compiler Or UI Arithmetic

- **Group:** Targeting
- **Meaning:** Every Targeting distance is an authored Formula program in content, validated by M4 validateFormulaProgram and executed as an M4 FORMULA step; @prowess/game and Studio contain no geometry arithmetic. M4 knows no Prowess Targeting term.
- **Guards:** `packages/prowess-game/src/targeting-golden.test.ts`, `packages/prowess-game/src/targeting-contracts.test.ts`, `apps/studio/tests/unit/m5-wo6-static.test.ts`, `scripts/m5-wo6-negative-controls.mjs`

### M5-I176 — Targeting Definitions Preserve Exact EntityVersion, Ruleset, Composition And Formula Provenance

- **Group:** Targeting
- **Meaning:** Each Targeting step's source-map entry cites the exact Targeting EntityVersion (and the BASE_RANGE statistic or Skill ladder it reads); the plan carries the exact Ruleset / Release provenance; Keyword contributions keep the Targeting's EntityVersion as their source. R1 re-evaluates identically after R2.
- **Guards:** `packages/prowess-game/src/targeting-contracts.test.ts`, `apps/studio/tests/unit/m5-wo6-static.test.ts`, `scripts/m5-wo6-negative-controls.mjs`

### M5-I177 — WO6 Targeting Evaluation Does Not Calculate Final Spell Or Maneuver Cost And Does Not Perform Runtime Resource Payment

- **Group:** Targeting
- **Meaning:** The result reports LISTED Targeting contributions (BASE, BASE_DEFERRED, PER_STEP, PER_ADDITIONAL_TARGET, PER_SELECTION) with the use's selections only — no total, no final MP / AP, no ME, no payment.
- **Guards:** `packages/prowess-game/src/targeting-contracts.test.ts`, `apps/studio/tests/unit/m5-wo6-static.test.ts`, `scripts/m5-wo6-negative-controls.mjs`

### M5-I178 — Targeting Evaluation Is Deterministic, Immutable, JSON-Safe And Free Of Global Mutable Targeting State

- **Group:** Targeting
- **Meaning:** Equal requests give deep-equal plans, runs, results and source maps; inputs are never mutated and outputs are deep-frozen; plans replay identically through M4 after a JSON round-trip; unsafe input (getters, cycles, NaN, Infinity, functions, __proto__) is refused.
- **Guards:** `packages/prowess-game/src/targeting-contracts.test.ts`, `apps/studio/tests/unit/m5-wo6-static.test.ts`, `scripts/m5-wo6-negative-controls.mjs`


### M5-I179 — Projectile Targeting Has A Listed Base Cost Of Three MP And Uses The Caster Current Applicable Range

- **Group:** Effect Framework
- **Meaning:** Projectile current canon is 3 MP and reads the existing applicable caster Range rather than hard-coding a second range formula.
- **Guards:** `packages/prowess-game/src/effect-golden.test.ts`, `packages/prowess-game/src/effect-contracts.test.ts`, `apps/studio/tests/unit/m5-wo7-static.test.ts`, `scripts/m5-wo7-negative-controls.mjs`

### M5-I180 — Projectile Requires A Ranged Attack Roll For Delivery; This Delivery Check Is Distinct From The Effect Mechanical Outcome And Any Effect-Owned Saving Throw

- **Group:** Effect Framework
- **Meaning:** Projectile owns a Ranged Attack delivery check only; Effect resolution and any Effect Save remain separate Effect data.
- **Guards:** `packages/prowess-game/src/effect-golden.test.ts`, `packages/prowess-game/src/effect-contracts.test.ts`, `apps/studio/tests/unit/m5-wo7-static.test.ts`, `scripts/m5-wo7-negative-controls.mjs`

### M5-I181 — When A Projectile-Delivered Effect Uses Attack-Roll Resolution, The Projectile Delivery Attack Is The Effect Attack And Is Never Rolled Twice

- **Group:** Effect Framework
- **Meaning:** An ATTACK_ROLL Effect delivered by Projectile reuses the delivery attack and never creates a second roll.
- **Guards:** `packages/prowess-game/src/effect-golden.test.ts`, `packages/prowess-game/src/effect-contracts.test.ts`, `apps/studio/tests/unit/m5-wo7-static.test.ts`, `scripts/m5-wo7-negative-controls.mjs`

### M5-I182 — When A Projectile-Delivered Effect Uses Saving-Throw Resolution, Successful Projectile Delivery Occurs Before The Effect-Owned Saving Throw

- **Group:** Effect Framework
- **Meaning:** A SAVING_THROW Effect delivered by Projectile resolves delivery first and the Effect-owned Save only after a hit.
- **Guards:** `packages/prowess-game/src/effect-golden.test.ts`, `packages/prowess-game/src/effect-contracts.test.ts`, `apps/studio/tests/unit/m5-wo7-static.test.ts`, `scripts/m5-wo7-negative-controls.mjs`

### M5-I183 — Canonical Spell Line Length Equals Ten Feet Times PRO

- **Group:** Effect Framework
- **Meaning:** Current Spell Line length is the M4 Formula 10 × PRO feet.
- **Guards:** `packages/prowess-game/src/effect-golden.test.ts`, `packages/prowess-game/src/effect-contracts.test.ts`, `apps/studio/tests/unit/m5-wo7-static.test.ts`, `scripts/m5-wo7-negative-controls.mjs`

### M5-I184 — Canonical Spell Line Width Equals Five Feet Times The Ceiling Of PRO Divided By Two

- **Group:** Effect Framework
- **Meaning:** Current Spell Line width is the M4 Formula 5 × ceil(PRO / 2) feet, minimum 5 feet.
- **Guards:** `packages/prowess-game/src/effect-golden.test.ts`, `packages/prowess-game/src/effect-contracts.test.ts`, `apps/studio/tests/unit/m5-wo7-static.test.ts`, `scripts/m5-wo7-negative-controls.mjs`

### M5-I185 — Effects Define What An Ability Does While Targeting Defines Delivery And Geometry; Targeting Never Owns Effect Outcomes

- **Group:** Effect Framework
- **Meaning:** Targeting owns delivery/geometry; Effect owns mechanical outcome.
- **Guards:** `packages/prowess-game/src/effect-golden.test.ts`, `packages/prowess-game/src/effect-contracts.test.ts`, `apps/studio/tests/unit/m5-wo7-static.test.ts`, `scripts/m5-wo7-negative-controls.mjs`

### M5-I186 — Saving Throw Identity And Save Profiles Are Effect-Owned Mechanics And Are Never Inferred From Targeting Geometry

- **Group:** Effect Framework
- **Meaning:** Save identity/profile belongs to Effects, never Targeting geometry.
- **Guards:** `packages/prowess-game/src/effect-golden.test.ts`, `packages/prowess-game/src/effect-contracts.test.ts`, `apps/studio/tests/unit/m5-wo7-static.test.ts`, `scripts/m5-wo7-negative-controls.mjs`

### M5-I187 — SPELL_EFFECT And MANEUVER_EFFECT Are Separate Exact Definition Families That Share A Structural Effect Contract But Are Never Interchangeable

- **Group:** Effect Framework
- **Meaning:** Spell and Maneuver Effect Definition families share structure but cannot cross branches.
- **Guards:** `packages/prowess-game/src/effect-golden.test.ts`, `packages/prowess-game/src/effect-contracts.test.ts`, `apps/studio/tests/unit/m5-wo7-static.test.ts`, `scripts/m5-wo7-negative-controls.mjs`

### M5-I188 — The Seven Canonical Top-Level Spell Effect Families Are Damage, Healing, Buff, Debuff, Control, Utility And Summoning

- **Group:** Effect Framework
- **Meaning:** Only Damage, Healing, Buff, Debuff, Control, Utility and Summoning are top-level Spell Effect families.
- **Guards:** `packages/prowess-game/src/effect-golden.test.ts`, `packages/prowess-game/src/effect-contracts.test.ts`, `apps/studio/tests/unit/m5-wo7-static.test.ts`, `scripts/m5-wo7-negative-controls.mjs`

### M5-I189 — Cleanse Is A Healing Subfamily And Movement Is A Utility Subfamily; Neither Is A Separate Top-Level Spell Effect Family

- **Group:** Effect Framework
- **Meaning:** Cleanse is HEALING/CLEANSE and Movement is UTILITY/MOVEMENT.
- **Guards:** `packages/prowess-game/src/effect-golden.test.ts`, `packages/prowess-game/src/effect-contracts.test.ts`, `apps/studio/tests/unit/m5-wo7-static.test.ts`, `scripts/m5-wo7-negative-controls.mjs`

### M5-I190 — Spell Interference Is A Utility Mechanic Rather Than A Top-Level Spell Effect Family

- **Group:** Effect Framework
- **Meaning:** Counterspell/Dispel-style Spell Interference is a Utility mechanic, not a top-level family.
- **Guards:** `packages/prowess-game/src/effect-golden.test.ts`, `packages/prowess-game/src/effect-contracts.test.ts`, `apps/studio/tests/unit/m5-wo7-static.test.ts`, `scripts/m5-wo7-negative-controls.mjs`

### M5-I191 — An Executable Canonical Spell Effect Must Explicitly Define Its Resolution Mode And Mechanical Outcome Metadata

- **Group:** Effect Framework
- **Meaning:** Executable Spell Effects author an explicit resolution and structured outcomes.
- **Guards:** `packages/prowess-game/src/effect-golden.test.ts`, `packages/prowess-game/src/effect-contracts.test.ts`, `apps/studio/tests/unit/m5-wo7-static.test.ts`, `scripts/m5-wo7-negative-controls.mjs`

### M5-I192 — A Maneuver Effect May Inherit The Maneuver Existing Resolution Only Through An Explicit Inherit-Ability Resolution Policy

- **Group:** Effect Framework
- **Meaning:** Null Maneuver Effect resolution means inheritance only when INHERIT_ABILITY is explicitly authored.
- **Guards:** `packages/prowess-game/src/effect-golden.test.ts`, `packages/prowess-game/src/effect-contracts.test.ts`, `apps/studio/tests/unit/m5-wo7-static.test.ts`, `scripts/m5-wo7-negative-controls.mjs`

### M5-I193 — Effect Saving-Throw Resolution Carries An Exact Authored Save Profile Or Exact Save-Selection Rule

- **Group:** Effect Framework
- **Meaning:** Saving-throw Effects author exact valid Saves and selection policy.
- **Guards:** `packages/prowess-game/src/effect-golden.test.ts`, `packages/prowess-game/src/effect-contracts.test.ts`, `apps/studio/tests/unit/m5-wo7-static.test.ts`, `scripts/m5-wo7-negative-controls.mjs`

### M5-I194 — Effect Targeting Compatibility Uses Exact Structured Identity Or Explicit Semantic Compatibility And Never Fuzzy Text Matching

- **Group:** Effect Framework
- **Meaning:** Effect/Targeting compatibility uses exact identity/semantic tokens, never fuzzy text.
- **Guards:** `packages/prowess-game/src/effect-golden.test.ts`, `packages/prowess-game/src/effect-contracts.test.ts`, `apps/studio/tests/unit/m5-wo7-static.test.ts`, `scripts/m5-wo7-negative-controls.mjs`

### M5-I195 — Damage And Healing Character Dice Limits Apply Per Effect And Normally Cannot Exceed The Caster PRO

- **Group:** Effect Framework
- **Meaning:** Damage/Healing Character Dice selection is checked against PRO independently per Effect.
- **Guards:** `packages/prowess-game/src/effect-golden.test.ts`, `packages/prowess-game/src/effect-contracts.test.ts`, `apps/studio/tests/unit/m5-wo7-static.test.ts`, `scripts/m5-wo7-negative-controls.mjs`

### M5-I196 — Effects Never Gain Secondary Mechanical Outcomes Merely From Flavor, Damage Type, Keywords Or Display Text

- **Group:** Effect Framework
- **Meaning:** Flavor, damage type and Keywords never create unauthored secondary mechanics.
- **Guards:** `packages/prowess-game/src/effect-golden.test.ts`, `packages/prowess-game/src/effect-contracts.test.ts`, `apps/studio/tests/unit/m5-wo7-static.test.ts`, `scripts/m5-wo7-negative-controls.mjs`

### M5-I197 — Effect Scaling Is Available Only Through Explicit Structured Scaling Rules And Parameters

- **Group:** Effect Framework
- **Meaning:** Only explicit parameters/formulas expose Effect scaling.
- **Guards:** `packages/prowess-game/src/effect-golden.test.ts`, `packages/prowess-game/src/effect-contracts.test.ts`, `apps/studio/tests/unit/m5-wo7-static.test.ts`, `scripts/m5-wo7-negative-controls.mjs`

### M5-I198 — Effect Listed AP And MP Contributions Are Construction Costs And Never Runtime Resource Payment

- **Group:** Effect Framework
- **Meaning:** Effect AP/MP values are listed construction contributions, not runtime payment.
- **Guards:** `packages/prowess-game/src/effect-golden.test.ts`, `packages/prowess-game/src/effect-contracts.test.ts`, `apps/studio/tests/unit/m5-wo7-static.test.ts`, `scripts/m5-wo7-negative-controls.mjs`

### M5-I199 — Mana Efficiency Never Changes An Effect Listed MP Cost

- **Group:** Effect Framework
- **Meaning:** ME is payment-time state and never rewrites listed Effect MP.
- **Guards:** `packages/prowess-game/src/effect-golden.test.ts`, `packages/prowess-game/src/effect-contracts.test.ts`, `apps/studio/tests/unit/m5-wo7-static.test.ts`, `scripts/m5-wo7-negative-controls.mjs`

### M5-I200 — Effect Access And Prerequisites Reuse The Existing Structured Ability Construction Requirement System

- **Group:** Effect Framework
- **Meaning:** Effect access compiles through existing structured Ability Construction requirements.
- **Guards:** `packages/prowess-game/src/effect-golden.test.ts`, `packages/prowess-game/src/effect-contracts.test.ts`, `apps/studio/tests/unit/m5-wo7-static.test.ts`, `scripts/m5-wo7-negative-controls.mjs`

### M5-I201 — Effect Stackability And Stack Limits Reuse WO5 Explicit Definition-Owned Stack Contract

- **Group:** Effect Framework
- **Meaning:** Effect stackability/limits reuse the WO5 Definition-owned stack contract.
- **Guards:** `packages/prowess-game/src/effect-golden.test.ts`, `packages/prowess-game/src/effect-contracts.test.ts`, `apps/studio/tests/unit/m5-wo7-static.test.ts`, `scripts/m5-wo7-negative-controls.mjs`

### M5-I202 — Effect Duration Metadata Describes Compatibility And Defaults; The Ability Actual Duration Remains A Separate Component

- **Group:** Effect Framework
- **Meaning:** Effect Duration data is compatibility/default metadata; composition owns actual Duration.
- **Guards:** `packages/prowess-game/src/effect-golden.test.ts`, `packages/prowess-game/src/effect-contracts.test.ts`, `apps/studio/tests/unit/m5-wo7-static.test.ts`, `scripts/m5-wo7-negative-controls.mjs`

### M5-I203 — Maneuver Targeting Conversion Is Owned By MANEUVER_EFFECT Definitions That Carry The Conversion Cost, Save Profile And Destination Targeting Reference

- **Group:** Effect Framework
- **Meaning:** Maneuver Targeting Conversion Effects own conversion cost, Save Profile and exact destination Targeting ref.
- **Guards:** `packages/prowess-game/src/effect-golden.test.ts`, `packages/prowess-game/src/effect-contracts.test.ts`, `apps/studio/tests/unit/m5-wo7-static.test.ts`, `scripts/m5-wo7-negative-controls.mjs`

### M5-I204 — Maneuver Targeting Definitions Never Duplicate Conversion Effect Costs Or Save Profiles

- **Group:** Effect Framework
- **Meaning:** Destination Maneuver Targeting Definitions do not duplicate conversion cost/Save.
- **Guards:** `packages/prowess-game/src/effect-golden.test.ts`, `packages/prowess-game/src/effect-contracts.test.ts`, `apps/studio/tests/unit/m5-wo7-static.test.ts`, `scripts/m5-wo7-negative-controls.mjs`

### M5-I205 — Elemental Damage Conversion Changes Damage Type Only And Never Applies Unauthored Secondary Conditions

- **Group:** Effect Framework
- **Meaning:** Elemental conversion changes damage type only and creates no implicit Condition.
- **Guards:** `packages/prowess-game/src/effect-golden.test.ts`, `packages/prowess-game/src/effect-contracts.test.ts`, `apps/studio/tests/unit/m5-wo7-static.test.ts`, `scripts/m5-wo7-negative-controls.mjs`

### M5-I206 — Maneuver Damage Normally Comes From Its Foundation Or Weapon Unless An Exact Maneuver Effect Explicitly Replaces That Source

- **Group:** Effect Framework
- **Meaning:** Maneuver Foundation/weapon remains the damage source unless an exact Effect replaces it.
- **Guards:** `packages/prowess-game/src/effect-golden.test.ts`, `packages/prowess-game/src/effect-contracts.test.ts`, `apps/studio/tests/unit/m5-wo7-static.test.ts`, `scripts/m5-wo7-negative-controls.mjs`

### M5-I207 — Spell And Maneuver Effect Cost Contributions Are Not Combined Into Final Ability Cost During WO7

- **Group:** Effect Framework
- **Meaning:** WO7 never assembles complete Spell or Maneuver cost.
- **Guards:** `packages/prowess-game/src/effect-golden.test.ts`, `packages/prowess-game/src/effect-contracts.test.ts`, `apps/studio/tests/unit/m5-wo7-static.test.ts`, `scripts/m5-wo7-negative-controls.mjs`

### M5-I208 — WO7 Does Not Execute Effect Chains, Runtime Damage, Healing, Conditions, Movement Or Resource Mutation

- **Group:** Effect Framework
- **Meaning:** WO7 validates/compiles Effect metadata only; no chain or runtime state mutation occurs.
- **Guards:** `packages/prowess-game/src/effect-golden.test.ts`, `packages/prowess-game/src/effect-contracts.test.ts`, `apps/studio/tests/unit/m5-wo7-static.test.ts`, `scripts/m5-wo7-negative-controls.mjs`

### M5-I209 — Effect Definitions Preserve Exact EntityVersion, Ruleset, Compatibility, Access, Keyword And Cost Provenance

- **Group:** Effect Framework
- **Meaning:** Effect evaluation pins exact EntityVersion, Ruleset, compatibility, access, Keywords and listed costs.
- **Guards:** `packages/prowess-game/src/effect-golden.test.ts`, `packages/prowess-game/src/effect-contracts.test.ts`, `apps/studio/tests/unit/m5-wo7-static.test.ts`, `scripts/m5-wo7-negative-controls.mjs`

### M5-I210 — Historical Effect Evaluation Never Resolves Through Latest Or Current Content

- **Group:** Effect Framework
- **Meaning:** Historical Effect evaluation never resolves through newest/current content.
- **Guards:** `packages/prowess-game/src/effect-golden.test.ts`, `packages/prowess-game/src/effect-contracts.test.ts`, `apps/studio/tests/unit/m5-wo7-static.test.ts`, `scripts/m5-wo7-negative-controls.mjs`

### M5-I211 — Effect Validation And Compilation Use Existing M4 Formula, Requirement And Keyword Primitives Rather Than Reimplementing Generic Rule Evaluation

- **Group:** Effect Framework
- **Meaning:** Effect rules compile into existing generic M4 Formula, Requirement and Keyword primitives.
- **Guards:** `packages/prowess-game/src/effect-golden.test.ts`, `packages/prowess-game/src/effect-contracts.test.ts`, `apps/studio/tests/unit/m5-wo7-static.test.ts`, `scripts/m5-wo7-negative-controls.mjs`

### M5-I212 — Effect Evaluation Is Deterministic, Immutable, JSON-Safe And Free Of Global Mutable Effect State

- **Group:** Effect Framework
- **Meaning:** Equal exact inputs are deterministic; inputs remain immutable; public contracts are JSON-safe and no global Effect state exists.
- **Guards:** `packages/prowess-game/src/effect-golden.test.ts`, `packages/prowess-game/src/effect-contracts.test.ts`, `apps/studio/tests/unit/m5-wo7-static.test.ts`, `scripts/m5-wo7-negative-controls.mjs`

### M5-I213 — Traits Are Exact Versioned Definitions With Explicit Shared Spell Or Maneuver Applicability

- **Group:** Traits and authored abilities
- **Meaning:** Traits Are Exact Versioned Definitions With Explicit Shared Spell Or Maneuver Applicability.
- **Guards:** `packages/prowess-game/src/ability-definitions.test.ts`, `packages/prowess-game/src/ability-negative.test.ts`, `packages/prowess-game/src/ability-security.test.ts`, `packages/prowess-game/src/trait-contracts.test.ts`, `apps/studio/tests/unit/m5-wo8-static.test.ts`, `scripts/m5-wo8-negative-controls.mjs`

### M5-I214 — Trait Scope Selects The Ability An Effect Targeting Or A Resolution Explicitly

- **Group:** Traits and authored abilities
- **Meaning:** Trait Scope Selects The Ability An Effect Targeting Or A Resolution Explicitly.
- **Guards:** `packages/prowess-game/src/ability-definitions.test.ts`, `packages/prowess-game/src/ability-negative.test.ts`, `packages/prowess-game/src/ability-security.test.ts`, `packages/prowess-game/src/trait-contracts.test.ts`, `apps/studio/tests/unit/m5-wo8-static.test.ts`, `scripts/m5-wo8-negative-controls.mjs`

### M5-I215 — Trait Parameters Reuse Typed M5 Schemas And Reject Unknown Unsafe Or Invalid Selections

- **Group:** Traits and authored abilities
- **Meaning:** Trait Parameters Reuse Typed M5 Schemas And Reject Unknown Unsafe Or Invalid Selections.
- **Guards:** `packages/prowess-game/src/ability-definitions.test.ts`, `packages/prowess-game/src/ability-negative.test.ts`, `packages/prowess-game/src/ability-security.test.ts`, `packages/prowess-game/src/trait-contracts.test.ts`, `apps/studio/tests/unit/m5-wo8-static.test.ts`, `scripts/m5-wo8-negative-controls.mjs`

### M5-I216 — Trait Access Reuses Construction Requirements And Affinity Strength Keywords

- **Group:** Traits and authored abilities
- **Meaning:** Trait Access Reuses Construction Requirements And Affinity Strength Keywords.
- **Guards:** `packages/prowess-game/src/ability-definitions.test.ts`, `packages/prowess-game/src/ability-negative.test.ts`, `packages/prowess-game/src/ability-security.test.ts`, `packages/prowess-game/src/trait-contracts.test.ts`, `apps/studio/tests/unit/m5-wo8-static.test.ts`, `scripts/m5-wo8-negative-controls.mjs`

### M5-I217 — Trait Modifications Cannot Smuggle Independent Effect Outcomes

- **Group:** Traits and authored abilities
- **Meaning:** Trait Modifications Cannot Smuggle Independent Effect Outcomes.
- **Guards:** `packages/prowess-game/src/ability-definitions.test.ts`, `packages/prowess-game/src/ability-negative.test.ts`, `packages/prowess-game/src/ability-security.test.ts`, `packages/prowess-game/src/trait-contracts.test.ts`, `apps/studio/tests/unit/m5-wo8-static.test.ts`, `scripts/m5-wo8-negative-controls.mjs`

### M5-I218 — Normal Spell Trait Capacity Preserves Approved Exchanges And Additional Affinity Capacity Is Separate

- **Group:** Traits and authored abilities
- **Meaning:** Normal Spell Trait Capacity Preserves Approved Exchanges And Additional Affinity Capacity Is Separate.
- **Guards:** `packages/prowess-game/src/ability-definitions.test.ts`, `packages/prowess-game/src/ability-negative.test.ts`, `packages/prowess-game/src/ability-security.test.ts`, `packages/prowess-game/src/trait-contracts.test.ts`, `apps/studio/tests/unit/m5-wo8-static.test.ts`, `scripts/m5-wo8-negative-controls.mjs`

### M5-I219 — Authored Spells Preserve One Targeting Ordered Effects Explicit Authority And Structural Duration

- **Group:** Traits and authored abilities
- **Meaning:** Authored Spells Preserve One Targeting Ordered Effects Explicit Authority And Structural Duration.
- **Guards:** `packages/prowess-game/src/ability-definitions.test.ts`, `packages/prowess-game/src/ability-negative.test.ts`, `packages/prowess-game/src/ability-security.test.ts`, `packages/prowess-game/src/trait-contracts.test.ts`, `apps/studio/tests/unit/m5-wo8-static.test.ts`, `scripts/m5-wo8-negative-controls.mjs`

### M5-I220 — Authored Maneuvers Inherit Attack Profiles And Check Every Committed Action

- **Group:** Traits and authored abilities
- **Meaning:** Authored Maneuvers Inherit Attack Profiles And Check Every Committed Action.
- **Guards:** `packages/prowess-game/src/ability-definitions.test.ts`, `packages/prowess-game/src/ability-negative.test.ts`, `packages/prowess-game/src/ability-security.test.ts`, `packages/prowess-game/src/trait-contracts.test.ts`, `apps/studio/tests/unit/m5-wo8-static.test.ts`, `scripts/m5-wo8-negative-controls.mjs`

### M5-I221 — Maneuver Effects Retain Martial Capacity And Explicit Skill Requirements

- **Group:** Traits and authored abilities
- **Meaning:** Maneuver Effects Retain Martial Capacity And Explicit Skill Requirements.
- **Guards:** `packages/prowess-game/src/ability-definitions.test.ts`, `packages/prowess-game/src/ability-negative.test.ts`, `packages/prowess-game/src/ability-security.test.ts`, `packages/prowess-game/src/trait-contracts.test.ts`, `apps/studio/tests/unit/m5-wo8-static.test.ts`, `scripts/m5-wo8-negative-controls.mjs`

### M5-I222 — Powerful Blow Is An Authored Action Group With Attached Effects Resolving Once

- **Group:** Traits and authored abilities
- **Meaning:** Powerful Blow Is An Authored Action Group With Attached Effects Resolving Once.
- **Guards:** `packages/prowess-game/src/ability-definitions.test.ts`, `packages/prowess-game/src/ability-negative.test.ts`, `packages/prowess-game/src/ability-security.test.ts`, `packages/prowess-game/src/trait-contracts.test.ts`, `apps/studio/tests/unit/m5-wo8-static.test.ts`, `scripts/m5-wo8-negative-controls.mjs`

### M5-I223 — Authored Ability Plans And Inspector Sources Preserve Exact Ruleset And Historical Definition Pins

- **Group:** Traits and authored abilities
- **Meaning:** Authored Ability Plans And Inspector Sources Preserve Exact Ruleset And Historical Definition Pins.
- **Guards:** `packages/prowess-game/src/ability-definitions.test.ts`, `packages/prowess-game/src/ability-negative.test.ts`, `packages/prowess-game/src/ability-security.test.ts`, `packages/prowess-game/src/trait-contracts.test.ts`, `apps/studio/tests/unit/m5-wo8-static.test.ts`, `scripts/m5-wo8-negative-controls.mjs`

### M5-I224 — WO8 Is Deterministic Immutable JSON Safe And Does Not Execute Combat State

- **Group:** Traits and authored abilities
- **Meaning:** WO8 Is Deterministic Immutable JSON Safe And Does Not Execute Combat State.
- **Guards:** `packages/prowess-game/src/ability-definitions.test.ts`, `packages/prowess-game/src/ability-negative.test.ts`, `packages/prowess-game/src/ability-security.test.ts`, `packages/prowess-game/src/trait-contracts.test.ts`, `apps/studio/tests/unit/m5-wo8-static.test.ts`, `scripts/m5-wo8-negative-controls.mjs`

### M5-I225 — Duration Is A First-Class Exact Versioned Ability Component And Never An Unversioned String

- **Group:** Duration and Ability Conditions
- **Meaning:** Duration Is A First-Class Exact Versioned Ability Component And Never An Unversioned String.
- **Guards:** `packages/prowess-game/src/duration-condition.test.ts`, `packages/prowess-game/src/duration-condition-negative.test.ts`, `apps/studio/tests/unit/m5-wo9-static.test.ts`, `scripts/m5-wo9-negative-controls.mjs`

### M5-I226 — Spell And Maneuver Duration Share The DURATION Contract But Remain Branch-Specific Definition Families

- **Group:** Duration and Ability Conditions
- **Meaning:** Spell And Maneuver Duration Share The DURATION Contract But Remain Branch-Specific Definition Families.
- **Guards:** `packages/prowess-game/src/duration-condition.test.ts`, `packages/prowess-game/src/duration-condition-negative.test.ts`, `apps/studio/tests/unit/m5-wo9-static.test.ts`, `scripts/m5-wo9-negative-controls.mjs`

### M5-I227 — A Spell Has Exactly One Legal Duration Selection And ROUNDS Requires A Positive Whole-Number Count

- **Group:** Duration and Ability Conditions
- **Meaning:** A Spell Has Exactly One Legal Duration Selection And ROUNDS Requires A Positive Whole-Number Count.
- **Guards:** `packages/prowess-game/src/duration-condition.test.ts`, `packages/prowess-game/src/duration-condition-negative.test.ts`, `apps/studio/tests/unit/m5-wo9-static.test.ts`, `scripts/m5-wo9-negative-controls.mjs`

### M5-I228 — Duration Compatibility Reuses Exact Effect And Trait Metadata Rather Than Inferring Legality From Prose

- **Group:** Duration and Ability Conditions
- **Meaning:** Duration Compatibility Reuses Exact Effect And Trait Metadata Rather Than Inferring Legality From Prose.
- **Guards:** `packages/prowess-game/src/duration-condition.test.ts`, `packages/prowess-game/src/duration-condition-negative.test.ts`, `apps/studio/tests/unit/m5-wo9-static.test.ts`, `scripts/m5-wo9-negative-controls.mjs`

### M5-I229 — Duration Cost Contributions Remain Listed Component Costs Until WO10 Or WO11 Performs Final Cost Calculation

- **Group:** Duration and Ability Conditions
- **Meaning:** Duration Cost Contributions Remain Listed Component Costs Until WO10 Or WO11 Performs Final Cost Calculation.
- **Guards:** `packages/prowess-game/src/duration-condition.test.ts`, `packages/prowess-game/src/duration-condition-negative.test.ts`, `apps/studio/tests/unit/m5-wo9-static.test.ts`, `scripts/m5-wo9-negative-controls.mjs`

### M5-I230 — WO9 Does Not Execute Sustain, Mana Lock, Concentration Or Active-Effect Runtime State

- **Group:** Duration and Ability Conditions
- **Meaning:** WO9 Does Not Execute Sustain, Mana Lock, Concentration Or Active-Effect Runtime State.
- **Guards:** `packages/prowess-game/src/duration-condition.test.ts`, `packages/prowess-game/src/duration-condition-negative.test.ts`, `apps/studio/tests/unit/m5-wo9-static.test.ts`, `scripts/m5-wo9-negative-controls.mjs`

### M5-I231 — Ability Conditions Are Construction Restrictions And Never Implicitly Become Status Conditions

- **Group:** Duration and Ability Conditions
- **Meaning:** Ability Conditions Are Construction Restrictions And Never Implicitly Become Status Conditions.
- **Guards:** `packages/prowess-game/src/duration-condition.test.ts`, `packages/prowess-game/src/duration-condition-negative.test.ts`, `apps/studio/tests/unit/m5-wo9-static.test.ts`, `scripts/m5-wo9-negative-controls.mjs`

### M5-I232 — Spell Casting Conditions Are Exact Versioned Components With Structured Requirements And Listed Modifiers

- **Group:** Duration and Ability Conditions
- **Meaning:** Spell Casting Conditions Are Exact Versioned Components With Structured Requirements And Listed Modifiers.
- **Guards:** `packages/prowess-game/src/duration-condition.test.ts`, `packages/prowess-game/src/duration-condition-negative.test.ts`, `apps/studio/tests/unit/m5-wo9-static.test.ts`, `scripts/m5-wo9-negative-controls.mjs`

### M5-I233 — A Spell Casting Condition Is Legal Only When Its Structured Requirement Matches A Mechanic Actually Present In The Spell

- **Group:** Duration and Ability Conditions
- **Meaning:** A Spell Casting Condition Is Legal Only When Its Structured Requirement Matches A Mechanic Actually Present In The Spell.
- **Guards:** `packages/prowess-game/src/duration-condition.test.ts`, `packages/prowess-game/src/duration-condition-negative.test.ts`, `apps/studio/tests/unit/m5-wo9-static.test.ts`, `scripts/m5-wo9-negative-controls.mjs`

### M5-I234 — Total Spell Casting Condition MP Reduction Is Capped At Thirty Percent Independently Of Casting Condition Slot Capacity

- **Group:** Duration and Ability Conditions
- **Meaning:** Total Spell Casting Condition MP Reduction Is Capped At Thirty Percent Independently Of Casting Condition Slot Capacity.
- **Guards:** `packages/prowess-game/src/duration-condition.test.ts`, `packages/prowess-game/src/duration-condition-negative.test.ts`, `apps/studio/tests/unit/m5-wo9-static.test.ts`, `scripts/m5-wo9-negative-controls.mjs`

### M5-I235 — WO9 Exposes Casting Condition Modifier Contributions But Never Applies Them To Final Spell MP Or AP

- **Group:** Duration and Ability Conditions
- **Meaning:** WO9 Exposes Casting Condition Modifier Contributions But Never Applies Them To Final Spell MP Or AP.
- **Guards:** `packages/prowess-game/src/duration-condition.test.ts`, `packages/prowess-game/src/duration-condition-negative.test.ts`, `apps/studio/tests/unit/m5-wo9-static.test.ts`, `scripts/m5-wo9-negative-controls.mjs`

### M5-I236 — Maneuver Conditions Are Exact Versioned Components With Structured Requirements And Explicit Cost-Reduction Choices

- **Group:** Duration and Ability Conditions
- **Meaning:** Maneuver Conditions Are Exact Versioned Components With Structured Requirements And Explicit Cost-Reduction Choices.
- **Guards:** `packages/prowess-game/src/duration-condition.test.ts`, `packages/prowess-game/src/duration-condition-negative.test.ts`, `apps/studio/tests/unit/m5-wo9-static.test.ts`, `scripts/m5-wo9-negative-controls.mjs`

### M5-I237 — Total Maneuver Condition AP Reduction Cannot Exceed Three AP

- **Group:** Duration and Ability Conditions
- **Meaning:** Total Maneuver Condition AP Reduction Cannot Exceed Three AP.
- **Guards:** `packages/prowess-game/src/duration-condition.test.ts`, `packages/prowess-game/src/duration-condition-negative.test.ts`, `apps/studio/tests/unit/m5-wo9-static.test.ts`, `scripts/m5-wo9-negative-controls.mjs`

### M5-I238 — A Maneuver Condition Offering AP Or MP Reduction Requires An Explicit Authored Selection And Never Applies Both Automatically

- **Group:** Duration and Ability Conditions
- **Meaning:** A Maneuver Condition Offering AP Or MP Reduction Requires An Explicit Authored Selection And Never Applies Both Automatically.
- **Guards:** `packages/prowess-game/src/duration-condition.test.ts`, `packages/prowess-game/src/duration-condition-negative.test.ts`, `apps/studio/tests/unit/m5-wo9-static.test.ts`, `scripts/m5-wo9-negative-controls.mjs`

### M5-I239 — Source Ranges And GM-Set Condition Benefits Never Become Guessed Executable Values

- **Group:** Duration and Ability Conditions
- **Meaning:** Source Ranges And GM-Set Condition Benefits Never Become Guessed Executable Values.
- **Guards:** `packages/prowess-game/src/duration-condition.test.ts`, `packages/prowess-game/src/duration-condition-negative.test.ts`, `apps/studio/tests/unit/m5-wo9-static.test.ts`, `scripts/m5-wo9-negative-controls.mjs`

### M5-I240 — Duration And Ability Condition Evaluation Is Exact-Ruleset And Historically Reproducible

- **Group:** Duration and Ability Conditions
- **Meaning:** Duration And Ability Condition Evaluation Is Exact-Ruleset And Historically Reproducible.
- **Guards:** `packages/prowess-game/src/duration-condition.test.ts`, `packages/prowess-game/src/duration-condition-negative.test.ts`, `apps/studio/tests/unit/m5-wo9-static.test.ts`, `scripts/m5-wo9-negative-controls.mjs`

### M5-I241 — WO9 Is Deterministic Immutable JSON-Safe And Does Not Execute Final Ability Cost Or Combat Runtime

- **Group:** Duration and Ability Conditions
- **Meaning:** WO9 Is Deterministic Immutable JSON-Safe And Does Not Execute Final Ability Cost Or Combat Runtime.
- **Guards:** `packages/prowess-game/src/duration-condition.test.ts`, `packages/prowess-game/src/duration-condition-negative.test.ts`, `apps/studio/tests/unit/m5-wo9-static.test.ts`, `scripts/m5-wo9-negative-controls.mjs`

### M5-I242 — M5-SC-042 Remains Explicitly Unresolved And WO9 Does Not Infer Additional Affinity Trait Capacity

- **Group:** Duration and Ability Conditions
- **Meaning:** M5-SC-042 Remains Explicitly Unresolved And WO9 Does Not Infer Additional Affinity Trait Capacity.
- **Guards:** `packages/prowess-game/src/duration-condition.test.ts`, `packages/prowess-game/src/duration-condition-negative.test.ts`, `apps/studio/tests/unit/m5-wo9-static.test.ts`, `scripts/m5-wo9-negative-controls.mjs`

### M5-I243 — Final Spell Cost Is Derived Only From Exact Structured Spell Components And Explicit Cost Modifiers

- **Group:** Final Spell Cost
- **Meaning:** compileSpellCost composes the canonical authored Ability plan and consumes only typed WO4/WO6/WO7/WO8/WO9 outputs; no executable cost originates in prose.
- **Guards:** `packages/prowess-game/src/spell-cost-golden.test.ts`, `packages/prowess-game/src/spell-cost-contracts.test.ts`, `apps/studio/tests/unit/m5-wo10-static.test.ts`, `scripts/m5-wo10-negative-controls.mjs`

### M5-I244 — Final Spell Base MP Is The Sum Of Exact Targeting, Effect, Trait, Duration And Authorized Flat Special Contributions

- **Group:** Final Spell Cost
- **Meaning:** One M4 MODIFIER adds every listed MP contribution (each an M4 FORMULA over its exact Definition) and subtracts exact flat reductions.
- **Guards:** `packages/prowess-game/src/spell-cost-golden.test.ts`, `apps/studio/tests/unit/m5-wo10-static.test.ts`, `scripts/m5-wo10-negative-controls.mjs`

### M5-I245 — Percentage Spell Cost Modifiers Are Combined Into One Net Percentage And Applied Exactly Once

- **Group:** Final Spell Cost
- **Meaning:** One M4 MODIFIER builds 100 − Strength + Weakness − effective Conditions; one FORMULA applies base × net ÷ 100 (M5-SC-028).
- **Guards:** `packages/prowess-game/src/spell-cost-golden.test.ts`, `apps/studio/tests/unit/m5-wo10-static.test.ts`, `scripts/m5-wo10-negative-controls.mjs`

### M5-I246 — Affinity Strength And Weakness Evaluation Is Reused From WO4 And Never Reimplemented By The Spell Cost Compiler

- **Group:** Final Spell Cost
- **Meaning:** The WO4 SPELL_AFFINITY_COST stages are compiled by compileAffinity and their modifiers re-hosted verbatim; the WO4 listed-cost and net steps are never included, so Affinity is consumed exactly once.
- **Guards:** `packages/prowess-game/src/spell-cost-golden.test.ts`, `apps/studio/tests/unit/m5-wo10-static.test.ts`, `scripts/m5-wo10-negative-controls.mjs`

### M5-I247 — The WO9 Effective Casting Condition Reduction, Capped At Thirty Percent, Is The Only Casting Condition Percentage Consumed By Final Spell Cost

- **Group:** Final Spell Cost
- **Meaning:** The net percentage binds the WO9 spellMpPercent effective step (min(listed, 30)); listed 45% is consumed as 30%.
- **Guards:** `packages/prowess-game/src/spell-cost-golden.test.ts`, `apps/studio/tests/unit/m5-wo10-static.test.ts`, `scripts/m5-wo10-negative-controls.mjs`

### M5-I248 — Final Spell MP Is Rounded Normally Exactly Once At The End Of The MP Construction Pipeline

- **Group:** Final Spell Cost
- **Meaning:** floor(unrounded + 0.5) in the single spell-final-mp-rounding FORMULA; 13.5 → 14.
- **Guards:** `packages/prowess-game/src/spell-cost-golden.test.ts`, `apps/studio/tests/unit/m5-wo10-static.test.ts`, `scripts/m5-wo10-negative-controls.mjs`

### M5-I249 — No Individual Component, Affinity Stage Or Casting Condition Stage Performs Intermediate MP Rounding

- **Group:** Final Spell Cost
- **Meaning:** Every other WO10 FORMULA rounds NONE and only the final MP and base AP programs call floor.
- **Guards:** `packages/prowess-game/src/spell-cost-golden.test.ts`, `apps/studio/tests/unit/m5-wo10-static.test.ts`, `scripts/m5-wo10-negative-controls.mjs`

### M5-I250 — Final Spell AP Is Derived From Final MP Divided By PRO And Rounded Down With A Minimum Base Cost Of One AP

- **Group:** Final Spell Cost
- **Meaning:** max(1, floor(final MP ÷ PRO)) bound only to the final MP step; PRO is the caster's exact, positive Prowess Score.
- **Guards:** `packages/prowess-game/src/spell-cost-golden.test.ts`, `packages/prowess-game/src/spell-cost-contracts.test.ts`, `apps/studio/tests/unit/m5-wo10-static.test.ts`, `scripts/m5-wo10-negative-controls.mjs`

### M5-I251 — Explicit Spell AP Modifiers Apply Only After Base AP Derivation

- **Group:** Final Spell Cost
- **Meaning:** Somatic (−1), Charge (+N) and other exact AP contributions modify the base AP in a later M4 MODIFIER.
- **Guards:** `packages/prowess-game/src/spell-cost-golden.test.ts`, `apps/studio/tests/unit/m5-wo10-static.test.ts`, `scripts/m5-wo10-negative-controls.mjs`

### M5-I252 — Final Spell AP Cannot Be Reduced Below One And Has No Implicit Maximum Of Three

- **Group:** Final Spell Cost
- **Meaning:** A final MAX 1 modifier; no upper bound (36 MP at PRO 5 → 7 AP).
- **Guards:** `packages/prowess-game/src/spell-cost-golden.test.ts`, `apps/studio/tests/unit/m5-wo10-static.test.ts`, `scripts/m5-wo10-negative-controls.mjs`

### M5-I253 — Mana Efficiency Is Payment Capacity And Never Reduces Final Spell MP Cost

- **Group:** Final Spell Cost
- **Meaning:** No ME input exists in the Spell cost contract; an ME character field is refused.
- **Guards:** `packages/prowess-game/src/spell-cost-contracts.test.ts`, `apps/studio/tests/unit/m5-wo10-static.test.ts`, `scripts/m5-wo10-negative-controls.mjs`

### M5-I254 — WO10 Performs No MP, ME, AP Or Other Runtime Resource Mutation

- **Group:** Final Spell Cost
- **Meaning:** Only FORMULA / MODIFIER / REQUIREMENT / KEYWORD / EXPLANATION steps; DB evaluation leaves every table unchanged.
- **Guards:** `packages/prowess-game/src/spell-cost-contracts.test.ts`, `packages/prowess-db/tests/integration/prowess-spell-cost-history.test.ts`, `apps/studio/tests/unit/m5-wo10-static.test.ts`, `scripts/m5-wo10-negative-controls.mjs`

### M5-I255 — WO10 Does Not Execute Channeling, Sustain, Mana Lock Lifecycle, Concentration Or Active Effects

- **Group:** Final Spell Cost
- **Meaning:** The final AP may exceed 3 and is only reported; WO13 owns maintenance and Channeling runtime.
- **Guards:** `packages/prowess-game/src/spell-cost-contracts.test.ts`, `apps/studio/tests/unit/m5-wo10-static.test.ts`, `scripts/m5-wo10-negative-controls.mjs`

### M5-I256 — WO10 Does Not Calculate Final Maneuver Cost Or Execute Effect Chains

- **Group:** Final Spell Cost
- **Meaning:** A Maneuver Definition is refused with PROWESS_SPELL_COST.SPELL_ONLY; Effect Chains remain WO12.
- **Guards:** `packages/prowess-game/src/spell-cost-contracts.test.ts`, `apps/studio/tests/unit/m5-wo10-static.test.ts`, `scripts/m5-wo10-negative-controls.mjs`

### M5-I257 — Every Final Spell Cost Contribution Preserves Exact Definition, Component, Ruleset And Evaluation Provenance

- **Group:** Final Spell Cost
- **Meaning:** Each contribution names its component, exact Definition version and M4 step; the source map cites them.
- **Guards:** `packages/prowess-game/src/spell-cost-golden.test.ts`, `packages/prowess-game/src/spell-cost-contracts.test.ts`, `packages/prowess-db/tests/integration/prowess-spell-cost-history.test.ts`, `apps/studio/tests/unit/m5-wo10-static.test.ts`, `scripts/m5-wo10-negative-controls.mjs`

### M5-I258 — Final Spell Cost Compilation Is Exact-Ruleset, Historically Reproducible, Deterministic, Immutable And JSON-Safe

- **Group:** Final Spell Cost
- **Meaning:** R1/R2 isolation, mixed-Ruleset refusal, deep-frozen outputs, JSON replay, unsafe input refusal.
- **Guards:** `packages/prowess-game/src/spell-cost-contracts.test.ts`, `packages/prowess-db/tests/integration/prowess-spell-cost-history.test.ts`, `apps/studio/tests/unit/m5-wo10-static.test.ts`, `scripts/m5-wo10-negative-controls.mjs`

### M5-I259 — Legacy Sequential Percentage Application And Legacy Floor-Rounded Final MP Examples Are Not Canonical Executable Behavior After M5-SC-028

- **Group:** Final Spell Cost
- **Meaning:** 13 × 0.9 = 11.7 → 12 MP (not 11); 20 × .8 × 1.1 × .9 is never computed.
- **Guards:** `packages/prowess-game/src/spell-cost-golden.test.ts`, `apps/studio/tests/unit/m5-wo10-static.test.ts`, `scripts/m5-wo10-negative-controls.mjs`

### M5-I260 — M5-SC-042 Remains Unresolved And Final Spell Cost Does Not Infer Additional Affinity Trait Capacity

- **Group:** Final Spell Cost
- **Meaning:** A non-empty additional Affinity Trait allocation still fails closed through WO8.
- **Guards:** `packages/prowess-game/src/spell-cost-contracts.test.ts`, `apps/studio/tests/unit/m5-wo10-static.test.ts`, `scripts/m5-wo10-negative-controls.mjs`

## M5-WO11 — Final Maneuver Cost, Attack Floors & Signature Reduction

### M5-I261 — Final Maneuver Cost Is Derived Only From Exact Authored Actions, Effects, Conditions And Authorized Structured Cost Rules

- **Group:** Final Maneuver Cost
- **Meaning:** Every AP and MP contribution comes from an exact authored action use, Effect instance, Trait, Duration or WO9 Condition and the Ruleset's own Maneuver cost policy; an unpriced foundation, an unresolved conflict or an unauthored operation fails closed.
- **Guards:** `packages/prowess-game/src/maneuver-cost-golden.test.ts`, `packages/prowess-game/src/maneuver-cost-contracts.test.ts`, `apps/studio/tests/unit/m5-wo11-static.test.ts`, `scripts/m5-wo11-negative-controls.mjs`

### M5-I262 — Base AP Is Calculated Before Conditions, Signature And Temporary Discounts

- **Group:** Final Maneuver Cost
- **Meaning:** Base AP is its own M4 step, preserved in the result separately from every later reduction.
- **Guards:** `packages/prowess-game/src/maneuver-cost-golden.test.ts`, `apps/studio/tests/unit/m5-wo11-static.test.ts`, `scripts/m5-wo11-negative-controls.mjs`

### M5-I263 — Base AP Includes Every Exact AP-Costing Foundation, Action, Powerful Blow Attack Contribution, Maneuver Effect And Added AP Commitment

- **Group:** Final Maneuver Cost
- **Meaning:** Every authored action use contributes its exact AP once, Powerful Blow constituents included, plus Effect, Trait, Duration and AP-commitment contributions.
- **Guards:** `packages/prowess-game/src/maneuver-cost-golden.test.ts`, `apps/studio/tests/unit/m5-wo11-static.test.ts`, `scripts/m5-wo11-negative-controls.mjs`

### M5-I264 — Base MP Is The Sum Of Exact Mana-Bearing Maneuver Component Contributions And Is Never Derived From AP

- **Group:** Final Maneuver Cost
- **Meaning:** Base MP is an independent M4 sum of MP contributions; there is no MP ÷ PRO, no AP-to-MP exchange rate and no implicit MP.
- **Guards:** `packages/prowess-game/src/maneuver-cost-golden.test.ts`, `apps/studio/tests/unit/m5-wo11-static.test.ts`, `scripts/m5-wo11-negative-controls.mjs`

### M5-I265 — AP-Or-MP Cost Options Require An Explicit Authored Choice And Are Never Auto-Selected

- **Group:** Final Maneuver Cost
- **Meaning:** An option keyed by a TOKEN with both currencies requires an explicit authored selection; only the selected amounts apply.
- **Guards:** `packages/prowess-game/src/maneuver-cost-golden.test.ts`, `packages/prowess-game/src/maneuver-cost-contracts.test.ts`, `apps/studio/tests/unit/m5-wo11-static.test.ts`, `scripts/m5-wo11-negative-controls.mjs`

### M5-I266 — AND Cost Options Apply Every Required Currency

- **Group:** Final Maneuver Cost
- **Meaning:** A component listing AP and MP contributes both.
- **Guards:** `packages/prowess-game/src/maneuver-cost-golden.test.ts`, `apps/studio/tests/unit/m5-wo11-static.test.ts`, `scripts/m5-wo11-negative-controls.mjs`

### M5-I267 — WO11 Consumes WO9's Effective Maneuver Condition AP Reduction And Never Exceeds The Canonical Three-AP Condition Cap

- **Group:** Final Maneuver Cost
- **Meaning:** Condition AP reductions are bound only from WO9's effective (min(listed, 3)) step; raw listed totals and rank caps are never consumed.
- **Guards:** `packages/prowess-game/src/maneuver-cost-golden.test.ts`, `apps/studio/tests/unit/m5-wo11-static.test.ts`, `scripts/m5-wo11-negative-controls.mjs`

### M5-I268 — Maneuver Condition MP Reductions Use Only Explicitly Selected Structured Contributions

- **Group:** Final Maneuver Cost
- **Meaning:** Only the WO9-selected MP option of an AP-or-MP Condition reduces MP; the alternative never applies too.
- **Guards:** `packages/prowess-game/src/maneuver-cost-golden.test.ts`, `apps/studio/tests/unit/m5-wo11-static.test.ts`, `scripts/m5-wo11-negative-controls.mjs`

### M5-I269 — Final Maneuver MP Cannot Become Negative

- **Group:** Final Maneuver Cost
- **Meaning:** The final MP step ends with MAX 0.
- **Guards:** `packages/prowess-game/src/maneuver-cost-golden.test.ts`, `apps/studio/tests/unit/m5-wo11-static.test.ts`, `scripts/m5-wo11-negative-controls.mjs`

### M5-I270 — Normal Condition Reductions Cannot Reduce AP Below The Number Of Separate Attack Resolutions

- **Group:** Final Maneuver Cost
- **Meaning:** Post-Condition AP is MAX(Condition-reduced AP, max(1, separate attack resolutions)).
- **Guards:** `packages/prowess-game/src/maneuver-cost-golden.test.ts`, `apps/studio/tests/unit/m5-wo11-static.test.ts`, `scripts/m5-wo11-negative-controls.mjs`

### M5-I271 — Powerful Blow's Internal Combined Attacks Contribute Their Full Base AP But Count As One Attack Resolution For The Condition Attack Floor

- **Group:** Final Maneuver Cost
- **Meaning:** A Powerful Blow group adds every constituent Attack's AP and counts as one resolution.
- **Guards:** `packages/prowess-game/src/maneuver-cost-golden.test.ts`, `apps/studio/tests/unit/m5-wo11-static.test.ts`, `scripts/m5-wo11-negative-controls.mjs`

### M5-I272 — Non-Attack Maneuvers Retain The Universal One-AP Minimum

- **Group:** Final Maneuver Cost
- **Meaning:** A Maneuver with zero attack resolutions still has a floor and a final minimum of 1 AP.
- **Guards:** `packages/prowess-game/src/maneuver-cost-golden.test.ts`, `apps/studio/tests/unit/m5-wo11-static.test.ts`, `scripts/m5-wo11-negative-controls.mjs`

### M5-I273 — Signature Maneuver Reduces Post-Condition AP By Exactly One And Does Not Count As A Maneuver Condition

- **Group:** Final Maneuver Cost
- **Meaning:** Signature is an explicit assignment verified against a WO5 Signature slot; it is phase 1 of the final AP step, outside the Condition cap and capacity.
- **Guards:** `packages/prowess-game/src/maneuver-cost-golden.test.ts`, `packages/prowess-game/src/maneuver-cost-contracts.test.ts`, `apps/studio/tests/unit/m5-wo11-static.test.ts`, `scripts/m5-wo11-negative-controls.mjs`

### M5-I274 — Signature Maneuver May Bypass The Separate-Attack Condition Floor But Cannot Reduce Final AP Below One

- **Group:** Final Maneuver Cost
- **Meaning:** Signature applies after the attack floor; the final AP step ends with MAX 1.
- **Guards:** `packages/prowess-game/src/maneuver-cost-golden.test.ts`, `apps/studio/tests/unit/m5-wo11-static.test.ts`, `scripts/m5-wo11-negative-controls.mjs`

### M5-I275 — Signature Maneuver Never Reduces MP Unless An Explicit Future Rule Says Otherwise

- **Group:** Final Maneuver Cost
- **Meaning:** The Signature modifier targets AP only.
- **Guards:** `packages/prowess-game/src/maneuver-cost-golden.test.ts`, `apps/studio/tests/unit/m5-wo11-static.test.ts`, `scripts/m5-wo11-negative-controls.mjs`

### M5-I276 — Three AP Is Not A Maneuver Cost Cap

- **Group:** Final Maneuver Cost
- **Meaning:** No maximum AP exists; high-AP Maneuvers are reported, never rejected for exceeding 3 AP.
- **Guards:** `packages/prowess-game/src/maneuver-cost-golden.test.ts`, `packages/prowess-game/src/maneuver-cost-contracts.test.ts`, `apps/studio/tests/unit/m5-wo11-static.test.ts`, `scripts/m5-wo11-negative-controls.mjs`

### M5-I277 — WO11 Does Not Spend AP Or MP

- **Group:** Final Maneuver Cost
- **Meaning:** The cost plan has no RESOURCE step and no persistence; DB and API tests fingerprint every table.
- **Guards:** `packages/prowess-game/src/maneuver-cost-contracts.test.ts`, `packages/prowess-db/tests/integration/prowess-maneuver-cost-history.test.ts`, `apps/studio/tests/integration/m5-wo11-maneuver-cost-api.test.ts`, `apps/studio/tests/unit/m5-wo11-static.test.ts`, `scripts/m5-wo11-negative-controls.mjs`

### M5-I278 — WO11 Does Not Execute Maneuver Effects, Damage, Movement Or Encounter State

- **Group:** Final Maneuver Cost
- **Meaning:** No attack roll, Save, damage, movement, Effect Chain, Sustain or Concentration is executed.
- **Guards:** `packages/prowess-game/src/maneuver-cost-contracts.test.ts`, `apps/studio/tests/unit/m5-wo11-static.test.ts`, `scripts/m5-wo11-negative-controls.mjs`

### M5-I279 — Final Maneuver Cost Preserves Exact Ruleset And Source Provenance

- **Group:** Final Maneuver Cost
- **Meaning:** Every contribution names its exact component use, Definition, EntityVersion, Ruleset and source-map step.
- **Guards:** `packages/prowess-game/src/maneuver-cost-golden.test.ts`, `packages/prowess-game/src/maneuver-cost-contracts.test.ts`, `packages/prowess-db/tests/integration/prowess-maneuver-cost-history.test.ts`, `apps/studio/tests/integration/m5-wo11-maneuver-cost-api.test.ts`, `apps/studio/tests/unit/m5-wo11-static.test.ts`, `scripts/m5-wo11-negative-controls.mjs`

### M5-I280 — Final Maneuver Cost Is Historically Reproducible, Deterministic, Immutable And JSON-Safe

- **Group:** Final Maneuver Cost
- **Meaning:** R1 keeps its component versions after R2; equal requests give deep-equal frozen outputs that replay through M4 after a JSON round trip.
- **Guards:** `packages/prowess-game/src/maneuver-cost-contracts.test.ts`, `packages/prowess-db/tests/integration/prowess-maneuver-cost-history.test.ts`, `apps/studio/tests/unit/m5-wo11-static.test.ts`, `scripts/m5-wo11-negative-controls.mjs`

### M5-I281 — Existing Unresolved Conflicts Remain Unresolved

- **Group:** Final Maneuver Cost
- **Meaning:** M5-SC-042, M5-SC-044, M5-SC-046 and M5-SC-047 are unchanged; M5-SC-048 is recorded and fails closed.
- **Guards:** `packages/prowess-game/src/maneuver-cost-contracts.test.ts`, `apps/studio/tests/unit/m5-wo11-static.test.ts`, `scripts/m5-wo11-negative-controls.mjs`

### M5-I282 — Every Maneuver Attack Is An Exact Existing Attack The Character Can Perform

- **Group:** Final Maneuver Cost
- **Meaning:** Each Attack use resolves to an exact foundation Definition in the exact Ruleset; capability to perform it is exported as an inherited requirement contract, never invented.
- **Guards:** `packages/prowess-game/src/maneuver-cost-contracts.test.ts`, `apps/studio/tests/unit/m5-wo11-static.test.ts`, `scripts/m5-wo11-negative-controls.mjs`

### M5-I283 — Selecting A Weapon-Based Attack Automatically Carries Its Weapon Performance Requirement Into The Maneuver

- **Group:** Final Maneuver Cost
- **Meaning:** Every Attack resolution group carries the Attack's weapon requirement.
- **Guards:** `packages/prowess-game/src/maneuver-cost-golden.test.ts`, `apps/studio/tests/unit/m5-wo11-static.test.ts`, `scripts/m5-wo11-negative-controls.mjs`

### M5-I284 — Inherited Attack Weapon Requirements Grant No Maneuver Condition Discount And Consume No Condition Capacity

- **Group:** Final Maneuver Cost
- **Meaning:** Inherited requirements are structural metadata: no AP/MP reduction, no Condition slot, outside the 3 AP cap.
- **Guards:** `packages/prowess-game/src/maneuver-cost-golden.test.ts`, `apps/studio/tests/unit/m5-wo11-static.test.ts`, `scripts/m5-wo11-negative-controls.mjs`

### M5-I285 — A Maneuver Cannot Gain A Discount By Restating An Attack Requirement It Already Inherently Possesses

- **Group:** Final Maneuver Cost
- **Meaning:** A Condition whose restriction is inherent to the selected Attack (Weapon Lock) is refused.
- **Guards:** `packages/prowess-game/src/maneuver-cost-contracts.test.ts`, `apps/studio/tests/unit/m5-wo11-static.test.ts`, `scripts/m5-wo11-negative-controls.mjs`

### M5-I286 — Attack-Scoped Effects And Traits Apply Only To Their Explicitly Attached Attack Or Powerful Blow Resolution

- **Group:** Final Maneuver Cost
- **Meaning:** An Effect attaches to exactly one resolution group; Effect-scoped Traits follow it; nothing is broadcast.
- **Guards:** `packages/prowess-game/src/maneuver-cost-golden.test.ts`, `packages/prowess-game/src/maneuver-cost-contracts.test.ts`, `apps/studio/tests/unit/m5-wo11-static.test.ts`, `scripts/m5-wo11-negative-controls.mjs`

### M5-I287 — Different Attacks Within One Maneuver Maintain Independent Effect And Trait Attachment Sets

- **Group:** Final Maneuver Cost
- **Meaning:** Each resolution group lists only its own Effects and Traits.
- **Guards:** `packages/prowess-game/src/maneuver-cost-golden.test.ts`, `apps/studio/tests/unit/m5-wo11-static.test.ts`, `scripts/m5-wo11-negative-controls.mjs`

### M5-I288 — Repeated Uses Of The Same Attack Remain Distinct Attack Resolutions Unless Explicitly Combined By Powerful Blow

- **Group:** Final Maneuver Cost
- **Meaning:** Two uses of one Attack Definition are two contributions and two resolutions without Powerful Blow.
- **Guards:** `packages/prowess-game/src/maneuver-cost-golden.test.ts`, `packages/prowess-game/src/maneuver-cost-contracts.test.ts`, `apps/studio/tests/unit/m5-wo11-static.test.ts`, `scripts/m5-wo11-negative-controls.mjs`

### M5-I289 — Powerful Blow Combines Compatible Uses Of The Same Attack Type Into One Resolution While Paying The Full Sum Of Their Attack Costs

- **Group:** Final Maneuver Cost
- **Meaning:** A Powerful Blow group is one resolution whose constituents each contribute their full AP.
- **Guards:** `packages/prowess-game/src/maneuver-cost-golden.test.ts`, `apps/studio/tests/unit/m5-wo11-static.test.ts`, `scripts/m5-wo11-negative-controls.mjs`

### M5-I290 — Powerful Blow Cannot Combine Different Attack Types Into One Resolution

- **Group:** Final Maneuver Cost
- **Meaning:** Powerful Blow members must be the same exact Attack Definition and attacks only.
- **Guards:** `packages/prowess-game/src/maneuver-cost-contracts.test.ts`, `apps/studio/tests/unit/m5-wo11-static.test.ts`, `scripts/m5-wo11-negative-controls.mjs`

### M5-I291 — Effects And Traits Attached To A Powerful Blow Apply Once To The Combined Attack Resolution Unless Their Exact Rule Says Otherwise

- **Group:** Final Maneuver Cost
- **Meaning:** An Effect attached to a Powerful Blow names the whole group and resolves once.
- **Guards:** `packages/prowess-game/src/maneuver-cost-golden.test.ts`, `apps/studio/tests/unit/m5-wo11-static.test.ts`, `scripts/m5-wo11-negative-controls.mjs`

### M5-I292 — Powerful Blow Constituent Attacks Count Toward Base AP But The Powerful Blow Counts As One Attack Resolution For The Condition Attack Floor

- **Group:** Final Maneuver Cost
- **Meaning:** Constituent AP is in Base AP; the floor counts the group once.
- **Guards:** `packages/prowess-game/src/maneuver-cost-golden.test.ts`, `apps/studio/tests/unit/m5-wo11-static.test.ts`, `scripts/m5-wo11-negative-controls.mjs`

### M5-I293 — Maneuver Effect Cost Is Based On Authored Effect Instances And Is Never Automatically Multiplied Across Unrelated Attacks

- **Group:** Final Maneuver Cost
- **Meaning:** An Effect instance is counted once however many compiled views contain it.
- **Guards:** `packages/prowess-game/src/maneuver-cost-golden.test.ts`, `packages/prowess-game/src/maneuver-cost-contracts.test.ts`, `apps/studio/tests/unit/m5-wo11-static.test.ts`, `scripts/m5-wo11-negative-controls.mjs`

## M5-WO12 — Effect Chain Execution & Runtime Resolution Routing

### M5-I294 — Effect Chain Execution Uses Exact Authored Effect Uses And Never Display Names

- **Group:** Effect Chain Execution
- **Meaning:** Chain nodes, branch destinations and trigger facts name exact Effect Use component keys of the same Spell; names, prose and indexes are never routing data.
- **Guards:** `packages/prowess-game/src/effect-execution-contracts.test.ts`, `apps/studio/tests/unit/m5-wo12-static.test.ts`, `scripts/m5-wo12-negative-controls.mjs`

### M5-I295 — Spell Effects Resolve In Authored Order Subject To Explicit Trigger And Transition Rules

- **Group:** Effect Chain Execution
- **Meaning:** Traversal starts at the first authored Effect Use and follows the authored successor unless a Chain Behavior, branch or trigger says otherwise.
- **Guards:** `packages/prowess-game/src/effect-execution-golden.test.ts`, `apps/studio/tests/unit/m5-wo12-static.test.ts`, `scripts/m5-wo12-negative-controls.mjs`

### M5-I296 — The Only Canonical Spell Chain Behaviors Are Continue, Success Only, Failure Only, Stop And Branch

- **Group:** Effect Chain Execution
- **Meaning:** Any other behavior token is refused when the Spell is authored; an unlisted Effect follows the authored failure policy or the ruled default (M5-SC-014).
- **Guards:** `packages/prowess-game/src/effect-execution-contracts.test.ts`, `apps/studio/tests/unit/m5-wo12-static.test.ts`, `scripts/m5-wo12-negative-controls.mjs`

### M5-I297 — Continue Proceeds Regardless Of Effect Success Or Failure

- **Group:** Effect Chain Execution
- **Meaning:** After CONTINUE the next reachable Effect resolves whether the current Effect succeeded or failed; the current result is not rewritten.
- **Guards:** `packages/prowess-game/src/effect-execution-golden.test.ts`, `apps/studio/tests/unit/m5-wo12-static.test.ts`, `scripts/m5-wo12-negative-controls.mjs`

### M5-I298 — Success Only Terminates On Effect Failure

- **Group:** Effect Chain Execution
- **Meaning:** SUCCESS_ONLY ends this target's chain on FAILURE (termination SUCCESS_ONLY_FAILURE).
- **Guards:** `packages/prowess-game/src/effect-execution-golden.test.ts`, `apps/studio/tests/unit/m5-wo12-static.test.ts`, `scripts/m5-wo12-negative-controls.mjs`

### M5-I299 — Failure Only Terminates On Effect Success

- **Group:** Effect Chain Execution
- **Meaning:** FAILURE_ONLY ends this target's chain on SUCCESS (termination FAILURE_ONLY_SUCCESS).
- **Guards:** `packages/prowess-game/src/effect-execution-golden.test.ts`, `apps/studio/tests/unit/m5-wo12-static.test.ts`, `scripts/m5-wo12-negative-controls.mjs`

### M5-I300 — Stop Terminates After The Current Effect Outcome

- **Group:** Effect Chain Execution
- **Meaning:** STOP emits the current outcome and ends this target's chain.
- **Guards:** `packages/prowess-game/src/effect-execution-golden.test.ts`, `apps/studio/tests/unit/m5-wo12-static.test.ts`, `scripts/m5-wo12-negative-controls.mjs`

### M5-I301 — Branch Selects Exactly One Authored Result Path Unless An Exact Future Rule Authorizes Fan-Out

- **Group:** Effect Chain Execution
- **Meaning:** BRANCH routes to the success or the failure destination only; the other destination is never reached.
- **Guards:** `packages/prowess-game/src/effect-execution-golden.test.ts`, `apps/studio/tests/unit/m5-wo12-static.test.ts`, `scripts/m5-wo12-negative-controls.mjs`

### M5-I302 — Effect Chain Graphs Are Acyclic Unless An Exact Future Rule Authorizes Bounded Repetition

- **Group:** Effect Chain Execution
- **Meaning:** Branch destinations are later Effect Uses of the same Spell, each owned by one branch; backward and self edges are refused.
- **Guards:** `packages/prowess-game/src/effect-execution-contracts.test.ts`, `apps/studio/tests/unit/m5-wo12-static.test.ts`, `scripts/m5-wo12-negative-controls.mjs`

### M5-I303 — A False Trigger Produces NOT_TRIGGERED Rather Than Effect Success Or Effect Failure

- **Group:** Effect Chain Execution
- **Meaning:** A trigger is an M4 REQUIREMENT over chain-local and explicit target facts; when false the node is NOT_TRIGGERED, emits no outcome and traversal continues to the next reachable node.
- **Guards:** `packages/prowess-game/src/effect-execution-golden.test.ts`, `packages/prowess-game/src/effect-execution-contracts.test.ts`, `apps/studio/tests/unit/m5-wo12-static.test.ts`, `scripts/m5-wo12-negative-controls.mjs`

### M5-I304 — Effect Success Normalizes Attack Hit, Target Save Failure And Satisfied Automatic Resolution

- **Group:** Effect Chain Execution
- **Meaning:** WO2 core results normalize: hit, target Save failure or satisfied Automatic resolution → SUCCESS.
- **Guards:** `packages/prowess-game/src/effect-execution-golden.test.ts`, `apps/studio/tests/unit/m5-wo12-static.test.ts`, `scripts/m5-wo12-negative-controls.mjs`

### M5-I305 — Effect Failure Normalizes Attack Miss, Target Save Success And Unsatisfied Automatic Resolution

- **Group:** Effect Chain Execution
- **Meaning:** Miss or target Save success → FAILURE; FAILURE is never confused with NOT_TRIGGERED or NOT_DELIVERED.
- **Guards:** `packages/prowess-game/src/effect-execution-golden.test.ts`, `apps/studio/tests/unit/m5-wo12-static.test.ts`, `scripts/m5-wo12-negative-controls.mjs`

### M5-I306 — Runtime Resolution Inputs Are Explicit And Deterministic; WO12 Has No Internal Random Number Generator

- **Group:** Effect Chain Execution
- **Meaning:** Rolls and choices are explicit inputs bound to the plan's execution key and an exact request key; missing input is PENDING_INPUT; success claims and foreign inputs are refused.
- **Guards:** `packages/prowess-game/src/effect-execution-golden.test.ts`, `packages/prowess-game/src/effect-execution-contracts.test.ts`, `apps/studio/tests/unit/m5-wo12-static.test.ts`, `scripts/m5-wo12-negative-controls.mjs`

### M5-I307 — Multi-Target Spell Chains Maintain Independent Per-Target Execution State

- **Group:** Effect Chain Execution
- **Meaning:** Each target has its own cursor, chain-local facts, delivery and termination; target order is the caller's Targeting order.
- **Guards:** `packages/prowess-game/src/effect-execution-golden.test.ts`, `apps/studio/tests/unit/m5-wo12-static.test.ts`, `scripts/m5-wo12-negative-controls.mjs`

### M5-I308 — Projectile Delivery And Effect Resolution Remain Distinct, And Projectile Attack Effects Reuse The Delivery Roll

- **Group:** Effect Chain Execution
- **Meaning:** Delivery resolves first; a miss is NOT_DELIVERED / DELIVERY_FAILED (no Save, no Automatic application); a hit is reused by ATTACK_ROLL Effects without a second roll.
- **Guards:** `packages/prowess-game/src/effect-execution-golden.test.ts`, `apps/studio/tests/unit/m5-wo12-static.test.ts`, `scripts/m5-wo12-negative-controls.mjs`

### M5-I309 — Maneuver Effects Remain Bound To Their Exact Attack Or Powerful Blow Resolution Group

- **Group:** Effect Chain Execution
- **Meaning:** Each Attack Use or Powerful Blow is its own runtime group; its attached Effects read only that group's result.
- **Guards:** `packages/prowess-game/src/effect-execution-golden.test.ts`, `packages/prowess-game/src/effect-execution-contracts.test.ts`, `apps/studio/tests/unit/m5-wo12-static.test.ts`, `scripts/m5-wo12-negative-controls.mjs`

### M5-I310 — Powerful Blow Uses One Runtime Attack Resolution Regardless Of Its Number Of Constituent Compatible Attacks

- **Group:** Effect Chain Execution
- **Meaning:** A Powerful Blow requests one Attack Roll per target and executes its attached Effects once.
- **Guards:** `packages/prowess-game/src/effect-execution-golden.test.ts`, `packages/prowess-game/src/effect-execution-contracts.test.ts`, `apps/studio/tests/unit/m5-wo12-static.test.ts`, `scripts/m5-wo12-negative-controls.mjs`

### M5-I311 — Maneuver Critical Context Is Attack-Specific And Never Broadcast Across The Maneuver

- **Group:** Effect Chain Execution
- **Meaning:** Only the critical Attack's group Effects carry critical context; a Save-replaced group has none.
- **Guards:** `packages/prowess-game/src/effect-execution-golden.test.ts`, `apps/studio/tests/unit/m5-wo12-static.test.ts`, `scripts/m5-wo12-negative-controls.mjs`

### M5-I312 — Inherited Maneuver Effect Resolution Creates No Additional Roll

- **Group:** Effect Chain Execution
- **Meaning:** An INHERIT_ABILITY Effect resolves from its group's resolution with no request of its own.
- **Guards:** `packages/prowess-game/src/effect-execution-golden.test.ts`, `apps/studio/tests/unit/m5-wo12-static.test.ts`, `scripts/m5-wo12-negative-controls.mjs`

### M5-I313 — Runtime Martial Save Selection Follows Trained, Expert And Master Save-Control Rules

- **Group:** Effect Chain Execution
- **Meaning:** Trained: the defender chooses; Expert: the attacker removes one, then the defender chooses; Master: the attacker chooses — each an explicit validated input from the Ruleset's policy.
- **Guards:** `packages/prowess-game/src/effect-execution-golden.test.ts`, `packages/prowess-game/src/effect-execution-contracts.test.ts`, `apps/studio/tests/unit/m5-wo12-static.test.ts`, `scripts/m5-wo12-negative-controls.mjs`

### M5-I314 — WO12 Selects And Emits Structured Outcomes But Does Not Directly Mutate Combat State

- **Group:** Effect Chain Execution
- **Meaning:** Resolved outcomes carry the exact authored operations as inert intent; no HP, Armor, position, Status Condition, resource or persistence change.
- **Guards:** `packages/prowess-game/src/effect-execution-contracts.test.ts`, `apps/studio/tests/integration/m5-wo12-effect-execution-api.test.ts`, `apps/studio/tests/unit/m5-wo12-static.test.ts`, `scripts/m5-wo12-negative-controls.mjs`

### M5-I315 — WO12 Execution Is Exact-Ruleset, Historically Reproducible, Immutable, Deterministic And JSON-Safe

- **Group:** Effect Chain Execution
- **Meaning:** An R1 Spell keeps R1 routing after R2; mixed context / bundle is refused; equal requests give deep-equal frozen JSON-safe traces.
- **Guards:** `packages/prowess-game/src/effect-execution-contracts.test.ts`, `packages/prowess-db/tests/integration/prowess-effect-execution-history.test.ts`, `apps/studio/tests/unit/m5-wo12-static.test.ts`, `scripts/m5-wo12-negative-controls.mjs`
