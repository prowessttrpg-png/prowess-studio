# M6-WO7 — Signature Spell Builder: Handoff (paused at the user's request)

Branch `m6-wo7`, based on `main` `28bcfaecd98c0852446dbb278a88d6091d347cc9`. The implementation is complete and committed.
Full local verification was mostly done when it was paused. This document lists exactly what remains. The work order
text is in the project doc `claude/m6-wo7-work-order.md`. Design decisions are in
`docs/architecture/m6-signature-spell-builder.md`.

## 1. Status at pause

Local verification already run on this branch, all passing unless marked otherwise:

- Migrations applied fresh to `prowess_studio_test` (WO3–WO7).
- `pnpm run db:generate`, workspace package builds, lint, architecture checks, typecheck.
- Gate inventory: 39 gates, 535 controls. The control-harness self-test passed.

**Unit test totals**

| Suite | Passed |
| --- | --- |
| model | 513 |
| ui | 21 |
| import | 128 |
| rules | 659 |
| game | 1700 (includes WO7: 35 adapter/world tests and 314 M5 characterization tests) |
| db | 146 |
| studio | 3445 (includes WO7: static gate and 17 UI tests) |

**Integration**

- Studio API integration: 228 passed, including the 3 WO7 API tests.
- **DB integration: 605 passed, 1 FAILED.** This is the one known remaining fix (§2.1). The WO7 DB suites themselves
  pass: 12 Signature Spell tests and 2 migration-compat tests.

**Build and E2E**

- Production build: passed.
- Playwright: the 5 WO7 specs (§156–§160) passed in a dedicated run. The full suite was stopped at the pause after
  42 passed and 0 failed.

**Controls**

- WO7 negative controls: all 68 were caught and restored, across four batches (1–15, 16–23, 24–51, 52–68). Controls 16
  and 52 were strengthened after their first runs.
- The historical control scripts (M4-FINAL … M6-WO6) were not yet re-run on the final tree.

## 2. Remaining work

### 2.1 Fix: DB public-surface allowlist (the one failing test)

The failing test is `packages/prowess-db/tests/integration/entity-version-lifecycle.test.ts`, "exposes no public
operation that bypasses lifecycle rules via a generic update". The WO7 service exports must be added to its two lists,
following the WO6 pattern around lines 516–531:

1. The full exported-names list (around line 516) needs these nine names, kept in alphabetical position:
   - `createCharacterSignatureSpell`
   - `finalizeCharacterSignatureSpell`
   - `getCharacterAbilities`
   - `getCharacterSignatureSpell`
   - `getSignatureSpellBuilder`
   - `rebuildCharacterSignatureSpell`
   - `retireCharacterSignatureSpell`
   - `updateCharacterSignatureSpellDraft`
   - `validateCharacterSignatureSpell`
2. The `mutatorLike` expectation (around line 531) needs `"updateCharacterSignatureSpellDraft"` added in sorted
   position.
3. Add a comment in the WO6 style: "M6-WO7: updateCharacterSignatureSpellDraft writes only
   character_signature_abilities (compare-and-set on lockVersion; proven from signature-spell-repository.ts)".

Then re-run `pnpm --filter @prowess/db run test:integration`. Check that nothing else in the DB integration suite fails.

### 2.2 Finish full local verification

Scripts in the previous workspace (recreate if missing):

```bash
cd <repo root>
export PRISMA_SCHEMA_ENGINE_BINARY=/bin/true   # only where the Prisma engine is unavailable
pnpm --filter @prowess/db run test:integration
APP_URL=http://127.0.0.1:3100 DATABASE_URL=postgresql://postgres:postgres@localhost:5432/prowess_studio_test \
  LOG_LEVEL=warn DEVELOPMENT_MODE=false pnpm build
PROWESS_E2E_PREBUILT=1 CI=1 APP_URL=... DATABASE_URL=... pnpm run test:e2e    # full Playwright suite
# every control script, one at a time, never concurrently with edits (the harness checks the whole tree):
for s in m4-final m5-wo1 … m6-wo6 m6-wo7; do PROWESS_EXPECT_CONTROLS=<n> node scripts/$s-negative-controls.mjs; done
```

Control counts are in `scripts/ci/gates.json`. WO7 is `PROWESS_EXPECT_CONTROLS=68`. The combined total is 535.

Prisma `validate` and `migrate diff` (drift) could not run in the original sandbox. They run in Tier 2 CI.

### 2.3 Implementation report

`docs/reports/m6-wo7-implementation-report.md` is currently a skeleton. The WO7 static gate requires its section
headings: `## N. Test Totals`, `## N. Architecture Gate` and `## N. Controls`. Fill in the 72 items of WO §175 from
§1 above, the architecture doc and the facts below. Save a copy to the project as
`claude/m6-wo7-implementation-report.md`.

Facts to include in the report:

- **Migration.** `20261103010000_m6_wo7_signature_spells` adds two models: `CharacterSignatureAbility` (SPELL only,
  DRAFT / ACTIVE / RETIRED) and `CharacterSignatureSpellRevision` (append-only trigger, owned-current-revision trigger).
- **Approved additive M5 refactor.** Registry entry `M6-WO7` in `docs/architecture/m6-approved-m5-changes.json`:
  - `compileAuthoredAbilityCore`
  - `compileSpellCostCore`
  - `compileExecutionCore`
  - exported `TRAIT_SCOPE_TARGET_SLOTS`

  It is proven byte-identical by 313 stored digests generated at the base commit
  (`packages/prowess-game/src/m6-wo7-m5-characterization.test.ts`).
- **Adapter.** `packages/prowess-game/src/character/signature-spell.ts` (`evaluateCharacterSignatureSpell`). It creates
  no synthetic canon and passes no access grants. The catalog builder is `signature-spell-catalog.ts`.
- **Service and repository.** `packages/prowess-db/src/character/signature-spell-{service,repository}.ts`. Finalization
  runs in one transaction with the Character row locked `FOR UPDATE`. The sheet read model gains `signatureSpells`.
- **API.** Nine routes, registered under `M6-WO7` in `docs/architecture/m6-api-routes.json`.
- **Studio.**
  - Abilities tab.
  - Pages: `/characters/:id/abilities`, `/spells/new`, `/spells/:id` and `/spells/:id/edit`.
  - 10-step builder with live review, autosave (Saving / Saved / Conflict) and an unload warning.
  - Sheet Actions lines in `SpellRows.tsx`.
- **Findings (content gaps, not code).**
  1. Under Affinity Authority, M5 checks Affinity access for every component, including Targeting and Duration. Core
     content authors no such access, so Affinity-Authority Spells cannot be built from Core content alone. The test
     worlds add test-only `affinityAccess`.
  2. The Performance Casting Condition is absent from Release content (§68). The builder reports the gap.
  3. A Release without an Effect execution policy produces a runtime deferral
     (`PROWESS_EFFECT_EXECUTION.MISSING_POLICY`).
- **Earlier gates adjusted.** Each change is a narrow, commented allowance:
  - m2-final mutation list
  - m6-wo3 (createSpell text; Arcana / Performance wording)
  - m6-wo5 (SHEET_UI file list; WO7 spell routes)
  - m6-wo6:
    - schema strip loops over later WOs
    - `expectedFrozenHash`
    - `inv.slice(0, 76)`
  - ci-gate-inventory counts
  - The M5-WO10 static text pin is preserved by keeping the variable name `spellRef`.

### 2.4 Publication (requires the user's approval at each step)

1. Push `m6-wo7`, open a **draft** PR and run the permanent Tier 2 CI. Fix anything Tier 2 finds, including Prisma
   validate, drift ("No differences") and the full controls.
2. **Green CI is not merge authorization.** Stop and request explicit merge approval (WO §178).
3. After the merge, verify `main` and report "M6-WO7 COMPLETE — SIGNATURE SPELL BUILDER READY". Only then start M6-WO8.

## 3. Boundaries (unchanged)

STOP conditions are in WO §176. The work must not:

- change Spell MP or AP formulas, Affinity economics, Effect or Trait behaviour, chain routing or Active Magic;
- resolve M5-SC-042 through M5-SC-053;
- create canonical Spell Definitions for players;
- build Ability Card architecture, live casting or the Maneuver Builder.
