/**
 * PRE-M7-WO1 child-Draft round trip. While editing a parent Definition (a Spell or Maneuver), the designer may create a
 * missing reusable component as its OWN Draft (Create Definition) and come back. The parent's unsaved work is kept in
 * this tab's sessionStorage only for that round trip (never sent to the server, never an auto-save); the created child
 * comes back as its exact reference and is added to the chosen slot, leaving the parent dirty until the designer saves.
 */
export interface ExactRef {
  entityId: string;
  entityVersionId: string;
  canonicalKey: string;
  definitionKind: string;
  systemFamily: string;
}
const KEY = (parentVersionId: string) => `prowess.compendium.childDraft.${parentVersionId}`;

export function stashParent(parentVersionId: string, form: unknown, slot: string): boolean {
  try {
    window.sessionStorage.setItem(KEY(parentVersionId), JSON.stringify({ form, slot, at: Date.now() }));
    return true;
  } catch {
    return false;
  }
}

/** Reads and REMOVES the stash (one use). Stale stashes (over a day old) are discarded. */
export function takeParent<T>(parentVersionId: string): { form: T; slot: string } | null {
  try {
    const raw = window.sessionStorage.getItem(KEY(parentVersionId));
    window.sessionStorage.removeItem(KEY(parentVersionId));
    if (raw === null) return null;
    const v = JSON.parse(raw) as { form: T; slot: string; at: number };
    return Date.now() - v.at > 86_400_000 ? null : { form: v.form, slot: v.slot };
  } catch {
    return null;
  }
}

export function readChildRef(raw: string | null): ExactRef | null {
  if (raw === null) return null;
  try {
    const v = JSON.parse(raw) as Partial<ExactRef>;
    const ok = (x: unknown) => typeof x === "string" && x.length > 0 && x.length < 300;
    return ok(v.entityId) && ok(v.entityVersionId) && ok(v.canonicalKey) && ok(v.definitionKind) && ok(v.systemFamily) ? (v as ExactRef) : null;
  } catch {
    return null;
  }
}

export const childCreateHref = (kind: string, slot: string, returnTo: string) => `/compendium/admin/new?kind=${encodeURIComponent(kind)}&slot=${encodeURIComponent(slot)}&returnTo=${encodeURIComponent(returnTo)}`;
