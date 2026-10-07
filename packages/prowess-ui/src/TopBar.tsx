/**
 * Top bar placeholder primitives (PAS-06 §5 "Global Top Bar").
 *
* The Ruleset selector became a real VIEWING control in M2-WO10; the other three are still
 * deliberately non-functional placeholders from M0-WO5 — no
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

export interface TopBarRulesetOption {
  id: string;
  label: string;
}

export interface TopBarRulesetSelectorProps {
  /** Rulesets the user can VIEW. Empty while loading (the control is then disabled). */
  options?: readonly TopBarRulesetOption[];
  /** The Ruleset currently being viewed, or "" when none. */
  value?: string;
  /** Called with the chosen Ruleset id. The host decides what "viewing" means (e.g. navigate). */
  onChange?: (rulesetId: string) => void;
}

/**
 * Ruleset VIEWING selector (PAS-10 M2-WO10 §5, §6). A workspace/navigation context control only: it is not an
 * "active" or "current" Ruleset, stores nothing, and has no backend effect — the host only navigates. Purely
 * presentational (React only, no Next.js, no data access).
 */
export function TopBarRulesetSelector({ options = [], value = "", onChange }: TopBarRulesetSelectorProps) {
  return (
    <label className="prowess-topbar__ruleset">
      <span className="prowess-topbar__ruleset-eyebrow">Viewing</span>
      <select
        data-testid="topbar-ruleset"
        className="prowess-topbar__ruleset-select"
        aria-label="Ruleset to view"
        value={value}
        disabled={options.length === 0 || onChange === undefined}
        onChange={(event) => onChange?.(event.target.value)}
      >
        <option value="">{options.length === 0 ? "No Rulesets" : "Choose a Ruleset…"}</option>
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
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
