/**
 * Centralized primary navigation configuration for the Studio shell
 * (PAS-10 M0-WO5). One definition, consumed by `AppShell` — no page or
 * component hard-codes its own copy of the nav list.
 *
 * `children` records PAS-06's anticipated future nested navigation (e.g.
 * Studio → Spells/Maneuvers/Equipment/Summons/Cards; Developer → Rules
 * Inspector/Canon Manager/Sources/Tests) so the data shape won't need to
 * change when those subsections are built. Per M0-WO5 §3, only the primary
 * level renders for now — `children` exists here for future use and is
 * intentionally not read by `AppShell` yet.
 */

export interface NavChildEntry {
  label: string;
  href: string;
}

export interface NavEntry {
  id: string;
  label: string;
  href: string;
  /**
   * True for a route that exists only as an M0-WO5 placeholder page (no
   * real product functionality yet). Dashboard, Compendium, and Developer
   * are the three pre-existing, functional routes and are not placeholders.
   */
  placeholder?: boolean;
  /** Future nested subsections — not rendered yet, see module doc above. */
  children?: NavChildEntry[];
}

export const PRIMARY_NAVIGATION: readonly NavEntry[] = [
  { id: "dashboard", label: "Dashboard", href: "/" },
  { id: "compendium", label: "Compendium", href: "/compendium" },
  {
    id: "studio",
    label: "Studio",
    href: "/studio",
    placeholder: true,
    children: [
      { label: "Spells", href: "/studio/spells" },
      { label: "Maneuvers", href: "/studio/maneuvers" },
      { label: "Equipment", href: "/studio/equipment" },
      { label: "Summons", href: "/studio/summons" },
      { label: "Cards", href: "/studio/cards" },
    ],
  },
  { id: "characters", label: "Characters", href: "/characters", placeholder: true },
  { id: "world", label: "World", href: "/world", placeholder: true },
  { id: "gm", label: "GM", href: "/gm", placeholder: true },
  { id: "publishing", label: "Publishing", href: "/publishing", placeholder: true },
  {
    id: "developer",
    label: "Developer",
    href: "/developer",
    children: [
      { label: "Rules Inspector", href: "/developer/rules-inspector" },
      { label: "Canon Manager", href: "/developer/canon-manager" },
      { label: "Sources", href: "/developer/sources" },
      { label: "Tests", href: "/developer/tests" },
    ],
  },
] as const;

/**
 * Whether `entry` should be shown as the active primary-nav section for the
 * given pathname. The root Dashboard entry (`/`) matches only the exact
 * root path; every other entry also matches its own sub-paths (e.g.
 * `/compendium/spells/fireball` still highlights "Compendium"), so a future
 * nested/detail route doesn't need its own active-state logic.
 */
export function isNavEntryActive(entry: NavEntry, pathname: string): boolean {
  if (entry.href === "/") {
    return pathname === "/";
  }
  return pathname === entry.href || pathname.startsWith(`${entry.href}/`);
}
