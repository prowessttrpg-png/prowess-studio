# M6-WO8 Tier 2 historical gate repair

Date: 2026-11-04 (America/Los_Angeles).

**Phase B is accepted.** [CI run #253](https://github.com/prowessttrpg-png/prowess-studio/actions/runs/41913388026), head `a436c632e6c34317a1ea95d6a367f900db1f906a`, passed PostgreSQL 16 migrations, zero schema drift, API integration, both database shards, all unit suites, production build, Playwright and Tier 1. The user's acceptance is preserved. This repair addresses only the three blocked historical control suites; fresh Tier 2 CI is still required. Phase C remains unstarted.

## Verified starting state

- Remote `m6-wo8`: `a436c632e6c34317a1ea95d6a367f900db1f906a`.
- Equivalent local checkpoint: `8de45dda34d97d993e928af1552ceee305336fa9`, clean on entry.
- Identical complete baseline tree: `738b696ee1d87cc9e257fa5626ee9a83df8c5084`.
- Main: `d005fc30c8c7e175896898c1973e6d3bda144869`; not modified.

## Exact anchor repairs

The original logs show `actual: 1, expected: 2` for `text.split(anchor).length`. That means **zero occurrences**, rather than two: WO8 changed the anchored statements. The strict uniqueness checks remain unchanged; no global replacement or relaxed assertion is introduced.

| Control | Intended mutation site and preserved behavior |
| --- | --- |
| M5-WO1 §220 and the same shared anchor in §221 | Anchor the exact current `CompositionReader.ref` branch-kind check. Substitute shared-contract matching only, preserving the projected Foundation exception. The original focused guards still reject accepting Spell Effects or Traits in Maneuvers. |
| M5-WO6 §184 | Anchor that same exact current branch-kind check and add only the prohibited SPELL_TARGETING-to-MANEUVER_TARGETING exception. The existing Foundation and Shared Trait exceptions remain intact. The original §147 golden guard detects the violation. |
| M6-WO7 #2 | Anchor the complete current shared revision-creation statement. Inject the forbidden Character Release write only when `kind === "SPELL"`, before the original statement. The original Studio guard detects the unauthorized canonical write. |
| M6-WO7 #47 | This later control shared #2's obsolete anchor. Reuse the same unique current statement and inject the existing history-deletion violation only for the Spell branch. This is necessary to preserve all 68 historical controls. |

The Maneuver revision branch is not mutated by the two repaired WO7 controls. All other mutations, guards, expected-failure patterns, timeouts, required counts and shared harness code remain unchanged.

## Focused verification

An in-memory preflight applied every mutation to the current original file text without writing source files: all **101** targets were valid and every mutation changed the text. The actual complete suites then ran sequentially, using the unchanged permanent guards and explicit `PROWESS_EXPECT_CONTROLS` counts:

| Command | Result | Green baselines | Mutations detected |
| --- | --- | --- | --- |
| `PROWESS_EXPECT_CONTROLS=17 node scripts/m5-wo1-negative-controls.mjs` | Passed | 15 | 17/17 |
| `PROWESS_EXPECT_CONTROLS=16 node scripts/m5-wo6-negative-controls.mjs` | Passed | 9 | 16/16 |
| `PROWESS_EXPECT_CONTROLS=68 node scripts/m6-wo7-negative-controls.mjs` | Passed | 2 | 68/68 |

Each successful process exited 0 and printed its full completion summary. Each harness proved every temporary mutation restored byte-for-byte and the working tree unchanged from its pre-run state. All three originally blocked controls executed and caught their intended violations; §221 and #47 also passed. The suites retain their existing required counts in the unchanged CI inventory.

`node --check` passed for all three scripts. The permanent gate-inventory check and `git diff --check` passed. After all controls completed, the only source differences were these three scripts; `git diff --exit-code -- packages apps .github scripts/lib/control-harness.mjs scripts/ci/gates.json` passed with no differences. No game implementation, Prisma schema, migration, historical golden, application UI, audit rule, shared harness, or workflow was changed.

The first WO1 invocation produced only 14 caught-control lines and no final completion/restoration marker despite the terminal reporting completion. It was treated as incomplete evidence. One instrumented attempt recorded exit status 0, all 17 catches, and both completion and restoration markers. That successful attempt is the verification result; the earlier incomplete log is retained and hashed in the evidence. No further troubleshooting of that runner observation occurred. No database setup experiment or full regression run was performed.

The adjacent [evidence JSON](m6-wo8-tier2-historical-gate-evidence.json) records the authoritative CI job results and original errors, preflight results, complete control output, SHA-256 log digests and explicit process-status checks.

## Complete corrective inventory

All five files have regular-file mode `100644`:

1. `scripts/m5-wo1-negative-controls.mjs`
2. `scripts/m5-wo6-negative-controls.mjs`
3. `scripts/m6-wo7-negative-controls.mjs`
4. `docs/reports/m6-wo8-tier2-historical-gate-repair.md`
5. `docs/reports/m6-wo8-tier2-historical-gate-evidence.json`

## Publication and next boundary

Preserve a local corrective commit and complete-history recovery bundle. Publish an equivalent Git Data commit whose parent is the accepted remote baseline above, require the complete remote tree SHA to equal the local corrective tree, then fast-forward only `m6-wo8` using an expected-head lease and `force=false`. Independently verify the resulting ref, parent, tree, and unchanged main. Exact resulting SHAs accompany delivery, since a commit cannot contain its own SHA.

Request **one fresh [Prowess Studio CI workflow](https://github.com/prowessttrpg-png/prowess-studio/actions/workflows/ci.yml)** on `m6-wo8`, with normal settings (`certification=false`), to verify Tier 2. The connected toolset exposes workflow rerun operations but no fresh workflow-dispatch operation, so the fresh trigger must be manual. No additional CI workflow was triggered during this repair.

Stop after publication and evidence delivery. No PR, merge, main modification or Phase C implementation is authorized or performed.
