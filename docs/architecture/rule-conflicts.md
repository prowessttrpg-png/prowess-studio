# Rule Conflicts (M2-WO5)

**Status: implemented; awaiting its first CI run.** M2-WO5 adds an explicit, historically
reproducible representation of rule conflicts. It adds no HTTP API, no UI, no Canon decisions,
no conflict resolution, no ChangeSets, and no publishing.

## What a RuleConflict is — and is not

A RuleConflict means:

> There is a known disagreement or governance issue that requires explicit review.

It does **not**, here or anywhere in this work order:

- select a candidate or store a winner;
- alter a Ruleset manifest, a manifest entry, or effective (inherited) resolution;
- change an EntityVersion's lifecycle status or content;
- change source authority, add or remove authority records, or create a CanonPolicy;
- make anything Canon or reject anything;
- alter game mechanics.

A conflict **records an observation. It never resolves one.**

```
Ruleset
  ↓
RuleConflict                         (one Ruleset, one stable Entity)
  ├── Candidate A → Entity Revision 2 → SourceReference A   (evidence optional)
  └── Candidate B → Entity Revision 3 → SourceReference B
```

## Scope

**Ruleset-scoped.** Every conflict belongs to exactly one Ruleset (`ruleset_id`). The same
EntityVersions may legitimately conflict in Ruleset A and not in Ruleset B, and a test creates the
same candidate pair independently in two Rulesets. There is no global conflict state.

**Single-Entity.** Every conflict concerns exactly one stable Entity (`entity_id`), and every
candidate is a Version of that Entity:

```
Entity: spell.affinity.emission
  Candidate Revision 1:  displayName = Evocation
  Candidate Revision 2:  displayName = Emission
Conflict: TERMINOLOGY_DIVERGENCE
```

Cross-Entity structural conflicts are out of scope until designed explicitly.

## Candidates are exact historical Versions

A candidate references one exact `EntityVersion.id` — never "latest", "CANON", "highest revision",
or "current". A conflict therefore stays reproducible: a test creates a conflict for A1 vs A2, then
creates (and promotes to CANON) A3, and the conflict still names exactly A1 and A2.

- **At least two** candidates: with zero or one there is no represented disagreement
  (`INSUFFICIENT_CANDIDATES`). The rule spans rows, so it is enforced by the service inside the
  creating transaction — no trigger.
- **At most 25** candidates (`MAX_RULE_CONFLICT_CANDIDATES`). A single-Entity disagreement among
  more than 25 distinct revisions is not a meaningful review unit; the bound also caps per-request
  work. Exceeding it is `INVALID_INPUT`.
- **No duplicates**: a Version appears once per conflict (`UNIQUE(rule_conflict_id,
  entity_version_id)`; `DUPLICATE_CANDIDATE`).
- **Same Entity**: every candidate Version belongs to the conflict's Entity
  (`VERSION_ENTITY_MISMATCH`).
- `label` and `position_summary` are optional editorial aids ("Older AP interpretation",
  "Experimental Effect Chain model"). They are display context, never authoritative mechanics.

**Ordering** is the candidate Version's `revision_number` ascending, then candidate id. Inside one
conflict every Version belongs to one Entity, so revision numbers are already distinct; the id is a
defensive tiebreak. This is a display order — it never suggests that the higher revision wins.

### How the database enforces "the Version belongs to the conflict's Entity"

The service checks it first, but the database is the final authority. Each candidate carries a
**redundant** `entity_id`, pinned from both sides by composite foreign keys:

```
(rule_conflict_id,  entity_id) → rule_conflicts (id, entity_id)     it IS the conflict's Entity
(entity_version_id, entity_id) → entity_versions(id, entity_id)     the Version belongs to it
```

Together they make "Conflict for Entity A, candidate Version of Entity B" impossible to store, and
they make the redundant column impossible to diverge: there is no value it can hold other than the
conflict's Entity. The repository always writes it from the conflict, never from caller input.
`UNIQUE(id, entity_id)` on `rule_conflicts` exists only as the target of the first key (`id` is
already the primary key); the second reuses the `(id, entity_id)` key M2-WO2 added to
`entity_versions`. Tests insert directly — bypassing the service — and confirm each foreign key
rejects its case.

**Why accept the redundancy?** Without it, the rule could only be enforced in the service, and a
direct write or a future code path could break it silently. With it, integrity materially improves,
the column is always written from the conflict, and both the service checks and the tests guarantee
it cannot diverge — the three conditions the work order set.

## SourceReference evidence (optional)

A candidate may cite one SourceReference as evidence:

```
Candidate Revision 2  — supported by —  Spellcasting.pdf → "Spell AP Cost"
```

If supplied, it must belong to **that candidate's** Version. The database enforces this too:

```
(source_reference_id, entity_version_id) → source_references(id, entity_version_id)
```

This needs `UNIQUE(id, entity_version_id)` on `source_references` — the only change this work order
makes to an existing table, an index with no new column, following the M2-WO2 pattern. When no
reference is cited the column is NULL and PostgreSQL's default `MATCH SIMPLE` skips the check, so
provenance stays optional: a conflict may come from playtest discovery, design review, mechanical
comparison, or terminology reconciliation with no exact source. A reference that does not exist, or
that belongs to another Version, is `INVALID_SOURCE_REFERENCE`.

## Classification: type, severity, status

| Vocabulary | Values | What it does |
|---|---|---|
| `RuleConflictType` | `SOURCE_CONTRADICTION`, `MECHANICAL_DIVERGENCE`, `TERMINOLOGY_DIVERGENCE`, `STRUCTURAL_DIVERGENCE`, `AUTHORING_STANDARD_CONFLICT`, `OTHER` | Classification only |
| `RuleConflictSeverity` | `LOW`, `MEDIUM`, `HIGH`, `CRITICAL` | Review prioritization metadata only |
| `RuleConflictStatus` | `OPEN`, `UNDER_REVIEW`, `RESOLVED`, `ACCEPTED_DIVERGENCE`, `DISMISSED` | Governance state; always `OPEN` in M2-WO5 |

**No value carries behavior.** A MECHANICAL_DIVERGENCE conflict does not invoke the Rules Engine; an
AUTHORING_STANDARD_CONFLICT does not modify EntityVersion data; a CRITICAL conflict does not block a
Ruleset, change its status, change a manifest, or change a Version's status. A test creates a
CRITICAL conflict of every type and confirms the Ruleset, its manifests and entries, and every Version
row are byte-for-byte unchanged. A static audit forbids conflict code from comparing these fields to
any vocabulary value or switching on them.

**Every conflict is created OPEN**, and there is no way to change its status: no `resolveConflict`,
`dismissConflict`, `acceptDivergence`, `setConflictStatus`, or `chooseWinner`. The full status
vocabulary is declared now so the lifecycle shape is explicit; M2-WO6 will define how a conflict
reaches the other states. The creation input has no `status` field, and a smuggled one is ignored.

### Accepted divergence

`ACCEPTED_DIVERGENCE` means the difference is **intentional**: both forms may stay valid in distinct
Ruleset or rule-package contexts. For example, later:

```
Core Playtest:   simple top-to-bottom Effect Chain
Experimental:    advanced branching Effect Chain
```

This is not an error that needs one universal winner. M2-WO5 defines the status only; nothing
transitions into it yet.

## Conflict is not resolution

Each of these is a test that compares state before and after creating a conflict:

- **Manifest independence.** The manifest pins A2; a conflict names A1 vs A2. The manifest still
  resolves A2, and its manifests and entries are unchanged row for row.
- **Inheritance independence.** Parent manifest pins A1, child overrides with A2; conflicts are
  created in both Rulesets. Effective child resolution is still A2 / `EXPLICIT`, identical to before.
- **Lifecycle independence.** A1 is CANON, A2 is DRAFT. After the conflict they still are, and the
  Version rows (including `updated_at`) are unchanged.
- **No authority-based winner.** A1's source is GOVERNING and A2's is REFERENCE_ONLY in the Ruleset's
  CanonPolicy. The conflict still holds both candidates, is OPEN, stores no winner, and the policy,
  its records, and the manifest (still pinning A2) are unchanged.

Source authority may later **inform** a decision. It never ranks or selects candidates here, and no
authority status is copied into a candidate.

### Why a conflict has no `canon_policy_id`

A conflict exists before review happens, and the authority context that matters is the one used
when a decision is made. Pinning a policy to the conflict at creation would artificially tie it to one
authority snapshot. Instead, M2-WO6's CanonDecision will record the exact CanonPolicy snapshot it
relied on.

## No automatic detection, no automatic dedup

Conflicts are created explicitly. Nothing scans Entities, Versions, or Sources: a test creates two
diverging Versions with different sources, a manifest, and a policy, and confirms zero conflicts
exist. Automatic detection belongs to Source Import or later governance tooling if wanted.

Two OPEN conflicts for the same Entity and candidate pair may ask different questions
(TERMINOLOGY_DIVERGENCE vs MECHANICAL_DIVERGENCE), so there is no uniqueness across conflict
candidate sets.

## Operations

`@prowess/db` exports exactly four:

| Operation | Returns |
|---|---|
| `createRuleConflict(rulesetId, input)` | The OPEN conflict with its ordered candidates |
| `getRuleConflict(conflictId)` | The conflict with its ordered candidates; no winner is computed |
| `listRuleConflicts(rulesetId, filters?)` | Headers, `created_at ASC, id ASC`; optional exact `entityId` / `status` / `severity` / `conflictType` filters (no full-text search) |
| `listRuleConflictsForEntity(rulesetId, entityId)` | One Entity's conflicts in one Ruleset (for later Compendium / Canon Inspector views) |

There is no edit, status-transition, candidate-change, or delete operation. Conflict records are
historical review context; if edits become necessary they will be designed with Canon Decision audit
rules.

### Creation order of checks

The first failure is reported and **nothing** is written:

1. input shape → `INVALID_INPUT`; fewer than two candidates → `INSUFFICIENT_CANDIDATES`; the same
   Version twice → `DUPLICATE_CANDIDATE`
2. the Ruleset exists → `RULESET_NOT_FOUND`
3. the Entity exists → `ENTITY_NOT_FOUND`
4. for each candidate, in input order: the Version exists → `VERSION_NOT_FOUND`; it belongs to the
   Entity → `VERSION_ENTITY_MISMATCH`; any SourceReference exists and belongs to that Version →
   `INVALID_SOURCE_REFERENCE`
5. write the conflict and every candidate in **one transaction**

The only reads of other domains are exact-id existence and ownership checks. Conflict code never
calls effective resolution, source-authority resolution, or any "latest" lookup; a static audit
enforces this and limits imports to the four lookups.

### Atomicity

Two tests. Service level: four valid candidates and a fifth of another Entity → zero conflict and
zero candidate rows. Write level: the repository is called directly so the composite foreign key
fails **after** the header and two candidates were inserted → still zero rows. If the database
rejects a write the service missed (a concurrent change), the error is translated to the same
controlled code: the duplicate-candidate unique key → `DUPLICATE_CANDIDATE`, the version key →
`VERSION_ENTITY_MISMATCH`, the evidence key → `INVALID_SOURCE_REFERENCE`. Those translations are tested
against real PostgreSQL errors, not hand-built ones.

## Errors and HTTP mapping

`RULE_CONFLICT_ERROR_CODES` (one namespace, following RulesetManifest's precedent). No route exists
yet (M2-WO9), but every code has a deliberate status in the exhaustive, compile-time-checked map:

| Code | HTTP | Why |
|---|---|---|
| `NOT_FOUND` | 404 | The conflict addressed by id (including a malformed id) |
| `RULESET_NOT_FOUND` | 404 | The Ruleset is the addressed resource, as for manifests and policies |
| `ENTITY_NOT_FOUND` | 400 | Named in the request body or filter |
| `INVALID_INPUT` | 400 | Shape, vocabulary, length, candidate cap |
| `INSUFFICIENT_CANDIDATES` | 400 | |
| `DUPLICATE_CANDIDATE` | 400 | A duplicate inside one request, not a clash with stored state |
| `VERSION_NOT_FOUND` | 400 | Referenced in the body |
| `VERSION_ENTITY_MISMATCH` | 400 | |
| `INVALID_SOURCE_REFERENCE` | 400 | |

## Persistence

Two tables and three enums, from one migration (`20261006010000_add_rule_conflicts`). Every foreign
key is `ON DELETE RESTRICT`: a Ruleset, Entity, Version, or SourceReference referenced by a conflict
cannot be deleted, and neither can a conflict that has candidates — governance history is never
casually removed. Indexes: `(ruleset_id, entity_id)` (listing by Ruleset and by Entity),
`(ruleset_id, status)` (status filter), `entity_id` (reverse delete check),
`rule_conflict_candidates(entity_version_id)` and `(source_reference_id)` (reverse delete checks). No
severity index: four values, filtered within an already-narrow Ruleset scope. See `database.md`.

## Future: CanonDecision

```
RuleConflict
     ↓ future (M2-WO6)
CanonDecision
     ↓
explicit governance outcome
```

M2-WO6 will add the decision record — the selected outcome, the reasoning, and the exact CanonPolicy
snapshot used — and the only way a conflict leaves OPEN. Nothing in M2-WO5 anticipates its shape
beyond declaring the status vocabulary.
