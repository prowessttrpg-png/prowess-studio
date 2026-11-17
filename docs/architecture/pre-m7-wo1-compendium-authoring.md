# PRE-M7-WO1 — Compendium authoring and rule control

This Work Order changes how designers find and edit Compendium content. It does not change any engine rule.

- The editable Compendium is organised into topics.
- More Definition kinds get guided editors.
- A designer can start from a Stat, see every rule that reads it in one exact Release, and change a contribution by
  editing the rule that owns it. They can preview the effect without publishing, then publish through normal review.

Every number a reader or a Character sees still comes from the M4 engine and the M5 readers, through the exact published
Release.

## 1. Topic sections (presentation only)

`@prowess/model` `compendium-sections.ts` defines eleven sections: Gameplay Basics, Stats, Rules & Calculations, Combat,
Character Creation & Progression, Skills, Magic & Abilities, Maneuvers, Equipment, Conditions & Ongoing Effects, and
Keywords & References.

A section groups existing Definition kinds and, for content without a Definition, existing EntityTypes. It owns nothing
and stores nothing:

- Each kind has exactly one home section.
- Other sections may cross-list a kind (`alsoShows`).
- Reserved kinds are the catalog kinds with no supported schema version. They are named as "not yet authorable" in their
  section and are never offered as editable.

The `pre-m7-wo1-static` gate pins these rules.

Pages, all scoped to one exact Release:

| Page | Route | What it shows |
| --- | --- | --- |
| Topics overview | `/compendium/rulesets/:r/releases/:rel/sections` | Every section of this Release |
| A section | `…/sections/:section` | Search; the section's pinned rules (server `section` facet); generic reference entries of its EntityTypes, hidden when empty; the Keyword vocabulary in Keywords & References; reserved kinds; back navigation |
| A Stat | `…/stats/:stat` | "What this affects" (§3) |

Entry points:

- the Release page ("Browse by topic");
- the Compendium landing ("Browse by topic", via the Rules Reference).

## 2. Coverage map (every editable kind)

Every kind is validated by the same M5 boundary. The validator column means `validateStoredProwessDefinition` →
`readDefinitionPayload`, reached through `validateAuthoringCandidate` on Validate, Save and Create.

The editor names below are the actual descriptors and components:

- **Shared contract (WO1)** — the `CONTRACT_DESCRIPTORS` of the kind's M5 shared component contract.
- **WO3 / WO4 / WO6** — the per-kind descriptors added by those Work Orders.
- **PRE-M7-WO1 guided** — the new descriptors (`CORE_KIND_DESCRIPTORS`, `RUNTIME_KIND_DESCRIPTORS`).
- **Structured editor** — the generic `AuthoredDataEditor`. It uses typed form controls and exact reference pickers,
  never a raw JSON box, but it is not field-by-field guided.

| Kind | Home section | Editor | Guided | Tests | Limitations |
| --- | --- | --- | --- | --- | --- |
| CORE_RESOLUTION | Gameplay Basics (also Rules & Calculations) | Structured editor | No | m6-wo1 authoring, pre-m7-wo1-descriptors (reviewed list) | Several procedure shapes (roll, mastery, initiative, …) under one kind; a single guided form would not be exact. Its formulas are visible in "What this affects". |
| CHARACTER_DIE_PROGRESSION | Gameplay Basics | PRE-M7-WO1 guided (Levels list, dice table, die-by-Level table) | Yes | pre-m7-wo1-descriptors | — |
| STAT | Stats | PRE-M7-WO1 guided | Yes | pre-m7-wo1-descriptors, pre-m7-wo1-rule-control | — |
| DERIVED_STAT | Rules & Calculations | PRE-M7-WO1 guided Formula editor (contributions / inputs / advanced) | Yes | pre-m7-wo1-formula-guide, -rule-control, -strength-armor e2e | An expression that is not a sum of simple contributions is edited as an advanced expression (shown exactly as written). |
| ACTION | Combat | Structured editor | No | reviewed list | Nested cost and movement-grant records; candidate for a later guided form. |
| ACTION_IMPROVEMENT | Combat | Structured editor | No | reviewed list | Typed prerequisite and modification unions. |
| RESOURCE | Combat | Structured editor | No | reviewed list | Many nested policy records. |
| TERRAIN | Combat | PRE-M7-WO1 guided (Formula reads the distance moved) | Yes | pre-m7-wo1-descriptors | — |
| CREATURE_SIZE | Combat | PRE-M7-WO1 guided | Yes | pre-m7-wo1-descriptors | Rule notes stay structured data. |
| ANCESTRY, CHARACTER_CREATION_RULE, CHARACTER_ADVANCEMENT_RULE | Character Creation & Progression | WO3 / WO4 descriptors | Yes | m6-wo3, m6-wo4 | — |
| RANK_LADDER | Character Creation & Progression | PRE-M7-WO1 guided (ranks table) | Yes | pre-m7-wo1-descriptors | — |
| SKILL | Skills | WO3 descriptor | Yes | m6-wo3 | — |
| SKILL_RANK | Skills | PRE-M7-WO1 guided (rank bonus table) | Yes | pre-m7-wo1-descriptors | — |
| AFFINITY v1 | Magic & Abilities | WO1 descriptor | Yes | m6-wo1 | — |
| AFFINITY v2 | Magic & Abilities | Structured editor (WO2 read-only presentation) | Partial | m6-wo2 | Strengths and Weaknesses are lists of nested records. |
| AFFINITY_RANK_RULE, AFFINITY_PROGRESSION | Magic & Abilities | Structured editor | No | reviewed list | Nested authority and option unions. |
| AFFINITY_WEAKNESS_SEVERITY | Magic & Abilities | PRE-M7-WO1 guided (severity table) | Yes | pre-m7-wo1-descriptors | — |
| ABILITY_CONSTRUCTION_RULE | Magic & Abilities | Structured editor | No | reviewed list | Holds named formulas; its own Formula grammar differs from DERIVED_STAT (variables are names, not sources). |
| SPELL_DEFINITION | Magic & Abilities | Structured editor | No | reviewed list | Whole-ability composition. See §7. |
| SPELL_TARGETING / EFFECT / TRAIT / DURATION / CASTING_CONDITION, SHARED_TRAIT | Magic & Abilities (Conditions also cross-lists durations and conditions) | Shared contract (WO1) | Yes | m6-wo1 | — |
| MANEUVER_DEFINITION | Maneuvers | Structured editor | No | reviewed list | Whole-ability composition. See §7. |
| MANEUVER_FOUNDATION / TARGETING / EFFECT / TRAIT / CONDITION / DURATION | Maneuvers | Shared contract (WO1) | Yes | m6-wo1 | — |
| WEAPON, ATTACK, EQUIPMENT_TRAIT | Equipment | WO6 descriptors | Yes | m6-wo6 | — |
| MAGE_ART | Magic & Abilities (reserved) | none | — | pre-m7-wo1-static (reserved = unsupported) | No M5 payload contract exists. See §7. |
| ARMOR | Equipment (reserved) | none | — | same | No M5 payload contract. |
| STATUS_CONDITION, SUMMON_TYPE, SUMMON_TRAIT, SUMMON_ACTION_MODEL, MISSION_RULE | Conditions & Ongoing Effects (reserved) | none | — | same | No M5 payload contract. |
| Keyword definitions | Keywords & References | Existing Keyword API (no screen) | — | m1 keyword suites | Keywords are shared across Releases and listed per Release. There is still no Keyword editing screen. |

The kinds still on the structured editor are pinned as an explicit list by `pre-m7-wo1-descriptors`, so adding or dropping
one is always a reviewed change.

## 3. "What this affects" and editing the owning rule

**The rule graph.** `@prowess/db` `compendium-rules/graph.ts` builds a graph of one exact Release's pinned Definitions:

- Nodes are the roles the engine resolves: `STAT:X`, `DERIVED:X`, `PROCEDURE:X`, `DEFINITION:key`.
- Edges come from Formula variable sources: `STAT`, `DERIVED`, and `CHOSEN_STAT`, which means "any Stat".
- Further edges come from the structured `statistic` / `capacityStatistic` fields.

**The impacts list.** `getStatImpacts` returns every dependent, direct (depth 1) or indirect, with:

- the path it is reached through;
- the exact formula text it reads;
- the owning revision and any open Draft.

`GET /api/compendium-rules/releases/:release/stats/:stat` serves this list. The Rules Reference shows it read-only.

**Editing.** "Edit this rule" opens the owning Definition in Compendium Admin. The link carries:

- the Release;
- the Stat;
- the revision that Release pins (`base`);
- the way back (`returnTo`, same-app Compendium paths only).

The designer then creates the Draft explicitly ("Create New Revision from Revision N"), starting from the pinned revision
rather than the latest one. The Draft workspace keeps the Release context:

- it shows a "Back to where you started" link;
- it shows the rule preview (§5).

Publication still needs review, approval, a ChangeSet and a new Release. The governed screens are unchanged.

## 4. The guided Formula editor and where Formula authority lives

The guided editor shows a Formula's top-level sum as contributions:

- a constant;
- an input;
- a number × an input;
- an input ÷ a number, rounded down, rounded up or exact;
- any other sub-expression, shown read-only.

It also offers:

- the inputs list, with "Replace input" (the variable is renamed throughout the tree);
- "Add a contribution";
- rounding, minimum, maximum and unit;
- an advanced expression box.

Removing every contribution yields the neutral formula `0`. The statistic still exists.

**Authority.** M4 is frozen, and the Studio may not import `@prowess/rules`. So the Studio never parses, prints or
evaluates a Formula. All guidance runs on the server through one pure operation, `POST /api/compendium-rules/formula`
(describe / compose / rename / name):

- `@prowess/db` `formula-presentation.ts` obtains the tree only from the M4 engine's public program validator,
  `validateFormulaProgram`. It never calls the parser directly; `m4-wo3-static` still forbids that in `@prowess/db`.
- It only classifies and prints that tree.
- A guided edit is accepted only when it prints back to exactly the intended tree.
- An expression that cannot be shown losslessly is never rewritten.

Legality is decided on Save by the unchanged M5 validation. Values come from the preview.

**Source vocabularies.** The M5 Formula variable-source lists are internal to `@prowess/game`. The catalog therefore
serves a documented mirror, `compendium-rules/formula-vocabulary.ts`, and the C02 integration test proves it equal to
what the M5 DERIVED_STAT reader accepts, in both directions. Rounding modes come from M4's exported
`FORMULA_ROUNDING_MODES`.

## 5. Side-effect-free preview

`POST /api/compendium-rules/preview` accepts `{ releaseId, drafts, examples }`. It accepts at most 12 examples and 20
Drafts, and every Draft must belong to an Entity the Release pins.

It evaluates every derived statistic for each example twice. Both runs use the same `compileCoreResolution` and M4
orchestration as the Character profile:

1. once for the published Release;
2. once for a candidate context that substitutes the saved Drafts for their pins. The candidate has no release identity
   and no manifest hash, and it is never persisted.

It also reports cycles. It writes nothing, which the `pre-m7-wo1-static` gate pins. The panel uses the SAVED Draft and
says so when the form has unsaved edits.

## 6. Consumer authority audit

Every consumer that shows or uses a calculated value resolves the Character's own stored Release:

| Consumer | Entry point | Authority |
| --- | --- | --- |
| Character creation (capability, validate, save, finalize) | `character/service.ts` → `releaseRules(releaseId)` | `materializeProwessDefinitionsFromRelease` of the chosen exact Release |
| Advancement | `advancement-service.ts` → `progressionOf` → `buildCharacterMechanicalProfile` | the Character's stored Release |
| Character sheet, loadout and attacks | `sheet-service.ts` / `weapon-service.ts` → `loadEquippedCharacter` → `requireProfile` | the same profile (the sheet's Armor is `derived("STRENGTH_ARMOR")`) |
| Spell and Maneuver builders | `signature-spell-service.ts` / `signature-maneuver-service.ts` (`loadSignatureContext`) | the Character's Release |
| Ability cards and print | `card-service.ts` → `loadSignatureContext` | the Character's Release |
| Play | `play-service.ts` → `loadEquippedCharacter` + the request-scoped `createPlayEvaluationCache()` | the Character's Release, per request |
| Weapon Library, Rules Reference, "What this affects" | `weapon-library/service.ts`, `compendium-reference`, `compendium-rules` | the Release in the URL |
| Content packs | `exportContentPack(releaseId)` / `installContentPack` | exact Release closure (DIST-WO2) |
| Workspace backup / restore | `backup.mjs` row copy | rows as stored; no recomputation |

**Caches.** There is no cross-request cache of Definitions, profiles or derived values:

- `PlayEvaluationCache` is created per request and keyed by the exact source object.
- The content-pack route sends `Cache-Control: no-store`.
- A pinned portrait image is `immutable`, because it is keyed by an immutable revision.

A new Release therefore needs no cache invalidation, and an existing Character cannot observe another Release.

**Demonstrations.** The Strength → Armor demonstration proves this end to end:

- `pre-m7-wo1-strength-armor.spec.ts`: an R1 Character's sheet and row are unchanged, and a new R2 Character has
  Armor 0.
- `verify-pre-m7-wo1-transfer.mjs`: the same result after pack transfer into an independent database, a restart and a
  whole-workspace restore.

## 7. Decisions recorded, not invented

- **Mage Art.** `MAGE_ART` is a reserved kind with no M5 payload contract. This Work Order shows it as "not yet
  authorable" and does not invent a contract, an editor or a placeholder. It needs a product decision on its payload
  before any editor can exist.
- **Whole-ability Definitions** (`SPELL_DEFINITION`, `MANEUVER_DEFINITION`). These are compositions of exact component
  references. Two things are left for a later Work Order:
  - a guided "add a component" flow with a child-Draft round trip (create a missing component as its own Draft, then
    return and reference its exact revision);
  - a decision on whether whole authored abilities belong in the Compendium at all, or only in the Character builders.

  Today they remain on the structured editor, whose reference picker already stores exact identities.
- **M4 stays frozen.** Sixteen historical gates pin `@prowess/rules` byte-for-byte. The guided Formula therefore lives in
  `@prowess/db` and reaches the engine only through its public validator. Moving it into the engine would need an
  explicit owner decision to reopen M4.
- **AuthoringDashboard.** The fallback `data-validation` value changed from `NONE` to `UNCHECKED`. `NONE` is now an M4
  rounding value served by the catalog, and Studio sources may not carry vocabulary values. The attribute is
  presentation-only and no test or consumer reads it.
