# M4 Resource Engine Foundation (M4-WO7)

**Status:** M4-WO7 — Resource Engine Foundation. Invariants M4-I80 – M4-I98 are catalogued, with their automated
guards, in `m4-rules-engine-core.md`.

## Purpose

Generic runtime-resource infrastructure. It covers:

- current values, minimum / maximum bounds and capacity;
- reserved capacity;
- spending, restoring, explicit refresh, and reserving / releasing capacity;
- ordered multi-resource payment, with preview and atomic apply;
- insufficient-resource outcomes;
- provenance and trace.

Everything is pure data in and new immutable data out. The engine knows nothing about MP, ME, AP, Mana Lock, Sustain
or any other Prowess resource.

Code: `packages/prowess-rules/src/resource/` (`model.ts`, `snapshot.ts`, `transition.ts`, `payment.ts`). It is pure,
inside `@prowess/rules`, which still depends only on `@prowess/model`. There is no database access, persistence,
route, UI or new dependency. "Apply" in this package means *compute the resulting state*; nothing is ever saved.

## The central rule: listed cost ≠ runtime payment (M4-I14)

A cost is **calculated** first, by Formula and Modifier. Payment then only **chooses where that already-calculated
amount comes from**. Payment never rewrites the listed amount, a Formula output, a Modifier output or an earlier trace.
There is no "effective cost" field anywhere.

```
Formula / Modifier Engine
        │
        ▼
FINAL LISTED COST
17
        │
        ├─────────────► downstream calculations use 17
        │
        ▼
Resource Engine
        │
        ├── Source A: 6
        └── Source B: 11
        │
        ▼
Runtime State

No arrow goes from payment back into listed cost.
```

The incorrect architecture, "17 − 6 temporary = 11 effective cost, then recompute downstream from 11", is made
structurally impossible:

- the payment result has no field for it;
- the static audit forbids `effective*`, `netCost`, `adjustedCost` and `discount*` in the module;
- a cross-package test runs real WO6 and WO3 evaluations (17, then `floor(17 / 4) = 4`), pays 6 + 11, and proves both
  earlier results are byte-identical afterwards.

## Resource identity and kinds

Every resource has an exact `resourceKey`: a WO1 context key, case-sensitive and locale-free. There are no aliases,
no display-name lookup and no fuzzy matching.

`ResourceKind` is introduced here, because no resource vocabulary existed in the codebase. It covers the
architecture's categories: `POOL`, `ACTION`, `CAPACITY`, `SLOT`, `TRACKER`, `TEMPORARY_POOL`, `RESERVED_CAPACITY`.
**Kind is metadata only.** It never orders payment, triggers a refresh, expires a temporary pool or clamps anything.
The audit forbids any `.kind` comparison outside snapshot validation. M1's `EntityType.RESOURCE` is a content-entity
type and a different concept.

## Resource state

```
ResourceState { resourceKey, kind, current, minimum, maximum (number | null), reservedCapacity, provenance }
```

- **minimum** is explicit and never assumed to be 0. A tracker may go negative.
- **maximum** is finite, or `null` for an explicitly unbounded resource. When present, `minimum ≤ maximum`.
- **current** satisfies `minimum ≤ current ≤ maximum` at construction. It may exceed the available maximum.
- **reservedCapacity** satisfies `0 ≤ reservedCapacity ≤ maximum − minimum`, and is 0 when omitted. An unbounded
  resource cannot reserve capacity.
- **availableMaximum** is *derived* by `getAvailableMaximum`: `maximum − reservedCapacity`, or null when unbounded. It
  is never stored, and supplying it is rejected as an unknown field.

`createResourceSnapshot({ resources })` validates and normalizes. The result has unique keys ordered by `resourceKey`
(UTF-16 code units, so input order is irrelevant). Identical duplicates collapse; conflicting ones fail closed with
`DUPLICATE_KEY`, never last-write-wins. Everything is finite, `-0` becomes `0`, the result is deep-frozen and
detached, and the caller's objects are never frozen or changed.

```
Nominal Maximum: 20
        │
        ├──── Reserved: 6
        │
        ▼
Available Maximum: 14

Current: 18

Reservation changes capacity.

Reservation does NOT change Current.
```

### Current above the available maximum

Current 18 with maximum 20 and 6 reserved (available maximum 14) is a **legal, preserved state**. WO7 deliberately
does not decide what that state means for restoration, refresh, spending or validation. No operation silently lowers
current:

- restore and refresh treat the ceiling as "nothing more to add" and report `currentAboveCeiling`;
- spend is governed by the minimum only.

Any further Prowess rule for this state, for example how a Mana-Lock-style reservation interacts with spending or
refresh, must be an explicit future subsystem rule.

## Single-resource transitions

Each transition takes `(snapshot, request)` and returns, in the M4-WO1 envelope, a `ResourceTransitionResult`
containing:

- `applied`, `requestedAmount`, `actualAmount`, `shortfall`, `overflow` and `currentAboveCeiling`;
- `before` and `after` states;
- the available maximum before and after;
- the request's provenance;
- `resultingResources`, a new snapshot. When nothing changed, this is the original snapshot itself.

| Operation | Changes | Rules |
| --- | --- | --- |
| `spendResource` | current | amount finite ≥ 0; spendable = `current − minimum`; never below minimum. Insufficient → `applied: false`, `shortfall`, **no change**, status SUCCESS. Zero is a no-op; negative is invalid input, never a restore. |
| `restoreResource` | current | explicit `ceiling` (`NOMINAL_MAXIMUM` / `AVAILABLE_MAXIMUM`) and `overflow` (`CLAMP` / `INVALID`). CLAMP restores up to the ceiling and reports `overflow`; INVALID refuses with `OUT_OF_BOUNDS`. Unbounded: NOMINAL has no ceiling, AVAILABLE is `INVALID_BOUNDARY`. Never lowers current. |
| `setResourceCurrent` | current | explicit value within `[minimum, ceiling]`. The ceiling is the nominal maximum unless `AVAILABLE_MAXIMUM` is explicitly requested. Out of range → `OUT_OF_BOUNDS`. |
| `reserveResourceCapacity` | reservedCapacity | needs a finite maximum (`INVALID_RESERVATION`); cannot exceed `maximum − minimum` (`RESERVATION_EXCEEDS_CAPACITY`). **Current is untouched.** |
| `releaseResourceCapacity` | reservedCapacity | cannot release more than is reserved (`RELEASE_EXCEEDS_RESERVED`). **Current is not restored.** |
| `refreshResource` | current | explicit `target` (`TO_NOMINAL_MAXIMUM` / `TO_AVAILABLE_MAXIMUM`) on a bounded resource. Raises current to the ceiling and **never lowers** it. |

Spend and reserve are different operations, as are restore and release, and refresh (set-to-ceiling) and restore (add
an amount). None calls another or performs a hidden SET.

```
Before:
Maximum 20
Reserved 6
Available Maximum 14
Current 8

Release 6
     │
     ▼

After:
Maximum 20
Reserved 0
Available Maximum 20
Current 8

Capacity returned.
Current resource was not restored.
```

Refresh is always caller-triggered: the engine has no notion of rounds, turns, rests or encounters. `ACTION`
resources never refresh on their own, and `TEMPORARY_POOL` resources never expire on their own. Tests prove both stay
exactly as they were across unrelated operations.

## Payment

```
PaymentRequest { costKey, listedAmount, sources[], provenance? }
PaymentSource  { resourceKey, order, limit?, provenance? }
```

- `costKey` is opaque metadata. `listedAmount` is finite, ≥ 0 and immutable.
- Source order is explicit: `order` ascending, then `resourceKey` in code-unit order as the final tie-breaker. Two
  sources may share an order. Input array order and resource kind never decide.
- Each source pays `min(remaining, current − minimum, limit)`. A source `limit` caps that source for this payment only
  and never changes its state.
- Reserved capacity does **not** reduce what a source can pay, and reserved capacity is never itself spendable.
  Coupling reservation to spendability would silently decide the "current above available maximum" question.
- The same resource twice in one request is `DUPLICATE_PAYMENT_SOURCE`. A source missing from the snapshot is
  `NOT_FOUND`.

`previewResourcePayment` and `applyResourcePayment` call **one** allocation algorithm and differ only in `mode`. Their
allocations are identical by construction, a test pins this, and the static audit pins the single call site.

```
PaymentResult {
  mode, costKey, listedAmount, canPay, totalPaid, shortfall, allocations[], provenance,
  originalResources, resultingResources
}
PaymentAllocation {
  resourceKey, order, requestedRemainingBefore, available, sourceLimit, amountPaid,
  currentBefore, currentAfter, provenance
}
```

```
Listed Cost = 17
       │
       ▼
Payment Sources

Temporary Pool
current 6
order 10
       │ pays 6
       ▼
Remaining Cost = 11
       │
       ▼
Primary Pool
current 20
order 20
       │ pays 11
       ▼
Payment Complete

Final:
Temporary = 0
Primary = 9

Listed Cost = 17
```

A temporary pool pays first only because the caller gave it the lower `order`. With a POOL at order 10 and a
TEMPORARY_POOL at order 20, the POOL pays first.

### Atomicity and insufficient resources

Allocation is computed in full first. The resulting snapshot is built **only when the whole listed amount is
covered**. Otherwise:

- `canPay` is `false`;
- `shortfall` is positive;
- the allocations show the theoretical contributions, for explanation;
- `resultingResources` equals `originalResources`.

```
Cost = 10

Source A = 6
Source B = 2

Potential total = 8
Shortfall = 2
        │
        ▼
CAN PAY? NO
        │
        ▼
No state change

A remains 6
B remains 2
```

Being unable to afford a cost is a **valid runtime outcome** (status SUCCESS), like an unmet Requirement. It is never
a diagnostic, and no `INSUFFICIENT` code exists. A zero listed amount is payable, with nothing allocated. A caller can
chain payments by feeding one result's `resultingResources` into the next.

## Diagnostics

Malformed input, or a request the caller explicitly declared invalid, produces a VALIDATION message (category
RESOURCE). `RULE_ENGINE.*` remains reserved for internal failure.

| Code | Meaning |
| --- | --- |
| `RESOURCE.INVALID_STATE` | malformed state (bounds, kind, non-finite, unknown field) |
| `RESOURCE.DUPLICATE_KEY` | conflicting states for one resourceKey |
| `RESOURCE.NOT_FOUND` | the request names a resource not in the snapshot |
| `RESOURCE.INVALID_AMOUNT` | negative or non-finite amount or listed amount; malformed request |
| `RESOURCE.INVALID_BOUNDARY` | bad ceiling / overflow / target, or AVAILABLE_MAXIMUM / refresh on an unbounded resource |
| `RESOURCE.OUT_OF_BOUNDS` | set-current outside its bounds; restore past its ceiling under INVALID |
| `RESOURCE.INVALID_RESERVATION` | reserving on an unbounded resource |
| `RESOURCE.RESERVATION_EXCEEDS_CAPACITY` | reservation beyond `maximum − minimum` |
| `RESOURCE.RELEASE_EXCEEDS_RESERVED` | releasing more than is reserved |
| `RESOURCE.INVALID_PAYMENT` | malformed payment or source (cost key, order, limit, unknown field) |
| `RESOURCE.DUPLICATE_PAYMENT_SOURCE` | one resource twice in a payment |
| `RESOURCE.NON_FINITE_RESULT` | an operation overflowed |
| `RESOURCE.LIMIT_EXCEEDED` | more than 4,096 resources or 4,096 payment sources |

## Provenance and trace

Provenance is preserved at every level: on resource state, on transition requests (for example, why capacity was
reserved), on payment requests and on each payment source. It is never interpreted.

Transition traces record:
- resource key;
- current before and after;
- minimum and maximum;
- reserved before and after;
- available maximum before and after;
- requested, applied, actual, and shortfall or overflow.

A reservation trace shows `current_after` equal to `current_before`, and a release trace has no restoration entry.

Payment traces follow **payment order**, which is distinct from snapshot order (by key). They record:
- the listed amount;
- one step per source: resource key, order, remaining before, available, limit, current before, paid, current after;
- a settlement step: listed amount, total paid, shortfall, can-pay.

The listed amount appears unchanged throughout. No prose is produced; explanation composition is M4-WO9.

## Numeric safety, determinism, immutability

- Values are finite JavaScript numbers. `null` is allowed only for an unbounded maximum.
- NaN and ±Infinity are rejected, and any non-finite result fails closed. `-0` becomes `0`.
- **Nothing rounds**: fractional resources and payments are exact. Integer-only resources would be an explicit
  content rule.
- The same snapshot and request, in any row or source order, give a byte-identical result, state, allocations,
  diagnostics and trace.
- Inputs are never mutated or frozen. Outputs are deep-frozen and detached, so changing caller objects afterwards
  cannot alter a returned result. Getters are never invoked, and prototype-shaped input is rejected.
- Resources are looked up through an internal key index built once per evaluation. No Map or Set is public, and there
  is no module-level state, lock or engine class.

## PAS ResourceDefinition categories

The pure engine supports all seven categories as plain state plus explicit operations, with no behaviour attached to
the category itself:

| Category | How it is used |
| --- | --- |
| `POOL` | a bounded current value: spend, restore, refresh |
| `ACTION` | a bounded counter a combat system explicitly refreshes each round |
| `CAPACITY` | a value whose maximum matters more than its current |
| `SLOT` | discrete uses modelled through explicit state and validation (no slot-rest rules here) |
| `TRACKER` | any counter, possibly with a negative minimum or an unbounded maximum |
| `TEMPORARY_POOL` | a pool the caller orders first in payment, and clears by explicit operation |
| `RESERVED_CAPACITY` | expressed through `reservedCapacity` and the derived available maximum |

## Future Prowess mappings (documentation only, not implemented)

- **MP / ME.** A listed Spell MP cost of 17 with ME available 6 and MP available 20, paid ME first (order 10) and MP
  second (order 20), allocates ME 6 and MP 11, leaving MP 9. The Spell's listed MP cost stays **17**. "ME" is not a
  special engine resource.
- **AP.** Spell AP is calculated from the final listed MP *before* runtime payment, for example `floor(17 / PRO)`.
  Payment can never lower that listed MP for AP purposes.
- **Sustain.** A recurring listed cost paid through the same mechanism, temporary first and primary second. WO7
  provides the payment; Sustain timing and Concentration are not here.
- **Mana Lock.** Capacity reservation: maximum MP 20, 6 reserved, available maximum 14. The reservation spends nothing,
  and releasing it returns capacity but not current MP. If current exceeds the available maximum after reserving, WO7
  preserves it; any further Mana Lock rule must be defined later, explicitly.
- **Actions.** A combat system calls `refreshResource` at round start. WO7 has no round timing.

## Handoff

- **WO8 Validation Engine:** composes Resource diagnostics with Formula, Keyword, Requirement and Modifier
  diagnostics. WO7 stays local.
- **WO9 Explanation:** composes payment traces with Formula and Modifier traces. WO7 keeps the listed amount,
  allocations, before / after values, shortfall, reservation state and provenance.
- **WO10:** may expose preview and evaluation through HTTP. WO7 has no routes.
- Combining "is this action permitted?" (WO5) with "can it be paid for?" (WO7) is future orchestration.

## Limitations

M4-WO7 does not implement: persistent Character resources; resource authoring UI; Spell costs; Spell AP; Mana
Exertion, Mana Lock or Sustain semantics; Concentration; round timing; automatic AP refresh; automatic
temporary-resource expiration; regeneration rules; Health / damage rules; Formula evaluation or Modifier execution
inside resources; Requirements for using resources; runtime persistence; transactions over many operations (a caller
chains results explicitly); HTTP APIs; Studio UI; combat orchestration. No schema change, no migration.
