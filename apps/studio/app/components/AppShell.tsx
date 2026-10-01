"use client";

import { NavLink, ProwessBrand } from "@prowess/ui";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

interface NavEntry {
  href: string;
  label: string;
}

/**
 * Minimal M0-WO1 nav set. Full primary navigation (Studio, Characters,
 * World, GM, Publishing) is introduced in M0-WO5 per the Application Shell
 * & Navigation spec — do not add those entries here.
 */
const NAV_ENTRIES: NavEntry[] = [
  { href: "/", label: "Dashboard" },
  { href: "/compendium", label: "Compendium" },
  { href: "/developer", label: "Developer" },
];

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="prowess-shell">
      <nav className="prowess-shell__nav" aria-label="Primary">
        <span className="prowess-shell__brand">
          <ProwessBrand />
        </span>
        <ul className="prowess-shell__nav-list">
          {NAV_ENTRIES.map((entry) => {
            const active = pathname === entry.href;
            return (
              <li
                key={entry.href}
                className="prowess-shell__nav-item"
                data-active={active}
              >
                <NavLink href={entry.href} label={entry.label} active={active}>
                  <Link href={entry.href}>{entry.label}</Link>
                </NavLink>
              </li>
            );
          })}
        </ul>
      </nav>
      <main className="prowess-shell__workspace">{children}</main>
    </div>
  );
}
