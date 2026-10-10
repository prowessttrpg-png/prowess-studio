# M3-WO9 — First Real Prowess Source Import & Validation

**Source:** Prowess Core Playtest Packet V0.1 — the working / unfinished Core Playtest document.
**Status in Prowess Studio:** source metadata only. No authority status was assigned. Ingestion is not Canon,
not GOVERNING / CURRENT_PRIMARY, not a Ruleset and not a release.

This report summarizes verification. It contains hashes, counts, timings and brief identifying snippets only — never
the Rulebook text, database dumps or Candidate payload exports. The DOCX itself is not in the repository.

## Conclusion

The existing M3 architecture successfully ingested, reproduced, structurally extracted, semantically analyzed,
provenance-linked, visually reviewed, and completed a bounded review against the real Prowess Core Playtest Packet
V0.1 without schema changes, Canon mutation, or domain materialization. Real-source testing identified conservative
semantic-extraction limitations and three narrow UI defects, none requiring an architecture change.

## 1. Source identity

| | |
| --- | --- |
| Friendly name | Prowess Core Playtest Packet V0.1 |
| File provided | `Prowess_Core_Playtest_Packet_VO_1_2.docx` (the user's exact working file) |
| Source bytes | 98,897,516 |
| SHA-256 | `21fa6771ebdbb984941e55e45adaa8a7b6747555645530854ad401540ecde54d` |
| Structure hash | `3d9a429c8a52c493141f4c5a8971a098d7e84e65262aeb88f461fef18d9bf1e7` |
| Parser | `prowess-docx-structure@1.0.0` (the approved WO1 parser, unchanged) |
| Page count | **UNAVAILABLE FROM SOURCE METADATA** |
| Run environment | 2026-10-10, sandbox Linux, Node 22, PostgreSQL 16, local `prowess_studio_dev` database |

The ~898-page figure is not stored in the DOCX metadata and therefore was not derived by Prowess Studio. The source page count is recorded as unavailable.
(The package contains no `docProps/app.xml` or `docProps/core.xml` parts at all.)

## 2. Ingestion and reproducibility

Developer path: `pnpm import:source --file "<path-to-docx>"`, a thin wrapper around the existing
`ingestSourceSnapshot` service. It stores no local path; only the file name is kept, as WO1's `originalFilename`.

| Run | Result | Duration |
| --- | --- | --- |
| 1st ingestion | SourceDocument created, Snapshot created, structure ingested | 10.0 s (hash + parse + persist) |
| 2nd ingestion | Document, Snapshot and structure reused — **no row changed** (whole-DB fingerprint identical) | 2.4–2.5 s |
| `--verify` | Fresh parse 1.1–1.4 s; structure hash reproduces; section count and titles in order; node count and types in order; every block's raw text verbatim; every table's rows / cells / headers verbatim; asset count and content hashes — **all OK** | — |
| Post-review re-verification | Everything above, plus every Batch, MatchRun and decision history, reproduced; **nothing written** | — |

Parse-only peak observed: about 515 MB RSS / 255 MB heap. No parameter-limit, stack, memory, duplicate-key,
cross-Snapshot or ordering failure occurred.

### New source version (changed bytes)

A temporary re-zipped copy had the same content but different bytes: SHA-256 `b2368670…b554c`. It was ingested
through the same command, then deleted, and it was never committed.

- It produced a **new SourceSnapshot** under the same SourceDocument, with the **identical** structure hash `3d9a429c…f1e7`.
- The original Snapshot's rows were untouched.

Changed DOCX bytes always create a new Snapshot, even when the structure hash is identical. A new Snapshot is not a
new Ruleset, not a Release, does not replace Canon and migrates nothing.

## 3. Real structure counts

| | Count |
| --- | --- |
| Sections | 2,487 (heading levels H1–H4; 759 top-level; maximum depth 4) |
| Content nodes | 14,269 |
| Blocks | 13,461 |
| Tables | 772 |
| Assets | 36 (all `image/png`, about 99 MB of media; no source alt text) |
| Placements | 36 |
| Content outside any section | 0 |

Recognizable sections all exist as parsed sections (located by exact title, never by page):

- SPELLCASTING
- SPELLCASTING RESOURCES
- CASTING CONDITIONS
- SPELL EFFECTS
- DAMAGE SPELL EFFECTS (5 subsections)

Wording is preserved exactly. Examples:

- "Spell AP Cost = Total MP Cost ÷ Prowess Score" (÷ preserved), followed by the separate blocks "Round down." and "Minimum 1 AP.";
- "Keywords: Damage, Elemental, Fire", inside a multi-line block whose other lines (Cost, Compatible Effects, Effect) stay intact.

The CASTING COMPONENTS table (4 × 3: Condition | Requirement | Default Benefit) keeps its row and cell order and its header row.

## 4. DOCX parser findings

| Finding | Class | Severity |
| --- | --- | --- |
| No headers, footers, footnotes, endnotes, comments, tracked insertions or deletions, text boxes or equations exist in this file, so the documented WO1 limitations do not affect it | DOCUMENTED_LIMITATION | INFORMATIONAL |
| 1,497 `w:pict` elements are all decorative VML horizontal rules (`o:hr`, no image data); they are not represented, and no content is lost | DOCUMENTED_LIMITATION | INFORMATIONAL |
| No `docProps` parts, so page count and title are not declared (see §1) | SOURCE_FORMATTING | INFORMATIONAL |
| Chapter-level headings (e.g. SPELLCASTING RESOURCES, CASTING CONDITIONS) and their topical sub-headings (e.g. SPELL AP COST, CASTING COMPONENTS) are **both styled Heading 1**, so they parse as siblings and the "chapter" sections own few or no child sections. The parser is faithful to the source styles. | SOURCE_FORMATTING | LOW |
| 30 section paths occur more than once (71 sections), e.g. repeated "EXAMPLE TRAIT ENTRY" and "15. Example Maneuvers > Effects" headings | SOURCE_FORMATTING | INFORMATIONAL (exposed a UI defect, §10) |

## 5. Whole-document structural Batch

| | |
| --- | --- |
| Scope / extractor | SNAPSHOT / `prowess.structural@1` |
| Batch fingerprint | `5613613b11573465ccd6598bcc6787ba8e5034c528059d1dd8671aeac9f3279f` |
| Structural Candidates | 2,800 — 2,028 sections (UNKNOWN) + 772 tables (REFERENCE); 0 root-content units (no content outside any section) |
| Output hash | `b5ca9b10e3c6364818130d4b4e158cbb4afeb0f21bfe96628cffa39cc7483c2b` |
| Runtime | first extraction 3.8 s; re-extraction 0.85 s |
| Re-extraction | same Candidate ids, fingerprints and output hash |
| `verifyExtractionOutput` | stored set matches; extractor re-run matches |
| Review state | **READY_FOR_REVIEW** (deliberately not reviewed — this Batch validates scale and structure) |

459 sections are pure containers or heading-only and correctly produce no SECTION unit.

## 6. Semantic pilots (`prowess.semantic-foundation@1`, SECTION_SUBTREE)

Because of the flat Heading-1 styling (§4), the pilots use the smallest real sections that actually hold the
evidence. CASTING CONDITIONS and DAMAGE SPELL EFFECTS themselves contain no explicit declarations. Every pilot was
extracted twice (identical output) and verified.

| Pilot section | Candidates | Kinds | Output hash | Review state |
| --- | --- | --- | --- | --- |
| SPELL AP COST | 1 | 1 FORMULA | `ca2c691b…a8a3b` | REVIEWING (1 Approved for Import) |
| SUSTAINED SPELLS | 1 | 1 FORMULA | `5ff8a0fe…531ee` | READY_FOR_REVIEW |
| CASTING COMPONENTS | 16 | 16 REQUIREMENT | `8ad7c283…fad5` | **Review Complete** |
| ADDITIONAL CASTING CONDITIONS | 17 | 17 REQUIREMENT | `2488bd1e…6ac14` | READY_FOR_REVIEW |
| Fire Conversion (under EXAMPLE TRAIT ENTRY) | 3 | 3 KEYWORD | `f8a52fb8…b191e` | REVIEWING (1 Approved for Import) |

Each pilot extracted in about 0.25–0.35 s.

**What each pilot showed:**

- **Formula:**
  - "Spell AP Cost" was recognized with left side "Spell AP Cost" and expression "Total MP Cost ÷ Prowess Score". The authored ÷ is preserved; the normalized form is "Total MP Cost / Prowess Score".
  - Its terms ("Total MP Cost", "Prowess Score") stay unresolved.
  - "Sustain MP = Total MP ÷ Prowess Score" was recognized the same way.
  - No FormulaDefinition exists.
- **Requirement:**
  - Entries in the Casting Components "Requirement" table column were recognized, with row, column and header provenance.
  - Surrounding descriptive prose produced no Requirements.
  - Terms stay unresolved: no Affinity, Rank or Skill resolution.
- **Keyword:**
  - "Keywords: Damage, Elemental, Fire" produced one Candidate per token, in source order, with authored text preserved.
  - No KeywordDefinition was created and no mechanics were implied.
- **Provenance:** for all 38 pilot Candidates, the cited text equals the exact anchored substring at the recorded offsets. Each table Candidate's header matches its column. Every Candidate stayed UNREVIEWED until reviewed, with no proposed Entity type or canonical key.
- **Matching:** every pilot got an explicit WO4 MatchRun, and every assessment is NOT_APPLICABLE. The official extractors produce no ENTITY Candidates, so no Entity matching was exercised against real data. No Entity extractor was fabricated.
  - Pre-existing "Emission" / "Evocation" aliases were present in the catalog and were correctly not applied to the "Requires …" evidence.

### Whole-document semantic survey

Computed in memory and not persisted: 625 explicit statements — **92 Formulas, 289 Requirements, 244 Keywords** (115
distinct keyword labels, 44 from table columns). Requirements: 117 colon-marked, 172 from Requirement table columns.

## 7. False positives / false negatives

No obvious false positives were found among the 92 Formulas. Worked arithmetic examples ("16 + 3 = 19 damage",
"5 × 4 = 20 feet", "HP = 8 + 4 = 12 HP") were correctly not extracted.

| Finding | Class | Severity | Source vs system |
| --- | --- | --- | --- |
| Comma-splitting turns prose disjunctions into fragments. "Speak, chant, command, sing, or vocalize" yields "Speak", "chant", "command", "sing" **and "or vocalize"**; 34 of 289 Requirements begin with "or" or "and". This is the approved WO5 policy (split at depth-0 `,` / `;`) and was **kept unchanged**; the full cell text remains in `declarationText`. | SEMANTIC_EXTRACTION | MEDIUM | system behavior as designed |
| Formulas using `½` (e.g. Dodge, Character DC, Initiative) are not extracted — `½` is outside the v1 grammar | SEMANTIC_EXTRACTION | LOW–MEDIUM | system gap (grammar kept unchanged) |
| A parenthetical qualifier ("… ÷ PRO (rounded down)") makes the statement unrecognized; only comma qualifiers are supported | SEMANTIC_EXTRACTION | LOW–MEDIUM | system gap |
| Single-term rules ("Mana Efficiency = PRO", "Signature Ability Slots = PRO") are excluded by the "operator or function required" rule | SEMANTIC_EXTRACTION | LOW | system gap (deliberate precision rule) |
| Next-line qualifiers ("Round down." / "Minimum 1 AP." as separate paragraphs) are not attached to the formula; they remain source evidence in adjacent blocks | SEMANTIC_EXTRACTION | LOW | system gap |
| "Spell AP Cost = Total MP Cost ÷ PRO (rounded down)" (ABILITY SCORES) and "… ÷ Prowess Score" (SPELL AP COST) are two distinct statements of related rules, and several Total MP formulas differ by section (base tier vs construct vs equipment…) | — | INFORMATIONAL | **SOURCE CONTENT** — distinct source statements preserved; no conflict resolved, nothing rewritten |

No WO5 policy or grammar was changed in WO9.

## 8. Fully reviewed real Batch — CASTING COMPONENTS

Reviewed entirely through the Import Studio UI in a real browser against this data.

| | |
| --- | --- |
| Candidate total | 16 |
| Approved for Import | 13 (whole authored requirement terms, e.g. "Speak", "Gesture", "Use a focus") |
| Rejected | 3 ("or vocalize", "or perform motions", "or component") — rationale: clause-split fragment carrying the list connector, not a standalone authored requirement |
| Final Batch state | **Review Complete** |

Approval answered only "did the extractor correctly identify what the source says?" Approved for Import is not Canon.

## 9. No materialization / immutability

The development database was fingerprinted before the real import. It already held 2 Entities, 2 aliases, 2 Versions, a
Ruleset and a Manifest. After ingestion, extraction, matching, review and completion:

- **All 22 tables outside source and import data are byte-identical.**
- Only `source_*`, `import_batches`, `extraction_*`, `import_match_runs`, `candidate_match_assessments` and `import_decisions` changed.
- No Entity, EntityVersion, alias, keyword, formula or requirement definition, RuleConflict, CanonDecision, ChangeSet or Release was created.
- No schema change, no migration, no new API route.

## 10. Import Studio on real data

Verified in a real browser against the real dataset:

- the landing page lists the real Snapshot;
- the Source Inspector renders the full 2,487-section outline (about 3–4.5 s to first full render) and selects sections;
- verbatim blocks show line breaks and ÷ intact;
- the Casting Components table renders;
- a deep H4 section ("ABILITY SCORES > Strength (STR) > Weapon Power Scaling") is navigable;
- an asset placement shows metadata only, with no broken images;
- the 2,800-Candidate structural Batch shows "Page 1 of 112 · 2800 Candidates", paginates, and shows candidate detail and source evidence;
- the pilot headers show scope, extractor, integrity and counts.

**Real-data defects found and fixed** (UI class; each restores approved WO8 behavior, with a synthetic regression test in
`apps/studio/tests/unit/m3-import-ui-wo9-regressions.test.tsx`):

| Defect | Severity | Fix | Measured on real data |
| --- | --- | --- | --- |
| Section-path derivation rebuilt a map of every section for every row on every render (quadratic on a 2,487-section outline) | HIGH | Paths are indexed once per loaded outline | Selecting a semantic Candidate: about 1.8 s → about 0.2–0.5 s after the first load |
| Repeated section paths: Source Evidence searched only the first section with that path | MEDIUM | Tries every same-path section and links to the one that actually holds the anchored node | — |
| Semantic payloads in a SECTION_SUBTREE Batch record paths relative to the scope root ("Fire Conversion"); the UI expected full paths, so evidence was not found | MEDIUM | Also resolves full paths that end with the recorded path (memoized) | Fire Conversion now shows the node with "Damage" highlighted; ADDITIONAL CASTING CONDITIONS and SUSTAINED SPELLS also resolve |

**Usability observations for later (not changed in WO9):**

- The flat Heading-1 outline is long (759 top-level entries); a search or collapse affordance would help.
- The queue has no server-side kind or status filters. This is workable for the bounded pilots; reviewing all 2,800 structural Candidates was not attempted. Recorded as a later usability item, not a WO9 change.

## 11. Performance summary

| Step | Time |
| --- | --- |
| DOCX structure parse | 1.1–1.4 s |
| First ingestion (hash + parse + persist) | 10.0 s |
| Idempotent re-ingestion | 2.4–2.5 s |
| Whole structural extraction (2,800 Candidates) | 3.8 s (re-run 0.85 s) |
| Semantic pilot extraction | about 0.25–0.35 s each |
| MatchRun per pilot | 10–55 ms |
| Real-UI Candidate selection (after fix) | about 0.2–0.6 s |

No SLA is implied. No optimization was made beyond the UI defect above.

## 12. Re-running this validation

Both commands are developer-only, need an explicit local file, use the database in the Studio environment, and are
never run by CI.

```
pnpm import:source --file "<path-to-docx>" [--verify]
pnpm import:verify-real-source --file "<path-to-docx>" --pilot "SPELL AP COST" --pilot "SUSTAINED SPELLS" \
  --pilot "CASTING COMPONENTS" --pilot "ADDITIONAL CASTING CONDITIONS" --pilot "Fire Conversion"
```

Permanent CI continues to use deterministic synthetic fixtures only.
