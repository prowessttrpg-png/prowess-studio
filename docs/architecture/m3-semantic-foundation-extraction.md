# Formula, Requirement & Keyword Semantic Extraction (M3-WO5)

**Status: implemented; awaiting CI verification.** The first deliberately SEMANTIC extractor. It recognizes
**explicit** Formula, Requirement and Keyword statements in source text and records them as ordinary, immutable,
UNREVIEWED ExtractionCandidates. It resolves nothing, evaluates nothing and creates no definitions.

```
SourceSnapshot
      ↓
Semantic ImportBatch           (its own Batch: extractor prowess.semantic-foundation@1)
      ↓
semantic-foundation@1          (pure, deterministic, explicit-only)
      ├── FORMULA
      ├── REQUIREMENT
      └── KEYWORD
      ↓
UNREVIEWED Candidates
```

```
"Requires: Expert Emission"
        ↓
Requirement Candidate
        ↓
unresolved ["Expert", "Emission"]

NOT:
  Affinity automatically resolved
  Rank automatically resolved
  RequirementDefinition created
```

```
"Keywords: Damage"
       ↓
Keyword Candidate

NOT:
  damage mechanics
```

## Roadmap boundary

| Work Order | Responsibility |
| --- | --- |
| WO3 | structural extraction (`prowess.structural@1`) |
| WO4 | Entity identity analysis (MatchRuns) |
| **WO5** (this) | explicit semantic extraction (`prowess.semantic-foundation@1`) |
| WO6 | content comparison, conflicts and human import decisions |
| WO7 | Import HTTP API |
| WO8 | Import Studio UI |

## Why a separate ImportBatch

WO3's `extractionOutputHash` freezes a Batch's exact Candidate set, so semantic Candidates are never appended to a
completed structural Batch. Semantic extraction is a **separate ImportBatch** over the same exact Snapshot, structure
hash and scope, with a different extractor identity — and therefore a different Batch fingerprint:

```
SourceSnapshot V0.1
   ├── ImportBatch: prowess.structural@1
   └── ImportBatch: prowess.semantic-foundation@1
```

Both read the immutable WO1 structure independently; neither depends on the other. No new model, service or
migration exists: the normal `createImportBatch({ extractorKey: "prowess.semantic-foundation", extractorVersion: "1",
… })` + `extractImportBatch` + `getExtractionResult` flow is used, with WO3's exact registry, atomic commit, output hash,
idempotent reruns, nondeterminism detection and concurrency safety unchanged. A behaviour change means
`prowess.semantic-foundation@2` — a new Batch; v1 Batches are never altered. `prowess.structural@1` is byte-identical
to its approved WO3 content (pinned by hash), so the WO3 semantic boundary is not weakened.

The Batch may carry an exact comparison Manifest, but the extractor never sees it: recognition depends only on source
structure. WO4 matching is never run automatically. Source authority, CanonPolicy and SourceAuthorityRecords are never
read; extraction confidence describes parsing certainty only.

## What the extractor reads

Non-heading block raw text (paragraphs, list items, captions, preformatted), structured table cells, table header
cells, and section titles (for the contextual `sectionPath`, e.g. `Spellcasting > Casting`, which never classifies
anything). It is pure: no LLM, AI service, embeddings, network, filesystem, clock, randomness or locale.

## Explicit-only principle (precision over recall)

A semantic Candidate exists only for an explicit, explainable signal. Anything uncertain is left unextracted; later
extractor versions may improve recall.

**Declarations.** A marker opens a declaration only at a statement boundary (start of text, start of a line, or after
`.` `!` `?` `;` and whitespace) and only when followed by a colon:

`Formula:` `Formulas:` `Requirement:` `Requirements:` `Requires:` `Prerequisite:` `Prerequisites:` `Keyword:` `Keywords:`

The value runs to the end of the line, the next boundary marker, or a sentence terminator followed by whitespace.
A declared span is **claimed**: no other parser re-reads it, so in `Keywords: Formula, Damage` the word "Formula" is a
keyword, never a formula. A marker word anywhere else ("This calculation requires …", "each keyword is explained
later") opens nothing.

### FORMULA

- **Labelled** — `Formula: <assignment or expression>` (HIGH).
- **Assignment** — an unclaimed statement `Left Hand = expression[, qualifiers]` (HIGH): exactly one `=`, a left side
  of 1–6 plain words, a well-formed expression containing at least one operator or function.
- **Table** — a cell in a column whose header is `Formula`/`Formulas` (MEDIUM).

Grammar: `+ - − * / × ÷`, parentheses, integer / decimal literals, identifier terms (Unicode words; consecutive words
form one term, e.g. `Final MP`), `floor` `ceil` `min` `max`, and a single unit word directly after a number (`15 ft`,
kept verbatim, never converted). Qualifiers after a depth-0 comma must be one of `minimum N`, `maximum N`, `min N`,
`max N`, `rounded down/up`, `round down/up` — preserved, never applied; any other trailing text makes the statement
unrecognized. Rejected: ordinary numbers ("The Mage may move 15 feet."), URLs / query strings, prose equalities, trivial
constants (`AP = 3`), malformed or empty sides. The parser only validates structure: **no evaluation, no `eval`, no
`Function` constructor, no Rules Engine.** `floor(...)` stays `floor(...)`; "rounded down" stays a qualifier.

### REQUIREMENT

- `Requires:` / `Requirement(s):` / `Prerequisite(s):` declarations (HIGH), and table cells under such a header (HIGH).
- One narrowly-defined colon-less form (MEDIUM): a statement that **begins** with `Requires ` followed only by
  capitalized or numeric words and the connectors and / or / of / in / at / to / with — e.g. "Requires Expert
  Emission." "Requires the GM to adjudicate." and "This spell requires …" do not qualify.
- **One Candidate per explicit clause**: a value is split only at depth-0 `;` and `,` (an explicit list). "and" / "or"
  are never turned into ALL / ANY logic — "Expert Arcana and Trained Emission" stays one clause, verbatim.
- Terms stay unresolved whitespace tokens. No rank, affinity or stat vocabulary exists in the parser.

### KEYWORD

- `Keyword:` / `Keywords:` declarations and cells under a `Keyword(s)` header (HIGH); **one Candidate per declared
  token** (depth-0 `,` / `;`). A token must be 1–5 words, letter-initial, ≤ 80 characters, without `=` `:` or brackets;
  one malformed token rejects the whole declaration rather than guessing.
- Never inferred from capitalization, bold, frequency, headings, vocabulary or repetition.
- `normalizedLabel` is a review aid only: NFC, trimmed, collapsed whitespace, locale-independent lowercase. The
  authored label is preserved exactly. **A Keyword has no implicit mechanics**: extracting "Damage" or "Sustain" causes
  no behavior anywhere — keywords stay metadata until explicit rules define behavior.

### Tables

A column is semantic only when its header cell (the last header row, or the first row if none is flagged) is exactly
one of the role labels above (case-insensitive, optional trailing colon). Only that column's data cells are read;
numeric content alone never makes a semantic column.

## Payload schemas (version 1)

`prowess.semantic.formula`
```json
{ "semanticType": "FORMULA", "sourceForm": "ASSIGNMENT|LABELLED_ASSIGNMENT|LABELLED_EXPRESSION|TABLE_ASSIGNMENT|TABLE_EXPRESSION",
  "markerText": "Formula|null", "rawText": "Spell AP = floor(Final MP / PRO), minimum 1", "leftHandText": "Spell AP",
  "expressionText": "floor(Final MP / PRO)", "normalizedExpressionText": "floor(Final MP / PRO)", "qualifiers": ["minimum 1"],
  "terms": ["Final MP", "PRO"], "functions": ["floor"], "operators": ["/"], "quantities": [],
  "sectionPath": "Spellcasting", "startOffset": 0, "endOffset": 43, "rowIndex": null, "columnIndex": null, "headerText": null }
```
`prowess.semantic.requirement`
```json
{ "semanticType": "REQUIREMENT", "marker": "Requires", "markerForm": "COLON|INLINE|TABLE_COLUMN",
  "rawRequirementText": "Expert Emission", "declarationText": "Expert Emission", "clauseIndex": 0, "clauseCount": 1,
  "negated": false, "terms": ["Expert", "Emission"], "sectionPath": "…", "startOffset": 10, "endOffset": 25,
  "rowIndex": null, "columnIndex": null, "headerText": null }
```
`prowess.semantic.keyword`
```json
{ "semanticType": "KEYWORD", "authoredLabel": "Damage", "normalizedLabel": "damage", "declarationLabel": "Keywords",
  "tokenIndex": 0, "tokenCount": 3, "sectionPath": "…", "startOffset": 10, "endOffset": 16,
  "rowIndex": null, "columnIndex": null, "headerText": null }
```
`normalizedExpressionText` maps `×`→`*`, `÷`→`/`, `−`→`-` and collapses spaces; the authored `expressionText` and
`rawText` keep the original symbols. Every Candidate has `proposedEntityType = null` and `proposedCanonicalKey = null`:
no identity, canonical key, FormulaDefinition, RequirementDefinition or KeywordDefinition is proposed or created.

## Provenance, offsets, verbatim evidence

- **Primary anchor**: the exact content node — the paragraph / list item, or the table (WO1 cannot anchor a single cell;
  the payload carries `rowIndex`, `columnIndex` (grid column) and `headerText`). No cell SourceReference is invented.
- **Offsets**: `startOffset` / `endOffset` are UTF-16 code-unit indices (JavaScript string indexing) into the exact raw
  text of the block, or of the cell for table findings. No page coordinates.
- **Verbatim**: the cited text (`rawText` / `rawRequirementText` / `authoredLabel`) is always exactly
  `source.slice(startOffset, endOffset)`. A supporting anchor on the same node carries that text as its excerpt, which
  the database independently verifies is an exact substring of the source (WO2's excerpt rule). Source raw text is
  never replaced or rewritten.

## Ordering and determinism

Candidates are ordered by content-node source order, then (for tables) row and column, then occurrence offset, then
FORMULA < REQUIREMENT < KEYWORD, then token / clause index — never by confidence, alphabet, id or importance.
Ordinals are 1..n. Identical declarations in two places stay two Candidates (different anchors / offsets → different
fingerprints); review decides whether they describe the same rule. Same Snapshot + structure hash + scope + extractor
key / version → identical Candidates, fingerprints and `extractionOutputHash` (verified with shuffled input order).

## Large sources

Extraction reuses WO3's chunked structure reads and bounded commit inserts; a regression test extracts 4,000
semantic Candidates (with 4,000 verified excerpts) from 1,000 paragraphs, then re-verifies the output hash.

## Limitations (v1)

Colon-marked declarations and `=` assignments only; no parenthesized qualifiers; no unit arithmetic; no detection of
requirements or keywords phrased without an explicit marker (other than the narrow "Requires Capitalized Terms"
statement); headings are not read as declarations; no Boolean requirement logic; no table-purpose inference. All are
deliberate precision choices.
