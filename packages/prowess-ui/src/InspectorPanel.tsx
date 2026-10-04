import type { ReactNode } from "react";

export interface InspectorPanelProps {
  /**
   * Whether the Inspector is visible. Defaults to `false` — PAS-06
   * describes the right Inspector as contextual and collapsible, and "not
   * every page requires it." No page passes real content or sets this
   * `true` yet in M0-WO5; the region exists so later work doesn't require
   * restructuring the shell to add it.
   */
  open?: boolean;
  title?: string;
  children?: ReactNode;
}

/**
 * InspectorPanel
 *
 * The shell's right-side contextual Inspector region (PAS-06 §"Right
 * Inspector Architecture"). Establishes the structural slot only — no real
 * inspector content exists yet. Rendered but empty/hidden by default rather
 * than omitted entirely, so a future page can pass `open` + content without
 * any change to `AppShell` itself.
 */
export function InspectorPanel({ open = false, title, children }: InspectorPanelProps) {
  return (
    <aside
      data-testid="inspector-panel"
      className="prowess-shell__inspector"
      aria-label={title ?? "Inspector"}
      hidden={!open}
    >
      {open ? children : null}
    </aside>
  );
}
