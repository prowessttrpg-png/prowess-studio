# M5 — Core Playtest System Map (M5-WO1)

This map is built from the source. It lists the mechanical families of **Prowess Core Playtest Packet V0.1**, which
is the primary M5 mechanical source (M5-I001). It records where each family lives in the source, what it would
become in the structured model, what it depends on, and which later M5 Work Order owns it.

- **Source identity:** the designer's local copy of the Core Playtest (98,897,516 bytes, SHA-256 prefix `21fa6771…`),
  byte-identical to the source recorded in `docs/import-reports/m3-wo9-core-playtest-v0.1.md`, parsed by the approved M3
  parser `prowess-docx-structure@1.0.0`, structure hash `3d9a429c…f1e7`, 2,487 sections, 772 tables. It is the same
  file the M3-WO9 import verified.
- **Locators:** `sNNN` is the parser's deterministic section key under that structure hash. Section titles are given
  verbatim. Ranges such as `s619–s733` are contiguous runs of top-level sections.
- **Conflicts:** `M5-SC-NNN` refers to `m5-core-playtest-source-conflicts.md`.
- **M4 primitive column:** every entry is **FUTURE MAPPING**. WO1 implements no calculation (§211–212).
- **Nothing here is executable.** Source prose is never parsed into rules (M5-I018). Each item becomes structured,
  reviewed Definition content first (M5-I019).

Layer vocabulary used below: **Definition** (canonical versioned content), **Composition** (an authored
configuration), **Runtime** (encounter state) and **Presentation** (cards and UI). See
`m5-prowess-domain-compilation.md`.

---

## 1. CORE RESOLUTION

- **Source sections:** s9 CORE RULES & GAME BASICS · s10–s12 HOW PLAY WORKS · s13–s14 THE CORE ROLL · s15 DIFFICULTY
  CLASSES · s16–s19 CHARACTER DICE · s38–s42 SAVING THROWS · s43 CHARACTER DC · s56–s58 ATTACK ROLLS · s59–s61 / s470
  CRITICAL HITS · s52 / s425 Initiative · s62–s68 / s474 DAMAGE · s480 SAVING THROWS IN COMBAT · s633–s637 SPELL
  ROLLS AND SAVES.
- **Concepts:**

  | Concept | Source rule (as written) | Locator |
  | --- | --- | --- |
  | Core roll | Character Die + Relevant Stat + Bonuses ≥ DC or defense | s13 |
  | Character Die | d4 (L1–2) … d12 (L9–10); "Player Dice" also appears | s16, M5-SC-002 |
  | DC | Simple 3 · Standard 6 · Difficult 10 · Severe 14 · Extreme 18+ (guidelines) | s15 |
  | Attack Roll | Character Die + PER + bonuses vs Dodge (core) / Evasion (spells, Maneuvers) | s56, s634, s1988, M5-SC-005, M5-SC-009 |
  | Saving Throw | Character Die + Stat + bonuses; the Effect names the Save; some allow a choice | s38–s42 |
  | Character DC | ½ Character Die + PRO + bonuses (RES contribution disputed) | s43, s637, M5-SC-008 |
  | Initiative | Character Die + ½ PER + ½ AGI, rolled per side | s52 |
  | Advantage / Disadvantage | used often, never mechanically defined | M5-SC-010 |
  | Critical | natural maximum on the Character Die "threatens" a crit; still must hit; damage dice deal maximum | s59 |
  | Damage pipeline | roll → crit → Armor / DR → Resistance → HP; Damage Threshold | s62–s68 |
  | Success / failure | meet or exceed; Spell Save: half damage on success (s840); Maneuver Save: no damage on success (s1990) | branch-specific |
  | Automatic success | Ability Score + Skill Rank ≥ DC → no roll | s31, s36, s183 |
  | Target defenses | Dodge, Evasion, Armor, Resistance, Damage Threshold | s57, s63–s67 |

- **Major Definitions:** `CORE_RESOLUTION` (roll forms, DC ladder, critical rule), Character Die progression.
- **Major Compositions:** none. Core rules are used by every composed ability.
- **Runtime dependencies:** Character Level (die size), current Stats, situational bonuses.
- **Inputs → outputs:** Stat, die, bonuses, DC / defense → success / failure, critical flag, damage.
- **Relationships:** consumed by Skills, Spells, Maneuvers, Mage Arts, Summons (Summon Dice substitute), Death Saves.
- **Likely M4 primitives (FUTURE MAPPING):** Formula (Character DC, Dodge, Initiative); Requirement (meets or exceeds,
  as explicit facts); Modifier (bonuses, Advantage as a signal); Explanation. Dice rolling itself is Runtime input,
  never M4 randomness.
- **Known conflicts:** M5-SC-002, M5-SC-005, M5-SC-008, M5-SC-009, M5-SC-010.
- **Future WO:** **M5-WO2** Core Resolution, Stats, Dice & Rank Primitives.

## 2. CHARACTER CORE

- **Source sections:** s20–s27 ABILITY SCORES · s91–s112 CHARACTER CREATION / STEP 3 — CALCULATE CORE STATISTICS ·
  s121–s123 SIGNATURE ABILITY SLOTS · s150 FINALIZE · s158–s162 LEVELING UP · s77–s84 Death & Dying.
- **Stats:** Strength (STR), Agility (AGI), Constitution (CON), Perception (PER), Resolve (RES), Prowess (PRO). Range
  1–10 (s21). Start at 1 + 15 points (s97).
- **Derived concepts:**

  | Derived | Source rule | Locator |
  | --- | --- | --- |
  | HP | Base HP + CON (creation) vs CON × Racial HP Modifier (Ability chapter) | M5-SC-003 |
  | MP | Base MP + RES vs RES × Racial MP Modifier | M5-SC-003 |
  | Movement | 5 × AGI (example uses 10 ×) | s69, s104, M5-SC-006 |
  | Dodge | ½ Character Die + AGI (½ d4 = 2) | s57, s105 |
  | Evasion | "+1 per 3 PER"; used as attack defense elsewhere | s25, M5-SC-005 |
  | Armor | +1 per 3 STR (stacks with equipment) | s22, s109 |
  | Base Range | 15 × PER | s25, s106 |
  | Mana Efficiency | = PRO (temporary mana per round) | s27, s107, M5-SC-004 |
  | AP | 3 + 1 per 3 AGI | s23, s110 |
  | Counter Action | 1 per round, refreshes each round | s47, s111 |
  | Signature Ability capacity | Signature Ability Slots = PRO | s108, s121 |
  | Character Die | by Level | s16, s159 |
  | Level | 1–10; Stat points, Skill and Affinity advancement table | s159 |
  | Attunement Slots | +1 per 2 CON (mentioned once) | s24 |
  | Concentration | see Shared Resources | M5-SC-007 |

- **Major Definitions:** `STAT`, `DERIVED_STAT` (one per derived value), Level progression table.
- **Major Compositions:** a Character Build (Stat allocation, Race, Skills, Affinity, Signature Abilities). This is
  a future M5 composition subject.
- **Runtime dependencies:** current HP / MP / AP and Conditions; Level.
- **Inputs → outputs:** allocated Stats, Race, Level → derived statistics.
- **Relationships:** feeds every ability family (PRO → Spell AP and Signature slots; STR → weapon Power; RES →
  Concentration / DC).
- **Likely M4 primitives (FUTURE MAPPING):** Formula (each derived value, with explicitly declared floor rounding);
  Requirement (creation limits); Validation; Explanation.
- **Known conflicts:** M5-SC-003, M5-SC-005, M5-SC-006, M5-SC-007, M5-SC-008, M5-SC-009.
- **Future WO:** **M5-WO2**. Character Builder is M5-WO14+.

## 3. SKILLS

- **Source sections:** s28–s37 Skill Checks · s113–s117 STEP 4 · s160 Skill Advancement · s177–s186 SKILLS · per-Skill
  rank sections s187–s420 (◈ TRAINED / EXPERT / MASTER …, e.g. s187 TRAINED ARCANA, s353 MARTIAL).
- **Concepts:** Skill identity (14 listed: Arcana, Animal Handling, Athletics, Awareness, Burglary, Crafting,
  Engineering, Influence, Insight, Lore, Martial, Medicine, Pilot, Survival; Stealth used but not listed, M5-SC-030).
  Ranks Untrained / Trained / Expert / Master. **Rank Bonus** +2 / +4 / +6 (s29, s178). **Rank Value** 1 / 2 / 3
  (Martial, s1980). Advancement Trained → Expert → Master (s160). Each Skill rank grants Save bonuses, resource bonuses,
  subsystem access, Skill Actions and Passives.
- **Arcana:** Spell Creation access, Effect / Targeting tiers, Casting Conditions, +MP, +ME, Concentration (s187–s200).
  The "Arcana Rank" vs "Arcane Rank" naming is M5-SC-011.
- **Martial:** Maneuver access ("Unlock Trained Maneuvers"), +1 Signature Maneuver, unarmed combat, counter actions
  (s353–s373). Martial Rank drives Maneuver Effect and Condition limits.
- **Skill + Stat:** "The Skill defines what you are doing. The Stat defines how you are doing it." The Stat is chosen
  per approach (s34–s35, s179–s182). This is preserved as a rule (§18). A Skill Definition never fixes one Stat.
- **Major Definitions:** `SKILL`, `SKILL_RANK` (rank ladder, bonus, value), per-Skill rank grants.
- **Major Compositions:** a Character Build's skill ranks.
- **Runtime dependencies:** the approach-chosen Stat; situational DC.
- **Inputs → outputs:** Skill rank + chosen Stat + Character Die → check result; rank → access facts for Spells and
  Maneuvers.
- **Likely M4 primitives (FUTURE MAPPING):** Requirement (rank ≥ Trained / Expert — RANK_AT_LEAST over a caller-defined
  ladder); Modifier (rank bonus); Formula (automatic-success comparison values).
- **Known conflicts:** M5-SC-011, M5-SC-030.
- **Future WO:** **M5-WO2** (rank primitives). Access rules are consumed by M5-WO5–WO11.

## 4. RACES / CHARACTER OPTIONS

- **Source sections:** s93–s96 STEP 1 — CHOOSE A RACE · s164–s176 RACES (Orcani, Humans, Elves, Dwarves) · s128–s149
  OPTIONAL: JOB CLASSES (Warrior, Thief, Mage, Cleric, Scout) · s151–s157 creation example.
- **Concepts:** Base HP / Base MP modifiers, Stat bonuses, racial features (once-per-mission Counter Action features),
  racial Skills. Job Classes are optional starting templates: Stat spread, 2 Skills, gear. They are not classes.
- **Major Definitions:** `ANCESTRY` (race), job-class templates (future kind).
- **Runtime dependencies:** per-mission feature uses.
- **Likely M4 primitives (FUTURE MAPPING):** Modifier (Stat bonuses); Resource (per-mission uses); Requirement.
- **Known conflicts:** M5-SC-003 (Base HP usage), M5-SC-031.
- **Future WO:** M5-WO2 / Character Builder (M5-WO14+).

## 5. SHARED ACTION ECONOMY

- **Source sections:** s43–s46 Action Points / Common AP Costs · s47–s48 / s434–s435 COUNTER ACTIONS · s49–s55
  COMBAT ROUND BASICS / SHARED PLAYER TURN · s429–s433 THE PLAYER TURN / ACTION POINTS · s652–s655 CHANNELING ·
  s1154 summon action models · s1986 Maneuver cost rules.
- **Concepts:** AP per turn (3 + 1 per 3 AGI), spent in any order, unused AP lost. Common AP costs (Move 1, Sprint 3,
  Light / Balanced / Heavy Attack 1 / 2 / 3, Block 2, Dodge 3, Grapple 1–2, Reload). One Counter Action per round. A
  shared player phase with free ordering. Channeling spreads a Spell's AP over rounds. Maneuvers must be paid in one
  turn. 3 AP is a baseline, not a cap.
- **Major Definitions:** `ACTION` (action catalog and costs), turn-structure rules.
- **Runtime dependencies:** current AP, Counter Action availability, round state, Channel progress.
- **Likely M4 primitives (FUTURE MAPPING):** Resource (AP pool; Counter Action pool; spend / refresh transitions);
  Validation (affordability is a result, never an auto-block).
- **Known conflicts:** M5-SC-026, M5-SC-027.
- **Future WO:** **M5-WO3** Shared Resources & Action Economy.

## 6. SHARED RESOURCES

- **Source sections:** s102–s107 HP / MP / ME · s643–s649 SPELLCASTING RESOURCES / MANA POINTS / MANA EFFICIENCY / MANA
  LOCK · s656–s668 DURATION / SUSTAINED SPELLS / CONCENTRATION · s1158 GLOBAL SUMMON SUSTAIN RULE · s1909–s1911 Mage
  Art activation and maintenance.
- **Concepts:**
  - **HP** (damage track, Downed at 0)
  - **MP** (spent)
  - **Mana Efficiency**: a renewable per-round pool spent BEFORE MP. "ME is not a discount" (s646).
    M5-SC-004 is resolved by the designer.
  - **Mana Lock**: reduces maximum available MP; "Locked MP is not spent"; when it ends, capacity returns but current
    MP does not refill (s648–s649)
  - **Sustain**: per-round MP (ME first) + 1 AP
  - **Concentration**: slots, DC 8 + 2 per extra effect (s664–s666)
  - **Counter Action**
  - Temporary HP / MP (Overdrive, Fusion)
- **Major Definitions:** `RESOURCE` definitions (HP, MP, ME, AP, Counter Action, Concentration capacity).
- **Runtime dependencies:** current, maximum and reserved values; round refresh.
- **Inputs → outputs:** listed cost → payment allocations (ME then MP) → resulting state. Lock amount → reserved
  capacity.
- **Likely M4 primitives (FUTURE MAPPING):**
  - ME payment → Resource Payment with ordered sources (ME, then MP). The listed cost stays unchanged (M5-I023).
  - Mana Lock → Resource Reserve / Release Capacity. It is never a spend (M5-I024).
  - Sustain → per-round Payment.
  - Concentration → Requirement / Validation over explicit counts.
- **Known conflicts:** M5-SC-004 (resolved), M5-SC-007, M5-SC-028.
- **Future WO:** **M5-WO3** (pools and payment) and **M5-WO13** (Sustain / Mana Lock / Concentration policies).

## 7. AFFINITIES

- **Source sections:** s118–s120 STEP 5 — CHOOSE AN AFFINITY · s161 Affinity Advancement · s678–s687 AFFINITY / ARCANE
  AUTHORITY AND AFFINITY AUTHORITY / AFFINITY COST MODIFIERS / QUICK REFERENCE · s716–s733 (one chapter per Affinity:
  Strengths and Weaknesses) · Native Affinity Access tables in every Effect entry (s842 onward) · Affinity Maneuver
  Effects (s2062) · summon Affinity roles (s1152).
- **Canonical Affinities:** **Evocation** (legacy "Emission", M5-SC-001, `RESOLVED_BY_DESIGNER`), Conjuration,
  Transmutation, Divination, Enhancement, Manipulation.
- **Concepts:**
  - Affinity Rank: Trained at L3; Expert or a Secondary Affinity at L6; upgrade, promote or add at L9 (s161).
  - Primary and Secondary Affinity.
  - Strengths reduce MP: Trained −10%, Expert −20%, Master −30% (s685).
  - Weaknesses add MP: Minor +10%, Moderate +20%, Major +30%. Only the highest Weakness from one Affinity applies;
    Strengths and Weaknesses both apply (s686).
  - Strength / Weakness keywords: Traits that add keywords can trigger them (s785–s786).
  - Authority: Arcane Authority (breadth) vs Affinity Authority (efficiency). They do not stack past limits
    (s680–s683).
  - Trait access: qualify through Arcana Rank or an Affinity Rank, which does not make the Trait free (s627).
  - Effect access: native access per Effect.
  - Maneuver interactions: Affinity Maneuver Effects; Affinity-reduced conversion cost (s2016); requirements such as
    "Emission Trained".
  - Summoning interactions: summon roles by Affinity.
- **Major Definitions:** `AFFINITY` (WO1 defines only the canonical identity payload `{ affinity: EVOCATION | … }`).
  Strength / Weakness keyword sets, discount and penalty tables, and access tables come in later WOs.
- **Major Compositions:** an Ability Composition's optional `affinity` component (Spell or Maneuver, M5-I039).
- **Runtime dependencies:** none beyond the build's Affinity ranks.
- **Likely M4 primitives (FUTURE MAPPING):** Keyword resolution (Strength / Weakness keyword membership); Modifier (an
  Affinity cost modifier as a percentage phase with explicit rounding); Requirement (Affinity Rank access).
- **Known conflicts:** M5-SC-001 (resolved), M5-SC-028 (rounding of percentages).
- **Future WO:** **M5-WO4** Affinity Structured Rules.

## 8. ABILITY CONSTRUCTION

The shared grammar. Spell and Maneuver are its two V0.1 branches (designer clarification §5B).

- **Source sections:** s619–s622 SPELLCASTING / WHAT IS A SPELL / BUILDING BLOCKS / SHARED TARGETING RULE · s632
  TARGETING DOES NOT DETERMINE THE SAVE · s715 CORE SPELLCASTING PRINCIPLES · s1978 Maneuvers ("Maneuvers are the
  martial counterpart to Spells") · s1981 Maneuver Anatomy · s1982–s1986 Building a Maneuver.
- **Shared concepts:** Targeting (where / how), Effects (what happens), Traits (how it changes), Duration, Conditions
  (restriction for benefit), Affinity, Resolution (Attack / Save / Automatic), Cost. Effects and Traits are bounded by
  rank-based capacity.
- **Branch-specific:** catalogs, access (Arcana / Affinity Authority vs Martial Rank / weapon / Skill), cost identity
  (Spell = MP-centered, AP derived; Maneuver = AP-centered, MP optional), default Save outcome (half vs none), chain
  rules (Spell only).
- **Major Definitions:** shared contracts `TARGETING`, `EFFECT`, `TRAIT`, `DURATION`, `ABILITY_CONDITION`; branch kinds
  `SPELL_*` / `MANEUVER_*` (see `@prowess/game` `PROWESS_DEFINITION_KINDS`).
- **Major Compositions:** `SpellComposition`, `ManeuverComposition` (`AbilityCompositionBase` + branch data).
- **Runtime dependencies:** actor resources, targets, positions (not part of a Composition, M5-I016).
- **Likely M4 primitives (FUTURE MAPPING):** compiled into EvaluationPlans of Formula / Keyword / Requirement / Modifier
  / Resource / Validation / Explanation steps.
- **Known conflicts:** M5-SC-015, M5-SC-016, M5-SC-017, M5-SC-022.
- **Future WO:** **M5-WO5** Shared Modular Ability Construction Framework; then M5-WO6–WO9.

## 9. SPELLCASTING

- **Source sections:** s619–s733 (spell creation, resources, duration, Casting Conditions, Arcane Rank, Affinity,
  Metamagic, workflow, card template, Affinity chapters) · s734–s778 SPELL EFFECTS / TARGETING TYPES · s779–s831 SPELL
  TRAITS · Effect branches s832–s1145 (DAMAGE s832, DAMAGE TRAITS s855, HEALING SPELL BRANCH s914, CLEANSE EFFECTS
  s929, HEALING TRAITS s947, DEBUFF SPELL BRANCH s974, DEBUFF TRAITS s1007, BUFF SPELL BRANCH s1029, BUFF TRAITS
  s1054, CONTROL SPELL BRANCH s1073, SPELL INTERFERENCE BRANCH s1116, CONTROL TRAITS s1130) · Summoning branch s1146+.
- **Spell Targeting catalog (s628–s631, s750–s775):** Self, Touch, Single Target, Multi-Target, Line, Cone, Radius,
  Zone, Aura, Trigger-Based, Glyph / Anchor (M5-SC-029 — add-ons, not base types; Projectile added, M5-SC-016). Base MP
  per type, range 15 ft × PER, area scaling by PRO,
  scaling upgrades. Line of Sight, Line of Effect and cover.
- **Spell Effect branches:** Damage, Healing, Cleanse, Buff, Debuff, Control, Utility, Summoning, Spell Interference.
  Movement is disputed (M5-SC-013). An Effect entry carries keywords, MP cost, valid Targeting, Roll / Save, effect and
  failure text, duration, scaling, access and Native Affinity Access (s735, s842).
- **Effect capacity:** Trained 1 · Expert 2 · Master 3 by Arcana or Affinity Rank (s624; M5-SC-022). Mixed branches
  are allowed (Damage + Movement, Healing + Cleanse, Summon Weapon + Buff, Control + Debuff — s621, s681).
- **Effect Chains:** ordered Effects. Behaviors Continue / Success Only / Failure Only / Stop / Branch. The default is
  that failure ends the chain. Chains resolve per target (s639–s642; M5-SC-014).
- **Spell Traits:** one shared Trait pool assigned to compatible Effects. Capacity 1 / 2 / 3, plus an exchange of an
  unused Effect slot for a Trait slot. Tiers +5 / +10 / +15 / +20 MP (M5-SC-023). Trait scope may be one Effect or the
  whole Spell (s787–s789). Categories: Damage, Targeting, Duration, Condition, Control, Trigger, Defensive, Metamagic,
  Drawback.
- **Duration (s656–s668):** Instant, Rounds, Combat, Scene, Mission, Sustained, Mana Lock, Permanent (special).
- **Casting Conditions (s669–s676):**
  - Verbal: −10% MP.
  - Somatic: −1 AP, minimum 1.
  - Material: benefit depends on the material.
  - Additional Conditions: Immobile, Anchored, Charge, Delayed, Environmental, Limited Use, Risk, Focus.
  - Reduction caps by rank (M5-SC-021). Applied after Affinity.
- **Cost pipeline (s644–s651, s661):**
  - Total MP = Targeting + Effects + Traits + Duration + Special.
  - Then Affinity Strengths and Weaknesses, then Casting Conditions, then "final rounding" (M5-SC-028).
  - Spell AP = Total MP ÷ PRO, rounded down, minimum 1, then AP modifiers (Somatic).
  - Sustain MP = Total MP ÷ PRO, rounded down, minimum 1, plus 1 AP per round.
- **Resolution:** Attack Roll (vs Evasion), Saving Throw (vs Character DC; Damage Saves come from the Physical or
  Magical family, half damage on success), or Automatic. The Effect defines resolution; Targeting never does (s632).
- **Major Definitions:** `SPELL_TARGETING`, `SPELL_EFFECT`, `SPELL_TRAIT`, `SPELL_DURATION`, `SPELL_CASTING_CONDITION`;
  Metamagic options.
- **Major Compositions:** a Spell (Signature Spell card s710–s714).
- **Runtime dependencies:** caster PRO / PER / ME / MP / AP / Concentration; targets; Line of Sight; cover.
- **Likely M4 primitives (FUTURE MAPPING):**
  - Formula: Total MP; AP = floor(listed MP ÷ PRO), minimum 1; Sustain; range and area.
  - Modifier: Affinity and Casting Condition percentage phases.
  - Requirement: rank and access.
  - Resource Payment: ME, then MP. The listed cost is never rewritten.
  - Resource Reservation: Mana Lock.
  - Keyword: Strength and Weakness matching.
  - Validation and Explanation.
- **Known conflicts:** M5-SC-011, M5-SC-013, M5-SC-014, M5-SC-016, M5-SC-021, M5-SC-022, M5-SC-023, M5-SC-024,
  M5-SC-028, M5-SC-029.
- **Implemented:** M5-WO6 Targeting framework and catalogs (`m5-targeting-framework.md`).
- **Future WO:** WO7 (Effects), WO8 (Traits), WO9 (Duration & Conditions), **WO10 (Spell
  cost)**, WO12 (Resolution & Effect Chains), WO13 (Sustain / Mana Lock / Concentration).

## 10. MANEUVERS

- **Source sections:** s1978 Maneuvers · s1979 At a Glance · s1980 Martial Rank · s1981 Anatomy · s1982–s1986 Building
  (Foundation, Effects, Cost) · s1987–s1992 Attack Rolls and Saving Throws · s1993–s1995 Damage · s1996–s1997 Powerful
  Blow · s1998–s2008 AoE · s2009–s2011 Commitment Scaling · s2012–s2017 Elemental Damage Conversion · s2018–s2020
  Maneuver Conditions · s2021–s2022 Signature Maneuvers · s2023–s2063 Maneuver Effect Catalog · s2064–s2070 Card
  Template · s2071–s2093 Examples / GM Checklist · s2094–s2119 Maneuver Conditions chapter.
- **Concepts:**
  - Access: Martial training; Martial Rank with Rank Value 1 / 2 / 3.
  - Effect limit: 1 Maneuver Effect per Martial Rank. Maneuvers combine multiple Effects (§40).
  - **Foundation**: Light / Balanced / Heavy attack, Move, Run, Sprint, Block, Powerful Blow.
  - **Cost** = Base Actions + Maneuver Effects − Conditions. AP-centered; MP is added only when an Effect requires
    mana. Minimum 1 AP; an attack floor; must be paid in one turn.
  - Signature Maneuver: −1 AP, minimum 1.
  - Resolution: Attack Roll vs Evasion, or Save Profiles. Martial Rank restricts Save choice. The default on a
    successful Save is no damage and no effect.
  - Damage: weapon damage instances = 1 + floor(STR ÷ Power); Commitment Die by Base AP; die step.
  - Powerful Blow: combined attacks resolved once.
  - AoE: added AP (Sweep +1, Line / Cone +2, Radius / Chain / Zone +3).
  - Radius origins: Thrown, Ranged, Emitted. Radius size is M5-SC-018.
  - Critical upgrades: only when an Effect lists one.
- **Maneuver Effect catalog families:** Damage / Conversion · Save-Based Attack (+ Glancing Blow) · Targeting
  Conversion (M5-SC-015) · Range / Reach · Damage Dice / Commitment · Power / Stat Scaling · Armor / Defense · Control ·
  Martial Condition Effects · Mobility · Guard / Counter · Terrain · Firearm / Engineering · Unarmed / Grapple ·
  Affinity Maneuver Effects (Enhancement, Evocation (source: Emission), Transmutation, Manipulation, Divination,
  Conjuration).
- **Maneuver Conditions (s2094–s2119):** Timing, Movement, Defensive Risk, Accuracy and Failure, Target, Weapon,
  Resource, Environmental, Positional, Tactical State, Counter Action, AoE, Ally / Teamwork, Magic / Affinity.
  - Limit by rank: 1 / 2 / 3.
  - Discount scale −1 / −2 / −3 AP; total cap −3 AP (M5-SC-025).
  - Examples: Must Move First, Must Be Stationary, Target Must Be Flanked / Unaware / Bloodied, Weapon Lock.
- **Absent from V0.1:** Maneuver Trait catalog, Maneuver Targeting catalog, Maneuver Duration costs (M5-SC-017).
- **Major Definitions:** `MANEUVER_FOUNDATION`, `MANEUVER_TARGETING`, `MANEUVER_EFFECT`, `MANEUVER_TRAIT` (no content),
  `MANEUVER_DURATION`, `MANEUVER_CONDITION`.
- **Major Compositions:** a Maneuver (card s2064–s2070).
- **Runtime dependencies:** weapon in hand, STR / AGI / PER / PRO, movement this turn, target state (flanked,
  unaware, Bloodied), AP and MP.
- **Likely M4 primitives (FUTURE MAPPING):**
  - Formula: weapon instances (floor declared); AoE sizes; AP total.
  - Modifier: Condition discounts with caps.
  - Requirement: Martial Rank, weapon, Affinity, and condition facts. Condition requirements are construction
    restrictions, not status application (M5-I040).
  - Resource Payment: AP, plus MP when an Effect requires it.
- **Known conflicts:** M5-SC-002, M5-SC-005, M5-SC-015, M5-SC-017, M5-SC-018, M5-SC-025, M5-SC-026.
- **Future WO:** M5-WO6–WO9 (catalogs and contracts), **M5-WO11** (Maneuver cost / AP / MP), M5-WO12 (resolution).

## 11. MAGE ARTS

- **Source sections:** s1905–s1913 Chapter — Mage Arts / Mage Art Rules · s1914–s1971 Mage Arts Compendium (Barrier,
  Domain, Focus, Overdrive, Stalker, Reinforcement — Object / Weapon modes, Contract) · s1972 Quick Reference · s1973–s1977
  GM Playtest Notes.
- **Concepts:**
  - Mage Arts are fixed disciplines. They are **not** built from modular spell components (s1906), so they are outside
    Ability Construction.
  - Each counts as a Signature Ability.
  - **Activation**: listed MP + AP.
  - **Maintenance**: MP and / or AP paid at the start of each turn, or a special cost such as Overdrive's overload
    damage. The Art ends if maintenance is unpaid.
  - **AP / MP commitment**: ME is used before MP.
  - **Active effect capacity**: each counts as an Active Effect while maintained (Contract only while casting).
  - **Signature Ability investment**.
  - **Ending**: dismissal, failed maintenance, unconsciousness, dispel, or a specific condition.
  - **Stacking**: several different Arts are allowed if capacity permits; the same Art cannot be active twice.
  - **Identity / stance behavior**: build-defining stances (s1977). Overdrive has a cooldown and a knockout clause.
- **Major Definitions:** `MAGE_ART` (reserved). Each Art is one fixed Definition with modes (Reinforcement).
- **Runtime dependencies:** active state, round count (Overdrive overload), ME / MP / AP, Level-based tables.
- **Likely M4 primitives (FUTURE MAPPING):** Resource Payment (activation, maintenance); Modifier (Attack bonus by
  Level, Evasion Stat substitution); Formula (Domain radius 15 ft × RES; overload CD per round); Validation (active
  effect capacity).
- **Known conflicts:** M5-SC-005 (Barrier's "Evasion"), M5-SC-007 (active effect capacity).
- **Future WO:** M5-WO14+ (Mage Arts), after M5-WO3 / WO13.

## 12. EQUIPMENT

- **Source sections:** s124–s127 STEP 7 — CHOOSE STARTING GEAR · s512–s538 WEAPONS (entries, families, categories,
  handedness, Power, movesets, move AP, damage types, mechanical ranged, fire modes, dual wielding) · s539–s560 ARMOR ·
  s561–s577 SHIELDS (incl. s577 SHIELDS AND SPELLCASTING) · s578–s611 weapon families · s612–s618 WEAPON PROPERTIES AND
  MOVE PROPERTIES · Equipment Summoning s1808–s1904.
- **Dependencies required by other systems:**
  - Maneuvers: weapon category and moves for the Foundation and AP; Power; damage dice and type; range / Reach;
    properties (weapon requirements such as Reach, Piercing, Heavy, Thrown); firearm Ammo / Loading / Recoil.
  - Summoning: summoned weapons and armor follow normal item rules unless a Trait changes them. Base weapon / armor
    models (s1812–s1813); equipment trait tiers +5 / +10 / +15 / +20 MP.
  - Weapon interaction: Power, with Damage Dice = 1 + ⌊STR ÷ Power⌋ and a minimum Power of 2 (s519). Versatile die
    step (s517). Dual wielding.
  - Armor interaction: Armor value, Strength requirement, Dodge caps, stealth / movement effects, STR scaling.
  - Shields: Light / Balanced / Heavy; cover; bashes; Somatic casting restrictions.
  - Modular equipment traits (summoned gear).
- **Major Definitions:** `WEAPON`, `ARMOR`, `EQUIPMENT_TRAIT` (reserved).
- **Likely M4 primitives (FUTURE MAPPING):** Formula (damage instances with floor declared, range); Requirement
  (STR requirement, handedness); Modifier (armor, die step).
- **Known conflicts:** M5-SC-026, M5-SC-027.
- **Future WO:** Equipment integration (M5-WO14+). Equipment is a dependency of M5-WO11.

## 13. SUMMONING

- **Source sections:**
  - s1146–s1197: SUMMONING SPELL BRANCH (core concept, Signature slots, timing, modularity, base effect, no automatic
    actions, action economy, duration models, global sustain, Concentration, maximum active summons, dismissal,
    targeting, subtrees, summary, card, workflow, limits).
  - s1198–s1322: SUMMON ENTITY CREATION ENGINE.
  - s1323–s1418: TOTEM.
  - s1419–s1541: PERSISTENT CONSTRUCT.
  - s1542–s1673: BOUND SUMMON.
  - s1674–s1763: MANIFESTED ENTITY.
  - s1764–s1807: FUSION.
  - s1808–s1904: EQUIPMENT SUMMONING.
- **Summon types (s1181):** Entity, Totem, Bound, Construct, Manifested Entity, Fusion, Structure, Gear, Glyph,
  Vehicle. Dependent / Independent also appear as subtrees (M5-SC-019).
- **Building blocks (§119):**
  - Summon Type; Tier (1–5) or Base Effect (Tier MP 10 / 20 / 35 / 50 / 60).
  - Affinity (summon roles by Affinity).
  - Targeting: Touch, Summon Point, Zone, Glyph, Anchor, Ranged, Self.
  - Duration: Periodic or Sustained Manifestation.
  - Action Model.
  - Stats: six, starting at 1, plus Tier points with a cap.
  - HP = (Base HP Score + CON) × Tier. MP pool (s1285). AP: base 2, maximum 2 + "Summoning Rank Value"
    (M5-SC-020).
  - Saves, Armor, Evasion, Resistance.
  - Actions: base actions and purchased effects; Traits; Auras; Zones (Totems); Triggers (Glyphs).
  - Sustain = Total MP ÷ PRO, rounded down, minimum 1, plus 1 AP.
  - Concentration (Sustained summons count). Maximum active summons = ½ PRO, rounded up.
- **Action models (§121):** Dependent, Independent, Passive, Template-Based, Self-Bound, Split Resource (s1154).
  Runtime behavior is not implemented in WO1.
- **No implicit capabilities (§122, M5-I026):** "A Summon does not automatically attack, move, cast, defend, heal, or
  apply Conditions." Summons gain no extra actions unless explicitly granted (s1153–s1154, s1191). Every capability
  must come from an authored Type, Action Model, template, Trait or Effect Chain.
- **Major Definitions:** `SUMMON_TYPE`, `SUMMON_TRAIT`, `SUMMON_ACTION_MODEL` (all reserved in WO1).
- **Major Compositions:** a Summon (Signature Ability; Summon Card).
- **Runtime dependencies:** summon HP / AP, directive, caster Concentration, Sustain payments.
- **Likely M4 primitives (FUTURE MAPPING):** Formula (Tier HP, MP, AP, Sustain); Resource (summon pools; caster sustain
  payment; Mana Lock); Requirement (Arcana / Affinity access, maximum active summons); Validation.
- **Known conflicts:** M5-SC-019, M5-SC-020.
- **Future WO:** M5-WO14+ Summoning (after Ability Construction, cost and Sustain WOs).

## 14. CONDITIONS / STATUS

- **Source sections:** s71–s77 Conditions (Applying, Duration, Removal, Stacking, Categories, Examples, Resolution) ·
  s500 CONDITIONS IN COMBAT · s809–s810 CONDITION TRAITS · s837 Damage Does Not Add Conditions Automatically · s2042–s2055
  Martial Condition Effects (Bleed, Stunned, Dazed, Deep Wound …) · Cleanse effects s929–s940.
- **Concepts:**
  - A status Condition is a state applied to a creature. It defines Effect, Duration and Removal.
  - It applies only when its source effect resolves (failed Save, hit, ongoing).
  - It does not stack with itself unless stated; reapplying refreshes or escalates.
  - Categories: Control, Debuff, Damage Over Time, Movement.
  - Examples: Stunned, Burning, Restrained, Chilled, Shocked, Poisoned, Blinded, Dazed, Silenced, Bleed, Prone,
    Grappled, Bloodied (≤ half HP), Weakened.
  - Some are defined twice (e.g. Stunned at s76 vs s2045).
- **Distinction (§125, M5-I040):** a **Casting Condition / Maneuver Condition** restricts USING an Ability. A **status
  Condition** is applied TO a target. "Target Must Be Bloodied" requires that state; it never applies it. A Damage type
  never applies a Condition by itself ("Fire damage does not automatically apply Burning", s837; M4 keyword rule).
- **Major Definitions:** `STATUS_CONDITION` (reserved; family CONDITION), distinct from `SPELL_CASTING_CONDITION` /
  `MANEUVER_CONDITION`.
- **Runtime dependencies:** active statuses, durations, removal triggers.
- **Likely M4 primitives (FUTURE MAPPING):** Requirement (status presence as an explicit fact); Modifier (status
  penalties); Validation.
- **Known conflicts:** M5-SC-012 (resolved). Duplicate Stunned definitions are recorded here for M5-WO12.
- **Future WO:** M5-WO12 (Resolution / ordered Effects) and the conditions content work in M5-WO14+.

## 15. OTHER MECHANICAL FAMILIES FOUND IN SOURCE

| Family | Source sections | Notes | Future WO |
| --- | --- | --- | --- |
| Combat positioning | s441–s466 (grid scale, reach, range categories, LoS / LoE, cover materials and damage threshold, creatures as cover, stealth and cover), s491 GRAPPLING, s498 FLANKING, s499 HIGH GROUND, s501 TEAMWORK | Positional facts feed Requirement inputs (flanked, unaware, cover) | M5-WO12 / runtime work |
| Death & Dying | s77–s84 (Downed, Death Saves Body / Mind / Spirit, Lethal vs Non-Lethal) | Runtime state machine | later |
| Metamagic | s688–s690, s819–s820 | Casting vs Embedded (Trait) Metamagic | M5-WO8 / later |
| Signature Abilities | s121–s123, s1148, s1908, s2021 | Slot capacity = PRO; filled by Spells, Maneuvers, Mage Arts, Summons | M5-WO5 (capacity), Builder |
| Mission system | s2120–s2486 (contract grades, mission types, threat clocks, mission turns, rewards, downtime, operations) | Non-combat procedural system; family `MISSION` (reserved) | out of M5 core scope |
| Leveling | s158–s162 | Level table and Stat Mastery (Advantage at 10) | M5-WO2 |

---

## Recommended M5 dependency order (from this audit)

| WO | Scope | Key source dependencies | Blocking rulings |
| --- | --- | --- | --- |
| M5-WO2 | Core Resolution, Stats, Dice & Rank Primitives | §1–§4 | M5-SC-002, 003, 005, 006, 008, 009, 010, 011, 030 |
| M5-WO3 | Shared Resources & Action Economy | §5–§6 | M5-SC-007, 026, 027 |
| M5-WO4 | Affinity Structured Rules | §7 | M5-SC-028 (percent rounding) |
| M5-WO5 | Shared Modular Ability Construction Framework (capacities, access, Signature slots) | §8 | M5-SC-022 |
| M5-WO6 | Targeting Framework + Spell / Maneuver catalogs | §9–§10 | M5-SC-015, 016, 018, 024, 029, 039, 040 |
| M5-WO7 | Effect Framework + Spell / Maneuver Definition contracts | §9–§10 | M5-SC-013, 016 |
| M5-WO8 | Trait Framework + Spell / Maneuver contracts | §9 | M5-SC-017, 023, 024 |
| M5-WO9 | Duration & Ability Conditions | §9–§10, §14 | M5-SC-021, 025 |
| M5-WO10 | Spell Cost / MP / AP compilation | §9 | M5-SC-004 (resolved), 021, 028 |
| M5-WO11 | Maneuver Cost / AP / MP compilation | §10, §12 | M5-SC-015, 025, 026 |
| M5-WO12 | Resolution / ordered Effects / Effect Chains | §1, §9, §14 | M5-SC-014, 005 |
| M5-WO13 | Sustain / Mana Lock / Concentration | §6 | M5-SC-007 |
| M5-WO14+ | Summoning, Mage Arts, Equipment integration, content authoring, Builders | §11–§13, §15 | M5-SC-019, 020 |

**Refinement versus the WO1 draft sequence:** the audit confirms the order. It adds one recommendation: obtain
designer rulings on the core-resolution conflicts (M5-SC-002, 003, 005, 008, 009, 010) **before** M5-WO2 starts.
M5-WO2 cannot build Character DC, Dodge / Evasion or HP / MP formulas without guessing. Equipment (weapon AP by
category vs by move, M5-SC-026) is a prerequisite of M5-WO11 and should be ruled on by then.
