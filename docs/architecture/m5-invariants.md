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
