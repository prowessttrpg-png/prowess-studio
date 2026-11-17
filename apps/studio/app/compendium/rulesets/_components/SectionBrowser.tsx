"use client";

import { COMPENDIUM_SECTIONS, COMPENDIUM_STAT_TOKENS, compendiumSection, type CompendiumSection } from "@prowess/model";
import { EmptyState, Pagination } from "@prowess/ui";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { ErrorState } from "../../_components/ErrorState";
import { LoadingState } from "../../_components/LoadingState";
import { getRelease, listEntries, ReferenceApiError, type EntryCardDto, type ReleaseDetailDto } from "../_lib/reference-client";
import { entryHref, readableToken, releaseHref, releaseName, rulesReferenceHref, rulesetReferenceHref, sectionHref, sectionsHref, statHref } from "../_lib/reference-urls";
import { EntryCard } from "./EntryCard";

/**
 * PRE-M7-WO1 — Compendium topic sections of ONE exact Release. Sections are presentation only: each lists the pinned
 * revisions of the Definition kinds it groups (server-side `section` facet) and, separately, generic reference content of
 * the EntityTypes it groups. Reserved kinds are named honestly as not yet authorable. The Release is always in the path.
 */
const PAGE_SIZE = 24;
const DEBOUNCE_MS = 300;
const errorText = (e: unknown) => (e instanceof ReferenceApiError ? `${e.message} (${e.code})` : "Something went wrong loading this section.");

const ROLE_TEXT: Record<CompendiumSection["role"], string> = {
  EXECUTABLE: "Rules the engine executes",
  REFERENCE: "Reference content (not executed by the engine)",
  MIXED: "Executable rules and reference content",
};

function useRelease(rulesetId: string, releaseId: string) {
  const [release, setRelease] = useState<ReleaseDetailDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    setError(null);
    try {
      setRelease(await getRelease(rulesetId, releaseId));
    } catch (e) {
      setError(errorText(e));
    }
  }, [rulesetId, releaseId]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-dependency-change
    void load();
  }, [load]);
  return { release, error, reload: load };
}

function Crumbs({ rulesetId, releaseId, release, current }: { rulesetId: string; releaseId: string; release: ReleaseDetailDto; current: CompendiumSection | null }) {
  return (
    <nav className="gov-crumbs" aria-label="Breadcrumb">
      <Link href={rulesReferenceHref()}>Rules Reference</Link> / <Link href={rulesetReferenceHref(rulesetId)}>{release.ruleset.name}</Link> /{" "}
      <Link href={releaseHref(rulesetId, releaseId)}>{releaseName(release)}</Link> /{" "}
      {current === null ? (
        <span aria-current="page">Topics</span>
      ) : (
        <>
          <Link href={sectionsHref(rulesetId, releaseId)}>Topics</Link> / <span aria-current="page">{current.title}</span>
        </>
      )}
    </nav>
  );
}

/** /compendium/rulesets/:r/releases/:rel/sections — every topic section of this exact Release. */
export function SectionsOverview({ rulesetId, releaseId }: { rulesetId: string; releaseId: string }) {
  const { release, error, reload } = useRelease(rulesetId, releaseId);
  if (error !== null) return <ErrorState message={error} onRetry={() => void reload()} />;
  if (release === null) return <LoadingState label="Loading Release…" />;
  return (
    <div className="prowess-reference" data-testid="compendium-sections">
      <Crumbs rulesetId={rulesetId} releaseId={releaseId} release={release} current={null} />
      <header className="prowess-reference__header">
        <p className="gov-eyebrow">Compendium — {release.ruleset.name}</p>
        <h1>Browse by topic</h1>
        <p className="gov-muted">
          Showing exactly {releaseName(release)}. Each topic groups the same pinned rules you can find in the full list; nothing is copied.
        </p>
      </header>
      <ul className="prowess-reference__cards" aria-label="Topics">
        {COMPENDIUM_SECTIONS.map((s) => (
          <li key={s.key} className="gov-card gov-card--compact prowess-reference__card" data-testid={`section-card-${s.key}`}>
            <p className="prowess-reference__card-title">
              <Link href={sectionHref(rulesetId, releaseId, s.key)}>{s.title}</Link>
            </p>
            <p className="gov-meta">
              <span className="gov-tag">{ROLE_TEXT[s.role]}</span>
            </p>
            <p>{s.summary}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}

function EntryList({ rulesetId, releaseId, label, filters, search, testid }: { rulesetId: string; releaseId: string; label: string; filters: { section?: string; kind?: string; entityType?: string }; search: string; testid: string }) {
  const [page, setPage] = useState(1);
  const [state, setState] = useState<{ items: EntryCardDto[]; total: number; totalPages: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    setState(null);
    setError(null);
    try {
      const r = await listEntries(rulesetId, releaseId, { ...filters, search: search || undefined, page, pageSize: PAGE_SIZE });
      setState({ items: r.data, total: r.pagination.total, totalPages: r.pagination.totalPages });
    } catch (e) {
      setError(errorText(e));
    }
    // filters is a fresh literal each render; its fields are the real dependencies.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rulesetId, releaseId, filters.section, filters.kind, filters.entityType, search, page]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-dependency-change
    void load();
  }, [load]);
  useEffect(() => {
    // A new search starts again at the first page.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPage(1);
  }, [search]);
  return (
    <section aria-label={label} aria-busy={state === null && error === null} data-testid={testid}>
      <h2>{label}</h2>
      {error !== null ? <ErrorState message={error} onRetry={() => void load()} /> : null}
      {state === null && error === null ? <LoadingState label="Loading entries…" /> : null}
      {state !== null ? (
        state.items.length === 0 ? (
          <EmptyState title={search ? "Nothing here matches this search" : "This Release has no entries of this kind"} description={search ? "Try a different search." : "A Release is exactly its pinned entries."} />
        ) : (
          <>
            <p className="gov-muted" role="status">
              {state.total} {state.total === 1 ? "entry" : "entries"}
            </p>
            <ul className="prowess-reference__cards" aria-label={label}>
              {state.items.map((c) => (
                <EntryCard key={c.entityId} card={c} href={entryHref(rulesetId, releaseId, c.entityId)} />
              ))}
            </ul>
            <Pagination page={page} totalPages={state.totalPages} total={state.total} onPageChange={setPage} />
          </>
        )
      ) : null}
    </section>
  );
}

/** /compendium/rulesets/:r/releases/:rel/sections/:section — one topic of this exact Release, searchable. */
export function SectionBrowser({ rulesetId, releaseId, sectionKey }: { rulesetId: string; releaseId: string; sectionKey: string }) {
  const section = compendiumSection(sectionKey);
  const { release, error, reload } = useRelease(rulesetId, releaseId);
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const urlSearch = params.get("search") ?? "";
  const [search, setSearch] = useState(urlSearch);
  useEffect(() => {
    // Sync the search box with the URL after back/forward.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSearch(urlSearch);
  }, [urlSearch]);
  useEffect(() => {
    if (search === urlSearch) return;
    const t = setTimeout(() => router.replace(search === "" ? pathname : `${pathname}?search=${encodeURIComponent(search)}`), DEBOUNCE_MS);
    return () => clearTimeout(t);
    // Only the typed text restarts the debounce.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  if (section === null) return <EmptyState title="There is no such topic" description={`"${sectionKey}" is not a Compendium topic.`} />;
  if (error !== null) return <ErrorState message={error} onRetry={() => void reload()} />;
  if (release === null) return <LoadingState label="Loading Release…" />;
  const hasDefinitions = section.kinds.length + section.alsoShows.length > 0;
  return (
    <div className="prowess-reference" data-testid="compendium-section" data-section={section.key}>
      <Crumbs rulesetId={rulesetId} releaseId={releaseId} release={release} current={section} />
      <header className="prowess-reference__header">
        <p className="gov-eyebrow">
          {release.ruleset.name} — {releaseName(release)}
        </p>
        <h1>{section.title}</h1>
        <p>{section.summary}</p>
        <p className="gov-meta">
          <span className="gov-tag">{ROLE_TEXT[section.role]}</span>
        </p>
        <p>
          <Link href={sectionsHref(rulesetId, releaseId)} data-testid="section-back">
            ← All topics
          </Link>
        </p>
      </header>

      {section.key === "stats" ? (
        <section aria-label="What each Stat affects" data-testid="section-stat-links">
          <h2>What each Stat affects</h2>
          <p className="gov-muted">Open a Stat to see every rule in this Release that reads it, directly or through another calculation.</p>
          <ul className="gov-actions" aria-label="Stats">
            {COMPENDIUM_STAT_TOKENS.map((s) => (
              <li key={s}>
                <Link className="gov-button" href={statHref(rulesetId, releaseId, s)} data-testid={`stat-link-${s}`}>
                  {s}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <div className="gov-field">
        <label htmlFor="section-search">Search {section.title}</label>
        <input id="section-search" type="search" value={search} onChange={(e) => setSearch(e.target.value)} data-testid="section-search" />
      </div>

      {hasDefinitions ? (
        <EntryList rulesetId={rulesetId} releaseId={releaseId} label={`${section.title} rules`} filters={{ section: section.key }} search={search} testid="section-definitions" />
      ) : null}
      {section.genericEntityTypes.map((t) => (
        <EntryList key={t} rulesetId={rulesetId} releaseId={releaseId} label={`${readableToken(t)} reference entries`} filters={{ kind: "GENERIC", entityType: t }} search={search} testid={`section-generic-${t}`} />
      ))}
      {section.alsoShows.length > 0 ? (
        <p className="gov-muted" data-testid="section-also-shows">
          Also listed here (owned by another topic): {section.alsoShows.map(readableToken).join(", ")}.
        </p>
      ) : null}
      {section.reservedKinds.length > 0 ? (
        <section aria-label="Not yet authorable" className="gov-card gov-card--compact" data-testid="section-reserved">
          <h2>Not yet authorable</h2>
          <p>
            These kinds are known to the rules system but have no supported rule contract yet, so they cannot be created or edited as working rules:{" "}
            {section.reservedKinds.map(readableToken).join(", ")}.
          </p>
        </section>
      ) : null}
    </div>
  );
}
