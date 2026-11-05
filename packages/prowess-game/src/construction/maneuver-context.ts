import { findBundleDefinition, type ProwessDefinitionBundle } from "../bundle/bundle.js";
import { isSameExactDefinition, type ProwessDefinitionRef } from "../definition/envelope.js";
import type { FoundationDefinitionPayload } from "../definition/payload.js";

/** Internal, trusted WO6 adapter input. Never read from an HTTP or compilation request, never a Definition envelope.
 * The exact Attack stays an Attack in the unmodified Release bundle; only its M5 Foundation projection is supplied. */
export interface ManeuverCompilationContext {
  readonly foundations: readonly { readonly actionKey: string; readonly reference: ProwessDefinitionRef; readonly payload: FoundationDefinitionPayload; readonly provenance: readonly ProwessDefinitionRef[] }[];
  readonly actionKeys: readonly string[];
  readonly enforceActionBlockCapacity?: boolean;
}
export function projectedFoundation(bundle: ProwessDefinitionBundle, ref: ProwessDefinitionRef, context?: ManeuverCompilationContext, actionKey?: string) {
  if (ref.definitionKind !== "ATTACK" || !findBundleDefinition(bundle, ref)) return null;
  return context?.foundations.find(x => isSameExactDefinition(x.reference, ref) && (actionKey === undefined || x.actionKey === actionKey)) ?? null;
}
export function componentPayload(bundle: ProwessDefinitionBundle, ref: ProwessDefinitionRef, context?: ManeuverCompilationContext, actionKey?: string) {
  return projectedFoundation(bundle, ref, context, actionKey)?.payload ?? findBundleDefinition(bundle, ref)?.payload ?? null;
}
