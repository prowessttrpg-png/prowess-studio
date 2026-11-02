"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { CharacterApiError, getSpell, retireSpell, type SignatureSpellDetailDto } from "../../_lib/character-client";
import { authorityLabel, shownOf, STATUS_LABELS } from "../../_lib/spell-format";
import { RuntimeWarnings, SpellReview, SpellStateBadge } from "./SpellReview";

/**
 * A Signature Spell (PAS-10 M6-WO7 §96, §133): the current revision in full — Effect Chain, Traits, Conditions, exact
 * cost breakdown, Affinity interaction, prerequisites, component links scoped to the Character's Release — and the
 * append-only revision history, each revision re-evaluated against its own pinned Release.
 */
export function SpellDetail({ characterId, spellId }: { characterId: string; spellId: string }) {
  const [data, setData] = useState<SignatureSpellDetailDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    setError(null);
    try {
      setData(await getSpell(characterId, spellId));
    } catch (e) {
      setError(e instanceof CharacterApiError ? `${e.message} (${e.code})` : "Could not load the Spell.");
    }
  }, [characterId, spellId]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount
    void load();
  }, [load]);
  if (error !== null) return <p className="gov-error" role="alert">{error}</p>;
  if (data === null) return <p role="status">Loading the Spell…</p>;
  const { spell, release, names } = data;
  const id = encodeURIComponent(characterId);
  const shown = shownOf(spell);
  const editHref = `/characters/${id}/spells/${encodeURIComponent(spell.id)}/edit`;
  return (
    <div className="prowess-spell-detail" data-testid="spell-detail">
      <nav className="gov-crumbs" aria-label="Breadcrumb">
        <Link href="/characters">Characters</Link> / <Link href={`/characters/${id}`}>{data.character.name}</Link> / <Link href={`/characters/${id}/abilities`}>Abilities</Link> / <span aria-current="page">{shown.draft?.concept.name ?? "Spell"}</span>
      </nav>
      <header className="prowess-reference__header">
        <h1 data-testid="spell-detail-name">{shown.draft?.concept.name ?? "Unreadable Spell"}</h1>
        <p className="gov-meta">
          <span className="gov-tag" data-testid="spell-detail-status">
            {STATUS_LABELS[spell.status]}
          </span>{" "}
          <SpellStateBadge state={spell.state} />
          {spell.current ? (
            <span className="gov-tag" data-testid="spell-detail-revision">
              Revision {spell.current.revisionNumber}
            </span>
          ) : null}
          <span className="gov-tag">{authorityLabel(shown.draft?.authority ?? null)}</span>
        </p>
        {shown.draft?.concept.description ? <p className="prowess-spell__prose">{shown.draft.concept.description}</p> : null}
        {shown.draft?.concept.visualDescription ? <p className="prowess-spell__prose gov-muted">{shown.draft.concept.visualDescription}</p> : null}
        {shown.draft && shown.draft.concept.narrativeTags.length > 0 ? <p className="gov-muted">Tags: {shown.draft.concept.narrativeTags.join(", ")}</p> : null}
        <p className="gov-actions">
          {spell.status === "DRAFT" ? (
            <Link className="gov-button gov-button--primary" href={editHref} data-testid="spell-detail-edit">
              Continue building
            </Link>
          ) : null}
          {spell.status === "ACTIVE" ? (
            <Link className="gov-button gov-button--primary" href={editHref} data-testid="spell-detail-rebuild">
              {spell.draft !== null ? "Continue rebuild" : "Rebuild"}
            </Link>
          ) : null}
          {spell.status !== "RETIRED" ? (
            <button
              type="button"
              className="gov-button"
              disabled={busy}
              data-testid="spell-detail-retire"
              onClick={async () => {
                if (!window.confirm("Retire this Spell? It leaves the roster and frees its Signature slot; its history stays.")) return;
                setBusy(true);
                try {
                  const next = await retireSpell(characterId, spellId, spell.lockVersion);
                  setData(next);
                  setMessage("Retired. Its history remains.");
                } catch (e) {
                  setMessage(e instanceof CharacterApiError ? `${e.message} (${e.code})` : "Could not retire the Spell.");
                } finally {
                  setBusy(false);
                }
              }}
            >
              Retire
            </button>
          ) : null}
        </p>
        {message ? <p role="status">{message}</p> : null}
      </header>
      <RuntimeWarnings evaluation={shown.evaluation} />
      {shown.draft ? (
        <section className="gov-panel" aria-labelledby="spell-detail-current">
          <h2 id="spell-detail-current">{spell.current ? `Current revision (Revision ${spell.current.revisionNumber})` : "Draft"}</h2>
          <SpellReview draft={shown.draft} evaluation={shown.evaluation} release={release} names={names} />
        </section>
      ) : (
        <p className="gov-error">This Spell&apos;s stored selections could not be read.</p>
      )}
      {spell.current && spell.draft ? (
        <p className="gov-muted" data-testid="spell-detail-rebuild-note">
          A rebuild is in progress; Revision {spell.current.revisionNumber} stays current until a valid rebuild is finalized.
        </p>
      ) : null}
      <section className="gov-panel" aria-labelledby="spell-history-heading" data-testid="spell-history">
        <h2 id="spell-history-heading">Revision history</h2>
        {data.history.length === 0 ? (
          <p className="gov-muted">Not finalized yet.</p>
        ) : (
          <table className="gov-table">
            <thead>
              <tr>
                <th scope="col">Revision</th>
                <th scope="col">Finalized</th>
                <th scope="col">Authority</th>
                <th scope="col">Final MP</th>
                <th scope="col">Final AP</th>
                <th scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              {[...data.history].reverse().map((h) => (
                <tr key={h.revisionId} data-testid="spell-history-row" data-revision={h.revisionNumber} data-current={h.current ? "true" : "false"}>
                  <th scope="row">
                    <details>
                      <summary>Revision {h.revisionNumber}</summary>
                      {h.draft ? <SpellReview draft={h.draft} evaluation={h.evaluation} release={release} names={names} /> : <p>Unreadable revision.</p>}
                    </details>
                  </th>
                  <td>{new Date(h.createdAt).toLocaleString()}</td>
                  <td>{authorityLabel(h.draft?.authority ?? null)}</td>
                  <td data-testid="spell-history-mp">{h.evaluation?.cost ? `${h.evaluation.cost.finalMp} MP` : h.characterReleaseId !== release.id ? "Other Release" : "Unresolved"}</td>
                  <td>{h.evaluation?.cost ? `${h.evaluation.cost.finalAp} AP` : "—"}</td>
                  <td>{h.current ? (spell.status === "RETIRED" ? "Retired" : "Current") : "Historical"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
