"use client";

import { useEffect } from "react";

/**
 * Navigation protection for unsaved Definition work (PAS-10 M6-WO1 §19). While `dirty`:
 *  - leaving or reloading the page triggers the browser's own "leave site?" prompt (`beforeunload`);
 *  - clicking an in-app link asks for confirmation first, so a route change never silently discards entered data.
 * Saving (which makes the form clean) removes the protection. No autosave (§42).
 */
export const UNSAVED_CHANGES_MESSAGE = "You have unsaved changes to this Definition. Leave without saving?";

export function useUnsavedChangesGuard(dirty: boolean): void {
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = (event.target as Element | null)?.closest?.("a[href]");
      if (anchor === null || anchor === undefined || anchor.getAttribute("target") === "_blank") return;
      if (anchor.hasAttribute("data-skip-unsaved-guard")) return;
      if (!window.confirm(UNSAVED_CHANGES_MESSAGE)) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    document.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      document.removeEventListener("click", onClick, true);
    };
  }, [dirty]);
}
