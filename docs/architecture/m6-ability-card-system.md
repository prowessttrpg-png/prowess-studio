# M6-WO9 — Character Ability Card System

The Ability Card System presents a Character's abilities as Prowess Field Manual cards. A card is **read-only derived presentation** of mechanics that existing authorities already evaluated. It never defines, modifies or executes a mechanic, it is never a canonical Definition, and it is never persisted. Invariants: M6-I129 – M6-I150 (`m6-invariants.md`).

## 1. Authority boundaries

| Layer | Owns | Never does |
| --- | --- | --- |
| M4 (`@prowess/rules`) | Requirement / formula evaluation | — |
| M5 / M6 game authorities (`@prowess/game`) | Signature Spell evaluation (WO7), Signature Maneuver evaluation (WO8), Character Attack Library (WO6), ACTION Definitions (M5-WO3), Action Improvement evaluation (WO9) | — |
| Card projections (`@prowess/game/src/card/*`) | Copying evaluated values into the Card Presentation Contract; the typed semantic rules model; the Card Rules Language | Arithmetic, cost or eligibility decisions, persistence (M5-WO1 / WO3 audits) |
| Card services (`@prowess/db/src/character/card-service.ts`) | Loading the Character, its pinned Release, its stored selections and loadout; calling the authorities and projections | Writes, re-evaluation across Releases, price authority |
| Studio (`apps/studio`) | Fetching, filtering, presenting, paginating for print | Domain imports, arithmetic on card values, writes |

## 2. Card Presentation Contract (v1)

`CardEnvelope<Category, Section>`: `contractVersion`, `cardKey`, `category`, `name`, `description`, `artwork` (`PLACEHOLDER`, decision C3), `availability`, `provenance`, `costs` (`ap`, `mp`, `breakdown`), `targeting`, `rules` (typed semantic model), `instructions` (generated language), `limitations`, category `section` and `snapshot`.

- `CardValue<T>` is `AVAILABLE` (a value) or `UNAVAILABLE` / `DEFERRED` (a code and the reason). A value the authority does not establish is never zero and never guessed.
- **Categories:**
  - `SIGNATURE_SPELL` and `SIGNATURE_MANEUVER` — from the WO7 / WO8 evaluations.
  - `WEAPON` and `ATTACK` — from the WO6 Character Attack Library for the current loadout.
  - `GENERAL_ACTION` — from the Release's ACTION Definitions.
  - `MAGE_ART` — always unavailable.
- **Card keys** are exact identities:
  - `SIGNATURE_SPELL:<abilityId>:<revision|draft>` (and `SIGNATURE_MANEUVER:…`);
  - `WEAPON:<weapon version>:<hand>`;
  - `ATTACK:<weapon version>:<attack version>:<hand>`;
  - `GENERAL_ACTION:<action version>`.
- **Provenance** records:
  - the Ruleset / manifest and the Character's pinned Release;
  - the Character;
  - the Ability identity and revision role (`CURRENT`, `DRAFT`, `HISTORICAL`);
  - every cited Definition;
  - the evaluating authority.

## 3. Rules model and Card Rules Language

`card/semantics.ts` reads the M5-WO12 execution plan into a language-free model. It covers:

- checks (Attack Roll, Saving Throw, automatic, group, unresolved);
- outcomes per Effect result;
- the five chain behaviors as transitions;
- triggers with their not-triggered path;
- per-target delivery with `NOT_DELIVERED`;
- independent Maneuver resolution groups (Powerful Blow keeps its constituents in order);
- Weapon Attack resolution;
- General Action timing, cost model, movement grant and applying improvements.

`card/language.ts` renders that model through fixed templates in three layers (phrase → sentence → block). Equal inputs give equal text. Studio shows the text verbatim.

For a Saving Throw, the Effect **succeeds when the defender's save fails** (decision C4). Weapon Attack saves name the target's save and keep each authored side.

Anything the language cannot word faithfully becomes an explicit unresolved note.

## 4. General Actions and Action Improvements

ACTION Definitions author no Character prerequisites, so General Action eligibility is `NO_REQUIREMENTS`. No rule is invented.

**AP cost**
- A FIXED cost is shown as its value.
- RANGE and MINIMUM costs are chosen at use; VARIABLE costs are set by the Spell or Skill Action. These are typed unavailable.
- The movement grant is evaluated by the runtime when the Action is taken. It is DEFERRED; its inputs show the Character's current derived values.

**`ACTION_IMPROVEMENT` v1** (decision C1, additive kind in ACTION_ECONOMY) contains:
- one exact parent ACTION EntityVersion;
- structured prerequisites: `LEVEL_AT_LEAST`, `STAT_AT_LEAST`, `SKILL_RANK_AT_LEAST`, `AFFINITY_RANK_AT_LEAST`;
- structured modifications: `ACTION_POINT_COST` (explicit FIXED), `ADDITIONAL_USE_CASE`, `RULE_OPERATION`, each optionally with an M4 Requirement condition.

**Evaluation** (`character/action-improvement.ts`)
- **Parent:** must be `PINNED`; `REVISION_MISMATCH` or `NOT_IN_RELEASE` makes the improvement UNRESOLVED.
- **Eligibility:** each prerequisite is checked independently through M4. The Skill / Affinity check is the one M6-WO4 rank evaluation.
- **Applicability:** an explicit cost is `APPLIED` only when the parent is FIXED and overridable by an explicit rule. A use case is `REFERENCE` (presented, never executed). A rule operation is `UNSUPPORTED`.
- **Status:**
  - ACTIVE — eligible, applicable, unconditional.
  - CONDITIONAL — eligible, with an authored use-time condition.
  - FUTURE — every unmet prerequisite is a Level within the Release's range.
  - UNAVAILABLE — a Level above the range, or a Stat above its authored maximum.
  - UNRESOLVED — everything else, including an unmet Stat or rank with no authored progression rule.
- **Effect on the card:** an ACTIVE, unconditional, applied explicit cost replaces the card's FIXED AP; the breakdown shows both rows. Two such overrides are a typed conflict.

## 5. Server services and APIs

- `getCharacterCardLibrary(characterId)` returns:
  - Spells and Maneuvers, each with current, draft and historical revision slots. A RETIRED Ability's revision is presented as HISTORICAL. A revision pinned to another Release is reported unavailable and never re-evaluated.
  - The current loadout's Weapon and Attack cards.
  - The Action Directory.
  - The Mage Art domain status, with no cards.
- `getCharacterActionDirectory(characterId)` returns the General Action cards with evaluated improvements, plus improvements whose parent the Release does not pin.
- `GET /api/characters/:id/cards` and `GET /api/characters/:id/actions` are registered under `M6-WO9`. They validate the UUID, refuse any query parameter and are read-only.

## 6. Studio

- **`/characters/:id/cards` — Card Library.**
  - Search and category filter.
  - By default, only cards usable now are listed. Drafts, retired Abilities and history are opt-in and labelled not usable.
  - Links resolve by exact key, by `ability=` (current revision only) or by `attack=` + `hand=`. There is never a fallback.
- **Card Viewer.**
  - Five modes:
    - **Illustrated:** emblem-forward, full instructions in a disclosure.
    - **Tactical.**
    - **Front / Back:** a keyboard toggle with a live announcement.
    - **Combined.**
    - **Print:** the real print pages, non-interactive.
  - The URL keeps the card key and mode. Motion respects `prefers-reduced-motion`.
  - Statuses are always text.
- **Progression drawer.**
  - A modal side drawer on desktop and a bottom sheet under 640 px. It traps focus, closes on Escape or the backdrop and restores focus.
  - It groups improvements Active → Conditional → Future → Unavailable / Unresolved, exactly as served.
- **`/characters/:id/actions` — Action Directory.** A rules reference: search, full entry, improvements with prerequisites and reasons, sources, and a link to the personalized Action card.
- **Character Sheet.** Digital-only "Card" links at the end of Spell, Maneuver and Attack rows, plus links in the Actions panel. Rows, layout and the Letter print are unchanged.

## 7. Print and snapshot semantics

`/characters/:id/cards/print?card=<key>…[&layout=combined]` prints the viewer's own blocks.

- **Measurement.** Blocks are measured in real layout inside a real card page (header, footer and scoped styles; each block is its own formatting context).
- **Packing.** Blocks are packed onto provisional 4 × 6 in pages (named CSS page `fcard-4x6`).
- **Splitting.** Long rule and reference lists are split per item, so content continues on numbered "continued" pages.
- **Duplex.** Pages run as duplex pairs (front i / back i, padded with an intentionally blank side).
- **Combined.** The combined layout puts each pair side by side on landscape Letter (`fcard-combined`).
- **Snapshot.** Every page carries the card key, revision, contract version and Release — the fixed snapshot identity. The print time is the reader's.
- **Nothing hidden.** No content is clipped or hidden, type stays at least 8 pt, and no control prints.

Real Chromium layout and PDF validation (`apps/studio/tests/e2e/m6-cards.spec.ts`) accepted the 4 × 6 format with continuation pages (decision C5).

## 8. Permanent protection

- **Invariants:** M6-I129 – M6-I150.
- **Gate:** `M6-WO9 — Character Ability Card System` (`scripts/ci/gates.json`, consolidated `controls-2` job, Tier 2 / 3).
  - **Domain tests:** card language, projection and Phase B tests, the WO9 and WO6 registry guards, and the historical Spell / Maneuver cost goldens.
  - **Database:** the DB card-library integration test.
  - **Studio:** the WO9 static gate, the card UI tests and the card API integration test.
- **Controls:** `scripts/m6-wo9-negative-controls.mjs` — 46 mutation controls.
- **Browser:** the browser and print suite runs in the existing Playwright job.

## 9. Known limitations and deferred scope

- **Action Directory:** Character-scoped. A Release-only directory needs a service that evaluates without a Character and is deferred.
- **Descriptions:** authored descriptions for Weapon, Attack and General Action cards are unavailable until an authoritative text source is chosen.
- **Mage Arts:** mechanics are not implemented; the domain is unavailable.
- **Action Improvements:** no canonical improvements are published. All improvements in tests are test-only fixtures.
- **Temporary encounter modifiers:** unsupported without an authoritative evaluation context.
- **Summon cards:** future scope.
- **Test fixtures:** the presentation test world composes isolated test Releases. They are not canonical Release content.
