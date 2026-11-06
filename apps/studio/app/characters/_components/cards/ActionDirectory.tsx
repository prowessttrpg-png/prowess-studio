"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { ActionDirectoryViewDto } from "../../_lib/card-types";
import { cardHref, refName, tokenText, valueText } from "../../_lib/card-format";
import { CharacterApiError, getActionDirectory } from "../../_lib/character-client";
import { releaseLabel } from "../CharacterReview";
import { BlockList, Instructions, backBlocks } from "./CardFace";
import { ImprovementDetail, ImprovementGroups } from "./ProgressionDrawer";
import "./cards.css";

/**
 * The General Action Directory (PAS-10 M6-WO9 Phase C) — a RULES REFERENCE over the read-only Action Directory API: every
 * ACTION Definition the Character's exact Release pins, with this Character's evaluated improvements, unmet prerequisites
 * and progression evidence, exact sources and a link to the personalized Action Card. It creates, unlocks and modifies
 * nothing, and it shows only Actions the Release defines (no Action is invented).
 */
export function ActionDirectory({ characterId, initialAction }: { characterId: string; initialAction: string | null }) {
  const [view, setView] = useState<ActionDirectoryViewDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string | null>(initialAction);

  const load = useCallback(async () => {
    setError(null);
    try {
      setView(await getActionDirectory(characterId));
    } catch (e) {
      setError(e instanceof CharacterApiError ? `${e.message} (${e.code})` : "Could not load the Action Directory.");
    }
  }, [characterId]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount
    void load();
  }, [load]);

  if (error !== null)
    return (
      <p className="gov-error" role="alert" data-testid="directory-error">
        {error}{" "}
        <button type="button" className="gov-link-button" onClick={() => void load()}>
          Try again
        </button>
      </p>
    );
  if (view === null) return <p role="status">Loading the Action Directory…</p>;
  const d = view.directory;
  const release = releaseLabel(view.release);
  if (d.status === "UNAVAILABLE")
    return (
      <div className="fcard-scope" data-testid="directory-unavailable">
        <p className="sheet-error" role="alert">
          This Release&apos;s Action Definitions cannot be read, so no Action is shown:
        </p>
        <ul>
          {d.reasons.map((r, i) => (
            <li key={i}>
              {r.code}: {r.message}
            </li>
          ))}
        </ul>
      </div>
    );
  const q = search.trim().toLowerCase();
  const list = d.cards.filter((c) => q === "" || c.name.toLowerCase().includes(q) || c.section.actionKey.toLowerCase().includes(q));
  const current = d.cards.find((c) => c.section.actionKey === selected) ?? null;
  const pick = (key: string) => {
    setSelected(key);
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.searchParams.set("action", key);
      window.history.replaceState(window.history.state, "", url.toString());
    }
  };

  return (
    <div className="fcard-scope fcard-directory" data-testid="action-directory" data-character={view.character.id}>
      <p className="fcard-muted" data-testid="directory-release">
        {view.character.name} · Level {view.character.level} · {release}. This directory is a rules reference: it does not create, unlock or change any Action.
      </p>
      <label className="gov-field">
        <span>Search Actions</span>
        <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} data-testid="directory-search" />
      </label>
      <div className="fcard-library__layout">
        <nav aria-label="Actions" className="fcard-library__list">
          {list.length === 0 ? (
            <p className="fcard-empty" data-testid="directory-empty">
              No Action matches this search.
            </p>
          ) : (
            <ul data-testid="directory-list">
              {list.map((c) => (
                <li key={c.cardKey} className="fcard-entry" data-testid="directory-entry" data-action={c.section.actionKey}>
                  <button type="button" className="fcard-entry__button" aria-current={c.section.actionKey === selected ? "true" : undefined} onClick={() => pick(c.section.actionKey)}>
                    <span className="fcard-entry__name">{c.name}</span>
                    <span className="fcard-entry__meta">
                      {valueText(c.costs.ap, "AP")} · {tokenText(c.section.timing)} · {c.section.improvements.length} improvement{c.section.improvements.length === 1 ? "" : "s"}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </nav>
        <div className="fcard-library__viewer">
          {current === null ? (
            <p className="fcard-empty" data-testid="directory-no-selection">
              Choose an Action to see its complete entry.
            </p>
          ) : (
            <article className="fcard fcard--back fcard--general_action" data-testid="directory-detail" data-action={current.section.actionKey} aria-labelledby="directory-detail-title">
              <header className="fcard-header">
                <p className="fcard-header__type">General Action</p>
                <h2 id="directory-detail-title" className="fcard-header__name">
                  {current.name}
                </h2>
              </header>
              <p>
                <Link className="fcard-button" href={cardHref(view.character.id, current.cardKey)} data-testid="directory-card-link">
                  Open this Character&apos;s Action Card
                </Link>
              </p>
              <section className="fcard-section" aria-label="How to Use">
                <h3 className="fcard-section__title">How to Use</h3>
                <Instructions card={current} />
              </section>
              <section className="fcard-section" aria-label="Character eligibility">
                <h3 className="fcard-section__title">Eligibility for {view.character.name}</h3>
                <p data-testid="directory-eligibility">ACTION Definitions author no prerequisites: every Character may take this Action. AP now: {valueText(current.costs.ap, "AP")}.</p>
              </section>
              <section className="fcard-section" aria-label="Improvements">
                <h3 className="fcard-section__title">Improvements</h3>
                <ImprovementGroups items={current.section.improvements} names={view.names} />
              </section>
              <BlockList blocks={backBlocks(current, view.names, release).filter((b) => b.key !== "rules" && b.key !== "improvements")} collapsible headingLevel={3} />
            </article>
          )}
        </div>
      </div>
      {d.unattached.length > 0 ? (
        <section className="fcard-section" aria-label="Improvements without a pinned parent Action" data-testid="directory-unattached">
          <h2>Improvements whose parent Action this Release does not pin</h2>
          {d.unattached.map((i) => (
            <ImprovementDetail key={i.improvementKey} item={i} names={view.names} />
          ))}
          <p className="fcard-muted">They are shown for reference only and are never attached to another Action ({d.unattached.map((i) => refName(view.names, i.improvement)).join(", ")}).</p>
        </section>
      ) : null}
    </div>
  );
}
