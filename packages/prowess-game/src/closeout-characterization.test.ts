import { describe, expect, it, vi } from "vitest";
import { TERMINOLOGY_INVENTORY, legacyTermFor } from "./vocabulary/terminology.js";
import { createProwessDefinitionBundle } from "./bundle/bundle.js";
import { compileAbilityDefinition, evaluateAbilityDefinition } from "./ability/compile.js";
import { evaluateSpellCost } from "./ability/spell-cost.js";
import { compileManeuverCost, evaluateManeuverCost } from "./ability/maneuver-cost.js";
import { compileAbilityExecution, executeAbilityResolution } from "./ability/effect-execution.js";
import { transitionActiveMagic } from "./ability/active-magic.js";
import { activeMagicFixture, caster, d6, next, pool, request, tx } from "./testing/active-magic-fixtures.js";
import PINNED from "./testing/closeout-characterization.json" with { type: "json" };

vi.setConfig({ testTimeout: 900_000 });

/**
 * M5-CLOSEOUT-02 characterization. Generated on the pre-optimization baseline 0847ca7 and committed BEFORE any
 * refactor: every behaviour the closeout optimizations touch is pinned as the SHA-256 of its canonical JSON (returned
 * values, refusal codes / paths / messages, ordering, provenance, traces). A mismatch prints the
 * differing keys; the pinned file may only be regenerated on the baseline. Pure (no Node APIs), like the package.
 */
const canonical = (v: unknown): string => {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v !== null && typeof v === "object") return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`).join(",")}}`;
  return JSON.stringify(v) ?? "null";
};
/** Minimal pure SHA-256 over the UTF-8 bytes of a string (test-only; avoids Node APIs in the pure game package). */
function sha256(text: string): string {
  const bytes = Uint8Array.from(unescape(encodeURIComponent(text)), (ch) => ch.charCodeAt(0));
  const K = Array.from({ length: 64 }, (_, i) => {
    let n = 2, c = 0;
    for (; ; n++) { let p = true; for (let d = 2; d * d <= n; d++) if (n % d === 0) { p = false; break; } if (p && c++ === i) break; }
    return (Math.cbrt(n) % 1) * 2 ** 32 >>> 0;
  });
  const H = [2, 3, 5, 7, 11, 13, 17, 19].map((n) => (Math.sqrt(n) % 1) * 2 ** 32 >>> 0);
  const len = Math.ceil((bytes.length + 9) / 64) * 64;
  const m = new Uint8Array(len); m.set(bytes); m[bytes.length] = 0x80;
  const bits = bytes.length * 8; const view = new DataView(m.buffer);
  view.setUint32(len - 8, Math.floor(bits / 2 ** 32)); view.setUint32(len - 4, bits >>> 0);
  const r = (x: number, n: number) => (x >>> n) | (x << (32 - n));
  const w = new Array<number>(64);
  for (let o = 0; o < len; o += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(o + i * 4);
    for (let i = 16; i < 64; i++) {
      const a = w[i - 15]!, b = w[i - 2]!;
      w[i] = (w[i - 16]! + (r(a, 7) ^ r(a, 18) ^ (a >>> 3)) + w[i - 7]! + (r(b, 17) ^ r(b, 19) ^ (b >>> 10))) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = H as [number, number, number, number, number, number, number, number];
    for (let i = 0; i < 64; i++) {
      const t1 = (h + (r(e, 6) ^ r(e, 11) ^ r(e, 25)) + ((e & f) ^ (~e & g)) + K[i]! + w[i]!) >>> 0;
      const t2 = ((r(a, 2) ^ r(a, 13) ^ r(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
      h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    [a, b, c, d, e, f, g, h].forEach((v, i) => { H[i] = (H[i]! + v) >>> 0; });
  }
  return H.map((v) => v.toString(16).padStart(8, "0")).join("");
}
const sha = (v: unknown) => sha256(canonical(v));

/** The pre-optimization reference implementation of legacy-term lookup (linear scan, first LEGACY match). */
const termToken = (value: string): string => value.toUpperCase().replace(/[ _-]+/g, "_");
function referenceLegacyTermFor(candidate: string) {
  const hit = TERMINOLOGY_INVENTORY.find((e) => e.status === "LEGACY" && termToken(e.term) === termToken(candidate));
  return hit === undefined || hit.canonicalTerm === null ? null : { term: hit.term, canonicalTerm: hit.canonicalTerm };
}

function observations(): Record<string, string> {
  const out: Record<string, unknown> = {};
  const f = activeMagicFixture();
  const L = activeMagicFixture({ manaLock: { kind: "FIXED", amount: 12 }, heavyMp: 17 });
  const defs = f.bundle.definitions;
  const copy = (v: unknown): Record<string, unknown>[] => JSON.parse(JSON.stringify(v)) as Record<string, unknown>[];
  // ---- bundle factory: accepted output and every refusal, in order ------------------------------------------------
  out["bundle.valid"] = createProwessDefinitionBundle({ ruleset: f.ruleset, definitions: copy(defs) });
  out["bundle.reversed"] = createProwessDefinitionBundle({ ruleset: f.ruleset, definitions: copy([...defs].reverse()) });
  out["bundle.duplicates"] = createProwessDefinitionBundle({ ruleset: f.ruleset, definitions: copy([defs[0], ...defs, defs[5], defs[defs.length - 1]]) });
  const legacy = copy(defs);
  (legacy[3]!.payload as Record<string, unknown>).rules = { affinity: "Emission", nested: ["ok", "player.die"] };
  out["bundle.legacy"] = createProwessDefinitionBundle({ ruleset: f.ruleset, definitions: legacy });
  const injected = copy(defs);
  injected[2] = { ...injected[2], entityVersionId: "00000000-0000-4000-8000-0000000fffff" };
  out["bundle.injected"] = createProwessDefinitionBundle({ ruleset: f.ruleset, definitions: injected });
  out["bundle.otherRuleset"] = createProwessDefinitionBundle({ ruleset: L.ruleset, definitions: copy(defs) });
  out["bundle.notArray"] = createProwessDefinitionBundle({ ruleset: f.ruleset, definitions: {} });
  // ---- compilers over the same exact bundle (outer and nested boundaries) ------------------------------------------
  const spell = { ...f.ability("fixture.wo13.spell.sustained"), definitions: f.bundle, ruleset: f.ruleset } as Record<string, unknown>;
  const { execution, ...spellNoEx } = spell;
  out["compile.spell"] = compileAbilityDefinition(spellNoEx);
  out["evaluate.spell"] = evaluateAbilityDefinition(spellNoEx);
  out["spellCost.spell"] = evaluateSpellCost(spellNoEx);
  out["executionPlan.spell"] = compileAbilityExecution(spell);
  out["execute.spell"] = executeAbilityResolution(spell);
  out["execution.input"] = execution;
  const maneuver = { ...f.ability("fixture.wo11.maneuver.powerful_blow"), definitions: f.bundle, ruleset: f.ruleset } as Record<string, unknown>;
  const { execution: _m, ...maneuverNoEx } = maneuver; void _m;
  out["maneuverCost.plan"] = compileManeuverCost({ ...maneuverNoEx, signatureManeuver: false });
  out["maneuverCost.result"] = evaluateManeuverCost({ ...maneuverNoEx, signatureManeuver: false });
  // ---- refusals that must still happen at every boundary --------------------------------------------------------------
  const unsafe = copy(defs);
  Object.defineProperty(unsafe[1]!, "payload", { get: () => ({}), enumerable: true });
  out["refuse.unsafeBundle"] = compileAbilityDefinition({ ...spellNoEx, definitions: { rulesetProvenance: f.bundle.rulesetProvenance, definitions: unsafe } });
  out["refuse.mixedRuleset"] = compileAbilityDefinition({ ...spellNoEx, ruleset: L.ruleset });
  out["refuse.foreignBundle"] = evaluateSpellCost({ ...spellNoEx, definitions: L.bundle });
  out["refuse.protoInRequest"] = compileAbilityDefinition(JSON.parse(`{"__proto__":{"x":1},"contractVersion":1}`));
  out["refuse.legacyBundleInRequest"] = executeAbilityResolution({ ...spell, definitions: { rulesetProvenance: f.bundle.rulesetProvenance, definitions: legacy } });
  // ---- WO13 lifecycle traces (single-compile R4 must reproduce these exactly) ---------------------------------------
  const FULL = pool({ AP: 3, ME: 3, MP: 20 });
  const a = tx(f, { state: null, resources: FULL }, { kind: "ACTIVATE", activeEffectKey: "s", ability: f.ability("fixture.wo13.spell.sustained") });
  const m = tx(f, next(a), { kind: "MAINTENANCE" });
  const c = tx(f, next(m), { kind: "CONCENTRATION_TEST", trigger: "TAKES_DAMAGE", target: "s", roll: d6(1) });
  out["wo13.activate"] = a; out["wo13.maintenance"] = m; out["wo13.concentration"] = c;
  out["wo13.instant"] = tx(f, { state: null, resources: FULL }, { kind: "ACTIVATE", activeEffectKey: "i", ability: f.ability("fixture.wo13.spell.instant") });
  const lk = tx(L, { state: null, resources: pool({ AP: 3, ME: 0, MP: 30 }) }, { kind: "ACTIVATE", activeEffectKey: "l", ability: L.ability("fixture.wo13.spell.locked") });
  out["wo13.lock"] = lk;
  const ch = tx(L, { state: null, resources: pool({ AP: 3, ME: 0, MP: 20 }) }, { kind: "CHANNEL_START", channelKey: "c", ability: L.ability("fixture.wo13.spell.channel", 4, null) });
  out["wo13.channelStart"] = ch;
  out["wo13.channelInvest"] = tx(L, next(ch), { kind: "CHANNEL_INVEST", amount: 3 });
  out["wo13.refuse.lockCanonical"] = transitionActiveMagic(request(f, { state: null, resources: FULL }, { kind: "ACTIVATE", activeEffectKey: "x", ability: f.ability("fixture.wo13.spell.locked") }));
  out["wo13.refuse.pro"] = transitionActiveMagic(request(f, { state: null, resources: FULL, caster: caster({ PRO: 5 }) }, { kind: "ACTIVATE", activeEffectKey: "x", ability: f.ability("fixture.wo13.spell.rounds") }));
  out["wo13.refuse.maneuver"] = transitionActiveMagic(request(f, { state: null, resources: FULL }, { kind: "ACTIVATE", activeEffectKey: "x", ability: { ...f.ability("fixture.wo11.maneuver.basic"), execution: { targets: [{ targetKey: "a" }], inputs: [] } } }));
  return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, sha(v)]));
}

describe("M5-CLOSEOUT-02 characterization (pinned on baseline 0847ca7)", () => {
  it("the test-local SHA-256 matches published vectors", () => {
    expect(sha256("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    expect(sha256("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(sha256("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq")).toBe("248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1");
  });

  it("hashes non-ASCII text as UTF-8", () => {
    expect(sha256("é")).toBe("4a99557e4033c3539de2eb65472017cad5f9557f7a0625a09f1c3f6e2ba69c4c");
  });

  it("legacy-term lookup equals the baseline linear scan for every inventory term, spelling variant and non-term", () => {
    const candidates = new Set<string>(["", "x", "spell.damage", "Player Die", "PLAYER_DIE", "player-die", "player  die", "Emission", "emission", "EMISSION", "Evocation", "keyword.emission", "_", "-", "__a__"]);
    for (const e of TERMINOLOGY_INVENTORY) for (const v of [e.term, e.term.toUpperCase(), e.term.toLowerCase(), e.term.replace(/ /g, "_"), e.term.replace(/ /g, "-"), ` ${e.term}`, `${e.term}s`]) candidates.add(v);
    for (const c of candidates) expect(legacyTermFor(c), c).toEqual(referenceLegacyTermFor(c));
  });

  it("every characterized output is identical to the baseline", () => {
    const fresh = observations();
    expect(fresh).toEqual(PINNED);
  });
});
