"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { GovernanceApiError } from "../../../../src/api-client";
import {
  BATCH_LIFECYCLE,
  BATCH_STATUS_LABEL,
  CANDIDATE_STATUS_HELP,
  CANDIDATE_STATUS_LABEL,
  describeImportError,
  reviewProgress,
} from "../_lib/presentation";

/** Import sub-navigation (Developer → Import). aria-current marks the active section. */
export function ImportNav() {
  const pathname = usePathname() ?? "";
  const items = [
    { href: "/developer/import", label: "Import Home", active: pathname === "/developer/import" },
    { href: "/developer/import/sources", label: "Sources", active: pathname.startsWith("/developer/import/sources") },
    { href: "/developer/import/batches", label: "Batches", active: pathname.startsWith("/developer/import/batches") },
  ];
  return (
    <nav aria-label="Import" className="imp-nav">
      <ul>
        {items.map((i) => (
          <li key={i.href}>
            <Link href={i.href} aria-current={i.active ? "page" : undefined}>
              {i.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** Review status — a labelled text badge; color only supplements the words. */
export function CandidateStatusBadge({ status }: { status: string }) {
  const label = CANDIDATE_STATUS_LABEL[status as keyof typeof CANDIDATE_STATUS_LABEL] ?? status;
  const help = CANDIDATE_STATUS_HELP[status as keyof typeof CANDIDATE_STATUS_HELP];
  return (
    <span className={`imp-badge imp-status imp-status--${status.toLowerCase()}`} title={help} data-testid="candidate-status" data-status={status}>
      <span className="imp-visually-hidden">Review status: </span>
      {label}
    </span>
  );
}

/** Extraction confidence — deliberately a different shape and wording from review status. */
export function ConfidenceBadge({ confidence }: { confidence: string }) {
  return (
    <span className="imp-badge imp-confidence" data-testid="candidate-confidence" title="How sure extraction was that it read this correctly — not authority, not approval.">
      Confidence: {confidence}
    </span>
  );
}

export function KindBadge({ kind }: { kind: string }) {
  return (
    <span className="imp-badge imp-kind" data-testid="candidate-kind">
      {kind.replace(/_/g, " ")}
    </span>
  );
}

export function BatchStatusBadge({ status }: { status: string }) {
  return (
    <span className={`imp-badge imp-batch-status imp-batch-status--${status.toLowerCase()}`} data-testid="batch-status" data-status={status}>
      {BATCH_STATUS_LABEL[status] ?? status}
    </span>
  );
}

/** The approved Batch lifecycle as an ordered list with the current step marked (aria-current="step"). */
export function BatchLifecycle({ status }: { status: string }) {
  return (
    <ol className="imp-lifecycle" aria-label="Batch lifecycle">
      {BATCH_LIFECYCLE.map((s) => (
        <li key={s} aria-current={s === status ? "step" : undefined} data-current={s === status ? "true" : undefined}>
          {BATCH_STATUS_LABEL[s]}
        </li>
      ))}
    </ol>
  );
}

/** Controlled API errors with readable copy and the safe domain code. Never raw JSON or internals. */
export function ImportError({ error, title = "Request failed", onRetry }: { error: unknown; title?: string; onRetry?: () => void }) {
  const code = error instanceof GovernanceApiError ? error.code : "UNEXPECTED_ERROR";
  const message = error instanceof GovernanceApiError ? describeImportError(error.code, error.message) : "Something unexpected happened.";
  return (
    <div className="gov-error" role="alert" data-testid="import-error" data-error-code={code}>
      <strong>{title}</strong>
      <p>{message}</p>
      <p className="gov-muted">
        Code: <code data-testid="error-code">{code}</code>
      </p>
      {onRetry ? (
        <button type="button" className="gov-button" onClick={onRetry}>
          Retry
        </button>
      ) : null}
    </div>
  );
}

/** Review progress from the derived server summary (never recomputed from loaded pages). */
export function ReviewProgress({ summary }: { summary: { totalCandidates: number; byStatus: Record<string, number>; potentialConflictCount?: number | null } }) {
  const p = reviewProgress(summary.byStatus, summary.totalCandidates);
  return (
    <section aria-label="Review progress" className="imp-progress" data-testid="review-progress">
      <p className="imp-progress__headline">
        Reviewed <strong>{p.reviewed}</strong> / {p.total}
      </p>
      <progress max={Math.max(p.total, 1)} value={p.reviewed} aria-label={`Reviewed ${p.reviewed} of ${p.total}`} />
      <dl className="imp-counts">
        {Object.keys(CANDIDATE_STATUS_LABEL).map((s) => (
          <div key={s}>
            <dt>{CANDIDATE_STATUS_LABEL[s as keyof typeof CANDIDATE_STATUS_LABEL]}</dt>
            <dd data-testid={`count-${s}`}>{summary.byStatus[s] ?? 0}</dd>
          </div>
        ))}
        <div>
          <dt>Unresolved</dt>
          <dd data-testid="count-unresolved">{p.unresolved}</dd>
        </div>
        {summary.potentialConflictCount !== undefined && summary.potentialConflictCount !== null ? (
          <div>
            <dt>Potential content conflicts (selected MatchRun)</dt>
            <dd>{summary.potentialConflictCount}</dd>
          </div>
        ) : null}
      </dl>
    </section>
  );
}

/** Technical metadata (ids, hashes, fingerprints) behind a disclosure so it never dominates the default view. */
export function TechnicalDetails({ title = "Technical details", rows }: { title?: string; rows: Array<[string, ReactNode]> }) {
  return (
    <details className="imp-technical">
      <summary>{title}</summary>
      <dl>
        {rows.map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{typeof v === "string" ? <code>{v}</code> : v}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}

export function BoundaryNote({ children }: { children: ReactNode }) {
  return (
    <p className="imp-boundary" role="note">
      {children}
    </p>
  );
}
