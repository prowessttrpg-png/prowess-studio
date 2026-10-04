"use client";

import {
  InspectorPanel,
  NavLink,
  NavToggle,
  ProwessBrand,
  TopBarAccount,
  TopBarCreateButton,
  TopBarRulesetSelector,
  TopBarSearch,
} from "@prowess/ui";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import { isNavEntryActive, PRIMARY_NAVIGATION } from "../../src/navigation";

const PRIMARY_NAV_ID = "prowess-primary-nav";

/**
 * AppShell
 *
 * The one persistent Studio shell (PAS-06/PAS-10 M0-WO5) every route
 * renders through — top bar, primary navigation, the main workspace, and a
 * right Inspector region reserved for future use. No page builds its own
 * copy of any of this.
 *
 * No Prowess rules/business logic lives here — navigation and presentation
 * only, per M0-WO5 §10.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  return (
    <div className="prowess-shell">
      <header className="prowess-topbar">
        <div className="prowess-topbar__start">
          <NavToggle
            open={mobileNavOpen}
            controls={PRIMARY_NAV_ID}
            onClick={() => setMobileNavOpen((open) => !open)}
          />
          <span className="prowess-topbar__brand">
            <ProwessBrand />
          </span>
        </div>
        <TopBarSearch />
        <div className="prowess-topbar__end">
          <TopBarRulesetSelector />
          <TopBarCreateButton />
          <TopBarAccount />
        </div>
      </header>

      <div className="prowess-shell__body">
        <nav
          id={PRIMARY_NAV_ID}
          className="prowess-shell__nav"
          aria-label="Primary"
          data-mobile-open={mobileNavOpen}
        >
          <ul className="prowess-shell__nav-list">
            {PRIMARY_NAVIGATION.map((entry) => {
              const active = isNavEntryActive(entry, pathname);
              return (
                <li
                  key={entry.id}
                  className="prowess-shell__nav-item"
                  data-active={active}
                >
                  <NavLink href={entry.href} label={entry.label} active={active}>
                    <Link
                      href={entry.href}
                      aria-current={active ? "page" : undefined}
                      onClick={() => setMobileNavOpen(false)}
                    >
                      {entry.label}
                    </Link>
                  </NavLink>
                </li>
              );
            })}
          </ul>
        </nav>

        <main className="prowess-shell__workspace">{children}</main>

        <InspectorPanel />
      </div>
    </div>
  );
}
