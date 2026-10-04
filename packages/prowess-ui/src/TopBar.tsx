/**
 * Top bar placeholder primitives (PAS-06 §5 "Global Top Bar").
 *
 * All four are deliberately non-functional placeholders for M0-WO5 — no
 * search implementation, no Ruleset data, no object-creation workflow, no
 * authentication. Each is a clearly-labeled stand-in for a real future
 * component, not a disguised shortcut implementation of the real thing.
 */

export interface TopBarSearchProps {
  /** Placeholder text shown in the (non-functional) search field. */
  placeholder?: string;
}

/** Global Search placeholder — shows the future `Ctrl/Cmd+K` shortcut hint. */
export function TopBarSearch({ placeholder = "Search Prowess..." }: TopBarSearchProps) {
  return (
    <div data-testid="topbar-search" className="prowess-topbar__search" aria-disabled="true">
      <span className="prowess-topbar__search-placeholder">{placeholder}</span>
      <kbd className="prowess-topbar__search-shortcut" aria-hidden="true">
        Ctrl/Cmd+K
      </kbd>
    </div>
  );
}

export interface TopBarRulesetSelectorProps {
  /** The ruleset name to display. Static for M0-WO5 — no real Ruleset data yet. */
  label?: string;
}

/** Ruleset selector placeholder — a future control, not a real selector yet. */
export function TopBarRulesetSelector({ label = "Core Playtest" }: TopBarRulesetSelectorProps) {
  return (
    <button
      type="button"
      data-testid="topbar-ruleset"
      className="prowess-topbar__ruleset"
      disabled
      aria-label={`Ruleset: ${label} (selector not yet implemented)`}
    >
      <span className="prowess-topbar__ruleset-eyebrow">Ruleset</span>
      <span className="prowess-topbar__ruleset-label">{label}</span>
    </button>
  );
}

/** Create placeholder — no object-creation workflow exists yet. */
export function TopBarCreateButton() {
  return (
    <button
      type="button"
      data-testid="topbar-create"
      className="prowess-topbar__create"
      disabled
      aria-label="Create (not yet implemented)"
    >
      + Create
    </button>
  );
}

export interface TopBarAccountProps {
  /** Static initial/label for M0-WO5 — no authentication exists yet. */
  label?: string;
}

/** Account placeholder — no authentication implementation belongs here. */
export function TopBarAccount({ label = "Account" }: TopBarAccountProps) {
  return (
    <button
      type="button"
      data-testid="topbar-account"
      className="prowess-topbar__account"
      disabled
      aria-label="Account (not yet implemented)"
    >
      <span className="prowess-topbar__account-avatar" aria-hidden="true">
        {label.charAt(0).toUpperCase()}
      </span>
    </button>
  );
}
