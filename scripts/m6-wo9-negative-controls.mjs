/** Permanent M6-WO9 mutation matrix (M6-I129 – M6-I150). CLOSEOUT-03 harness: one green baseline per distinct guard,
 * each control mutates one uniquely anchored REAL source location, the intended guard must fail for the named
 * behavioural / architectural reason, and every file — and the whole working tree — is restored byte-for-byte.
 * Domain mutations run the real M5 / M4-backed card tests; Studio mutations run the card UI and the WO9 static gate.
 * Native PostgreSQL behaviour (Character scoping, no writes) stays independently mandatory in the DB / API suites. */
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { applyEdits, runControls, vitestGuard } from "./lib/control-harness.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = ["--maxWorkers=1", "--no-file-parallelism", "--reporter=dot"];
const options = { timeout: 600_000, ciEnv: false };
const GAME_TESTS = ["src/card-phase-b.test.ts", "src/card-language.test.ts", "src/card-projection.test.ts"];
const game = (pattern) => vitestGuard(root, "packages/prowess-game", [...GAME_TESTS, "-t", pattern.source, ...args], options);
const architecture = vitestGuard(root, "apps/studio", ["tests/unit/m6-wo9-static.test.ts", "-t", "W9-", ...args], options);
const ui = vitestGuard(root, "apps/studio", ["tests/unit/m6-wo9-cards-ui.test.tsx", ...args], options);

const G = "packages/prowess-game/src/", CARD = G + "card/", IMP = G + "character/action-improvement.ts";
const SERVICE = "packages/prowess-db/src/character/card-service.ts";
const UI = "apps/studio/app/characters/_components/cards/", FORMAT = "apps/studio/app/characters/_lib/card-format.ts";
const SHEET = "apps/studio/app/characters/_components/sheet/";
const CARDS_ROUTE = "apps/studio/app/api/characters/[characterId]/cards/route.ts";

// [name, file, edits, guard, intended test / contract pattern]
const rows = [
  // ---- Character, Release and revision identity ------------------------------------------------------------------------
  ["01 cards attributed to another Release", SERVICE, [["characterReleaseId: equipped.c.rulesetReleaseId", "characterReleaseId: equipped.bundle.rulesetProvenance.rulesetId"]], architecture, /W9-I146/],
  ["02 another Release's revision re-evaluated against the Character's", SERVICE, [["if (releaseId !== null && releaseId !== ctx.c.rulesetReleaseId) return", "if (releaseId === null && releaseId !== ctx.c.rulesetReleaseId) return"]], architecture, /W9-I145/],
  ["03 a retired Ability's revision served as CURRENT", SERVICE, [['current: rev === null ? null : slot(rev.payload, rev.characterReleaseId, rev.revisionNumber, a.status === "ACTIVE" ? "CURRENT" : "HISTORICAL")', 'current: rev === null ? null : slot(rev.payload, rev.characterReleaseId, rev.revisionNumber, "CURRENT")']], architecture, /W9-I145/],
  ["04 ability link opens a draft or historical revision", FORMAT, [['e.abilityId === q.ability && (e.state === "ACTIVE" || e.state === "RETIRED")', "e.abilityId === q.ability"]], architecture, /W9-I145/],
  ["05 retired Ability presented as playable", FORMAT, [['e.status === "ACTIVE" ? "ACTIVE" : "RETIRED"', '"ACTIVE"']], ui, /drafts, retired Abilities and history are opt-in|lists only the cards usable now|retired Ability's \?ability link/],
  ["06 drafts listed as usable now", FORMAT, [['export const USABLE_STATES: readonly EntryState[] = ["ACTIVE", "EQUIPPED", "AVAILABLE"];', 'export const USABLE_STATES: readonly EntryState[] = ["ACTIVE", "EQUIPPED", "AVAILABLE", "DRAFT"];']], ui, /lists only the cards usable now/],
  ["07 unknown card key falls back to the first card", FORMAT, [["if (q.card) return entries.find((e) => e.key === q.card) ?? null;", "if (q.card) return entries.find((e) => e.key === q.card) ?? entries[0] ?? null;"]], ui, /an unknown card key opens nothing/],
  // ---- Weapon / Attack identity ----------------------------------------------------------------------------------------
  ["08 Attack card names the Attack as its Weapon", CARD + "equipment.ts", [["        weapon: weaponRef,\n        attack: attackRef,", "        weapon: attackRef,\n        attack: attackRef,"]], game(/acceptance 1: exact Weapon \+ Attack identity/), /acceptance 1: exact Weapon \+ Attack identity/],
  ["09 Attack card key loses the exact Weapon", CARD + "equipment.ts", [["`ATTACK:${weaponRef.entityVersionId}:${attackRef.entityVersionId}:${hand}`", "`ATTACK:${attackRef.entityVersionId}:${attackRef.entityVersionId}:${hand}`"]], game(/acceptance 1: exact Weapon \+ Attack identity/), /acceptance 1: exact Weapon \+ Attack identity/],
  ["10 damage profile identity substituted", CARD + "equipment.ts", [["damage: a.damage.map((d) => ({ profileKey: d.profileKey, damageType: d.damageType, status: d.status,", "damage: a.damage.map((d) => ({ profileKey: d.damageType, damageType: d.damageType, status: d.status,"]], game(/acceptance 1: exact Weapon \+ Attack identity/), /acceptance 1: exact Weapon \+ Attack identity/],
  // ---- no client mechanics, no fabricated numbers ------------------------------------------------------------------------
  ["11 browser recalculates an AP cost", UI + "CardFace.tsx", [[null, '\nexport const cheaperAp = (card: CardDto) => (card.costs.ap.status === "AVAILABLE" ? card.costs.ap.value - 1 : null);\n']], architecture, /W9-I131/],
  ["12 unresolved cost shown as a plausible zero", FORMAT, [['return v.status === "AVAILABLE" ? String(v.value) : v.status === "DEFERRED" ? "Deferred" : "—";', 'return v.status === "AVAILABLE" ? String(v.value) : v.status === "DEFERRED" ? "Deferred" : "0";']], ui, /General Actions: legitimate values/],
  ["13 unresolved Spell MP replaced by a plausible zero", CARD + "projection.ts", [['mp: ok && c !== null ? available(c.finalMpCost) : unavailable("CARD.COST_UNRESOLVED", why),', "mp: ok && c !== null ? available(c.finalMpCost) : available(0),"]], game(/an unpriceable Spell|an incomplete draft is INCOMPLETE/), /an unpriceable Spell|an incomplete draft is INCOMPLETE/],
  // ---- generated rules language ------------------------------------------------------------------------------------------
  ["14 Saving Throw language inverted", CARD + "language.ts", [["sentence(`if the save fails, the Effect succeeds: ${success}`), sentence(`if the save succeeds, the Effect fails: ${failure}`)", "sentence(`if the save fails, the Effect succeeds: ${failure}`), sentence(`if the save succeeds, the Effect fails: ${success}`)"]], game(/Saving Throw: the Effect SUCCEEDS when the defender's save FAILS/), /Saving Throw: the Effect SUCCEEDS when the defender's save FAILS/],
  ["15 Weapon Attack save sides swapped", CARD + "equipment.ts", [["onDefenderSaveFails: r.onFailure, onDefenderSaveSucceeds: r.onSuccess", "onDefenderSaveFails: r.onSuccess, onDefenderSaveSucceeds: r.onFailure"]], game(/decision C4/), /decision C4/],
  ["16 SUCCESS_ONLY continues after a failure", CARD + "semantics.ts", [['return { afterSuccess: forward, afterFailure: { kind: "END", termination: "SUCCESS_ONLY_FAILURE" } };', "return { afterSuccess: forward, afterFailure: forward };"]], game(/each Behavior maps to its exact transitions/), /each Behavior maps to its exact transitions/],
  ["17 BRANCH destinations crossed", CARD + "semantics.ts", [['{ afterSuccess: { kind: "EFFECT", effectKey: n.branch.success }, afterFailure: { kind: "EFFECT", effectKey: n.branch.failure } }', '{ afterSuccess: { kind: "EFFECT", effectKey: n.branch.failure }, afterFailure: { kind: "EFFECT", effectKey: n.branch.success } }']], game(/each Behavior maps to its exact transitions/), /each Behavior maps to its exact transitions/],
  ["18 a chain Effect dropped", CARD + "semantics.ts", [["const steps = nodes.map((n, i): ChainStepSemantics => ({", "const steps = nodes.slice(1).map((n, i): ChainStepSemantics => ({"]], game(/each Behavior maps to its exact transitions|multiple targets/), /each Behavior maps to its exact transitions|multiple targets/],
  ["19 untriggered Effect worded as a failure", CARD + "semantics.ts", [["notTriggered: n.trigger === null ? null : nextOf(n.successor),", 'notTriggered: n.trigger === null ? null : { kind: "END", termination: "STOP" },']], game(/a chain-result trigger reads as a condition/), /a chain-result trigger reads as a condition/],
  ["20 delivery miss treated as an Effect failure", CARD + "language.ts", [["every other Effect is not delivered — not a failure — and the chain ends for that target", "every other Effect fails and the chain ends for that target"]], game(/delivery: Effects reusing the delivery roll/), /delivery: Effects reusing the delivery roll/],
  ["21 Maneuver groups rendered as a Spell chain", CARD + "projection.ts", [['rules.value.kind === "MANEUVER_GROUPS" ? renderManeuverRules(rules.value, lang)', 'rules.value.kind === "MANEUVER_GROUPS" ? renderSpellRules(rules.value as never, lang)']], architecture, /W9-I136/],
  ["22 Powerful Blow constituents reordered", CARD + "semantics.ts", [["      actionKeys: g.actionKeys,", "      actionKeys: [...g.actionKeys].reverse(),"]], game(/a Powerful Blow is ONE resolution group/), /a Powerful Blow is ONE resolution group/],
  // ---- Mage Art ------------------------------------------------------------------------------------------------------------
  ["23 Mage Art card fabricated as available", CARD + "mage-art.ts", [['      availability: "UNAVAILABLE" as const,', '      availability: "AVAILABLE" as const,']], game(/acceptance 2: Mage Arts are UNAVAILABLE/), /acceptance 2: Mage Arts are UNAVAILABLE/],
  // ---- Action improvements --------------------------------------------------------------------------------------------------
  ["24 improvement prerequisites bypassed", IMP, [['prerequisites.every((x) => x.satisfied === true) ? "ELIGIBLE" : "INELIGIBLE"', '"ELIGIBLE"']], game(/acceptance 4|acceptance 5/), /acceptance 4|acceptance 5/],
  ["25 unmet rank without a path classified FUTURE", IMP, [['const progression: PrerequisiteProgression = satisfied === null ? "UNRESOLVED" : satisfied ? "MET" : "UNDETERMINED";', 'const progression: PrerequisiteProgression = satisfied === null ? "UNRESOLVED" : satisfied ? "MET" : "REACHABLE";']], game(/acceptance 4/), /acceptance 4/],
  ["26 unreachable Level classified FUTURE", IMP, [['satisfied ? "MET" : withinRange ? "REACHABLE" : "UNREACHABLE"', 'satisfied ? "MET" : "REACHABLE"']], game(/acceptance 5/), /acceptance 5/],
  ["27 undetermined progression excluded as UNAVAILABLE", IMP, [['unmet.every((x) => x.progression === "REACHABLE") ? "FUTURE" : "UNRESOLVED";', 'unmet.every((x) => x.progression === "REACHABLE") ? "FUTURE" : "UNAVAILABLE";']], game(/acceptance 4/), /acceptance 4/],
  ["28 unsupported operation silently applied", IMP, [['if (m.kind === "RULE_OPERATION") return { ...base, operationKey: m.operationKey, support: "UNSUPPORTED"', 'if (m.kind === "RULE_OPERATION") return { ...base, operationKey: m.operationKey, support: "APPLIED"']], game(/acceptance 5/), /acceptance 5/],
  ["29 explicit cost applied to a non-overridable parent", IMP, [['const overridable = parent !== null && parent.costOverridableByExplicitRule && parent.actionPointCost.model === "FIXED";', "const overridable = parent !== null;"]], game(/acceptance 5/), /acceptance 5/],
  ["30 ineligible improvement changes the Action's AP", CARD + "action.ts", [['    .filter((e) => e.status === "ACTIVE")\n', '    .filter((e) => e.status !== "UNAVAILABLE")\n']], game(/acceptance 6/), /acceptance 6/],
  ["31 improvement attached to every Action", IMP, [["(d.payload as unknown as ActionImprovementPayload).action.entityId === request.action.entityId", "true"]], game(/attaches each improvement to its exact parent only/), /attaches each improvement to its exact parent only/],
  // ---- read-only Character-scoped APIs ----------------------------------------------------------------------------------------
  ["32 card read writes to the database", SERVICE, [[null, '\nexport const touchCard = (id: string) => prisma.characterSignatureAbility.update({ where: { id }, data: {} });\n']], architecture, /W9-I146/],
  ["33 card API accepts client-supplied values", CARDS_ROUTE, [["strictQuery(new URL(request.url).searchParams, []);", 'strictQuery(new URL(request.url).searchParams, ["ap"]);']], architecture, /W9-I146/],
  ["34 card API gains a write route", CARDS_ROUTE, [[null, "\nexport async function POST(): Promise<Response> {\n  return new Response(null, { status: 204 });\n}\n"]], architecture, /W9-I146/],
  // ---- viewer and drawer ------------------------------------------------------------------------------------------------------------
  ["35 mode change drops the card from the URL", UI + "CardLibrary.tsx", [["    setMode(m);\n    writeUrl(selected, m);", "    setMode(m);\n    writeUrl(null, m);"]], ui, /switching modes keeps the exact card/],
  ["36 drawer ignores Escape", UI + "ProgressionDrawer.tsx", [['if (e.key === "Escape") {', 'if (e.key === "Esc") {']], ui, /the drawer traps focus, closes on Escape/],
  ["37 drawer loses focus restoration", UI + "ProgressionDrawer.tsx", [["if (back instanceof HTMLElement) back.focus();", "void back;"]], ui, /the drawer traps focus, closes on Escape/],
  ["38 drawer shows FUTURE before ACTIVE", FORMAT, [['  { key: "ACTIVE", title: "Active improvements", items: list.filter((i) => i.status === "ACTIVE") },\n  { key: "CONDITIONAL", title: "Conditional improvements", items: list.filter((i) => i.status === "CONDITIONAL") },\n  { key: "FUTURE", title: "Future improvements", items: list.filter((i) => i.status === "FUTURE") },', '  { key: "FUTURE", title: "Future improvements", items: list.filter((i) => i.status === "FUTURE") },\n  { key: "ACTIVE", title: "Active improvements", items: list.filter((i) => i.status === "ACTIVE") },\n  { key: "CONDITIONAL", title: "Conditional improvements", items: list.filter((i) => i.status === "CONDITIONAL") },']], ui, /the drawer groups improvements Active/],
  // ---- print ---------------------------------------------------------------------------------------------------------------------------
  ["39 print footer loses the snapshot identity", UI + "PrintCard.tsx", [["          {card.snapshot.cardKey}\n          {ability && ability.revisionNumber !== null", "          {card.name}\n          {ability && ability.revisionNumber !== null"]], ui, /every mechanical block of a complex card is present/],
  ["40 print silently drops overflowing blocks", UI + "PrintCard.tsx", [["if (!(capacity > 0)) return [{ side, blocks, first: true, tall: false }];", "if (!(capacity > 0)) return [{ side, blocks: blocks.slice(0, 2), first: true, tall: false }];"]], ui, /every mechanical block of a complex card is present/],
  ["41 print clips the card page", UI + "cards.css", [["  width: 4in;\n  height: 6in;\n", "  width: 4in;\n  height: 6in;\n  overflow: hidden;\n"]], architecture, /W9-I149/],
  ["42 continuation pages unmarked", UI + "PrintCard.tsx", [['page.first ? "" : " — continued"', 'page.first ? "" : ""']], architecture, /W9-I149/],
  ["43 duplex pairing removed", UI + "PrintCard.tsx", [["sequence.push(pages.front[i] ?? blank(), pages.back[i] ?? blank());", "sequence.push(...(pages.front[i] ? [pages.front[i]!] : []), ...(pages.back[i] ? [pages.back[i]!] : []));"]], architecture, /W9-I149/],
  // ---- Character Sheet integration -------------------------------------------------------------------------------------------------------
  ["44 Sheet Spell link opens a non-current revision", SHEET + "SpellRows.tsx", [["cards?ability=${encodeURIComponent(s.id)}", "cards?card=${encodeURIComponent(s.id)}"]], ui, /Spell, Maneuver and Attack rows link to their exact cards/],
  ["45 Sheet Attack link drops the hand", SHEET + "WeaponPanels.tsx", [["cards?attack=${encodeURIComponent(a.attackKey)}&hand=${encodeURIComponent(a.hand)}", "cards?attack=${encodeURIComponent(a.attackKey)}"]], architecture, /W9-I150/],
  ["46 card links printed on the paper Sheet", SHEET + "SheetPanels.tsx", [['      {mode === "digital" ? (\n        <p className="sheet-muted sheet-digital-only" data-testid="sheet-card-links">', '      {mode !== "hidden" ? (\n        <p className="sheet-muted sheet-digital-only" data-testid="sheet-card-links">']], ui, /Spell, Maneuver and Attack rows link to their exact cards/],
];

runControls({
  root,
  title: "M6-WO9",
  controls: rows.map(([name, file, edits, guard, intended]) => ({
    name,
    file,
    mutate: applyEdits(name, edits),
    guard,
    expect: new RegExp(`(?:AssertionError|expected|FAIL)[\\s\\S]*${intended.source}|${intended.source}[\\s\\S]*(?:AssertionError|expected|FAIL)`, "i"),
  })),
  caught: (name) => `Caught and restored: ${name}`,
  done: (count) => `All ${count} M6-WO9 controls caught and restored.`,
});
