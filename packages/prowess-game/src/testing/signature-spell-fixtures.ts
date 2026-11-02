import { ACTIVE_MAGIC_CONTENT } from "../content/core-playtest-v0.1/active-magic.js";
import { copy } from "./duration-condition-fixtures.js";
import { spellCostFixture } from "./spell-cost-fixtures.js";

/**
 * PAS-10 M6-WO7 TEST fixtures (not canonical content, not public surface). The M5-WO10 Spell fixture with:
 *   - the CURRENT construction rule (WO9 conditions … WO12 Effect execution … WO13 active-magic policy), so a Character
 *     Spell's runtime readiness reads the same pinned policies a canonical Spell does;
 *   - explicit component Affinity access (`rules.construction.affinityAccess`, the existing M5 sub-contract) on the
 *     Single Target Targeting and the Instant / Rounds Durations for Evocation — TEST content only: the Core Playtest
 *     content authors no Affinity access for Targeting or Duration, so an Affinity-Authority Spell is not constructible
 *     from it (a content gap reported by M6-WO7, never patched in code).
 */
export function signatureSpellFixture() {
  const base = spellCostFixture();
  const evocation = base.ref("affinity.evocation");
  const payload = (k: string) => copy(base.bundle.definitions.find((d) => d.canonicalKey === k)!.payload) as { rules: Record<string, unknown> & { construction?: Record<string, unknown> } };
  const withAccess = (k: string) => {
    const p = payload(k);
    const construction = p.rules.construction ?? { prerequisites: [], stacking: { stackable: false } };
    p.rules = { ...p.rules, construction: { ...construction, affinityAccess: [evocation] } };
    return p;
  };
  return spellCostFixture({
    revise: {
      "construction.ability_rules": copy(ACTIVE_MAGIC_CONTENT.constructionRule.payload) as Record<string, unknown>,
      "spell.targeting.single_target": withAccess("spell.targeting.single_target"),
      "spell.duration.instant": withAccess("spell.duration.instant"),
      "spell.duration.rounds": withAccess("spell.duration.rounds"),
    },
  });
}

/** The Spell-component kinds a Signature Spell test world publishes. */
const WORLD_KINDS = ["SPELL_TARGETING", "SPELL_EFFECT", "SPELL_TRAIT", "SHARED_TRAIT", "SPELL_DURATION", "SPELL_CASTING_CONDITION"];
const isRef = (v: unknown): v is { canonicalKey: string; entityId: string; entityVersionId: string } => typeof v === "object" && v !== null && !Array.isArray(v) && "entityVersionId" in v && "canonicalKey" in v && "definitionKind" in v;
function toContentRefs(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(toContentRefs);
  if (isRef(v)) return { $ref: v.canonicalKey };
  if (typeof v === "object" && v !== null) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, toContentRefs(x)]));
  return v;
}
function keywordsIn(v: unknown, out: Set<string>): void {
  if (Array.isArray(v)) v.forEach((x) => keywordsIn(x, out));
  else if (typeof v === "object" && v !== null) for (const [k, x] of Object.entries(v)) (k === "keywords" || k === "matchAny") && Array.isArray(x) ? x.forEach((y) => typeof y === "string" && out.add(y)) : keywordsIn(x, out);
}
/**
 * The Signature Spell test-world content (M6-WO7 DB / API / E2E suites): the full current construction rule and every
 * Spell component of `signatureSpellFixture()`, with exact refs as `{ $ref: <content key> }` placeholders and the
 * Keywords they (and the Affinities) author. Serialized to m6-wo7-spell-world.json, kept in sync by a unit test.
 */
export function signatureSpellWorldContent() {
  const f = signatureSpellFixture();
  const definitions = f.bundle.definitions
    .filter((d) => WORLD_KINDS.includes(d.definitionKind) || d.definitionKind === "ABILITY_CONSTRUCTION_RULE")
    .map((d) => ({ canonicalKey: d.canonicalKey, definitionKind: d.definitionKind, schemaVersion: d.schemaVersion, payload: toContentRefs(d.payload) }));
  const keywords = new Set<string>();
  for (const d of f.bundle.definitions) keywordsIn(d.payload, keywords);
  return { $comment: "PAS-10 M6-WO7 TEST content (never canon): generated from testing/signature-spell-fixtures.ts — see character-signature-spell-world.test.ts.", keywords: [...keywords].sort(), definitions };
}
