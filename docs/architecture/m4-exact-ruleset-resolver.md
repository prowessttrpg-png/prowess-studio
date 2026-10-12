# M4 Exact Ruleset Resolver (M4-WO2)

**Status:** M4-WO2 — Exact Ruleset Resolver. Invariants M4-I16 – M4-I25 are catalogued, with their automated guards,
in `m4-rules-engine-core.md`.

## Purpose

M4-WO2 answers one question: *when an evaluation says it uses a particular Prowess Ruleset context, exactly which
EntityVersions does that mean?* The answer is deterministic and historically reproducible. It connects the pure
`RulesetContext` contract of M4-WO1 to M2's exact Ruleset / Manifest / Release system.

It resolves **identity and provenance only**. No EntityVersion payload is read or interpreted; no formula, requirement,
modifier, resource or game rule exists here.

## Architecture

```
M1  Entity / EntityVersion
        │
        ▼
M2  Ruleset / Manifest / Release          (authority: inheritance, frozen composition, hashes)
        │
        ▼
@prowess/db  ruleset-context/             (application resolver — reads M2, builds the context)
        │
        ▼
M4  RulesetContext                        (@prowess/rules — one canonical, pure, deep-frozen value)
        │
        ▼
future pure evaluators
```

`@prowess/rules` stays database-free: it never discovers a context, it only validates and indexes one. The resolver
lives in `@prowess/db` (`packages/prowess-db/src/ruleset-context/`), which now depends on `@prowess/rules` — the
dependency direction is unchanged (`@prowess/model ← @prowess/rules ← @prowess/db ← apps/studio`).

| File | Role |
| --- | --- |
| `service.ts` | the two public resolvers; calls only M2's public services |
| `composition.ts` | pure, database-free mapping of an exact composition to the context, fail-closed |
| `repository.ts` | two batched, read-only identity lookups (Entity, EntityVersion owner) |

## Two exact modes — and why a Ruleset id alone is insufficient

```ts
resolveRulesetContextFromManifest(manifestId): Promise<RulesetContext>   // development / playtest
resolveRulesetContextFromRelease(releaseId):   Promise<RulesetContext>   // published / historical
```

There is deliberately no `resolveRulesetContext(rulesetId)`, and no "current", "active", "default" or "latest" variant.
A Ruleset owns many Manifests and Releases over time; resolving from its id would force the resolver to *choose* one —
exactly the hidden-latest behaviour M4 forbids. The caller names the exact Manifest or Release; governance (M2) has
already decided what that composition contains.

## Manifest mode

```
Exact Manifest M3
       │
       ▼
M2 Effective Manifest Resolver
       │
       ├── Explicit A → A3
       ├── Inherited B → B1
       └── Inherited C → C4
       │
       ▼
M4 RulesetContext
       │
       ├── Entity A / Version A3
       ├── Entity B / Version B1
       └── Entity C / Version C4
```

1. Load the exact Manifest (unknown or malformed id → `RULESET_MANIFEST.NOT_FOUND`).
2. Ask M2 for its **effective** composition with `getEffectiveManifestEntries` — the M2-WO3 algorithm: explicit pins,
   plus pins inherited through the chain of **exact** pinned parent manifests, nearest pin winning. M4 has no
   inheritance code of its own.
3. Record, for every rule, the Ruleset and Manifest that **supplied** the pin (one header read per distinct supplying
   manifest — bounded by inheritance depth, not entry count).
4. Hydrate exact identity (canonical key, type, version ownership) in two batched queries.
5. Build the context through `createRulesetContext`.

Exact parent pinning means a newer parent manifest never changes an existing child: if child C1 pins parent P1, a later
P2 is irrelevant to C1. Manifest mode imposes **no publication rule** — a development Manifest may pin exact DRAFT
content. An empty Manifest resolves to a context with zero rules. An inheritance cycle (only possible through corrupt
data) surfaces M2's `RULESET_MANIFEST.INHERITANCE_CYCLE`; the resolver never repairs or guesses.

M2 stores no hash for an unpublished Manifest, so a Manifest-mode context has `manifestHash: null` and `release: null`.
None is invented.

## Release mode

```
Exact Release R1
       │
       ├── verify stored manifest hash
       │
       ▼
Frozen Release Composition
       │
       ├── A → A2
       ├── B → B4
       └── C → C1
       │
       ▼
RulesetContext R1

Later:
A5 / B7 / Release R2

DOES NOT ALTER R1.
```

1. **Verify first**: `verifyRulesetReleaseManifestHash` (M2-WO8). A mismatch throws
   `RULESET_RESOLUTION.RELEASE_INTEGRITY_FAILURE` and no context is produced. Unknown id → `RULESET_RELEASE.NOT_FOUND`.
2. Read the Release with `getRulesetRelease`: its **frozen** composition is the entry set of its own flattened,
   parentless release manifest, written once at publication.
3. Map that composition — never what any Manifest (the base manifest or anything else) resolves to today.
4. Carry the stored `manifestHash` **verbatim** and the release identity `{ releaseId, releaseNumber, versionLabel }`.

**The resolver never computes a hash.** It asks M2 "is this Release's hash valid?" and does not define what the hash
means. A Release's manifest hash proves **M2 composition integrity**; it is not an evaluation-result hash, and M4-WO2
introduces no evaluation fingerprint.

Why the call graph is pinned statically: a release manifest is already flattened, so re-deriving it through the
effective-manifest resolver would produce the same pins *today*. That regression (substituting live manifest state for
the frozen composition) is therefore invisible at runtime and is guarded by the M4-WO2 static audit, which requires
Release mode to verify first, read `release.composition`, and never call the Manifest resolver.

## Historical evaluation

```
2026
Ruleset Context R1
Rule A → Version A2
             │
             ▼
          Evaluation

Later:
Rule A → Version A8

Re-evaluate R1:
still Version A2.
```

The same exact Manifest or Release resolves to a deep-equal context however much later content exists — newer
EntityVersions, newer parent manifests, newer development manifests and newer releases change nothing. Manifest and
Release mode may legitimately differ for the same Ruleset (development content advances while a Release stays frozen),
two Rulesets resolve independently, and the same exact EntityVersion may appear in different Rulesets' contexts with
distinct Ruleset / Manifest provenance.

## RulesetContext mapping

There is one canonical `RulesetContext` (the M4-WO1 type); `@prowess/db` defines no parallel type and never casts.

| Context field | Manifest mode | Release mode |
| --- | --- | --- |
| `rulesetId` | the Manifest's Ruleset | the Release's Ruleset |
| `manifestId` | the requested Manifest | the Release's own frozen release manifest |
| `manifestHash` | `null` (M2 has none for a Manifest) | M2's stored hash, verbatim |
| `rulesetVersionLabel` | the Ruleset's label (set at creation; never parsed) | same |
| `release` | `null` | `{ releaseId, releaseNumber, versionLabel }` |
| `rules[]` | effective composition | frozen composition |

Each `ResolvedRuleReference` carries exact `entityId`, `entityVersionId`, `entityType` and `canonicalKey`, plus
`sourceRulesetId` / `sourceManifestId`: in Manifest mode the Ruleset and Manifest that supplied the pin (so an
inherited rule names the exact ancestor manifest); in Release mode the Release's Ruleset and release manifest. Display
names, aliases and payloads are never read.

**Inheritance provenance** is preserved without changing the M4-WO1 contract: a rule is EXPLICIT exactly when its
`sourceManifestId` equals the context's `manifestId`, otherwise INHERITED from the named manifest. M2's numeric
resolution depth is not carried (it is recoverable from the exact manifest chain); no contract extension was needed.

**One documented contract refinement (M4-WO1):** `createRulesetContext` now also rejects two rules sharing a canonical
key, so canonical-key lookup can never be ambiguous. M1 already makes canonical keys unique; this is a fail-closed
check, not a second uniqueness system.

## Resolved-reference identity

`entityId` + `entityVersionId` are the identity. `canonicalKey` is a stable semantic handle for lookup and display,
never a substitute for exact version identity. No alias, display name, title or description ever identifies a rule.

Pure lookups on an already-resolved context (in `@prowess/rules`, no persistence):

- `findResolvedRule(context, entityId)` — exact id (UUIDs compare case-insensitively);
- `findResolvedRuleByCanonicalKey(context, canonicalKey)` — exact string; a case-changed key is a different key.

Both return `null` for "not part of this Ruleset". Absence never falls back to a latest version, a Canon version, a
base Ruleset or a global rule — only M2 inheritance, already applied in the effective composition, can place a rule in
a context. A resolver malfunction is never a `null`: it is a thrown, controlled error at resolution time.

## Composition integrity — fail closed

Before building, the resolver checks the composition is unambiguous; any violation throws
`RULESET_RESOLUTION.INVALID_COMPOSITION` and no context is returned:

- an Entity pinned twice (never "pick one");
- a pinned Entity or EntityVersion that does not exist;
- an EntityVersion that belongs to a different Entity (the database's composite foreign key already forbids this; the
  check is defence in depth);
- two Entities claiming one canonical key;
- anything the M4-WO1 constructor rejects.

## Errors

| Condition | Code | Source |
| --- | --- | --- |
| Manifest not found / malformed id | `RULESET_MANIFEST.NOT_FOUND` | M2 (reused) |
| Inheritance cycle / missing parent | `RULESET_MANIFEST.INHERITANCE_CYCLE` / `INVALID_PARENT_MANIFEST` | M2 (reused) |
| Release not found / malformed id | `RULESET_RELEASE.NOT_FOUND` | M2 (reused) |
| Release hash mismatch | `RULESET_RESOLUTION.RELEASE_INTEGRITY_FAILURE` | M4-WO2 (new) |
| Ambiguous / malformed composition | `RULESET_RESOLUTION.INVALID_COMPOSITION` | M4-WO2 (new) |

M2 has no release-integrity *error* code (its verifier returns `{ valid: false }`; each consumer maps it — the
precedent is `MIGRATION_PLAN.MANIFEST_INTEGRITY_FAILURE`), hence the minimal new `RULESET_RESOLUTION.*` vocabulary in
`@prowess/model`. These are application / governance-resolution failures, deliberately distinct from the pure engine's
`RULE_ENGINE.*` errors. No Rules route exists; the two codes are mapped to 409 only because the central HTTP status map
is exhaustive (M4-WO10 owns the Rules API).

## No hidden latest, no Canon, no import

The resolver contains no latest / newest / current / active / default selection and no descending ordering; M2's own
"latest" conveniences (`getLatestRulesetManifest`, `getLatestRulesetRelease`) are never used. It never asks which
source is governing, which conflict won, which CanonPolicy is active or which CanonDecision is newest — that governance
output is already embodied in the exact Manifest or Release. It never reads M3 import data (batches, candidates,
decisions, match runs). All of this is enforced by `apps/studio/tests/unit/m4-wo2-static.test.ts`.

## Read-only and deterministic

Resolution issues SELECTs only. The integration suite fingerprints **every** application table before and after
repeated Manifest (with inheritance) and Release resolution: byte-identical. The same persisted inputs give a
deep-equal, deep-frozen, JSON-serializable context ordered by Entity id regardless of database row order; no Prisma
object, class instance or timestamp enters it, and no clock is read.

## Performance approach

Query count is independent of composition size: M2's effective resolver reads one entry set per inheritance level;
the supplying-manifest headers are read once per distinct manifest; identity hydration is exactly two batched
`IN (...)` queries. The integration suite proves a 1,200-entry Manifest uses the same number of queries as a 2-entry one
(no wall-clock SLA). Nothing is cached or persisted — a context is an evaluation value, not stored governance state.

## Limitations

M4-WO2 does not: interpret EntityVersion payloads; evaluate formulas; evaluate requirements; apply modifiers; process
resources; select Canon; materialize imported content; persist or cache a RulesetContext; add an evaluation
fingerprint; create HTTP routes; create Studio UI. No schema change, no migration.

Ruleset Release / version labels and `RULES_ENGINE_CONTRACT_VERSION` remain unrelated version spaces.

## M4-WO3 handoff

The Formula Engine receives an exact `RulesetContext` (from either mode) and addresses rules through its exact
references — by Entity id or exact canonical key — then requests the exact structured definitions it needs by
`entityVersionId`. It must not re-resolve, widen or "refresh" a context.
