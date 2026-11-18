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
- **PRE-M7-WO1 guided** — the new descriptors (`CORE_KIND_DESCRIPTORS`, `RUNTIME_KIND_DESCRIPTORS`,
  `REMAINING_KIND_DESCRIPTORS`, `AFFINITY_V2`, `ABILITY_DEFINITION_DESCRIPTORS`). Recursive controls: nested groups, lists
  of records, shape-by-discriminator variants (switching a shape asks before discarding data), several values of one
  vocabulary, one exact reference, per-vocabulary records and optional engine policies that stay absent until set.
- **Advanced fallback** — exceptional nested data (rule notes, optional engine policies, a Spell's advanced effect chain)
  is edited by the structured `AuthoredDataEditor`: typed controls and exact reference pickers, never a raw JSON box.

No authorable kind or schema version is left on the generic structured editor (`pre-m7-wo1-descriptors`, "no authorable
kind / schema version is left on the generic structured editor"). Every key of every shipped payload is described by its
kind's guided form, recursively (same test), and rendering a stored payload never rewrites it
(`pre-m7-wo1-guided-editors-ui`).

| Kind | Home section | Editor | Guided | Tests | Limitations |
| --- | --- | --- | --- | --- | --- |
| CORE_RESOLUTION | Gameplay Basics (also Rules & Calculations) | PRE-M7-WO1 guided: procedure variant (roll shape / Stat Mastery / Initiative), natural selection per roll mode, total Formula with the roll / Initiative input lists, comparison, optional critical, tiebreak steps | Yes | pre-m7-wo1-descriptors (every shipped key covered), -guided-editors-ui (render never rewrites; lossless edit) | — |
| CHARACTER_DIE_PROGRESSION | Gameplay Basics | PRE-M7-WO1 guided (Levels list, dice table, die-by-Level table) | Yes | pre-m7-wo1-descriptors | — |
| STAT | Stats | PRE-M7-WO1 guided | Yes | pre-m7-wo1-descriptors, pre-m7-wo1-rule-control | — |
| DERIVED_STAT | Rules & Calculations | PRE-M7-WO1 guided Formula editor (contributions / inputs / advanced) | Yes | pre-m7-wo1-formula-guide, -rule-control, -strength-armor e2e | An expression that is not a sum of simple contributions is edited as an advanced expression (shown exactly as written). |
| ACTION | Combat | PRE-M7-WO1 guided: timing, AP cost variant (fixed / range / minimum / variable / none), other costs, payment, movement grant Formula | Yes | pre-m7-wo1-descriptors (every shipped key covered), -guided-editors-ui (render never rewrites; lossless edit) | — |
| ACTION_IMPROVEMENT | Combat | PRE-M7-WO1 guided: exact ACTION reference, prerequisite and modification variants; the optional condition is advanced data | Yes | pre-m7-wo1-descriptors (every shipped key covered), -guided-editors-ui (render never rewrites; lossless edit) | — |
| RESOURCE | Combat | PRE-M7-WO1 guided: kind, maximum, refresh / expiry targets, spending, ceiling, overflow, usage restrictions | Yes | pre-m7-wo1-descriptors (every shipped key covered), -guided-editors-ui (render never rewrites; lossless edit) | — |
| TERRAIN | Combat | PRE-M7-WO1 guided (Formula reads the distance moved) | Yes | pre-m7-wo1-descriptors | — |
| CREATURE_SIZE | Combat | PRE-M7-WO1 guided | Yes | pre-m7-wo1-descriptors | Rule notes stay structured data. |
| ANCESTRY, CHARACTER_CREATION_RULE, CHARACTER_ADVANCEMENT_RULE | Character Creation & Progression | WO3 / WO4 descriptors | Yes | m6-wo3, m6-wo4 | — |
| RANK_LADDER | Character Creation & Progression | PRE-M7-WO1 guided (ranks table) | Yes | pre-m7-wo1-descriptors | — |
| SKILL | Skills | WO3 descriptor | Yes | m6-wo3 | — |
| SKILL_RANK | Skills | PRE-M7-WO1 guided (rank bonus table) | Yes | pre-m7-wo1-descriptors | — |
| AFFINITY v1 | Magic & Abilities | WO1 descriptor | Yes | m6-wo1 | — |
| AFFINITY v2 | Magic & Abilities | PRE-M7-WO1 guided (identity, themes, Strengths and Weaknesses lists) | Yes | pre-m7-wo1-descriptors (every shipped key covered), -guided-editors-ui (render never rewrites; lossless edit) | — |
| AFFINITY_RANK_RULE, AFFINITY_PROGRESSION | Magic & Abilities | PRE-M7-WO1 guided: rank rows and authority; per-Level steps with option variants (choose primary / rank up / gain) | Yes | pre-m7-wo1-descriptors (every shipped key covered), -guided-editors-ui (render never rewrites; lossless edit) | — |
| AFFINITY_WEAKNESS_SEVERITY | Magic & Abilities | PRE-M7-WO1 guided (severity table) | Yes | pre-m7-wo1-descriptors | — |
| ABILITY_CONSTRUCTION_RULE | Magic & Abilities | PRE-M7-WO1 guided: named formulas, Spell / Maneuver / Signature groups, cost rows; the four optional engine policies are advanced data and stay absent until set | Yes | pre-m7-wo1-descriptors (every shipped key covered), -guided-editors-ui (render never rewrites; lossless edit) | — |
| SPELL_DEFINITION | Magic & Abilities | PRE-M7-WO1 `AbilityDefinitionEditor`: name, description, Affinity, authority, Keywords; component slots (targeting, effects, traits with scope, conditions, duration) pinned to exact revisions with their declared parameters; construction options; additional Affinity traits; advanced effect chain; "Create a new …" child-Draft round trip | Yes | pre-m7-wo1-descriptors, -guided-editors-ui | Legality (costs, limits) is the server's M5 validation; the editor never prices. |
| SPELL_TARGETING / EFFECT / TRAIT / DURATION / CASTING_CONDITION, SHARED_TRAIT | Magic & Abilities (Conditions also cross-lists durations and conditions) | Shared contract (WO1) | Yes | m6-wo1 | — |
| MANEUVER_DEFINITION | Maneuvers | PRE-M7-WO1 `AbilityDefinitionEditor`: as Spell, plus Foundation actions, Effect-to-action attachments and Powerful Blow | Yes | same | same |
| MANEUVER_FOUNDATION / TARGETING / EFFECT / TRAIT / CONDITION / DURATION | Maneuvers | Shared contract (WO1) | Yes | m6-wo1 | — |
| WEAPON, ATTACK, EQUIPMENT_TRAIT | Equipment | WO6 descriptors | Yes | m6-wo6 | — |
| MAGE_ART v1 | Magic & Abilities | PRE-M7-WO1 guided: Art key, activation AP / MP, per-turn maintenance AP / MP and optional special cost text, Active Effect window, modes (own costs optional, rules text) | Yes | pre-m7-wo1-mage-art (game), -static, -descriptors, -guided-editors-ui | Authoring and reference only: nothing executes, prices or plays a Mage Art; the Character card stays unavailable. See §7. |
| ARMOR | Equipment (reserved) | none | — | pre-m7-wo1-static (reserved = unsupported) | No M5 payload contract. |
| STATUS_CONDITION, SUMMON_TYPE, SUMMON_TRAIT, SUMMON_ACTION_MODEL, MISSION_RULE | Conditions & Ongoing Effects (reserved) | none | — | same | No M5 payload contract. |
| Keyword definitions | Keywords & References | Existing Keyword API (no screen) | — | m1 keyword suites | Keywords are shared across Releases and listed per Release. There is still no Keyword editing screen. |

Reusable Spell and Maneuver Definitions are Compendium content. A Character's Signature Spell or Maneuver is a separate,
personal instance built in the Character builders; the builders and their exact-reference model are unchanged.

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

- **Scope (owner decision).** Mage Arts, reusable Spell Definitions and reusable Maneuver Definitions belong in the
  Compendium. They are authored there with descriptions and compatible components. A Character's Signature Spell or
  Maneuver stays a separate personal instance built in the Character builders, which keep their exact-reference model.
- **Mage Art — the contract was genuinely missing.** Verified before any change:
  - registry: `MAGE_ART: reserved("MAGE_ART")`, `schemaVersions: []`;
  - validator: `readDefinitionPayload` had no `MAGE_ART` branch, so every payload was refused;
  - card: `card/mage-art.ts` is always UNAVAILABLE and names the reserved kind as the reason;
  - runtime / compiler: `compile.ts` maps `MAGE_ART: null`; no play operation, pricing or investment reads it;
  - fixtures: no shipped content has a Mage Art;
  - rules: the only authoritative structure in the repository is the M5 system map §11 (s1905–s1977). The rulebook text
    itself is not in the repository (M3-I19).
- **Mage Art v1 — the smallest compatible contract** (`packages/prowess-game/src/definition/mage-art-payload.ts`,
  registered as an approved M5 change under `PRE-M7-WO1` in `m6-approved-m5-changes.json`). It records only what §11
  states for every Art:

  ```
  { artKey: TOKEN,
    activation:  { ap, mp },                          // listed activation cost
    maintenance: { ap, mp, special: text | null },    // paid each turn; special = e.g. overload damage, as text
    activeEffect: { counts: WHILE_MAINTAINED | WHILE_CASTING },   // Contract counts only while casting
    modes: [ { modeKey, name, activation | null, maintenance | null, rulesText } ],   // e.g. Reinforcement
    source: { locators: [sNNN…], conflicts: [M5-SC-NNN…] } }
  ```

  What each Art does (Barrier, Domain, Overdrive, …) is written in the Definition's description and each mode's rules
  text. Nothing executes, prices or plays it: the compiler still maps it to null and the Character card stays
  UNAVAILABLE (its reason is now "no Character-facing Mage Art domain exists"). The registry change is reserved `[]` →
  `[1]` only. The historical registry tests skip it as "activated by a later Work Order", following the WO6 / WO9
  precedent. The section moves MAGE_ART from reserved to authorable and becomes MIXED (executable rules and reference
  content).
- **Mage Art decisions still open for the owner** (defaults applied, all reversible before publication):
  - D1 cost shape: (a) fixed AP / MP per Art — applied; (b) per-Level cost rows; (c) a cost Formula. §11 mentions
    "Level-based tables", so (b) or (c) may be needed once the rulebook text is checked.
  - D2 Art effects: (a) rules text — applied; (b) structured per-Art fields; (c) reuse the Spell Effect components.
  - D3 play: (a) authoring and reference only, card stays unavailable — applied; (b) also Signature Ability investment
    and play activation (a later Work Order with its own contract).
- **Whole-ability Definitions** (`SPELL_DEFINITION`, `MANEUVER_DEFINITION`) are guided by `AbilityDefinitionEditor`.
  Each component slot holds an exact revision, chosen by kind and revision, with that revision's declared parameters.
  "Create a new …" stashes the unsaved parent (one use, 24 hours, this browser tab), opens New Definition with the kind
  preset, and on create returns to the parent with the new exact revision appended to the slot. Nothing is saved
  automatically.
- **M4 stays frozen.** Sixteen historical gates pin `@prowess/rules` byte-for-byte. The guided Formula therefore lives in
  `@prowess/db` and reaches the engine only through its public validator. Moving it into the engine would need an
  explicit owner decision to reopen M4.
- **AuthoringDashboard.** The fallback `data-validation` value changed from `NONE` to `UNCHECKED`. `NONE` is now an M4
  rounding value served by the catalog, and Studio sources may not carry vocabulary values. The attribute is
  presentation-only and no test or consumer reads it.
