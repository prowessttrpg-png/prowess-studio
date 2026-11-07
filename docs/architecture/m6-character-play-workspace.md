# M6-WO10 — Character Play Workspace

Status: implemented on branch `m6-wo10` from certified `main` `dad46bb` (M6-WO9 merge; CI run 42324567737). **Not certified.** WO10 becomes final only after its published tree passes the complete required GitHub Actions workflow in a same-commit run. That run needs separate publication authorization.

Invariants: M6-I151 – M6-I172 (`docs/architecture/m6-invariants.md`). Gate: `M6-WO10` (controls-2). Report: `docs/reports/m6-wo10-implementation-report.md`.

## 1. Purpose and boundary

`/characters/[characterId]/play` is the turn-by-turn workspace for one completed Character. The engine owns every mechanical result:

- **M5-WO3 runtime + M4.** All Resource changes: refresh, expiry, payment, ME, movement and Counter Actions.
- **M5-WO2.** Attack Rolls and Saving Throws.
- **M6-WO7 / M5-WO10.** Signature Spell cost.
- **M6-WO8 / M5-WO11.** Signature Maneuver cost.
- **M5-WO12.** Ability resolution.
- **M5-WO13.** Active Magic.
- **M6-WO9.** Action cards and Action Improvements.

The workspace adds no game rule of its own. It does four things:

1. Keeps a closed play runtime: combat phase, round ordinal, turn state, turn-scoped Movement Allowance, reserved MP and Active Magic state.
2. Evaluates exactly one operation at a time.
3. Persists the result atomically, with an append-only event ledger.
4. Presents everything read-only. Every outcome a target would suffer is labelled **NOT APPLIED**.

Unsupported mechanics are never fabricated. They are refused or shown as reference only, with the canon gap named:

- standalone Weapon-Attack Saving Throws;
- Attacks with an accuracy modifier;
- VARIABLE costs other than a Spell's;
- runtime-deferred Abilities, including the Mana Lock amount (M5-SC-052);
- the MP payment at Channel completion (M5-SC-053).

## 2. Layers

| Layer | Module | Role |
| --- | --- | --- |
| Contract | `packages/prowess-game/src/play/contract.ts` | `PLAY_CONTRACT_VERSION` 1, operation kinds, statuses, classifications, reason codes, `PlayRuntimeState` |
| Engine route | `play/engine.ts` | `runPlan` (WO3 `compileRuntime` → M4 `orchestrateRulesEvaluation` → `readRuntimeRun`), `payAction` (+ `confirmActionPayment`). The ONLY Resource path |
| Abilities | `play/abilities.ts` | Request-scoped evaluation cache; WO7 / WO8 evaluations with the captured WO12 plan; resolution inputs; the WO13 Character Spell adapter |
| Operations | `play/operations.ts` | `readPlayOperation` (closed), `evaluatePlayOperation` (pure, deterministic, never writes) and one handler per kind |
| State | `play/state.ts` | `readPlayRuntimeState` — closed read-back; refuses another Character or a malformed state; never repairs |
| View | `play/workspace.ts` | `buildPlayWorkspace` — header, resources, legal timing, Actions (WO9 directory), Attacks, Spells, Maneuvers, Active Magic |
| Round ordinal | `internal/round.ts` | `nextRoundOrdinal` — the only arithmetic. Sequence bookkeeping, never a game value |
| Persistence | `packages/prowess-db/src/character/play-repository.ts` | The only module that touches `character_play_runtimes` / `character_play_events` |
| Service | `.../play-service.ts` | Load context, preview, commit (recompute + one transaction), idempotent replay, event history |
| API | `apps/studio/app/api/characters/[characterId]/play/**` | 4 strict routes (registered in `m6-api-routes.json`) |
| Studio | `apps/studio/app/characters/_components/play/*` | Workspace, panels, action detail / roll input, optional digital dice |

## 3. Operations

The operation kinds are `TIMING`, `GENERAL_ACTION`, `MOVEMENT`, `WEAPON_ATTACK`, `SPELL`, `MANEUVER`, `ACTIVE_MAGIC`, `MANUAL_ADJUSTMENT`, `NOTE` and `RECONCILE`. Each is a closed plain-data shape: an unknown field or kind is refused (`INVALID_PLAY_OPERATION`, HTTP 400). Derived mechanics are never inputs. A client cannot send an AP cost, total, success or maximum; only a legal *choice* (`chosenCost` for RANGE / MINIMUM), raw die faces and GM-provided facts.

An outcome's status is one of:

- `COMMITTABLE`
- `REFUSED`
- `PENDING_INPUT`
- `PENDING_DECISION`
- `UNSUPPORTED`
- `RECONCILIATION_REQUIRED`

Only `COMMITTABLE` is ever written.

An event's classification is one of:

- `RULES_EXECUTED`
- `MANUAL_ADJUSTMENT`
- `REFERENCE_ONLY`
- `NOTE`

### Timing

There are six timing events:

- `BEGIN_COMBAT`
- `START_ROUND`
- `START_TURN`
- `END_TURN`
- `END_ROUND`
- `END_COMBAT`

They follow one legal sequence. A duplicate or out-of-order event is refused, so AP never refreshes twice in one round.

Each event runs the WO3 `RESOURCE_TIMING` subject for the matching WO3 timing (`START_OF_ROUND`, `START_OF_TURN`, `END_OF_TURN`, `END_OF_ROUND`). It runs only when a Resource of the Release authors behaviour at that timing. Active Magic ticks go through WO13: `ON_ROUND_START`, `START_OF_CASTER_TURN`, `END_OF_CASTER_TURN` and `ROUND_END`. Nothing advances on its own.

### General Actions

The cost model comes from the ACTION Definition:

- **FIXED and NONE.** No choice is accepted.
- **RANGE and MINIMUM.** An explicit legal choice is required.
- **VARIABLE.** Refused. A Spell-determined cost is paid only through a Spell cast; any other VARIABLE cost is `UNSUPPORTED` and never priced as zero.

An Action Improvement replaces a FIXED cost only when it is ACTIVE, its modification is APPLIED and it has no condition (M6-WO9 authority). Two such improvements conflict and are refused.

Payment is phase 1 (`ACTION_PAYMENT`) plus `confirmActionPayment`. Only `PAID` continues. A movement grant is the WO3 `ACTION_FOLLOW_ON` over the PAID receipt.

### Counter Actions

A Counter Action is legal only when all three hold:

- it is outside the Character's own turn;
- combat is active;
- the player has explicitly declared a trigger.

An available Counter Action pool alone never makes a reaction legal. Surprise restrictions are WO3's.

### Movement

`MOVEMENT` segments `{ distance, terrainKey ∈ TERRAIN_KINDS }` are charged by the WO3 `MOVEMENT` subject at the authored terrain cost. An over-spend is refused whole. The allowance is granted only by a paid Action's follow-on. It expires by its authored `END_OF_TURN` rule, and the turn's movement record resets at `START_TURN`.

### Weapon Attacks

A Weapon Attack works as follows:

- **Cost.** It pays its own authored AP and MP (M6-WO6 listing), with MP never ME-eligible, through a WO3 `RESOURCE_TRANSITIONS` SPEND. It is never charged as a same-named generic Action.
- **Roll.** The Attack Roll is the WO2 `ATTACK_ROLL` core resolution over the player's raw die faces and a GM-provided target Dodge.
- **Damage.** Damage is authorised (the authored profile) but never applied.
- **Unsupported resolution.** `SAVING_THROW` and `DEFERRED` Attacks, and Attacks with an accuracy modifier, have no executable binding. They are `REFERENCE_ONLY`.

### Signature Spells

A Signature Spell is cast through four layers in order:

1. **Evaluation.** M6-WO7 evaluates the exact stored revision. The revision must be ACTIVE, at the current revision number and pinned to the Character's Release.
2. **Resolution.** M5-WO12 resolves the WO12 plan captured during that same evaluation (Effect Chain). Missing inputs → `PENDING_INPUT`, with the engine's exact requests. **Nothing is paid until the resolution is complete.**
3. **Payment.**
   - AP: the WO10 Final AP, through the Release's ACTION whose cost is VARIABLE-by-SPELL. That Action is found from data, never by name.
   - MP: the WO10 Final MP as a `MAGICAL_PAYMENT`. Spell-casting MP is ME-eligible (M5-SC-004).
4. **Active Magic.** A persistent duration activates through M5-WO13 with the Character Spell adapter.

### Signature Maneuvers

A Signature Maneuver follows the same four steps, with M6-WO8 / M5-WO11 doing the evaluation and costing. The differences:

- WO12 resolves **independent Action groups** (`groupTargets`), never a Spell chain.
- AP is a SPEND by its own source, and MP is never ME-eligible.
- Separately priced preparation is reported, not folded into the cost.

### Rolls

Players enter raw die faces: one die, or two for advantage or disadvantage. The engine decides totals, success and criticals. The optional digital dice generate uniform faces by CSPRNG rejection sampling; the player can edit them, and they are submitted as an ordinary input.

Saving Throws are the defender's. The GM describes the defender's Level and Stats; the Stat vocabulary comes from the server. The DC defaults to the Character DC, and a GM-provided DC is recorded as such.

### Active Magic

Active Magic runs through M5-WO13 `transitionActiveMagicWith` and the Character Spell adapter. The supported events are:

- maintenance (Sustain, ME first per WO13);
- dismissal by the pinned rule;
- external end;
- Concentration tests (no roll → pending decision);
- Channel start, invest and stop.

Channel completion leaves the MP payment UNRESOLVED (M5-SC-053). The Mana Lock amount fails closed (M5-SC-052).

### Manual adjustments and notes

A `MANUAL_ADJUSTMENT` is validated against the sheet bounds (`validateSheetPlayState`). It is classified and labelled MANUAL ADJUSTMENT, never RULES_EXECUTED, and attributed `PLAYER_GM_PROVIDED`. A `NOTE` is a note, optionally a GM-adjudication note, never an engine result.

### Reconciliation

When an advancement occurs while Active Magic is held, the workspace requires an explicit `RECONCILE`. A stored state from another Release, or another Character, is never reinterpreted.

## 4. Persistence

### Tables

Migration `20261108010000_m6_wo10_character_play_workspace` creates two tables:

- **`character_play_runtimes`**:
  - one row per Character (primary key `character_id`);
  - `ruleset_release_id`, which an UPDATE cannot change (trigger);
  - `state` (jsonb object);
  - `lock_version ≥ 1`.
- **`character_play_events`**:
  - unique `(character_id, sequence)` and `(character_id, idempotency_key)`;
  - `request_hash` (sha256);
  - CHECKs on classification and operation kind;
  - `runtime_version` and `play_state_version`;
  - the full `record`;
  - **append-only**: a BEFORE UPDATE OR DELETE trigger raises;
  - an INSERT trigger requires the event's Release to match its runtime's Release.

### Commit

A commit is ONE `prisma.$transaction`:

1. Compare-and-set the Character Sheet play state, the one resource authority, through `writePlayStateWithin`. Only the sheet Resources that changed are written. If no sheet Resource changed, the transaction instead verifies that the sheet version is still the one evaluated.
2. Compare-and-set the runtime row (created at version 1).
3. Insert exactly one event.

Any miss aborts everything, and the API answers `CHARACTER.STALE_WRITE` (409).

### Idempotency

The client chooses a UUID per submission and reuses it only for a retry of the same, unacknowledged body:

- **Same key, same request hash.** The original event is returned (`replayed: true`) and nothing is applied again.
- **Same key, different hash.** `PLAY_IDEMPOTENCY_CONFLICT` (409).

### Preview and commit

Preview never writes. Commit re-loads the Character and re-evaluates the operation on the server; nothing from a preview is trusted. The post-commit view is presented from the same loaded context, so it shows exactly what was written.

Pending inputs are not persisted. The client resubmits the whole operation with all inputs, and the server recomputes.

## 5. API

| Route | Body / query | Result |
| --- | --- | --- |
| `GET /api/characters/:id/play` | — | `{ character, release, versions, workspace, recentEvents }` |
| `POST /api/characters/:id/play/preview` | `{ operation, expectedRuntimeVersion, expectedPlayStateVersion }` | `{ versions, outcome }` — never writes |
| `POST /api/characters/:id/play/operations` | `+ idempotencyKey` | `{ committed, replayed, outcome, event, workspace }` |
| `GET /api/characters/:id/play/events` | `before?`, `limit?` | `{ events }` (newest first) |

The routes use strict bodies and queries (`readStrictBody` / `strictQuery`) and map errors as follows: 400 invalid, 404 unknown Character, 409 stale or idempotency conflict, 409 unreadable state.

## 6. Studio

The workspace page has these parts:

- header with the server's values;
- resource dashboard (current / maximum / reserved, authored timing) with manual adjustment;
- timing bar, where only legal events are enabled;
- Action Workspace tabs: General, Counter, Movement, Attacks, Spells, Maneuvers, Active Magic;
- detail / resolution panel: server context, pending requests, raw roll input, outcome view;
- Active Magic panel;
- activity log with notes;
- the related WO9 card, opened read-only in a drawer.

The Studio enforces these rules:

- **No game value computed** (static `playUiFindings`: no arithmetic on play fields, no `Math`, no fetch outside the typed client, no domain imports).
- **Stale submissions** reload and explain.
- **Retries** reuse the pending idempotency key.

The Character Sheet gains one digital-only *Play Workspace* link. The Sheet, the Card Library and Card print are unchanged.

## 7. Approved M5 changes (additive adapters; `m6-approved-m5-changes.json` → M6-WO10)

- **`ability/effect-execution.ts`.** Exports `Compiled` and `executeCompiledResolution(compiled, request)`. `executeAbilityResolution` delegates to it unchanged.
- **`character/signature-spell.ts` / `signature-maneuver.ts`.** An optional `capture` callback receives the exact compiled WO12 plan of a valid evaluation, so execution reuses it instead of re-deriving it.
- **`ability/active-magic.ts`.**
  - It gains `CharacterSpellIdentity`, `ActiveMagicAbilityAdapter` and `transitionActiveMagicWith(request, adapter)`.
  - `transitionActiveMagic(request)` is `transitionActiveMagicWith(request, null)`: the canonical path is byte-for-byte equivalent.
  - Character Signature Spells are not Definitions of the bundle, so without an adapter WO13 refuses them; the M6-I171 characterization proves this.
- **`index.ts`.** WO10 exports.

## 8. Known limitations

These are deliberate, and each is surfaced to the user:

- **No target state.** Damage, healing, conditions and effects on targets are reported and labelled NOT APPLIED. There is no encounter, initiative order or creature tracking.
- **Standalone Weapon Attack Saving Throws and accuracy-modified Attacks are REFERENCE_ONLY.** No executable binding of their Saving Throw / DC or modifier exists.
- **Mana Lock amount and Channel-completion MP are unresolved** (M5-SC-052 / M5-SC-053); WO13 fails closed.
- **VARIABLE Action costs other than a Spell's are UNSUPPORTED** (no evaluated determiner exists).
- **One Character per workspace.** Opposed or other Characters' rolls are entered as GM-provided facts.
