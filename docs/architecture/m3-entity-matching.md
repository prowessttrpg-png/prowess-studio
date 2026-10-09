# Entity Matching, Normalization & Duplicate Detection (M3-WO4)

**Status: implemented; awaiting CI verification.** A reproducible, advisory identity-matching layer over a Batch's
committed Candidate set (`m3-structural-extraction.md`). It answers *"which existing Prowess Entity, if any, could
this Candidate represent?"* — never *"which rule is correct?"*.

```
ExtractionCandidate
       ↓
Identity Matcher                prowess.entity-matcher@1 (pure, deterministic)
       ├── EXACT_MATCH
       ├── POTENTIAL_MATCH
       ├── NO_MATCH
       ├── INSUFFICIENT_IDENTITY
       └── NOT_APPLICABLE
       ↓
MatchAssessment                 (+ ranked suggestions, advisory duplicate groups)
       ↓
Human Review later              (M3-WO6)
```

```
Exact canonical key / Alias
        ↓
may establish Entity identity

Similar display text
        ↓
Suggestion only
```

```
Entity Identity Match
        ≠
Rule Content Agreement
```

Matching never creates or changes an Entity, alias, canonical key, EntityVersion, Manifest, RuleConflict or decision,
never changes a Candidate, and never compares rule content (MP, damage, range, ranks, formulas, requirements). An
EXACT_MATCH whose content later differs is still only identity evidence; conflict detection is WO6.

## Why Candidate.status stays UNREVIEWED

Automated matching evidence and editorial workflow state are different things. MATCHED / NEW_ENTITY / CONFLICT /
NEEDS_MAPPING / REJECTED / APPROVED stay reserved for explicit review (WO6), which will choose a MatchRun and use its
evidence. A Batch can have several MatchRuns, so a match can never be a column on the Candidate; it lives in
`CandidateMatchAssessment`.

Three different questions, three different answers:

| | asks | decided by |
| --- | --- | --- |
| extraction confidence (WO2) | how sure was extraction that it read this correctly? | the extractor |
| match outcome (WO4) | which existing Entity could this be? | identity data only |
| Canon authority (M2) | which rule governs? | CanonPolicy / decisions |

None of them reads or ranks by another: matching never prefers an Entity because a Version is CANON / APPROVED /
PLAYTEST / DRAFT, or because a source is GOVERNING / CURRENT_PRIMARY / REFERENCE_ONLY.

## MatchRun

An `ImportMatchRun` is an immutable analysis of **one exact Candidate set** against **one exact Entity identity
catalog** using **one exact matcher + configuration**:

| Field | Meaning |
| --- | --- |
| `importBatchId` | the Batch |
| `candidateSetHash` | the Batch's `extractionOutputHash` (WO3), reused — no second set hash. Composite key `(import_batch_id, candidate_set_hash)` → `import_batches(id, extraction_output_hash)`; the stored Candidates are re-hashed and must reproduce it, else `IMPORT_MATCH.MATCH_CONFLICT` |
| `entityCatalogHash` | `PROWESS_ENTITY_CATALOG_V1` (below) |
| `comparisonManifestId` | exactly the Batch's own comparison Manifest (composite key onto the Batch), or null |
| `matcherKey` / `matcherVersion` | exact identity, e.g. `prowess.entity-matcher@1` |
| `matcherConfigHash` / `matcherConfig` | SHA-256 of the canonical JSON of the validated, effective config, and the config itself |
| `runFingerprint` | `PROWESS_IMPORT_MATCH_RUN_V1` — UNIQUE |
| `resultHash` | `PROWESS_IMPORT_MATCH_RESULT_V1` over the full result — detects nondeterminism |

There is no current / active / latest / approved / applied run and no `activeMatchRunId` on the Batch. A Batch that
has not been extracted cannot be matched (`IMPORT_MATCH.BATCH_NOT_EXTRACTED`).

**Fingerprint** — lines joined by `\n`: `PROWESS_IMPORT_MATCH_RUN_V1`, `importBatch=`, `candidateSet=`,
`entityCatalog=`, `comparisonManifest=` (or `null`), `matcherKey=`, `matcherVersion=`, `configHash=`. SHA-256,
lowercase hex. No database id or timestamp.

## Matcher registry and config

Matchers are registered by exact `key@version` (`MatcherRegistry.find`), like WO3 extractors: no latest / default /
newest fallback (`IMPORT_MATCH.MATCHER_NOT_FOUND`). The official registry holds exactly `prowess.entity-matcher@1`.

`ImportMatcherConfig = { suggestionThreshold: 0.85, maxSuggestions: 5 }` — explicit, versioned defaults. Overrides are
validated (`suggestionThreshold` in (0, 1], `maxSuggestions` 1..50) and hashed into the run; no environment variable
can change historical behaviour. The suggestion cap is review infrastructure, not a game rule.

## Entity catalog and catalog hash

The catalog contains only identity data the matcher consults:

- every Entity's id, `entityType` and canonical key (stable M1 identity);
- every EntityAlias's stored `normalizedAlias` and `normalizedContext` (verified to equal M1's normalization of the
  authored values, else `IMPORT_MATCH.CATALOG_INTEGRITY_FAILURE`);
- **only when the Batch pins a comparison Manifest:** each Entity's exact effective Version there (via the approved M2
  `getEffectiveManifestEntries` resolver — no inheritance logic is reimplemented) and that Version's `displayName`.

**No display name is ever taken from an implicit "latest" Version.** M1 Entities have no display name of their own
(the name belongs to each historical Version), so without a comparison Manifest the catalog has no display labels and
label matching works against canonical keys and aliases only. Mechanical Version payloads (`structuredData`,
`rulesText`) are never loaded.

`entityCatalogHash` = SHA-256 of `PROWESS_ENTITY_CATALOG_V1\n` + canonical JSON of the records sorted by entity id
(aliases sorted by normalized alias, then context), including the comparison Version id and display name. No
timestamps or read order. If an alias is added tomorrow, the catalog hash changes and re-analysis creates a **new**
MatchRun; the earlier run stays exactly as it was. (Creating a newer Version that the comparison Manifest does not pin
changes nothing the matcher consults, so it is not a catalog change.)

## Identity normalization

Labels and aliases use M1's single authoritative `normalizeEntityAlias` — Unicode NFC, trim, collapse internal
whitespace, **locale-independent** `toLowerCase()` (never `toLocaleLowerCase()`; the Turkish dotted/dotless-I
regression is carried forward). Punctuation, diacritics and word order are preserved; no accent stripping, NFKC,
transliteration or stemming. Canonical keys are already canonical by M1 contract (WO2 validates the proposal's syntax)
and are compared exactly, never transformed or fuzzy-matched.

## Eligibility

| Candidate | Analysed? |
| --- | --- |
| `ENTITY` | yes |
| `ENTITY_FIELD` with a proposed canonical key or Entity type | yes (its label names a field, so only the key identifies) |
| everything else — WO3 structural `UNKNOWN` / `REFERENCE`, `FORMULA`, `REQUIREMENT`, `KEYWORD`, `RELATIONSHIP` | `NOT_APPLICABLE` — the catalog is not searched, even if the label equals an alias |

A WO3 section titled "Spellcasting" is `NOT_APPLICABLE`: headings are not Entities.

## Matching rules (`prowess.entity-matcher@1`)

1. **Canonical key, exact.** If the proposed key belongs to an Entity of a compatible type (no proposed type, or the
   same type) → `EXACT_MATCH` / `CANONICAL_KEY_EXACT`. A key owned by an incompatible type is shown as a suggestion but
   never auto-matched.
2. **Alias, exact.** If the normalized label equals the normalized alias of exactly one type-compatible Entity, and
   every such alias is context-free → `EXACT_MATCH` / `ALIAS_EXACT`. Several Entities, or a context-scoped alias (which
   a context-less Candidate cannot satisfy) → suggestions only. Never an arbitrary pick.
3. **Display label** (comparison-Manifest Version names only): raw equality → `DISPLAY_LABEL_EXACT`, normalized equality
   → `NORMALIZED_LABEL` — **suggestions only**; two things both called "Resistance" may be different concepts.
4. **Fuzzy** — normalized Levenshtein similarity `1 − distance / max(length)` over the normalized strings, rounded to six
   decimals; offered as `FUZZY_LABEL` when `score ≥ suggestionThreshold` (0.85). The pool is pre-reduced to identity
   strings sharing the first or last character and within the threshold's length tolerance, and to compatible types.
   Fuzzy **never** produces `EXACT_MATCH`.

Type compatibility: when a type is proposed, Entities of other types are not suggested by label (only an exact key
collision is shown). With no type hint, cross-type namesakes all appear and the outcome is `POTENTIAL_MATCH`.

**Outcomes.** `EXACT_MATCH` if rule 1 or 2 holds; otherwise `POTENTIAL_MATCH` if any suggestion exists; otherwise
`NO_MATCH` (identity was sufficient, nothing matches — never a reason to create anything). `INSUFFICIENT_IDENTITY`
when there is no proposed key and no usable label (no letter or digit), or an `ENTITY_FIELD` has only a type hint.

**Suggestions** are ordered by: the exact match first; basis strength (CANONICAL_KEY_EXACT > ALIAS_EXACT >
DISPLAY_LABEL_EXACT > NORMALIZED_LABEL > FUZZY_LABEL); score descending; canonical key; Entity id — then capped at
`maxSuggestions`. Exact bases score 1. `matchedEntityId` is authoritative and set only for `EXACT_MATCH` (a CHECK);
it is never derived from rank 1.

## Exact comparison Manifest context

When the Batch pins a comparison Manifest, the matched Entity (and each suggestion) carries
`comparisonEntityVersionId` = its exact effective Version there; absent Entities carry null. **Absence from the
Manifest is not "new Entity"**: an Entity can be an exact identity match with no comparison Version. Matching
compares stable identity, not revisions; it never consults a latest, CANON or any other implicit Version. Later
Versions never change a stored run (composite keys bind each cited Version to its Entity).

## Duplicate groups

WO2 fingerprints catch identical extractions; WO4 flags **distinct** Candidates that may represent the same Entity:

| Basis | Members |
| --- | --- |
| `PROPOSED_CANONICAL_KEY` | `ENTITY` Candidates with the same proposed type (or both untyped) and the same proposed key |
| `NORMALIZED_LABEL` | `ENTITY` Candidates with no proposed key, the **same proposed type**, and the same normalized label |

Untyped labels and cross-type namesakes are not grouped; fuzzy similarity never groups; structural, table, formula and
requirement Candidates never participate. A group stores its basis, identity key and SHA-256 identity-key hash
(unique per run); members are ordered by Candidate ordinal for display only. Nothing is merged, deleted or ranked —
there is no winner.

## Idempotency, history, concurrency, atomicity

- Identical context (Candidate set, catalog, comparison Manifest, matcher identity, config) → the existing run
  (`created: false`), after checking its `resultHash` against a fresh computation; a mismatch is
  `IMPORT_MATCH.NONDETERMINISTIC_RESULT` and the stored run is untouched.
- A changed catalog, matcher version or config → a new, separate run. Old runs are never rewritten.
- Concurrent identical analyses: the unique run fingerprint lets exactly one commit; the others return it.
- A run and its entire result (assessments, suggestions, groups, members) are written in one transaction with bounded
  multi-row inserts; any failure leaves no partial run.

## Services (`@prowess/db`; no HTTP routes, no UI)

`analyzeImportBatchMatches(importBatchId, { matcherKey?, matcherVersion?, matcherConfig? })` (the comparison
Manifest always comes from the Batch), `getImportMatchRun`, `listImportMatchRuns` (history order — review must
choose a run explicitly), `getCandidateMatchAssessment(runId, candidateId)`, `listCandidateMatchAssessments`
(Candidate ordinal order), `listCandidateDuplicateGroups`. No update or delete.

## Errors

| Code | HTTP (when exposed) |
| --- | --- |
| `IMPORT_MATCH.NOT_FOUND` | 404 |
| `IMPORT_MATCH.BATCH_NOT_FOUND` / `MATCHER_NOT_FOUND` / `INVALID_INPUT` | 400 |
| `IMPORT_MATCH.BATCH_NOT_EXTRACTED` / `CATALOG_INTEGRITY_FAILURE` / `NONDETERMINISTIC_RESULT` / `MATCH_CONFLICT` | 409 |
| `IMPORT_MATCH.INVALID_MATCHER_OUTPUT` | 500 (explicit, safe) |

## Examples

Fixtures use Prowess-like names — an Entity `…emission` with aliases "Emission" / "Evocation", "Arcana",
"Concentration" (and the typo "Concentraton"), "Direct Damage" — to demonstrate matching. None of these names appear
in matching logic (pinned by the static audit). The real Playtest Packet is not required in CI.
