# Ruleset & Canon HTTP API (M2-WO9)

**Status: implemented; awaiting its first CI run.** M2-WO9 exposes the approved M2 service layer over
HTTP. It is **transport only**: no governance behavior is new, no schema changed (no migration), and
there is no new UI (M2-WO10), authentication, OpenAPI tooling, or `/v1/` prefix (Phase 1).

```
HTTP request → shape validation (src/api/m2) → ONE public @prowess/db service → domain result
             → serializeForApi → { data } / { data, pagination }      errors → toErrorResponse (central map)
```

Route handlers never import Prisma, the generated client, or any `repository.ts`, and never contain
domain logic. They do not compute version or release numbers, hash manifests, walk inheritance,
translate decisions, apply ChangeSets, select source authority, or map dispositions to statuses. The
`m2-api-static` audit pins the exact route inventory and enforces all of this; it was checked by
injecting a PATCH handler, a Prisma import, and inline arithmetic, and it failed on each.

## Conventions (unchanged from M1)

**Success envelopes.** `{ "data": … }` for a single result, `{ "data": [...], "pagination": { page,
pageSize, total, totalPages } }` for lists. JSON is camelCase, dates are ISO-8601 strings, UUIDs are
strings, enums are their exact controlled values, and `null` is explicit.

**Error envelope.** `{ "code", "message", "field", "details" }` with the status from the exhaustive
central `DomainError` → HTTP map:
- 404: an addressed resource is missing;
- 400: a referenced resource or the request shape is wrong;
- 409: a clash with stored state.

Anything unexpected becomes a generic **500** with no message, Prisma code, SQL, path, or stack
(tested by injecting such an error).

**Request shape** (400s from the shared M2 reader):
- `API.INVALID_BODY`: malformed JSON, a non-object body, a wrong JSON type, a missing required
  field, a malformed array, a value outside its controlled vocabulary (taken from `@prowess/model`,
  never redefined), or **any unknown key**. Unknown keys include forbidden ones such as `status`,
  `manifestVersion`, `policyVersion`, `releaseNumber`, `manifestHash`, `channel`, and `publishedAt`;
  they are rejected, never silently ignored.
- `API.INVALID_UUID`: a malformed path id.
- `API.INVALID_QUERY`: an unknown query parameter, a malformed UUID or enum filter, or bad pagination.

Semantic rules (ownership, lifecycle, staleness, …) stay in the services.

**Pagination.** `page` (default 1) and `pageSize` (default 25, max 100), as in M1. The M2 list
services return each Ruleset's bounded records in their documented order, so list routes page over
that ordered result rather than rewriting the services for HTTP. Nothing is re-sorted in a route.

**Commands.** `submit-review`, `approve`, `reject`, and `propose-change-set` are named POST commands.
Lifecycle commands accept no body or `{}`. There is **no** DELETE, PATCH, or PUT on any governance
resource, no generic status setter, no manifest entry editing, no conflict-status route, no
decision/release mutation, and no record-by-record source-authority route.

## Route matrix

| Verb | Route | Body / query | Success | Notable errors |
|---|---|---|---|---|
| POST | `/api/rulesets` | `canonicalKey, name, description?, channel, versionLabel?, parentRulesetId?` | 201 Ruleset (DRAFT) | 400 shape · RULESET.* |
| GET | `/api/rulesets` | `?status&channel&page&pageSize` | 200 list | 400 bad filter |
| GET | `/api/rulesets/:rulesetId` | — | 200 Ruleset | 404 RULESET.NOT_FOUND |
| POST | `/api/rulesets/:rulesetId/submit-review` | none / `{}` | 200 Ruleset (IN_REVIEW) | 409 RULESET.INVALID_STATUS_TRANSITION |
| POST | `/api/rulesets/:rulesetId/approve` | none / `{}` | 200 Ruleset (APPROVED) | 409 RULESET.INVALID_STATUS_TRANSITION |
| POST | `/api/rulesets/:rulesetId/manifests` | `parentManifestId?, entries[{entityId, entityVersionId}]` | 201 manifest + entries | RULESET_MANIFEST.* |
| GET | `/api/rulesets/:rulesetId/manifests` | pagination | 200 list (manifestVersion ASC) | 404 |
| GET | `/api/rulesets/:rulesetId/manifests/latest` | — | 200 manifest or `null` | 404 |
| GET | `/api/ruleset-manifests/:manifestId` | — | 200 exact manifest + own entries | 404 |
| GET | `/api/ruleset-manifests/:manifestId/effective` | — | 200 effective entries with provenance | 404 |
| GET | `/api/ruleset-manifests/:manifestId/resolve/:entityId` | — | 200 `{ resolution }` (may be `null`) | 404 |
| POST | `/api/rulesets/:rulesetId/canon-policies` | `name, description?, authorities[{sourceDocumentId, scopeKey, authorityStatus, rationale?}]` | 201 policy + records | CANON_POLICY.* / SOURCE_AUTHORITY.* |
| GET | `/api/rulesets/:rulesetId/canon-policies` | pagination | 200 list (policyVersion ASC) | 404 |
| GET | `/api/rulesets/:rulesetId/canon-policies/latest` | — | 200 policy or `null` | 404 |
| GET | `/api/canon-policies/:policyId` | — | 200 exact policy + records | 404 |
| GET | `/api/canon-policies/:policyId/source-authorities` | pagination | 200 exact records | 404 |
| GET | `/api/canon-policies/:policyId/source-authority/resolve` | `?sourceDocumentId&scopeKey` (both required) | 200 resolution (EXACT / GLOBAL_FALLBACK / UNRESOLVED) | 400 / 404 |
| POST | `/api/rulesets/:rulesetId/rule-conflicts` | `entityId, conflictType, severity, title, description?, candidates[{entityVersionId, sourceReferenceId?, label?, positionSummary?}]` | 201 conflict (OPEN) + candidates | RULE_CONFLICT.* |
| GET | `/api/rulesets/:rulesetId/rule-conflicts` | `?entityId&status&severity&conflictType` + pagination | 200 list | 400 / 404 |
| GET | `/api/rule-conflicts/:conflictId` | — | 200 conflict + ordered candidates (no winner) | 404 |
| POST | `/api/rule-conflicts/:conflictId/canon-decisions` | `canonPolicyId, decisionType, conflictDisposition, selectedCandidateIds[], resultEntityVersionId?, rationale` | 201 decision + selections | 409 CONFLICT_ALREADY_DECIDED · CANON_DECISION.* |
| GET | `/api/rule-conflicts/:conflictId/canon-decisions` | pagination | 200 list | 404 |
| GET | `/api/canon-decisions/:decisionId` | — | 200 decision + selections | 404 |
| GET | `/api/rulesets/:rulesetId/canon-decisions` | `?ruleConflictId&canonPolicyId&decisionType&conflictDisposition` + pagination | 200 list | 400 / 404 |
| POST | `/api/canon-decisions/:decisionId/propose-change-set` | `targetManifestId?, name, description?` | 201 DRAFT ChangeSet | CHANGE_SET.* |
| POST | `/api/rulesets/:rulesetId/change-sets` | `canonDecisionId?, name, description?, operations[{operationType, targetEntityId?, fromEntityVersionId?, toEntityVersionId?, targetManifestId?, description?}]` | 201 DRAFT ChangeSet | CHANGE_SET.* |
| GET | `/api/rulesets/:rulesetId/change-sets` | `?canonDecisionId&status` + pagination | 200 list | 400 / 404 |
| GET | `/api/change-sets/:changeSetId` | — | 200 snapshot + operations | 404 |
| GET | `/api/change-sets/:changeSetId/impact` | — | 200 impact report (`derivation: "LIVE"`) | 404 |
| POST | `/api/change-sets/:changeSetId/submit-review` | none / `{}` | 200 ChangeSet | 409 CHANGE_SET.INVALID_STATUS_TRANSITION |
| POST | `/api/change-sets/:changeSetId/approve` | none / `{}` | 200 ChangeSet | 409 |
| POST | `/api/change-sets/:changeSetId/reject` | none / `{}` | 200 ChangeSet | 409 |
| POST | `/api/rulesets/:rulesetId/releases` | `baseManifestId, canonPolicyId, changeSetId?, versionLabel, releaseNotes?` | 201 release + composition | 409 STALE_CHANGE_SET / UNRESOLVED_CREATE_OPERATION / VERSION_LABEL_CONFLICT / CHANGE_SET_ALREADY_PUBLISHED / RELEASE_CONFLICT / RULESET_NOT_PUBLISHABLE / MUTABLE_VERSION_PINNED (M2-WO12) · 400 references |
| GET | `/api/rulesets/:rulesetId/releases` | pagination | 200 list (releaseNumber ASC) | 404 |
| GET | `/api/rulesets/:rulesetId/releases/latest` | — | 200 release or `null` | 404 |
| GET | `/api/ruleset-releases/:releaseId` | — | 200 release + exact composition | 404 |
| GET | `/api/ruleset-releases/:releaseId/verify-manifest-hash` | — | 200 `{ releaseId, valid, storedHash, computedHash }` | 404 |
| GET | `/api/ruleset-releases/:releaseId/compare/:otherReleaseId` | — | 200 diff | 404 |

## Semantics worth knowing

**"latest" is numeric only.** For manifests, policies, and releases it means the highest
manifestVersion, policyVersion, or releaseNumber — never active, current, published, Canon, or
effective. No current/active pointer exists anywhere. When nothing exists yet the result is
`{ "data": null }` with HTTP 200.

**Exact vs. effective manifests.**
- `GET /ruleset-manifests/:id` returns the historical manifest and only its *own* entries.
- `…/effective` returns the derived, flattened composition. Each entry carries provenance:
  `resolvedFromManifestId`, `resolutionDepth`, and `source` (`EXPLICIT` / `INHERITED`). Nothing is
  persisted.
- `…/resolve/:entityId` returns `{ "resolution": null }` with HTTP **200** when the manifest exists
  but nothing in its inheritance chain pins the Entity. "No pin" is a valid domain result, not a
  missing resource.

**Source authority, exact vs. resolved.**
- `…/source-authorities` lists the exact persisted records.
- `…/source-authority/resolve` returns `requestedScopeKey`, `resolvedScopeKey`, `authorityStatus`, and
  `source` (`EXACT`, `GLOBAL_FALLBACK`, or `UNRESOLVED`). All three are HTTP 200.

**Conflicts carry evidence, not winners.** A conflict response includes its exact candidates and
optional source references. No winner is ever computed, and source authority never ranks candidates.

**Decisions are created only through their route.** Creating one is also the only way a conflict
leaves OPEN, inside the service.

**ChangeSet impact is live-derived.** The impact report is read-only, never stored, and labelled
`derivation: "LIVE"`. Repeated calls may legitimately differ when the surrounding data changes,
while the ChangeSet itself is an immutable snapshot.

**Publication is explicit.** `POST /rulesets/:id/releases` is the only route that publishes. The
`m2-api-static` audit confirms exactly one route calls `publishRulesetRelease`. Approving a ChangeSet
or a Ruleset, creating a decision, and proposing a ChangeSet never publish.

**Releases are immutable.** A release response is its metadata plus the exact published composition.
Hash verification returns HTTP **200 even when `valid: false`**: a mismatch is the *result* of
verifying, not a transport failure. Release diff is composition-level only.

**Domain model, not persistence model.** Responses are the services' domain types serialized. The
redundant integrity columns are never exposed: operation `ruleset_id`, candidate `entity_id`,
decision `entity_id`, and selection `rule_conflict_id`. Tests assert their absence.

**Not exposed by design.** `DEVELOPMENT_MODE` is never exposed or branched on. There is no
authentication yet (the internal-development access model is unchanged). Formal OpenAPI generation
and URL versioning are deferred.

## Tests

| File | Covers |
|---|---|
| `m2-ruleset-manifest-api` | Ruleset creation and filtered listing, the review commands, exact vs. effective manifests, inheritance provenance, `resolution: null` |
| `m2-canon-policy-api` | Policy snapshots, latest, exact records, and EXACT / GLOBAL_FALLBACK / UNRESOLVED |
| `m2-conflict-decision-api` | Exact candidates and evidence with no winner or integrity columns; SELECT_RULE leaves the manifest unchanged; repeat decision → 409 |
| `m2-change-set-api` | DRAFT snapshot, LIVE impact proven read-only by table fingerprint, review commands, explicit proposal |
| `m2-release-api` | The full 15-step governance flow over HTTP, stale and CREATE 409s with no orphan rows, single use, duplicate label, tamper → `valid: false` |
| `m2-api-errors` | 404 vs. 400 semantics, malformed input, a generic 500 with no internal detail |

The `m2-api-input` unit tests cover the shared request reader. The `m2-api-static` audit pins the
route inventory and the adapter rules.
