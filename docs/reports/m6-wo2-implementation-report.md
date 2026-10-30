# M6-WO2 Implementation Report — Compendium Rules Reference & Structured Browsing

Branch `m6-wo2`, base `799f1b2dcb2939184d4c8703cb06b0678bfa5482` (main after PR #62). Local implementation and local
verification only — nothing pushed, no PR, no merge. Architecture: `docs/architecture/m6-compendium-rules-reference.md`.
Invariants: M6-I011 – M6-I020 (`docs/architecture/m6-invariants.md`).

## 1. Test Totals

Full local verification (`db:generate`, package builds, lint, architecture check, typecheck, gate inventory, harness
self-test, every unit suite, both integration suites against a freshly migrated `prowess_studio_test`, production build,
full Playwright run) — every step exit 0.

| Suite | Before (base) | After | Added by M6-WO2 |
| --- | ---: | ---: | ---: |
| `@prowess/studio` unit | 3013 | 3072 (87 files) | 59 (static 25, UI 29, lib 5) |
| `@prowess/studio` integration | 196 | 203 (31 files) | 7 |
| `@prowess/db` integration | 532 | 542 (45 files) | 10 |
| `@prowess/db` unit | 143 | 143 | — |
| `@prowess/game` / `rules` / `model` / `import` / `ui` unit | 937 / 659 / 513 / 128 / 21 | unchanged | — |
| Playwright e2e | 46 | 47 | 1 |

All 16 negative / mutation control scripts: 316 controls caught and restored (M6-WO2: 18).

One pre-existing e2e test (`compendium.spec.ts` pagination regression) was flaky once in a targeted local run (shared
database, parallel workers) and passed on retry; it passed in the full run. M6-WO2 does not touch it.

## 2. Architecture Gate

`apps/studio/tests/unit/m6-wo2-static.test.ts` — "M6-WO2 — Compendium Rules Reference & Structured Browsing", a named
step of the consolidated CI (`controls-2` job), registered in `scripts/ci/gates.json` (34 gates, 316 controls). It pins:

- layering (no DB / Prisma / repository / M5 / M4 / authoring-client import in the UI; GET-only client; the only
  governance import is `listAllRulesets`; no browser storage);
- GET-only thin routes equal to the `M6-WO2` route registry entry;
- a write-free read module (no create / update / delete / raw execute / transaction / publication / lifecycle call);
- Release scoping (every pinned-entry query keyed by `me.manifest_id`, the exact pinned `entity_version_id`, no
  inheritance, the pin read from `selectManifestEntry`, the latest revision used once as an indicator only, no M5
  validation or materialization deciding membership, foreign Releases refused);
- the explicit Latest Release resolver (one `getLatestRulesetRelease` call; the UI resolves only on click and navigates
  to the exact Release URL);
- M2 reuse for verification and comparison; no hashing in the UI;
- one descriptor set (`presentationDescriptorFor` over the WO1 descriptors), no kind literals in the UI, raw JSON only
  under Developer details, references shown as authored next to the pin, Release-keeping URLs, terminology;
- frozen M4 / M5 / schema files (`docs/architecture/m6-wo2-baseline.json`, 216 files), the one documented M2 scan
  exclusion, the unchanged top-bar selector, Structured Canon conflicts M5-SC-042…053 unresolved and M5-SC-054
  resolved, the three-choice `/compendium` landing;
- invariants, documentation and CI wiring.

## 3. Controls

`scripts/m6-wo2-negative-controls.mjs` (shared CLOSEOUT-03 harness; guard = M6-WO2 static + UI + lib suites). Each
mutation of real source was caught and restored byte-for-byte:

1. import the DB into the Rules Reference UI · 2. show the latest revision instead of the pin · 3. drop the
Release-manifest scope from entry queries · 4. reconstruct manifest inheritance · 5. accept a Release of another Ruleset ·
6. compute the manifest hash in the browser · 7. silence the integrity warning · 8. auto-select the Latest Release on
load · 9. drop the Release from entry links · 10. rewrite the authored reference to the pinned revision · 11. hide the
version mismatch · 12. infer the Definition kind from the display name · 13. a hand-written second Definition catalog ·
14. raw JSON as the primary mechanical view · 15. stop sending the kind facet to the server · 16. a write in the read
module · 17. a POST handler on a reference route · 18. a schema change.

## 4. What Was Built

- **@prowess/db `compendium-reference/`** (read-only): `listReferenceReleases`, `resolveLatestReferenceRelease`,
  `getReferenceRelease` (+ M2 manifest verification, composition size), `listReferenceEntries` (server facets, paging,
  deterministic order), `getReferenceEntry` (exact pin, latest-revision indicator, declared Definition verbatim, catalog
  kind, schema support flag, Keywords, exact references authored-vs-pinned, Referenced By ≤ 25, relationships with
  in-Release pins, Related by Keyword ≤ 12, the pinned revision's own sources), `compareReferenceReleases` (M2 diff,
  paged, typed, display identity).
- **Six GET routes** under `/api/compendium-reference/rulesets/:rulesetId/…` (registry key `M6-WO2`).
- **Error vocabulary** `COMPENDIUM_REFERENCE_ERROR_CODES` (INVALID_INPUT 400, RELEASE_NOT_IN_RULESET 404,
  ENTITY_NOT_IN_RELEASE 404).
- **UI** `app/compendium/rulesets/**`: Ruleset chooser, Release History with View Latest Release and the no-Release
  state, Release browser (metadata, integrity, selector, compare-with, facets incl. Keyword picker by id, cards, paging),
  entry page (common header, pin indicator, Rules Text vs Mechanical Data, dedicated / generic presenters, references,
  Referenced By, relationships, Related by Keyword, Sources & Provenance, Open in Compendium Admin), Release
  Comparison. Loading, empty, not-in-Release and error states are distinct.
- **Descriptors** `presentationDescriptorFor` (read-only presentation over the WO1 descriptors, plus a version-2
  Affinity presentation; the WO1 editor's `descriptorFor` is unchanged).
- **`/compendium` landing**: Rules Reference, Entity Library, Compendium Admin.
- **Navigation helper** `canonManagerRulesetHref`.

## 5. Permanent Tests Updated (and why)

| Test | Change |
| --- | --- |
| `m6-wo1-static` | Registry: `M6-WO1` stays first and exact; invariants: WO1 checks its own ten. |
| `m2-api-static` | `compendium-reference` excluded from the M2 route inventory (registered in the M6 registry). |
| `m2-final-static` | Two reviewed latest-style reads added to the allowlist: the explicit Latest Release resolver and the pinned-vs-latest indicator (`selectLatestRevisionNumber`). |
| `m2-ruleset-static`, `m2-ruleset-release-static` | Exactly `app/compendium/rulesets` (read-only Rules Reference) excluded from the governance-UI file-name scan, documented; pinned by M6-WO2. |
| `m1-audit-static` | 31st error vocabulary (`COMPENDIUM_REFERENCE_ERROR_CODES`). |
| `entity-version-lifecycle` | Seven read-only exports appended to the public-surface allowlist. |
| `ci-gate-inventory` | 316 controls across 16 scripts. |

## 6. Boundaries Kept (§108)

No Prisma schema change, no migration, no persistent reverse-reference table, no M4 change, no M5 change, no M2
publication change, no active / current Release pointer, no Character / Builder / combat work, no Structured Canon
conflict resolved, no mechanics reconstructed from prose. No STOP condition was reached.

## 7. Known Limitations

- Prisma's schema engine cannot be downloaded in this sandbox, so `prisma migrate diff` / drift checks did not run
  locally (the schema is byte-identical to the base — pinned by the gate); CI runs them.
- Referenced By / Related by Keyword are bounded lists; Entity-level Keyword assignments are not used for Release
  browsing (they are not revision-pinned); sort is lower-case byte order, not locale collation; no caching.
