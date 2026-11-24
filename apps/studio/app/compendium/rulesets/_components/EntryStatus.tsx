"use client";

import { useEffect, useState } from "react";
import { getKindCapabilities, type KindCapabilityView } from "../_lib/reference-client";

/**
 * RULES-WO1 (R17) — the Rules Reference entry's truthful status. Publication is a fact of this page (it is opened from the
 * exact Release that pins the revision); preview, consumers and live use come from the code-declared capability registry.
 * Nothing here implies that play uses a rule the registry marks as reference only.
 */
const PREVIEW: Record<string, string> = {
  RULE_PREVIEW: "Before / after preview of calculated statistics (in its Draft workspace)",
  AUTHORED_RULE: "Preview for a sample Character (in its Draft workspace)",
  REFERENCE_PREVIEW: "Preview with sample inputs (in its Draft workspace)",
  CONTENT: "Shown as written (no calculation preview)",
};
const LIVE: Record<string, string> = { LIVE: "Used in play", PARTIAL: "Partly used in play", REFERENCE_ONLY: "Reference only — not used in play yet" };

export function EntryStatus({ definitionKind, revisionNumber }: { definitionKind: string | null; revisionNumber: number }) {
  const [cap, setCap] = useState<KindCapabilityView | null | "loading" | "error">(definitionKind === null ? null : "loading");
  useEffect(() => {
    if (definitionKind === null) return;
    let live = true;
    getKindCapabilities().then(
      (all) => live && setCap(all[definitionKind] ?? null),
      () => live && setCap("error"),
    );
    return () => {
      live = false;
    };
  }, [definitionKind]);
  return (
    <section className="gov-panel" aria-labelledby="ref-status-h" data-testid="reference-status">
      <h2 id="ref-status-h">Status</h2>
      <ul className="prowess-status-badges">
        <li data-testid="reference-status-published">
          <strong>Published:</strong> yes — this Release pins Revision {revisionNumber}
        </li>
        {cap === "loading" ? (
          <li role="status">Loading what this build does with it…</li>
        ) : cap === "error" ? (
          <li className="gov-bad">What this build does with it could not be loaded.</li>
        ) : cap === null ? (
          <li className="gov-muted">Not a Prowess Definition — content only.</li>
        ) : (
          <>
            <li data-testid="reference-status-preview">
              <strong>Preview:</strong> {PREVIEW[cap.preview] ?? cap.preview}
            </li>
            <li data-testid="reference-status-connected">
              <strong>Connected to:</strong> {cap.consumers.length > 0 ? cap.consumers.join("; ") : "nothing yet"}
            </li>
            <li data-testid="reference-status-live" data-state={cap.execution}>
              <strong>Live in play:</strong> {LIVE[cap.execution] ?? cap.execution}
              {cap.notYet !== "" ? <span className="gov-muted"> — {cap.notYet}</span> : null}
            </li>
          </>
        )}
      </ul>
    </section>
  );
}
