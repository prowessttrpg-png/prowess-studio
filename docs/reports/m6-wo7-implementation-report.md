# M6-WO7 — Signature Spell Builder: Implementation Report

## 1. Repository And Scope

Work Order: **M6-WO7 — Signature Spell Builder**. Repository: `prowessttrpg-png/prowess-studio`.
Branch: `m6-wo7`. Base/main: `28bcfaecd98c0852446dbb278a88d6091d347cc9` (merged M6-WO6).
Implementation and corrective-test HEAD: `7220c73c04bf6a43f8038922274fe68fabba635b`.
Final report/publication HEAD is the commit containing this report (`git log -1 --format=%H -- docs/reports/m6-wo7-implementation-report.md`);
its exact SHA and same-head Tier 2 certification are recorded in the existing PR #69 description. This avoids a
self-referential commit hash inside the commit being identified. No merge is authorized by this report.

Publication: existing [PR #69](https://github.com/prowessttrpg-png/prowess-studio/pull/69), base `main`, head `m6-wo7`,
converted from open/ready to **Draft** during recovery. No replacement PR was created. The branch is published;
merged-main verification remains a separate, explicitly authorized step.

| Comparison with the M6-WO6 base | Commits ahead / behind | Changed files | Additions | Deletions |
| --- | --- | --- | --- | --- |
| Handoff `4acb4f258c716e6579d40fb5fc9cd59a57e73509` | 10 / 0 | 76 | 14,970 | 64 |
| Corrective-test HEAD `7220c73c04bf6a43f8038922274fe68fabba635b` | 11 / 0 | 77 | 14,987 | 65 |
| Report/publication commit | 12 / 0 | 77 | 15,294 | 65 |

The recovery changes only the lifecycle public-surface test and this implementation report. The existing substantive
implementation is preserved: Character-owned persistence/history, the M5 adapter and Release catalog, nine routes,
the ten-step builder, Abilities/detail/history views, sheet rows, autosave/concurrency, permanent gates and controls.
Architecture: `docs/architecture/m6-signature-spell-builder.md`. Invariants: **M6-I077–M6-I098** (22), following
M6-I001–M6-I076 in `docs/architecture/m6-invariants.{json,md}`.

The current recovery/completion handoff is the implementation contract. The repository architecture, approved-M5
registry, migration, service/repository, adapter, gates and test evidence were inspected. The older project document
`claude/m6-wo7-work-order.md` referenced by the repository handoff was not found by its exact name in connected Drive;
no older Chapter Book rule or prose formula was substituted. No third-party API change was needed in recovery.

## 2. Architecture And Authority

```text
Canonical Release
  ↓
Targeting / Effect / Trait / Duration / Casting Condition Definitions
  ↓
Character Mechanical Profile
  ↓
Character-owned Signature Spell
  ↓
evaluateCharacterSignatureSpell
  ↓
existing M5 construction / cost / execution cores
  ↓
M4 numerical evaluation
  ↓
Abilities UI / Spell Detail / Character Sheet
```

**Signature Spells are Character state, not Canon Definitions.** Player compositions are never published into
Compendium canon. Every component retains its exact entity/version identity in the Character's pinned Release;
there is no latest-revision substitution. Names, descriptions, visuals, notes and narrative tags are inert prose;
narrative tags do not become Keywords or executable rules.

The single Character Mechanical Profile supplies Stats, Skills, Affinity and construction context. The server owns
validation and derived values; Studio collects authored selections and formats the server's results. Existing M4
arithmetic and M5 construction, cost, chain and runtime-policy contracts remain authoritative.

## 3. Persistence And Migration

Migration: `packages/prowess-db/prisma/migrations/20261103010000_m6_wo7_signature_spells/migration.sql`.
Registered under M6-WO7 in `docs/architecture/m6-schema-changes.json`; exactly two models/tables are added:

| Model / table | Persisted state |
| --- | --- |
| `CharacterSignatureAbility` / `character_signature_abilities` | Character-owned header; kind `SPELL`; lifecycle `DRAFT`, `ACTIVE`, `RETIRED`; current revision; working draft; `lockVersion`; creation/update/retirement metadata |
| `CharacterSignatureSpellRevision` / `character_signature_spell_revisions` | Append-only finalized revision; revision number; exact Character Release provenance; previous revision link; strict payload; creation timestamp |

No derived AP, MP, cost, range, capacity, Sustain or discount column is persisted. Stored payloads contain selections
and prose and are re-read through the strict versioned `readSignatureSpellDraft` reader before use. The Character's
Release is unchanged. Foreign keys use RESTRICT; CHECK constraints close kind/status, require object payloads and
positive revision/lock numbers, and enforce retirement/current-revision consistency. The
`CHARACTER_SIGNATURE_SPELL_REVISION_IMMUTABLE` trigger rejects revision UPDATE/DELETE; the owned-current-revision
trigger refuses a revision belonging to another ability. Historical migrations remain untouched.

The repository is `packages/prowess-db/src/character/signature-spell-repository.ts`; the service is
`packages/prowess-db/src/character/signature-spell-service.ts`. Its writes affect only the two Character-owned
Signature tables. Reading/locking the Character row during finalization does not mutate that Character or canon.

## 4. Lifecycle And Concurrency

| Operation | Result |
| --- | --- |
| Create | `DRAFT`, initial composition, no revision and no Signature slot consumed |
| Edit draft | Compare-and-set on ability `lockVersion`; stale write returns 409 |
| Validate | M5 evaluates the saved draft; validation does not finalize it |
| Finalize | Atomically append Revision N+1, set `ACTIVE`, update current revision and clear the draft |
| Rebuild | Copy the current revision's selections into a working draft; keep the current revision |
| Discard rebuild | Submit a null draft for the active Spell; clear the rebuild only |
| Retire | Set `RETIRED`, release the slot and preserve all history |

Finalization is one transaction. It locks the Character row `FOR UPDATE`, re-checks Character lockVersion and Release,
re-checks ability lockVersion, counts other ACTIVE Signature Abilities, calls the M5 evaluation with that exact roster,
then appends and switches revisions only on success. Two competing finalizations cannot both claim the last slot.
An invalid rebuild never replaces its valid current revision. Capacity failure is 409
`SIGNATURE_CAPACITY_EXCEEDED` only if the same Spell would otherwise be accepted with a free slot; other invalid
finalizations return 422 `SIGNATURE_SPELL_NOT_FINALIZABLE`. RETIRED Spells cannot be edited or finalized again.

## 5. Approved Additive M5 Refactor

The M6-WO7 entry in `docs/architecture/m6-approved-m5-changes.json` records exact changed/added paths and hashes.
It exposes existing pure cores without redefining Spell or Maneuver behavior:

| Existing module | Additive export |
| --- | --- |
| `packages/prowess-game/src/ability/compile.ts` | `compileAuthoredAbilityCore` |
| `packages/prowess-game/src/ability/spell-cost.ts` | `compileSpellCostCore` |
| `packages/prowess-game/src/ability/effect-execution.ts` | `compileExecutionCore` |
| `packages/prowess-game/src/construction/composition.ts` | `TRAIT_SCOPE_TARGET_SLOTS` |

The canonical entry points delegate to those cores. Permanent characterization:
`packages/prowess-game/src/m6-wo7-m5-characterization.test.ts` and
`packages/prowess-game/src/testing/m6-wo7-m5-characterization.json`. The stored **313 base-generated digests** cover
compiled/evaluated authored Spell and Maneuver plans, costs and execution plans from the M6-WO6 base. Together with
the coverage test this is 314 tests. Digests/golden outputs were not altered during recovery. Adapter equivalence
also checks the M5-WO10 golden Spell contributions and MP/AP results.

## 6. Signature Spell Adapter And Catalog

Primary adapter: `packages/prowess-game/src/character/signature-spell.ts`, `evaluateCharacterSignatureSpell`.
Catalog: `packages/prowess-game/src/character/signature-spell-catalog.ts`, `buildSignatureSpellCatalog`.

The adapter reads the authored payload using M5's closed contract, passes the one Character construction context and
shared Signature usage to the construction core, compiles the M5 cost plan and evaluates it through M4. It creates no
synthetic canonical Spell Definition, passes no automatic access grants, and accepts no user-authored derived costs.
The catalog uses the exact Release bundle and existing eligibility; no hardcoded substitute components are offered.

Presentation states are `INCOMPLETE`, `INVALID`, `VALID`, `VALID_WITH_RUNTIME_DEFERRED`. Cost appears only when M5 can
price a valid Spell; otherwise the UI shows **Cost unresolved**, not zero. Execution-chain and Active Magic policy
reads describe readiness and deferrals; they do not execute a Spell.

## 7. API

The nine routes are registered under M6-WO7 in `docs/architecture/m6-api-routes.json`:

| Method | Route | Service |
| --- | --- | --- |
| GET | `/api/characters/:id/abilities` | `getCharacterAbilities` |
| POST | `/api/characters/:id/spells` | `createCharacterSignatureSpell` |
| GET | `/api/characters/:id/spells/:spellId` | `getCharacterSignatureSpell` |
| GET | `/api/characters/:id/spells/:spellId/builder` | `getSignatureSpellBuilder` |
| PUT | `/api/characters/:id/spells/:spellId/draft` | `updateCharacterSignatureSpellDraft` |
| POST | `/api/characters/:id/spells/:spellId/validate` | `validateCharacterSignatureSpell` |
| POST | `/api/characters/:id/spells/:spellId/finalize` | `finalizeCharacterSignatureSpell` |
| POST | `/api/characters/:id/spells/:spellId/rebuild` | `rebuildCharacterSignatureSpell` |
| POST | `/api/characters/:id/spells/:spellId/retire` | `retireCharacterSignatureSpell` |

Routes remain thin DB-service adapters with central error mapping. Create accepts `{ name }`; draft accepts
`{ expectedVersion, draft }`; named commands accept `{ expectedVersion }`. Unknown/derived body fields are rejected
with 400; missing identity is 404, stale version 409, invalid finalization 422 and capacity exhaustion 409.

## 8. Studio And Character Sheet

The Abilities tab is available at `/characters/:id?view=abilities`, with a dedicated `/characters/:id/abilities` page.
Other pages: `/characters/:id/spells/new`, `/characters/:id/spells/:spellId` (detail/history), and
`/characters/:id/spells/:spellId/edit` (builder).

The ten builder steps are: **Concept → Authority → Targeting → Effects → Effect Chain → Traits → Duration →
Casting Conditions → Review → Finalize**. They use keyboard-operable WAI-ARIA tabs, typed parameter fields, searchable
Release catalogs, ordered Effects, explicit Effect-slot/Trait exchange and existing M5 vocabularies. Authority is
explicit, never automatically selected or switched. Locked choices explain their validation reason.

Live Review shows construction, the M5 cost Inspector, runtime deferrals and component links to the Character's exact
Rules Reference Release. The validation summary links back to the relevant step. Debounced autosave uses optimistic
concurrency and announced Saving / Saved / Conflict states; unsaved changes trigger an unload warning. Layout supports
narrow screens. Detail/history retains prior finalized revisions and exposes rebuild/retirement.

`getCharacterSheet` gains current ACTIVE `signatureSpells`, re-evaluated through the same server pipeline.
`apps/studio/app/characters/_components/sheet/SpellRows.tsx` places compact Spell rows between Weapon Attacks and Action
Notes. Print limits Spell rows to four lines and omits full chains. Characters without Signature Abilities skip loading
the Spell context, preserving the existing WO5/WO6 sheet path.

## 9. Cost, Unresolved Rules And Content Gaps

Final MP and Final AP come from M5-WO10; M4 evaluates formulas. ME does not reduce listed Spell MP/AP: it is payment
capacity only. Review displays M5 contributions, percentages, the existing 30% effective Casting Condition cap, net
percentage, unrounded/final MP, PRO, base AP/modifiers/final AP. WO13 Sustain uses the pinned Formula through M4.
Affinity economics, Casting Condition economics and Active Magic semantics are unchanged. No old book formula was
copied into the application.

All **M5-SC-042 through M5-SC-053** remain unresolved: SC-042, SC-043, SC-044, SC-045, SC-046, SC-047, SC-048,
SC-049, SC-050, SC-051, SC-052 and SC-053. WO7 neither resolves them nor invents replacement rules.

| Relevant conflict | Preserved behavior |
| --- | --- |
| M5-SC-042 additional Affinity Trait capacity | Requested capacity is passed to M5 and refused; ordinary/exchanged slots remain available |
| M5-SC-046 additional Multi-Target pricing | Exact unresolved cost reason; cannot finalize an unpriced Spell |
| M5-SC-047 Signature Spell discount | No invented discount |
| M5-SC-049 Trait Trigger / M5-SC-050 multiple Saves | Existing execution unresolved result and key are surfaced |
| M5-SC-052 generic Mana Lock amount | Runtime deferred; no guessed reservation amount |
| M5-SC-053 Channel MP timing | Unchanged; no new Channeling selection |

These are **content gaps**, not application defects:

- **Affinity Authority:** M5 requires Affinity access across components, including Targeting and Duration. Current Core
  Definitions lack the necessary authored access, so ordinary Affinity-Authority Spells cannot be completed from Core
  content alone. Tests author test-only `affinityAccess`; production does not bypass the rule.
- **Performance Casting Condition:** absent from Release content. The catalog/builder reports its absence. No
  Performance discount or Condition is synthesized in application code; structured content must supply it later.
- **Missing Effect execution policy:** a Release can yield `PROWESS_EFFECT_EXECUTION.MISSING_POLICY`. This is a runtime
  deferral, not permission to invent execution behavior. Otherwise-valid runtime-deferred Spells can be finalized and
  retain their warning wherever displayed.

## 10. Recovery Correction And Earlier Gate Allowances

Correction `7220c73c04bf6a43f8038922274fe68fabba635b` changes
`packages/prowess-db/tests/integration/entity-version-lifecycle.test.ts` only: nine explicit WO7 public exports added
to the sorted allowlist; `updateCharacterSignatureSpellDraft` added in sorted position to `mutatorLike`; the requested
CAS/table-ownership comment; repository-source guards against Entity, EntityVersion, Ruleset, Manifest and Release
Prisma mutations and SQL writes. The exact allowlist and generic-update protection remain. No repository code change
was necessary. The source guards were checked against the actual repository and six synthetic forbidden write examples.

Earlier implementation changes remain narrow, commented allowances tied to WO7:

- M2-final mutation/public-surface list recognizes the named Character Spell operations.
- M6-WO3 recognizes the createSpell allowance and revised Arcana/Performance wording.
- M6-WO5 recognizes the added sheet UI files and registered Spell routes.
- M6-WO6 strips registered later-WO schema additions and recognizes approved M5 hashes/inventory additions while
  preserving the first 76 invariant entries.
- CI gate inventory counts include WO7.
- The M5-WO10 static text pin remains intact through the `spellRef` variable name.

No earlier gate is disabled and no wildcard exclusion replaces an exact boundary. Recovery changes no production
mechanics, M4/M5 core, schema, migration, golden, control count or workflow.

## 11. Test Totals

The corrected implementation at `7220c73c04bf6a43f8038922274fe68fabba635b` passed these complete suites in
[permanent CI run #249](https://github.com/prowessttrpg-png/prowess-studio/actions/runs/41548752761).
This report commit changes documentation only and must receive its own fresh same-head Tier 2 result; the final exact
head, run and matching totals are recorded in PR #69's certification ledger before merge is requested.

| Suite | Passed |
| --- | --- |
| model unit | 513 |
| ui unit | 21 |
| import unit | 128 |
| rules unit | 659 |
| game unit | 1,700 |
| db unit | 146 |
| Studio unit/static/UI | 3,445 |
| DB integration, both shards | 606 (290 + 316 across 57 files) |
| Studio API integration | 228 |
| Full Playwright | 64 |

WO7-specific coverage includes 12 DB Signature Spell tests, two migration-compatibility tests, three API integration
tests, 17 UI tests, adapter/world tests, the 313 stored M5 digests plus coverage test, and the five dedicated Playwright
scenarios: Arcane build/sheet, Affinity build/reload, invalid combination, rebuild/history and historical Release.
The full suite total is taken from CI rather than adding older handoff totals.

Run #249 independently passed Prisma schema validation and Client generation, deployment of the full migration
chain to both development and test databases, and the **blocking** migrations-versus-schema drift check. The actual
engine result was **No difference detected.** (the required **No differences.** outcome); no drift warning was accepted.
Both DB shards passed, including the previously failing 17-test lifecycle suite. Studio API integration passed 228
assertions across 36 files. Production build and all 64 Playwright scenarios passed.

Recovery local/CI distinction: the initial clone eventually completed, but this fresh workspace has no installed
workspace dependencies or local PostgreSQL services. No full local suite, Prisma deployment or browser run is claimed.
Local architecture checks, gate inventory (39 gates / 535 controls), the eight-scenario control-harness self-test,
source review and lightweight guard checks passed; they supplement the permanent hosted Tier 2 run; earlier local totals are
retained only as historical handoff evidence. Original run #248 had 605 DB passes plus the one allowlist failure and
skipped the dependent controls; it was not certification. The original handoff's dedicated WO7 68/68 controls were
historical local evidence, not a substitute for the corrected-head CI run.

## 12. Architecture Gate

WO7 remains the named **M6-WO7 — Signature Spell Builder** step in `controls-2` of the consolidated
`.github/workflows/ci.yml`; no `m6-wo7.yml` was introduced. The static gate is
`apps/studio/tests/unit/m6-wo7-static.test.ts`. `scripts/ci/verify-gate.mjs M6-WO7` verifies authoritative reports for
the registered WO7 game, DB, migration, static, UI and API suites, then runs
`PROWESS_EXPECT_CONTROLS=68 node scripts/m6-wo7-negative-controls.mjs`.

The static gate protects ownership, exact refs, inert prose, explicit Authority, M5/M4 reuse, cost/ME rules,
unresolved conflicts, lifecycle/capacity concurrency, revision history, schema/migration compatibility, API/UI
boundaries, frozen M4 hashes, the approved-M5 registry, all 22 WO7 invariants, docs and permanent CI registration.
Gate inventory is 39 gates / 535 controls; the control-harness self-test enforces detection, attribution and exact restoration.

Local architecture checks passed (13 import-boundary rules, seven packages); local gate inventory and the
8-scenario harness self-test passed. Run #249's static job also passed lint, architecture, typecheck, inventory and
harness self-test. Permanent gate verification and historical/WO7 mutation results for the final report HEAD are
certified in the same-head Tier 2 run linked from PR #69, not inherited from #248 or an earlier local control batch.

## 13. Controls

The final publication requires all registered scripts to complete with detection, correct attribution and exact
tree restoration. The definitive per-script results are the controls-job logs of the final same-head run linked in
PR #69's certification ledger. This report records the permanent inventory below; a registered count alone is not a
claim that a control ran. Recovery does not change a script or its expected count.

WO7 script: `scripts/m6-wo7-negative-controls.mjs`, **68** expected controls. Historical controls: **467**, across
20 scripts. Total: **535** across 21 scripts, as registered in `scripts/ci/gates.json`.

| Script family | Expected controls |
| --- | --- |
| M4-final | 3 |
| M5-WO1 / WO2 / WO3 / WO4 / WO5 | 17 / 18 / 21 / 34 / 29 |
| M5-WO6 / WO7 / WO8 / WO9 / WO10 | 16 / 22 / 8 / 12 / 18 |
| M5-WO11 / WO12 / WO13 | 26 / 26 / 30 |
| M6-WO1 / WO2 / WO3 / WO4 / WO5 / WO6 | 18 / 18 / 28 / 37 / 33 / 53 |
| M6-WO7 | 68 |

Scripts run sequentially within each control job. CI jobs use separate checkouts; no scripts mutate a shared tree
concurrently. Every control must be caught by its named assertion and restore source bytes exactly. No golden or
control expectation was weakened to conceal a failure.

## 14. Deferred Scope And Publication Boundary

WO7 does not include live casting, encounter resource spending, combat execution, Ability Cards, Maneuver Builder,
dynamic Metamagic UI beyond existing authored choices, resolution of M5 conflicts, or canonical publishing of
Character-created Spells. WO6 Weapon/Attack semantics and WO5 sheet architecture remain authoritative.

Final same-head Tier 2 evidence and exact PR/base SHAs are recorded in PR #69 before requesting merge authorization.
A green PR does not authorize merge. Only after explicit approval may PR #69 merge; the exact resulting main SHA must
then pass merged-main Tier 2, the WO7 gate, Prisma validate, migrations, blocking drift and relevant suites. Until that
boundary, this report does not declare M6-WO7 complete and M6-WO8 must not begin.
