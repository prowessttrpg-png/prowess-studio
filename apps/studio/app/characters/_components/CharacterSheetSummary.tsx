"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { CharacterApiError, getCharacter, saveProfile, type CharacterDto } from "../_lib/character-client";
import { AccessPanel, AdvancementHistory, CharacterProgress } from "./CharacterProgress";
import { CharacterReview, releaseLabel } from "./CharacterReview";
import { CharacterSheet } from "./sheet/CharacterSheet";
import { AttackLibraryPanel } from "./AttackLibraryPanel";

/** PAS-10 M6-WO5 §66: a completed Character's views. The Sheet is the default; the others keep WO3 / WO4 content. */
const VIEWS = [
  { key: "sheet", label: "Sheet" },
  { key: "advancement", label: "Advancement" },
  { key: "access", label: "Rules / Access" },
  // M6-WO6: the Character Attack Library with the per-Attack damage inspector.
  { key: "attacks", label: "Attacks" },
  { key: "history", label: "History" },
] as const;
type View = (typeof VIEWS)[number]["key"];

/** The view tabs (WAI-ARIA tabs: arrow keys / Home / End move between them; the choice is kept in `?view=`). */
function ViewTabs({ view, onChoose }: { view: View; onChoose: (next: View) => void }) {
  return (
    <div
      className="character-tabs"
      role="tablist"
      aria-label="Character views"
      onKeyDown={(e) => {
        const at = VIEWS.findIndex((v) => v.key === view);
        const to = e.key === "ArrowRight" ? at + 1 : e.key === "ArrowLeft" ? at - 1 : e.key === "Home" ? 0 : e.key === "End" ? VIEWS.length - 1 : null;
        if (to === null) return;
        e.preventDefault();
        const next = VIEWS[(to + VIEWS.length) % VIEWS.length]!.key;
        onChoose(next);
        (e.currentTarget.querySelector(`#character-tab-${next}`) as HTMLButtonElement | null)?.focus();
      }}
    >
      {VIEWS.map((v) => (
        <button key={v.key} type="button" role="tab" id={`character-tab-${v.key}`} aria-selected={view === v.key} aria-controls={`character-view-${v.key}`} tabIndex={view === v.key ? 0 : -1} onClick={() => onChoose(v.key)}>
          {v.label}
        </button>
      ))}
    </div>
  );
}

/**
 * A Character's page (PAS-10 M6-WO3 §69, §74): its exact pinned Release, creation state, stored choices resolved by
 * the server, and the profile (name / concept), which stays editable after completion. Mechanics are read-only here;
 * a Draft continues in the creation wizard.
 */
export function CharacterSheetSummary({ characterId }: { characterId: string }) {
  const requested = useSearchParams()?.get("view") ?? "sheet";
  const [view, setView] = useState<View>(VIEWS.some((v) => v.key === requested) ? (requested as View) : "sheet");
  const choose = (next: View) => {
    setView(next);
    window.history.replaceState(null, "", `?view=${next}`);
  };
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
        ) : null}
      </header>
      {c.status === "DRAFT" ? <CharacterReview release={c.release} resolution={c.resolution} names={names} level={c.level} /> : null}
      {c.status === "CORE_COMPLETE" ? (
        <>
          <ViewTabs view={view} onChoose={choose} />
          <div role="tabpanel" id={`character-view-${view}`} aria-labelledby={`character-tab-${view}`} data-testid={`character-view-${view}`}>
            {view === "sheet" ? <CharacterSheet characterId={c.id} /> : null}
            {view === "advancement" ? (
              <>
                <CharacterProgress character={c} />
                {c.level !== c.resolution.resolved.level ? (
                  <details className="gov-panel">
                    <summary>Level 1 creation record</summary>
                    <CharacterReview release={c.release} resolution={c.resolution} names={names} level={c.resolution.resolved.level ?? c.level} />
                  </details>
                ) : (
                  <CharacterReview release={c.release} resolution={c.resolution} names={names} level={c.level} />
                )}
              </>
            ) : null}
            {view === "access" ? <AccessPanel characterId={c.id} level={c.level} /> : null}
            {view === "attacks" ? <AttackLibraryPanel characterId={c.id} /> : null}
            {view === "history" ? (
              <section className="gov-panel" aria-labelledby="history-heading">
                <h2 id="history-heading">Advancement history</h2>
                <AdvancementHistory history={c.advancementHistory ?? []} names={names} />
                <details>
                  <summary>Level 1 creation record</summary>
                  <CharacterReview release={c.release} resolution={c.resolution} names={names} level={c.resolution.resolved.level ?? c.level} />
                </details>
              </section>
            ) : null}
          </div>
        </>
      ) : null}
      {c.status === "DRAFT" || view === "advancement" ? (
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
      ) : null}
    </div>
  );
}
