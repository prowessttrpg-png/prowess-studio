# M0–M5 Final Architecture Certification (M5-CLOSEOUT-04)

| | |
|---|---|
| Certified source SHA | **`9cb4b3d3d078f743146f7fbb205da1457b3a770c`** (`main`, merge of PR #59) |
| Tier 3 certification run | **#229** — `Prowess Studio CI`, `workflow_dispatch` on `main`, `certification: true` (Actions run id 40749059058), 2026-10-28 18:51:54 → 19:01:51 UTC, **success**, all 16 jobs green |
| Invalid Tier 3 attempt | #226 on `73809a2` — every check passed, but the pnpm store cache was restored (§3); not a certification |
| Merged-main Tier 2 on the certified SHA | #228 (push), success, all 16 jobs green |
| Verdict | **CERTIFIED** (§38) — pending merge of this documentation and green merged-main verification (CLOSEOUT-04 §30) |

Everything in this report is read from the GitHub logs of the runs named, or from the repository at the certified SHA.
Nothing in CLOSEOUT-04 changed application code, mechanics, M4, the schema or migrations.

## 1. Exact certified SHA

`9cb4b3d3d078f743146f7fbb205da1457b3a770c` — parents `73809a2` (CLOSEOUT-03 Stage 2 merged) and `6b350d1` (the Tier 3
cache correction, §3). The correction changed only `.github/workflows/ci.yml`, `scripts/ci/gate-inventory.mjs`,
`apps/studio/tests/unit/ci-gate-inventory.test.ts`, `docs/architecture/ci.md` and the CLOSEOUT-03 report.

## 2. Tier 3 workflow / run

Run #229 used the permanent `ci.yml` (no other workflow exists) with `CERTIFICATION: true`; the summary job reported
"Tier 3 — clean certification" and required every other job to succeed. Job timings (s): static 86 · unit-packages 79 ·
unit-game 168 · unit-studio 85 · db-api 119 · db shard 1 / 2: 169 / 139 · e2e 104 · Tier 1 6 · controls-1…6: 117 /
209 / 191 / 125 / 414 / 141 · Tier 3 summary 5. Wall clock 597 s; runner time 2,157 s.

## 3. Clean-environment evidence

| Requirement | Evidence in run #229 |
|---|---|
| Fresh checkout | every job checks out the certified SHA on a fresh hosted runner |
| No pnpm store cache | in every one of the 13 installing jobs the normal `Set up Node.js` step was **skipped**; the Tier 3 step ran with `cache: false`; no `Cache restored` line exists |
| Frozen install without dependency-cache reuse | every install: `Progress: resolved 572, reused 0, downloaded 572, added 572, done` (`--frozen-lockfile`) |
| No Playwright browser cache | `Restore Playwright browsers` skipped; Chrome for Testing 153.0.8010.12, FFmpeg and the headless shell downloaded from `cdn.playwright.dev` |
| No Next.js build cache | `Restore Next.js build cache` skipped; `next build`: "⚠ No build cache found" |
| Fresh Prisma generation | `Generated Prisma Client (7.10.0)` in every building job |
| Clean databases, migrations from history | each database job has its own new PostgreSQL 16 service; "All migrations have been successfully applied." (dev and test databases) |
| No stale generated source / build / test output | nothing is restored between jobs except the per-run suite reports, which `verify-gate.mjs` binds to the commit SHA |

Runner-image tooling (the hosted Node 22.23.4 toolcache) is part of the runner image, not a workflow cache.

**Defect found and corrected during CLOSEOUT-04.** Tier 3 attempt #226 (`73809a2`) passed every check but restored the
pnpm store in all 14 installing jobs (`reused 572, downloaded 0`), because
`cache: ${{ env.CERTIFICATION == 'true' && '' || 'pnpm' }}` always yields `'pnpm'` (`''` is falsy in GitHub
expressions). Classified as a **CLOSEOUT-03 CI implementation defect**, not a mechanics, M4 or database failure. Corrected
in `6b350d1` (PR #59, PR run #227 green, merged-main #228 green): explicit normal / Tier 3 Node setup steps, enforced by
`checkCertificationCaches`. Run #226 remains valid evidence that every functional gate passed; it is not a certification.
Normal Tier 1 / 2 runs still restore the pnpm, browser and Next.js caches (#227, #228).

## 4. Repository / package architecture

pnpm workspace (pnpm 9.15.9, Node 22, TypeScript): `@prowess/model` (domain types, enums, validators), `@prowess/ui`
(UI primitives), `@prowess/import` (pure source / import pipeline), `@prowess/rules` (M4 generic Rules Engine, frozen),
`@prowess/game` (M5 Prowess mechanics, pure), `@prowess/db` (Prisma persistence, M1–M3 services, materialization) and
`apps/studio` (Next.js 16.3.6 / React 19.3.0; 29 pages, 83 API route handlers). Dependency direction:
`model ← ui, import, rules`; `model, rules ← game`; `model, import, rules, game ← db`; `model, rules, ui, db ← studio`
(Studio reaches `game` only through `db` — M5-I017). The architecture check (import-boundary rules) passed in the static
job. The placeholder `@prowess/test-fixtures` package is gone (R6); its import bans stay in the architecture rules.

## 5. M0–M3 foundation status

M0 (stack, shell, CI), M1 (Entity / EntityVersion core, immutable versions, migrations, persistence and API
reproducibility), M2 (Ruleset governance: manifests, policies, change sets, canon decisions, releases, version history UI)
and M3 (source structure, extraction, matching, import batches, candidates, review decisions, import Studio UI) are
intact: the M1 static (93 assertions), database (18) and API (15) gates passed; the M2 / M3 audits run inside the Studio
unit and integration suites (all green); Playwright covers boot, compendium, import studio, M1 audit, M2 governance,
Rules Inspector and version history (45/45).

## 6. M4 certification

Every permanent M4 gate passed in #229, verified from this commit's authoritative reports (passing assertions):
M4-WO1 boundaries & purity (static + the complete `rules-unit` suite, 740) · WO2 exact Ruleset resolver static 35 /
database 16 · WO3 Formula Engine safety & determinism 37 · WO4 Keyword metadata & resolution static 33 / database 1 ·
WO5 Requirements 41 · WO6 Modifiers 34 · WO7 Resources 32 · WO8 Validation 38 · WO9 Trace 35 · WO10 orchestration 42 ·
WO10 HTTP integration 9 · WO11 Inspector 58 · WO12 final M4 integration & reproducibility 337, plus the 3 M4-final
negative controls (requirement / resource auto-block, payment reduces listed value). `@prowess/rules` unit suite
659/659. M4 source and semantics were not touched by any closeout; its golden outputs are asserted unchanged.

## 7. M5 certification

All 13 M5 gates and the canon-rulings gate passed, each verified from the authoritative reports and followed by its
controls: WO1 domain & shared ability boundary (3 files + the complete `game-unit` suite, 1,103 assertions) · WO2 core
resolution 251 · WO3 runtime resources & movement 266 · WO4 Affinity · canon rulings (Size Base Movement, Level 9
Affinity rank) · WO5 shared construction · WO6 Targeting · WO7 Effects · WO8 Traits & authored definitions · WO9
Duration & Conditions · WO10 final Spell cost · WO11 final Maneuver cost · WO12 Effect Chain execution (108) · WO13
Active Magic. The M5 invariant catalog (`docs/architecture/m5-invariants.json`, 337 entries) is asserted by the static
audits; the Structured Canon conflict guards (unresolved conflicts never execute) are part of the WO8–WO13 suites.

## 8. Ruleset architecture

Exact `RulesetContext` resolution (M4-WO2) by Ruleset + Manifest (+ Release with verified manifest hash); release
contexts use frozen composition. Every downstream value — Definition bundles, cost results, execution plans, Active
Effect state — carries the exact Ruleset / Manifest / Release provenance and is refused under another. No `latest` /
`current` resolution exists in any rules path (§15).

## 9. EntityVersion architecture

Entities are immutable versioned records; a Ruleset Manifest pins exact EntityVersions. A Definition is accepted into a
bundle only if its exact EntityVersion is pinned by the bundle's RulesetContext with matching canonical key, EntityType
and source provenance (`createProwessDefinitionBundle`); lookups are by exact five-field identity with no fallback.

## 10. Character-facing readiness

The engine layer a Character Platform needs is complete and certified: stats, dice, ranks, resources, action economy,
movement, Affinity, Spell / Maneuver construction, final costs, Effect execution and Active Magic, all pure and
Ruleset-pinned. The Studio `/characters` route is still the M0 placeholder: there is no character persistence model,
builder or sheet yet. That is M6 scope.

## 11. Spell pipeline

Definition → Targeting (WO6) → Effects (WO7) → Traits (WO8) → Duration / Conditions (WO9) → final MP / AP (WO10) →
Effect Chain (WO12) → runtime routing (WO12) → Active Magic lifecycle (WO13). Each stage consumes the previous stage's
exact outputs; WO13 does not recalculate cost or re-execute chains (M5-I336). Certified by the WO6–WO13 gates and their
golden, contract and security suites (Game 921/921) and the 76 WO6–WO10 and 56 WO12–WO13 controls.

## 12. Maneuver pipeline

Definition → existing Attack binding → Attack Use → Powerful Blow → Effect / Trait attachments → Conditions → final AP /
MP (WO11) → runtime resolution groups (WO12). WO11 semantics are preserved exactly: the WO11 gate (6 files) and its 26
mutation controls passed; attack floors, Signature handling, explicit AP-or-MP choice and the deferred listings
(M5-SC-044) remain asserted.

## 13. Effect execution

WO12 executes authored Effect Chains with exact routing (success / failure / not-triggered, no-chain defaults from the
Ruleset policy), refuses prose triggers, dangling or backward destinations and client success flags; 108 gate
assertions and 26 mutation controls passed.

## 14. Active Magic

WO13: Sustain, ME-first payment, Mana Lock, Concentration capacity and Concentration Save, Channeling, the Active Effect
lifecycle, exact Ruleset / policy pinning and historical reproducibility — gate green, 30 mutation controls caught.
M5-SC-052 (generic Mana Lock amount) and M5-SC-053 (standard Spell MP timing during Channeling) remain UNRESOLVED and
are surfaced, never decided (§30).

## 15. Database architecture

Prisma 7.10.0, PostgreSQL 16, 42 models, 22 migrations. Test and development databases are separate; the guarded reset
refuses any non-test target ("Safety guard correctly refused (exit code 1), as expected."). Database integration runs in
two shards on independent databases.

## 16. API architecture

83 Next.js route handlers over `@prowess/db` services with plain-data validation at every public boundary; API
integration 165/165 and the M1 API reproducibility and M4-WO10 HTTP gates passed. Studio's two HTTP clients share one
transport (CLOSEOUT-02 R8) with distinct error semantics.

## 17. Frontend foundation

App shell and navigation (M0), Compendium and version history (M1–M2), Ruleset governance (M2), import studio (M3),
Rules Inspector / Calculation Lab (M4-WO11). Studio unit / component / static-audit suite 2,854/2,854; Playwright
45/45. Character, GM, World and Publishing routes are placeholders.

## 18. Assertion inventory

`node scripts/ci/gate-inventory.mjs` in #229: **"Gate inventory consistent: 9 suites, 32 gates, 280 controls, 14 checks;
every legacy item represented."** The frozen legacy snapshot (223 items from the pre-CLOSEOUT-03 workflows) proves old
permanent protection ⊆ current protection; the retired `m5-wo7.yml` … `m5-wo13.yml` assertions and the 22 WO7 controls
are in the consolidated pipeline. Since the correction the check also enforces the Tier 3 no-cache contract.

## 19. Control inventory — 280 / 280 caught in #229

| Negative (180) | | Mutation (100) | |
|---|---|---|---|
| M4-final | 3 | M5-WO10 | 18 |
| M5-WO1 | 17 | M5-WO11 | 26 |
| M5-WO2 | 18 | M5-WO12 | 26 |
| M5-WO3 | 21 | M5-WO13 | 30 |
| M5-WO4 | 34 | | |
| M5-WO5 | 29 | | |
| M5-WO6 | 16 | | |
| M5-WO7 | 22 | | |
| M5-WO8 | 8 | | |
| M5-WO9 | 12 | | |

Each control failed for its own expected pattern, was restored, and the harness reported "every file restored
byte-for-byte and the working tree unchanged"; counts are pinned by `PROWESS_EXPECT_CONTROLS`. The harness self-test
(8 scenarios) passed in the static job.

## 20. Package test totals

model 513 · ui 21 · import 128 · rules 659 · db unit 96 · Game 921 · Studio **2,854**. Studio is one more than the
2,853 baseline: the single test added by the Tier 3 cache correction (`ci-gate-inventory.test.ts`, the no-cache
contract and its rejection of the #226 expression). No decrease anywhere.

## 21. DB / API totals

API integration 165/165 · DB integration shard 1 280/280, shard 2 247/247 (527/527).

## 22. Prisma validation

"The schema at prisma/schema.prisma is valid 🚀"; Prisma Client 7.10.0 generated in every building job.

## 23. Migrations

22 migrations applied from history to fresh development and test databases in every database job ("All migrations have
been successfully applied."); the migration-ledger tests run in DB integration and the M1 migration guarantees in
the M1 database gate — all green.

## 24. Drift

`prisma migrate diff` (migrations vs `schema.prisma`): **"No difference detected."** (job summary: "No differences.").

## 25. Build

`pnpm build` (production, cold): passed in 24 s (Tier 2 #228: 20 s); Next.js "Compiled successfully". Warnings: only
"⚠ No build cache found" — expected, because Tier 3 deliberately skips the Next.js cache; absent in Tier 2. Runtime
deprecation notices seen in test / tool output (Node `punycode` DEP0040 from tooling, `Buffer()` DEP0005 in control
runs, `pg` concurrent `client.query()` in DB integration, PostgreSQL `initdb` trust-auth notice in service containers)
were also present in attempt #226 and are recorded as non-blocking technical debt (§31). Lint ran with
`--max-warnings=0` in every package.

## 26. Playwright

45/45 in 21.1 s against the production build, browsers freshly downloaded, no new retries. The two CLOSEOUT-03 flake fixes
(nav-link `exact: true`; polled geometry) held in #224–#229.

## 27. Determinism

Asserted by the M4-WO1 purity audit (no clock / RNG / I/O in rules paths), the M4-WO3 Formula Engine determinism gate,
the M5-WO1 mutable-module-state audit, and the golden suites (compilation, validation, cost, Effect routing, Active
Effect transitions, serialization, source maps, traces produce deep-equal results for equal inputs; bundle order is
input-order independent). No `Math.random` or `Date.now()` appears in `@prowess/game` or `@prowess/rules` production
source.

## 28. Historical reproducibility

Historical content stays pinned to its exact Ruleset, EntityVersion, Definition, policy, cost behavior, execution
behavior and Active Effect lifecycle: M4-WO12 final reproducibility (337), the M1 API reproducibility gate, WO10–WO13
golden suites (e.g. an R1 Active Effect keeps R1's pinned Sustain AP after R2 changes the policy; R1 state under R2 is
refused; nothing is written). No `latest` / `current` substitution exists in certified historical paths; the Studio
client's unused `getLatestPolicy` is an M2 governance lookup, not a rules path.

## 29. Security

Plain-data guards (accessors, functions, cycles, prototype keys, non-finite numbers) at every public entry; Formula
Engine dependency / safety gates; refusal of executable payloads, prose triggers and client success flags;
cross-Ruleset and forged-EntityVersion injection refused at bundle creation; resource transitions cannot go negative and
fail atomically; the unsafe DB reset is refused; validated-bundle reuse is not trusted from callers (R1 not adopted;
CLOSEOUT-02 R3 kept every public boundary). Covered by the `*-security`, `*-negative` and `closeout-trust-boundary`
suites, all green.

## 30. Unresolved canon conflicts

From the repository register (`docs/architecture/m5-core-playtest-source-conflicts.md`, unchanged): 54 conflicts,
42 RESOLVED_BY_DESIGNER, **12 UNRESOLVED: M5-SC-042 through M5-SC-053** (042 Affinity Trait capacity grant, 043 Cannot
Move This Turn AP benefits, 044 discretionary benefits / restriction subjects, 045 Permanent Duration access, 046
multi-target base count, 047 Signature Spell MP discount, 048 elemental damage conversion cost, 049 Trait TRIGGER chain
semantics, 050 Save profile runtime selection, 051 Maneuver Effect resolution combinations, 052 generic Mana Lock amount,
053 Spell MP timing during Channeling). M5-SC-054 is RESOLVED by the WO13 ruling. Earlier closeout summaries that listed
fewer IDs (omitting 043 and 045, and in one case 044) were incomplete summaries, not changes to canonical state. None was
resolved during certification.

## 31. Known technical debt

- Top-bar Ruleset selector lists only the first 100 Rulesets (§33).
- Unused Studio client functions incl. `getLatestPolicy` (CLOSEOUT-01 §30).
- R4 / R10 / R11 deferred (§32); R9 remainder pinned by M2 write-inventory gates.
- Dependency / tooling deprecation notices (§25); `pg` concurrent-query deprecation will matter at `pg@9`.
- Character, GM, World and Publishing routes are placeholders.
- Mutation-run vitest job summaries show expected "1 failure" entries (deliberately failing mutated runs inside the
  controls; 233 in each controls-bearing Tier 2 run) — cosmetic noise in the Actions summary page.

## 32. R1 / R4 / R6 / R10 / R11

R1 — TRUE INVARIANT: no global mutable state in `@prowess/game`; not implemented. R4 — implementation pin (M5-I336 call
shape), deferred. R6 — COMPLETE (CLOSEOUT-03). R10 — implementation pin (M4-WO2 call graph; M4 frozen), deferred.
R11 — implementation pin / hygiene opportunity (literal provenance anchors), deferred. None blocks certification.

## 33. Known Ruleset-selector issue

The top-bar Ruleset selector requests `pageSize: 100`, so on a database with more than 100 Rulesets newer ones are not
selectable. Characterized in CLOSEOUT-03; cannot occur in CI (fresh database per run) and caused no certification test to
fail. Not fixed during certification; handed to M6.

## 34. CI architecture

`ci.yml` is the only workflow; the WO7–WO13 workflows are absent and represented (§18). 16 jobs: static, three unit jobs,
db-api, two DB shards, six controls jobs, e2e, Tier 1 and Tier 2 / Tier 3 summaries. Pull-request runs use
`ci-pr-<number>` with cancel-in-progress; `main` pushes and manual / certification runs use unique `ci-run-<run id>`
groups and always complete. Tier 1 = fast feedback (static + unit), Tier 2 = merge readiness (every job), Tier 3 = the
same graph with `certification: true` and no pnpm / browser / Next.js cache (now enforced, §3).

## 35. Performance before / after

| | Wall clock | Runner time |
|---|---|---|
| Pre-optimization `main` (#219, `f3a5698`) | 2,038 s (≈ 34 min) | 3,629 s (CI + 7 dedicated workflows) |
| Tier 2 on `main` #225 (`73809a2`) | 378 s | 1,781 s |
| Tier 2 on certified `main` #228 (`9cb4b3d`) | 387 s | 2,065 s |
| Tier 3 #229 (`9cb4b3d`) | 597 s | 2,157 s |

Critical path −81 % (≈ 5.3× faster, #219 → #228); runner time −43 % to −51 % (#228 / #225). Tier 3 overhead vs #228:
+210 s wall, +92 runner-seconds (+4.5 %). Most of the wall-clock difference is one controls step: M5-WO12's controls
took 349 s in #229 against WO12 jobs of 146–228 s in #224–#228, with identical work (20 baseline + 26 mutation guard
runs, all caught, no retry) — runner variance. Cold installs (≈ 15 s per job), the browser download and the cold Next.js
build add the rest.

## 36. Remaining application risks

- Unresolved canon (§30) bounds which content can execute; M6 content authoring will hit these conflicts first.
- Engine performance: the WO13 activation path still compiles twice per activation (R4 deferred) — acceptable today,
  worth measuring under M6 character workloads.
- Runner variance can stretch individual controls jobs (§35); the critical path is still far inside the 12–20 min target.
- Character persistence, ownership and authorization do not exist yet; M6 introduces the first user-owned mutable
  records on top of the immutable Ruleset model.

## 37. M6 readiness determination

**READY.** The foundation M6 builds on — exact Ruleset / EntityVersion pinning, the import and Compendium pipeline,
the frozen M4 engine, the certified M5 mechanics and a fast, clean-certifiable CI — is complete, consolidated and
verified from a clean environment. M6-WO1 (Compendium Administration Foundation) may begin once the M5 completion
checkpoint is issued.

## 38. Final certification verdict

**CERTIFIED at `9cb4b3d3d078f743146f7fbb205da1457b3a770c` by Tier 3 run #229**: clean environment proven (no
dependency, browser or Next.js cache), 9 suites / 32 gates / 280 controls / 14 checks, every package, Game, Studio,
DB / API total, Prisma validate / generate / migrations, drift "No difference detected", build and Playwright 45/45
green. The final declaration "M5 COMPLETE — M0–M5 APPLICATION FOUNDATION CONSOLIDATED, OPTIMIZED AND CERTIFIED" follows
only after this report is merged and merged-main verification is green (CLOSEOUT-04 §30).
