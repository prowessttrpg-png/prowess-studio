import type { ProwessDefinitionBundle } from "../bundle/bundle.js";
import { clonePlainData, deepFreeze } from "../internal/plain-data.js";
import { PROWESS_DEFINITION_KINDS } from "../vocabulary/families.js";
import { CARD_CONTRACT_VERSION, unavailable, type CardValue, type MageArtCard } from "./contract.js";
import type { CharacterCardContext } from "./equipment.js";
import { unavailableInstructions } from "./language.js";

/**
 * PAS-10 M6-WO9 Phase B — the Mage Art Card contract's UNAVAILABLE state. MAGE_ART is a reserved Definition kind (no
 * payload contract) and no Character-facing Mage Art domain exists, so the card slot is always UNAVAILABLE: no Mage Art
 * evaluation, activation rule, maintenance cost or progression is fabricated. When a later Work Order activates the
 * kind, this is the single place the domain status changes — and a Release would have to pin executable Mage Arts.
 */

export const MAGE_ART_UNAVAILABLE_CODE = "CARD.MAGE_ART_DOMAIN_UNAVAILABLE";

/** Why the Mage Art domain is unavailable for this exact Release (always UNAVAILABLE in WO9). */
export function mageArtDomainOf(bundle: ProwessDefinitionBundle): CardValue<never> {
  const reserved = PROWESS_DEFINITION_KINDS.MAGE_ART.schemaVersions.length === 0;
  const pinned = bundle.definitions.filter((d) => d.definitionKind === "MAGE_ART").length;
  const reason = reserved
    ? `Mage Arts are reserved: the MAGE_ART Definition kind has no payload contract yet${pinned === 0 ? "" : " (this Release's Mage Art records are not executable)"}, and no Character-facing Mage Art domain exists`
    : "no Character-facing Mage Art domain exists";
  return unavailable<never>(MAGE_ART_UNAVAILABLE_CODE, reason);
}

/** The Mage Art presentation slot for this Character: a clearly UNAVAILABLE card — never a fabricated Mage Art. */
export function projectMageArtCard(input: { readonly bundle: ProwessDefinitionBundle; readonly context: CharacterCardContext }): MageArtCard {
  const { context: ctx } = input;
  const domain = mageArtDomainOf(input.bundle);
  const reason = domain.status === "UNAVAILABLE" ? domain.reason : "Mage Arts are unavailable";
  const cardKey = `MAGE_ART:unavailable:${ctx.characterReleaseId}`;
  return deepFreeze(
    clonePlainData({
      contractVersion: CARD_CONTRACT_VERSION,
      cardKey,
      category: "MAGE_ART" as const,
      name: "Mage Arts",
      description: "",
      artwork: { kind: "PLACEHOLDER" as const },
      availability: "UNAVAILABLE" as const,
      provenance: { rulesetProvenance: ctx.rulesetProvenance, characterReleaseId: ctx.characterReleaseId, characterId: ctx.characterId, ability: null, sources: [], evaluation: { authority: "M6-WO9 Mage Art domain status", state: "UNAVAILABLE" } },
      costs: { ap: unavailable<number>(MAGE_ART_UNAVAILABLE_CODE, reason), mp: unavailable<number>(MAGE_ART_UNAVAILABLE_CODE, reason), breakdown: [] },
      targeting: unavailable(MAGE_ART_UNAVAILABLE_CODE, reason),
      rules: unavailable(MAGE_ART_UNAVAILABLE_CODE, reason),
      instructions: unavailableInstructions(MAGE_ART_UNAVAILABLE_CODE, reason),
      limitations: [{ code: MAGE_ART_UNAVAILABLE_CODE, message: reason }],
      section: { kind: "MAGE_ART" as const, domain },
      snapshot: { contractVersion: CARD_CONTRACT_VERSION, cardKey, rulesetProvenance: ctx.rulesetProvenance, characterReleaseId: ctx.characterReleaseId, ability: null, sources: [] },
    }),
  ) as MageArtCard;
}
