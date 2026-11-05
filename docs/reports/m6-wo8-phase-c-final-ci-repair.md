# M6-WO8 Phase C final CI repair checkpoint

Status: focused source corrections complete; local browser verification remains blocked. No publication or workflow run performed.

## Verified baseline

The clean local branch `m6-wo8` began at `1131252260ff71c97ebd05984011268abea1b044`. The connected GitHub integration independently confirmed remote HEAD `1a82cc1d8b1e8e85743c83969d0e311baeef532b` and tree `323ca88bcb604e5c0fc7280f358c2ac6a834296f`, identical to the complete local tree. Main remained `d005fc30c8c7e175896898c1973e6d3bda144869`. The original checkpoint is preserved.

## Corrections

- Condition headings, benefits captions, activation guidance and evaluated preparation use exact Release-provided Definition names. The client DTO exposes the Definition reference already returned by the server. No cost, eligibility or Skill formula changed.
- The WO3 feature audit admits `createManeuver` only in the registered `NewManeuverForm.tsx` and Character API transport. Its equipment, inventory, respec and job-class prohibitions still cover those files. Creation elsewhere remains prohibited. Catalog, import-boundary and formula audits continue scanning the complete Maneuver UI.
- Scenario 6 uses `/characters/character` for both Sheet visits and waits for a rendered Character Sheet before asserting rows, including the empty result after retirement. It explicitly checks current revision preservation, invalid rebuild rejection, immutable prior history, active revision 2 and released shared capacity.
- The isolated API harness returns a typed Character DTO for the root Character request and exact endpoint responses for Sheet, Abilities and Maneuvers. Unknown GET requests throw rather than returning a Maneuver response.
- The native fixture contract verifies that corrected transport and the full lifecycle using the actual game evaluator. A new component assertion proves that alternate Release labels appear in benefits and preparation.

## Completed verification

| Check | Completed result |
| --- | --- |
| Two previously failing WO3 audits, run first | 2 passed; 23 nonselected tests not counted |
| Affected Character Creation, Sheet, Spell and WO8 UI/static regressions | 158 passed across 9 suites; no skips |
| Native isolated fixture contract | 1 executed and passed, 13.1 seconds |
| Focused audit mutation controls | 10 caught; every temporary mutation restored byte-for-byte |
| Studio typecheck | Exit 0 |
| Studio lint | Exit 0, zero warnings |
| Architecture boundaries | 13 rules, 7 packages; exit 0 |

The 10 controls inject prohibited Skill labels/catalogs, equipment creation/equipping, inventory, respec, job-class features, unauthorized Maneuver creation, client formulas and a database import. The authorized operation paths are not general exemptions. The shared historical control harness proves full working-tree restoration. Commands, completed statuses, log hashes and the two corrected test-authoring failures are recorded in `m6-wo8-phase-c-final-ci-repair-evidence.json`.

## Browser gate and Two-Attempt stop

All six browser scenarios remain **unverified on the corrected tree**. No discovery or skipped test is counted as passing. The native contract is separate and is not a browser substitute.

The previously exhausted local browser blocker persists: `/root/.cache/ms-playwright` is absent and no Chromium/Chrome executable or browser-path override is available. Earlier attempt 1 received a 0 MiB corrupt browser download (`End of central directory record signature not found`). Earlier attempt 2 stopped on the first browser launch because Chromium Headless Shell 1243 was missing (0 passed, 1 launch failure, 5 skipped). These attempts and original logs remain preserved. No third setup or launch attempt was made.

CI #255 did execute all six scenarios on the previous tree: five passed, scenario 6 failed. Those results are historical evidence only. The corrected browser lifecycle and route assertions require a fresh completed CI run.

## Publication boundary and continuation

Publication was conditioned on successful focused verification. That condition is not yet met because the six browser scenarios cannot run here. The remote branch remains unchanged; no new remote commit or tree-equivalence claim is made. There is no workflow-dispatch capability in the connected integration. Re-running CI #255 would test the old SHA.

The shortest safe continuation is explicit authorization to publish this preserved correction for CI-only browser verification, followed by one complete manual **Prowess Studio CI** run on `m6-wo8`, `certification=false`: https://github.com/prowessttrpg-png/prowess-studio/actions/workflows/ci.yml . Wait for all six scenarios and the native fixture contract to execute and pass, along with the complete existing gates.

The local checkpoint SHA, complete tree SHA, clean status, recovery bundle hash and independent bundle-restore proof are recorded in the external recovery manifest after this report is committed. No Phase D, PR, merge, main change, database change, mechanical change, fixture/golden rewrite or canonical Release publication occurred.

## Exact changed-file inventory

- `apps/studio/app/characters/_components/maneuvers/ManeuverBuilder.tsx`
- `apps/studio/app/characters/_components/maneuvers/ManeuverReview.tsx`
- `apps/studio/app/characters/_lib/maneuver-types.ts`
- `apps/studio/tests/e2e/m6-maneuver-fixture-contract.spec.ts`
- `apps/studio/tests/e2e/m6-signature-maneuver.spec.ts`
- `apps/studio/tests/e2e/m6-wo8-ui-api.ts`
- `apps/studio/tests/unit/m6-wo3-static.test.ts`
- `apps/studio/tests/unit/m6-wo8-maneuver-ui.test.tsx`
- `docs/reports/m6-wo8-phase-c-final-ci-repair-evidence.json`
- `docs/reports/m6-wo8-phase-c-final-ci-repair.md`
