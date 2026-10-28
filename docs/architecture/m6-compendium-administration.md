# M6 — Compendium Administration (M6-WO1)

Related: `m6-invariants.md` / `m6-invariants.json` (M6-I001–I010) · `m6-api-routes.json` (route registry) ·
`m6-wo1-baseline.json` (frozen M4 / schema / M5 baseline) · `docs/reports/m6-wo1-implementation-report.md`.

## 1. Authoring Architecture

M6-WO1 turns the read-only Compendium into the first authoring workspace **without a second content system**:

```
Compendium Admin UI (apps/studio/app/compendium/admin)       presentation + authoring descriptors only
        │  HTTP (shared Studio transport)
        ▼
/api/compendium-authoring/* + existing M1 / M2 routes          thin adapters: request SHAPE only
        │
        ▼
@prowess/db  compendium-authoring service                      composes existing M1 / M2 services
        │                         │
        │                         └─► @prowess/game validateStoredProwessDefinition   (the M5 contract)
        ▼
Entity / EntityVersion / Keywords / Relationships / Sources / ChangeSets   (existing tables — no migration)
```

- Studio never imports `@prowess/game` (M5-I017). The catalog, the M5 vocabularies and the validator reach the UI only
  through `@prowess/db` and the HTTP API (M6-I002).
- "Admin" is a designer-facing workspace, **not** an authorization system (§5). There are still no users, roles or
  permissions; UI visibility is not access control.
- **Authoring descriptors** (`app/compendium/admin/_lib/descriptors.ts`) say how to render the structured fields of each
  M5 *shared contract* — label, group, input type, the NAME of the catalog vocabulary that supplies a select's options,
  required / optional, help, collection behavior, where exact references go. They hold no option values, numbers,
  formulas or legality rules. Opaque M5 sub-objects (`parameters`, `rules`, `geometry`, `data`, `tradeoff`) are edited with
  a typed authored-data editor (text / number / true-false / list / group / exact Definition reference) — never a raw
  JSON box. Raw JSON is read-only inspection plus an explicitly enabled developer edit that cannot change the kind.
- Kinds without a dedicated descriptor (core, runtime, Affinity v2, authored Spell / Maneuver Definitions …) use the
  generic structured editor over the whole payload; M5 still validates every field.

## 2. Definition Storage

Unchanged from M5 (§6, M6-I001): `EntityVersion.structuredData.prowessDefinition = { schemaVersion, systemFamily,
definitionKind, payload, legacyTerms? }`. The Entity owns identity (`id`, `entityType`, `canonicalKey`); revisions own
content. The storage EntityType is taken from the M5 catalog (`allowedEntityTypes`), never chosen by guesswork. The
Definition kind is part of the Entity's semantic identity: a revision cannot change it (`DEFINITION_KIND_CHANGE`), and an
Entity without a stored Definition is **generic content** — no kind is inferred from names, text or EntityType, and
authoring does not attach one (M6-I010). Other `structuredData` keys of a Draft are preserved on save. No table, column,
validity flag or migration was added (§62, §80).

## 3. Lifecycle

- **Create** (`POST /definitions`): every input is checked before the first write (kind, EntityType, Definition storability,
  canonical key format and uniqueness, display name, change type, Keyword and SourceDocument ids); then Entity →
  Revision 1 `DRAFT` → Keyword assignments → provenance. The M1 services are separate writes; an infrastructure failure
  after the Entity exists is reported as `COMPENDIUM_AUTHORING.PARTIAL_CREATE` naming the Entity (never silent).
- **Save Draft** (`PUT /entity-versions/:id`): edits THIS Draft in place through `updateDraftEntityVersion` (M1's atomic
  `status = DRAFT` guard); never creates a revision; no autosave.
- **Create New Revision** (`POST /entities/:id/revisions`): same Entity, M1-allocated revision number, `DRAFT`, parent =
  base, content and revision-level Keywords copied; the base is untouched (M6-I008).
- Immutable revisions (any non-DRAFT status) are read-only in the UI and refused by the server (`ENTITY_VERSION.IMMUTABLE`).
- **Submit for review** (`DRAFT → IN_REVIEW`) is offered only for a Definition that passes validation; **Return to Draft**
  uses the existing M1 status route. Approval and later states stay outside authoring.
- No Entity deletion (§44). Aliases, Keyword assignments, relationships and source references keep their M1 removal
  semantics.

## 4. Validation

`validateStoredProwessDefinition({ entityType, structuredData })` is the approved §81 addition to `@prowess/game`: the
same readers the materializer runs (stored record and EntityType rule, family / kind / schemaVersion head, the kind's
payload contract, legacy terminology), minus identity and Ruleset provenance. It was built by extracting the content half
of the existing envelope reader, so there is one validator. Parity with `readStoredProwessDefinition` is tested over every
fixture Definition (M6-I003).

Around it, the authoring service only:

- classifies **HARD** M5 codes (unsafe plain data, unknown family / kind, family-kind mismatch, unsupported or reserved
  schema version, EntityType mismatch, a stored blob claiming identity) — such content is refused even as a Draft
  (`DEFINITION_REFUSED`); payload incompleteness is a reported issue, so a Draft may be incomplete (§16);
- checks references read-only: payload Keywords must be existing Keyword Definitions (`UNKNOWN_KEYWORD`; deprecated →
  warning) and every exact five-field Definition reference must match the named EntityVersion's Entity, canonical key and
  stored kind (`INVALID_DEFINITION_REFERENCE`, M6-I006 / M6-I009).

Results are `{ status: PASS | FAIL, issues[{ code, severity, path, message, definitionKind, component, source }],
normalized, refused }`. Validation is on demand (unsaved candidate or stored revision), side-effect free and never stored
(M6-I007). A Ruleset proposal and review submission require PASS.

## 5. Compendium Routes

| Route | Purpose |
| --- | --- |
| `/compendium` | Existing read-only reference browser (unchanged; now links to Compendium Admin) |
| `/compendium/admin` | Authoring dashboard: Display Name, Canonical Key, Entity Type, Definition Kind (or Generic), Latest Revision, lifecycle status, structural check, last update; status tabs, search, type filter |
| `/compendium/admin/new` | Create Definition (family → kind → identity → description → structured Definition → Keywords → provenance → validate → create) |
| `/compendium/admin/entities/:entityId` | Identity, revisions / history / compare links, Create New Revision, aliases, Entity-level Keywords, relationships |
| `/compendium/admin/entities/:entityId/revisions/:versionId` | Revision content, Prowess Definition, revision Keywords, sources, validation, preview, review and Canon hand-off, history |

HTTP API (all thin adapters; registry `m6-api-routes.json`):

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/api/compendium-authoring/catalog` | Projection of `PROWESS_DEFINITION_KINDS` + M5 vocabularies + legacy pairs |
| POST | `/api/compendium-authoring/validate` | Unsaved candidate; no persistence |
| GET / POST | `/api/compendium-authoring/definitions` | Authoring list / Create Definition |
| PUT | `/api/compendium-authoring/entity-versions/:versionId` | Save Draft (`expectedUpdatedAt` required) |
| GET | `/api/compendium-authoring/entity-versions/:versionId/validation` | Validate the stored revision |
| POST | `/api/compendium-authoring/entity-versions/:versionId/submit-review` | DRAFT → IN_REVIEW (PASS required) |
| POST | `/api/compendium-authoring/entity-versions/:versionId/change-set-proposals` | M2 hand-off (PASS required) |
| POST | `/api/compendium-authoring/entities/:entityId/revisions` | Create New Revision |
| GET | `/api/compendium-authoring/definition-references` | Bounded exact-reference search |
| GET | `/api/compendium-authoring/keywords` | Bounded Keyword search |

No route accepts a status, revision number, parent or identity field. Errors use the existing envelope; the new
`COMPENDIUM_AUTHORING.*` codes are mapped in `src/api/errors.ts` (400 input, 409 state conflicts, explicit 500 for
`PARTIAL_CREATE`).

## 6. M5 Bridge

Proven twice: the API worked example (`spell.effect.m6_test_force_push`) is authored, approved, pinned by a Manifest and
materialized through `materializeProwessDefinitionsFromManifest` to exactly the authored, M5-normalized payload; and the
database suite authors **every reference-free Ability-component Definition of the certified M5 fixtures** (Targeting,
Effect, Trait, Duration, Ability Condition) through the authoring service and materializes them back equal to the
certified Definitions. Authoring therefore produces real Rules Engine content, not just JSON.

## 7. M2 Bridge

There is no second publication path (M6-I005). The hand-off requires an explicitly chosen Ruleset (the top-bar selector
remains a viewing control) and optionally an explicitly chosen target Manifest; it calls M2's own `createChangeSet` with
one exact `PIN_ENTITY_VERSION` operation and returns an ordinary DRAFT ChangeSet, linked to its Canon Manager page.
Review, approval, Manifests and Releases continue there. Tests prove the proposal appears in the M2 list and that no
Manifest, Release or EntityVersion changes.

**Ruleset selector (§35).** The top-bar selector listed only the first 100 Rulesets. The fix was entirely within the
selector's query: `listAllRulesets()` follows the API's pagination to the last page. The selector still only navigates.

## 8. Concurrency, Accessibility, Responsiveness

- Save sends the Draft's `updatedAt`; a different stored value is refused (`STALE_REVISION`, nothing overwritten) and the
  UI offers an explicit reload. Gap (documented, not hidden): the comparison and M1's atomic DRAFT update are two
  statements, so two saves within the same instant could both pass the check; closing it needs an `updatedAt` predicate
  in M1's conditional update (a repository change for a later WO).
- Real labels, fieldsets with legends, `aria-invalid` + `aria-describedby` field errors, a focusable validation summary
  (focus moves there after a failed validation) with links that focus the offending field, text status labels.
- Sections stack vertically below 900 px; JSON inspection scrolls internally; no horizontal page scroll at 390 px.
- Dirty state: "Saved Draft" / "Unsaved changes"; leaving the page or following an in-app link while dirty asks first.

## 9. Known Limitations

- Concurrency window described in §8.
- Creation is staged over existing M1 services (pre-validated; `PARTIAL_CREATE` on infrastructure failure) rather than
  one database transaction.
- Deep typed M5 sub-contracts (e.g. `rules.targeting`, `rules.trait`, cost `data`) are edited through the typed
  authored-data editor, not bespoke forms; M5 validation reports their exact paths.
- The compatibility relation input suggests the M5 component contracts; the complete relation list is not part of the M5
  public surface, so other relations are typed and validated by M5.
- Dashboard "needs attention" is per page (structural check of the latest revision); there is no server-side kind or
  validity filter, because no validity is stored (§62).
- Source Documents are listed through the existing unpaginated M1 endpoint.
- Approval / Playtest / Canon lifecycle transitions remain outside authoring.
- Generic (non-Prowess) Entities can have revision content edited but no Definition attached.
