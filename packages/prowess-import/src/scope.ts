/**
 * Source-scope helpers (PAS-10 M3-WO2) — pure, no database access. A SECTION_SUBTREE Batch covers its root section,
 * every descendant section, and every content node whose section is one of those. A content node outside every
 * section (content before the first heading) is inside only a SNAPSHOT-scoped Batch.
 */
export interface SectionParentLink {
  id: string;
  parentSectionId: string | null;
}

/** The root section and all of its descendants. Cycle-safe (a corrupt cycle cannot loop forever). */
export function sectionSubtree(rootSectionId: string, sections: readonly SectionParentLink[]): Set<string> {
  const children = new Map<string, string[]>();
  for (const s of sections) {
    if (s.parentSectionId === null) continue;
    const list = children.get(s.parentSectionId) ?? [];
    list.push(s.id);
    children.set(s.parentSectionId, list);
  }
  const out = new Set<string>([rootSectionId]);
  const queue = [rootSectionId];
  while (queue.length > 0) {
    const next = queue.shift() as string;
    for (const child of children.get(next) ?? []) {
      if (!out.has(child)) {
        out.add(child);
        queue.push(child);
      }
    }
  }
  return out;
}

export type ScopeAnchor = { kind: "SECTION"; sectionId: string } | { kind: "CONTENT_NODE"; sectionId: string | null };

/** Whether an anchor (already known to belong to the Batch's Snapshot) lies inside the Batch scope. */
export function isAnchorInScope(anchor: ScopeAnchor, scope: { type: "SNAPSHOT" } | { type: "SECTION_SUBTREE"; subtree: ReadonlySet<string> }): boolean {
  if (scope.type === "SNAPSHOT") return true;
  return anchor.sectionId !== null && scope.subtree.has(anchor.sectionId);
}
