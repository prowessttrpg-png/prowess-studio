"use client";

import { EmptyState } from "@prowess/ui";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { CharacterApiError, listCharacters, type CharacterListItemDto } from "../_lib/character-client";
import { releaseLabel } from "./CharacterReview";

/** The minimal Character index (PAS-10 M6-WO3 §54) — name, Level, exact Release, creation state, last updated. */
export function CharacterIndex() {
  const [items, setItems] = useState<CharacterListItemDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    setError(null);
    try {
      setItems((await listCharacters()).items);
    } catch (e) {
      setError(e instanceof CharacterApiError ? `${e.message} (${e.code})` : "Could not load Characters.");
    }
  }, []);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount
    void load();
  }, [load]);
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
      {error !== null ? (
        <p className="gov-error" role="alert">
          {error} <button type="button" className="gov-link-button" onClick={() => void load()}>Try again</button>
        </p>
      ) : null}
      {items === null && error === null ? <p role="status">Loading Characters…</p> : null}
      {items !== null && items.length === 0 ? <EmptyState title="No Characters yet" description="Create one from a published Release." /> : null}
      {items !== null && items.length > 0 ? (
        <table className="prowess-reference__table" aria-label="Characters">
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">Level</th>
              <th scope="col">Release</th>
              <th scope="col">Status</th>
              <th scope="col">Last updated</th>
            </tr>
          </thead>
          <tbody>
            {items.map((c) => (
              <tr key={c.id} data-testid="character-row">
                <th scope="row">
                  <Link href={`/characters/${encodeURIComponent(c.id)}`}>{c.name}</Link>
                </th>
                <td>{c.level}</td>
                <td>{releaseLabel(c.release)}</td>
                <td>{c.status === "CORE_COMPLETE" ? "Core Creation Complete" : "Draft"}</td>
                <td>{new Date(c.updatedAt).toISOString().slice(0, 16).replace("T", " ")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </div>
  );
}
