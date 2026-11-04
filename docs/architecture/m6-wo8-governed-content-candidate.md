# WO8 Amendment A — governed content candidate

Status: prepared for separate content governance; no canonical Release has been edited or published.

The runtime requires the Character's exact Release to contain the approved `M6-WO8-A` Maneuver cost-policy extension. Performance additionally requires an exact structured Maneuver Condition referring to that Release's actual Performance Skill Definition. The authoring helper in `packages/prowess-game/src/content-updates/m6-wo8-amendment-a.ts` is a candidate generator only, excluded from runtime imports and package exports.

Before a governed content proposal can be published, its reviewer must select the exact target Ruleset/Release and Performance Skill Entity/EntityVersion pair. No production identity is guessed here. The candidate describes:

| Field | Approved value |
| --- | --- |
| Cost extension | `version: M6-WO8-A`, `floor: COMMITTED_ACTION_AP` |
| Condition family | Maneuver only |
| Selection | Explicit, obligatory |
| Ordinary Condition slot | Exempt, `PERFORMANCE_OBLIGATORY` |
| Actual eligible Skill ranks | Trained, Expert, Master |
| MP reduction | 2, 4, 6 respectively; once per complete Maneuver |
| Separate preparation AP | 1, 1, 0 respectively |
| Automatic AP reduction | None |
| Runtime requirement | Performance established before affected Maneuver activation |

Any future authorized AP reduction must be explicitly authored in the Condition contract and passes through the existing 3 AP Condition cap and new protected Action floor. The prepared candidate contains no such AP contribution.

Use existing authoring validation, exact reference validation, review, ChangeSet, manifest, and Release publication workflows. A new Release may pin the updated construction policy and Condition; historical Releases must keep their original Definitions and calculations. Existing Characters remain pinned to their original Release. Missing Movement, Defense, or Interaction Foundation content requires its own explicit designer-authored prices and contracts, rather than deriving production prices from the WO8 test fixtures.

Test fixture content is isolated under `src/testing/` and is never offered as a runtime fallback. The builder reports missing policy, missing structured Performance, missing nonattack categories, and unsupported WO6 bindings directly from the pinned Release catalog.
