# RULES-WO1 Invariant Catalog (Complete Game Authoring)

Machine-readable twin: `rules-wo1-invariants.json`. The permanent RULES-WO1 gate (`apps/studio/tests/unit/rules-wo1-static.test.ts`)
requires every id below, each naming existing automated guards. M4, M5, M6 and M7 invariants are frozen and are not repeated here.

### RW1-I001 — Additive Rule Kinds Only

- **Group:** Contract
- **Meaning:** CALCULATED_VALUE, SKILL_BENEFIT and CONCENTRATION_RULE are new version-1 kinds registered through the approved-M5-change entry RULES-WO1; every pre-existing kind specification, payload contract and stored Definition is unchanged.
- **Guards:** `apps/studio/tests/unit/rules-wo1-static.test.ts`, `packages/prowess-game/src/rules-wo1-authoring.test.ts`, `scripts/rules-wo1-negative-controls.mjs`, `packages/prowess-game/src/m6-wo9-registry.test.ts`

### RW1-I002 — One Record Per Rule

- **Group:** Authority
- **Meaning:** A new game value is its own versioned Definition, never a field added to a STAT; a Stat page shows the rules that read it from the exact Release's rule graph, and a Skill benefit adds to a value by name through its own Definition.
- **Guards:** `apps/studio/tests/unit/rules-wo1-static.test.ts`, `packages/prowess-game/src/rules-wo1-authoring.test.ts`, `scripts/rules-wo1-negative-controls.mjs`, `packages/prowess-db/tests/integration/rules-wo1-authored-rules.test.ts`

### RW1-I003 — M4 Is The Only Arithmetic

- **Group:** Authority
- **Meaning:** Every base, every Skill-benefit addition, every sum and every Concentration preview step is an M4 Formula run by evaluateFormula; the game modules carry no operator arithmetic and the Studio shows only server numbers.
- **Guards:** `apps/studio/tests/unit/rules-wo1-static.test.ts`, `packages/prowess-game/src/rules-wo1-authoring.test.ts`, `scripts/rules-wo1-negative-controls.mjs`, `apps/studio/tests/unit/rules-wo1-authoring-ui.test.tsx`

### RW1-I004 — Nothing Unstated Is Invented

- **Group:** Canon
- **Meaning:** A value whose base the rulebook does not state has base null and is shown as bonuses only, with that fact stated; a non-canonical rule must say why and a canonical rule must cite its source; the shipped content carries no Carry Capacity formula.
- **Guards:** `apps/studio/tests/unit/rules-wo1-static.test.ts`, `packages/prowess-game/src/rules-wo1-authoring.test.ts`, `scripts/rules-wo1-negative-controls.mjs`, `apps/studio/tests/unit/rules-wo1-authoring-ui.test.tsx`

### RW1-I005 — Missing Inputs Are Unavailable, Never Zero

- **Group:** Evaluation
- **Meaning:** An input the Character lacks makes the value unavailable with a reason; a value that depends on itself is refused, not broken arbitrarily; a duplicated value name shows neither.
- **Guards:** `apps/studio/tests/unit/rules-wo1-static.test.ts`, `packages/prowess-game/src/rules-wo1-authoring.test.ts`, `scripts/rules-wo1-negative-controls.mjs`

### RW1-I006 — Concentration Is Preview Only

- **Group:** Scope
- **Meaning:** The CONCENTRATION_RULE is read only by its own preview, which reports appliesInPlay false and lists its open questions; no play, combat or Active Magic module reads it, and the Studio says so wherever the preview is shown.
- **Guards:** `apps/studio/tests/unit/rules-wo1-static.test.ts`, `packages/prowess-game/src/rules-wo1-authoring.test.ts`, `scripts/rules-wo1-negative-controls.mjs`, `apps/studio/tests/unit/rules-wo1-authoring-ui.test.tsx`, `packages/prowess-db/tests/integration/rules-wo1-authored-rules.test.ts`

### RW1-I007 — Previews Are Isolated

- **Group:** Authority
- **Meaning:** The authored-rule preview evaluates the published Release and an in-memory candidate in which Drafts replace pins or are added; it creates, changes or publishes no Release, Manifest, pin or revision.
- **Guards:** `apps/studio/tests/unit/rules-wo1-static.test.ts`, `packages/prowess-game/src/rules-wo1-authoring.test.ts`, `scripts/rules-wo1-negative-controls.mjs`, `packages/prowess-db/tests/integration/rules-wo1-authored-rules.test.ts`

### RW1-I008 — Earlier Releases Are Unchanged

- **Group:** Release
- **Meaning:** Without a published calculated value the Character sheet is byte-identical to before; publishing a value as Release 2 leaves a Release-1 Character's sheet and stored rows unchanged.
- **Guards:** `apps/studio/tests/unit/rules-wo1-static.test.ts`, `packages/prowess-game/src/rules-wo1-authoring.test.ts`, `scripts/rules-wo1-negative-controls.mjs`, `packages/prowess-db/tests/integration/rules-wo1-authored-rules.test.ts`

### RW1-I009 — Build Identity Is Visible

- **Group:** Distribution
- **Meaning:** The desktop controller passes the app version, source commit, tree and package fingerprint to Studio; About this build shows them and lists which kinds this build edits with a guided editor, refusing malformed values.
- **Guards:** `apps/studio/tests/unit/rules-wo1-static.test.ts`, `packages/prowess-game/src/rules-wo1-authoring.test.ts`, `scripts/rules-wo1-negative-controls.mjs`, `apps/studio/tests/unit/rules-wo1-authoring-ui.test.tsx`
