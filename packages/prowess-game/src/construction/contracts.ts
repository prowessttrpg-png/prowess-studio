import type { ProwessDefinitionEnvelope } from "../definition/envelope.js";
import { PROWESS_DEFINITION_KINDS, type AbilityComponentContract, type ProwessDefinitionKind } from "../vocabulary/families.js";
import type { TargetingDefinitionPayload } from "../definition/payload.js";

/**
 * Shared-contract queries (PAS-10 M5-WO1 §83, §116–118). These answer "which shared structure does this kind
 * implement?" and "do two Targeting Definitions mean the same geometry?" — never "are these the same Definition?"
 * (that is `isSameExactDefinition`, which compares exact identity only).
 */
export function componentContractOf(kind: ProwessDefinitionKind): AbilityComponentContract | null {
  return PROWESS_DEFINITION_KINDS[kind].contract;
}

/** Whether two kinds implement the same shared contract (e.g. SPELL_EFFECT / MANEUVER_EFFECT → EFFECT). */
export function implementSameContract(a: ProwessDefinitionKind, b: ProwessDefinitionKind): boolean {
  const contract = componentContractOf(a);
  return contract !== null && contract === componentContractOf(b);
}

/**
 * Whether two TARGETING-contract Definitions share a semantic shape (§31, §117, M5-I031–I032): a Spell Radius and a
 * Maneuver Radius do. Sharing a shape means equal spatial MEANING; it never makes them the same Definition or
 * interchangeable across branches (M5-I038). Returns false for non-Targeting Definitions.
 */
export function shareTargetingSemanticShape(a: ProwessDefinitionEnvelope, b: ProwessDefinitionEnvelope): boolean {
  if (componentContractOf(a.definitionKind) !== "TARGETING" || componentContractOf(b.definitionKind) !== "TARGETING") return false;
  return (a.payload as unknown as TargetingDefinitionPayload).semanticShape === (b.payload as unknown as TargetingDefinitionPayload).semanticShape;
}
