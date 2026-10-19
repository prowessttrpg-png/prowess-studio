# M5-WO5 Invariant Extension

This append-only extension follows the canonical M5 invariant catalog through M5-I155. M5-WO5 adds exactly two invariants; prior invariant IDs and supersession history are unchanged.

## M5-I156 — Spell Construction Access Has Two Explicit Authority Paths

- **Group:** Ability Construction Access
- **Meaning:** A character may construct a Spell only through one explicit selected construction Authority. Arcane Authority requires the character's Arcana Skill (Arcane Rank) at Trained or higher. Affinity Authority requires one exact relevant Affinity owned at Trained or higher. Neither path is auto-selected and the two Authority capacities never add together.
- **Guards:** `packages/prowess-game/src/ability-construction-golden.test.ts`, `packages/prowess-game/src/ability-construction-contracts.test.ts`, `apps/studio/tests/unit/m5-wo5-static.test.ts`, `scripts/m5-wo5-negative-controls.mjs`.

## M5-I157 — Casting Condition Capacity Comes Only From Arcane Rank

- **Group:** Ability Construction Capacity
- **Meaning:** Spell Casting Condition capacity is determined only by the character's Arcana Skill / Arcane Rank: Untrained 0, Trained 1, Expert 2, Master 3. The selected Spell Authority does not change that capacity. Affinity Rank never grants Casting Condition slots. Therefore an Arcane-Trained caster using Affinity Authority still has one slot, while an Affinity-only caster with no Arcane training has zero.
- **Guards:** `packages/prowess-game/src/ability-construction-golden.test.ts`, `packages/prowess-game/src/ability-construction-contracts.test.ts`, `apps/studio/tests/unit/m5-wo5-static.test.ts`, `scripts/m5-wo5-negative-controls.mjs`.
