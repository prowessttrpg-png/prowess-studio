"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { CardCategoryDto, CardLibraryDto } from "../../_lib/card-types";
import { CATEGORY_FILTERS, CATEGORY_LABELS, ENTRY_STATE_LABELS, filterEntries, findEntry, libraryEntries, revisionsOf, valueShort, type LibraryEntry } from "../../_lib/card-format";
import { CharacterApiError, getCardLibrary } from "../../_lib/character-client";
import { releaseLabel } from "../CharacterReview";
import { CardViewer, isViewMode, type ViewMode } from "./CardViewer";
import "./cards.css";

/**
 * The Character Card Library (PAS-10 M6-WO9 Phase C) over the read-only Card Library API: current Signature Spells and
 * Maneuvers, the current loadout's Weapons and Attacks, General Actions and the Mage Art domain status. By default only
 * cards usable now are listed; drafts, retired Abilities and history are opt-in and always labelled as not usable.
 * The URL keeps the exact card key (and view mode), so a mode change never switches the card or its revision.
 */
export interface CardQuery {
  card?: string | null;
  ability?: string | null;
  attack?: string | null;
  hand?: string | null;
  mode?: string | null;
  category?: string | null;
}

function writeUrl(cardKey: string | null, mode: ViewMode) {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  for (const k of ["card", "ability", "attack", "hand"]) url.searchParams.delete(k);
  if (cardKey !== null) url.searchParams.set("card", cardKey);
  url.searchParams.set("mode", mode);
  window.history.replaceState(window.history.state, "", url.toString());
}

export function CardLibrary({ characterId, query }: { characterId: string; query: CardQuery }) {
  const [lib, setLib] = useState<CardLibraryDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [category, setCategory] = useState<CardCategoryDto | "ALL">(CATEGORY_FILTERS.some((c) => c.key === query.category) ? (query.category as CardCategoryDto) : "ALL");
  const [search, setSearch] = useState("");
  const [includeHistory, setIncludeHistory] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [mode, setMode] = useState<ViewMode>(isViewMode(query.mode ?? null) ? (query.mode as ViewMode) : "illustrated");

  const load = useCallback(async () => {
    setError(null);
    try {
      const next = await getCardLibrary(characterId);
      setLib(next);
      const asked = query.card || query.ability || query.attack;
      if (asked) {
        const hit = findEntry(libraryEntries(next), query);
        if (hit === null) setNotFound(true);
        else {
          setSelected(hit.key);
          if (hit.state !== "ACTIVE" && hit.state !== "EQUIPPED" && hit.state !== "AVAILABLE") setIncludeHistory(true);
        }
      }
    } catch (e) {
      setError(e instanceof CharacterApiError ? `${e.message} (${e.code})` : "Could not load the Card Library.");
    }
    // The initial query is read once on load; later navigation keeps the URL in step with the selection.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [characterId]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount
    void load();
  }, [load]);

  const entries = useMemo(() => (lib === null ? [] : libraryEntries(lib)), [lib]);
  const shown = useMemo(() => filterEntries(entries, { category, search, includeHistory }), [entries, category, search, includeHistory]);
  const current = entries.find((e) => e.key === selected) ?? null;

  const open = (key: string) => {
    setSelected(key);
    setNotFound(false);
    writeUrl(key, mode);
  };
  const changeMode = (m: ViewMode) => {
    setMode(m);
    writeUrl(selected, m);
  };

  if (error !== null)
    return (
      <p className="gov-error" role="alert" data-testid="cards-error">
        {error}{" "}
        <button type="button" className="gov-link-button" onClick={() => void load()}>
          Try again
        </button>
      </p>
    );
  if (lib === null) return <p role="status">Loading the Card Library…</p>;
  const release = releaseLabel(lib.release);
  const id = encodeURIComponent(lib.character.id);

  return (
    <div className="fcard-scope fcard-library" data-testid="card-library" data-character={lib.character.id}>
      <p className="fcard-muted" data-testid="cards-release">
        {lib.character.name} · Level {lib.character.level} · pinned to {release}. Every card is the server&apos;s evaluation for this Release; nothing is rolled, spent or recalculated here.
      </p>
      <p className="fcard-toolbar">
        <Link className="fcard-button" href={`/characters/${id}`}>
          Character Sheet
        </Link>
        <Link className="fcard-button" href={`/characters/${id}/actions`} data-testid="cards-directory-link">
          Action Directory
        </Link>
        <Link className="fcard-button" href={`/characters/${id}/cards/print`} target="_blank" rel="noopener" data-testid="cards-print-all">
          Print current cards
        </Link>
      </p>
      <div className="fcard-filters" role="search">
        <label className="gov-field">
          <span>Search by card name</span>
          <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} data-testid="cards-search" />
        </label>
        <label className="gov-field">
          <span>Category</span>
          <select value={category} onChange={(e) => setCategory(e.target.value as CardCategoryDto | "ALL")} data-testid="cards-category">
            {CATEGORY_FILTERS.map((c) => (
              <option key={c.key} value={c.key}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <input type="checkbox" checked={includeHistory} onChange={(e) => setIncludeHistory(e.target.checked)} data-testid="cards-history" /> Include drafts, retired Abilities and revision history
        </label>
      </div>
      {notFound ? (
        <p className="sheet-error" role="alert" data-testid="cards-not-found">
          That card is not part of this Character&apos;s library for its pinned Release. No other card was opened in its place.
        </p>
      ) : null}
      <div className="fcard-library__layout">
        <nav aria-label="Cards" className="fcard-library__list">
          {shown.length === 0 ? (
            <p className="fcard-empty" data-testid="cards-empty">
              No cards match these filters.
            </p>
          ) : (
            <ul data-testid="cards-list">
              {shown.map((e) => (
                <EntryRow key={e.key} entry={e} selected={e.key === selected} onOpen={open} />
              ))}
            </ul>
          )}
        </nav>
        <div className="fcard-library__viewer">
          {current === null ? (
            <p className="fcard-empty" data-testid="cards-no-selection">
              Choose a card to open it.
            </p>
          ) : current.card === null ? (
            <section className="fcard-unavailable" data-testid="card-unavailable" aria-label={`${current.name} — unavailable`}>
              <h2>{current.name}</h2>
              <p>
                <strong>{ENTRY_STATE_LABELS[current.state]}.</strong> {current.reason ?? "No card can be shown."}
              </p>
            </section>
          ) : (
            <CardViewer key={current.key} entry={current} card={current.card} names={lib.names} release={release} characterId={lib.character.id} mode={mode} onMode={changeMode} revisions={revisionsOf(entries, current.abilityId)} onOpen={open} />
          )}
        </div>
      </div>
    </div>
  );
}

function EntryRow({ entry, selected, onOpen }: { entry: LibraryEntry; selected: boolean; onOpen: (key: string) => void }) {
  const c = entry.card;
  return (
    <li className="fcard-entry" data-testid="card-entry" data-key={entry.key} data-state={entry.state} data-category={entry.category}>
      <button type="button" className="fcard-entry__button" aria-current={selected ? "true" : undefined} onClick={() => onOpen(entry.key)} data-testid="card-entry-open">
        <span className="fcard-entry__name">{entry.name}</span>
        <span className="fcard-entry__meta">
          {CATEGORY_LABELS[entry.category]}
          {entry.revisionNumber !== null ? ` · r${entry.revisionNumber}` : ""} · <span className="fcard-tag">{ENTRY_STATE_LABELS[entry.state]}</span>
          {c !== null ? ` · ${valueShort(c.costs.ap)} AP · ${valueShort(c.costs.mp)} MP` : ""}
        </span>
      </button>
    </li>
  );
}
