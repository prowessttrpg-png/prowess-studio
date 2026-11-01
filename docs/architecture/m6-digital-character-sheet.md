# M6-WO5 — Digital Character Sheet

PAS-10 M6-WO5. Starting main `d13efd8767a7a1dbef3debb53d879b23f7218446` (M6-WO4 merged, with its CI timeout
correction). The Character Sheet becomes the primary Character interface: it shows a completed Character exactly as its
exact Release and the M6-WO4 CharacterMechanicalProfile define it, and lets the player keep mutable play state, notes
and a portrait. Invariants M6-I045 … M6-I056 are catalogued in [m6-invariants.md](m6-invariants.md).

The approved two-page Prowess Field Manual mockup is the canonical visual direction for the Digital Character Sheet. Exact section dimensions are implementation-flexible and should be optimized for real player usage.

The mockup is kept as reference art at [docs/design/m6-wo5-field-manual-character-sheet-mockup.png](../design/m6-wo5-field-manual-character-sheet-mockup.png).
It is never shipped as a background with inputs laid over it: the sheet is rebuilt from components (live HTML labels and
values, inline SVG icons, CSS parchment / navy / gold), so it stays accessible, responsive and maintainable.

```
Character history (creation + advancement)  +  exact Release
                         ↓
         CharacterMechanicalProfile (M6-WO4, one builder)
                         ↓
   buildCharacterSheetMechanics (@prowess/game)   +   mutable play state / notes / portrait framing
                         ↓
           CharacterSheetView (one server read)  →  Digital Character Sheet · Print view
```

## 1. Read Model

`GET /api/characters/:id/sheet` returns ONE `CharacterSheetView` (`packages/prowess-db/src/character/sheet-service.ts`):
identity (name, concept, Level, Species = the ANCESTRY Definition, Primary Affinity, Company / PAC), the exact Release,
portrait metadata and framing, the mechanical sheet, current resources, notes, the Granted Effects and Equipment
boundaries, the advancement-history count and display names. It is built from `loadCompleted` (the Character's own
Release, manifest-verified materialization) → `profileOf` (the WO4 builder) → `buildCharacterSheetMechanics`. Only a
completed Character has a sheet (a Draft → 409). The read never writes: a Character without play state reads each
resource at its derived maximum and nothing is created until the first save.

## 2. Mechanical Values

`buildCharacterSheetMechanics` (`packages/prowess-game/src/character/sheet.ts`) projects the profile; it adds no rule.

| Sheet value | Source |
| --- | --- |
| Stat Total | profile Stat `final` (baseline + Ancestry + creation + advancement, M4 modifiers) |
| Save | the Release's SAVING_THROW total, compiled and run by M4, minus that run's natural die result |
| Character Die · Character DC · Accuracy · Dodge · Movement · Sight (Range) | profile derived values (`CHARACTER_DC`, `ACCURACY`, `DODGE`, `MOVEMENT`, `BASE_RANGE`) |
| Armor | `STRENGTH_ARMOR` (the base value; equipment Armor arrives with M6-WO6) |
| Initiative | the Release's INITIATIVE total minus the natural die result (same M4 run) |
| Concentration · Attunement · Carry & Weight | **unavailable** — the Release defines no Character rule for them yet; shown "—" with the reason |
| Skill Score | the Release's SKILL_RANK bonus for the Character's exact rank; T / E / M = ladder ranks held (M4 rank comparison) |
| Resource maximums | each RESOURCE Definition's own maximum source (a derived statistic) |
| Affinity Profile | profile Affinities; Strengths / Weaknesses from the exact pinned AFFINITY payloads; Authority from the access summary |

Every Skill the Release pins is listed (Performance included when pinned); none is hard-coded. Terminology follows the
canonical registry: **Accuracy** (never To-Hit) and **Dodge** (Evasion is its legacy name, M5-SC-005).

## 3. Play State

Current HP, MP, ME, AP and Counter Actions are stored in `character_play_states` + `character_resource_states`
(keyed by the Release's `resourceKey`), separate from creation and advancement history. `PUT …/play-state` accepts only
`{ expectedVersion, resources: { KEY: current } }`. @prowess/game validates each value: a known sheet resource, a whole
number, ≥ the RESOURCE minimum, ≤ the derived maximum. Out of range is **refused** (422), never clamped; no overheal,
negative HP, carry-over or refresh is invented. The first save creates a complete row (unnamed resources at their
derived maximum). Advancing a Character never refills current resources: stored values stay as they are.

## 4. Notes

`character_sheet_notes` holds Company / PAC (descriptive text — no faction domain), Action Notes, Character Notes and
freeform possessions (`[{ category, item, weight }]`, text only; WO6 will own real inventory). `PUT …/notes` saves them
together with their own lockVersion; the UI autosaves (debounced). Nothing reads notes as mechanics (M6-I048, M6-I049).

## 5. Portrait

- **Storage** — no durable binary store existed, so WO5 adds a narrow one: `character_portraits` (MIME, size,
  dimensions, content hash, `zoom`, `offset_x`, `offset_y`, lockVersion) and `character_portrait_images` (the bytes,
  isolated from every frequently read row). No base64 in JSON, no filesystem, no cloud storage.
- **Validation** — size ≤ 8 MB (checked from `Content-Length` before the body is read, then again on the bytes); magic
  bytes must be PNG, JPEG or WebP and agree with any declared type; `sharp` must fully decode it as that format (corrupt /
  truncated images refused). SVG and every other type are refused. Bytes are stored exactly as uploaded.
- **Nondestructive framing** — `zoom` (1–5) and offsets (−1…1) are numbers applied visually: the image cover-fits a
  3 : 4 frame with its aspect ratio preserved, zoom enlarges it, offsets choose the visible overflow. `PUT
  …/portrait-transform` changes only those numbers. Replace resets the framing; remove clears the image and keeps the
  row so its version keeps increasing.
- **Serving** — `GET …/portrait/image` streams the stored bytes with the validated `Content-Type`, `nosniff`, a
  sandboxing CSP and a private cache (immutable only when the URL names the current content hash).

## 6. Layout

Page 1 (high-frequency play): page header, attached portrait + Character Personnel File header, Stats (Total / Save),
Core Values & Combat (a balanced two-column grid with Concentration `Current / Max`), Resources (larger, inline steppers
and direct entry), Skills (one block, equal rows, two columns), Actions (the largest free area). Page 2 (persistent
state): Granted Effects & Conditions, Affinity Profile (rank / Authority, Strengths and Weaknesses that grow), Equipment
& Gear (compact slots + figure), Attunement, Carry & Weight, Possessions, Character Notes. No Affinity Progression or
advancement-history panel: the structured history is on the History view.

The Character page has four views — **Sheet** (default), Advancement (WO4 profile, Advance Character, creation record,
profile form), Rules / Access, History — kept in `?view=`. Desktop shows the two pages side by side (≥ 1500 px), smaller
screens one page per row, phones stacked sections; lower-priority Page 2 panels can collapse on narrow screens while
Resources, Core Values, Skills and Actions stay open. Accessibility: semantic headings, real labels, WAI-ARIA tabs,
keyboard portrait framing, visible focus, rank markers with text alternatives, unavailable values announced with reasons.

## 7. Print

`/characters/:id/print` renders the same components in `print` mode: no buttons, inputs or links; fixed US Letter
pages (`@page { size: letter; margin: 0 }`), the Actions area filling Page 1. Text beyond the printable lines and
possessions beyond the printable rows are marked "continue on the supplemental page" and printed in full on a third page
— never silently clipped. A normal Character prints exactly two pages (proved by the E2E PDF check).

## 8. API

| Method | Route | Input |
| --- | --- | --- |
| GET | `/api/characters/:id/sheet` | — |
| PUT | `/api/characters/:id/play-state` | `{ expectedVersion, resources }` |
| PUT | `/api/characters/:id/notes` | `{ expectedVersion, companyPac, actionNotes, characterNotes, possessions }` |
| POST | `/api/characters/:id/portrait` | multipart `file`, `expectedVersion` |
| PUT | `/api/characters/:id/portrait-transform` | `{ expectedVersion, zoom, offsetX, offsetY }` |
| DELETE | `/api/characters/:id/portrait?expectedVersion=N` | — |
| GET | `/api/characters/:id/portrait/image?v=…` | — |

Each mutable area has its own version (`expectedVersion = 0` creates); stale → 409. Errors: `INVALID_PLAY_STATE` 422,
`INVALID_SHEET_NOTES` 422, `INVALID_PORTRAIT` 422, `PORTRAIT_TOO_LARGE` 413, `PORTRAIT_NOT_FOUND` 404,
`CORE_CREATION_INCOMPLETE` 409. No input names a maximum, die, score, rank or Level.

## 9. Integration Boundaries

- **M6-WO6 (equipment)** — `equipment` is `{ available: false, … }`; the panel shows intentional empty slots and the
  accessory-slot count follows Attunement once a rule exists. Carry & Weight is unavailable. No equipment table exists.
- **M6-WO7 / WO8 / WO9 / WO10** — Actions is a section component whose current layer is Action Notes; Spells, Maneuvers,
  attacks and Ability Cards can be added beside it. The sheet read model and play-state API are reusable by the Play
  Workspace.
- **Granted Effects & Conditions** — no persisted Character effect instances exist yet (M5-WO13 owns the Active Magic
  lifecycle), so the section shows its empty state; WO5 invents no manual condition engine.

## 10. Known Limitations

- Concentration capacity, Attunement and Carry & Weight show "unavailable" until the Release defines Character rules
  for them.
- Possessions are freeform text; real inventory and weight belong to M6-WO6.
- No accounts / ownership: the portrait follows the existing Character access model.
- Advancing a Character does not refill current resources (deterministic by design); rest / refresh rules are not
  applied by the sheet.
- Print overflow is decided by a line / row budget, not by measuring rendered text.
