# Character Maneuver construction — M6-WO8 and Amendment A

Authority: M6-WO8 Work Order v2.0, designer-approved Amendment A, and the existing Prowess Studio Master Development Instructions. Verified parent: `d005fc30c8c7e175896898c1973e6d3bda144869` (merged WO7). This work does not close WO8 until separately authorized publication, merge, and successful permanent merged-main CI.

## Ownership and exact identity

`CharacterSignatureAbility` remains the shared Spell/Maneuver header. Maneuver choices are schema-versioned drafts and append-only `CharacterSignatureManeuverRevision` records. They are never canonical Definitions. Existing Spell revision IDs, rows, payloads, and current-revision relation remain intact; Maneuvers have a separate current-revision foreign key.

The adapter loads the Character's pinned Release, present mechanical profile, and current WO6 Attack Library. Weapon Actions carry the exact Weapon, Attack, WO6 attack key, and selected damage profile. The WO6 bridge supplies a trusted internal Foundation projection, retaining Weapon/Attack source provenance. The Release bundle is never extended with manufactured Definitions. Nonattack Actions require exact structured Movement, Defense, or Interaction Foundations in that same Release.

An unavailable saved Attack remains saved and is reported as unavailable. It is never replaced with an unarmed, same-named, latest, or generic Attack. If one WO6 attack key identifies multiple current hand profiles, the current WO6 identity contract is ambiguous; construction fails closed rather than inventing a hand selection.

## One compilation pipeline

The Character adapter calls the existing authored-Ability compiler, Maneuver cost compiler, execution-contract compiler, M4 evaluation orchestrator, and result readers. The subject is explicitly Character-owned, with no subject Definition reference. Persisted payloads contain only choices and inert prose; cost, targeting, capacity, Keywords, and execution plans are read-time results.

Martial `martialRankValue` limits top-level Action blocks: Trained 1, Expert 2, Master 3. Powerful Blow occupies one block while retaining each ordered constituent Attack use and its full costs. The inherited M5 grammar supports one Powerful Blow group; no arbitrary constituent limit is added. Effects, Traits, and ordinary Conditions retain their global capacities. At least one Maneuver Effect is required globally; an individual Action may have none.

Each Action has its own inherited targeting and stable use key. Effects name an explicit resolution group, including every constituent of a Powerful Blow. Partial Powerful Blow attachments are invalid. Traits name their exact authorized scope: whole Ability, selected Effect, selected Action targeting, or the new Maneuver-only Action-specific scope. A scope never broadcasts modifications to sibling Actions. Action-specific Trigger execution remains deferred under M5-SC-049.

## Versioned protected Action cost

Historical M5 policy remains unchanged. The optional exact Release policy extension `{version: "M6-WO8-A", floor: "COMMITTED_ACTION_AP"}` enables Amendment A. The compiler emits the following M4 stages:

1. Sum every exact committed Foundation AP contribution, including every Powerful Blow constituent, into protected Action AP.
2. Preserve M5 Base AP, including Actions, Effects, Traits, and authorized additions.
3. Apply the existing effective Condition reduction, capped at 3 AP, then take the maximum with protected Action AP.
4. Apply the existing explicit Signature reduction after that floor, then the universal 1 AP minimum.
5. Apply MP reductions separately and retain the 0 MP minimum.

Unused Condition discounts create no MP or other benefit. No Spell pricing, Affinity pricing, Effect/Trait pricing, AP-to-MP conversion, or live resource spending is introduced. The result and Rules Inspector expose protected Action AP, applied floor, exact contribution provenance, Condition stages, Signature stage, and final cost. Studio only displays these server results.

## Exact structured Performance

Performance is an explicitly selected obligatory Maneuver Condition, exempt from ordinary Condition slots. Its exact Definition identifies the Performance Skill and authorized rank tables. The compiler uses the Character's actual Skill rank; a draft cannot author or override that rank. Trained/Expert/Master reduce MP once per complete Maneuver by 2/4/6 and require separate preparation of 1/1/0 AP. Untrained is ineligible. Preparation must precede activation and is not part of listed Maneuver AP.

Rank does not grant an AP reduction. An explicitly authored, authorized Performance AP contribution uses the same capped Condition stage and protected floor. Duplicate Performance selections are rejected. The runtime requirement is a contract only; the builder does not establish Performance or execute the Maneuver.

`src/content-updates/m6-wo8-amendment-a.ts` is an authoring candidate, excluded from runtime exports. It does not write or republish a Release. A separately governed update must select the actual Performance Skill identity and pin the approved structured Condition and policy extension. Releases lacking either expose a missing-content limitation. No guessed Action cost or runtime Condition is supplied.

## Shared lifecycle and concurrency

Both kinds use the same Character-row lock, compare-and-set header version, and active-header slot count. Finalization rechecks the Character Release/version and, for Maneuvers, the weapon-loadout version while holding that lock. Loadout writes use the same Character lock. Only a valid server evaluation appends a revision and moves the corresponding current pointer in the transaction. Drafts consume no slots; invalid rebuilds preserve the current revision; retirement releases a slot without deleting history. Database triggers additionally enforce immutable revisions, header kind, current ownership, and revision predecessor/kind ownership.

The eight Maneuver routes provide create, detail, builder catalog, draft save, validate, finalize, rebuild, and retire operations. Closed request bodies reject derived prices, shared targeting overrides, Spell exchanges, cross-kind components, and unknown fields. All errors use the existing central API mapping, including stale-write HTTP 409.

## Boundaries and verification

WO8 introduces no combat execution, rolls, movement execution, live AP/MP spending, automatic equipment substitution, Ability Cards, canonical Release mutation, or resolution of unrelated M5 conflicts. Historical byte-exact characterization and goldens remain permanent guards, alongside WO6 bridge and WO7 lifecycle regressions. New guards cover protected costs, Performance, exact identity, scope isolation, shared races, migration compatibility, API closure, presentation ownership, and builder lifecycle.

Native PostgreSQL 16 migrations, zero drift, lifecycle, concurrency and API verification use the established consolidated CI environment. Browser verification uses that workflow's native Playwright environment. Local PostgreSQL/emulator and Chromium setup attempts remain stopped under the Two-Attempt Protocol. Local transaction-port tests complement the native integration tests; they do not certify SQL isolation, rollback or database triggers. An explicit `PROWESS_TEST_TRANSACTION_TIMEOUT_MS` override remains accepted only after the existing local test-database guard and within a bounded range; unset environments retain Prisma's original defaults. It changes timeout duration only, never isolation, SQL, locks, or integrity.

The permanent M6-WO8 Tier 2/3 gate verifies the actual domain, historical cost, database, API, presentation and Studio results from the same commit's authoritative reports before running `scripts/m6-wo8-negative-controls.mjs`. Its semantic architecture checks inspect syntax trees, closed request/model fields and exact compiler bindings; they do not rely on source formatting. Mechanical mutations exercise the real M5/M4 evaluator, and the CLOSEOUT-03 harness requires the intended failure plus byte-exact source restoration. The implementation report records completed local checks and pending same-commit CI separately. The governed content candidate remains unpublished.
