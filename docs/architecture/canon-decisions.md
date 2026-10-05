# Canon Decisions (M2-WO6)

**Status: implemented; awaiting its first CI run.** M2-WO6 adds immutable, auditable Canon
Decisions that explicitly resolve RuleConflicts. It adds no HTTP API, no UI, no ChangeSets, no
decision application, no rollback/supersession, and no publishing.

## What a CanonDecision is — and is not

```
RuleConflict                 "These exact historical positions disagree."   (M2-WO5)
     ↓
CanonDecision                "This is the explicit governance outcome."     (M2-WO6)
     ↓
explicit governance outcome
```

A CanonDecision records:

- **what** was decided — its type and the conflict's resulting disposition;
- **against which** exact RuleConflict;
- **under which** exact CanonPolicy snapshot;
- **which** exact conflict candidates were selected, kept, or merged;
- **why** — a required, human-written rationale.

```
RuleConflict
   ├── Candidate A
   └── Candidate B
          ↓
CanonDecision
   ├── CanonPolicy P1
   ├── Type: SELECT_RULE
   ├── Selected: Candidate A
   └── Disposition: RESOLVED
```

It does **not** apply the outcome. Creating a decision never changes:

- a RulesetManifest, a manifest entry, a parent-manifest pin, or effective (inherited) resolution;
- an EntityVersion's lifecycle status or content (SELECT_RULE does not promote anything to CANON,
  and nothing is deprecated or archived);
- a CanonPolicy or its SourceAuthorityRecords;
- the Ruleset.

The **only** existing row a decision changes is its RuleConflict's `status`, which moves to the
decision's disposition in the same transaction. Every integration scenario snapshots the Ruleset,
manifests, entries, policies, authority records, Versions, candidates, source references, and the
conflict row (minus `status`) before and after, and asserts they are identical.

```
CanonDecision
      ↓ future
ChangeSet
      ↓
new Ruleset Manifest / lifecycle changes
```

Turning a decision into a manifest or lifecycle change is deliberately left to later ChangeSet and
publishing work orders. No `applyDecision`, `updateManifestFromDecision`, or
`promoteSelectedCandidate` exists.

## Immutable

A persisted decision is never edited. There is no `updateDecision`, `editDecision`,
`changeOutcome`, `replacePolicy`, `changeSelections`, or `deleteDecision`, and the tables have no
`updated_at`. If governance later reverses or supersedes a decision, that will be another explicit
governance record (a future work order), not a rewrite of history.

## Scope: one conflict, one policy, one Ruleset

- **Exact RuleConflict.** Every M2-WO6 decision resolves exactly one RuleConflict. Free-floating
  decisions are not built yet.
- **Exact CanonPolicy.** Every decision pins one exact policy snapshot (`canon_policy_id`) — never
  "latest", "current", or "active". A later Policy N+1 cannot change the governance context recorded
  for an old decision.
- **Same Ruleset.** The decision's Ruleset is derived from the conflict; the caller never supplies
  it. The policy must belong to that Ruleset (`INVALID_POLICY_CONTEXT` otherwise).

The broader PAS-08 CanonDecision model also has types such as RENAME, DEPRECATE,
AUTHORIZE_EXPERIMENT, PROMOTE, ROLLBACK, and SOURCE_AUTHORITY_CHANGE. M2-WO6 implements only the
conflict-resolution subset; the others arrive with their workflows.

## Type and disposition

Two separate vocabularies, because they answer different questions: the **type** says what
governance action was taken; the **disposition** says what terminal state the conflict entered.

| Type | Selections | Disposition | Meaning |
|---|---|---|---|
| `SELECT_RULE` | exactly 1 | `RESOLVED` | One existing candidate is the governance-preferred interpretation |
| `KEEP_SEPARATE` | 2 or more | `ACCEPTED_DIVERGENCE` | The difference is intentional; both forms stay valid in distinct contexts |
| `MERGE` | 2 or more, plus a result Version | `RESOLVED` | The positions were reconciled into another existing EntityVersion |
| `RESOLVE_CONFLICT` | 0 or more | `RESOLVED` or `DISMISSED` | A generic resolution or dismissal that selects no particular candidate |

Every other combination is `INVALID_INPUT`, including SELECT_RULE with 0 or 2 selections, any
SELECT_RULE/MERGE/RESOLVE_CONFLICT with ACCEPTED_DIVERGENCE, KEEP_SEPARATE with RESOLVED or one
selection, and MERGE without a result or with one selection. `ACCEPTED_DIVERGENCE` is reachable
**only** through KEEP_SEPARATE. A unit test walks the entire type × disposition matrix; the rules
live in one data table (`CANON_DECISION_RULES`) type-checked against both vocabularies.

Each disposition is also a RuleConflictStatus of the same name, and that identity mapping is the
whole transition: RESOLVED → RESOLVED, ACCEPTED_DIVERGENCE → ACCEPTED_DIVERGENCE, DISMISSED →
DISMISSED. The conflict and its candidates are never deleted.

**No type carries behavior.** SELECT_RULE does not make a Version active, MERGE does not merge rules
text or JSON, KEEP_SEPARATE creates no package, RESOLVE_CONFLICT rewrites nothing. A static audit
forbids decision code from comparing or switching on type or disposition values.

### Accepted divergence

KEEP_SEPARATE + ACCEPTED_DIVERGENCE records that, for example, a simple Core Effect Chain and an
advanced Experimental one may both remain available in distinct future Ruleset/package contexts.
Neither candidate is a winner. M2-WO6 records the decision only; it creates no package and changes
no composition.

### Dismissal

RESOLVE_CONFLICT + DISMISSED means the conflict is intentionally closed as not needing a Canon
choice — a duplicate review issue, a false positive, or a difference judged not materially
contradictory. Zero selections are allowed. The conflict stays retrievable with its candidates.

## Candidate selections

A selection references one exact `RuleConflictCandidate` — never a "latest" Version. For
KEEP_SEPARATE and MERGE the selections are the positions kept or merged; for RESOLVE_CONFLICT they
are optional citations. A candidate appears at most once per decision, and it must belong to the
decision's conflict (`INVALID_CANDIDATE`). Merge inputs are never inferred from "all candidates".

Selections are returned ordered by the candidate's EntityVersion revision ascending, then selection
id — a display order, never a ranking.

## MERGE result Version

`result_entity_version_id` names the **existing** EntityVersion the positions were reconciled into:

```
A1 ─┐
    ├─ governance/design reconciliation ─→ A3        Decision: MERGE, result = A3
A2 ─┘
```

It need not be a candidate, but it must exist and be a Version of the conflict's Entity
(`INVALID_RESULT_VERSION`). M2-WO6 does not create A3 — it must already exist through the normal
EntityVersion system. A test confirms the Entity's Version count and every Version row are unchanged.
For every type other than MERGE the result must be absent.

## Integrity in the database

The service checks every rule first, but the database is the final authority, using the composite-
key pattern proven in M2-WO2 and WO5:

```
canon_decisions
  (rule_conflict_id, ruleset_id, entity_id) → rule_conflicts(id, ruleset_id, entity_id)
        the decision's Ruleset and Entity ARE its conflict's
  (canon_policy_id, ruleset_id)             → canon_policies(id, ruleset_id)
        the policy belongs to that same Ruleset
  (result_entity_version_id, entity_id)     → entity_versions(id, entity_id)
        a MERGE result is a Version of the conflict's Entity (NULL → MATCH SIMPLE skips the check)

canon_decision_selections
  (canon_decision_id, rule_conflict_id)          → canon_decisions(id, rule_conflict_id)
  (rule_conflict_candidate_id, rule_conflict_id) → rule_conflict_candidates(id, rule_conflict_id)
        the selected candidate belongs to the decision's conflict
```

Two redundant integrity columns make this possible: `canon_decisions.entity_id` and
`canon_decision_selections.rule_conflict_id`. Each is always written from the conflict or decision
(never from caller input) and is pinned by a composite key, so it cannot diverge. Neither is part of
the domain shape.

Four supporting unique indexes are added, each beginning with the table's primary key so it adds no
real uniqueness and exists only as a foreign-key target: `rule_conflicts(id, ruleset_id, entity_id)`,
`rule_conflict_candidates(id, rule_conflict_id)`, `canon_policies(id, ruleset_id)`, and
`canon_decisions(id, rule_conflict_id)`. All are drift-tested and pinned by the static audit.

Tests insert rows directly, bypassing the service, and confirm each key rejects its case: another
Ruleset's policy, a mismatched Ruleset or Entity, another Entity's merge result, another conflict's
candidate, a mismatched redundant conflict id, and a duplicate selection.

Every foreign key is `ON DELETE RESTRICT`: a referenced Ruleset, RuleConflict, CanonPolicy, selected
candidate, merge-result Version, or a decision with selections cannot be physically deleted.
Decisions are never cascade-deleted.

## Atomic transition and concurrency

Decision creation is one transaction, in this order:

1. **Conditional transition first:** `UPDATE rule_conflicts SET status = <disposition> WHERE id = $1
   AND status IN ('OPEN', 'UNDER_REVIEW')`.
2. Insert the decision.
3. Insert each selection.

If step 1 matches no row, the conflict is already terminal and the transaction aborts with
`CONFLICT_ALREADY_DECIDED`. If anything later fails — including a database rejection of the last
selection — everything rolls back: no decision, no selection, and the conflict keeps its prior
status. Two tests force a late failure (a foreign candidate after a valid one; another Ruleset's
policy) and confirm exactly that.

**Race safety.** Running the conditional UPDATE first means PostgreSQL row-locks the conflict before
anything is inserted. A concurrent decider for the same conflict blocks on that lock, then re-checks
the `status IN (…)` predicate after the first transaction commits, matches zero rows, and fails. No
read-then-insert window exists. A test fires six concurrent decisions at one OPEN conflict: exactly
one succeeds, the rest receive `CONFLICT_ALREADY_DECIDED`, and exactly one decision and one selection
exist. Another test calls the write path directly (skipping the service's friendly pre-check) after
a decision exists and confirms the database alone rejects it. If PostgreSQL aborts a transaction for
a deadlock or write conflict, the result is `DECISION_CONFLICT` (nothing written, safe to retry).

The transition function is internal to `@prowess/db`. There is no public `setRuleConflictStatus`; a
conflict leaves OPEN/UNDER_REVIEW only through decision creation.

### Why there is no `UNIQUE(rule_conflict_id)`

Normal M2-WO6 flow yields at most one decision per conflict, because a decided conflict is terminal
and the conditional transition enforces it atomically. A database uniqueness constraint would make
that permanent, but a future explicit rollback/supersession workflow will need to add history to an
already-decided conflict (reopen it, then decide again, with both decisions preserved). Protection
therefore lives in the lifecycle transition, not in a uniqueness constraint. The static audit pins
that no such constraint exists.

## Source authority is context, not a winner engine

The pinned policy preserves the authority context the decision was made under, by id only; no
SourceAuthorityRecord value is copied into the decision. The service never decides that GOVERNING
beats REFERENCE_ONLY. The caller explicitly supplies type, selections, and rationale, and the
rationale is never derived from authority. A test pins a policy that ranks A1's source GOVERNING and
A2's REFERENCE_ONLY, selects A2, and confirms A2 stays selected and the policy is untouched.

## Historical reproducibility

Mandatory scenario, tested end to end:

```
Conflict A1 vs A2   (with SourceReference evidence)
Policy 1            A1's source GOVERNING, A2's source CURRENT_SUPPLEMENTAL
Decision            SELECT_RULE, selects A1, Policy 1, rationale R

Later:              Policy 2 reverses the authorities; A3 and A4 are created; a new manifest pins A3
Retrieve Decision → identical: still Policy 1, still A1's candidate, still rationale R;
                    Policy 1 itself unchanged; the conflict still names only A1/A2 with the same evidence
```

## Operations

`@prowess/db` exports exactly four:

| Operation | Returns |
|---|---|
| `createCanonDecision(ruleConflictId, input)` | The decision with ordered selections; the conflict is now terminal |
| `getCanonDecision(decisionId)` | The decision with ordered selections |
| `listCanonDecisionsForConflict(ruleConflictId)` | Headers, `created_at ASC, id ASC` (at most one in normal flow) |
| `listCanonDecisions(rulesetId, filters?)` | Headers; exact `ruleConflictId` / `canonPolicyId` / `decisionType` / `conflictDisposition` filters; no full-text search |

The input is `{ canonPolicyId, decisionType, conflictDisposition, selectedCandidateIds,
resultEntityVersionId?, rationale }`. There is no `summary` field: the WO made it optional, and a
required rationale already serves as the audit text without inviting two diverging explanations.

**Validation order** (first failure reported, nothing changes):

0. everything decidable without the database — shape, the type/disposition combination, distinct
   selections, selection counts, MERGE result presence → `INVALID_INPUT`
1. the RuleConflict exists → `CONFLICT_NOT_FOUND`
2. it is OPEN or UNDER_REVIEW → `CONFLICT_ALREADY_DECIDED`
3. the CanonPolicy exists → `POLICY_NOT_FOUND`
4. it belongs to the conflict's Ruleset → `INVALID_POLICY_CONTEXT`
5. each selected candidate exists and belongs to the conflict → `INVALID_CANDIDATE`
6. a MERGE result exists and belongs to the conflict's Entity → `INVALID_RESULT_VERSION`
7. the atomic write described above

Step 0 comes first (a reordering of WO §34's steps 5, 6, 8 and part of 9) because it needs no
database and reveals nothing about stored state. Step 2 is an early, friendly check; the conditional
UPDATE in step 7 is the authority.

Nothing creates a decision implicitly: creating a conflict, a policy, or a manifest yields zero
decisions (tested).

## Errors and HTTP mapping

`CANON_DECISION_ERROR_CODES`. No route exists yet (M2-WO9), but every code has a deliberate status
in the exhaustive, compile-time-checked map.

| Code | HTTP | Why |
|---|---|---|
| `NOT_FOUND` | 404 | The decision addressed by id |
| `CONFLICT_NOT_FOUND` | 404 | The conflict is the addressed subject (first argument), not a body field |
| `RULESET_NOT_FOUND` | 404 | The Ruleset addressed by `listCanonDecisions` (added; not in the WO list) |
| `CONFLICT_ALREADY_DECIDED` | 409 | A clash with stored state |
| `DECISION_CONFLICT` | 409 | A concurrent transaction aborted the write; safe to retry |
| `POLICY_NOT_FOUND` | 400 | Referenced in the body (established convention) |
| `INVALID_POLICY_CONTEXT` | 400 | |
| `INVALID_INPUT` | 400 | Shape, combination, count, duplicate, missing MERGE result |
| `INVALID_CANDIDATE` | 400 | |
| `INVALID_RESULT_VERSION` | 400 | |

## Persistence

One migration (`20261007010000_add_canon_decisions`), generated by Prisma itself: two tables, two
enums, six RESTRICT foreign keys, two unique keys on the new tables, four composite-key targets on
existing tables, and five lookup indexes (`ruleset_id`, `rule_conflict_id`, `canon_policy_id`,
`result_entity_version_id`, and the selection's candidate id for reverse delete checks). No
`decision_type` or `conflict_disposition` index: four and three values, always filtered within an
already-narrow Ruleset. See `database.md`.
