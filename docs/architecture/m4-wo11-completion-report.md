# WORK ORDER READY FOR CI VERIFICATION — M4-WO11

## PREREQUISITE AMENDMENT — M4-WO10A

The approved prerequisite was implemented first on the same branch. `EXPLANATION_PROJECT` is appended to the closed operation vocabulary, with named inputs `document` and `level`. Its dispatcher is exactly one call to existing WO9 `projectExplanation`; no explanation rebuild or rule recalculation occurs. Canonical EXPLANATION and `explanationStepKey` semantics remain unchanged. The sample explicitly binds `/data` from its prior canonical explanation to `/document` and asks for SUMMARY.

Changed engine files: `packages/prowess-rules/src/orchestration/model.ts`, `orchestration/orchestrate.ts`, and `orchestration.test.ts`. The existing WO10 static inventory is updated narrowly; WO11 adds exact-call negative controls for the projection adapter. Direct primitive equivalence, canonical preservation, deterministic ordering, reference rejection, blocked dependencies, null/invalid document handling and retained golden facts are covered. An additional real HTTP integration fixture uses the actual WO11 sample.

M4-I162A: **Explanation Projection Uses An Exact Existing ExplanationDocument And Performs No Rule Recalculation.** No schema, migration, HTTP route, persistence, new response envelope or existing EXPLANATION behavior changed. Projection preserves WO9's direct response verbatim, including null response-level Ruleset provenance; document/section identities stay exact. A missing path is BLOCKED; a present null is copied and WO9-invalid, according to the existing contracts.

## WO11 implementation report

| # | Item | Result |
| --- | --- | --- |
| 1 | Base Commit / Branch | `53aa50067bb2cc9508a73e690e432cf19cd37d8f` / `m4-wo11`; isolated worktree built from the approved WO10 merge. |
| 2 | Files Created | See exact file inventory below. |
| 3 | Files Modified | See exact file inventory below. |
| 4 | Files Removed | None. |
| 5 | Database / Migration Status | No schema change, no migration, no evaluation persistence. Existing schema and all 22 migrations are SHA-256 pinned. Actual DB drift/deploy requires CI; the guarded reset entrypoint refuses the non-test database locally. |
| 6 | Developer Navigation | Developer overview links to Rules Inspector / Calculation Lab; no player/Compendium link added. |
| 7 | Page / Route Structure | One UI route: `/developer/rules`; no HTTP route added. |
| 8 | Desktop Layout | Plan/Context, Execution/Explanation and Inspector panes inside the existing Studio shell. Reserved shell Inspector is hidden on this route. |
| 9 | Mobile Layout | Below 900px, PLAN/RUN/DETAILS pane tabs retain every action; JSON/tables scroll internally. |
| 10 | API Client | Type-only reuse of WO10 request types, canonical RuleEngineResponse response type, existing HTTP transport; one POST `/api/rules/evaluate`. |
| 11 | Exact Ruleset Selector | Explicit mode and record choice. Lists paginate through existing M2 read APIs; no automatic exact record selection. |
| 12 | Manifest Selection | Development Manifest version/id and available exact header details displayed. |
| 13 | Release Selection | Release number/version label/id/hash and available publication header details displayed. |
| 14 | Actor Context Editor | Generic object/null JSON plus Enabled/Null control. |
| 15 | Build Context Editor | Generic object/null JSON plus Enabled/Null control. |
| 16 | Runtime Context Editor | Generic object/null JSON plus Enabled/Null control. |
| 17 | EvaluationPlan Editor | Local step editor, advanced JSON plan import and exact request preview. Client validates outer editor shape/syntax; server owns semantics. |
| 18 | Step Editor | Explicit key, order, operation and input; add/edit/duplicate/remove affect local state only. |
| 19 | Operation Selector | Exact 15-operation WO10/WO10A vocabulary imported from the public contract. |
| 20 | Step Ordering | Order ascending, then UTF-16 code-unit stepKey; tied orders have explanatory warning. |
| 21 | Binding Editor | Target pointer, exact source, exact pointer, add/edit/remove. No transform feature. |
| 22 | Context References | RULESET/ACTOR/BUILD/RUNTIME exact source and pointer choices. |
| 23 | Prior-Step References | Only strictly earlier displayed steps offered; empty pointer labelled Whole Response. |
| 24 | Plan Designations | Optional Primary; VALIDATION-only validation designation; canonical EXPLANATION-only explanation designation. |
| 25 | Run Workflow | Explicit Run, duplicate-submit ref/button guard, running state, detached frozen exact request snapshot. |
| 26 | COMPLETE / PARTIAL Presentation | Run execution shown separately from orchestration and child validity. |
| 27 | Blocked-Step Presentation | Exact BLOCKED status and every returned binding reason/target. |
| 28 | Formula Inspector | Returned variables, expressionValue, rounding/bounds and finalValue. Authored expression/input remain available separately. |
| 29 | Keyword Inspector | Exact canonical key/Keyword/category table with contributors/provenance JSON; no implied mechanics. |
| 30 | Requirement Inspector | SATISFIED/NOT SATISFIED/INVALID remain distinct; returned outcome tree mounts children on demand. |
| 31 | Modifier Inspector | Actual outcome order, phase, key, APPLIED/SKIPPED_CONDITION/DEDUPLICATED, before/after, operand, condition, full provenance. |
| 32 | Resource Inspector | Returned transition, before/after, requested/actual amounts, shortfall and available maximum; reservation/release are capacity labels. |
| 33 | Payment Inspector | Listed value, projected allocation and actual resulting resource state remain separate; unaffordable payments show unchanged state. |
| 34 | Validation Inspector | Exact severity/category/code/path/details/provenance grouped as ERROR/WARNING/INFO; counts are returned fields or message list lengths. |
| 35 | Explanation Summary / Detailed | Both originate from server responses. Exact step selector displays canonical DETAILED and explicit projection results; no implicit projection winner. |
| 36 | CalculationTrace Browser | Returned hierarchy, path, ordinal, order, inputs/output, phase and provenance. Lazy branch mounting. |
| 37 | Rule Provenance | Exact trace rule/modifier-source and returned section provenance; no authority ranking. |
| 38 | Ruleset Provenance | Exact evaluated identity and returned provenance, including inherited source Manifest identity wherever supplied. |
| 39 | Diagnostic / Trace Linking | Exact contribution binding maps returned sourceTracePath to its source step; projection follows its explicit document binding. Diagnostic ordinal lookup is iterative and runs on click. |
| 40 | Raw JSON Views | Read-only request snapshot, response, child output, selected step, trace fields and explanation data. |
| 41 | Request Snapshot / Stale Result Behavior | Input/selection changes mark old response STALE, including edits during an in-flight run. No automatic rerun. New request failures clear old run results. |
| 42 | Sample Plan | Neutral FORMULA → MODIFIER → FORMULA → PAYMENT_APPLY → VALIDATION → EXPLANATION → EXPLANATION_PROJECT at explicit orders 10–70. User chooses exact record; no stored content created. |
| 43 | Listed Cost / Payment Regression | Listed 17 / raw derived 4.25 / FLOOR derived 4 / payments 6+11 / primary remaining 9 tested at primitive/orchestration/component levels; HTTP/E2E tests added for CI. |
| 44 | Responsive / Mobile Behavior | CSS pane collapse and internal overflow guards; real mobile workflow added to Playwright. |
| 45 | Accessibility | Labelled inputs/selectors, semantic buttons/fieldsets, selection/expansion ARIA, text/live statuses and visible focus. Keyboard-reachable operations. |
| 46 | Performance / Large Trace Handling | 1,000-step author/run component test passes. Deeper trace/explanation/Requirement branches remain unmounted until expanded; diagnostic source search is lazy. |
| 47 | Read-Only Database Guarantee | No browser storage, database access or save route. WO11 sample HTTP integration fingerprints all tables; scoped E2E fingerprint avoids interference from parallel fixture writers. DB-backed proofs await CI. |
| 48 | New M4 Invariants | M4-I163–I188 individually catalogued and machine-readable guard mapping added; M4-I162A added without renumbering. |
| 49 | Component Tests | 16 tests use real pure-engine responses for editor, statuses, payment, reservation, validation, summary/trace links, stale inputs, concurrency guard and 1,000-step sanity. |
| 50 | API Client Tests | 7 tests: exact Manifest/Release serialization, response preservation and safe transport/network/malformed-response handling. |
| 51 | Playwright / E2E Tests | 5 real-HTTP workflows added: full flow/read-only/stale; false Requirement/resource/reservation/validation; PARTIAL; historical Release; mobile. Local browser install blocked; execution awaits CI. |
| 52 | Static Architecture Audits | 35 WO11 static/control tests plus existing WO1–WO10 audits pass locally. Older no-UI/no-engine-import inventories were narrowed for this approved route, public types and closed constants; browser evaluator prohibition remains. |
| 53 | Control Injection Results | In-memory negative controls catch rounding, effective cost, DB/Prisma imports, latest selection, game branches, business auto-blocking, local evaluation/projection and hidden network. Projection case exact-call controls catch rebuild, every evaluator, arithmetic and DB access. No broken production control committed. |
| 54 | Documentation | WO10A amendment, WO11 architecture/workflow/diagrams/limits, invariant catalog/maps and this report. |
| 55 | Local Verification | 2,997 unit tests passed: model 513, rules 659, db unit 83, import 128, ui 21, Studio 1,593. Workspace lint/typecheck, architecture, production build and Prisma validate/generate passed. See environment limitations below. |
| 56 | Sandbox Limitations | PostgreSQL test service returns ECONNREFUSED; migrations, drift, DB/API integration and guarded successful test reset are unavailable locally. Browser CDN returned invalid/truncated ZIPs. Pinned pnpm9 frozen install was blocked by registry 403 for d3-delaunay; frozen pnpm11 --ignore-scripts succeeded using the unchanged lockfile, followed by explicit generation/builds/checks. |
| 57 | GitHub Verification Needed | Run permanent CI: pnpm9 frozen install, empty dev/test migrations, drift, resets, all integration gates, production build and full Playwright. New named WO11 gate retains existing gates. |
| 58 | Acceptance Criteria Status | Implementation and local non-DB checks complete. WORK ORDER READY FOR CI VERIFICATION — not FINAL PASS; pending database/browser/permanent CI results. WO12 not begun. |

## Exact file inventory

Created:

- `apps/studio/app/developer/rules/_components/lab.tsx`
- `apps/studio/app/developer/rules/_components/views.tsx`
- `apps/studio/app/developer/rules/_lib/editor.ts`
- `apps/studio/app/developer/rules/_lib/sample.ts`
- `apps/studio/app/developer/rules/page.tsx`
- `apps/studio/src/api-client/rules.ts`
- `apps/studio/tests/e2e/rules-inspector.spec.ts`
- `apps/studio/tests/unit/m4-rules-api-client.test.ts`
- `apps/studio/tests/unit/m4-rules-lab.test.tsx`
- `apps/studio/tests/unit/m4-wo11-static.test.ts`
- `docs/architecture/m4-rules-inspector-calculation-lab.md`
- `docs/architecture/m4-wo11-baseline.json`
- `docs/architecture/m4-wo11-completion-report.md`
- `docs/architecture/m4-wo11-invariants.json`

Modified:

- `.github/workflows/ci.yml`
- `apps/studio/app/developer/page.tsx`
- `apps/studio/app/globals.css`
- `apps/studio/src/api-client/index.ts`
- `apps/studio/tests/integration/m4-rules-evaluation-api.test.ts`
- `apps/studio/tests/unit/m2-ui-static.test.ts`
- `apps/studio/tests/unit/m4-wo1-static.test.ts`
- `apps/studio/tests/unit/m4-wo10-static.test.ts`
- `apps/studio/tests/unit/m4-wo2-static.test.ts`
- `apps/studio/tests/unit/m4-wo3-static.test.ts`
- `apps/studio/tests/unit/m4-wo4-static.test.ts`
- `docs/architecture/m4-rules-engine-core.md`
- `docs/architecture/m4-rules-evaluation-orchestration-api.md`
- `packages/prowess-rules/src/orchestration.test.ts`
- `packages/prowess-rules/src/orchestration/model.ts`
- `packages/prowess-rules/src/orchestration/orchestrate.ts`

Removed: none.

## Final acceptance

No FINAL PASS is claimed. Permanent CI must prove the pending DB/browser gates. Publication to `prowessttrpg-png/prowess-studio` was explicitly authorized on October 14, 2026, including the WO10A/WO11 source, tests, documentation and GitHub Actions changes, branch `m4-wo11`, a draft PR against `main`, and CI verification. The earlier automatic approval-review rejection is resolved by that authorization. CI verification remains pending; merge is not authorized. Do not start WO12 automatically.
