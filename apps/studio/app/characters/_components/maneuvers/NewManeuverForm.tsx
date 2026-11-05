"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { CharacterApiError, createManeuver } from "../../_lib/character-client";

/** /characters/:id/maneuvers/new — names a new Signature Maneuver DRAFT, then opens the builder (PAS-10 M6-WO8 §12, §19). */
export function NewManeuverForm({ characterId }: { characterId: string }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const id = encodeURIComponent(characterId);
  return (
    <div className="prowess-spell-builder" data-testid="maneuver-new">
      <nav className="gov-crumbs" aria-label="Breadcrumb">
        <Link href="/characters">Characters</Link> / <Link href={`/characters/${id}`}>Character</Link> / <Link href={`/characters/${id}/abilities`}>Abilities</Link> / <span aria-current="page">New Signature Maneuver</span>
      </nav>
      <h1>New Signature Maneuver</h1>
      <form
        className="gov-panel"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          try {
            const created = await createManeuver(characterId, name);
            router.push(`/characters/${id}/maneuvers/${encodeURIComponent(created.maneuver.id)}/edit`);
          } catch (err) {
            setError(err instanceof CharacterApiError ? `${err.message} (${err.code})` : "Could not start the Maneuver.");
            setBusy(false);
          }
        }}
      >
        <p className="gov-muted">A draft uses no Signature slot. The name is yours and never creates mechanics.</p>
        <label className="gov-field">
          <span>Maneuver name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} required data-testid="maneuver-new-name" />
        </label>
        <button type="submit" className="gov-button gov-button--primary" disabled={busy || name.trim() === ""} data-testid="maneuver-new-start">
          Start building
        </button>
        {error ? (
          <p className="gov-error" role="alert">
            {error}
          </p>
        ) : null}
      </form>
    </div>
  );
}
