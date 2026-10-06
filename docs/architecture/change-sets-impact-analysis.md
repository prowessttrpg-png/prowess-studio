# ChangeSets & Impact Analysis (M2-WO7)

**Status: implemented; awaiting its first CI run.** M2-WO7 adds immutable proposed ChangeSets and
derived, read-only impact analysis. It adds no application, review workflow, release, publishing,
rollback, HTTP API, UI, or Rules Engine behavior.

## Three separate stages

```
CanonDecision        "What did governance decide?"                    (M2-WO6)
      ↓
ChangeSet            "What exact changes are proposed as a consequence?" (M2-WO7)
      ↓
Operations           PROPOSED future changes
      ↓
Impact Analysis      "What may need review?"                          (M2-WO7, derived)
      ↓
Review
      ↓ future
Ruleset Release      application / publishing                          (M2-WO8)
```

The stages never collapse into one another:

- **Deciding does not create a ChangeSet.** A test decides a conflict and confirms zero ChangeSets.
- **Creating a ChangeSet does not apply anything.** It writes only the ChangeSet and its operations.
  A test fingerprints every application table except the two ChangeSet tables before and after
  creation, and they are byte-identical — no Entity, Version, Ruleset, manifest, policy, conflict,
  decision, authority record, keyword, relationship, or source changes.
- **There is no `applyChangeSet` or `executeChangeSet`.** Turning an approved proposal into immutable
  release state is M2-WO8's job.

## Immutable proposal snapshot

A ChangeSet has `id`, `ruleset_id`, an optional `canon_decision_id`, `name`, `description`, `status`,
and `created_at`. It has no `updated_at` and is never edited: there is no update, add-operation,
remove-operation, or delete. To revise a proposal, create another ChangeSet.

**Status.** Every ChangeSet is created `DRAFT`, and M2-WO7 offers no transition. The other values —
`READY_FOR_REVIEW`, `APPROVED`, `REJECTED`, `SUPERSEDED` — establish the lifecycle vocabulary for the
review/publishing workflow in later work orders.

**Ruleset scope.** Every ChangeSet belongs to one Ruleset. A linked CanonDecision is optional — so
proposals can also come from manual design, migration preparation, or maintenance — but if present
it must belong to the same Ruleset (`INVALID_DECISION_CONTEXT`).

## Operation vocabulary

| Operation | target Entity | from Version | to Version | Meaning |
|---|---|---|---|---|
| `PIN_ENTITY_VERSION` | required | — | required | A future manifest pins the Entity to this exact Version |
| `REPLACE_ENTITY_VERSION` | required | required | required (≠ from) | A future manifest switches from one exact Version to another |
| `ADD_ENTITY_TO_MANIFEST` | required | — | required | A future manifest introduces a pin where none exists |
| `REMOVE_ENTITY_FROM_MANIFEST` | required | optional | — | A future manifest omits the Entity |
| `CREATE_ENTITY_VERSION` | required | optional (base) | — | A new revision needs authoring; WO7 creates nothing |
| `DEPRECATE_ENTITY_VERSION` | required | required | — | A Version should later receive lifecycle treatment; WO7 deprecates nothing |
| `NO_CHANGE` | — | — | — | The outcome needs no repository/ruleset change |

"—" means forbidden. `target_manifest_id` is optional for every type. The matrix lives once, as data
(`CHANGE_SET_OPERATION_RULES`), and a unit test checks every required and forbidden cell. Operations
are data, never executable code or JSON patches.

Every referenced Version must be a Version of the operation's target Entity
(`VERSION_ENTITY_MISMATCH`), and every reference is an **exact EntityVersion id** — never latest,
current, highest revision, or CANON-by-inference.

**Order.** Operations keep the author's order as `sequence` 1..n. A separate column is needed
because every row inserted in one transaction shares the same `created_at`.

**Size.** 1 to 100 operations. An empty ChangeSet is rejected; to record "nothing changes", use a
single `NO_CHANGE`.

### Contradictions

Deliberately small — not a planning language. Within one ChangeSet (`OPERATION_CONFLICT`):

- `NO_CHANGE` must be the only operation.
- At most **one** manifest-composition operation (PIN / REPLACE / ADD / REMOVE) per Entity. A future
  manifest pins an Entity once, so two REPLACEs, ADD + REMOVE (express it as REPLACE), or PINs of
  different (or the same) Versions cannot coexist.
- The same CREATE (Entity + base) or DEPRECATE (Version) proposal at most once.
- A Version may not be both deprecated and pinned/added/replaced-to.

## Manifest immutability and the target manifest

`target_manifest_id` records **which exact manifest's composition was analyzed** as the basis for a
proposal. It must belong to the ChangeSet's Ruleset (`INVALID_MANIFEST_CONTEXT`). It does **not** mean
the ChangeSet edits that manifest:

```
Manifest 3:   A → A1
ChangeSet:    REPLACE A1 → A2   (target: Manifest 3)
After:        Manifest 3 still resolves A1     (tested)
Later (WO8):  a NEW Manifest 4 containing A2
```

## Decision translation

`proposeChangeSetFromCanonDecision(canonDecisionId, { targetManifestId?, name, description? })` is an
**explicit** call that creates a DRAFT ChangeSet linked to the decision, in the decision's Ruleset.
Nothing calls it automatically. The mapping is a pure, deterministic function
(`translateDecisionToOperations`) with one-operation results:

| Decision | Target manifest's effective pin | Proposal |
|---|---|---|
| SELECT_RULE (selected candidate's Version V) or MERGE (result V) | another Version X | `REPLACE` X → V |
| | already V | `NO_CHANGE` |
| | none | `ADD` → V |
| | (no target manifest given) | `PIN` → V |
| KEEP_SEPARATE | — | `NO_CHANGE` |
| RESOLVE_CONFLICT (any disposition) | — | `NO_CHANGE` |
| any DISMISSED | — | `NO_CHANGE` |

- **KEEP_SEPARATE → NO_CHANGE.** Accepted divergence keeps several interpretations valid. Mapping
  each into a Ruleset or package composition is a later, deliberate choice, and the caller can author
  those operations explicitly.
- **RESOLVE_CONFLICT → NO_CHANGE.** Its selections are citations, not a chosen Version; no winner is
  inferred.

Operation descriptions record the decision, the reasoning, and (for REPLACE) where the current pin
came from.

### Inherited pins

"Effective pin" means M2-WO3 effective resolution, so an inherited pin counts:

```
Parent P1:  A → A1
Child  C1:  inherits A → A1 from P1 (no own entry)
Decision:   SELECT_RULE A2
Proposal:   REPLACE A1 → A2, target = C1   — an override in a FUTURE child manifest
```

The parent manifest is never the target, and neither P1 nor C1 changes (tested with the table
fingerprint). The operation's description states that the pin is INHERITED from P1 and that the
parent is unchanged.

## Impact analysis

`analyzeChangeSetImpact(changeSetId)` returns a transient `ChangeSetImpactReport`. It is computed on
demand and **never persisted** — there is no impact, dependency-snapshot, or cache table. A test
fingerprints every table before and after analysis and they are byte-identical.

**Impact means "review may be required."** It never claims that anything changed, broke, or needs
recalculation. There is no MP/AP/damage recalculation, spell validation, or character rebuilding —
those systems do not exist yet.

| Category | What is reported |
|---|---|
| `DIRECT_ENTITY` | An operation's target Entity |
| `DIRECT_ENTITY_VERSION` | An operation's from / to Version |
| `MANIFEST` | The target manifest, and the Ruleset owning it |
| `INHERITING_MANIFEST` | Manifests inheriting from a target manifest, directly or transitively, and their Rulesets — **potential** downstream impact; existing immutable manifests never change retroactively |
| `RELATIONSHIP_DEPENDENT_ENTITY` | Entities **one** relationship hop from a target Entity, in either direction, with the RelationshipType |
| `KEYWORD_RELATED` | Keyword assignments on a target Entity and on its from/to Versions |
| `SOURCE_PROVENANCE` | SourceReferences of the from/to Versions |
| `CANON_GOVERNANCE` | The linked CanonDecision and its policy; this Ruleset's RuleConflicts about a target Entity, the decisions on them, and the policies those decisions pinned |

Manifest and inheritance impact are reported only for operations that name an Entity (a `NO_CHANGE`
proposes nothing about one).

**One hop only.** Generic relationships are walked exactly one hop (a test confirms an Entity two
hops away is absent). Manifest inheritance is the explicit exception, because its graph's semantics
are already defined (M2-WO3); it is walked breadth-first via exact `parent_manifest_id` links.

**Keywords, sources and governance are context.** Keywords are reported, never interpreted
mechanically. No source or governance record is modified.

### Item shape, deduplication, order

Each item has a category, a resource type (`ENTITY`, `ENTITY_VERSION`, `RULESET`, `RULESET_MANIFEST`,
`KEYWORD_ASSIGNMENT`, `SOURCE_REFERENCE`, `RULE_CONFLICT`, `CANON_DECISION`, `CANON_POLICY`), a
resource id, and a list of reasons. Each reason carries the source operation id and sequence (null
only for the ChangeSet's own decision link), a human-readable reason, and — for relationships — the
RelationshipType.

**Deduplication:** a resource appears at most **once per category**, carrying every distinct reason it
was reached by. The same resource may appear under different categories, because each category asks
a different review question. For example, a decision reached both through the conflict and through
the ChangeSet's link is one item with two reasons.

**Order:** category, then resource type (both in declaration order), then resource id. Reasons are
ordered by operation sequence (the decision link last), then text. Repeated analysis against
unchanged state returns an equal report (tested).

## Historical snapshot vs live-derived report

This distinction is deliberate:

- **The ChangeSet is a historical snapshot.** After later decisions, policies, manifests, and Versions
  A3/A4 are created, the old ChangeSet's operations are exactly as recorded (tested).
- **The impact report is live-derived** (`derivation: "LIVE"`): it is computed against the current
  database state each time, so it can change as the surrounding graph changes. The same test shows a
  newer conflict appearing in the report after it is created.

A persisted impact snapshot, if ever wanted, would be a separate, explicit future decision.

## Integrity in the database

Composite foreign keys, following the M2 pattern:

```
change_sets
  (canon_decision_id, ruleset_id)            → canon_decisions(id, ruleset_id)       linked decision is in the same Ruleset
change_set_operations
  (change_set_id, ruleset_id)                → change_sets(id, ruleset_id)           redundant ruleset_id IS the ChangeSet's
  (target_manifest_id, ruleset_id)           → ruleset_manifests(id, ruleset_id)     analyzed manifest is in that Ruleset
  (from_entity_version_id, target_entity_id) → entity_versions(id, entity_id)        from Version belongs to the target
  (to_entity_version_id, target_entity_id)   → entity_versions(id, entity_id)        to Version belongs to the target
```

- `change_set_operations.ruleset_id` is a redundant integrity column, always written from the
  ChangeSet and pinned by the first key, so it cannot diverge.
- A NULL decision, manifest, or Version skips its check (MATCH SIMPLE).
- The service guarantees a Version is never named without its target Entity (the matrix requires a
  target Entity whenever a Version is allowed). The database cannot express that one without a CHECK
  constraint, which the project avoids by convention.
- Two PK-led composite-key targets are added to existing tables — `canon_decisions(id, ruleset_id)`
  and `ruleset_manifests(id, ruleset_id)`. They are indexes only, add no new uniqueness, are
  drift-tested, and are pinned by the static audit.
- Every foreign key is `ON DELETE RESTRICT`, so a referenced decision, manifest, Version, Entity,
  Ruleset, or a ChangeSet with operations cannot be physically deleted.

## Operations and errors

`@prowess/db` exports exactly five operations: `createChangeSet`, `getChangeSet`, `listChangeSets`
(filters: `canonDecisionId`, `status`), `proposeChangeSetFromCanonDecision`, and
`analyzeChangeSetImpact`.

**`createChangeSet` validation order** (first failure reported, nothing persists):

0. pure checks — shape and operation count → `INVALID_INPUT`; the matrix → `INVALID_OPERATION`;
   contradictions → `OPERATION_CONFLICT`
1. the Ruleset exists → `RULESET_NOT_FOUND`
2. a linked decision exists → `DECISION_NOT_FOUND`, and is in the same Ruleset → `INVALID_DECISION_CONTEXT`
3. for each operation, in order: Entity → `ENTITY_NOT_FOUND`; Versions → `VERSION_NOT_FOUND` /
   `VERSION_ENTITY_MISMATCH`; manifest → `MANIFEST_NOT_FOUND` / `INVALID_MANIFEST_CONTEXT`
4. one transaction: the ChangeSet, then each operation

A test proves the write is atomic even when the database rejects the *last* operation after the
header and two operations were inserted.

**HTTP mapping** (no route exists yet; M2-WO9 owns the API):

| Code | HTTP |
|---|---|
| `NOT_FOUND`, `RULESET_NOT_FOUND` | 404 — addressed resources |
| everything else | 400 — body references and request problems |

`OPERATION_CONFLICT` is a contradiction *inside one request*, so it is 400 — like
`RULE_CONFLICT.DUPLICATE_CANDIDATE` — not 409.

## Future: publishing applies approved proposals

M2-WO8 will turn approved ChangeSets into immutable release state: a **new** manifest for composition
changes, and explicit lifecycle changes for deprecations. Until then, every proposal remains exactly
that.
