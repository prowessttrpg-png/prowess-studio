"use client";

import { Pagination } from "@prowess/ui";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { ErrorState } from "../../_components/ErrorState";
import { LoadingState } from "../../_components/LoadingState";
import { compareReleases, ReferenceApiError, type ComparisonDto } from "../_lib/reference-client";
import { entryHref, libraryComparisonHref, releaseHref, releaseName, rulesReferenceHref, rulesetReferenceHref } from "../_lib/reference-urls";

const PAGE_SIZE = 50;
const TYPE_LABELS: Record<ComparisonDto["entries"][number]["type"], string> = {
  ADDED_ENTITY: "Added",
  REMOVED_ENTITY: "Removed",
  CHANGED_VERSION: "Changed revision",
};

/**
 * Release Comparison (PAS-10 M6-WO2): the M2 composition diff from one Release to another — which Entities were added,
 * removed, or pinned at a different revision, plus how many are unchanged. It compares PINS, not content: a changed
 * revision links to the Entity Library's existing revision comparison. No semantic diff is computed.
 */
export function ComparisonView({ rulesetId, releaseId, otherReleaseId }: { rulesetId: string; releaseId: string; otherReleaseId: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const type = params.get("type") ?? "";
  const page = Math.max(1, Number(params.get("page") ?? "1") || 1);
  const [diff, setDiff] = useState<ComparisonDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setDiff(null);
    setError(null);
    try {
      setDiff(await compareReleases(rulesetId, releaseId, otherReleaseId, { page, pageSize: PAGE_SIZE, type: type || undefined }));
    } catch (e) {
      setError(e instanceof ReferenceApiError ? `${e.message} (${e.code})` : "Could not compare these Releases.");
    }
  }, [rulesetId, releaseId, otherReleaseId, page, type]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-dependency-change
    void load();
  }, [load]);

  const go = (nextType: string, nextPage = 1) => {
    const q = new URLSearchParams();
    if (nextType) q.set("type", nextType);
    if (nextPage > 1) q.set("page", String(nextPage));
    router.push(q.toString() === "" ? pathname : `${pathname}?${q.toString()}`);
  };

  if (error !== null) return <ErrorState message={error} onRetry={() => void load()} />;
  if (diff === null) return <LoadingState label="Comparing Releases…" />;
  const a = diff.releaseA;
  const b = diff.releaseB;
  return (
    <div className="prowess-reference" data-testid="reference-comparison">
      <nav className="gov-crumbs" aria-label="Breadcrumb">
        <Link href={rulesReferenceHref()}>Rules Reference</Link> / <Link href={rulesetReferenceHref(rulesetId)}>Ruleset</Link> / <Link href={releaseHref(rulesetId, a.id)}>{releaseName(a)}</Link> /{" "}
        <span aria-current="page">Compare</span>
      </nav>
      <header className="prowess-reference__header">
        <p className="gov-eyebrow">Release Comparison</p>
        <h1>
          {releaseName(a)} → {releaseName(b)}
        </h1>
        <p className="gov-muted">Composition only: which Entities each Release pins, and at which revision. Content differences are read in each revision comparison.</p>
        <p className="gov-counts" data-testid="reference-comparison-counts">
          <span>{diff.counts.added} added</span> · <span>{diff.counts.removed} removed</span> · <span>{diff.counts.changed} changed revision</span> · <span>{diff.counts.unchanged} unchanged</span>
        </p>
      </header>
      <div className="gov-tabs" role="group" aria-label="Show">
        {["", "ADDED_ENTITY", "REMOVED_ENTITY", "CHANGED_VERSION"].map((t) => (
          <button key={t || "all"} type="button" className="gov-button" aria-pressed={type === t} onClick={() => go(t)}>
            {t === "" ? "All differences" : TYPE_LABELS[t as keyof typeof TYPE_LABELS]}
          </button>
        ))}
      </div>
      {diff.entries.length === 0 ? (
        <p className="gov-muted">{diff.total === 0 && type === "" ? "These Releases pin exactly the same revisions." : "No differences of this type."}</p>
      ) : (
        <table className="prowess-reference__table">
          <caption className="gov-muted">Differences from {releaseName(a)} to {releaseName(b)}</caption>
          <thead>
            <tr>
              <th scope="col">Difference</th>
              <th scope="col">Entity</th>
              <th scope="col">{releaseName(a)}</th>
              <th scope="col">{releaseName(b)}</th>
              <th scope="col">Details</th>
            </tr>
          </thead>
          <tbody>
            {diff.entries.map((e) => (
              <tr key={e.entityId} data-testid="reference-comparison-entry" data-type={e.type}>
                <td>{TYPE_LABELS[e.type]}</td>
                <td>
                  {e.to?.displayName ?? e.from?.displayName ?? "—"} <code>{e.canonicalKey ?? e.entityId}</code>
                </td>
                <td>{e.from ? <Link href={entryHref(rulesetId, a.id, e.entityId)}>Revision {e.from.revisionNumber ?? "?"}</Link> : <span className="gov-muted">not pinned</span>}</td>
                <td>{e.to ? <Link href={entryHref(rulesetId, b.id, e.entityId)}>Revision {e.to.revisionNumber ?? "?"}</Link> : <span className="gov-muted">not pinned</span>}</td>
                <td>
                  {e.type === "CHANGED_VERSION" && e.from?.revisionNumber != null && e.to?.revisionNumber != null ? (
                    <Link href={libraryComparisonHref(e.entityId, Math.min(e.from.revisionNumber, e.to.revisionNumber), Math.max(e.from.revisionNumber, e.to.revisionNumber))}>Compare revisions</Link>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <Pagination page={diff.page} totalPages={Math.max(1, Math.ceil(diff.total / diff.pageSize))} total={diff.total} onPageChange={(p) => go(type, p)} />
    </div>
  );
}
