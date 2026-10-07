# Ruleset Publishing & Immutable Releases (M2-WO8)

**Status: implemented; awaiting its first CI run.** M2-WO8 adds the controlled publication boundary:
explicit review lifecycles for ChangeSets and Rulesets, and `publishRulesetRelease`, which turns an
approved proposal into an immutable RulesetRelease. It adds no HTTP API (M2-WO9), no UI (M2-WO10), no
multi-ChangeSet bundles, rollback, deletion, or supersession, and no Rules Engine behavior.

```
CanonDecision
      ↓
ChangeSet
      ↓ review
APPROVED
      ↓ explicit publish
Base Manifest
      ↓ flatten + apply
NEW Release Manifest
      ↓
RulesetRelease
      ├── exact CanonPolicy
      ├── optional ChangeSet
      ├── version label
      └── manifest hash
```

**Publication creates new immutable state.** It never rewrites a historical manifest, manifest
entry, CanonPolicy, CanonDecision, RuleConflict, ChangeSet, or SourceAuthorityRecord. The only
existing-record changes it is permitted are:

1. ChangeSet review-status transitions (through the review operations, never during publication);
2. the Ruleset's APPROVED → PUBLISHED transition on its first release;
3. an explicitly approved DEPRECATE_ENTITY_VERSION, applied through the M1 lifecycle.

## Review lifecycles

```
ChangeSet:  DRAFT → READY_FOR_REVIEW → APPROVED
                                     ↘ REJECTED
Ruleset:    DRAFT → IN_REVIEW → APPROVED → PUBLISHED (→ PUBLISHED for later releases)
```

**Operations:** `submitChangeSetForReview`, `approveChangeSet`, `rejectChangeSet`,
`submitRulesetForReview`, `approveRuleset`. There is no generic status setter.

**Disallowed transitions:** DRAFT → APPROVED, DRAFT → REJECTED, REJECTED → APPROVED, and
APPROVED → anything are all `INVALID_STATUS_TRANSITION` (HTTP 409).

**Reserved statuses:** ChangeSet `SUPERSEDED` and Ruleset `DEPRECATED`/`ARCHIVED` stay vocabulary
only; no workflow uses them yet.

**APPROVED → PUBLISHED is not a review operation.** It happens only inside publication.

**Concurrency:** each transition is one expected-state conditional update
(`UPDATE … WHERE id = $1 AND status = <expected>`) that changes **only** `status`. Of concurrent
approve/reject calls, exactly one wins; a test fires four at once.

**Approval freezes the proposal.** The ChangeSet's name, description, decision link, operations,
operation order, Version references, and manifest context cannot change. A test confirms the
approved ChangeSet equals the original in everything but `status`.

**Approval never publishes.** Approving a ChangeSet or a Ruleset, or creating a CanonDecision,
publishes nothing. Publication requires an explicit `publishRulesetRelease` call.

## RulesetRelease

A release has `id`, `ruleset_id`, `release_number`, `version_label`, `channel`, `manifest_id`,
`canon_policy_id`, `change_set_id?`, `manifest_hash`, `release_notes?`, and `published_at`.

It is **born published**: there is no `updated_at`, draft state, mutable status, or current/active
flag, and no update or delete operation.

| Field | Rule |
|---|---|
| `release_number` | Allocated per Ruleset (1, 2, …), never supplied; `UNIQUE(ruleset_id, release_number)` |
| `version_label` | Trimmed, non-empty, not interpreted as SemVer; `UNIQUE(ruleset_id, version_label)` (exact, case-sensitive match after trimming) |
| `channel` | The Ruleset's channel **copied at publication**, using the existing `RulesetChannel` enum; never caller-supplied, and unaffected by later channel changes |
| `manifest_id` | The exact, newly created release manifest — never "latest" or "current" |
| `canon_policy_id` | The exact policy snapshot the caller supplies; it must belong to the Ruleset |
| `change_set_id` | Optional; same Ruleset, APPROVED, and `UNIQUE` (one release per ChangeSet in Phase 1) |

**No release pointer on the Ruleset.** There is no `current_release_id`, `active_release_id`, or
published-manifest column. `getLatestRulesetRelease` simply returns the highest `release_number`
when explicitly asked (null when there are none).

**Integrity.** Same-Ruleset manifest, policy, and ChangeSet are enforced by composite foreign keys
onto the existing primary-key-led targets (`ruleset_manifests(id, ruleset_id)`,
`canon_policies(id, ruleset_id)`, `change_sets(id, ruleset_id)`). Every key is RESTRICT. The
migration only creates `ruleset_releases`; no existing table is altered.

**One ChangeSet per release, for now.** Releases are not aggregated from several ChangeSets. If
that's needed later, it can be added without changing release immutability; the
`UNIQUE(change_set_id)` constraint would be revisited deliberately at that point (for example, for
explicit multi-channel publication).

## The release manifest is a new, flattened snapshot

Publication starts from one exact `baseManifestId`, which belongs to the Ruleset and is never
modified. The steps:

1. read the base manifest's **effective** composition (M2-WO3 resolution, so inherited pins count);
2. apply the approved operations in memory;
3. create a **new** RulesetManifest with `parent_manifest_id = NULL` and one explicit entry per
   resulting pin.

Why flatten? Internal development manifests may use inheritance, but a published release should be
understandable without traversing an inheritance graph. Flattening makes the snapshot
self-contained, simple to hash and diff, and makes REMOVE real (an omitted Entity cannot fall
through to an inherited pin).

```
Parent P: A → A1, B → B1        Child C: A → A2 (parent = P)
Publish C → new release manifest: A → A2, B → B1, parent = NULL      (P and C unchanged)
```

## Operation semantics — fail closed

Operations are applied **in sequence order** to a working copy of the base composition. Nothing is
written until every operation has validated. The planner is a pure function
(`planChangeSetApplication`).

| Operation | Publication rule |
|---|---|
| `PIN_ENTITY_VERSION` | Entity → `to`, whether or not a pin exists |
| `REPLACE_ENTITY_VERSION` | The current pin must equal `from`, else `STALE_CHANGE_SET` |
| `ADD_ENTITY_TO_MANIFEST` | The Entity must be absent, else `STALE_CHANGE_SET` (never reinterpreted as REPLACE) |
| `REMOVE_ENTITY_FROM_MANIFEST` | The Entity must be present (and equal `from`, if given), else `STALE_CHANGE_SET` |
| `NO_CHANGE` | No composition change; such a ChangeSet may still accompany a release |
| `CREATE_ENTITY_VERSION` | **Never materialized** → `UNRESOLVED_CREATE_OPERATION` |
| `DEPRECATE_ENTITY_VERSION` | M1 lifecycle transition to DEPRECATED inside the publication transaction; composition unchanged |

**Staleness never guesses.** If the base no longer matches what the ChangeSet expected (REPLACE
A1 → A2 against a base with A3; ADD A2 when A1 is present; REMOVE A1 when the base has A2),
publication fails with nothing written. It never "does what the user probably meant."

**Operation target manifests.** An operation whose `targetManifestId` is set must name the
publication's base manifest; otherwise the error is `INVALID_MANIFEST_CONTEXT`. Operations with no
target manifest are fine.

**CREATE workflow.** A ChangeSet doesn't contain a future Version's content, so publishing never
synthesizes one. The intended flow is:
1. author the Version through the normal EntityVersion system;
2. create a ChangeSet referencing the exact new Version;
3. approve it;
4. publish.

`UNRESOLVED_CREATE_OPERATION` is HTTP 409: the request is well-formed, but the approved proposal
isn't publishable in its current state.

**DEPRECATE reuses the M1 lifecycle.** It uses the *same* validation
(`isValidEntityVersionTransition`) and the *same* conditional update (`WHERE id AND status = from`).
To make that possible, `transitionEntityVersionStatusAtomic` gained an optional transaction client;
the default path is the original code, unchanged. A DEPRECATE therefore commits or rolls back with
the release. One lifecycle path, not two.
- DEPRECATED is reachable only from APPROVED, PLAYTEST, or CANON. Deprecating, say, a DRAFT Version
  fails publication with `INVALID_OPERATION`, and nothing is written.
- Deprecating a Version never removes it from the composition; composition and lifecycle are
  separate.

## Linear release history

The first release may use any same-Ruleset base manifest. **Every later release must use the
previous release's exact manifest as its base** (`INVALID_MANIFEST_CONTEXT` otherwise). A Ruleset's
releases therefore form a single line; to branch, use another Ruleset lineage.

## Manifest hash

```
PROWESS_MANIFEST_V1\n
<entity-id>:<entity-version-id>\n      one line per pin
…
```

- **Canonical form:** lowercase UUIDs, sorted by Entity id, UTF-8, SHA-256, stored as lowercase hex
  (`manifest_hash`).
- **Composition only:** the hash ignores entry row ids, timestamps, insertion order, and release
  label or notes. Any changed Version, added Entity, or removed Entity changes it. Unit tests cover
  every property.
- **Versioned format:** changing the canonical form requires a new format tag.
- **Where it's computed:** `@prowess/db/ruleset-release/hash.ts` (pure: `node:crypto` plus the
  model's canonical text). The model package itself stays runtime-neutral.
- **Verified at publication:** inside the transaction, the inserted entries are re-read and their
  hash must equal the planned one.
- **Verified later:** `verifyRulesetReleaseManifestHash(releaseId)` recomputes the hash from the
  release manifest's entries and returns `{ valid, storedHash, computedHash }`. It writes nothing. A
  test tampers with an entry directly (test-only), sees `valid: false`, restores it, and sees
  `valid: true`.

## Atomic, race-safe publication

The service runs every check that needs no write first:
- shape;
- Ruleset existence and publishability;
- base manifest existence, ownership, and linear baseline;
- policy existence and ownership;
- ChangeSet existence, ownership, approval, and not-yet-published;
- the in-memory plan;
- DEPRECATE lifecycle validity;
- label availability.

Then **one transaction**:

1. `SELECT … FROM rulesets WHERE id = $1 FOR UPDATE` — all publications of a Ruleset serialize here;
2. under the lock, re-check publishability and that the latest release's manifest is still the
   expected baseline; if another publication got there first → `RELEASE_CONFLICT`;
3. first release only: `APPROVED → PUBLISHED` (conditional update);
4. approved DEPRECATEs through the M1 lifecycle, on this transaction;
5. the new flattened manifest and its entries, through the **M2-WO2 allocator's own transaction
   body** (`insertManifestSnapshotInTransaction`, extracted from `insertRulesetManifestWithEntries`,
   which now wraps it — one allocator, two callers);
6. re-read the entries and verify their hash;
7. `release_number = previous + 1` (serialized by the lock; the unique constraint is the final authority);
8. insert the release.

A unique violation on `manifest_version` (a concurrent ordinary manifest creation) or
`release_number` retries the whole transaction, up to 8 times. Any other failure rolls back
everything.

**Tests:**
- **Late failure:** forcing a failure at the final release insert, *after* the status transition,
  a DEPRECATE, and the manifest with its entries, leaves no manifest, no entries, no release, the
  Version back at its old status, and the Ruleset still APPROVED.
- **Concurrent first publication:** five publications fired at one APPROVED Ruleset produce exactly
  one release (number 1), exactly one new manifest (no orphans), and a PUBLISHED Ruleset. The losers
  get `RELEASE_CONFLICT`, or `INVALID_MANIFEST_CONTEXT` if they checked after the winner committed.

## Retrieval and diff

| Operation | Returns |
|---|---|
| `getRulesetRelease(id)` | The release plus its exact composition (pins ordered by Entity id) |
| `listRulesetReleases(rulesetId)` | Headers, `release_number ASC` |
| `getLatestRulesetRelease(rulesetId)` | Highest number with composition, or null |
| `verifyRulesetReleaseManifestHash(id)` | `{ releaseId, valid, storedHash, computedHash }` |
| `compareRulesetReleases(a, b)` | Composition diff: `ADDED_ENTITY` / `REMOVED_ENTITY` / `CHANGED_VERSION` (with from/to), ordered by Entity id, plus `unchangedCount` |

The diff is composition-level only; no mechanical payloads are compared. Comparing releases of two
different Rulesets works the same way — it simply falls out — and is not otherwise special.

## Historical reproducibility

After release 1, a test creates new Versions, a new policy, a new ChangeSet, and release 2. Release
1 is unchanged: same manifest, hash, policy, channel, label, publication timestamp, and ChangeSet
link, and its hash still verifies. Publishing a ChangeSet derived from a CanonDecision leaves every
governance table byte-identical: policies, authority records, decisions, selections, conflicts,
candidates, ChangeSet operations, source references, relationships, and keywords.

## Errors

`RULESET_RELEASE_ERROR_CODES` has the WO's 15 codes plus `INVALID_INPUT` (request shape) and
`INVALID_CHANGE_SET_CONTEXT` (a ChangeSet from another Ruleset). The review lifecycle adds
`CHANGE_SET.INVALID_STATUS_TRANSITION` and `RULESET.INVALID_STATUS_TRANSITION`.

| HTTP | Codes |
|---|---|
| 404 | `NOT_FOUND`, `RULESET_NOT_FOUND` — addressed resources |
| 400 | `INVALID_INPUT`, `MANIFEST_NOT_FOUND`, `INVALID_MANIFEST_CONTEXT`, `POLICY_NOT_FOUND`, `INVALID_POLICY_CONTEXT`, `CHANGE_SET_NOT_FOUND`, `INVALID_CHANGE_SET_CONTEXT`, `INVALID_OPERATION` — body references |
| 409 | `RULESET_NOT_PUBLISHABLE`, `CHANGE_SET_NOT_APPROVED`, `CHANGE_SET_ALREADY_PUBLISHED`, `VERSION_LABEL_CONFLICT`, `STALE_CHANGE_SET`, `UNRESOLVED_CREATE_OPERATION`, `RELEASE_CONFLICT`, and both `INVALID_STATUS_TRANSITION` codes — clashes with stored state |

## Relationship to WO9 / WO10

M2-WO9 will expose these operations over HTTP; the error map is already complete. M2-WO10 will
build the publishing UI. Until then, the Studio's `/publishing` route remains the M0-WO5 navigation
placeholder, and the static audit pins it as one.
