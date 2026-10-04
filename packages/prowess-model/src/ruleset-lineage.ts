export type ParentAssignmentCheck =
  | { kind: "ok" }
  | { kind: "self" }
  | { kind: "cycle"; path: string[] };

/**
 * Would making `proposedParentId` the parent of `rulesetId` create a lineage
 * loop? Pure and storage-independent: `parentOf` supplies each Ruleset's
 * current parent id (or null/undefined for a root).
 *
 * Walks UP from the proposed parent. Reaching `rulesetId` means the proposed
 * parent is a descendant of the ruleset — assigning it would close a loop
 * (A -> B -> C, then C as A's parent). A loop ALREADY present in the data is
 * also reported rather than looping forever, via the visited set.
 *
 * In M2-WO1 parent lineage is creation-time metadata and a brand-new Ruleset
 * can never be in anyone's ancestry, so this check is vacuous for `create`. It
 * exists — and is tested — so that any future operation that CHANGES a parent
 * has the protection ready (see docs/architecture/ruleset-foundation.md).
 */
export function checkParentAssignment(
  rulesetId: string,
  proposedParentId: string,
  parentOf: (id: string) => string | null | undefined,
): ParentAssignmentCheck {
  if (proposedParentId === rulesetId) {
    return { kind: "self" };
  }
  const path: string[] = [proposedParentId];
  const seen = new Set<string>([proposedParentId]);
  let current = parentOf(proposedParentId);
  while (current !== null && current !== undefined) {
    if (current === rulesetId) {
      return { kind: "cycle", path: [...path, rulesetId] };
    }
    if (seen.has(current)) {
      return { kind: "cycle", path: [...path, current] };
    }
    seen.add(current);
    path.push(current);
    current = parentOf(current);
  }
  return { kind: "ok" };
}
