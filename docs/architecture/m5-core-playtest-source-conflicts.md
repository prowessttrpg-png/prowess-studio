# M5 — Core Playtest Source Conflicts (M5-WO1, updated M5-WO2, M5-WO3, M5-WO4 and the post-WO4 canon rulings)

**Source audited:** Prowess Core Playtest Packet V0.1. The designer's local copy (98,897,516 bytes, SHA-256 prefix
`21fa6771…`) was verified byte-identical to the source identity recorded in
`docs/import-reports/m3-wo9-core-playtest-v0.1.md` (M3-I19: the full identity lives only there).
Parsed with the approved M3 parser `prowess-docx-structure@1.0.0` (structure hash `3d9a429c…f1e7`, 2,487 sections).

**Locators.** `sNNN` is the parser's deterministic section key for that structure hash, followed by the section's
title path. Wording is quoted only as far as needed to identify the rule. The DOCX is not in the repository.

**Authority precedence (M5-WO1 §6):** (1) explicit designer clarifications in M5-WO1, (2) approved CanonDecisions,
(3) Core Playtest V0.1, (4) older supporting sources. Lower-authority text is never rewritten; structured M5
architecture follows the higher authority.

**M5-WO2 update.** Designer rulings resolve M5-SC-002, 003, 005, 008, 009 and 010 (each entry records the ruling;
source locators are unchanged). M5-SC-006 stays UNRESOLVED (Movement `DEFERRED_PENDING_CANON`). M5-SC-032 is new.

**M5-WO3 update.** Designer rulings in M5-WO3 resolve M5-SC-006 (Base Movement = 5 ft × AGI, §4) and M5-SC-032
(Advantage and Disadvantage are presence-based, non-stacking signals; both present → NORMAL, §8–§12). Each entry keeps
its M5-WO2 state verbatim and adds the ruling — the WO2 history (Movement deferred, both signals fail closed) is not
rewritten. M5-SC-033 (Size-based movement adjustment values) is new and UNRESOLVED (§7). M5-SC-034 (Sprint movement
basis and repeated Sprint) is new and UNRESOLVED: it was found by the WO3 source audit (re-parsed from the verified
Core Playtest bytes, same structure hash). M5-SC-026 and M5-SC-027 stay UNRESOLVED: WO3 stores only the core default
costs (s432) the work order directs (§55); weapon-specific costs remain Equipment work.

**M5-WO4 update.** After WO3 the designer clarified Movement terminology: Movement = Base Movement × AGI, where Base
Movement is the creature's authored value (5 ft for the current standard character), and resolved M5-SC-034: Sprint
Allowance = Movement × 4, each Sprint independently. M5-SC-034 is `RESOLVED_BY_DESIGNER`; M5-SC-033 stays `UNRESOLVED`,
reframed as "Base Movement Values By Creature Size"; M5-SC-035 (starting Rank of a new Level 9 Affinity) is new and
`UNRESOLVED`. The WO3 entries keep their WO3 text verbatim; each WO4 change is appended as a dated amendment, so the WO3
history (Final Movement, `final_movement * 4`) stays readable. Source locators are unchanged.

**Post-WO4 canon rulings update.** After M5-WO4 merged, the designer ruled on M5-SC-033 (different Creature Sizes have
different Base Movement: Small 5 ft · Medium 5 ft · Large 10 ft · Huge 15 ft, each × AGI; Massive TBD) and on M5-SC-035
(a new Level 9 Affinity starts at Trained; every Affinity ranks independently). Both are `RESOLVED_BY_DESIGNER`.
M5-SC-036 (Base Movement of Massive creatures) is new and `UNRESOLVED`. Earlier text is kept verbatim; each ruling is
appended as an amendment.

**Post-WO4 Arcane ruling update.** The designer ruled that Arcane Rank and Arcana Rank are the same rank when referring
to Skills: the Arcana Skill's rank, named Arcane Rank. M5-SC-011 is `RESOLVED_BY_DESIGNER`; the earlier text is kept.

**Post-WO4 rulings batch.** The designer ruled on every remaining open conflict: M5-SC-007, M5-SC-013 to M5-SC-031 and
M5-SC-036 are `RESOLVED_BY_DESIGNER`. M5-SC-036 also changes Huge Base Movement from 15 ft to 20 ft
(Massive 40 ft). M5-SC-028 changes executable WO4 behaviour (one net percentage, applied once). Two follow-ups are new and
`UNRESOLVED`: M5-SC-037 (Spell Interference) and M5-SC-038 (Active Effects capacity / Concentration base). Earlier text is
kept; each ruling is appended. The designer then ruled on both follow-ups (Spell Interference is a Utility Counter
Spelling mechanic, not a branch; Active Effects = 1 per 2 CON; Concentration = 1 + 1 per 3 RES). No conflict in this
register is `UNRESOLVED` any more.

**M5-WO6 update.** Two new conflicts are `UNRESOLVED`: M5-SC-039 (Projectile base MP cost) and M5-SC-040 (Spell Line width
rounding / minimum). WO6 records the known rule and emits no number for either value (`DEFERRED_PENDING_CANON`). The
M5-SC-029 ruling is now applied: Trigger-Based and Glyph / Anchor are Targeting add-ons, not base Targeting Types.
Earlier text is kept.

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
- **status**: `RESOLVED_BY_DESIGNER`
- **resolution authority**: M5-WO2 §5, §27 (designer ruling)
- **notes**: canonical: Character Die / Character Dice (`CHARACTER_DIE`, `CHARACTER_DICE`) · legacy: Player Die / Player Dice. The two are mechanically interchangeable: "1 Player Die" means one roll of the character's current Character Die. There is one progression (`core.character_die.progression`); no Player Die size exists. Source text keeps "Player Dice" verbatim. Summon / Bound / Commitment Dice stay SYSTEM_SPECIFIC. Guarded by M5-I041 and negative control §183.

### M5-SC-003 — HP and MP formulas

- **conflictKey**: `M5-SC-003`
- **systemFamily**: `CHARACTER`
- **concept**: Starting HP and MP
- **source A**: s24 Constitution: "HP = CON × Racial HP Modifier"; s26 Resolve: "MP = RES × Racial MP Modifier".
- **source B**: s94 Racial Resources / s102 Health Points / s103 Mana Points: "HP = Base HP + CON", "MP = Base MP + RES",
  with worked examples (s95: Human 8 + 4 = 12 HP; s156: Orcani 10 + 4 = 14 HP). Races list "Base HP Modifier".
- **mechanical consequence**: multiplicative and additive formulas give very different values (e.g. CON 4 × 10 = 40
  against 10 + 4 = 14).
- **status**: `RESOLVED_BY_DESIGNER`
- **resolution authority**: M5-WO2 §6 (designer ruling)
- **notes**: Race supplies fixed starting values Base HP and Base MP. Canonical: Maximum HP = Base HP + CON; Maximum MP = Base MP + RES (`core.derived.maximum_hp`, `core.derived.maximum_mp`). The multiplicative wording ("CON × Racial HP Modifier", "RES × Racial MP Modifier") is superseded for structured mechanics; the source text is not rewritten. Guarded by M5-I063–I065 and negative controls §191–§192.

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
- **status**: `RESOLVED_BY_DESIGNER`
- **resolution authority**: M5-WO2 §7–§8 (designer ruling)
- **notes**: canonical: Dodge (`DODGE`) · legacy: Evasion — one defense, never a second value. "+1 Evasion per 3 PER" is the named term Dodge Bonus From PER = floor(PER / 3) (`core.derived.dodge_perception_bonus`). Dodge = Half Character Die + AGI + floor(PER / 3) + explicit Dodge bonuses. Guarded by M5-I056, M5-I057 and negative controls §188–§189.

### M5-SC-006 — Movement formula

- **conflictKey**: `M5-SC-006`
- **systemFamily**: `CHARACTER`
- **concept**: Base Movement
- **source A**: s23 / s69 / s104: "Movement = 5 × AGI" (example s70: AGI 4 → 20 ft).
- **source B**: s156 Character Creation Example: "Movement: 10 × AGI 2 = 20 ft (+5 Athletics)".
- **mechanical consequence**: the multiplier is doubled. The example also adds an unexplained Athletics bonus.
- **status**: `RESOLVED_BY_DESIGNER`
- **resolution authority**: M5-WO3 §4–§6 (designer ruling)
- **notes**: probably an error in the example. It is still recorded and not repaired (§10). **M5-WO2:** still UNRESOLVED. Movement calculation is `DEFERRED_PENDING_CANON`: both source formulas are preserved, no executable Movement Formula exists, and a DERIVED_STAT for MOVEMENT / BASE_MOVEMENT / MOVEMENT_SPEED is refused (`PROWESS_DEFINITION.DEFERRED_PENDING_CANON`). Only a designer ruling that changes this status may activate it. Guarded by M5-I073 and negative control §198. **M5-WO3 (designer ruling):** canonical Base Movement = 5 ft × AGI (`core.derived.base_movement`, expression `5 * agi`, unit ft). The 10 × AGI character example (s156) is superseded for canonical structured mechanics; the source text is unchanged. Movement may depend on Size: Base Movement → Size adjustment (values pending, M5-SC-033) → other explicit modifiers → Final Movement (`core.derived.final_movement`). M5-I073 is SUPERSEDED by M5-I075; guarded by M5-I075 and M5-WO3 negative controls §174–§175.

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
- **status**: `RESOLVED_BY_DESIGNER`
- **resolution authority**: designer rulings batch after M5-WO4; earlier status was `UNRESOLVED`, resolution authority none
- **notes**: affects M5-WO13 (Sustain / Mana Lock / Concentration) and Mage Arts.
- **Rulings batch (post-WO4, resolves M5-SC-007)**: One stat governs Concentration: +1 Concentration per 3 RES (s26 stands; s664 "1 + 1 per 2 Resolve" is superseded).
  Expert Arcana grants an additional +1 Concentration. Active Effects and Concentration Slots are TWO different pools:
  **Active Effects** are the total positive effects a character can have on them at one time (buffs, spells, etc.);
  each individual effect another character places on them counts against it. **Concentration Slots** are the Spells a
  character can maintain at one time; casting a Spell whose Duration is longer than Instant requires maintaining it,
  which uses Concentration. The Active Effects capacity value is not stated — recorded as M5-SC-038.


### M5-SC-008 — Character DC composition

- **conflictKey**: `M5-SC-008`
- **systemFamily**: `CORE`
- **concept**: Character DC
- **source A**: s43 / s637: "Character DC = ½ Character Die + PRO + bonuses".
- **source B**: s26 Resolve: "Character DC: +1 per 3 RES"; s637: "Some features may also add bonuses from Resolve, Arcana
  Rank, Affinity Rank …".
- **mechanical consequence**: it is unclear whether the RES term belongs in the base formula or is an optional feature
  bonus.
- **status**: `RESOLVED_BY_DESIGNER`
- **resolution authority**: M5-WO2 §9 (designer ruling)
- **notes**: Character DC = Half Character Die + PRO + Resolve DC Bonus + explicit bonuses, with Resolve DC Bonus = floor(RES / 3) (RES 1–2 +0, 3–5 +1, 6–8 +2, 9–10 +3) as its own named term (`core.derived.character_dc_resolve_bonus`). Static: no die is rolled. Guarded by M5-I062 and negative control §190.

### M5-SC-009 — Prowess bonus to Attack Rolls

- **conflictKey**: `M5-SC-009`
- **systemFamily**: `CORE`
- **concept**: Attack Roll formula
- **source A**: s56 / s634 / s1988: "Attack Roll = Character Die (Player Dice) + PER + bonuses"; s25 "PER is added to
  all base attack rolls".
- **source B**: s27 Prowess: "Attack Rolls: +1 per 3 PRO".
- **mechanical consequence**: it is unclear whether a standing PRO-derived bonus applies to every Attack Roll.
- **status**: `RESOLVED_BY_DESIGNER`
- **resolution authority**: M5-WO2 §10 (designer ruling)
- **notes**: Prowess grants an inherent Accuracy (To-Hit) bonus = floor(PRO / 3) (PRO 1–2 +0, 3–5 +1, 6–8 +2, 9–10 +3), canonical term `ACCURACY` (`core.derived.accuracy`). It is a named Attack Roll contribution, never merged into PER and never an Ability Score. Guarded by M5-I054, M5-I055 and negative controls §186–§187.

### M5-SC-010 — Advantage / Disadvantage undefined

- **conflictKey**: `M5-SC-010`
- **systemFamily**: `CORE`
- **concept**: The mechanics of Advantage and Disadvantage
- **source A**: about 114 uses (e.g. s162 Stat Mastery, s371 Feint, s1917 Barrier, s1928 Focus, s2020 Exposed Drive).
- **source B**: only stacking statements (s990 / s991 "does not stack", s1041). No rule defines what Advantage does
  to a roll.
- **mechanical consequence**: there is no executable definition (roll twice? a flat bonus? a die step?).
- **status**: `RESOLVED_BY_DESIGNER`
- **resolution authority**: M5-WO2 §11–§13 (designer ruling)
- **notes**: Advantage: roll the Character Die twice and keep the higher natural; Disadvantage: keep the lower. Bonuses are added once, after selection; Advantage on an Attack Roll does not affect damage dice. Only NORMAL / ADVANTAGE / DISADVANTAGE exist — no stacking (no double Advantage). Criticals read the selected natural only. Advantage and Disadvantage together are NOT defined by this ruling: that narrow question is recorded as M5-SC-032 and fails closed (`PROWESS_CORE.ROLL_MODE_CONFLICT`). Guarded by M5-I051–I053 and negative controls §193–§194.

### M5-SC-011 — Arcane Rank vs Arcana Rank

- **conflictKey**: `M5-SC-011`
- **systemFamily**: `SPELL`
- **concept**: The rank that governs general spell construction
- **source A**: s677 ARCANE RANK; "Arcane Authority" (s624, s680); s783 "Arcane/ Affinity Rank"; s825 "Arcane Rank".
- **source B**: "Arcana Rank" (17×: s624, s627, s637, s1226 "Arcana: Expert"); the Skill is named "Arcana" (s185).
- **mechanical consequence**: it is unclear whether Arcane Rank is the Arcana Skill's rank or a separate track.
- **status**: `RESOLVED_BY_DESIGNER`
- **resolution authority**: designer ruling after M5-WO4 (Arcane ruling amendment); WO1–WO4 status was `UNRESOLVED`, resolution authority none
- **notes**: the context strongly suggests the same concept (the Arcana Skill rank). It is not normalized (§10).
- **Post-WO4 designer ruling (resolves M5-SC-011)**: Arcane Rank and Arcana Rank are the same when referring to
  Skills (designer answer, confirmed: same rank, named Arcane). Arcane Rank IS the Arcana Skill's rank — one rank, not a separate track. "Arcane Rank" is the canonical term;
  "Arcana Rank" is its LEGACY spelling (terminology inventory). No Spell mechanic changes: Arcane Authority capacity
  still belongs to the later Spell Creation Work Order. Guarded by M5-I153.

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
- **status**: `RESOLVED_BY_DESIGNER`
- **resolution authority**: designer rulings batch after M5-WO4; earlier status was `UNRESOLVED`, resolution authority none
- **notes**: WO1 records `MOVEMENT` as `UNRESOLVED` in the terminology inventory. M5-WO7 needs a ruling. The WO1
  structural contract allows any explicit `effectFamily` token, so no architecture change is needed either way.
- **Rulings batch (post-WO4, resolves M5-SC-013)**: The Spell branches are Damage, Healing, Buff, Debuff, Control, Utility and Summoning. Cleanse and Movement are
  sub-branches, not branches: Cleanse sits within Healing and Movement within Utility. Spell Interference is not in the
  ruling's list; its place is recorded as M5-SC-037 (UNRESOLVED). Terminology inventory updated (Movement / Cleanse
  SYSTEM_SPECIFIC sub-branches; Spell Interference UNRESOLVED).


### M5-SC-014 — Effect Chain default behaviour

- **conflictKey**: `M5-SC-014`
- **systemFamily**: `SPELL`
- **concept**: What happens after an Effect fails in an Effect Chain
- **source A**: s639 / s640 EFFECT CHAINS: per-Effect Chain Behavior (Continue, Success Only, Failure Only, Stop,
  Branch). "If no Chain Behavior is listed, the default is: Failure ends the chain."
- **source B**: s776 EFFECT CHAINS IN SPELL EFFECTS: "If one Effect fails, every Effect after it fails." (absolute, with
  no behaviors).
- **mechanical consequence**: it is unclear whether Continue / Branch behaviors exist at all.
- **status**: `RESOLVED_BY_DESIGNER`
- **resolution authority**: designer rulings batch after M5-WO4; earlier status was `UNRESOLVED`, resolution authority none
- **notes**: the two agree if s776 describes only the default. WO1 does not apply Spell chain rules to Maneuvers (§42).
- **Rulings batch (post-WO4, resolves M5-SC-014)**: The chain behaviours exist, and the default is: each later Effect is predicated on the earlier one succeeding.
  Example: a first Effect "Agility Saving Throw against affected targets; on failure they receive ___" — every Effect
  after it happens only if the target failed that first Save. Traits and Metamagic Effects can alter this later
  (e.g. Continue / Branch behaviours).


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
- **status**: `RESOLVED_BY_DESIGNER`
- **resolution authority**: designer rulings batch after M5-WO4; earlier status was `UNRESOLVED`, resolution authority none
  save-profile allocation still needs a ruling.
- **notes**: WO1 architecture: geometry is a MANEUVER_TARGETING Definition. The Save profile is authored resolution
  data and is never derived from shape (M5-I022). Whether the conversion also counts as an Effect is a content rule
  for M5-WO6 / M5-WO11.
- **Rulings batch (post-WO4, resolves M5-SC-015)**: Yes: the Targeting Conversion IS a Maneuver Effect (it uses an Effect slot). A Maneuver takes a normal attack
  the character can perform and alters it; e.g. a Single Target Sword Swing (Attack Roll, 2d8) becomes Ranged, AoE or
  Line through the Targeting Conversion Effect, which turns the Attack Roll into a Saving Throw. The Targeting
  Conversion Effect carries the list of Targeting Types it can convert to, with each type's own cost and Save. Maneuver
  Targeting Types resemble the Spell ones, but their Saves differ slightly because they are martial.


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
- **status**: `RESOLVED_BY_DESIGNER`
- **resolution authority**: designer rulings batch after M5-WO4; earlier status was `UNRESOLVED`, resolution authority none
- **notes**: WO1 keeps compatibility as explicit Definition data (`compatibility` rules) and never derives it from
  shape. "Projectile" is `UNRESOLVED` in the terminology inventory.
- **Rulings batch (post-WO4, resolves M5-SC-016)**: Damage works with both groups, which target differently. **Attack Roll Targeting Types** (Touch, Projectile) are
  mostly single-target and cost less Mana. **Saving Throw Targeting Types** (Line, Cone, Radius, Zone) make the
  affected targets Save against the Damage Effect and can affect several targets in an area, so they cost more Mana.
  Projectile is a real (Attack Roll) Targeting Type — terminology inventory updated to CANONICAL.


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
- **status**: `RESOLVED_BY_DESIGNER`
- **resolution authority**: designer rulings batch after M5-WO4; earlier status was `UNRESOLVED`, resolution authority none
- **notes**: WO1 does not invent content (§10). The kinds have payload contracts so later WOs can author content
  once it exists.
- **Rulings batch (post-WO4, resolves M5-SC-017)**: Targeting Conversion is currently the only way to change an Attack Roll into a different Targeting Type. Like other
  Maneuver Effects it has a tree that unlocks more complex Targeting Types as Martial Rank improves; their ranges scale
  with the Strength score. No Maneuver Traits exist yet, but they will (terminology: SYSTEM_SPECIFIC, none authored).


### M5-SC-018 — Maneuver Radius size

- **conflictKey**: `M5-SC-018`
- **systemFamily**: `MANEUVER`
- **concept**: Radius of a Maneuver AoE
- **source A**: s2002–s2006 Radius Formula: "Radius = Martial Rank Base × Strength Score" (5 / 10 / 15 ft × STR; e.g.
  Master, 10 STR → 150 ft).
- **source B**: s2030 Radius Attack Conversion table: "1–3 STR 5 ft · 4–6 STR 10 ft · 7+ STR 15 ft".
- **mechanical consequence**: about a 10× difference at high STR.
- **status**: `RESOLVED_BY_DESIGNER`
- **resolution authority**: designer rulings batch after M5-WO4; earlier status was `UNRESOLVED`, resolution authority none
- **notes**: Spell Radius is "5 ft radius × Prowess" (s630). That difference is legitimately branch-specific content,
  because shared geometry is not shared sizing (§30–31).
- **Rulings batch (post-WO4, resolves M5-SC-018)**: Radius = Martial Rank Base × STR (s2002–s2006 stands; the s2030 table is superseded).


### M5-SC-019 — Dependent / Independent: subtree or action model

- **conflictKey**: `M5-SC-019`
- **systemFamily**: `SUMMON`
- **concept**: Classification of Dependent and Independent Summons
- **source A**: s1165–s1168 SUMMONING SUBTREES list "2. Dependent Summons" and "3. Independent Summons" as subtrees.
- **source B**: s1154 / s1184 / s1227–s1230 treat Dependent and Independent as ACTION MODELS of a Summon Entity.
- **mechanical consequence**: it is unclear whether they are Summon Types (own build method) or a choice on an Entity
  (with a −20% MP modifier for Dependent, s1230).
- **status**: `RESOLVED_BY_DESIGNER`
- **resolution authority**: designer rulings batch after M5-WO4; earlier status was `UNRESOLVED`, resolution authority none
- **notes**: the build workflow's type list (s1181) omits them, which supports the action-model reading. M5-WO14+.
- **Rulings batch (post-WO4, resolves M5-SC-019)**: Dependent and Independent Summons are BUILT the same way and CONTROLLED differently (an action model, not a
  Summon type). A Dependent Summon needs the caster to spend their own AP for it to act, so it gets a cost discount; an
  Independent Summon acts on its own as the player wishes, so it has a higher base cost.


### M5-SC-020 — "Summoning Rank Value" undefined

- **conflictKey**: `M5-SC-020`
- **systemFamily**: `SUMMON`
- **concept**: Rank used for Summon AP limits
- **source A**: s1224 Maximum AP: "2 + Summoning Rank Value"; s1226 "up to Summoning Rank Value times".
- **source B**: no "Summoning" Skill or rank exists (s185 skill list). Rank Value is defined only for Martial Rank
  (s1980).
- **mechanical consequence**: Summon AP limits have no defined input.
- **status**: `RESOLVED_BY_DESIGNER`
- **resolution authority**: designer rulings batch after M5-WO4; earlier status was `UNRESOLVED`, resolution authority none
- **notes**: probably Arcana or Affinity rank value. Not guessed.
- **Rulings batch (post-WO4, resolves M5-SC-020)**: Summoning Rank Value is the Summon's **Tier** (1–4), picked first when building a Summon in the Summon builder.
  Tier 1 is the cheapest with the lowest stats; Tier 4 the most expensive with the highest. Terminology:
  `SUMMON_TIER`.


### M5-SC-021 — Casting Condition reduction cap

- **conflictKey**: `M5-SC-021`
- **systemFamily**: `SPELL`
- **concept**: Maximum MP reduction from Casting Conditions
- **source A**: s676 Casting Condition Reduction Caps: Trained 20% · Expert 30% · Master 40%.
- **source B**: s190 Trained Arcana: "1 Casting Condition (reduces Spell Cost up to 30%)"; s198 Expert Arcana: "2 Casting
  Conditions per Spell (still capped at a 30% total reduction)".
- **mechanical consequence**: different caps at Trained and Master.
- **status**: `RESOLVED_BY_DESIGNER`
- **resolution authority**: designer rulings batch after M5-WO4; earlier status was `UNRESOLVED`, resolution authority none
- **notes**: M5-WO9 / M5-WO10.
- **Rulings batch (post-WO4, resolves M5-SC-021)**: The Casting Condition cap is a flat 30% per Spell — not tied to Arcane Rank for now (s676's 20 / 30 / 40% by rank
  is superseded). Architecture: a Casting Condition applies only when the Spell meets its Requirements — e.g. a
  "Disadvantage on Attack Roll" Casting Condition requires the Spell to have an Attack Roll.


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
- **status**: `RESOLVED_BY_DESIGNER`
- **resolution authority**: designer rulings batch after M5-WO4; earlier status was `UNRESOLVED`, resolution authority none
- **notes**: WO1 composition supports multiple ordered Effects. It enforces no resolution-sharing rule (M5-I021).
- **Rulings batch (post-WO4, resolves M5-SC-022)**: A multi-Effect Spell resolves as one whole: it has ONE Targeting Type (it cannot, e.g., damage another target
  while healing the caster — unless Metamagic / Traits allow it). Effects resolve down the chain in the Spell's order:
  Targeting Type → 1st Effect (success) → 2nd Effect (success) → 3rd Effect; if the 1st Effect fails, the Spell ends
  before the 2nd can happen (see M5-SC-014).


### M5-SC-023 — Trait pricing

- **conflictKey**: `M5-SC-023`
- **systemFamily**: `SPELL`
- **concept**: How a Spell Trait's MP cost is set
- **source A**: s627 TRAIT TIERS: Tier 1 +5 · Tier 2 +10 · Tier 3 +15 · Signature +20 MP.
- **source B**: per-Trait costs that fit no tier: Widen Area +6 MP (s825), Fire Conversion +4 MP (s827), Selective
  Targeting +5 MP per excluded target (s829). s782 describes "Minor / Moderate / Major" patterns.
- **mechanical consequence**: two pricing models.
- **status**: `RESOLVED_BY_DESIGNER`
- **resolution authority**: designer rulings batch after M5-WO4; earlier status was `UNRESOLVED`, resolution authority none
- **notes**: Trait cost is Definition data (cost contributions). M5-WO8.
- **Rulings batch (post-WO4, resolves M5-SC-023)**: Trait pricing is a RANGE, not fixed tiers. On average Traits run about 5 / 10 / 15 / 20 MP, but an individual
  Trait may cost anywhere within, below or above that range — each Trait's cost is authored on the Trait.


### M5-SC-024 — Area scaling vs Widen Area

- **conflictKey**: `M5-SC-024`
- **systemFamily**: `SPELL`
- **concept**: Cost of a larger Spell area
- **source A**: s631 Targeting Scaling: "+10 ft Radius / Zone / Aura radius: +3 MP".
- **source B**: s825 Widen Area: "+6 MP. Increase the spell's area by 5 ft". s800 lists Line as compatible; s825 does
  not.
- **mechanical consequence**: the same outcome has two prices, and Line compatibility differs.
- **status**: `RESOLVED_BY_DESIGNER`
- **resolution authority**: designer rulings batch after M5-WO4; earlier status was `UNRESOLVED`, resolution authority none
- **notes**: M5-WO6 / M5-WO8.
- **Rulings batch (post-WO4, resolves M5-SC-024)**: Widen Area at +6 MP (s825) is right; s631's "+10 ft Radius / Zone / Aura: +3 MP" is superseded. It applies to
  any Targeting Type that has a radius (so not Line).


### M5-SC-025 — Maneuver Condition discount limits

- **conflictKey**: `M5-SC-025`
- **systemFamily**: `MANEUVER`
- **concept**: Size of Maneuver Condition discounts
- **source A**: s2020 Common Conditions: "Once per Combat −3 AP", "Once per Mission −5 AP".
- **source B**: s2094 / s2095: "total Condition discount cannot exceed −3 AP"; s2097: "No single Condition should exceed
  −3 AP".
- **mechanical consequence**: a single listed Condition exceeds both caps.
- **status**: `RESOLVED_BY_DESIGNER`
- **resolution authority**: designer rulings batch after M5-WO4; earlier status was `UNRESOLVED`, resolution authority none
- **notes**: M5-WO9 / M5-WO11.
- **Rulings batch (post-WO4, resolves M5-SC-025)**: No total Maneuver Condition discount can exceed −3 AP (s2094 / s2095 / s2097 stand; s2020's −5 AP listing is
  superseded).
- **M5-WO11 application**: final Maneuver cost consumes only WO9's effective (min(listed, 3)) Condition AP reduction; the
  −5 AP Once per Mission listing remains deferred (M5-SC-044) and never executes.


### M5-SC-026 — Weapon attack AP: by category or by move

- **conflictKey**: `M5-SC-026`
- **systemFamily**: `EQUIPMENT`
- **concept**: AP cost of a weapon attack
- **source A**: s44 / s125 / s432: Light 1 AP · Balanced 2 AP · Heavy 3 AP. s1983 Maneuver Foundation uses the same
  categories.
- **source B**: s515 / s521 / s523: "A weapon's Category does not mean every move costs the same AP … The move determines
  the AP cost."
- **mechanical consequence**: Maneuver foundation cost and basic attack cost differ.
- **status**: `RESOLVED_BY_DESIGNER`
- **resolution authority**: designer rulings batch after M5-WO4; earlier status was `UNRESOLVED`, resolution authority none
- **notes**: Equipment integration (M5-WO14+). It is a dependency of M5-WO11.
- **Rulings batch (post-WO4, resolves M5-SC-026)**: AP is set by the ATTACK's category, not the weapon's. Light, Balanced and Heavy weapons each have attacks and moves,
  and each attack belongs to a category: a Heavy weapon may have a Balanced attack; a Balanced weapon may have a Light
  and a Heavy attack.
- **M5-WO11 application**: each Attack is an exact foundation Definition that authors its own AP; WO11 consumes that exact
  value per Attack use and never prices an Attack from its weapon, category label or display name.


### M5-SC-027 — Reload AP

- **conflictKey**: `M5-SC-027`
- **systemFamily**: `EQUIPMENT`
- **concept**: Default reload cost
- **source A**: s432 Common Action Costs: "Reload 1 AP unless stated otherwise".
- **source B**: s529 Reloading: Light 2 AP · Balanced 3 AP · Heavy 4+ AP.
- **mechanical consequence**: different reload costs.
- **status**: `RESOLVED_BY_DESIGNER`
- **resolution authority**: designer rulings batch after M5-WO4; earlier status was `UNRESOLVED`, resolution authority none
- **notes**: Equipment.
- **Rulings batch (post-WO4, resolves M5-SC-027)**: Reloading is generally 1 AP, but it is weapon-specific: heavier weapons may cost more than 1 AP to reload.


### M5-SC-028 — Rounding of percentage cost modifiers

- **conflictKey**: `M5-SC-028`
- **systemFamily**: `SPELL`
- **concept**: Rounding in the Total MP pipeline
- **source A**: s645 TOTAL MP FORMULA: apply Affinity discounts, Weakness penalties, Casting Condition reductions,
  then "Final rounding" (method unstated). s1230 "Round final MP normally".
- **source B**: the explicitly stated rules use "round down" (s650 Spell AP, s661 Sustain, s840 half damage).
- **mechanical consequence**: percentage modifiers (−10%, +30%) produce fractions with no stated rounding method,
  timing or per-step rule.
- **status**: `RESOLVED_BY_DESIGNER`
- **resolution authority**: designer rulings batch after M5-WO4; earlier status was `UNRESOLVED`, resolution authority none
- **notes**: M4 never rounds unless a Formula declares it (M4-WO3). M5-WO10 needs an explicit rule.
- **Rulings batch (post-WO4, resolves M5-SC-028)**: Rounding happens once, at the end of Spell creation, and rounds normally (0.5 up). All percentage-based cost
  modifiers combine into one net percentage first. Example: a 20 MP Spell with a −25% discount (Casting Conditions +
  Affinity Strength) and a +15% Affinity Weakness penalty nets to −10% → 18 MP. **Applied now to the M5-WO4 Affinity
  cost fragment:** M4 computes one net percentage (100 − Strength discount + selected Weakness penalty) and applies it
  once to the listed cost, unrounded; the sequential WO4 model (discount, then penalty on the result) is superseded
  (M5-I128 → M5-I155). Casting Conditions join the same net sum in the Spell cost Work Order, which also does the final
  normal rounding.
- **M5-WO10 application**: the final Spell cost pipeline builds ONE M4 net percentage — 100 − Strength (the WO4 stage) +
  highest Weakness (the WO4 stage) − the WO9 EFFECTIVE Casting Condition reduction (M5-SC-021, flat 30%) — applies it once
  to the constructed base MP (`base × net ÷ 100`, unrounded) and rounds normally exactly once (`floor(unrounded + 0.5)`):
  15 MP at −10% → 13.5 → 14 MP; the older 13 × 0.9 = 11.7 → 11 floor example is historical only (→ 12 MP). M5-I243–I260.


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
- **status**: `RESOLVED_BY_DESIGNER`
- **resolution authority**: designer rulings batch after M5-WO4; earlier status was `UNRESOLVED`, resolution authority none
- **notes**: WO1 records `TRIGGERED` / `ANCHOR` as semantic shapes (classification only). M5-WO6.
- **Rulings batch (post-WO4, resolves M5-SC-029)**: Trigger-Based and Glyph / Anchor are ADD-ONS to a Targeting Type, not Targeting Types. They take an already-created
  Spell and place it in a specified location; on activation the Spell resolves as normal. Their Mana cost is not +4 /
  +5 but roughly 8–12+ MP, depending on how many Triggers activate the Glyph.


### M5-SC-030 — Skill list completeness (Stealth, Engineering)

- **conflictKey**: `M5-SC-030`
- **systemFamily**: `SKILL`
- **concept**: The canonical Skill list
- **source A**: s185 SKILL LIST: 14 Skills (includes Engineering, excludes Stealth).
- **source B**: "Stealth" is used as a Skill (s115, s136 Thief Skills, s1924 Domain contest, s1942 Stalker). Engineering
  has no Skill section; Crafting does (s299).
- **mechanical consequence**: Skill identity for checks and contests is incomplete.
- **status**: `RESOLVED_BY_DESIGNER`
- **resolution authority**: designer rulings batch after M5-WO4; earlier status was `UNRESOLVED`, resolution authority none
- **notes**: M5-WO2. M5-WO2 does not need the Skill list: a Skill Check names an exact Skill canonical key and the Stat chosen by the approach; the Skill catalog arrives with M5-WO3. Still unresolved.
- **Rulings batch (post-WO4, resolves M5-SC-030)**: Stealth and Engineering are both Skills; their sections are not finished yet.


### M5-SC-031 — Orcani Stat Bonus

- **conflictKey**: `M5-SC-031`
- **systemFamily**: `ANCESTRY`
- **concept**: Orcani racial Stat bonus
- **source A**: s166 ORCANI Mechanical Traits: "+2 STR, +1 CON".
- **source B**: s152 Character Creation Example: "+2 STR" only. The example's racial Skill handling (s154) is also
  noted as a draft.
- **mechanical consequence**: CON differs by 1.
- **status**: `RESOLVED_BY_DESIGNER`
- **resolution authority**: designer rulings batch after M5-WO4; earlier status was `UNRESOLVED`, resolution authority none
- **notes**: minor; recorded for completeness.
- **Rulings batch (post-WO4, resolves M5-SC-031)**: Orcani racial Stat bonus is +2 STR and +1 CON (s166 stands; the s152 example is incomplete).


### M5-SC-032 — Advantage and Disadvantage on the same roll

- **conflictKey**: `M5-SC-032`
- **systemFamily**: `CORE`
- **concept**: What happens when Advantage and Disadvantage both apply to one roll
- **source A**: M5-WO2 §11 designer ruling defines Advantage (higher of two) and Disadvantage (lower of two) separately.
- **source B**: the Core Playtest uses both terms about 114 times (s162, s371, s990, s991, s1041 …) and states only
  that each "does not stack"; no rule says whether they cancel, net, or which wins. M5-WO2 §13.
- **mechanical consequence**: a roll with both signals has no defined natural selection.
- **status**: `RESOLVED_BY_DESIGNER`
- **resolution authority**: M5-WO3 §8–§15 (designer ruling)
- **notes**: recorded by M5-WO2 as a narrow runtime-rule question. `resolveRollMode` fails closed with
  `PROWESS_CORE.ROLL_MODE_CONFLICT`; nothing cancels, nets or picks a winner. Guarded by M5-I051 / M5-I052 tests.
  **M5-WO3 (designer ruling):** Advantage and Disadvantage are presence-based, non-stacking signals. No signal → NORMAL;
  one or more Advantage only → ADVANTAGE; one or more Disadvantage only → DISADVANTAGE; at least one of each → NORMAL,
  regardless of counts (no arithmetic netting: 2 Advantage + 1 Disadvantage is NORMAL). Every source key is preserved
  for provenance (`resolveRollSignals`). The WO2 fail-closed behaviour and the `ROLL_MODE_CONFLICT` code were correct
  while unresolved and are superseded; M4 Modifier semantics are unchanged. Guarded by M5-I077–I079 and M5-WO3 negative
  controls §177–§180.

### M5-SC-033 — Base Movement Values By Creature Size

- **conflictKey**: `M5-SC-033`
- **systemFamily**: `CHARACTER`
- **concept**: Whether different Creature Sizes have different Base Movement values, and what those values are (WO3 wording: how a creature's Size adjusts its Movement)
- **source A**: M5-WO3 §5 designer ruling: Movement may depend on creature Size (Base Movement → Size adjustment →
  other explicit modifiers → Final Movement).
- **source B**: s441–s442 GRID SCALE AND OCCUPIED SPACE / Creature Space: Small 5 ft · Medium 5 ft · Large 10 ft × 10 ft
  · Huge 15 ft × 15 ft · Massive 20 ft × 20 ft or larger — OCCUPIED SPACE values only; no movement value is given
  anywhere for any Size.
- **mechanical consequence**: unknown adjustment per Size; unknown whether it is additive or multiplicative; unknown
  whether Small and Medium share one; unknown whether Massive has a fixed rule or a creature-specific one.
- **status**: `RESOLVED_BY_DESIGNER`
- **resolution authority**: designer ruling after M5-WO4 (canon-rulings amendment); WO3 and WO4 status was `UNRESOLVED`, resolution authority none
- **notes**: recorded by M5-WO3 §7. `CREATURE_SIZE` Definitions carry occupied space only; `movementAdjustment` must be
  null (any value is refused as `PROWESS_DEFINITION.DEFERRED_PENDING_CANON`); occupied space is never read as speed.
  Final Movement currently = Base Movement + explicit Movement modifiers. Guarded by M5-I076 / M5-I108 and M5-WO3
  negative control §176.
- **M5-WO4 amendment (post-WO3 designer clarification, reframed — still UNRESOLVED)**: known — Movement = Base Movement ×
  AGI, and the standard current character's Base Movement is 5 ft (`core.derived.base_movement`, expression `5`;
  `core.derived.movement`, expression `base_movement * agi + bonuses`). Unknown — whether different Creature Sizes have
  different Base Movement values, and what those values are. The `CREATURE_SIZE` field is renamed `baseMovement` (was
  `movementAdjustment`) and must be null; any value is refused as `PROWESS_DEFINITION.DEFERRED_PENDING_CANON`. Occupied
  space (Large 10 × 10 ft) never implies Base Movement (Large Base Movement ≠ 10 ft). No Size value is invented. Guarded by
  M5-I113 and the M5-WO4 audit.
- **Post-WO4 designer ruling (resolves M5-SC-033)**: "different Sized Creatures have different base Size Scaling for
  Movement. (Medium is 5ft x AGI, Large is 10ft x AGI, Huge is 15 ft x AGI)"; Small is 5 ft; Massive is TBD (recorded as
  M5-SC-036). Each `CREATURE_SIZE` Definition now authors `baseMovement` explicitly — SMALL `{ feet: 5 }`, MEDIUM
  `{ feet: 5 }`, LARGE `{ feet: 10 }`, HUGE `{ feet: 15 }`, MASSIVE `null`. `core.derived.base_movement` reads it through
  the variable source `CREATURE_SIZE_BASE_MOVEMENT` (expression `size_base_movement`), which copies the exact Size
  Definition's value and cites it; Movement stays `base_movement * agi + bonuses`. A character with no Size named is
  MEDIUM (`STANDARD_CREATURE_SIZE`), so the standard character is numerically unchanged. The values are authored data:
  they coincide with occupied space for Large and Huge, but occupied space is still never read as Base Movement.
  Guarded by M5-I152 and the canon-rulings negative controls.
- **Amended by the rulings batch (M5-SC-036)**: Huge Base Movement is 20 ft × AGI, not 15 ft; Massive is 40 ft × AGI.
  Small 5 · Medium 5 · Large 10 ft are unchanged. M5-I152 is SUPERSEDED by M5-I154.


### M5-SC-034 — Sprint movement basis and repeated Sprint

- **conflictKey**: `M5-SC-034`
- **systemFamily**: `ACTION_ECONOMY`
- **concept**: What Sprint quadruples, and how repeated Sprints combine
- **source A**: s71 MOVEMENT / Sprint: "Quadruples your Base Movement this round"; s228 (Athletics) "Move 4 × your Base
  Movement".
- **source B**: s438 Sprint: "Gain Quadruple your Total Movement this round. A creature may Sprint more than once if it
  has enough AP"; s485 "Move up to Quadruple your Movement".
- **mechanical consequence**: Base vs Total (Final) Movement differs once explicit Movement modifiers or a Size
  adjustment exist; the source does not state how a second Sprint's movement combines with the first.
- **status**: `RESOLVED_BY_DESIGNER`
- **resolution authority**: M5-WO4 §12–§14 (designer ruling, applied post-WO3)
- **notes**: found by the M5-WO3 source audit. WO3 implements the rule as M5-WO3 §73 states it ("quadruple Total
  Movement for the round": `final_movement * 4`, s438) and, per §75, treats each Sprint as a separate execution whose
  grant is computed from Final Movement — never from the accumulated allowance — so repeated Sprint is linear and
  never exponential. Today Final Movement equals Base Movement unless an explicit Movement modifier is supplied
  (M5-SC-033 has no values), so the two readings only diverge with such a modifier. Each execution's grant is a
  separate output. Designer confirmation is requested; nothing else depends on the choice. Guarded by M5-I109.
- **M5-WO4 ruling (WO3 status above was `UNRESOLVED`, resolution authority none)**: canonical Sprint Allowance =
  Movement × 4, where Movement = Base Movement × AGI (Base Movement 5 ft, AGI 4 → Movement 20 ft → Sprint 80 ft). Each
  Sprint execution independently grants Movement × 4; two Sprints never produce Movement × 4 × 4. There is no separate
  Total Movement (or WO3 "Final Movement") statistic: Move grants `movement`, Sprint grants `movement * 4` (both read the
  MOVEMENT statistic). The WO3 implementation (`final_movement * 4`, linear) was numerically identical for the standard
  character; only the terminology changed. Guarded by M5-I112 and the M5-WO4 audit.

### M5-SC-035 — Starting Rank Of New Level 9 Affinity

- **conflictKey**: `M5-SC-035`
- **systemFamily**: `AFFINITY`
- **concept**: The Affinity Rank at which a newly gained Level 9 Affinity begins
- **source A**: s161 Affinity Advancement: "At Level 9, choose one: Upgrade an Affinity Rank · Promote an Expert Affinity
  to Master · Gain a new Affinity" — no Rank is stated for the new Affinity.
- **source B**: s161 Level 6: "Gain a Secondary Affinity at Trained" states a Rank for the Level 6 option only; s118
  states the Level 1 Primary is chosen "but does not yet gain the full benefits of Affinity Rank".
- **mechanical consequence**: NONE, TRAINED, EXPERT and MASTER are all conceivable starting Ranks; Strength discount,
  Authority capacity and access differ by Rank.
- **status**: `RESOLVED_BY_DESIGNER`
- **resolution authority**: designer ruling after M5-WO4 (canon-rulings amendment); WO4 status was `UNRESOLVED`, resolution authority none
- **notes**: recorded by M5-WO4 §48. The `affinity.standard_progression` Definition exposes the Level 9 option
  `GAIN_NEW_AFFINITY` structurally with `startingRank: null` and `conflictKey: "M5-SC-035"`; it is never executed
  automatically. A profile that reaches it validates as `REQUIRES_CANON`, never `VALID`, whatever Rank it claims. Guarded
  by M5-I119 and M5-WO4 negative control §260.
- **Post-WO4 designer ruling (resolves M5-SC-035)**: "If you gain a new Affinity at 9, it is Trained. All Affinity level
  from themselves. You become Trained in your Affinity at 3, then Expert, then Master, or Trained - Expert, and another
  Trained, or three different affinities all trained." `GAIN_NEW_AFFINITY` now has `startingRank: "TRAINED"` and
  `conflictKey: null`; each Affinity's Rank advances independently. At Level 9 the three standard outcomes validate
  `VALID`: Primary Master; Primary Expert + one Secondary Trained; three Affinities Trained. A new Level 9 Affinity at any
  other Rank is `INVALID`. The progression interpreter still returns `REQUIRES_CANON` for any option whose starting Rank is
  unresolved content (null), so the fail-closed contract is kept for future content. M5-I119 is SUPERSEDED by M5-I151.

### M5-SC-036 — Base Movement Of Massive Creatures

- **conflictKey**: `M5-SC-036`
- **systemFamily**: `CHARACTER`
- **concept**: The Base Movement of a Massive creature
- **source A**: post-WO4 designer ruling on M5-SC-033: Small 5 ft, Medium 5 ft, Large 10 ft, Huge 15 ft (× AGI);
  Massive "TBD".
- **source B**: s442 Creature Space: Massive occupies "20 ft × 20 ft or larger" — occupied space only, and open-ended.
- **mechanical consequence**: a Massive creature's Movement cannot be computed; the pattern (+5 ft per Size above Medium)
  would suggest 20 ft, but the designer has not said so and Massive is open-ended.
- **status**: `RESOLVED_BY_DESIGNER`
- **resolution authority**: designer rulings batch after M5-WO4; earlier status was `UNRESOLVED`, resolution authority none
- **notes**: recorded by the post-WO4 canon-rulings amendment. `creature_size.massive` has `baseMovement: null`.
  Compiling a Massive character's core sheet fails closed with `PROWESS_CORE.SIZE_BASE_MOVEMENT_PENDING_CANON`; no value
  is guessed. Listed in `runtime-resources.json` `deferred`. Guarded by M5-I152 and the canon-rulings negative controls.
- **Rulings batch (post-WO4, resolves M5-SC-036)**: Huge Base Movement is 20 ft × AGI (this replaces the 15 ft from the earlier M5-SC-033 ruling) and Massive is double
  that, 40 ft × AGI. `creature_size.huge` = `{ feet: 20 }`, `creature_size.massive` = `{ feet: 40 }`; nothing is
  deferred. Guarded by M5-I154 (M5-I152 superseded).

### M5-SC-037 — Place Of Spell Interference Among The Spell Branches

- **conflictKey**: `M5-SC-037`
- **systemFamily**: `SPELL`
- **concept**: Whether Spell Interference is a Spell branch, a sub-branch, or something else
- **source A**: rulings batch on M5-SC-013: the Spell branches are Damage, Healing, Buff, Debuff, Control, Utility and
  Summoning; Cleanse (Healing) and Movement (Utility) are sub-branches. Spell Interference is not mentioned.
- **source B**: s621 lists Spell Interference as a branch; s1116 has a SPELL INTERFERENCE BRANCH section.
- **mechanical consequence**: its catalog placement, costs and Affinity Keywords depend on whether it is a branch or a
  sub-branch (and of which branch).
- **status**: `RESOLVED_BY_DESIGNER`
- **resolution authority**: designer ruling after the post-WO4 rulings batch; earlier status was `UNRESOLVED`, resolution authority none
- **notes**: recorded by the post-WO4 rulings batch. Terminology inventory: Spell Interference `UNRESOLVED`. Needed
  before the Spell Effect catalog Work Order.
- **Follow-up ruling (resolves M5-SC-037)**: Spell Interference is NOT a branch. It is a ruling used by Counter Spelling, which belongs in Utility: Counter
  Spelling uses Spell Interference. Terminology: Spell Interference is SYSTEM_SPECIFIC (a Utility mechanic), not an
  Effect family.


### M5-SC-038 — Active Effects Capacity And The Concentration Base

- **conflictKey**: `M5-SC-038`
- **systemFamily**: `CHARACTER`
- **concept**: How many Active Effects a character can carry, and whether Concentration has a base before +1 per 3 RES
- **source A**: rulings batch on M5-SC-007: Concentration is +1 per 3 RES (+1 from Expert Arcana); Active Effects are a
  separate pool — the total positive effects on a character, each effect counting.
- **source B**: s26 attaches "+1 per 3 RES" to "the Maximum number of Active Effects a character can sustain"; s664 gave
  a base of 1. Neither states the Active Effects capacity under the two-pool ruling.
- **mechanical consequence**: the Active Effects limit cannot be computed; a low-RES character may have 0 Concentration
  if there is no base.
- **status**: `RESOLVED_BY_DESIGNER`
- **resolution authority**: designer ruling after the post-WO4 rulings batch; earlier status was `UNRESOLVED`, resolution authority none
- **notes**: recorded by the post-WO4 rulings batch. Needed by M5-WO13 (Sustain / Mana Lock / Concentration).
- **Follow-up ruling (resolves M5-SC-038)**: Active Effects are set by CON: 1 Active Effect per 2 CON (the number of positive effects that can be on a target at
  one time). Concentration starts at a base of 1 and gains +1 per 3 RES (Expert Arcana still adds +1 — M5-SC-007).
  Recorded for M5-WO13 (Sustain / Mana Lock / Concentration); no executable capacity statistic exists yet.


### M5-SC-039 — Projectile Base MP Cost

- **conflictKey**: `M5-SC-039`
- **systemFamily**: `SPELL`
- **concept**: The Base MP Targeting cost of Projectile
- **source A**: rulings batch on M5-SC-016: Projectile is a canonical (Attack-Roll-oriented) Spell Targeting Type; s842
  "Projectile is treated as a Single Target delivery type unless modified by a Trait". The Core Playtest Targeting Types
  table (s628) has no Projectile row.
- **source B**: the older, lower-authority Chapter Book lists Projectile at 2 MP. That value is not Core Playtest canon.
- **mechanical consequence**: a Projectile Spell's listed Targeting MP — and so its total Spell MP — cannot be computed.
- **status**: `RESOLVED_BY_DESIGNER`
- **resolution authority**: M5-WO7 post-WO6 designer ruling
- **notes**: recorded by M5-WO6. WO6 authors the Projectile Targeting Definition (identity, one primary target, default
  Spell Range, delivery family, compatibility) with its base contribution `BASE_DEFERRED` (M5-SC-039); no 2 / 0 / 3 MP
  value is authored. M5-WO10 must resolve it before complete Projectile Spell pricing can pass.



- **M5-WO7 resolution**: Projectile Targeting costs exactly **3 MP**, uses the caster current applicable Range, and requires a **Ranged Attack Roll** delivery check. The delivery check is distinct from Effect outcome; an ATTACK_ROLL Effect reuses the same roll, while a SAVING_THROW Effect resolves its Effect-owned Save only after delivery hits.

### M5-SC-040 — Spell Line Width Rounding / Minimum

- **conflictKey**: `M5-SC-040`
- **systemFamily**: `SPELL`
- **concept**: The base width of a Spell Line
- **source A**: Core Playtest SPELL RANGE AND AREA SCALING (s628–s631), Area Scaling table: "Line Width — 5 ft wide per 2 Prowess".
- **source B**: no source states the rounding for odd PRO, the width at PRO 1, or a minimum width (5 ft?).
- **mechanical consequence**: the Line width is ambiguous for PRO 1 and every odd PRO.
- **status**: `RESOLVED_BY_DESIGNER`
- **resolution authority**: M5-WO7 post-WO6 designer ruling
- **notes**: recorded by M5-WO6. The Spell Line Definition stores the rule text with `valueStatus: DEFERRED_PENDING_CANON`
  (M5-SC-040) and emits no width. Line identity, base MP, length (15 ft × PRO), origin and the +5 ft width scaling option
  (+4 MP) stay executable.

- **M5-WO7 resolution**: current Spell Line length is **10 ft × PRO** and width is **5 ft × ceil(PRO / 2)**. WO6 historical Releases preserve their earlier 15×PRO/deferred-width assumptions; current canon does not mutate them.

### M5-SC-041 — WO8 Normal Trait Hard Cap Versus The Approved Spell Trait Exchange

- **conflictKey**: `M5-SC-041`
- **systemFamily**: `SPELL`
- **concept**: Whether WO8's three-normal-Trait limit also limits Traits gained by an explicit Effect-slot exchange.
- **source A**: M5-WO8 §11 says maximum Traits equals the applicable Arcane or Affinity Rank and establishes a general
  hard cap of three normal Traits. It distinguishes Affinity-specific additional capacity from ordinary capacity.
- **source B**: approved M5-WO5 §6.3 and §63–§67, retained by M5-I156, permit an explicit one-for-one exchange of Effect
  slots for Trait slots while retaining at least one Effect. Permanent golden tests explicitly require Arcane Expert
  with one exchange to allow three Traits, and Arcane/Affinity Master with two exchanges to allow five Traits.
- **mechanical consequence**: an absolute cap of three normal Traits would invalidate approved legal configurations
  and break the WO5 regression that WO8 §39 requires to remain green. The existing exchange is not an Affinity-specific
  bonus and cannot silently be reclassified as one.
- **status**: `RESOLVED_BY_DESIGNER`
- **resolution authority**: explicit designer selection of option 1 in the WO8 implementation chat (2026-10-21).
- **implementation baseline**: `283a7c3f064307d0a2385daf995ad936b2b74e58` (WO7 merge, PR #48); permanent main workflows
  200 and 43 were verified successful before WO8 work.
- **resolution**: three limits base normal Trait capacity; an explicitly selected approved
  Effect-slot exchange can increase that capacity, with any authoritative Affinity-specific additional allowance
  represented separately. The approved exchange and historical Definitions are preserved.
- **affected guards**: `packages/prowess-game/src/construction-legality-golden.test.ts` §65–§67;
  `packages/prowess-game/src/construction-legality-contracts.test.ts`; M5-I156.
- **notes**: no executable rule, existing Definition, historical Release or regression expectation has been changed.


### M5-SC-042 — Additional Affinity Trait Capacity Has No Authored Grant Yet

- **conflictKey**: `M5-SC-042`
- **systemFamily**: `SPELL`
- **concept**: Numeric additional Affinity-specific Trait capacity beyond ordinary/exchanged slots.
- **source A**: WO8 §11 allows an additional allowance only where supported by authoritative progression rules.
- **source B**: current permanent Affinity Rank/Progression Definitions author authority base capacity and advancement,
  but no separate additional Trait capacity grant. M5-SC-041 preserves the ordinary Effect-slot exchange.
- **status**: `UNRESOLVED`
- **resolution authority**: none; no numeric bonus invented.
- **notes**: WO8 preserves an explicit separate additional-capacity surface and refuses non-empty allocations with
  PROWESS_TRAIT.CAPACITY_UNRESOLVED. Affinity-specific Traits may use ordinary/exchanged slots when their exact
  prerequisite and Strength Keyword checks pass. Later authoritative grants can activate extra capacity.

### M5-SC-043 — Cannot Move This Turn Has Conflicting Listed AP Benefits

- **conflictKey**: `M5-SC-043`
- **systemFamily**: `MANEUVER`
- **source A**: Core Playtest s2020 Common Conditions lists Cannot Move This Turn as 1 AP reduction.
- **source B**: s2099 Movement Conditions lists the same before/after-turn restriction as 2 AP reduction.
- **status**: `UNRESOLVED`
- **resolution authority**: none.
- **mechanical consequence**: the representative Definition is DEFERRED and exposes no guessed discount. WO9 can
  represent the restriction, but cannot choose between these values. SC025's 3 AP total cap remains authoritative.

### M5-SC-044 — Discretionary Benefits And Incomplete Restriction Subjects

- **conflictKey**: `M5-SC-044`
- **systemFamily**: `ABILITY`
- **source A**: s674 Material requires a chosen specific component; s675 Delayed and Environmental need a specified
  timing/trigger or environment. Risk gives an open-ended percentage and Focus is GM-set. Weapon Lock requires a
  specific weapon; Environmental Lock provides a discretionary range (s2020 and detailed Maneuver Conditions).
- **source B**: source Once per Mission lists 5 AP, while the designer ruling SC025 caps all Maneuver Conditions at 3.
- **status**: `UNRESOLVED`
- **resolution authority**: none for unspecified subjects, discretionary values or an exact replacement mission benefit.
- **mechanical consequence**: generic reference templates remain DEFERRED. Exact authored subjects/requirements and
  objective contributions can use the typed framework; authors cannot supply an arbitrary discount parameter.
  No default Material benefit, discretionary range selection or replacement 5-to-3 AP entry is invented.

### M5-SC-045 — Permanent Duration Has No General Authored Access Rule

- **conflictKey**: `M5-SC-045`
- **systemFamily**: `SPELL`
- **source A**: s657 permits Permanent only by special rules.
- **source B**: s662 discusses indefinite maintained Sustain, with AP and Concentration requirements; it does not grant
  the Permanent Duration or authorize a universal price/access rule.
- **status**: `UNRESOLVED`
- **resolution authority**: none.
- **mechanical consequence**: Permanent uses the existing PERMANENT_BY_SPECIAL_RULE token and remains DEFERRED.
  No free Permanent mode or automatic conversion from Sustained exists. SC042 remains independently unresolved.

### M5-SC-046 — Multi-Target Additional-Target Pricing Has No Authored Base Count

- **conflictKey**: `M5-SC-046`
- **systemFamily**: `SPELL`
- **source A**: s628 Targeting Types: Multi-Target 5 MP "affects multiple chosen targets"; s631 scaling "+1 Multi-Target
  target +3 MP" (WO6 `PER_ADDITIONAL_TARGET`).
- **source B**: no source states how many targets the 5 MP base covers, so a selected `targetCount` cannot be turned into a
  number of additional targets (WO6 records "no invented base count").
- **status**: `UNRESOLVED`
- **resolution authority**: none.
- **mechanical consequence**: recorded by M5-WO10. A Spell whose Multi-Target use selects a target count fails closed with
  `PROWESS_SPELL_COST.UNRESOLVED_CONTRIBUTION`; no base count is guessed.

### M5-SC-047 — Signature Spell MP Discount Has No Current Structured Authority

- **conflictKey**: `M5-SC-047`
- **systemFamily**: `SPELL`
- **source A**: older, lower-authority Chapter Book material describes an MP discount for Signature Spells.
- **source B**: the Core Playtest Packet V0.1 TOTAL MP FORMULA (s645) lists no Signature modifier; no designer ruling,
  CanonDecision or structured Ruleset Definition authors one.
- **status**: `UNRESOLVED`
- **resolution authority**: none.
- **mechanical consequence**: recorded by M5-WO10. Final Spell cost applies no Signature discount and has no name-based
  shortcut; the Signature slot state never changes cost. A future structured percentage modifier would join the single net
  percentage.


### M5-SC-048 — Elemental Damage Conversion MP Cost And Its Relevant-Affinity Reduction Are Not Exactly Structured

- **conflictKey**: `M5-SC-048`
- **systemFamily**: `MANEUVER`
- **source A**: Core Playtest Packet V0.1 §10 Elemental Damage Conversion (s2012–s2017): "+5 MP, reduced by relevant Affinity
  Rank" — None 5 MP · Trained −1 → 4 · Expert −2 → 3 · Master −3 → 2, minimum 2 MP; the relevant Affinities depend on the
  chosen element (e.g. Fire → Emission, Transmutation; Metal → Transmutation, Enhancement).
- **source B**: the permanent M5-WO7 canonical Definition `maneuver.effect.elemental_damage_conversion` lists one FIXED
  +4 MP with no Affinity rule; the element → relevant-Affinity table names an Affinity ("Emission") that the current
  Affinity catalog does not contain.
- **status**: `UNRESOLVED`
- **resolution authority**: none.
- **mechanical consequence**: recorded by M5-WO11. The Ruleset's Maneuver cost policy lists the canonical Definition as an
  unresolved component cost, so a Maneuver using it fails closed with `PROWESS_MANEUVER_COST.UNRESOLVED_CONTRIBUTION`
  instead of consuming 4 MP or inventing an element → Affinity mapping. WO11 adds the generic, exact structured
  Effect-specific rule (`affinityReduction`: exact relevant Affinities, per-rank flat reductions, component minimum) that a
  future authored version of this Effect can use; WO7's listed value is not changed here.
