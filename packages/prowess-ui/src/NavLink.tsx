import type { ReactNode } from "react";

export interface NavLinkProps {
  href: string;
  label: string;
  active?: boolean;
  disabled?: boolean;
  children?: ReactNode;
}

/**
 * NavLink
 *
 * A shared primary-navigation item primitive. Rendering only — the host
 * application (Next.js in apps/studio) owns actual routing/link behavior
 * and passes it in via `children` (e.g. wrapping next/link).
 */
export function NavLink({ href, label, active = false, disabled = false, children }: NavLinkProps) {
  return (
    <span
      data-testid={`nav-link-${label.toLowerCase()}`}
      data-href={href}
      data-active={active}
      data-disabled={disabled}
    >
      {children ?? label}
    </span>
  );
}
