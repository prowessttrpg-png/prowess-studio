import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { activeMagicFixture, caster, d6, next, pool, tx, type Fixture, type Step } from "../../../prowess-game/src/testing/active-magic-fixtures.js";

/**
 * M5-WO13 Rules Inspector fixtures — representative active-magic transitions regenerated from content and the real
 * transition (apps/studio/tests/integration/m5-wo13-active-magic-api.test.ts replays every M4 Formula, every WO3 runtime
 * plan and every WO2 Concentration Save through the existing evaluate endpoint): A Sustained activation + ME-first upkeep ·
 * B ROUNDS countdown to EXPIRED · C Mana Lock reserve + release (TEST lock rule) · D Concentration failure ending only the
 * disrupted Effect · E Channel 3 + 2 → COMPLETE · F Channel failure losing progress. Set M5_WO13_WRITE_FIXTURE=1 to
 * rewrite it deliberately.
 */
const path = resolve(import.meta.dirname, "../../../../apps/studio/tests/integration/fixtures/m5-wo13-active-magic-traces.json");
type Run = (f: Fixture, g: Fixture, l: Fixture) => { name: string; transitions: ReturnType<typeof tx>[] };
const FULL = pool({ AP: 3, ME: 3, MP: 20 });
const act = (f: Fixture, s: Step, key: string, spell: string, pro = 4) => tx(f, s, { kind: "ACTIVATE", activeEffectKey: key, ability: f.ability(spell, pro) });
const TRACES: readonly Run[] = [
  (f) => { const a = act(f, { state: null, resources: FULL }, "s", "fixture.wo13.spell.sustained_heavy"); return { name: "A", transitions: [a, tx(f, next(a), { kind: "MAINTENANCE" })] }; },
  (f) => { const a = act(f, { state: null, resources: FULL }, "r", "fixture.wo13.spell.rounds"); const r1 = tx(f, next(a), { kind: "ROUND_END" }), r2 = tx(f, next(r1), { kind: "ROUND_END" }); return { name: "B", transitions: [a, r1, r2, tx(f, next(r2), { kind: "ROUND_END" })] }; },
  (_f, _g, l) => { const c = caster({}, 36); const a = tx(l, { state: null, resources: pool({ AP: 3, ME: 0, MP: 40 }), caster: c }, { kind: "ACTIVATE", activeEffectKey: "lock", ability: l.ability("fixture.wo13.spell.locked") }); return { name: "C", transitions: [a, tx(l, { state: a.state, resources: pool({ AP: 3, ME: 0, MP: 16 }, 12), caster: c }, { kind: "EXTERNAL_END", activeEffectKey: "lock", end: "DISPELLED", sourceKey: "spell.dispel" })] }; },
  (f) => { const c = caster({ RES: 6 }); const a = tx(f, { state: null, resources: FULL, caster: c }, { kind: "ACTIVATE", activeEffectKey: "A", ability: f.ability("fixture.wo13.spell.sustained") }); const b = tx(f, next(a, c), { kind: "ACTIVATE", activeEffectKey: "B", ability: f.ability("fixture.wo13.spell.sustained_b") }); return { name: "D", transitions: [a, b, tx(f, next(b, c), { kind: "CONCENTRATION_TEST", trigger: "TAKES_DAMAGE", target: "B", roll: d6(1) })] }; },
  (_f, g) => { const c = caster(); const s = tx(g, { state: null, resources: pool({ AP: 3, ME: 0, MP: 20 }), caster: c }, { kind: "CHANNEL_START", channelKey: "ch", ability: g.ability("fixture.wo13.spell.channel", 4, null) }); const i = tx(g, next(s, c), { kind: "CHANNEL_INVEST", amount: 3 }); const r = tx(g, next(i, c), { kind: "ROUND_END" }); return { name: "E", transitions: [s, i, r, tx(g, { state: r.state, resources: pool({ AP: 3, ME: 0, MP: 20 }), caster: c }, { kind: "CHANNEL_INVEST", amount: 2 })] }; },
  (_f, g) => { const c = caster({ PRO: 3 }); const s = tx(g, { state: null, resources: pool({ AP: 4, ME: 0, MP: 20 }), caster: c }, { kind: "CHANNEL_START", channelKey: "ch", ability: g.ability("fixture.wo13.spell.channel", 3, null) }); const i = tx(g, next(s, c), { kind: "CHANNEL_INVEST", amount: 4 }); return { name: "F", transitions: [s, i, tx(g, next(i, c), { kind: "CONCENTRATION_TEST", trigger: "STUNNED", target: "CHANNEL", roll: d6(1) })] }; },
];
describe("M5-WO13 Inspector fixtures explain every active-magic transition", () => {
  it("regenerates stable transition traces A–F with every M4 Formula, WO3 plan and WO2 Save", () => {
    const f = activeMagicFixture({ heavyMp: 14 }), g = activeMagicFixture({ heavyMp: 17 }), l = activeMagicFixture({ manaLock: { kind: "FIXED", amount: 12 } });
    const build = () => TRACES.map((run) => { const r = run(f, g, l); return { trace: r.name, transitions: r.transitions }; });
    const fresh = JSON.parse(JSON.stringify(build())) as unknown;
    if (process.env.M5_WO13_WRITE_FIXTURE === "1") writeFileSync(path, `${JSON.stringify(fresh)}\n`);
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual(fresh);
    expect(build()).toEqual(fresh);
  }, 900_000);
});
