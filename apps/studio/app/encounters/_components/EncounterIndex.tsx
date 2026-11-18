"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { EncounterApiError, listEncounters, releaseLabel, type EncounterListItemDto } from "../_lib/encounter-client";

const STATUSES = [
  { value: "ALL", label: "All" },
  { value: "PREPARATION", label: "In preparation" },
  { value: "ARCHIVED", label: "Archived" },
] as const;

/** The encounter list (M7-WO1): search, status filter and paging are the server's; rows are summaries only. */
export function EncounterIndex() {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<(typeof STATUSES)[number]["value"]>("ALL");
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<EncounterListItemDto[] | null>(null);
  const [pages, setPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);

  useEffect(() => {
    const mine = ++seq.current;
    const timer = setTimeout(() => {
      listEncounters({ page, pageSize: 25, q, status }).then(
        (r) => {
          if (mine !== seq.current) return;
          setRows(r.items);
          setPages(Math.max(1, r.pagination.totalPages));
          setTotal(r.pagination.total);
          setError(null);
        },
        (e: unknown) => mine === seq.current && setError(e instanceof EncounterApiError ? e.message : "Could not load encounters."),
      );
    }, 250);
    return () => clearTimeout(timer);
  }, [q, status, page]);

  return (
    <section className="gov-page prowess-encounter" aria-labelledby="encounters-heading" data-testid="encounter-index">
      <h1 id="encounters-heading">Encounters</h1>
      <p>Prepare an encounter: choose its exact published Release, name its sides and add completed Characters from that Release. Combat itself is not started here yet.</p>
      <p className="gov-actions">
        <Link className="gov-button" href="/encounters/new">
          New encounter
        </Link>
      </p>
      <form className="prowess-encounter__filters" role="search" aria-label="Find encounters" onSubmit={(e) => e.preventDefault()}>
        <label className="gov-field">
          <span>Search by name</span>
          <input
            value={q}
            maxLength={120}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(1);
            }}
          />
        </label>
        <fieldset className="gov-field">
          <legend>Status</legend>
          {STATUSES.map((s) => (
            <label key={s.value} className="prowess-encounter__radio">
              <input
                type="radio"
                name="encounter-status"
                value={s.value}
                checked={status === s.value}
                onChange={() => {
                  setStatus(s.value);
                  setPage(1);
                }}
              />{" "}
              {s.label}
            </label>
          ))}
        </fieldset>
      </form>
      {error !== null ? (
        <p className="gov-error" role="alert">
          {error}
        </p>
      ) : null}
      {rows === null && error === null ? <p role="status">Loading encounters…</p> : null}
      {rows !== null && rows.length === 0 ? (
        <p className="gov-muted" data-testid="encounters-empty">
          {q.trim() === "" && status === "ALL" ? "No encounters yet. Create one to start preparing." : "No encounter matches this search."}
        </p>
      ) : null}
      {rows !== null && rows.length > 0 ? (
        <ul className="prowess-encounter__list" aria-label={`Encounters (${total})`}>
          {rows.map((r) => (
            <li key={r.id} className="gov-card gov-card--compact" data-testid="encounter-row">
              <h2>
                <Link href={`/encounters/${encodeURIComponent(r.id)}`}>{r.name}</Link>
              </h2>
              <p>
                <span className="gov-badge">{r.status === "ARCHIVED" ? "Archived" : "In preparation"}</span> {releaseLabel(r.release)}
              </p>
              <p className="gov-muted">
                {r.sideCount} side{r.sideCount === 1 ? "" : "s"} · {r.participantCount} participant{r.participantCount === 1 ? "" : "s"} · updated {new Date(r.updatedAt).toLocaleString()}
              </p>
            </li>
          ))}
        </ul>
      ) : null}
      {pages > 1 ? (
        <nav className="gov-actions" aria-label="Pages">
          <button type="button" className="gov-button" disabled={page <= 1} onClick={() => setPage(page - 1)}>
            Previous
          </button>
          <span>
            Page {page} of {pages}
          </span>
          <button type="button" className="gov-button" disabled={page >= pages} onClick={() => setPage(page + 1)}>
            Next
          </button>
        </nav>
      ) : null}
    </section>
  );
}
