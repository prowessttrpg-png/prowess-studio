# M6-WO8 — Signature Maneuver Builder implementation report

Status: Phase D implementation and focused local verification complete. Ready for separately authorized final publication; same-commit Tier 2 certification remains pending. No PR, merge, main modification, new canonical Release, or subsequent Work Order is authorized by this report.

## 1. Scope and architecture

M6-WO8 implements Character-owned Signature Maneuver construction under Work Order v2.0 and approved Amendment A. Accepted Phases A/B/C supply the mechanics, persistence/API, and player interface. Phase D adds permanent semantic architecture guards, transaction-port unit tests, a 36-control mutation matrix, consolidated CI registration, a boundary test for universal AP/MP minima, and this report. It changes no accepted gameplay implementation.

The accepted Phase C remote checkpoint is `611a26f59c3ed953301bc205f9d5d43da1b5b60a`, complete tree `fc31a5fa96c78b6e6a52b2a7bef410bee998f412`. CI #256 is its accepted verification. The available local snapshot was an older clean checkpoint. Recovery read the ten changed blobs and thirteen tree objects from GitHub, verified every blob identity and the complete accepted tree, and fast-forwarded a new local recovery commit while preserving the older checkpoint as its parent and a backup ref. No source was recreated from summaries and no remote ref was changed. Recovery evidence is retained with the checkpoint archive.

Authority remains in `@prowess/game` and M4. Studio is a consumer of evaluated server DTOs. The Character adapter calls the authored-Ability compiler, Maneuver cost compiler, M4 orchestrator, result readers and execution-contract compiler. The subject is Character-owned; the Release bundle receives no manufactured Maneuver or Foundation Definition.

## 2. Action-first construction

The nine steps are Concept, Action Selection, Action Sequence, Effects, Traits, Duration, Conditions, Review and Finalize. Concept stores name, description, visual description, notes and inert narrative tags. Narrative prose never becomes mechanical authority.

Actions are ordered uses with stable component keys and exact sources. Available options are server-categorized Weapon Attack, Movement, Defense and Interaction. Unavailable options retain the server's reasons. Each Action owns its inherited targeting; there is no editable global Maneuver Targeting selector. The selected Duration and its declared parameters remain part of the complete composition.

Effects, Traits and ordinary Conditions use their global construction capacities. A Maneuver requires at least one Effect globally, while an individual Action can have none. Runtime-deferred, incomplete, invalid, valid and unreadable presentations remain distinct.

## 3. Exact identity and Release provenance

Weapon Action selections retain Weapon and Attack entity/version references, the WO6 attack key, and selected damage profile. The current WO6 Attack Library and bridge provide trusted internal Foundation projections with Weapon/Attack provenance. Nonattack Actions require exact structured Foundations in the Character's immutable pinned Release.

An unavailable or ambiguous saved Attack is reported, never substituted with unarmed, another hand, a name match, a latest revision, or a generic Foundation. Current eligibility is reevaluated without rewriting stored choices. Historical revisions are evaluated only against their recorded Character Release; incompatible or unreadable records remain visible with explicit limitations and no authoritative price.

## 4. Martial capacity and Powerful Blow

The exact Martial construction rule provides one/two/three top-level Action blocks at Trained/Expert/Master. Studio displays that server result without ranking tokens numerically or alphabetically.

A compatible Powerful Blow consumes one top-level block and one resolution group while retaining every ordered Attack use, exact binding and full contribution. The inherited grammar permits one Powerful Blow group. The builder supplies explicit keyboard-operable ordering and constituent selection; the server rejects incompatible groups. No arbitrary new constituent limit or global per-Action capacity is introduced.

## 5. Effect attachments and Trait scopes

Each Effect use has an explicit attachment to one Action resolution or one complete Powerful Blow constituent set. Partial Powerful Blow attachments are invalid. An Effect instance is priced once rather than multiplied by constituent count.

Traits retain their authorized Ability-wide, Effect, Action-targeting or Action-specific scopes and exact target keys. Scoped modifications cannot leak to sibling Actions. The Review panel displays the attachment graph and evaluated targeting/resolution provenance. Action-specific Trigger runtime routing stays deferred under M5-SC-049.

## 6. Protected AP, Signature and Performance

The new rule is opt-in through the exact Release policy extension `{ version: "M6-WO8-A", floor: "COMMITTED_ACTION_AP" }`. Historical M5 uses its existing attack-resolution floor and retains its serialized outputs.

For the new policy, M4 sums the exact committed Base Action AP contributions, including all Powerful Blow Attacks. Base AP still includes authorized Effects, Traits and additions. The effective Condition AP reduction retains the existing 3 AP cap. Post-Condition AP is the maximum of protected Action AP and Base AP minus that effective reduction. The distinct assigned Signature reduction follows the floor; the universal final AP minimum is 1. MP reductions remain independent with a 0 MP minimum. Unused reductions do not convert currencies or create another benefit.

Performance is selected through its exact Release-pinned structured Condition and actual Character Skill rank. It reduces complete-Maneuver MP once by 2/4/6 at Trained/Expert/Master, with separate preparation of 1/1/0 AP before activation. It consumes no ordinary Condition slot and gives no automatic AP discount. A separately authorized AP Condition contribution still passes through the cap and protected floor. Authored rank overrides and duplicate selections are rejected.

The server Inspector exposes Base AP/MP, exact protected subtotal and contribution provenance, applied Condition floor, effective reductions, Signature stage and final costs. Preparation is displayed separately using the evaluated Condition reference/name. No frontend pricing formula was added.

The Phase D mutation run identified a weak minimum-cost test fixture. A new WO8-only boundary case now exercises one Base Action AP, a Signature reduction, zero Base MP and excess Performance MP reduction. It requires final 1 AP/0 MP. The registered hash update applies only to that WO8 test; historical goldens and gameplay code are untouched.

## 7. Persistence, migrations and shared lifecycle

`CharacterSignatureAbility` is the shared Spell/Maneuver header. Maneuvers have a separate current-Maneuver revision relation and append-only `CharacterSignatureManeuverRevision` table. Stored payloads contain strict choices and inert prose, not derived AP/MP, capacity, eligibility or evaluation plans.

Both kinds use one Character-row lock, optimistic header CAS, the same OTHER ACTIVE header count, and one finalization transaction. Finalization rechecks Character version, exact Release and current weapon-loadout version before accepting the evaluator's decision. An invalid/capacity-rejected rebuild cannot append a revision or replace its valid current predecessor. Retirement releases the active slot and retains all history; drafts consume no slot.

Database triggers enforce immutable revisions, kind/ownership, predecessor integrity and current-pointer ownership. Prisma explicitly maps the two PostgreSQL-truncated 63-byte FK names to the already applied migration. Phase D leaves all schema and migration bytes unchanged.

The 14 new lifecycle unit cases call the real shared repository and Maneuver adapter with transaction-port spies. They verify query contracts, decision inputs, CAS fields, own-kind pointer writes, rejected transitions, choices-only payloads and preservation of history. They do not simulate PostgreSQL isolation or replace native locking, rollback, trigger, race, migration or API tests.

## 8. API routes and strict contracts

All eight existing Maneuver API routes are reused:

| Route suffix under `/api/characters/[characterId]/maneuvers` | Method | Input |
| --- | --- | --- |
| root | POST | `name` |
| `[maneuverId]` | GET | none |
| `[maneuverId]/builder` | GET | none |
| `[maneuverId]/draft` | PUT | `expectedVersion`, `draft` |
| `[maneuverId]/validate` | POST | `expectedVersion` |
| `[maneuverId]/finalize` | POST | `expectedVersion` |
| `[maneuverId]/rebuild` | POST | `expectedVersion` |
| `[maneuverId]/retire` | POST | `expectedVersion` |

Routes remain thin database-service calls with the central error mapping. Closed bodies reject client prices, global targeting overrides, Spell exchanges and unknown fields. Draft parsing rejects ambiguous ordering, invalid scopes/attachments and cross-kind choices. Stale writes use HTTP 409. No duplicate endpoint or combat operation was introduced.

## 9. Character interface, Abilities and Sheet

Player routes are `/characters/[characterId]/maneuvers/new`, `/characters/[characterId]/maneuvers/[maneuverId]` and `/characters/[characterId]/maneuvers/[maneuverId]/edit`.

The `maneuvers/` components own creation, nine-step editing, Action/component pickers, evaluated Review, current/history detail, roster and styling. Shared parameter fields were extracted without changing the Spell interface. The Character API client owns transport; DTOs and formatting carry no rules authority.

Abilities presents shared capacity, active/draft and retired Maneuvers, exact ordered Actions, evaluated AP/MP, warnings and accessible history alongside Signature Spells. Autosave reports Saving/Saved/Unsaved/Conflict, serializes versioned writes, retains local choices after 409, blocks silent retries/finalization over a conflict, warns on unsaved navigation and never applies an older evaluation to newer unsaved choices. Finalize, Rebuild and Retire remain explicit actions.

The read-only Sheet service projection selects only active current revisions, retaining valid current content during a rebuild and suppressing invalid/unreadable costs. `ManeuverRows.tsx` presents exact Action sequence, AP/MP, Effects, Keywords and deferred/unavailable information alongside existing Spell rows. Digital rows remain complete; print rows are bounded to four with a continuation notice. The Sheet is the default view at `/characters/[characterId]`.

## 10. UI, accessibility and browser evidence

Accepted CI #256 ran on the accepted Phase C tree: all 16 jobs passed, with 3,506 Studio unit/static tests and 71 Playwright tests. The native isolated fixture contract executed and passed. All six Maneuver scenarios executed and passed, with none skipped:

| Scenario | Accepted Phase C result |
| --- | --- |
| Create, select exact Actions, reorder and save | Passed |
| Multiple Action blocks and independent attachments | Passed |
| Powerful Blow identity and server-derived costs | Passed |
| Performance rank, content limitations and separate preparation | Passed |
| Stale version conflict without overwrite | Passed |
| Finalize, rebuild, invalid-rebuild preservation, history, Sheet and retirement/shared slot release | Passed |

Component coverage includes nine ARIA tabs, keyboard focus/order, accessible validation navigation, authoritative labels, conflicts, stale responses, immutable current/history and bounded print presentation. These are specific functional accessibility checks; no comprehensive WCAG certification is claimed.

The approved test-only Release/API fixtures invoke the actual evaluator. The native loader remains narrowly scoped to historical fixture JSON; no fixture is published as canonical content. Phase D leaves the accepted E2E specs, fixture harness, Playwright configuration and runtime UI untouched. Their existing CI #256 results are baseline evidence, not certification of the new Phase D tree. All six scenarios and the native contract must execute successfully again in final CI.

## 11. Permanent invariants and mutation inventory

The permanent static gate protects I099–I128 through source-integrity checks plus semantic assertions over actual TypeScript syntax, request/model fields, compiler bindings and frontend authority. The real engine, transaction-port, UI and native integration suites provide behavioral coverage. The canonical invariant registry retains all thirty entries and now points to an existing permanent mutation script.

The CLOSEOUT-03 harness requires a green guard baseline, one uniquely scoped mutation, the intended assertion failure, byte-exact restoration and whole-working-tree restoration. TypeScript mutations identify named functions/variables and unique syntax nodes, ignoring spacing/comments/quote choice. Prisma and SQL controls scope exact models/triggers. Mechanical controls use focused actual-engine tests; architecture controls select semantic contracts rather than unrelated historical file hashes. All temporary mutations must restore before another control runs.

| Control | Prohibited change | Verified result |
| --- | --- | --- |
| 01 | name match substitutes for exact Foundation pin | Caught; byte-exact restore |
| 02 | WO6 binding bypassed with an unrelated Foundation | Caught; byte-exact restore |
| 03 | Martial Action-block capacity ignored | Caught; byte-exact restore |
| 04 | Powerful Blow loses a constituent contribution | Caught; byte-exact restore |
| 05 | partial Powerful Blow Effect attachment accepted | Caught; byte-exact restore |
| 06 | Action-specific Trait broadcasts to siblings | Caught; byte-exact restore |
| 07 | protected Action AP floor removed | Caught; byte-exact restore |
| 08 | Signature stage bypasses the post-Condition floor | Caught; byte-exact restore |
| 09 | preparation AP charged as listed activation AP | Caught; byte-exact restore |
| 10 | authored Performance rank overrides actual rank | Caught; byte-exact restore |
| 11 | obligatory Performance consumes ordinary capacity | Caught; byte-exact restore |
| 12 | unfinished draft consumes an active slot | Caught; byte-exact restore |
| 13 | invalid rebuild replaces the current revision | Caught; byte-exact restore |
| 14 | shared Spell and Maneuver capacity bypassed | Caught; byte-exact restore |
| 15 | stale draft version accepted | Caught; byte-exact restore |
| 16 | derived AP persisted on immutable revisions | Caught; byte-exact restore |
| 17 | authoritative AP calculated in React | Caught; byte-exact restore |
| 18 | unsupported Release draft finalized | Caught; byte-exact restore |
| 19 | historical revision delete protection removed | Caught; byte-exact restore |
| 20 | retired Maneuver remains on the Sheet | Caught; byte-exact restore |
| 21 | changed loadout ignored during finalization | Caught; byte-exact restore |
| 22 | changed Character Release ignored | Caught; byte-exact restore |
| 23 | draft CAS omits its expected version | Caught; byte-exact restore |
| 24 | HTTP draft body admits a derived price | Caught; byte-exact restore |
| 25 | global Targeting replaces Action Selection | Caught; byte-exact restore |
| 26 | global minimum Effect requirement removed | Caught; byte-exact restore |
| 27 | builder owns live AP spending | Caught; byte-exact restore |
| 28 | Maneuver storage writes canonical Releases | Caught; byte-exact restore |
| 29 | Performance selected more than once | Caught; byte-exact restore |
| 30 | final AP minimum weakened to zero | Caught; byte-exact restore |
| 31 | MP minimum permits a negative result | Caught; byte-exact restore |
| 32 | existing three-AP Condition cap changed | Caught; byte-exact restore |
| 33 | invalid current revision displays a provisional AP price | Caught; byte-exact restore |
| 34 | Maneuver finalization selects Spell history | Caught; byte-exact restore |
| 35 | stale autosave evaluation overwrites newer local choices | Caught; byte-exact restore |
| 36 | current revision evaluated across a different Release | Caught; byte-exact restore |


## 12. Historical compatibility and source integrity

No historical golden, M4 runtime, M5 implementation, WO6/WO7 behavior, canonical content, Prisma schema or migration is changed by Phase D. The only game-package change is the WO8 minimum-boundary test. Its approved registration hash is updated explicitly. The accepted player UI/E2E implementation stays byte-identical to the Phase C baseline.

The optional WO8 policy remains separate from historical M5 costs. Existing WO6 binding tests, WO7 characterization, Spell/Maneuver goldens and Character Sheet regressions remain permanent. Earlier checkpoint reports preserve their original historical blocked statuses. The current architecture document now describes approved native CI verification rather than obsolete local emulator setup.

All 39 preexisting CI gates and their 535 controls retain their original registrations/counts. WO8 adds one gate and 36 controls: 40 gates, 571 controls across 22 control scripts, nine authoritative suites and 14 checks. No separate workflow or path-based bypass is introduced.

## 13. Local verification and CI evidence

| Local verification | Completed result |
| --- | --- |
| WO8/domain and historical game compatibility | 486 passed across 11 suites |
| Character Creation, Sheet, WO6, WO7, WO8 and CI/static regressions | 219 passed across 12 suites |
| WO8 database unit contracts, fixture and projection | 17 passed across 3 suites; lifecycle 14 rechecked after lint cleanup |
| Unique positive suite total | 722 passed across 26 suites; repeated checks not double-counted |
| Permanent WO8 mutations | 36 caught; 15 green baselines; every file restored byte-for-byte |
| Control-harness self-test | 8 scenarios passed |
| Consolidated inventory | 9 suites; 40 gates; 571 controls; 14 checks; legacy coverage intact |
| Workspace lint | All seven packages passed; zero warnings |
| Workspace typecheck | All seven packages passed; database test types rechecked after cleanup |
| Architecture | 13 boundary rules, seven packages; passed |
| Prisma schema validation | Passed locally; native deployment/drift remains a CI check |
| Shared package builds | All six completed successfully |
| Studio production build | Clean retry passed with a fresh BUILD_ID and all 35 static pages |

The first root build completed the six shared packages but stopped on a corrupt Turbopack persistence directory (`invalid digit found in string`). Generated output was preserved outside the checkout. One clean Studio-only retry completed at exit 0; no source, bundler, dependency or configuration workaround was introduced. No PostgreSQL or Chromium installation/emulator attempt occurred. A single unused argument in the new port test was removed for lint; the full lint run and affected unit/type checks then passed.

The machine-readable evidence is `docs/reports/m6-wo8-phase-d-evidence.json`. It records completed commands, statuses and log hashes, the new minimum-cost coverage correction, preserved original gate registrations, source-integrity categories and every explicitly pending CI requirement.

Accepted baseline CI: https://github.com/prowessttrpg-png/prowess-studio/actions/runs/41960337280 . That run verified PostgreSQL 16.15 migrations, zero schema drift, 231 API tests, database shards with 294/322 tests, nine WO8 lifecycle/concurrency cases, migration compatibility, all historical controls, builds and both tiers. Phase D requires a new same-commit run after separately authorized publication.

Machine-readable Phase D evidence records commands, completed exit statuses, log hashes, source-integrity comparison, exact changed files and pending checks. Final checkpoint/tree and certification identifiers belong in the later recovery/publication ledger, not a self-referential report field.

## 14. Limitations and deliberate deferrals

- Current Releases may lack the versioned cost policy, exact structured Performance Condition, or required Action Foundations. The builder reports these limitations and cannot synthesize content or enable unsupported finalization. The Amendment A generator remains an unpublished governed-content candidate requiring a separate exact Skill identity and Release update.
- Ambiguous equipped hand/Attack identity remains unavailable until the existing WO6 contract can represent it explicitly.
- Unresolved M5 runtime requirements and Action-specific Trigger routing stay deferred. There is no live combat execution, rolling, resource spending, battlefield movement, Ability Card framework or unrelated Spell/Affinity/Effect/Trait redesign.
- Local native PostgreSQL and Chromium verification remains unavailable under the Two-Attempt Protocol. No new installation/emulator attempts were made. Transaction-port and component tests do not substitute for native integration/browser certification.
- Tier 3 clean certification is not authorized automatically. This checkpoint requests final publication and a complete Tier 2 run; any Tier 3 run requires separate authorization unless a binding project requirement is identified.

## 15. Publication and merge readiness

Local implementation and focused verification are complete, with no unresolved local blocker. The source is ready for separately authorized final CI publication. Final Tier 2 acceptance remains pending; CI #256 is the Phase C baseline only. The permanent gate is registered in both the machine inventory and named consolidated workflow step. All previous gate objects and 535 control registrations are preserved.

The final CI run must verify all unit/static/domain suites, PostgreSQL 16 migration/drift/API and both database shards, production build, all six Maneuver browser scenarios and the native contract, historical mutation controls, the newly named **M6-WO8 — Signature Maneuver Builder** step with all 36 controls, Tier 1 and Tier 2. The new step reads same-commit authoritative results for its fourteen test files before running mutations.

The final local checkpoint is recoverable through a verified complete Git bundle with an independently restored matching tree. No final source publication, PR creation, merge, main change or next Work Order is performed at this boundary. WO8 is not declared merged or fully certified until the required later approvals and permanent CI are complete.

### Phase D changed-file inventory

- `.github/workflows/ci.yml`
- `apps/studio/tests/unit/ci-gate-inventory.test.ts`
- `apps/studio/tests/unit/m6-wo8-audit-helpers.ts`
- `apps/studio/tests/unit/m6-wo8-static.test.ts`
- `docs/architecture/m6-approved-m5-changes.json`
- `docs/architecture/m6-maneuver-builder.md`
- `docs/reports/m6-wo8-implementation-report.md`
- `docs/reports/m6-wo8-phase-d-evidence.json`
- `packages/prowess-db/tests/unit/m6-wo8-lifecycle-contract.test.ts`
- `packages/prowess-game/src/m6-wo8-amendment.test.ts`
- `scripts/ci/gates.json`
- `scripts/m6-wo8-negative-controls.mjs`
