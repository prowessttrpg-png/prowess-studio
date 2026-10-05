# Source Provenance Foundation (M1-WO7)

**Status: implemented and verified.** The permanent GitHub Actions CI workflow passed against this component when its Work Order was approved, and the M1 audit gate (`docs/audits/m1-completion-audit.md`) re-checks its invariants. Earlier revisions of this document recorded it as "not yet verified" because the authoring sandbox could not run Prisma or a browser; that limited only *local* verification and is resolved by CI.

## What this is

```
SourceDocument
      |
      v
SourceReference
      |
      v
EntityVersion
```

A minimal, durable foundation for answering: **where did this particular
representation of the Prowess rule/content come from?** Nothing more.

This is a **provenance foundation only**. It does not implement source
parsing, automatic import, field-level provenance, `SourceSection`/
`SourceBlock`, Canon authority resolution, book publishing, or document
uploads. Those all come later (M3 and beyond).

## Why References attach to EntityVersion, not stable Entity

Deliberate, and important:

```
Entity: spell.effect.damage.direct
  Revision 1 -> Spellcasting Draft
  Revision 2 -> Core Playtest Spellcasting
```

Different revisions of the same Entity may derive from entirely different
sources. A `SourceReference` attached to Revision 1 is never inferred to
apply to Revision 2 — this distinction preserves historical provenance
accurately: each Version's content came from wherever it actually came
from, and that fact doesn't change retroactively just because a later
revision exists.

### No automatic propagation

Creating Revision 2 does **not** automatically copy Revision 1's
`SourceReference`s. Source provenance remains explicitly Version-scoped —
every attachment is the direct result of a caller calling
`createSourceReference`. Automatic provenance transfer (e.g. "carry
forward the same sources unless told otherwise") may be worth considering
later, during a controlled Version-creation/import workflow — but that is
a deliberate future decision, not a hidden write this Work Order
introduces as a shortcut.

## SourceDocument

A provenance record — not the document's content, not an upload, not a
parsed representation:

- `title` — human-facing, **never relational identity**. There is no
  canonical-key system for Sources in this Work Order.
- `sourceType` — `DOCUMENT` | `WEB` | `OTHER`. Deliberately broad, not
  coupled to file extensions or formats; actual file-format parsing
  belongs to a later M3 Work Order. Descriptive metadata only.
- `versionLabel` — optional free text (e.g. `"v1"`, `"2026 Playtest
  Draft"`).
- `authorityStatus` — optional, see "Authority is descriptive only" below.
- `fileReference` — an opaque external locator, see "file_reference is
  provider-agnostic" below.
- `notes` — optional free text.

Only three operations: `createSourceDocument`, `getSourceDocument`,
`listSourceDocuments` (ordered `title ASC, id ASC`). No update or delete
API exists yet.

### `authority_status` is descriptive only (read this twice)

The vocabulary matches PAS-08's Canon Manager specification exactly —
reused, not independently invented:

```
GOVERNING
CURRENT_PRIMARY
CURRENT_SUPPLEMENTAL
PLAYTEST_REFERENCE
HISTORICAL
SUPERSEDED
REFERENCE_ONLY
UNRESOLVED
```

**In M1-WO7, setting this field does NOT:**

- determine Canon;
- choose a current rule;
- override a Ruleset;
- automatically supersede another document.

Nothing in `@prowess/model` or `@prowess/db` reads `authorityStatus` to
make any decision anywhere — it is recorded, not acted on. Actual
source-authority *governance* (the behavior that would make any of the
above statements true) belongs to PAS-08/M2's Canon Manager, which doesn't
exist yet. A dedicated integration test creates a document marked
`PLAYTEST_REFERENCE`, then confirms an unrelated EntityVersion's status, an
Entity's canonical key, and another document's own `authorityStatus` are
all completely unaffected. `UNRESOLVED` is the recommended default when a
caller wants a non-null value without yet knowing the real answer.

### `file_reference` is provider-agnostic

An opaque external locator — a Project file identifier, a document URI, a
connector/document identifier, an application storage key. **Never assumed**
to be a local filesystem path, a permanent URL, or an uploaded binary — no
particular storage provider is baked into this design. Nothing in this
Work Order opens, reads, or parses whatever it references; a dedicated
integration test persists a synthetic value
(`"project-file:test-spellcasting"`) and confirms it round-trips exactly,
untouched.

## SourceReference

The link from one specific `EntityVersion` to the `SourceDocument` it was
derived from:

- `sectionLabel` — free text (e.g. `"Spell AP Cost"`, `"Direct Damage"`,
  `"Character Creation"`).
- `pageReference` — **stored as text, not an integer**, deliberately, so
  values like `"14"`, `"14-16"`, `"iv"`, or `"Appendix A"` are all
  representable. No page-number arithmetic is ever performed on it.
- `sourceExcerptNote` — a short editorial/provenance annotation. **Not the
  full source text.** This is not a document-copying system; full
  raw-source preservation and section/block-level extraction belong to a
  later M3 Work Order.

Five operations: `createSourceReference(entityVersionId, input)`,
`getSourceReference(id)`, `listSourceReferencesForVersion(entityVersionId)`,
`listSourceReferencesForDocument(sourceDocumentId)`,
`removeSourceReference(id)`.

### Multiple references, in both directions

```
0..many SourceReferences per EntityVersion
0..many EntityVersions per SourceDocument
```

```
Revision 2
  -> Spellcasting.pdf
  -> Modular Spell Design Standard.pdf
```

is valid and explicitly tested — one Version citing two different Sources.
So is the same Source being cited by several different Versions (even
across different Entities).

### No duplicate-prevention constraint — deliberately

Multiple References from the same Version to the same Document may
legitimately point at different sections or pages — a fragile composite
uniqueness rule across nullable locator fields (`sectionLabel`,
`pageReference`) would risk eliminating superficially-similar-but-
legitimately-distinct rows. A future `SourceBlock`/field-level provenance
model can implement more precise identity and deduplication if that
genuinely turns out to be needed; M1-WO7 doesn't overengineer this now.

## Lifecycle independence from DRAFT/CANON status

**SourceReference attachment is NOT gated by the target EntityVersion's
status**, and this is a deliberate, explicit decision — not an oversight
or an implicit expansion of M1-WO3's rules.

Attaching (or removing) a SourceReference on a protected (`CANON`,
`APPROVED`, etc.) Version succeeds, and never mutates that Version's:

- `rulesText`
- `structuredData`
- `displayName`
- `status`
- `revisionNumber`

This is because SourceReferences are separately-managed **provenance/audit
metadata**, not authored mechanical content — categorically different from
the fields M1-WO3's DRAFT-only mutation rule protects. A dedicated
integration test progresses a Version all the way to `CANON`, attaches a
SourceReference to it, and confirms every one of the fields above is
byte-for-byte unchanged afterward.

**This Work Order does not expand M1-WO3's lifecycle semantics.** Later
Canon/import governance may eventually impose stricter controls over
provenance changes (e.g. requiring review before citing a new source on a
published rule) — but M1-WO7 doesn't guess at what that policy should be;
it leaves provenance freely attachable/removable regardless of status, for
now, and documents that choice explicitly here rather than silently
deciding it by omission.

## No implicit mechanics

Attaching a SourceDocument — even one marked `GOVERNING` — never changes
game behavior. The word `GOVERNING` carries no automatic weight anywhere
in this Work Order's code; it is a label, not a trigger. A dedicated
integration test creates an EntityVersion with specific `structuredData`,
attaches a `GOVERNING` SourceDocument to it, and confirms the
`structuredData`, `status`, and `revisionNumber` are all completely
unaffected.

## Error codes

| Code | Thrown by | When |
| --- | --- | --- |
| `SOURCE_DOCUMENT.NOT_FOUND` | `getSourceDocument`, `createSourceReference` | No SourceDocument exists with that UUID |
| `SOURCE_DOCUMENT.INVALID_INPUT` | `createSourceDocument` | Invalid/empty title, or an unrecognized `sourceType`/`authorityStatus` |
| `SOURCE_REFERENCE.NOT_FOUND` | `getSourceReference`, `removeSourceReference` | No SourceReference exists with that UUID |
| `SOURCE_REFERENCE.INVALID_INPUT` | reserved for future stricter validation | (not currently thrown — locator fields are free text with no required shape) |
| `ENTITY_VERSION.NOT_FOUND` (reused) | `createSourceReference` | The target EntityVersion doesn't exist |

A missing parent EntityVersion deliberately reuses
`ENTITY_VERSION.NOT_FOUND` rather than a redundant
`SOURCE_REFERENCE.INVALID_VERSION` — the same already-established reuse
pattern used throughout this project since M1-WO2.

## Deletion behavior

Both foreign keys on `SourceReference` (`sourceDocumentId`,
`entityVersionId`) use `onDelete: Restrict` — a SourceDocument with
existing References, or an EntityVersion with existing References, cannot
be physically deleted while those References exist. Removing a
SourceReference itself (`removeSourceReference`) deletes only that one
row — never the SourceDocument, the Entity, the EntityVersion, aliases,
Keywords, or EntityRelationships. A dedicated integration test confirms a
SourceDocument's direct deletion is rejected while a reference to it
exists, and succeeds once that reference is removed.

## Repository / service responsibilities

```
domain (callers)
  -> source-document service     (packages/prowess-db/src/source-document/service.ts)
  -> source-reference service     (packages/prowess-db/src/source-reference/service.ts)
       validates parent EntityVersion and SourceDocument both exist
  -> each module's own repository.ts (Prisma only, internal, not exported)
  -> Prisma / PostgreSQL
```

Only each service's public functions are part of `@prowess/db`'s public
surface, re-exported from the package's own `index.ts`.

## Ruleset-scoped authority (added in M2-WO4)

`SourceDocument.authorityStatus` described above remains **descriptive provenance metadata
carried by the document itself**. It is not Ruleset-specific governance. How authoritative a
document is *within a particular Ruleset* is declared separately, in an immutable
`SourceAuthorityRecord` inside a versioned `CanonPolicy` snapshot — see
`canon-policy-source-authority.md`. The two are never copied or synchronized, and neither one
selects an EntityVersion.
