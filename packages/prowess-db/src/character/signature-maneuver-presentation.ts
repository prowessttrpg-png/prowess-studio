import type { buildSignatureManeuverCatalog } from "@prowess/game";
import { signatureManeuverComponentRefs } from "@prowess/game";
import type { SignatureManeuverEntry } from "./signature-maneuver-service.js";
const valid = (e: NonNullable<SignatureManeuverEntry["current"]>["evaluation"]) => e?.state === "VALID" || e?.state === "VALID_WITH_RUNTIME_DEFERRED";

/** Pure presentation projection; no persistence writes or alternate cost authority. */
export function projectManeuverSheet(entries: readonly SignatureManeuverEntry[]) {
  const maneuvers = entries.filter(a => a.status === "ACTIVE" && a.current !== null).map(a => {
    const current = a.current!, draft = current.draft, e = current.evaluation;
    return { id: a.id, name: draft?.concept.name ?? "Unreadable Maneuver", revisionNumber: current.revisionNumber, state: e?.state ?? "UNREADABLE", actions: draft?.actions ?? [], finalApCost: e && valid(e) ? e.cost?.ap.finalApCost ?? null : null, finalMpCost: e && valid(e) ? e.cost?.mp.finalMpCost ?? null : null, effects: draft?.effects.map(x => x.definition) ?? [], keywords: [...new Set(e?.authored?.effects.flatMap(x => x.result.keywords.map(k => k.canonicalKey)) ?? [])], warnings: [...(e?.issues ?? []), ...(e?.runtimeDeferred ?? []), ...(!e ? [{ code: "UNREADABLE", message: "The pinned current revision cannot be evaluated against this Character Release." }] : [])] };
  });
  return { maneuvers, refs: entries.filter(a => a.status === "ACTIVE").flatMap(a => a.current?.draft ? [...signatureManeuverComponentRefs(a.current.draft)] : []) };
}

export function performanceForDisplay(ctx: Parameters<typeof buildSignatureManeuverCatalog>[0], catalog: ReturnType<typeof buildSignatureManeuverCatalog>) {
  // Read-only display of the exact structured Condition. No rank conversion, cost evaluation or fallback content.
  const performance = catalog.conditions.filter(c => c.performanceVersion === "M6-WO8-A").flatMap(c => {
    const definition = ctx.bundle.definitions.find(d => d.entityId === c.ref.entityId && d.entityVersionId === c.ref.entityVersionId && d.definitionKind === c.ref.definitionKind);
    const payload = definition?.payload as unknown as { rules: { condition: { performance: { skill: { canonicalKey: string }; preparationApByRank: Record<string, number> } } }; costContributions: { data: { modifier: string; amounts?: Record<string, number> } }[] } | undefined;
    const contract = payload?.rules.condition.performance;
    const mp = payload?.costContributions.find(x => x.data.modifier === "MP_REDUCTION")?.data.amounts;
    return !contract || !mp ? [] : [{ definition: c.ref, currentRank: ctx.profile.constructionContext.skillRanks.find(s => s.skillKey === contract.skill.canonicalKey)?.rankKey ?? null, benefits: Object.entries(contract.preparationApByRank).map(([rank, preparationAp]) => ({ rank, preparationAp, mpReduction: mp[rank] })) }];
  });
  return performance;
}
