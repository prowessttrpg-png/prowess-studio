# M6-WO8 Phase C implementation checkpoint — browser verification blocked

Date: 2026-11-04 (America/Los_Angeles).

**Status: NOT PHASE C COMPLETE.** The interface implementation is preserved locally. Component/static regressions, pure server projections, lint, typecheck and the production build pass. The project-pinned browser is unavailable; the two bounded browser attempts below failed. Browser E2E acceptance, visual review and browser accessibility remain unverified. Stop for review under the Two-Attempt Blocker and Recovery Protocol. Phase D is not started.

## Baseline and preservation

Entry branch `m6-wo8` was clean at local `9d1fde9470fa4736a9cbeeae767ead06471bc1d3`. Connected GitHub independently confirmed remote `8ef311fe06e194455a65a066fdf45b0433edad17`. Both have the complete source tree `f6e973ec4db64bb343bb9367c92defa96cfa43c2`; no reset or reconstruction occurred. CI #254 / Phase B acceptance is the user's verified baseline.

The corrective local checkpoint SHA, tree SHA and verified full-history bundle accompany this report's delivery; a commit cannot embed its own SHA. The original checkpoint remains its ancestor. The working tree must be clean after committing this report and evidence. Remote `m6-wo8` remains `8ef311fe06e194455a65a066fdf45b0433edad17`; main remains `d005fc30c8c7e175896898c1973e6d3bda144869`. No publication, PR, merge, main edit or canonical Release publication occurred.

## Implemented routes and interface

- `/characters/[characterId]/maneuvers/new`: named Character-owned draft creation through the existing API.
- `/characters/[characterId]/maneuvers/[maneuverId]`: current revision, immutable predecessors, exact Release IDs, explicit rebuild and retire actions.
- `/characters/[characterId]/maneuvers/[maneuverId]/edit`: nine keyboard-operable steps: Concept, Action Selection, Action Sequence, Effects, Traits, Duration, Conditions, Review, Finalize.

`ManeuverBuilder`, `ManeuverComponents`, `ManeuverReview`, `ManeuverDetail`, `ManeuverRoster`, and `NewManeuverForm` implement the interface, with responsive styles in `maneuvers.css`. The existing typed `ParameterFields` control is extracted into the shared `abilities` directory and re-exported by the Spell controls, preserving their interface.

Action options display the server's Weapon Attack, Movement, Defense and Interaction categories. Weapon/Attack refs, attack keys, damage-profile keys and inherited profiles remain exact; unavailable reasons and missing-content limitations remain visible. There is no global Targeting selector. Ordering controls change explicit authored order only. Powerful Blow is explicitly configured; attachment options supply its complete constituent set, never a partial group. Scoped Traits name their exact authorized targets; Effect, Trait and Condition capacities remain global server values.

The builder displays evaluated AP/MP, protected Action AP, Condition cap/reduction and applied floor, post-Condition AP, post-floor Signature reduction, final costs, separate Performance preparation and Inspector/provenance. These are copied from server results. Performance help projects the exact structured Condition's authored benefit table and the actual Character Skill rank; no client rank-to-price formula or rank choice is added. Unsupported content is not fabricated. The domain remains the authority for validation and finalization.

Versioned autosave serializes authored choices only, preserves newer local edits during an older save response, exposes Saving/Saved/Unsaved/Conflict, blocks stale-write retries/finalization after HTTP 409, and retains local choices until an explicit reload/discard. Before-unload and link-navigation warnings protect unsaved work. Editing is disabled while explicit validation/finalization commands run. Accessible validation summaries navigate and focus the relevant step. A failed rebuild continues to present the previous current revision.

## Abilities and Character Sheet

The existing Abilities panel preserves Spell rows and adds separate Maneuver creation, active/draft rows, current revision, Action sequence, server costs/state/warnings, retired entries and history links. Shared capacity/usage comes from the server; drafts do not acquire a client-computed slot cost.

`SignatureManeuverRows` adds current active Maneuvers to the sheet's Actions panel alongside Weapon Attacks, Signature Spells and Action Notes. It displays server costs, Actions, Effects/Keywords and warnings, with at most four Maneuver rows in print. Digital/browser/print visual layout still requires browser review.

The new pure `signature-maneuver-presentation.ts` module and the existing Phase B service provide read-only projections. The sheet uses current revisions, excludes draft/retired headers, preserves the current revision during an invalid rebuild, and hides unresolved/provisional costs. No mechanical authority, database model, migration, combat execution, roll or resource spending is added.

## Passing focused evidence

| Verification | Result |
| --- | --- |
| New Maneuver UI plus existing Spell/Weapon/Sheet component and static regressions | **158 passed / 8 suites** |
| Pure current-revision sheet projection and engine-generated presentation fixture | **3 passed / 2 suites** |
| Database and Studio lint | Passed, exit 0 |
| Database and Studio typecheck | Passed, exit 0 |
| Model/rules/import/game/database package builds | Passed |
| Instrumented production Next.js build | Passed, exit 0; fresh `.next/BUILD_ID`; all three Maneuver routes present |
| Architecture import/circular-dependency checks | Passed |
| Browser scenario discovery | Six scenarios discovered; execution is not represented as passing |

The ten new component tests cover tab roles and arrow-key focus, ordering and exact identity, closed versioned draft writes, full Powerful Blow attachments, scoped Traits, structured Performance help and preparation, missing-content finalization, issue navigation, stale-write retention/no overwrite, old-response handling, immutable-current presentation, and bounded print rows. These semantic accessibility checks are passing component tests, not a full browser WCAG audit.

The new test-only wire fixture is generated from the existing approved Maneuver fixture and actual engine results. Each persisted draft also passes the real closed-draft reader; a temporary fixture-only extra Duration key was corrected before the final passing run. No historical golden was rewritten.

Two narrowly additive static inventories now register `ManeuverRows` and require it alongside the existing Weapon/Spell/Notes order. The WO8 UI inventory lists the new exact presentation files. All runtime-purity and historical assertions remain active; no test is disabled. Game/M4 sources, Prisma schema/migrations, workflow files, CI gate registration and historical goldens are unchanged.

Captured logs, exact commands, exit records and SHA-256 digests are summarized in [the evidence JSON](m6-wo8-phase-c-evidence.json).

## Both browser attempts and exact blocker

| Attempt | Action | Result |
| --- | --- | --- |
| 1 | Install the project-pinned Chromium Headless Shell through the official Playwright installer, stopping immediately at its first error to prevent automatic retries | Reported a 0 MiB archive; `End of central directory record signature not found. Either not a zip file, or file is truncated.` Installer terminated; browser not installed. |
| 2 | Run the six browser scenarios against the production build with one worker and `--max-failures=1` | Exit 1 before scenario 1 could launch: missing `/root/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell`. One infrastructure failure; remaining five skipped. |

Both attempts failed to establish a usable project-pinned browser. No additional browser download, substitute browser, emulator, PostgreSQL installation, alternate port experiment or further browser troubleshooting followed attempt 2.

## Six E2E outcomes

| Scenario | Actual outcome |
| --- | --- |
| 1. Create, select Actions, reorder, save | Blocked before browser launch; no feature assertion executed |
| 2. Multiple blocks with independent Effect/Trait attachments | Not run after stop-on-first-failure |
| 3. Powerful Blow identity and server costs | Not run |
| 4. Performance eligibility, content limitations and separate preparation | Not run |
| 5. Stale-version conflict without overwrite | Not run |
| 6. Finalize, invalid/valid rebuild, immutable history, retire, shared capacity and sheet | Not run |

The browser scenarios use isolated API transport fixtures and the actual evaluator, not production content or production credentials. They do not replace live PostgreSQL integrity verification. Phase B's existing database/API acceptance remains intact; Phase C's added read-only projections have pure local tests, not a new live database integration result.

The additional Node-only fixture-contract test has no verified completion summary and is **not** counted as passing. Its test-only native JSON loader is scoped to the approved fixture-content directory, leaving historical game files and production loaders unchanged; that native harness still requires validation. The default Next server also encountered sandbox-denied `uv_interface_addresses` discovery; explicit `127.0.0.1` binding, matching the existing Playwright base URL, allowed the worker to start. No additional network workaround was attempted. An earlier incomplete build capture was rejected; the subsequent sequential, instrumented production build is the passing result above.

## Shortest safe continuation

Reuse this exact checkpoint. In an environment with the pinned browser and functioning Next.js networking, first verify the Node-only fixture harness completes, then run all six browser scenarios and browser accessibility/visual/print checks. Correct actual implementation failures, rerun affected focused checks and relevant regressions, and create a verified Phase C checkpoint only after its acceptance requirements pass.

In the present environment, separately authorized publication of this checkpoint to the established CI infrastructure is the shortest available path to that verification. Publication remains prohibited until that authorization is supplied. Do not restart WO8, discard this implementation, weaken checks, or begin Phase D.

## Exact changed-file inventory

The complete 35-file inventory follows. All changes are local; the two report/evidence files are included.

1. `apps/studio/app/characters/[characterId]/maneuvers/[maneuverId]/edit/page.tsx`
2. `apps/studio/app/characters/[characterId]/maneuvers/[maneuverId]/page.tsx`
3. `apps/studio/app/characters/[characterId]/maneuvers/new/page.tsx`
4. `apps/studio/app/characters/_components/abilities/ParameterFields.tsx`
5. `apps/studio/app/characters/_components/maneuvers/ManeuverBuilder.tsx`
6. `apps/studio/app/characters/_components/maneuvers/ManeuverComponents.tsx`
7. `apps/studio/app/characters/_components/maneuvers/ManeuverDetail.tsx`
8. `apps/studio/app/characters/_components/maneuvers/ManeuverReview.tsx`
9. `apps/studio/app/characters/_components/maneuvers/ManeuverRoster.tsx`
10. `apps/studio/app/characters/_components/maneuvers/NewManeuverForm.tsx`
11. `apps/studio/app/characters/_components/maneuvers/maneuvers.css`
12. `apps/studio/app/characters/_components/sheet/ManeuverRows.tsx`
13. `apps/studio/app/characters/_components/sheet/SheetPanels.tsx`
14. `apps/studio/app/characters/_components/spells/AbilitiesPanel.tsx`
15. `apps/studio/app/characters/_components/spells/SpellComponents.tsx`
16. `apps/studio/app/characters/_lib/character-client.ts`
17. `apps/studio/app/characters/_lib/maneuver-format.ts`
18. `apps/studio/app/characters/_lib/maneuver-types.ts`
19. `apps/studio/playwright.config.ts`
20. `apps/studio/tests/e2e/m6-maneuver-fixture-contract.spec.ts`
21. `apps/studio/tests/e2e/m6-signature-maneuver.spec.ts`
22. `apps/studio/tests/e2e/m6-wo8-fixture-loader.ts`
23. `apps/studio/tests/e2e/m6-wo8-ui-api.ts`
24. `apps/studio/tests/unit/fixtures/m6-wo8-builder.json`
25. `apps/studio/tests/unit/m6-wo5-static.test.ts`
26. `apps/studio/tests/unit/m6-wo7-static.test.ts`
27. `apps/studio/tests/unit/m6-wo8-maneuver-ui.test.tsx`
28. `docs/architecture/m6-wo8-baseline.json`
29. `docs/reports/m6-wo8-phase-c-checkpoint.md`
30. `docs/reports/m6-wo8-phase-c-evidence.json`
31. `packages/prowess-db/src/character/sheet-service.ts`
32. `packages/prowess-db/src/character/signature-maneuver-presentation.ts`
33. `packages/prowess-db/src/character/signature-maneuver-service.ts`
34. `packages/prowess-db/tests/unit/m6-wo8-presentation.test.ts`
35. `packages/prowess-db/tests/unit/m6-wo8-sheet-projection.test.ts`
