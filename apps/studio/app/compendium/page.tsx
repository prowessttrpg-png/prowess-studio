"use client";

import { EmptyState, Pagination } from "@prowess/ui";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { EntityFilters, type EntityFiltersValue } from "./_components/EntityFilters";
import { EntityListRow } from "./_components/EntityListRow";
import { ErrorState } from "./_components/ErrorState";
import { LoadingState } from "./_components/LoadingState";
import {
  CompendiumApiError,
  listEntities,
  type EntityListItemDto,
} from "./_lib/api-client";

const DEFAULT_PAGE_SIZE = 20;
const SEARCH_DEBOUNCE_MS = 300;

function pageSizeFromSearchParams(searchParams: URLSearchParams): number {
  const raw = Number(searchParams.get("pageSize") ?? String(DEFAULT_PAGE_SIZE));
  return Number.isInteger(raw) && raw > 0 ? raw : DEFAULT_PAGE_SIZE;
}

function filtersFromSearchParams(searchParams: URLSearchParams): EntityFiltersValue {
  return {
    search: searchParams.get("search") ?? "",
    entityType: searchParams.get("entityType") ?? "",
    status: searchParams.get("status") ?? "",
    canonicalKey: searchParams.get("canonicalKey") ?? "",
    keyword: searchParams.get("keyword") ?? "",
  };
}

function pageFromSearchParams(searchParams: URLSearchParams): number {
  const raw = Number(searchParams.get("page") ?? "1");
  return Number.isInteger(raw) && raw > 0 ? raw : 1;
}

/**
 * The Entity Browser list (PAS-10 M1-WO9). Reflects search/filter/page
 * state in the URL (§7) so refresh, back/forward, and shareable links all
 * work — `?search=damage&entityType=SPELL_EFFECT&status=DRAFT&page=2`.
 * Every result comes from `GET /api/entities` (M1-WO8); there is no
 * client-side filtering over a pre-fetched dataset (§4, §8).
 */
function CompendiumBrowser() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const filters = useMemo(() => filtersFromSearchParams(searchParams), [searchParams]);
  const page = useMemo(() => pageFromSearchParams(searchParams), [searchParams]);
  // URL-configurable (PAS-10 M1-WO9 §38 permits "a smaller pageSize in
  // automated tests") — defaults to DEFAULT_PAGE_SIZE for ordinary use.
  const pageSize = useMemo(() => pageSizeFromSearchParams(searchParams), [searchParams]);

  // Local, immediately-responsive copy of the search field — debounced
  // before it's written to the URL (and therefore before it triggers a
  // new API call), so every keystroke doesn't fire a request.
  const [searchInput, setSearchInput] = useState(filters.search);
  useEffect(() => {
    // Syncing the URL's search value into local input state (e.g. after
    // browser back/forward) — the standard "derive local state from an
    // external source" pattern; there is no simpler non-effect expression
    // of "reset the input when the URL changes out from under it."
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSearchInput(filters.search);
  }, [filters.search]);

  const [result, setResult] = useState<{ items: EntityListItemDto[]; total: number; totalPages: number } | null>(
    null,
  );
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [errorMessage, setErrorMessage] = useState<string>("");

  const updateUrl = useCallback(
    (next: Partial<EntityFiltersValue> & { page?: number }) => {
      const params = new URLSearchParams(searchParams.toString());
      const merged = { ...filters, page, ...next };
      for (const key of ["search", "entityType", "status", "canonicalKey", "keyword"] as const) {
        if (merged[key]) {
          params.set(key, merged[key]);
        } else {
          params.delete(key);
        }
      }
      // Any filter change resets to page 1, unless this call is itself a
      // page change.
      const nextPage = next.page ?? 1;
      if (nextPage > 1) {
        params.set("page", String(nextPage));
      } else {
        params.delete("page");
      }
      router.push(`${pathname}?${params.toString()}`);
    },
    [filters, page, pathname, router, searchParams],
  );

  // Debounce writing the search field into the URL.
  useEffect(() => {
    if (searchInput === filters.search) {
      return;
    }
    const timer = setTimeout(() => {
      updateUrl({ search: searchInput });
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
    // Intentionally depends only on searchInput — updateUrl's identity
    // changes with every filter/page change, but re-running this effect
    // for that reason would restart the debounce timer without the user
    // having typed anything.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchInput]);

  const loadEntities = useCallback(async () => {
    setStatus("loading");
    try {
      const data = await listEntities({
        page,
        pageSize,
        search: filters.search || undefined,
        entityType: filters.entityType || undefined,
        status: filters.status || undefined,
        canonicalKey: filters.canonicalKey || undefined,
        keyword: filters.keyword || undefined,
      });
      setResult({ items: data.items, total: data.total, totalPages: data.totalPages });
      setStatus("ready");
    } catch (error) {
      setErrorMessage(
        error instanceof CompendiumApiError ? error.message : "Something went wrong loading Entities.",
      );
      setStatus("error");
    }
  }, [filters, page, pageSize]);

  useEffect(() => {
    // Standard data-fetch-on-dependency-change pattern: `loadEntities`
    // (itself calling setState once the request resolves) is memoized via
    // `useCallback` on exactly the values that should trigger a refetch
    // (filters, page) — there is no external-system subscription to
    // attach here instead; fetching data IS the synchronization this
    // effect performs.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadEntities();
  }, [loadEntities]);

  const hasActiveFilters =
    filters.search || filters.entityType || filters.status || filters.canonicalKey || filters.keyword;

  return (
    <>
      <EntityFilters
        value={{ ...filters, search: searchInput }}
        onChange={(next) => {
          setSearchInput(next.search);
          if (
            next.entityType !== filters.entityType ||
            next.status !== filters.status ||
            next.canonicalKey !== filters.canonicalKey ||
            next.keyword !== filters.keyword
          ) {
            updateUrl(next);
          }
        }}
      />

      <div className="prowess-compendium__results">
        {status === "loading" ? <LoadingState label="Loading Entities…" /> : null}

        {status === "error" ? <ErrorState message={errorMessage} onRetry={() => void loadEntities()} /> : null}

        {status === "ready" && result !== null ? (
          result.items.length === 0 ? (
            <EmptyState
              title={hasActiveFilters ? "No Entities match these filters" : "No Entities exist"}
              description={
                hasActiveFilters
                  ? "Try widening your search or clearing a filter."
                  : "Entities created through the API will appear here."
              }
            />
          ) : (
            <>
              <ul className="prowess-entity-list" data-testid="entity-list">
                {result.items.map((item) => (
                  <EntityListRow key={item.entity.id} item={item} />
                ))}
              </ul>
              <Pagination
                page={page}
                totalPages={result.totalPages}
                total={result.total}
                onPageChange={(nextPage) => updateUrl({ page: nextPage })}
              />
            </>
          )
        ) : null}
      </div>
    </>
  );
}

/**
 * The Compendium route. `CompendiumBrowser` reads the URL's query string via
 * `useSearchParams()`, and Next pre-renders this page at build time — a
 * component that reads search params during pre-rendering MUST sit inside a
 * `<Suspense>` boundary, or `next build` fails ("useSearchParams() should be
 * wrapped in a suspense boundary"). Found by the first real CI build; only the
 * production build does static page generation, so nothing earlier could catch
 * it (see tests/unit/suspense-search-params.test.ts for the early guard).
 *
 * The heading and description stay OUTSIDE the boundary so they are part of the
 * static HTML; only the URL-dependent browser is deferred to the client.
 */
export default function CompendiumPage() {
  return (
    <div className="prowess-compendium">
      <header className="prowess-compendium__header">
        <h1>Compendium</h1>
        <p className="prowess-compendium__description">
          An internal browser for the Prowess Entity system — identities, their latest
          authored revision, aliases, Keywords, relationships, and source provenance. This
          is a development tool, not the final published Prowess rulebook.
        </p>
      </header>

      <Suspense fallback={<LoadingState label="Loading Entities…" />}>
        <CompendiumBrowser />
      </Suspense>
    </div>
  );
}
