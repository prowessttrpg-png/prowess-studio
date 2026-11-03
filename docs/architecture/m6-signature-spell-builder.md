# M6-WO7 — Signature Spell Builder

PAS-10 M6-WO7. Players build Signature Spells from the exact Spell components of their Character's pinned Release. The
application never creates Spell mechanics: M5 decides legality and cost, M4 evaluates every number, and the Character
owns the composition.

```
Canonical Release (Targeting / Effect / Trait / Duration / Casting Condition Definitions, Affinity / construction policies)
        ↓
Character Mechanical Profile (M6-WO4, the ONE profile)
        ↓
Character-owned Signature Spell (selections + inert prose)
        ↓
@prowess/game evaluateCharacterSignatureSpell → M5 construction, authored-Ability, cost and chain compilers → M4
        ↓
Abilities view · Spell detail / history · Character Sheet Actions
```

## 1. Ownership

- A Signature Spell is **Character state**, never Compendium canon (M6-I077). No Entity, EntityVersion, ChangeSet,
  Manifest or Release is created or changed; the Character stays pinned to its Release.
- Identity is `characterSignatureAbilityId` + `revisionNumber` (`CharacterSpellSubject`), never an EntityVersion.
- Every mechanical component is an exact reference — entityId, entityVersionId, canonicalKey, definitionKind,
  systemFamily — that must be pinned by the Character's Release (M6-I078). Names are display only.
- Player prose (name, description, visual description, notes, narrative tags) is stored beside the selections and never
  reaches the engine: the adapter compiles a fixed inert label (M6-I079). Narrative tags are not Keywords (§86).

## 2. Persistence

Migration `20261103010000_m6_wo7_signature_spells` (registered in `m6-schema-changes.json`) adds exactly two tables:

| Model | Purpose |
| --- | --- |
| `CharacterSignatureAbility` (`character_signature_abilities`) | Roster header: `abilityKind` (`SPELL` only — future Maneuvers / Mage Arts / Summons share it), `status` DRAFT / ACTIVE / RETIRED, `currentRevisionId`, working `draftPayload`, `lockVersion`, `retiredAt` |
| `CharacterSignatureSpellRevision` (`character_signature_spell_revisions`) | Append-only finalized revisions: `revisionNumber`, `characterReleaseId`, `previousRevisionId`, strict `payload`, `createdAt` |

Database guards: closed kind / status CHECKs, "finalized ⇒ current revision", "retired ⇔ retiredAt", JSON-object
payloads, RESTRICT foreign keys, an append-only trigger (`CHARACTER_SIGNATURE_SPELL_REVISION_IMMUTABLE`) and an
owned-current-revision trigger. No component catalog and no derived value (MP, AP, capacity, range, Sustain) is stored
(§78, §116, §167). The payload is read by a strict, closed, versioned reader (`readSignatureSpellDraft`, schema 1) on
every read and finalization; a stored value is never trusted (§119).

## 3. Lifecycle

```
POST spells            → DRAFT (no revision, no slot)                         M6-I089
PUT  draft             → selections saved at any completeness (CAS, stale → 409)
POST validate          → the M5 evaluation of the saved draft
POST finalize          → Revision N+1 appended and made current; ACTIVE       M6-I090, M6-I091, M6-I092
POST rebuild           → draft = copy of the current revision; Revision N stays current
PUT  draft null        → discards a rebuild
POST retire            → RETIRED, slot released, every revision kept          M6-I094
```

Finalization runs in ONE transaction: lock the Character row `FOR UPDATE`, re-check the Character's lockVersion and
Release, re-check the Spell's lockVersion, count the OTHER active Signature Abilities, evaluate with exactly that count,
and only on success append the revision and make it current. Two finalizations for the last slot cannot both succeed.
A refusal is a capacity failure (409 `SIGNATURE_CAPACITY_EXCEEDED`) only when M5 would accept the same Spell with a
free slot; otherwise it is `SIGNATURE_SPELL_NOT_FINALIZABLE` (422) and the current revision is untouched (M6-I093).

## 4. Adapter

`packages/prowess-game/src/character/signature-spell.ts` — `evaluateCharacterSignatureSpell` (the authorized narrow
adapter, §102):

1. INCOMPLETE when Authority (and an Affinity under Affinity Authority), Targeting, an Effect or a Duration is missing.
2. The Character composition is translated to an M5 `SPELL_DEFINITION` payload and read by M5's own
   `readAuthoredAbilityPayload` (chain contract included).
3. `compileAuthoredAbilityCore` with the Character's construction context (Stats, exact Skill ranks, Affinity profile),
   the exact Signature usage (`usedSlots`, default slot use) and **no subject Definition** — no synthetic canon (§105).
   Access grants are never passed: a player cannot self-grant access (M6-I081).
4. `compileSpellCostCore` over the same compiled plan, ONE M4 orchestration, `readSpellCostRun`.
5. When valid: `compileExecutionCore` for the WO12 chain plan (read only) and the WO13 policy for Sustain / Mana Lock /
   Concentration.

Presentation states INCOMPLETE / INVALID / VALID / VALID_WITH_RUNTIME_DEFERRED are derived, not M5 vocabulary (§74).
`signature-spell-catalog.ts` builds the builder catalogs from the exact bundle with WO4 eligibility, authored listed
contributions and an Affinity alignment hint (Strength / Weakness Keyword match, explicit access).

## 5. M5 Reuse

The additive refactor (approved registry entry `M6-WO7`) exports the existing pure cores:

| File | Export | Canonical entry point |
| --- | --- | --- |
| `ability/compile.ts` | `compileAuthoredAbilityCore<S>` | `compileAbilityDefinition` delegates with `subjectRefs: [definition]` |
| `ability/spell-cost.ts` | `compileSpellCostCore<S>` | `compileSpellCost` delegates with the Spell Definition as source |
| `ability/effect-execution.ts` | `compileExecutionCore<S>` | `compileAbilityExecution` delegates |
| `construction/composition.ts` | `TRAIT_SCOPE_TARGET_SLOTS` | the same map, moved to module scope |

`m6-wo7-m5-characterization.test.ts` stores 313 digests (compiled / evaluated authored Ability, cost plan and result,
execution plan) of every golden Spell and Maneuver, generated at the M6-WO6 base `28bcfae` before any WO7 change; the
branch reproduces them byte-for-byte (M6-I096). The adapter-equivalence suite proves every M5-WO10 golden Spell built as
a Character payload yields the same contributions, base MP, net %, unrounded / final MP and base / final AP (§162).

## 6. Builder

Routes: `/characters/:id?view=abilities` (Abilities tab) and `/characters/:id/abilities`, `/spells/new`,
`/spells/:spellId` (detail + history), `/spells/:spellId/edit` (builder).

Ten WAI-ARIA tab steps — Concept, Authority, Targeting, Effects, Effect Chain, Traits, Duration, Casting Conditions,
Review, Finalize — with arrow / Home / End navigation, a live Review panel (single column on narrow screens), an
accessible validation summary whose entries jump to their step, debounced autosave with optimistic concurrency
(Saving / Saved / Conflict announced politely) and a `beforeunload` warning while unsaved.

- Authority and Affinity: radio groups from the catalog; nothing is preselected; switching re-validates and removes
  nothing (M6-I080).
- Searchable selectors (search, category, Keyword, eligible-only, Targeting compatibility) show locked options with
  their structured reason and the Strength / Weakness / explicit-access hint (§32, §85, §131).
- Typed parameter fields from each Definition's declared parameters — never a JSON editor (§33, §38, §50, §57).
- Effects: ordered list with keyboard-operable Earlier / Later controls; order persists (M6-I086). At capacity, Add is
  disabled with the reason; the explicit "Trade 1 unused Effect slot for +1 Trait slot" control (M6-I087).
- Effect Chain: optional explicit chain from the catalog's chain vocabularies (failure policy, per-Effect behaviour,
  BRANCH successors) plus the chain as M5 reads it.
- Traits: scope target chosen from the M5 scope → slot map; optional request for additional Affinity Trait capacity.

## 7. Cost And Runtime

Every number is the server's M5 evaluation: Final MP is M5-WO10 `finalMpCost`, Final AP `finalApCost`. The Review shows
the M5 Inspector rows (listed contributions, base MP, each percentage source, the Casting Condition listed / effective
percentages with the 30% cap, the one net percentage, unrounded and final MP, PRO, base AP, AP modifiers, final AP). The
cost is shown only for a VALID Spell; otherwise "Cost unresolved" with the exact reason — never zero (§128). ME never
changes the listed cost; the builder says "current ME may pay part during casting" (M6-I084). Sustain is the WO13
Formula evaluated by M4 over the M5 final MP and PRO.

## 8. Unresolved Rules

| Conflict | Behaviour |
| --- | --- |
| M5-SC-042 additional Affinity Trait capacity | requested traits are passed to M5, which refuses; ordinary / exchanged slots stay legal |
| M5-SC-046 Multi-Target additional-target price | cost unresolved with M5's exact reason; never finalizable |
| M5-SC-047 Signature discount | none applied |
| M5-SC-049 / SC-050 trait trigger / multiple Saves | the execution core's unresolved result is surfaced with its key |
| M5-SC-052 Mana Lock amount | "Runtime: Deferred — Reason: M5-SC-052"; no reserved amount |
| M5-SC-053 Channel MP timing | untouched (no Channeling selection in WO7) |

Also reported as a runtime deferral: a Release that pins no Effect execution policy
(`PROWESS_EFFECT_EXECUTION.MISSING_POLICY`). VALID_WITH_RUNTIME_DEFERRED Spells may be finalized and show the warning
everywhere they appear (§75–§76).

## 9. Character Sheet

`getCharacterSheet` adds `signatureSpells`: the CURRENT revision of each ACTIVE Spell, re-evaluated (name, revision,
state, final AP / MP, Targeting and range, Effect families, Keywords, Duration, runtime deferrals). The Actions panel
shows them compactly between the Weapon Attack rows and the Action Notes; print shows at most four lines and never full
chains (§94, §134). A Character with no Signature Ability never loads the Spell context, so the WO5 / WO6 sheet is
unchanged for it.

## 10. API

| Route | Service |
| --- | --- |
| `GET /api/characters/:id/abilities` | `getCharacterAbilities` |
| `POST /api/characters/:id/spells` `{ name }` | `createCharacterSignatureSpell` |
| `GET /api/characters/:id/spells/:spellId` | `getCharacterSignatureSpell` (spell + history) |
| `GET /api/characters/:id/spells/:spellId/builder` | `getSignatureSpellBuilder` — the ONE builder read (§82, §122) |
| `PUT .../draft` `{ expectedVersion, draft }` | `updateCharacterSignatureSpellDraft` |
| `POST .../validate` · `finalize` · `rebuild` · `retire` `{ expectedVersion }` | named commands |

Bodies are strict: an unknown field (any derived value) is 400; a stale version 409; not found 404; not finalizable 422;
capacity 409. Routes are registered under `M6-WO7` in `m6-api-routes.json`.

## 11. Known Limitations

- **Content gap (Affinity Authority):** M5 checks Affinity access for every component, Targeting and Duration included;
  Core content authors no Affinity access or Keywords on Targeting / Duration Definitions, so Affinity-Authority Spells
  are not constructible from Core content alone. Test worlds author `rules.construction.affinityAccess` (test content).
- **Content gap (§68):** the Performance Casting Condition is not in Release content; the builder reports the gap and
  offers nothing in its place.
- Revisions pinned to another Release (possible only after a future explicit migration) show their mechanics as
  unavailable rather than being re-evaluated (§80).
- The chain editor offers the vocabularies; which combinations are legal is reported by M5 on validation.
- No casting, Ability Card, Maneuver Builder or dynamic Metamagic (WO8 / WO9 / Play Workspace).
