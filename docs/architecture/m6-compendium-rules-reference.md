# M6-WO2 — Compendium Rules Reference & Structured Browsing

Status: implemented locally on `m6-wo2` (base `799f1b2`). Invariants: M6-I011 – M6-I020 (`m6-invariants.md`).
Permanent gate: `apps/studio/tests/unit/m6-wo2-static.test.ts` with mutation controls `scripts/m6-wo2-negative-controls.mjs`.

## 1. Rules Reference Architecture

The Compendium now has three entry points, offered on the `/compendium` landing:

| Surface | Question it answers | Scope |
| --- | --- | --- |
| **Rules Reference** (`/compendium/rulesets/…`) — new | "What are the rules in *this* Release?" | One Ruleset → one exact Release → the revisions it pins |
| **Entity Library** (`/compendium`, `/compendium/entities/:id`) — M1 | "What revisions exist for this Entity?" | Every Entity, every revision, no Release |
| **Compendium Admin** (`/compendium/admin`) — M6-WO1 | "How do I author or revise content?" | Drafts and revisions; hands off to the Canon Manager |

The Rules Reference is read-only. It is layered like every Studio surface:

```
app/compendium/rulesets/**  (client pages, GET-only reference-client)
        │  HTTP GET
app/api/compendium-reference/**  (thin route adapters, strictQuery, central error mapping)
        │
@prowess/db  compendium-reference/{service,repository}.ts  (bounded reads; M2 services reused)
        │
PostgreSQL  ruleset_releases · ruleset_manifest_entries · entities · entity_versions · …
```

The frontend imports no `@prowess/db`, Prisma, repository, `@prowess/game` or `@prowess/rules`
(`scripts/check-architecture.mjs` Compendium rule plus the M6-WO2 gate).

## 2. Release Scoping

- Membership is **exactly** the Release manifest's entries (`ruleset_manifest_entries.manifest_id = release.manifest_id`).
  Every pinned-entry SQL query joins the pinned `entity_version_id` (and its `entity_id`) — the exact revision.
- A Release manifest is flattened and parentless (M2-WO8), so no inheritance is reconstructed.
- A Latest Revision **never** substitutes for a pin. The Entity's highest revision number is read only to show the
  indicator *"This Release uses Revision 3. Latest Entity Revision is 5."* with a *View Revision History* link into the
  Entity Library.
- Content is never re-validated to decide membership; historical schema versions are returned verbatim (never migrated).
- A Release that belongs to another Ruleset than the URL's is `COMPENDIUM_REFERENCE.RELEASE_NOT_IN_RULESET` (404); an
  Entity the Release does not pin is `COMPENDIUM_REFERENCE.ENTITY_NOT_IN_RELEASE` (404). Neither falls back.
- **Latest Release** is never stored. *View Latest Release* is an explicit button that asks the server
  (`resolveLatestReferenceRelease` → M2 `getLatestRulesetRelease`) for the highest-numbered Release and navigates to that
  Release's exact URL; the resulting page is pinned to it. A Ruleset with no Release shows an explicit "No Releases yet"
  state linking to the Canon Manager and the Entity Library.
- Terminology: "Latest Release", "Release N — label", "Pinned Revision N". No "Current Rule / Release / Canon" or "Active
  Version" wording (`compendium-terminology.test.ts` and the M6-WO2 gate).

## 3. Routes

| UI route | Content |
| --- | --- |
| `/compendium/rulesets` | Choose a Ruleset (all pages of Rulesets) |
| `/compendium/rulesets/:rulesetId` | Release History (newest first), View Latest Release, or the no-Release state |
| `/compendium/rulesets/:rulesetId/releases/:releaseId` | Release metadata, integrity, selector, compare, faceted entries |
| `…/releases/:releaseId/entities/:entityId` | One Entity as this Release pins it |
| `…/releases/:releaseId/compare/:otherReleaseId` | Release Comparison |

Every URL carries the exact Ruleset and Release ids; links between entries, Referenced By, relationships, related
content and comparisons keep the Release. Filters and paging are URL query state (`search`, `kind`, `family`, `branch`,
`entityType`, `keywordId`, `page`).

The UI lives under `app/compendium/rulesets/`. The M2 file-name scans (`m2-ruleset-static`, `m2-ruleset-release-static`)
forbid `ruleset` / `release` names outside the governance workspace; they now exclude exactly this one read-only
directory, with a documented comment, and the M6-WO2 gate pins that the exclusion is that single path and that nothing
in it governs or publishes.

The top-bar Ruleset selector is unchanged: a viewing control over every page of Rulesets (the WO1 pagination fix) that
navigates to the Canon Manager.

## 4. Read API

All routes are `GET` only, `strictQuery`, UUID-checked, and map errors centrally (`src/api/errors.ts`).

| Route | Service |
| --- | --- |
| `GET /api/compendium-reference/rulesets/:rulesetId/releases` | `listReferenceReleases` → M2 `listRulesetReleases` |
| `GET …/rulesets/:rulesetId/latest-release` | `resolveLatestReferenceRelease` → M2 `getLatestRulesetRelease` |
| `GET …/releases/:releaseId` | `getReferenceRelease` (+ M2 `verifyRulesetReleaseManifestHash`) |
| `GET …/releases/:releaseId/entities` | `listReferenceEntries` (facets, paging) |
| `GET …/releases/:releaseId/entities/:entityId` | `getReferenceEntry` |
| `GET …/releases/:releaseId/compare/:otherReleaseId` | `compareReferenceReleases` → M2 `compareRulesetReleases` |

Facets are server-side: `kind` (a catalog Definition kind or `GENERIC` for content with no Definition), `family` and
`branch` (expanded to kinds through the one M5-derived authoring catalog), `entityType`, `keywordId` (a Version-level
assignment on the pinned revision, or the payload's structured `keywords`), and `search` (pinned display name, canonical
key or alias). Order: display name (case-insensitive, then exact bytes), canonical key, Entity id. Page size ≤ 100.

Caching: none. Responses are computed per request; nothing is cached by "latest". (A cache keyed by the immutable
`releaseId` would be permitted; it is not needed yet.)

New error vocabulary: `COMPENDIUM_REFERENCE_ERROR_CODES` (`INVALID_INPUT` 400, `RELEASE_NOT_IN_RULESET` 404,
`ENTITY_NOT_IN_RELEASE` 404).

## 5. Structured Presentation

- **Common header:** name, Definition kind (or *Generic / non-Prowess Entity*), family / branch, EntityType, status,
  *Pinned Revision N*, canonical key, Release, Ruleset, Keywords (structured payload Keywords resolved against the
  vocabulary, plus Version-level assignments).
- **Rules Text** is its own section, visually separate from **Mechanical Data**; nothing is derived from prose.
- **Dedicated presenters** reuse the WO1 authoring descriptors through `presentationDescriptorFor` — the same
  shared-contract descriptor objects the editor uses (Targeting, Effect, Trait, Duration, Ability Condition,
  Foundation), so Spell / Maneuver Targeting, Effect, Trait, Duration, Casting / Maneuver Condition and Maneuver
  Foundation present consistently, plus Affinity (version 1 and a read-only version-2 presentation). There is no second
  catalog.
- **Generic presenter** for every other kind, for a schema version the catalog does not support for the kind (stated,
  never migrated), and for generic content (no kind is inferred).
- Values are shown exactly: tokens as readable words beside the exact token, authored cost contributions as a table with
  "the final cost is computed by the Rules Engine — never on this page", formulas as their authored expression marked
  *not evaluated here*, requirement groups as nested *All / Any / None of* lists. Unresolved Structured Canon conflicts
  (M5-SC-042…053) stay unresolved; M5-SC-054 stays resolved — the reference shows content, it resolves nothing.
- Raw JSON appears only under the closed *Developer details* disclosure.
- Cards in lists are computed at read time from the pinned revision; there is no stored card data.
- *Open in Compendium Admin* hands off to authoring; the Rules Reference has no edit controls.

## 6. References

- Every exact Definition reference (`{entityId, entityVersionId, canonicalKey, definitionKind, systemFamily}`) in the
  pinned payload is reported with its payload path, the revision it **authored**, and the revision **this Release pins**
  for that Entity: a match, a *Version mismatch* (with a link to the existing revision comparison), or *Referenced
  Definition is not part of this Release*. The authored reference is never rewritten. References render both inline in
  the structured data and in the *Referenced Definitions* list.
- **Referenced By** (bounded to 25, within the Release) uses a JSON path query over the pinned revisions — no
  reverse-reference table.
- **Relationships** are the stored Entity-level relationships, outgoing and incoming as stored; no inverse is inferred;
  counterparts link into the same Release when pinned there.
- **Related by Keyword** (bounded to 12) is labelled as such and is not a rules relationship.
- **Sources & Provenance** lists the pinned revision's own source references (never another revision's); source
  authority describes provenance and never overrides the pin.

## 7. Comparison

Release Comparison reuses M2 `compareRulesetReleases` unchanged: ADDED_ENTITY, REMOVED_ENTITY and CHANGED_VERSION
entries plus the unchanged count, both Releases required to belong to the URL's Ruleset, paged and optionally filtered by
type, enriched only with display identity. A CHANGED_VERSION links to the Entity Library's existing revision comparison
(`/compendium/entities/:id?compareA=&compareB=`). No semantic diff is computed. The Release page also lists the Release
History through the selector and the Ruleset page.

## 8. Boundaries

M6-WO2 changes no Prisma schema or migration, no M4 source, no M5 source (pinned by `docs/architecture/m6-wo2-baseline.json`),
no M2 publication behaviour, and adds no active / current Release pointer, Character, Builder or combat work. The reference
read module performs no write of any kind (gate + database fingerprints in the integration suites).

Permanent tests updated (documented in the implementation report): the M6 route registry (`M6-WO2` key), `m6-wo1-static`
(registry and invariant scopes), `m2-api-static` (prefix exclusion), `m2-final-static` (two reviewed latest-style reads:
the explicit Latest Release resolver and the pinned-vs-latest indicator), `m2-ruleset-static` / `m2-ruleset-release-static`
(the one read-only directory exclusion), `m1-audit-static` (new error vocabulary), `entity-version-lifecycle` (read-only
exports), `ci-gate-inventory` (control count).

## 9. Known Limitations

- Referenced By and Related by Keyword are bounded lists, not exhaustive indexes; a truncation note is shown.
- The Keyword facet matches the pinned revision's Version-level assignments and its payload `keywords`; Entity-level
  Keyword assignments are not revision-pinned and are not used for Release browsing.
- Display-name sort is byte-order after lower-casing (deterministic across environments, not locale-aware collation).
- The `/compendium` landing keeps the Entity Library on the same page (below the three choices) so existing Entity Library
  URLs and tests are unchanged.
- No caching; every view queries the database.
