import { CHARACTER_ERROR_CODES, DomainError } from "@prowess/model";
import { prisma } from "../client.js";

/**
 * RULES-WO1 — the readable source-section picker. A Definition cites rulebook sections by their structural key `sN`,
 * where N is the section's ordinal in an imported Source Snapshot (the approved DOCX parser numbers headings in reading
 * order). Authors never type those keys: they search section TITLES of an imported snapshot, and existing keys are shown
 * with their titles. Read-only. When no snapshot is imported in this workspace, the picker says so and the keys stay as
 * written (nothing is guessed).
 */
const invalid = (message: string) => new DomainError(CHARACTER_ERROR_CODES.INVALID_INPUT, message);
const LOCATOR = /^s([0-9]{1,4})$/;

export interface SourceSectionOption {
  readonly locator: string;
  readonly title: string;
  readonly headingLevel: number;
  readonly parentTitle: string | null;
}
export interface SourceSectionLookup {
  readonly snapshot: { readonly id: string; readonly label: string; readonly sectionCount: number } | null;
  readonly snapshots: ReadonlyArray<{ readonly id: string; readonly label: string; readonly sectionCount: number }>;
  readonly matches: readonly SourceSectionOption[];
  readonly known: readonly SourceSectionOption[];
  readonly unknown: readonly string[];
}

export async function lookupSourceSections(input: { readonly snapshotId?: unknown; readonly q?: unknown; readonly locators?: unknown }): Promise<SourceSectionLookup> {
  const q = typeof input.q === "string" ? input.q.trim().slice(0, 100) : "";
  const locators = Array.isArray(input.locators) ? input.locators : [];
  if (locators.length > 50 || !locators.every((l) => typeof l === "string" && LOCATOR.test(l))) throw invalid("locators is a list of at most 50 section keys");
  if (input.snapshotId !== undefined && input.snapshotId !== null && (typeof input.snapshotId !== "string" || !/^[0-9a-f-]{36}$/i.test(input.snapshotId))) throw invalid("snapshotId must be a UUID");

  const all = await prisma.sourceSnapshot.findMany({ select: { id: true, label: true, createdAt: true, _count: { select: { sections: true } } }, orderBy: [{ createdAt: "desc" }, { id: "asc" }] });
  const snapshots = all.filter((s) => s._count.sections > 0).map((s) => ({ id: s.id, label: s.label, sectionCount: s._count.sections }));
  // The chosen snapshot, or the one with the most sections (the full rulebook import) — never a guess across snapshots.
  const chosen = typeof input.snapshotId === "string" ? snapshots.find((s) => s.id === input.snapshotId) : [...snapshots].sort((a, b) => b.sectionCount - a.sectionCount)[0];
  if (chosen === undefined) return { snapshot: null, snapshots, matches: [], known: [], unknown: locators as string[] };

  const ordinals = (locators as string[]).map((l) => Number((LOCATOR.exec(l) as RegExpExecArray)[1]));
  const select = { ordinal: true, title: true, headingLevel: true, parentSection: { select: { title: true } } } as const;
  const [found, knownRows] = await Promise.all([
    q === "" ? Promise.resolve([]) : prisma.sourceSection.findMany({ where: { sourceSnapshotId: chosen.id, title: { contains: q, mode: "insensitive" } }, select, orderBy: { ordinal: "asc" }, take: 25 }),
    ordinals.length === 0 ? Promise.resolve([]) : prisma.sourceSection.findMany({ where: { sourceSnapshotId: chosen.id, ordinal: { in: ordinals } }, select, orderBy: { ordinal: "asc" } }),
  ]);
  const option = (r: { ordinal: number; title: string; headingLevel: number; parentSection: { title: string } | null }): SourceSectionOption => ({ locator: `s${r.ordinal}`, title: r.title, headingLevel: r.headingLevel, parentTitle: r.parentSection?.title ?? null });
  const known = knownRows.map(option);
  return { snapshot: chosen, snapshots, matches: found.map(option), known, unknown: (locators as string[]).filter((l) => !known.some((k) => k.locator === l)) };
}
