# RULES-WO1 — Phase B checkpoint (not completion)

Branch `rules-wo1-complete-game-authoring`, based on `main` 23f3c03 (M7-WO1 merge). This is a phase checkpoint. RULES-WO1
is complete only when Phases A–D meet R01–R28, including the owner's walkthrough acceptance, which has **not** happened.

## What Phase B delivers

| Area | Delivered | Evidence |
| --- | --- | --- |
| New authored-rule contracts | `CALCULATED_VALUE`, `SKILL_BENEFIT`, `CONCENTRATION_RULE` (v1), additive, via the approved-M5-change entry `RULES-WO1` | `packages/prowess-game/src/rules-wo1-authoring.test.ts` (27 tests); registry characterization tests |
| Evaluation | M4 `evaluateFormula` for every base, addition and sum; dependency order; cycles refused; missing input → unavailable, never 0; unstated base → bonuses only, stated as such | same; negative controls 02–06 |
| Character sheet | Optional `calculatedValues`; Carry maximum from a published value placed there, labelled by canon status; "Additional Values" section; byte-identical when none is published | game test; DB integration `rules-wo1-authored-rules.test.ts`; UI test |
| Stat → new value journey (R05 test-only) | Stats → STR → "Create a new value from STR" → guided editor (no technical tree) → Draft → preview → governed Release 2 → sheet shows "Max Load … (Test value — not canon)"; Release 1 Character unchanged | DB integration (service level, passes); Playwright `rules-wo1-authored-values.spec.ts` (see Verification) |
| Skill benefits (R06) | Athletics Trained "+5 ft Throw Distance per STR" and Expert "+5 to Base Throw Distance" authorable as `SKILL_BENEFIT`s adding to a `THROW_DISTANCE` value whose base is **not stated**; shown as "+N ft from bonuses (base not stated)" | game tests (Untrained 0, Trained 5×STR, Expert 5×STR + 5) |
| Concentration (R14, OV-01–OV-03) | Capacity `1 + floor(RES / 3)`; upkeep `max(1, floor(cast AP / 2))`; 1 point covers 1 AP; split / stack; uncovered AP paid; MP upkeep and Mana Lock not waived; open questions kept as text. RES 6 → 3; 5 AP cast → 2 AP; 0 / 1 / 2 points → 2 / 1 / 0 AP | game, DB integration and UI tests; preview states "Preview only — combat does not use this rule yet." |
| Isolated preview | Published Release vs an in-memory candidate where Drafts replace pins **or are added**; Release, Manifest and EntityVersion counts unchanged | DB integration |
| Build identity (R03) | About this build: version 0.1.3, source commit, tree, package fingerprint (passed by the desktop controller), and which kinds this build guides | UI test; static gate; control 10 |
| Gate | `RULES-WO1` static gate + UI test + game contract test; 10 negative controls, all caught and restored; invariants RW1-I001–I009 | `scripts/rules-wo1-negative-controls.mjs` |

## The installed generic-editor finding (R03)

Each commit's own `descriptors.ts`, loaded unchanged:

| Commit | Version | STAT editor |
| --- | --- | --- |
| `332639f` (DIST-WO1) | 0.1.1 | generic technical tree |
| `16ee5c6` (DIST-WO2) | 0.1.2 | generic technical tree |
| `4714d08` (PRE-M7-WO1) | 0.1.2 | guided |
| this branch | 0.1.3 | guided |

Two installers labelled 0.1.2 behave differently. This is consistent with the screenshot, but it does not prove which
build the owner has installed. That still needs the owner's diagnostics `commit` (or, after installing this branch, the
About page).

## Not yet done (later phases)

- **Phase C:** ARMOR / Shields, STATUS_CONDITION, Mage Art v2, Summon engines, Mission tables / Threat Clocks / Intel,
  Keywords screen, Metamagic, Job templates; the readable source-section picker (section keys are still typed); Skill
  rank pickers; the entry-page shell (Overview / Rules / Requirements / Preview / Usage / History) across families; and
  truthful status badges everywhere.
- **Phase D:** pack / restart / backup / upgrade proof for the new kinds, the Windows installer identity check, the owner
  walkthrough, the final R01–R28 matrix and PR.
- CI run #285 could not be rechecked from this session (GitHub pages were rate-limited), so it is **not** recorded as
  passed.
- Publication: the push was refused by the session's git proxy (repository not in the authorized set). A verified bundle
  is provided instead. Nothing is merged.
