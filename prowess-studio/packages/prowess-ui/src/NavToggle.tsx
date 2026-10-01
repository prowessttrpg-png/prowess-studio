export interface NavToggleProps {
  /** Whether the mobile navigation drawer is currently open. */
  open: boolean;
  /** id of the nav element this button controls (for `aria-controls`). */
  controls: string;
  onClick: () => void;
}

/**
 * NavToggle
 *
 * The mobile hamburger/menu button that shows/hides the primary navigation
 * drawer on narrow viewports. Purely presentational + a click callback — it
 * owns no open/closed state itself (the host app does, via `AppShell`),
 * consistent with `NavLink`'s pattern of staying routing/state-free.
 *
 * Accessible by construction: a real `<button>`, an explicit accessible
 * name, and `aria-expanded`/`aria-controls` so assistive tech always knows
 * what this toggles and its current state — never conveyed by icon shape
 * or color alone.
 */
export function NavToggle({ open, controls, onClick }: NavToggleProps) {
  return (
    <button
      type="button"
      data-testid="nav-toggle"
      className="prowess-shell__nav-toggle"
      aria-expanded={open}
      aria-controls={controls}
      aria-label={open ? "Close navigation menu" : "Open navigation menu"}
      onClick={onClick}
    >
      <span className="prowess-shell__nav-toggle-bars" aria-hidden="true" />
      <span className="prowess-shell__nav-toggle-text">Menu</span>
    </button>
  );
}
