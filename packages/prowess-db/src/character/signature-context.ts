import type { CharacterMechanicalProfile, ProwessDefinitionBundle } from "@prowess/game";
import type { RulesetContext } from "@prowess/rules";
import { prisma } from "../client.js";
import { loadCompleted, requireProfile } from "./advancement-service.js";
import { profileOf } from "./progression.js";

export interface SignatureContext {
  readonly c: Awaited<ReturnType<typeof loadCompleted>>["c"];
  readonly bundle: ProwessDefinitionBundle;
  readonly ruleset: RulesetContext;
  readonly profile: CharacterMechanicalProfile;
  readonly keywords: readonly { readonly keywordId: string; readonly canonicalKey: string; readonly categoryId: string | null }[];
}

/**
 * The exact M1 Keyword references for every Keyword the Release's Definitions author (component Keywords and Affinity
 * Strength / Weakness lists). A Keyword the database does not define is simply absent: M5 then fails closed.
 */
export async function keywordCatalogFor(bundle: ProwessDefinitionBundle): Promise<SignatureContext["keywords"]> {
  const keys = new Set<string>();
  const collect = (v: unknown): void => {
    if (Array.isArray(v)) for (const x of v) collect(x);
    else if (v !== null && typeof v === "object")
      for (const [k, x] of Object.entries(v)) {
        if ((k === "keywords" || k === "matchAny") && Array.isArray(x)) {
          for (const y of x) if (typeof y === "string") keys.add(y);
        } else collect(x);
      }
  };
  for (const d of bundle.definitions) collect(d.payload);
  if (keys.size === 0) return [];
  const rows = await prisma.keywordDefinition.findMany({ where: { canonicalKey: { in: [...keys] } }, select: { id: true, canonicalKey: true, categoryId: true }, orderBy: { canonicalKey: "asc" } });
  return rows.map((r) => ({ keywordId: r.id, canonicalKey: r.canonicalKey, categoryId: r.categoryId }));
}

export async function loadSignatureContext(characterId: string): Promise<SignatureContext> {
  const { c, bundle, ruleset, progression } = await loadCompleted(characterId);
  const profile = requireProfile(profileOf(bundle, ruleset, progression));
  return { c, bundle, ruleset, profile, keywords: await keywordCatalogFor(bundle) };
}
