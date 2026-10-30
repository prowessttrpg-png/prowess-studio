"use client";

import { EmptyState, Pagination } from "@prowess/ui";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ErrorState } from "../../_components/ErrorState";
import { LoadingState } from "../../_components/LoadingState";
import {
  getCatalog,
  getRelease,
  listEntries,
  listReleases,
  ReferenceApiError,
  type CatalogDto,
  type EntryCardDto,
  type ReleaseDetailDto,
  type ReleaseSummaryDto,
} from "../_lib/reference-client";
import { entryHref, formatDate, readableToken, releaseName, rulesReferenceHref, rulesetReferenceHref } from "../_lib/reference-urls";
import { EntryCard } from "./EntryCard";
import { ReferenceFilters, type ReferenceFilterValue } from "./ReferenceFilters";
import { CompareWithSelector, IntegrityNotice, ReleaseSelector, ViewLatestReleaseButton } from "./ReleaseControls";

const PAGE_SIZE = 24;
const DEBOUNCE_MS = 300;
const FILTER_KEYS = ["search", "kind", "family", "branch", "entityType", "keywordId", "keywordLabel"] as const;

function filtersFrom(params: URLSearchParams): ReferenceFilterValue {
  return Object.fromEntries(FILTER_KEYS.map((k) => [k, params.get(k) ?? ""])) as unknown as ReferenceFilterValue;
}

const errorText = (e: unknown) => (e instanceof ReferenceApiError ? `${e.message} (${e.code})` : "Something went wrong loading this Release.");

/**
 * Browse ONE Release (PAS-10 M6-WO2): its metadata and integrity, Release selection, and its pinned entries with
 * server-side facets and paging. Filter and page state live in the URL; the Release lives in the path.
 */
export function ReleaseBrowser({ rulesetId, releaseId }: { rulesetId: string; releaseId: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const filters = useMemo(() => filtersFrom(params), [params]);
  const page = Math.max(1, Number(params.get("page") ?? "1") || 1);

  const [release, setRelease] = useState<ReleaseDetailDto | null>(null);
  const [releases, setReleases] = useState<ReleaseSummaryDto[]>([]);
  const [catalog, setCatalog] = useState<CatalogDto | null>(null);
  const [headerError, setHeaderError] = useState<string | null>(null);
  const [entries, setEntries] = useState<{ items: EntryCardDto[]; total: number; totalPages: number } | null>(null);
  const [entriesError, setEntriesError] = useState<string | null>(null);
  const [search, setSearch] = useState(filters.search);

  const loadHeader = useCallback(async () => {
    setHeaderError(null);
    try {
      const [detail, history] = await Promise.all([getRelease(rulesetId, releaseId), listReleases(rulesetId)]);
      setRelease(detail);
      setReleases(history.releases);
    } catch (e) {
      setHeaderError(errorText(e));
    }
    // The catalog only labels facets; a failure leaves the facets empty but the Release fully readable.
    getCatalog().then(setCatalog, () => setCatalog(null));
  }, [rulesetId, releaseId]);

  const loadEntries = useCallback(async () => {
    setEntries(null);
    setEntriesError(null);
    try {
      const r = await listEntries(rulesetId, releaseId, {
        page,
        pageSize: PAGE_SIZE,
        search: filters.search || undefined,
        kind: filters.kind || undefined,
        family: filters.family || undefined,
        branch: filters.branch || undefined,
        entityType: filters.entityType || undefined,
        keywordId: filters.keywordId || undefined,
      });
      setEntries({ items: r.data, total: r.pagination.total, totalPages: r.pagination.totalPages });
    } catch (e) {
      setEntriesError(errorText(e));
    }
  }, [rulesetId, releaseId, page, filters]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-dependency-change
    void loadHeader();
  }, [loadHeader]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-dependency-change
    void loadEntries();
  }, [loadEntries]);
  useEffect(() => {
    // Sync the local search box with the URL after back/forward.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSearch(filters.search);
  }, [filters.search]);

  const updateUrl = useCallback(
    (next: ReferenceFilterValue, nextPage = 1) => {
      const q = new URLSearchParams();
      for (const k of FILTER_KEYS) if (next[k]) q.set(k, next[k]);
      if (nextPage > 1) q.set("page", String(nextPage));
      const s = q.toString();
      router.push(s === "" ? pathname : `${pathname}?${s}`);
    },
    [pathname, router],
  );

  useEffect(() => {
    if (search === filters.search) return;
    const t = setTimeout(() => updateUrl({ ...filters, search }), DEBOUNCE_MS);
    return () => clearTimeout(t);
    // Only the typed text restarts the debounce.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  if (headerError !== null) return <ErrorState message={headerError} onRetry={() => void loadHeader()} />;
  if (release === null) return <LoadingState label="Loading Release…" />;
  const active = FILTER_KEYS.some((k) => k !== "keywordLabel" && filters[k] !== "");

  return (
    <div className="prowess-reference" data-testid="reference-release">
      <nav className="gov-crumbs" aria-label="Breadcrumb">
        <Link href={rulesReferenceHref()}>Rules Reference</Link> / <Link href={rulesetReferenceHref(rulesetId)}>{release.ruleset.name}</Link> /{" "}
        <span aria-current="page">{releaseName(release)}</span>
      </nav>
      <header className="prowess-reference__header">
        <p className="gov-eyebrow">Rules Reference — {release.ruleset.name}</p>
        <h1>{releaseName(release)}</h1>
        <p className="gov-meta">
          <span className="gov-tag">{readableToken(release.channel)}</span>
          <span className="gov-tag">Published {formatDate(release.publishedAt)}</span>
          <span className="gov-tag">{release.compositionSize} pinned entries</span>
        </p>
        {release.releaseNotes ? <p className="prowess-reference__notes">{release.releaseNotes}</p> : null}
        <div className="gov-actions prowess-reference__release-controls">
          <ReleaseSelector rulesetId={rulesetId} releaseId={releaseId} releases={releases} />
          <ViewLatestReleaseButton rulesetId={rulesetId} />
          <CompareWithSelector rulesetId={rulesetId} releaseId={releaseId} releases={releases} />
        </div>
        <IntegrityNotice release={release} />
      </header>

      <ReferenceFilters
        value={{ ...filters, search }}
        catalog={catalog}
        onChange={(next) => {
          setSearch(next.search);
          if (FILTER_KEYS.some((k) => k !== "search" && next[k] !== filters[k])) updateUrl(next);
        }}
      />

      <section aria-label="Entries in this Release" aria-busy={entries === null && entriesError === null}>
        {entriesError !== null ? <ErrorState message={entriesError} onRetry={() => void loadEntries()} /> : null}
        {entries === null && entriesError === null ? <LoadingState label="Loading entries…" /> : null}
        {entries !== null ? (
          entries.items.length === 0 ? (
            <EmptyState
              title={active ? "No entries in this Release match these filters" : "This Release pins no entries"}
              description={active ? "Try widening the search or clearing a filter." : "A Release is exactly its pinned entries; this one has none."}
            />
          ) : (
            <>
              <p className="gov-muted" role="status">
                {entries.total} {entries.total === 1 ? "entry" : "entries"}
              </p>
              <ul className="prowess-reference__cards" aria-label="Entries">
                {entries.items.map((c) => (
                  <EntryCard key={c.entityId} card={c} href={entryHref(rulesetId, releaseId, c.entityId)} />
                ))}
              </ul>
              <Pagination page={page} totalPages={entries.totalPages} total={entries.total} onPageChange={(p) => updateUrl(filters, p)} />
            </>
          )
        ) : null}
      </section>
    </div>
  );
}
