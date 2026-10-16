# M5 — Core Playtest Source Conflicts (M5-WO1)

**Source audited:** Prowess Core Playtest Packet V0.1. The designer's local copy (98,897,516 bytes, SHA-256 prefix
`21fa6771…`) was verified byte-identical to the source identity recorded in
`docs/import-reports/m3-wo9-core-playtest-v0.1.md` (M3-I19: the full identity lives only there).
Parsed with the approved M3 parser `prowess-docx-structure@1.0.0` (structure hash `3d9a429c…f1e7`, 2,487 sections).

**Locators.** `sNNN` is the parser's deterministic section key for that structure hash, followed by the section's
title path. Wording is quoted only as far as needed to identify the rule. The DOCX is not in the repository.

**Authority precedence (M5-WO1 §6):** (1) explicit designer clarifications in M5-WO1, (2) approved CanonDecisions,
(3) Core Playtest V0.1, (4) older supporting sources. Lower-authority text is never rewritten; structured M5
architecture follows the higher authority.

**Statuses:** `UNRESOLVED` · `RESOLVED_BY_DESIGNER` · `RESOLVED_BY_CANON_DECISION` · `SUPERSEDED`.

`UNRESOLVED` means that no designer or Canon ruling exists. WO1 records the problem and does not choose an answer.
Every later Work Order that implements an affected rule must get a ruling first. It must not guess one.

**Canon governance note (§13).** The repository has a `CanonDecision` model (M2-WO5). Designer clarifications in a
Work Order are recorded here. WO1 does not write them as CanonDecision rows, because it creates no persistence
workflow. If the project wants every terminology ruling stored as a CanonDecision, that is an explicit Canon Manager
action for a later step. No Ruleset, Release, EntityVersion or ImportCandidate was changed by WO1.

---

### M5-SC-001 — Evocation / Emission

- **conflictKey**: `M5-SC-001`
- **systemFamily**: `AFFINITY`
- **concept**: Name of the projection / force / direct-output Affinity
- **source A**: s118 STEP 5 — CHOOSE AN AFFINITY (table: "Evocation"); s716 EVOCATION (chapter title); s786 TRAITS AND
  AFFINITY > Affinity Example ("Evocation discount"). 7 occurrences of "Evocation".
- **source B**: s679 AFFINITY > The Six Affinities ("Emission"); s687 AFFINITY QUICK REFERENCE; every Native Affinity
  Access table in the Spell Effect branches (s842 onward); Maneuver requirements (s2005, s2028, s2033, s2062).
  116 occurrences of "Emission".
- **mechanical consequence**: two names for one Affinity. Without a ruling, Affinity access, discounts and Maneuver
  requirements could split into two Affinities.
- **status**: `RESOLVED_BY_DESIGNER`
- **resolution authority**: M5-WO1 §5A, §7 (designer clarification)
- **notes**: canonical: Evocation · legacy: Emission · structured token `EVOCATION`. Historical source text keeps
  "Emission" verbatim. Provenance may record the pair `{ legacyTerm: "Emission", canonicalTerm: "Evocation" }`.
  Emission is never a canonical structured value. Guarded by M5-I037 and negative controls §218 and §219.

### M5-SC-002 — Player Dice vs Character Die

- **conflictKey**: `M5-SC-002`
- **systemFamily**: `CORE`
- **concept**: The die a character rolls for core rolls, and the unit of dice-based effects
- **source A**: "Character Die" (105) / "Character Dice" (70): s13 THE CORE ROLL, s16 CHARACTER DICE (Level → d4…d12),
  s56 ATTACK ROLLS, s38 SAVING THROWS, s43 CHARACTER DC, s179 USING SKILLS, s634 Spell Attack Rolls, s1913 (Mage Arts
  "CD").
- **source B**: "Player Dice" (19) / "Player Die" (2): s192 Analyze Magic, s240 Awareness Check, s265 Burglary Check
  (skill checks, where s179 uses Character Die); s1575–s1583 / s1650–s1660 Bound attack profiles; s1988 Maneuver
  Attack Roll; s1995 / s2010 ("The Commitment Die is not Player Dice"); s1199 / s1552 ("Summon Dice instead of Player
  Dice", "Bound Dice do not replace the caster's Player Dice"); s2062 Limit Break Blow / s2104 Heavy HP Strain ("1
  Player Die True Damage").
- **mechanical consequence**: in the skill-check and attack formulas, Player Dice reads as a legacy synonym for
  Character Die. In the Summon / Bound / Commitment contexts it names "the caster's own die" in contrast with a
  system-specific die. In the True Damage costs it is unclear whether one die is rolled at the Character Die size.
- **status**: `UNRESOLVED`
- **resolution authority**: none. WO1 §9 forbids normalizing this.
- **notes**: audit classification: skill-check / attack usages = likely LEGACY synonym; Summon / Bound / Commitment
  usages = CONTEXT_SPECIFIC contrast with a system die; True Damage usages = UNRESOLVED. No true separate concept was
  found. Terminology inventory: "Player Dice" / "Player Die" = `UNRESOLVED`. Needs a ruling before M5-WO2.

### M5-SC-003 — HP and MP formulas

- **conflictKey**: `M5-SC-003`
- **systemFamily**: `CHARACTER`
- **concept**: Starting HP and MP
- **source A**: s24 Constitution: "HP = CON × Racial HP Modifier"; s26 Resolve: "MP = RES × Racial MP Modifier".
- **source B**: s94 Racial Resources / s102 Health Points / s103 Mana Points: "HP = Base HP + CON", "MP = Base MP + RES",
  with worked examples (s95: Human 8 + 4 = 12 HP; s156: Orcani 10 + 4 = 14 HP). Races list "Base HP Modifier".
- **mechanical consequence**: multiplicative and additive formulas give very different values (e.g. CON 4 × 10 = 40
  against 10 + 4 = 14).
- **status**: `UNRESOLVED`
- **resolution authority**: none
- **notes**: Character Creation and its examples consistently use the additive form. The Ability Score chapter uses
  the multiplicative form. WO1 does not choose. M5-WO2 needs a ruling.

### M5-SC-004 — Mana Efficiency: payment, not discount

- **conflictKey**: `M5-SC-004`
- **systemFamily**: `RESOURCE`
- **concept**: What Mana Efficiency does to a cost
- **source A**: s27 Prowess: "Flat Pool of MP that can be used to reduce MP cost Per Round"; s1158 / s1298 / s1361 /
  s1511 / s1635 / s1752: "Mana Efficiency may reduce Sustain cost normally".
- **source B**: s646 MANA EFFICIENCY: "ME is spent before MP … ME is not a discount. It is temporary mana."; s647 example
  (8 MP spell paid 5 ME + 3 MP); s715 CORE SPELLCASTING PRINCIPLES: "Mana Efficiency pays before MP, but is not a
  discount."
- **mechanical consequence**: under the "reduce cost" wording, ME would rewrite the listed cost, and that would change
  every derived value that reads it (e.g. Spell AP = Total MP ÷ PRO).
- **status**: `RESOLVED_BY_DESIGNER`
- **resolution authority**: M5-WO1 §140 (designer: "Mana Efficiency is Resource payment. It is NOT cost reduction.
  Listed MP 17 … Spell remains listed at 17."), carrying forward the approved M4 invariant M4-I14. Consistent with
  source s646 and s715.
- **notes**: the "reduce … cost" phrases are read as "pay part of the cost". The listed cost never changes (M5-I023).
  Mana Efficiency is deliberately absent from `COST_CURRENCIES`.

### M5-SC-005 — Dodge vs Evasion as the attack defense

- **conflictKey**: `M5-SC-005`
- **systemFamily**: `CORE`
- **concept**: The defense value an Attack Roll must meet
- **source A**: s56 ATTACK ROLLS ("Most weapon attacks target Dodge"); s57 / s105 "Dodge = ½ Character Die + AGI";
  s59 Critical Hits ("meet or exceed the target's Dodge").
- **source B**: s25 Perception: "Evasion: +1 per 3 PER"; s634 Spell Attack Rolls ("meets or exceeds the target's
  Evasion"); s838 / s839 Damage Resolution ("against target Evasion"); s1988 Maneuver Attack Roll ("target's
  Evasion"); s1917 Barrier ("Evasion = Half Character Dice + chosen Stat … instead of Agility", which is Dodge's
  formula under another name); s370 Parry ("+1 Evasion per Martial Rank").
- **mechanical consequence**: it is unclear whether Evasion is a separate defense value (a PER bonus to something),
  a synonym for Dodge, or a defense used only by magic and Maneuvers. This affects every Attack Roll.
- **status**: `UNRESOLVED`
- **resolution authority**: none
- **notes**: both are recorded as `UNRESOLVED` in the terminology inventory. Neither is normalized.

### M5-SC-006 — Movement formula

- **conflictKey**: `M5-SC-006`
- **systemFamily**: `CHARACTER`
- **concept**: Base Movement
- **source A**: s23 / s69 / s104: "Movement = 5 × AGI" (example s70: AGI 4 → 20 ft).
- **source B**: s156 Character Creation Example: "Movement: 10 × AGI 2 = 20 ft (+5 Athletics)".
- **mechanical consequence**: the multiplier is doubled. The example also adds an unexplained Athletics bonus.
- **status**: `UNRESOLVED`
- **resolution authority**: none
- **notes**: probably an error in the example. It is still recorded and not repaired (§10).

### M5-SC-007 — Concentration capacity

- **conflictKey**: `M5-SC-007`
- **systemFamily**: `RESOURCE`
- **concept**: How many Concentration / Active Effects a character can maintain
- **source A**: s26 Resolve: "Concentration: +1 per 3 RES. The Maximum number of Active Effects a character can
  sustain at one time."
- **source B**: s664 Concentration Capacity: "Concentration Slots = 1 + 1 per 2 Resolve"; s197 Expert Arcana "+1 to
  Concentration Total"; s1911 / s1974 Mage Arts count against "active effect limits / Active Effect capacity".
- **mechanical consequence**: different capacities at the same RES. It is also unclear whether "Active Effects" and
  "Concentration Slots" are the same pool.
- **status**: `UNRESOLVED`
- **resolution authority**: none
- **notes**: affects M5-WO13 (Sustain / Mana Lock / Concentration) and Mage Arts.

### M5-SC-008 — Character DC composition

- **conflictKey**: `M5-SC-008`
- **systemFamily**: `CORE`
- **concept**: Character DC
- **source A**: s43 / s637: "Character DC = ½ Character Die + PRO + bonuses".
- **source B**: s26 Resolve: "Character DC: +1 per 3 RES"; s637: "Some features may also add bonuses from Resolve, Arcana
  Rank, Affinity Rank …".
- **mechanical consequence**: it is unclear whether the RES term belongs in the base formula or is an optional feature
  bonus.
- **status**: `UNRESOLVED`
- **resolution authority**: none
- **notes**: M5-WO2.

### M5-SC-009 — Prowess bonus to Attack Rolls

- **conflictKey**: `M5-SC-009`
- **systemFamily**: `CORE`
- **concept**: Attack Roll formula
- **source A**: s56 / s634 / s1988: "Attack Roll = Character Die (Player Dice) + PER + bonuses"; s25 "PER is added to
  all base attack rolls".
- **source B**: s27 Prowess: "Attack Rolls: +1 per 3 PRO".
- **mechanical consequence**: it is unclear whether a standing PRO-derived bonus applies to every Attack Roll.
- **status**: `UNRESOLVED`
- **resolution authority**: none
- **notes**: M5-WO2.

### M5-SC-010 — Advantage / Disadvantage undefined

- **conflictKey**: `M5-SC-010`
- **systemFamily**: `CORE`
- **concept**: The mechanics of Advantage and Disadvantage
- **source A**: about 114 uses (e.g. s162 Stat Mastery, s371 Feint, s1917 Barrier, s1928 Focus, s2020 Exposed Drive).
- **source B**: only stacking statements (s990 / s991 "does not stack", s1041). No rule defines what Advantage does
  to a roll.
- **mechanical consequence**: there is no executable definition (roll twice? a flat bonus? a die step?).
- **status**: `UNRESOLVED`
- **resolution authority**: none
- **notes**: M4 already models Advantage / Disadvantage as roll SIGNALS only (M4-WO6). M5-WO2 needs a source ruling.

### M5-SC-011 — Arcane Rank vs Arcana Rank

- **conflictKey**: `M5-SC-011`
- **systemFamily**: `SPELL`
- **concept**: The rank that governs general spell construction
- **source A**: s677 ARCANE RANK; "Arcane Authority" (s624, s680); s783 "Arcane/ Affinity Rank"; s825 "Arcane Rank".
- **source B**: "Arcana Rank" (17×: s624, s627, s637, s1226 "Arcana: Expert"); the Skill is named "Arcana" (s185).
- **mechanical consequence**: it is unclear whether Arcane Rank is the Arcana Skill's rank or a separate track.
- **status**: `UNRESOLVED`
- **resolution authority**: none
- **notes**: the context strongly suggests the same concept (the Arcana Skill rank). It is not normalized (§10).

### M5-SC-012 — "Condition" names four different concepts

- **conflictKey**: `M5-SC-012`
- **systemFamily**: `CONDITION`
- **concept**: Construction restrictions vs status states
- **source A**: status Conditions applied to targets (s71 Conditions, s76 Stunned / Burning / Restrained, s809
  CONDITION TRAITS).
- **source B**: Casting Conditions (s669–s676), Maneuver Conditions (s2018–s2020, s2094–s2119) and Martial Condition
  Effects (s2042, which apply statuses).
- **mechanical consequence**: if these are merged, a construction restriction could be read as applying a status
  (e.g. "Target Must Be Bloodied").
- **status**: `RESOLVED_BY_DESIGNER`
- **resolution authority**: M5-WO1 §5F, §50–53, §125
- **notes**: the generic architectural term is ABILITY_CONDITION, with branch families `SPELL_CASTING_CONDITION` and
  `MANEUVER_CONDITION`. A state applied to a target is a separate `STATUS_CONDITION` kind. Martial Condition Effects
  are Maneuver EFFECTS that may apply a status explicitly. Guarded by M5-I040 and control §230.

### M5-SC-013 — Spell Effect branches (Movement, Cleanse, Spell Interference)

- **conflictKey**: `M5-SC-013`
- **systemFamily**: `SPELL`
- **concept**: The set of Spell Effect branches
- **source A**: s621 SPELL EFFECTS ARE BUILDING BLOCKS: 10 branches: Damage, Healing, Cleanse, Buff, Debuff, Control,
  Movement, Utility, Summoning, Spell Interference.
- **source B**: s736 Spell Branch Overview: 7 branches (no Cleanse, Movement or Spell Interference). Control there
  "force[s] positioning … push, pull" (s745), and Push / Pull are Control Traits (s812). Cleanse appears inside the
  HEALING SPELL BRANCH (s929). SPELL INTERFERENCE BRANCH exists (s1116). There is no Movement Effect catalog
  section.
- **mechanical consequence**: it is unclear whether Movement is its own Effect family (with costs and catalog) or a
  Control / Trait function. Cleanse may be its own family or a Healing sub-branch.
- **status**: `UNRESOLVED`
- **resolution authority**: none
- **notes**: WO1 records `MOVEMENT` as `UNRESOLVED` in the terminology inventory. M5-WO7 needs a ruling. The WO1
  structural contract allows any explicit `effectFamily` token, so no architecture change is needed either way.

### M5-SC-014 — Effect Chain default behaviour

- **conflictKey**: `M5-SC-014`
- **systemFamily**: `SPELL`
- **concept**: What happens after an Effect fails in an Effect Chain
- **source A**: s639 / s640 EFFECT CHAINS: per-Effect Chain Behavior (Continue, Success Only, Failure Only, Stop,
  Branch). "If no Chain Behavior is listed, the default is: Failure ends the chain."
- **source B**: s776 EFFECT CHAINS IN SPELL EFFECTS: "If one Effect fails, every Effect after it fails." (absolute, with
  no behaviors).
- **mechanical consequence**: it is unclear whether Continue / Branch behaviors exist at all.
- **status**: `UNRESOLVED`
- **resolution authority**: none
- **notes**: the two agree if s776 describes only the default. WO1 does not apply Spell chain rules to Maneuvers (§42).

### M5-SC-015 — Maneuver AoE: Targeting Conversion as an Effect that carries a Save profile

- **conflictKey**: `M5-SC-015`
- **systemFamily**: `MANEUVER`
- **concept**: Where Maneuver AoE geometry and its resolution live
- **source A**: s1984 ("Targeting Conversion counts as a Maneuver Effect"); s2027 / s2005 / s2028 / s2029 (Line / Cone /
  Radius Attack Conversion each list a fixed Save, e.g. "Radius … Save: Agility or Prowess"); s1992 Common Save
  Profiles keyed by shape ("Radius Attack — Agility, Prowess, Constitution").
- **source B**: designer clarifications M5-WO1 §5C, §5D, §5E and §27 (Targeting decides delivery, never resolution;
  Spell and Maneuver Targeting are separate Definition families sharing geometry); spell rule s632 "TARGETING DOES
  NOT DETERMINE THE SAVE … A Radius spell is not automatically an Agility Save."
- **mechanical consequence**: (a) Does a Maneuver's AoE conversion use up a Maneuver Effect slot (s1984) once it is
  modeled as MANEUVER_TARGETING? (b) Which Definition owns the AP cost (+3 AP for Radius) and the Save profile?
- **status**: `UNRESOLVED`
- **resolution authority**: the designer has resolved the architecture (geometry vs outcome). The slot, cost and
  save-profile allocation still needs a ruling.
- **notes**: WO1 architecture: geometry is a MANEUVER_TARGETING Definition. The Save profile is authored resolution
  data and is never derived from shape (M5-I022). Whether the conversion also counts as an Effect is a content rule
  for M5-WO6 / M5-WO11.

### M5-SC-016 — Effect / Targeting compatibility and "Projectile"

- **conflictKey**: `M5-SC-016`
- **systemFamily**: `SPELL`
- **concept**: Which Targeting Types a Damage Effect may use
- **source A**: s750 TARGETING TYPES: "A Direct Damage effect may work with Single Target, Line, Cone, Radius, or
  Zone."
- **source B**: s842 I. DIRECT DAMAGE: "Targeting Compatibility: Single Target, Touch, Projectile" ("Projectile is
  treated as a Single Target delivery type"); s843 II. AREA DAMAGE: "Keywords … Radius, Zone"; "Shape: Radius". Projectile
  is not in the Targeting Type table (s628).
- **mechanical consequence**: different compatibility sets. Effects also carry shape keywords, which pulls the Effect
  toward Targeting.
- **status**: `UNRESOLVED`
- **resolution authority**: none
- **notes**: WO1 keeps compatibility as explicit Definition data (`compatibility` rules) and never derives it from
  shape. "Projectile" is `UNRESOLVED` in the terminology inventory.

### M5-SC-017 — No Maneuver Trait / Targeting / Duration catalogs in V0.1

- **conflictKey**: `M5-SC-017`
- **systemFamily**: `MANEUVER`
- **concept**: Maneuver content families required by the designer architecture
- **source A**: designer clarification M5-WO1 §5E (Spell and Maneuver Targeting, Effects and Traits are separate
  canonical content families); §52 (Maneuver Conditions).
- **source B**: Core Playtest Maneuvers chapter (s1978–s2119) has a Maneuver Effect Catalog and Maneuver Conditions
  only. Targeting is expressed as Targeting Conversion Effects (s2027). Duration is a card field (s1981 "Instant,
  until next turn, X rounds, scene, or sustained") with no cost table. The only "traits" are Weapon Morph Trait
  Options (s2063) and weapon properties (s612).
- **mechanical consequence**: `MANEUVER_TRAIT`, `MANEUVER_TARGETING` and `MANEUVER_DURATION` exist architecturally but
  have no V0.1 content.
- **status**: `UNRESOLVED`
- **resolution authority**: the designer has resolved the architecture. Content is absent from the source.
- **notes**: WO1 does not invent content (§10). The kinds have payload contracts so later WOs can author content
  once it exists.

### M5-SC-018 — Maneuver Radius size

- **conflictKey**: `M5-SC-018`
- **systemFamily**: `MANEUVER`
- **concept**: Radius of a Maneuver AoE
- **source A**: s2002–s2006 Radius Formula: "Radius = Martial Rank Base × Strength Score" (5 / 10 / 15 ft × STR; e.g.
  Master, 10 STR → 150 ft).
- **source B**: s2030 Radius Attack Conversion table: "1–3 STR 5 ft · 4–6 STR 10 ft · 7+ STR 15 ft".
- **mechanical consequence**: about a 10× difference at high STR.
- **status**: `UNRESOLVED`
- **resolution authority**: none
- **notes**: Spell Radius is "5 ft radius × Prowess" (s630). That difference is legitimately branch-specific content,
  because shared geometry is not shared sizing (§30–31).

### M5-SC-019 — Dependent / Independent: subtree or action model

- **conflictKey**: `M5-SC-019`
- **systemFamily**: `SUMMON`
- **concept**: Classification of Dependent and Independent Summons
- **source A**: s1165–s1168 SUMMONING SUBTREES list "2. Dependent Summons" and "3. Independent Summons" as subtrees.
- **source B**: s1154 / s1184 / s1227–s1230 treat Dependent and Independent as ACTION MODELS of a Summon Entity.
- **mechanical consequence**: it is unclear whether they are Summon Types (own build method) or a choice on an Entity
  (with a −20% MP modifier for Dependent, s1230).
- **status**: `UNRESOLVED`
- **resolution authority**: none
- **notes**: the build workflow's type list (s1181) omits them, which supports the action-model reading. M5-WO14+.

### M5-SC-020 — "Summoning Rank Value" undefined

- **conflictKey**: `M5-SC-020`
- **systemFamily**: `SUMMON`
- **concept**: Rank used for Summon AP limits
- **source A**: s1224 Maximum AP: "2 + Summoning Rank Value"; s1226 "up to Summoning Rank Value times".
- **source B**: no "Summoning" Skill or rank exists (s185 skill list). Rank Value is defined only for Martial Rank
  (s1980).
- **mechanical consequence**: Summon AP limits have no defined input.
- **status**: `UNRESOLVED`
- **resolution authority**: none
- **notes**: probably Arcana or Affinity rank value. Not guessed.

### M5-SC-021 — Casting Condition reduction cap

- **conflictKey**: `M5-SC-021`
- **systemFamily**: `SPELL`
- **concept**: Maximum MP reduction from Casting Conditions
- **source A**: s676 Casting Condition Reduction Caps: Trained 20% · Expert 30% · Master 40%.
- **source B**: s190 Trained Arcana: "1 Casting Condition (reduces Spell Cost up to 30%)"; s198 Expert Arcana: "2 Casting
  Conditions per Spell (still capped at a 30% total reduction)".
- **mechanical consequence**: different caps at Trained and Master.
- **status**: `UNRESOLVED`
- **resolution authority**: none
- **notes**: M5-WO9 / M5-WO10.

### M5-SC-022 — Multi-Effect Spells: shared resolution required?

- **conflictKey**: `M5-SC-022`
- **systemFamily**: `SPELL`
- **concept**: Constraints on a multi-Effect Spell
- **source A**: s621 / s681 (mixed branches allowed: "deal damage and push", "Healing + Cleanse", "Control + Debuff");
  s622 (Effects share the Targeting Type); s632 ("Each Effect must define its own resolution"); s624 Effect Capacity
  1 / 2 / 3 by rank.
- **source B**: s198 Expert Arcana: "May include up to 2 Spell Effects in a single spell, as long as they share the same
  Targeting Type and Saving Throw/Attack Roll."
- **mechanical consequence**: an extra "same resolution" constraint would forbid, e.g., an Attack-Roll Damage followed
  by a Save-based Control.
- **status**: `UNRESOLVED`
- **resolution authority**: none
- **notes**: WO1 composition supports multiple ordered Effects. It enforces no resolution-sharing rule (M5-I021).

### M5-SC-023 — Trait pricing

- **conflictKey**: `M5-SC-023`
- **systemFamily**: `SPELL`
- **concept**: How a Spell Trait's MP cost is set
- **source A**: s627 TRAIT TIERS: Tier 1 +5 · Tier 2 +10 · Tier 3 +15 · Signature +20 MP.
- **source B**: per-Trait costs that fit no tier: Widen Area +6 MP (s825), Fire Conversion +4 MP (s827), Selective
  Targeting +5 MP per excluded target (s829). s782 describes "Minor / Moderate / Major" patterns.
- **mechanical consequence**: two pricing models.
- **status**: `UNRESOLVED`
- **resolution authority**: none
- **notes**: Trait cost is Definition data (cost contributions). M5-WO8.

### M5-SC-024 — Area scaling vs Widen Area

- **conflictKey**: `M5-SC-024`
- **systemFamily**: `SPELL`
- **concept**: Cost of a larger Spell area
- **source A**: s631 Targeting Scaling: "+10 ft Radius / Zone / Aura radius: +3 MP".
- **source B**: s825 Widen Area: "+6 MP. Increase the spell's area by 5 ft". s800 lists Line as compatible; s825 does
  not.
- **mechanical consequence**: the same outcome has two prices, and Line compatibility differs.
- **status**: `UNRESOLVED`
- **resolution authority**: none
- **notes**: M5-WO6 / M5-WO8.

### M5-SC-025 — Maneuver Condition discount limits

- **conflictKey**: `M5-SC-025`
- **systemFamily**: `MANEUVER`
- **concept**: Size of Maneuver Condition discounts
- **source A**: s2020 Common Conditions: "Once per Combat −3 AP", "Once per Mission −5 AP".
- **source B**: s2094 / s2095: "total Condition discount cannot exceed −3 AP"; s2097: "No single Condition should exceed
  −3 AP".
- **mechanical consequence**: a single listed Condition exceeds both caps.
- **status**: `UNRESOLVED`
- **resolution authority**: none
- **notes**: M5-WO9 / M5-WO11.

### M5-SC-026 — Weapon attack AP: by category or by move

- **conflictKey**: `M5-SC-026`
- **systemFamily**: `EQUIPMENT`
- **concept**: AP cost of a weapon attack
- **source A**: s44 / s125 / s432: Light 1 AP · Balanced 2 AP · Heavy 3 AP. s1983 Maneuver Foundation uses the same
  categories.
- **source B**: s515 / s521 / s523: "A weapon's Category does not mean every move costs the same AP … The move determines
  the AP cost."
- **mechanical consequence**: Maneuver foundation cost and basic attack cost differ.
- **status**: `UNRESOLVED`
- **resolution authority**: none
- **notes**: Equipment integration (M5-WO14+). It is a dependency of M5-WO11.

### M5-SC-027 — Reload AP

- **conflictKey**: `M5-SC-027`
- **systemFamily**: `EQUIPMENT`
- **concept**: Default reload cost
- **source A**: s432 Common Action Costs: "Reload 1 AP unless stated otherwise".
- **source B**: s529 Reloading: Light 2 AP · Balanced 3 AP · Heavy 4+ AP.
- **mechanical consequence**: different reload costs.
- **status**: `UNRESOLVED`
- **resolution authority**: none
- **notes**: Equipment.

### M5-SC-028 — Rounding of percentage cost modifiers

- **conflictKey**: `M5-SC-028`
- **systemFamily**: `SPELL`
- **concept**: Rounding in the Total MP pipeline
- **source A**: s645 TOTAL MP FORMULA: apply Affinity discounts, Weakness penalties, Casting Condition reductions,
  then "Final rounding" (method unstated). s1230 "Round final MP normally".
- **source B**: the explicitly stated rules use "round down" (s650 Spell AP, s661 Sustain, s840 half damage).
- **mechanical consequence**: percentage modifiers (−10%, +30%) produce fractions with no stated rounding method,
  timing or per-step rule.
- **status**: `UNRESOLVED`
- **resolution authority**: none
- **notes**: M4 never rounds unless a Formula declares it (M4-WO3). M5-WO10 needs an explicit rule.

### M5-SC-029 — Trigger-Based and Glyph / Anchor: Targeting Types or add-ons

- **conflictKey**: `M5-SC-029`
- **systemFamily**: `SPELL`
- **concept**: Status of Trigger-Based and Glyph / Anchor targeting
- **source A**: s628 Targeting Types table: "Trigger-Based +4 MP", "Glyph / Anchor +5 MP" (priced as additions); s631
  "Trigger condition +4 MP", "Glyph / Anchor placement +5 MP" as upgrades.
- **source B**: s751 Targeting Type Overview and s769 / s771 present them as standalone Targeting Types. s831 Trigger
  Glyph is also a Trait (+10 MP).
- **mechanical consequence**: base targeting vs modifier changes cost composition and whether another shape can be
  combined.
- **status**: `UNRESOLVED`
- **resolution authority**: none
- **notes**: WO1 records `TRIGGERED` / `ANCHOR` as semantic shapes (classification only). M5-WO6.

### M5-SC-030 — Skill list completeness (Stealth, Engineering)

- **conflictKey**: `M5-SC-030`
- **systemFamily**: `SKILL`
- **concept**: The canonical Skill list
- **source A**: s185 SKILL LIST: 14 Skills (includes Engineering, excludes Stealth).
- **source B**: "Stealth" is used as a Skill (s115, s136 Thief Skills, s1924 Domain contest, s1942 Stalker). Engineering
  has no Skill section; Crafting does (s299).
- **mechanical consequence**: Skill identity for checks and contests is incomplete.
- **status**: `UNRESOLVED`
- **resolution authority**: none
- **notes**: M5-WO2.

### M5-SC-031 — Orcani Stat Bonus

- **conflictKey**: `M5-SC-031`
- **systemFamily**: `ANCESTRY`
- **concept**: Orcani racial Stat bonus
- **source A**: s166 ORCANI Mechanical Traits: "+2 STR, +1 CON".
- **source B**: s152 Character Creation Example: "+2 STR" only. The example's racial Skill handling (s154) is also
  noted as a draft.
- **mechanical consequence**: CON differs by 1.
- **status**: `UNRESOLVED`
- **resolution authority**: none
- **notes**: minor; recorded for completeness.
