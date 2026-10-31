"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { CharacterApiError, getCharacter, saveProfile, type CharacterDto } from "../_lib/character-client";
import { CharacterProgress } from "./CharacterProgress";
import { CharacterReview, releaseLabel } from "./CharacterReview";

/**
 * A Character's page (PAS-10 M6-WO3 §69, §74): its exact pinned Release, creation state, stored choices resolved by
 * the server, and the profile (name / concept), which stays editable after completion. Mechanics are read-only here;
 * a Draft continues in the creation wizard.
 */
export function CharacterSheetSummary({ characterId }: { characterId: string }) {
  const [c, setC] = useState<CharacterDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [profile, setProfile] = useState({ name: "", concept: "" });
  const [message, setMessage] = useState<string | null>(null);
  const load = useCallback(async () => {
    setError(null);
    try {
      const loaded = await getCharacter(characterId);
      setC(loaded);
      setProfile({ name: loaded.name, concept: loaded.concept ?? "" });
    } catch (e) {
      setError(e instanceof CharacterApiError ? `${e.message} (${e.code})` : "Could not load this Character.");
    }
  }, [characterId]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount
    void load();
  }, [load]);
  if (error !== null) return <p className="gov-error" role="alert">{error}</p>;
  if (c === null) return <p role="status">Loading Character…</p>;
  const names = c.names;
  return (
    <div className="prowess-character" data-testid="character-page">
      <nav className="gov-crumbs" aria-label="Breadcrumb">
        <Link href="/characters">Characters</Link> / <span aria-current="page">{c.name}</span>
      </nav>
      <header className="prowess-reference__header">
        <h1>{c.name}</h1>
        {c.concept ? <p>{c.concept}</p> : null}
        <p className="gov-meta">
          <span className="gov-tag" data-testid="character-status">
            {c.status === "CORE_COMPLETE" ? "Core Creation Complete" : "Draft"}
          </span>
          <span className="gov-tag">Level {c.level}</span>
          <span className="gov-tag" data-testid="character-pinned-release">
            Pinned to {releaseLabel(c.release)}
          </span>
        </p>
        <p className="gov-muted">This Character always uses the rules of {releaseLabel(c.release)}; a newer Release never changes it.</p>
        {c.status === "DRAFT" ? (
          <p className="gov-actions">
            <Link className="gov-button gov-button--primary" href={`/characters/${encodeURIComponent(c.id)}/create`}>
              Continue creation
            </Link>
          </p>
        ) : (
          <p className="gov-muted">The Character Sheet, Equipment and Ability Builders arrive in later M6 Work Orders.</p>
        )}
      </header>
      {c.status === "CORE_COMPLETE" ? <CharacterProgress character={c} /> : null}
      {c.status === "CORE_COMPLETE" && c.level !== c.resolution.resolved.level ? (
        <details className="gov-panel">
          <summary>Level 1 creation record</summary>
          <CharacterReview release={c.release} resolution={c.resolution} names={names} level={c.resolution.resolved.level ?? c.level} />
        </details>
      ) : (
        <CharacterReview release={c.release} resolution={c.resolution} names={names} level={c.level} />
      )}
      <form
        className="gov-panel"
        aria-label="Profile"
        onSubmit={async (e) => {
          e.preventDefault();
          setMessage(null);
          try {
            const saved = await saveProfile(c.id, c.lockVersion, profile.name, profile.concept.trim() === "" ? null : profile.concept);
            setC(saved);
            setMessage("Profile saved.");
          } catch (err) {
            setMessage(err instanceof CharacterApiError ? `${err.message} (${err.code})` : "Could not save the profile.");
          }
        }}
      >
        <h2>Profile</h2>
        <p className="gov-muted">Name and concept are descriptive and stay editable; they never change mechanics.</p>
        <label className="gov-field">
          <span>Name</span>
          <input value={profile.name} onChange={(e) => setProfile({ ...profile, name: e.target.value })} maxLength={120} />
        </label>
        <label className="gov-field">
          <span>Concept</span>
          <textarea value={profile.concept} onChange={(e) => setProfile({ ...profile, concept: e.target.value })} maxLength={2000} />
        </label>
        <button type="submit" className="gov-button">
          Save profile
        </button>
        {message ? <p role="status">{message}</p> : null}
      </form>
    </div>
  );
}
