# M6-WO8 Phase B CI remediation

Date: 2026-11-04. Scope: corrective changes for [CI run #252](https://github.com/prowessttrpg-png/prowess-studio/actions/runs/41907646580), followed by branch publication and a request for fresh CI. Phase C remains unstarted. This is not a completed Phase B acceptance report: corrected PostgreSQL deployment, zero drift, lifecycle inventory, and API execution require the fresh run.

## Exact starting state

- Local branch: `m6-wo8`; original checkpoint: `c00214cdb4068aabe6277a2e43da04f7f423c8fe`.
- Published starting commit: `f74f1c5ca60badce3a1de8949d00b61376996c2b`.
- Both starting commits have the complete tree `55ad1b2dde98b4d5ef30f910cda9b7c166e16489`.
- Verified WO7/main baseline: `d005fc30c8c7e175896898c1973e6d3bda144869`.

The original checkpoint and full-history recovery bundle remain preserved. The corrective local commit descends from that checkpoint. The equivalent corrective remote commit must descend from the published starting commit, with an independently verified identical complete tree and a non-force branch update. Publication SHAs accompany the checkpoint delivery; they cannot be embedded in their own commit.

## Prisma constraint identity

PostgreSQL stored each original 64-byte constraint name truncated to 63 bytes. Prisma's generated default naming algorithm instead abbreviated before `_fkey`, producing different names. Only the two new relation mappings change:

| Relation | Explicit mapping to the already deployed name |
| --- | --- |
| Character Release | `character_signature_maneuver_revisions_character_release_id_fke` |
| Previous Maneuver revision | `character_signature_maneuver_revisions_previous_revision_id_fke` |

The applied WO8 migration is unchanged (SHA-256 `d5426f48e29f9378d73178cc86405a379f22b2e0439c6c5619cb592eb7ff6379`). A permanent assertion pins those bytes and both exact truncated mappings. Prisma validation and client generation pass. Deployment and zero drift are explicitly pending PostgreSQL 16 CI; no local database setup was retried and no guard was altered.

## Public lifecycle compatibility

The M2 mutation inventory admits only the additive `createCharacterSignatureManeuver` and `updateCharacterSignatureManeuverDraft` commands. The database export inventory adds the eight existing Maneuver operations: create, get, builder, update draft, validate, finalize, rebuild, retire. The M6-WO5 route inventory admits only the eight exact WO8 route paths already pinned by the WO8 gate.

Source review confirms the Maneuver repository delegates to the existing shared Signature repository with the explicit `MANEUVER` kind. It checks ownership, kind and CAS; retired content cannot be edited, ACTIVE content requires an explicit rebuild, and immutable revisions remain separate from drafts. The lifecycle inventory now also asserts retired/ACTIVE protections and the exact Maneuver delegation, and rejects canonical Entity/Version/Ruleset writes. No implementation lifecycle protection was removed. The inventory's real database execution remains pending fresh CI.

## All twelve Studio failures

| Run #252 failure | Narrow correction and preserved boundary |
| --- | --- |
| M2 mutation inventory | Add only the two lifecycle-governed commands above. |
| WO1 Maneuver catalog identity audit | Recognize the exact pinned `bundle.definitions.filter` query for MANEUVER_TARGETING/SINGLE_TARGET and exact Weapon/Attack reference projections. No whole-file exclusion. |
| WO1 Maneuver reader identity/math audit | The same exact reference contexts; replace the numeric sort subtraction with an equivalent comparison comparator. |
| WO11 attack-floor contract | Emit the historical attack-floor modifier verbatim on the historical branch; only the already versioned policy selects the protected Action floor. The legacy assertion stays intact. |
| WO11 attachment-graph contract | Assert the extracted selector's actual call plus all three explicit Targeting, Action-specific and attached-Effect scopes; prohibit broadcast. |
| WO2 construction hidden arithmetic | Count distinct Action/group object identities with a Set; Powerful Blow members share one group. Capacity is still evaluated by the existing M4 requirement. |
| WO2 reader hidden arithmetic | Replace subtraction comparators, preserving numeric structural order. |
| WO2 governed candidate rank collapse | Build the same authored maps from explicit rank-identity benefit records, never rank ordinals. |
| WO2 Performance reader rank ordering | Validate exact rank membership and approved benefits without alphabetical rank sorting or ordinal conversion. |
| WO3 resource-name branch | Reuse the existing `ofCurrency` helper for Foundation AP contributions. |
| WO8 compiler contract | Resolved by the structural Action-block count; no frontend calculation added. |
| WO5 presentation route inventory | Add the exact eight registered WO8 API paths; no presentation or UI mechanics are added. |

WO1's additive AST recognition is limited to the two reviewed Maneuver adapter paths and exact read-only query/reference contexts: exact-identity comparisons, parser reference reads, Weapon/Attack pairs, and explicitly typed ManeuverActionSource projections. The generic weapon-presence, shape-implies-mechanics and hidden-math prohibitions remain. New permanent tests prove these adapters pass while injected kind inference, shape branching and arithmetic still fail; an identical projection in an unreviewed file still fails.

The scoped-Trait negative control now mutates the extracted selector call into the same prohibited broadcast. Its purpose, failure requirement and the full 26-control inventory are unchanged. All 26 controls caught their prohibited changes, with the harness verifying byte-for-byte restoration and an unchanged working tree. Historical cost outputs and goldens were not edited.

## Canonical catalog fixture

Regenerated using the existing M6-WO1 catalog test with `M6_WO1_WRITE_FIXTURE=1`, then verified without write mode. The entire fixture diff is the additive `ACTION_SPECIFIC` value after `RESOLUTION` in `traitScopes`. All prior entries and ordering remain compatible; no canonical Release or Definition was republished.

## Focused local verification

| Check | Result |
| --- | --- |
| Prisma validate / client generation | Passed / passed (7.10.0) |
| Model/rules/game/import/database build | Passed |
| Nine affected Studio static suites | 696 passed |
| Domain, WO7/M5 characterization, Maneuver goldens, bridge and Signature Spell regressions | 405 passed across seven suites |
| Live authoring-catalog fixture, without regeneration | 50 passed |
| Historical M5-WO11 mutation controls | 26 caught; 14 green baseline runs; all bytes restored |
| Architecture import/circular-dependency checks | Passed |
| Game/database/Studio lint and typecheck | Passed |
| Final Amendment test / WO7-WO8 registry guards after the test annotation | 13 passed / 46 passed |

The new Performance test proves rank-token order is irrelevant and rejects incorrect preparation and MP benefits. Its initial typecheck found that the deliberately invalid MP value was narrower than the input mutation type; an explicit Record input annotation corrects that test only. Final amendment, registry, lint and typecheck evidence is recorded in the adjacent evidence JSON. The two initially remaining static findings were exact parser reference reads; their reviewed AST context was added before the passing 696-test run. No infrastructure blocker was retried.

## Preserved PostgreSQL 16 evidence from run #252

- [Database shard 1](https://github.com/prowessttrpg-png/prowess-studio/actions/runs/41907646580/job/126846486739): **294 tests / 30 files passed**, including all **nine WO8 lifecycle/concurrency tests** and **one WO8 historical migration-compatibility test**. Coverage includes incomplete drafts, append-only revisions, ownership/kind constraints, CAS and forged inputs, shared Spell/Maneuver last-slot concurrency, equipment re-evaluation, global capacities, and exact historical Release pricing. Migration compatibility upgrades finalized WO7 Spell history without rewriting its payload or pointer and preserves immutability.
- [Database shard 2](https://github.com/prowessttrpg-png/prowess-studio/actions/runs/41907646580/job/126846486867): 321 passed, one failed: the additive public export inventory corrected here.
- [Prisma/API job](https://github.com/prowessttrpg-png/prowess-studio/actions/runs/41907646580/job/126846486806): validation, generation and migration deployment passed in that run; drift failed on the two names above. API tests and later guard checks were skipped, so they are **not** represented as passing.

The adjacent machine-readable evidence records original log hashes, exact passing summary lines, focused verification hashes, and pending acceptance checks. Prior passing results describe the original published tree and are preserved as prior evidence, not substituted for post-correction PostgreSQL verification.

## Exact corrective changed-file inventory

All entries retain regular-file mode `100644`. No migration, historical golden, frozen baseline, canonical content file, lockfile, workflow, production credential, or application UI file changes.

1. `apps/studio/tests/unit/fixtures/m6-wo1-catalog.json`
2. `apps/studio/tests/unit/m2-final-static.test.ts`
3. `apps/studio/tests/unit/m5-wo1-audit-helpers.ts`
4. `apps/studio/tests/unit/m5-wo11-static.test.ts`
5. `apps/studio/tests/unit/m6-wo5-static.test.ts`
6. `apps/studio/tests/unit/m6-wo8-static.test.ts`
7. `docs/architecture/m6-approved-m5-changes.json` (exact WO8 file digests only; approved path sets unchanged)
8. `docs/reports/m6-wo8-phase-b-ci-remediation.md`
9. `docs/reports/m6-wo8-phase-b-ci-evidence.json`
10. `packages/prowess-db/prisma/schema.prisma`
11. `packages/prowess-db/tests/integration/entity-version-lifecycle.test.ts`
12. `packages/prowess-game/src/ability/compile.ts`
13. `packages/prowess-game/src/ability/maneuver-cost.ts`
14. `packages/prowess-game/src/character/signature-maneuver.ts`
15. `packages/prowess-game/src/content-updates/m6-wo8-amendment-a.ts`
16. `packages/prowess-game/src/definition/duration-condition-payload.ts`
17. `packages/prowess-game/src/m6-wo8-amendment.test.ts`
18. `scripts/m5-wo11-negative-controls.mjs`

## Next boundary

After exact-tree publication, request one fresh [Prowess Studio CI run](https://github.com/prowessttrpg-png/prowess-studio/actions/workflows/ci.yml) on `m6-wo8`, normal settings (`certification=false`). The connected integration exposes no workflow-dispatch operation; rerunning run #252 would test its old commit and is not an acceptable substitute. No additional workflow was triggered during this remediation.

Require migration deployment and zero drift, the lifecycle inventory, Maneuver APIs, and the existing PostgreSQL lifecycle/concurrency/history suites to pass on the new remote commit before accepting Phase B. Stop for the manual trigger. Phase C, full final certification and Phase D completion are outside this task.
