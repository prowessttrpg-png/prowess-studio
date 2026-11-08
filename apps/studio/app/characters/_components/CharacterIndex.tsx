"use client";

import { EmptyState } from "@prowess/ui";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { CharacterApiError, listCharacters, type CharacterLibraryStatus, type CharacterListItemDto } from "../_lib/character-client";
import { releaseLabel } from "./CharacterReview";

/** Rows per Library page (the WO3 client default). */
export const LIBRARY_PAGE_SIZE = 50;
/** Typing settles for this long before a search is sent (each change still resets to page 1). */
export const LIBRARY_SEARCH_DEBOUNCE_MS = 250;
const STATUS_OPTIONS: ReadonlyArray<{ value: CharacterLibraryStatus; label: string }> = [
  { value: "ALL", label: "All" },
  { value: "DRAFT", label: "Draft" },
  { value: "CORE_COMPLETE", label: "Core Complete" },
];

interface LibraryQuery {
  readonly q: string;
  readonly status: CharacterLibraryStatus;
  readonly page: number;
}
interface LibraryPage {
  readonly query: LibraryQuery;
  readonly items: readonly CharacterListItemDto[];
  readonly total: number;
  readonly totalPages: number;
}

/** Destinations come only from the persisted status and id (M6-WO11 §3). */
export function libraryActions(c: Pick<CharacterListItemDto, "id" | "status">): ReadonlyArray<{ label: string; href: string; testid: string }> {
  const id = encodeURIComponent(c.id);
  return c.status === "CORE_COMPLETE"
    ? [
        { label: "Open sheet", href: `/characters/${id}`, testid: "library-open-sheet" },
        { label: "Resume play", href: `/characters/${id}/play`, testid: "library-resume-play" },
      ]
    : [{ label: "Continue creation", href: `/characters/${id}/create`, testid: "library-continue-creation" }];
}

/**
 * The Character Library (PAS-10 M6-WO3 §54 index, extended by M6-WO11): name search, status filter and paging over the
 * server's filtered collection — filtering happens on the server before pagination, and only the LATEST request may
 * update the screen (a slower, older response is discarded). Rows show name, Level, exact Release, creation status,
 * the Character record's last update and a short id that tells same-named Characters apart. Opening is a read.
 */
export function CharacterIndex() {
  const [input, setInput] = useState("");
  const [query, setQuery] = useState<LibraryQuery>({ q: "", status: "ALL", page: 1 });
  const [result, setResult] = useState<LibraryPage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const seq = useRef(0);

  const load = useCallback(async (q: LibraryQuery) => {
    const mine = ++seq.current;
    setLoading(true);
    setError(null);
    try {
      const r = q.q.trim() === "" && q.status === "ALL" && q.page === 1 ? await listCharacters() : await listCharacters(q.page, LIBRARY_PAGE_SIZE, { q: q.q, status: q.status });
      if (mine !== seq.current) return; // a newer request owns the screen
      setResult({ query: q, items: r.items, total: r.total, totalPages: "totalPages" in r && typeof r.totalPages === "number" ? r.totalPages : 1 });
    } catch (e) {
      if (mine !== seq.current) return;
      setError(e instanceof CharacterApiError ? `${e.message} (${e.code})` : "Could not load Characters.");
    } finally {
      if (mine === seq.current) setLoading(false);
    }
  }, []);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch on every query change
    void load(query);
  }, [load, query]);
  // The search input settles before it becomes the query; a filter change resets to page 1.
  useEffect(() => {
    if (input === query.q) return;
    const t = setTimeout(() => setQuery((q) => ({ ...q, q: input, page: 1 })), LIBRARY_SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [input, query.q]);

  const filtered = query.q.trim() !== "" || query.status !== "ALL";
  const shown = result !== null && result.query === query ? result : null;
  const lastPage = shown === null || shown.totalPages < 1 ? 1 : shown.totalPages;

  return (
    <div className="prowess-character" data-testid="character-index">
      <header className="prowess-reference__header">
        <h1>Characters</h1>
        <p>Each Character is built against one exact published Release and stays on it.</p>
        <p className="gov-actions">
          <Link className="gov-button gov-button--primary" href="/characters/new">
            New Character
          </Link>
        </p>
      </header>
      <form className="library-filters" role="search" aria-label="Find Characters" onSubmit={(e) => { e.preventDefault(); setQuery((q) => ({ ...q, q: input, page: 1 })); }}>
        <label className="gov-field">
          <span>Search by name</span>
          <input type="search" value={input} maxLength={120} onChange={(e) => setInput(e.target.value)} data-testid="library-search" />
        </label>
        <fieldset className="library-status">
          <legend>Status</legend>
          {STATUS_OPTIONS.map((o) => (
            <label key={o.value}>
              <input type="radio" name="library-status" value={o.value} checked={query.status === o.value} onChange={() => setQuery((q) => ({ ...q, status: o.value, page: 1 }))} data-testid={`library-status-${o.value}`} /> {o.label}
            </label>
          ))}
        </fieldset>
      </form>
      {error !== null ? (
        <p className="gov-error" role="alert">
          {error}{" "}
          <button type="button" className="gov-link-button" onClick={() => void load(query)} data-testid="library-retry">
            Try again
          </button>
        </p>
      ) : null}
      {loading && error === null ? <p role="status">Loading Characters…</p> : null}
      {shown !== null && shown.total === 0 && !filtered ? <EmptyState title="No Characters yet" description="Create one from a published Release." /> : null}
      {shown !== null && shown.total === 0 && filtered ? (
        <p className="gov-muted" role="status" data-testid="library-no-matches">
          No Characters match this search and status.
        </p>
      ) : null}
      {shown !== null && shown.items.length > 0 ? (
        <>
          <p className="gov-muted" data-testid="library-total" aria-live="polite">
            {shown.total === 1 ? "1 Character" : `${String(shown.total)} Characters`}
            {filtered ? " match" : ""}
          </p>
          <div className="library-table-scroll">
            <table className="prowess-reference__table" aria-label="Characters">
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col">Level</th>
                  <th scope="col">Release</th>
                  <th scope="col">Status</th>
                  <th scope="col" title="The last saved change to the Character record itself: profile, creation choices, completion or advancement (UTC). Opening a Character does not change it.">
                    Record updated (UTC)
                  </th>
                  <th scope="col">Open</th>
                </tr>
              </thead>
              <tbody>
                {shown.items.map((c) => (
                  <tr key={c.id} data-testid="character-row" data-character-id={c.id}>
                    <th scope="row" id={`library-row-${c.id}`}>
                      <Link href={`/characters/${encodeURIComponent(c.id)}`}>{c.name}</Link>
                      <br />
                      <small className="gov-muted" title={`Character id ${c.id}`} data-testid="library-character-id">
                        id <code>{c.id.slice(0, 8)}</code>
                      </small>
                    </th>
                    <td>{c.level}</td>
                    <td>{releaseLabel(c.release)}</td>
                    <td>{c.status === "CORE_COMPLETE" ? "Core Creation Complete" : "Draft"}</td>
                    <td>
                      <time dateTime={c.updatedAt}>{new Date(c.updatedAt).toISOString().slice(0, 16).replace("T", " ")}</time>
                    </td>
                    <td>
                      {libraryActions(c).map((a) => (
                        <Link key={a.testid} className="gov-link-button library-action" href={a.href} data-testid={a.testid} aria-describedby={`library-row-${c.id}`}>
                          {a.label}
                        </Link>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <nav className="library-pages" aria-label="Library pages">
            <button type="button" className="gov-button" disabled={query.page <= 1 || loading} onClick={() => setQuery((q) => ({ ...q, page: q.page - 1 }))} data-testid="library-previous">
              Previous
            </button>
            <span data-testid="library-page">
              Page {query.page} of {lastPage}
            </span>
            <button type="button" className="gov-button" disabled={query.page >= lastPage || loading} onClick={() => setQuery((q) => ({ ...q, page: q.page + 1 }))} data-testid="library-next">
              Next
            </button>
          </nav>
        </>
      ) : null}
      {shown !== null && shown.items.length === 0 && shown.total > 0 ? (
        <p className="gov-muted" role="status" data-testid="library-page-empty">
          This page is past the end of the results.{" "}
          <button type="button" className="gov-link-button" onClick={() => setQuery((q) => ({ ...q, page: lastPage }))}>
            Go to the last page
          </button>
        </p>
      ) : null}
    </div>
  );
}
