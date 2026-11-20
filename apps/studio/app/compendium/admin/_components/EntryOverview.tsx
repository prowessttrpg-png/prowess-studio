"use client";

import { formatEnumLabel } from "@prowess/ui";
import { useEffect, useState } from "react";
import type { KindCapabilityDto } from "../_lib/authoring-client";
import { getRuleUsage, readableRuleNode, type RuleUsageDto } from "../../rulesets/_lib/reference-client";

/**
 * RULES-WO1 — the entry page's Overview status and its Usage and impact section. Every indicator is derived from a real
 * source and says where it comes from:
 *   - Saved and validated: this page's own validation result;
 *   - Published in this Release: whether the exact Release (when the page was opened from one) pins this Entity;
 *   - Preview: the preview the Studio offers for this kind;
 *   - Connected to / Live in play: the code-declared capability registry served by the authoring catalog.
 * A guided editor is authoring support only — it never implies that play executes the rule.
 */
type UsageDto = RuleUsageDto;
const PREVIEW_LABEL: Record<string, string> = {
  RULE_PREVIEW: "Before / after preview of calculated statistics",
  AUTHORED_RULE: "Preview for a sample Character",
  REFERENCE_PREVIEW: "Preview with sample inputs",
  CONTENT: "Shows how the entry reads (no calculation preview)",
};
const EXECUTION_LABEL: Record<string, string> = { LIVE: "Used in play", PARTIAL: "Partly used in play", REFERENCE_ONLY: "Reference only — not used in play yet" };

/** Re-exported for the entry page: a rule-graph node in plain words. */
export const readableNode = readableRuleNode;

export function EntryOverview({ capability, validationStatus, releaseId, entityId, purpose }: { capability: KindCapabilityDto | null; validationStatus: string | null; releaseId: string | null; entityId: string; purpose: string | null }) {
  const [usage, setUsage] = useState<UsageDto | null | "loading" | "error">(releaseId === null ? null : "loading");
  useEffect(() => {
    if (releaseId === null) return;
    let live = true;
    getRuleUsage(releaseId, entityId).then(
      (u) => live && setUsage(u),
      () => live && setUsage("error"),
    );
    return () => {
      live = false;
    };
  }, [releaseId, entityId]);
  const published = releaseId === null ? null : usage === "loading" || usage === "error" ? null : usage !== null;

  return (
    <>
      <section id="rev-overview" className="gov-panel" aria-labelledby="rev-overview-h" data-testid="entry-overview">
        <h2 id="rev-overview-h">Overview</h2>
        {purpose ? <p>{purpose}</p> : null}
        <ul className="prowess-status-badges" aria-label="Status" data-testid="entry-status">
          <li data-testid="status-validated" data-state={validationStatus ?? "UNKNOWN"}>
            <strong>Saved and validated:</strong> {validationStatus === null ? "not checked on this page yet" : validationStatus === "PASS" ? "yes" : `no (${formatEnumLabel(validationStatus)})`}
          </li>
          <li data-testid="status-published" data-state={published === null ? "UNKNOWN" : String(published)}>
            <strong>Published in this Release:</strong> {releaseId === null ? "open this entry from a Release to check" : published === null ? "checking…" : published ? "yes" : "no"}
          </li>
          <li data-testid="status-preview">
            <strong>Preview:</strong> {capability ? PREVIEW_LABEL[capability.preview] : "unknown"}
          </li>
          <li data-testid="status-connected">
            <strong>Connected to:</strong> {capability && capability.consumers.length > 0 ? capability.consumers.join("; ") : "nothing yet"}
          </li>
          <li data-testid="status-live" data-state={capability?.execution ?? "UNKNOWN"}>
            <strong>Live in play:</strong> {capability ? EXECUTION_LABEL[capability.execution] : "unknown"}
            {capability && capability.notYet !== "" ? <span className="gov-muted"> — {capability.notYet}</span> : null}
          </li>
        </ul>
      </section>
      <section id="rev-usage" className="gov-panel" aria-labelledby="rev-usage-h" data-testid="entry-usage">
        <h2 id="rev-usage-h">Usage and impact</h2>
        {releaseId === null ? (
          <p className="gov-muted">Open this entry from a Release (for example from a Stat&apos;s &ldquo;What this affects&rdquo;) to see what it reads and what reads it in that Release.</p>
        ) : usage === "loading" ? (
          <p role="status">Loading…</p>
        ) : usage === "error" ? (
          <p className="gov-bad">Usage could not be loaded.</p>
        ) : usage === null ? (
          <p data-testid="usage-not-in-release">This entry is not part of the Release you opened it from, so nothing in that Release uses it yet.</p>
        ) : (
          <>
            <h3>It reads</h3>
            {usage.reads.length === 0 ? (
              <p className="gov-muted">Nothing — it does not depend on another rule.</p>
            ) : (
              <ul data-testid="usage-reads">
                {usage.reads.map((r, i) => (
                  <li key={i}>{readableNode(r.from)}</li>
                ))}
              </ul>
            )}
            <h3>Used by</h3>
            {usage.usedBy.length === 0 ? (
              <p className="gov-muted">No other rule in this Release reads it.</p>
            ) : (
              <ul data-testid="usage-used-by">
                {usage.usedBy.map((u, i) => (
                  <li key={i}>
                    {u.displayName ?? formatEnumLabel(u.token)}
                    {u.depth > 1 ? <span className="gov-muted"> (through other rules)</span> : null}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </section>
    </>
  );
}
