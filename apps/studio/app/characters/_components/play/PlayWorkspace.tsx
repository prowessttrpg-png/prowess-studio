"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import type { CardLibraryDto } from "../../_lib/card-types";
import { findEntry, libraryEntries, revisionsOf } from "../../_lib/card-format";
import { CharacterApiError, commitPlayOperation, getCardLibrary, getPlayWorkspace, previewPlayOperation } from "../../_lib/character-client";
import type { PlayActionDto, PlayAttackDto, PlayEventDto, PlayManeuverDto, PlayOutcomeDto, PlaySpellDto, PlayViewDto } from "../../_lib/play-types";
import { releaseLabel } from "../CharacterReview";
import { CardViewer, type ViewMode } from "../cards/CardViewer";
import { ActiveMagicPanel, ActivityLog, PlayHeader, ResourceDashboard, TimingBar } from "./PlayPanels";
import { ResolutionPanel, type Selection } from "./ResolutionPanel";
import "../cards/cards.css";
import "./play.css";

/**
 * The Character Play Workspace (PAS-10 M6-WO10). The page is a client of the Play Workspace API only: it renders the
 * server's evaluated state, collects choices / targets / raw rolls, PREVIEWS (no write) and COMMITS (one atomic server
 * transaction, idempotent by key). Resources change on screen only from a committed server response — there is no
 * optimistic deduction. Cards open in the WO9 viewer as read-only references.
 */
const TABS = [
  { key: "general", label: "General Actions" },
  { key: "counter", label: "Counter Actions" },
  { key: "attacks", label: "Weapon Attacks" },
  { key: "spells", label: "Spells" },
  { key: "maneuvers", label: "Maneuvers" },
  { key: "movement", label: "Movement" },
  { key: "magic", label: "Active Magic" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

export const AVAILABILITY_LABELS: Record<string, string> = {
  AVAILABLE: "Available",
  UNAVAILABLE: "Unavailable",
  INSUFFICIENT_RESOURCES: "Insufficient resources",
  PENDING_INPUT: "Needs input",
  UNSUPPORTED: "Unsupported / runtime deferred",
  REFERENCE_ONLY: "Reference only",
};
export const STATUS_LABELS: Record<string, string> = {
  COMMITTABLE: "Ready to commit",
  REFUSED: "Refused",
  PENDING_INPUT: "Pending input",
  PENDING_DECISION: "Pending decision",
  UNSUPPORTED: "Unsupported / runtime deferred",
  RECONCILIATION_REQUIRED: "Reconciliation required",
};
export const CLASSIFICATION_LABELS: Record<string, string> = {
  RULES_EXECUTED: "Rules-executed",
  MANUAL_ADJUSTMENT: "Manual adjustment",
  REFERENCE_ONLY: "Reference only",
  NOTE: "Note",
};

export interface Submitter {
  readonly preview: (operation: Record<string, unknown>) => Promise<PlayOutcomeDto | null>;
  readonly commit: (operation: Record<string, unknown>) => Promise<PlayOutcomeDto | null>;
  readonly busy: boolean;
}

const newKey = () => globalThis.crypto.randomUUID();

export function PlayWorkspace({ characterId }: { characterId: string }) {
  const [view, setView] = useState<PlayViewDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<TabKey>("general");
  const [selection, setSelection] = useState<Selection | null>(null);
  const [result, setResult] = useState<{ outcome: PlayOutcomeDto; committed: boolean; replayed: boolean } | null>(null);
  const [cards, setCards] = useState<CardLibraryDto | null>(null);
  const [cardKey, setCardKey] = useState<string | null>(null);
  const [cardMode, setCardMode] = useState<ViewMode>("tactical");
  /** The idempotency key of an UNACKNOWLEDGED commit: a retry after a network failure reuses it (never double-applies). */
  const pendingKey = useRef<{ key: string; body: string } | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setView(await getPlayWorkspace(characterId));
    } catch (e) {
      setError(e instanceof CharacterApiError ? `${e.message} (${e.code})` : "Could not load the Play Workspace.");
    }
  }, [characterId]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount
    void load();
  }, [load]);

  const failure = useCallback(
    async (e: unknown) => {
      if (e instanceof CharacterApiError && e.code === "CHARACTER.STALE_WRITE") {
        setNotice("This Character's play state changed elsewhere (another tab or the Character Sheet). Nothing was applied; the latest state is loaded — review and submit again.");
        pendingKey.current = null;
        await load();
      } else if (e instanceof CharacterApiError) setNotice(`${e.message} (${e.code})`);
      else setNotice("The request did not complete (network). Nothing is shown as spent; submit again to retry safely with the same request key.");
    },
    [load],
  );

  const submitter: Submitter = {
    busy,
    preview: async (operation) => {
      if (view === null) return null;
      setBusy(true);
      setNotice(null);
      try {
        const out = await previewPlayOperation(characterId, operation, view.versions.runtimeVersion, view.versions.playStateVersion);
        setResult({ outcome: out.outcome, committed: false, replayed: false });
        return out.outcome;
      } catch (e) {
        await failure(e);
        return null;
      } finally {
        setBusy(false);
      }
    },
    commit: async (operation) => {
      if (view === null) return null;
      setBusy(true);
      setNotice(null);
      const body = JSON.stringify(operation);
      if (pendingKey.current === null || pendingKey.current.body !== body) pendingKey.current = { key: newKey(), body };
      try {
        const out = await commitPlayOperation(characterId, operation, pendingKey.current.key, view.versions.runtimeVersion, view.versions.playStateVersion);
        pendingKey.current = null;
        setView(out.workspace);
        const outcome = out.outcome ?? out.event?.record ?? null;
        if (outcome !== null) setResult({ outcome, committed: out.committed, replayed: out.replayed });
        if (out.replayed) setNotice("This submission was already committed; the original result is shown and nothing was applied again.");
        return outcome;
      } catch (e) {
        await failure(e);
        return null;
      } finally {
        setBusy(false);
      }
    },
  };

  const openCard = async (key: string) => {
    setCardKey(key);
    if (cards === null) {
      try {
        setCards(await getCardLibrary(characterId));
      } catch {
        setNotice("The card could not be loaded.");
      }
    }
  };
  const cardEntry = useMemo(() => (cards === null || cardKey === null ? null : findEntry(libraryEntries(cards), { card: cardKey })), [cards, cardKey]);

  if (error !== null)
    return (
      <p className="gov-error" role="alert" data-testid="play-error">
        {error}{" "}
        <button type="button" className="gov-link-button" onClick={() => void load()}>
          Try again
        </button>
      </p>
    );
  if (view === null) return <p role="status">Loading the Play Workspace…</p>;
  const w = view.workspace;
  const release = releaseLabel(view.release);
  const onTabKey = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    const next = e.key === "ArrowRight" ? (i + 1) % TABS.length : e.key === "ArrowLeft" ? (i + TABS.length - 1) % TABS.length : null;
    if (next === null) return;
    e.preventDefault();
    setTab(TABS[next]!.key);
    document.getElementById(`play-tab-${TABS[next]!.key}`)?.focus();
  };
  const select = (s: Selection) => {
    setSelection(s);
    setResult(null);
  };

  return (
    <div className="fcard-scope play-scope" data-testid="play-workspace" data-character={view.character.id} data-runtime-version={view.versions.runtimeVersion} data-play-state-version={view.versions.playStateVersion}>
      <PlayHeader view={view} release={release} />
      {w.reconciliation.required ? (
        <section className="play-alert" role="alert" data-testid="play-reconciliation">
          <h2>Reconciliation required</h2>
          <ul>
            {w.reconciliation.reasons.map((r) => (
              <li key={r.code}>{r.message}</li>
            ))}
          </ul>
          <button type="button" className="fcard-button" disabled={busy} onClick={() => void submitter.commit({ kind: "RECONCILE" })} data-testid="play-reconcile">
            Acknowledge and reconcile
          </button>
        </section>
      ) : null}
      {notice !== null ? (
        <p className="play-notice" role="status" data-testid="play-notice">
          {notice}
        </p>
      ) : null}
      <TimingBar workspace={w} submitter={submitter} />
      <div className="play-layout">
        <div className="play-layout__main">
          <ResourceDashboard workspace={w} submitter={submitter} />
          <section className="play-panel" aria-labelledby="play-actions-title">
            <h2 id="play-actions-title">Action Workspace</h2>
            <div role="tablist" aria-label="Action categories" className="play-tabs">
              {TABS.map((t, i) => (
                <button key={t.key} id={`play-tab-${t.key}`} type="button" role="tab" aria-selected={tab === t.key} aria-controls={`play-tabpanel-${t.key}`} tabIndex={tab === t.key ? 0 : -1} className="play-tab" onClick={() => setTab(t.key)} onKeyDown={(e) => onTabKey(e, i)} data-testid={`play-tab-${t.key}`}>
                  {t.label}
                </button>
              ))}
            </div>
            <div role="tabpanel" id={`play-tabpanel-${tab}`} aria-labelledby={`play-tab-${tab}`} className="play-tabpanel" data-testid={`play-tabpanel-${tab}`}>
              {tab === "general" || tab === "counter" ? <ActionList actions={w.actions.filter((a) => a.category === (tab === "general" ? "GENERAL" : "COUNTER"))} onSelect={(a) => select({ kind: "GENERAL_ACTION", action: a })} onCard={openCard} selected={selection} /> : null}
              {tab === "attacks" ? <AttackList attacks={w.attacks} onSelect={(a) => select({ kind: "WEAPON_ATTACK", attack: a })} onCard={openCard} selected={selection} /> : null}
              {tab === "spells" ? <AbilityList kind="SPELL" items={w.spells} onSelect={(s) => select({ kind: "SPELL", spell: s as PlaySpellDto })} onCard={openCard} selected={selection} /> : null}
              {tab === "maneuvers" ? <AbilityList kind="MANEUVER" items={w.maneuvers} onSelect={(m) => select({ kind: "MANEUVER", maneuver: m as PlayManeuverDto })} onCard={openCard} selected={selection} /> : null}
              {tab === "movement" ? <MovementTab view={view} onSelect={() => select({ kind: "MOVE" })} /> : null}
              {tab === "magic" ? <ActiveMagicPanel workspace={w} submitter={submitter} onCard={openCard} /> : null}
            </div>
          </section>
          {selection !== null ? <ResolutionPanel key={JSON.stringify(selection).slice(0, 200)} view={view} selection={selection} submitter={submitter} result={result} onCard={openCard} /> : result !== null ? <ResultOnly result={result} /> : null}
        </div>
        <aside className="play-layout__side">
          <ActivityLog characterId={view.character.id} events={view.recentEvents as PlayEventDto[]} submitter={submitter} />
        </aside>
      </div>
      {cardKey !== null ? (
        <div className="fcard-drawer" data-testid="play-card-drawer">
          <div className="fcard-drawer__backdrop" onClick={() => setCardKey(null)} aria-hidden="true" />
          <div className="fcard-drawer__panel" role="dialog" aria-modal="true" aria-label="Card">
            <header className="fcard-drawer__header">
              <h2>Card</h2>
              <button type="button" className="fcard-button" onClick={() => setCardKey(null)} data-testid="play-card-close" autoFocus>
                Close
              </button>
            </header>
            {cards === null ? <p role="status">Loading the card…</p> : cardEntry === null || cardEntry.card === null ? <p className="fcard-empty">This card is not part of the Character&apos;s current library.</p> : <CardViewer entry={cardEntry} card={cardEntry.card} names={cards.names} release={release} characterId={characterId} mode={cardMode} onMode={setCardMode} revisions={revisionsOf(libraryEntries(cards), cardEntry.abilityId)} onOpen={(k) => setCardKey(k)} />}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Badge({ value }: { value: string }) {
  return (
    <span className={`play-badge play-badge--${value.toLowerCase()}`} data-testid="play-availability" data-availability={value}>
      {AVAILABILITY_LABELS[value] ?? value}
    </span>
  );
}

function Reasons({ reasons }: { reasons: readonly { code: string; message: string }[] }) {
  if (reasons.length === 0) return null;
  return (
    <ul className="play-reasons">
      {reasons.map((r, i) => (
        <li key={i} data-code={r.code}>
          {r.message}
        </li>
      ))}
    </ul>
  );
}

const apText = (a: PlayActionDto) => (a.apCost.status === "AVAILABLE" ? `${String(a.apCost.value)} AP` : (a.apCost.reason ?? "AP set when used"));

function ActionList({ actions, onSelect, onCard, selected }: { actions: readonly PlayActionDto[]; onSelect: (a: PlayActionDto) => void; onCard: (k: string) => void; selected: Selection | null }) {
  if (actions.length === 0) return <p className="fcard-empty">This Release defines no Actions in this category.</p>;
  return (
    <ul className="play-list" data-testid="play-action-list">
      {actions.map((a) => (
        <li key={a.actionKey} className="play-row" data-testid="play-action" data-action={a.actionKey} data-availability={a.availability}>
          <button type="button" className="play-row__main" aria-pressed={selected?.kind === "GENERAL_ACTION" && selected.action.actionKey === a.actionKey} onClick={() => onSelect(a)} data-testid="play-action-open">
            <span className="play-row__name">{a.name}</span>
            <span className="play-row__meta">
              {apText(a)}
              {a.otherCosts.map((c) => ` · ${String(c.amount)} ${c.costKey.replace(/_/g, " ").toLowerCase()}`).join("")}
              {a.requiresTrigger ? " · needs a trigger" : ""}
            </span>
          </button>
          <Badge value={a.availability} />
          <button type="button" className="gov-link-button" onClick={() => onCard(a.cardKey)} data-testid="play-open-card">
            Card
          </button>
          <Reasons reasons={a.availability === "AVAILABLE" ? [] : a.reasons} />
        </li>
      ))}
    </ul>
  );
}

function AttackList({ attacks, onSelect, onCard, selected }: { attacks: readonly PlayAttackDto[]; onSelect: (a: PlayAttackDto) => void; onCard: (k: string) => void; selected: Selection | null }) {
  if (attacks.length === 0) return <p className="fcard-empty">No Weapon Attacks in the current loadout.</p>;
  return (
    <ul className="play-list" data-testid="play-attack-list">
      {attacks.map((a) => (
        <li key={`${a.hand}:${a.attackKey}`} className="play-row" data-testid="play-attack" data-availability={a.availability}>
          <button type="button" className="play-row__main" aria-pressed={selected?.kind === "WEAPON_ATTACK" && selected.attack.attackKey === a.attackKey && selected.attack.hand === a.hand} onClick={() => onSelect(a)} data-testid="play-attack-open">
            <span className="play-row__name">{a.name}</span>
            <span className="play-row__meta">
              {a.hand.replace(/_/g, " ").toLowerCase()} · {a.grip.replace(/_/g, " ").toLowerCase()} · {String(a.apCost)} AP{a.mpCost ? ` · ${String(a.mpCost)} MP` : ""}
            </span>
          </button>
          <Badge value={a.availability} />
          <button type="button" className="gov-link-button" onClick={() => onCard(a.cardKey)} data-testid="play-open-card">
            Card
          </button>
          <Reasons reasons={a.availability === "AVAILABLE" ? [] : a.reasons} />
        </li>
      ))}
    </ul>
  );
}

function AbilityList({ kind, items, onSelect, onCard, selected }: { kind: "SPELL" | "MANEUVER"; items: readonly (PlaySpellDto | PlayManeuverDto)[]; onSelect: (x: PlaySpellDto | PlayManeuverDto) => void; onCard: (k: string) => void; selected: Selection | null }) {
  if (items.length === 0) return <p className="fcard-empty">No active Signature {kind === "SPELL" ? "Spells" : "Maneuvers"}. Build one in the Abilities section.</p>;
  const isSelected = (x: PlaySpellDto | PlayManeuverDto) => (selected?.kind === "SPELL" && selected.spell.abilityId === x.abilityId) || (selected?.kind === "MANEUVER" && selected.maneuver.abilityId === x.abilityId);
  return (
    <ul className="play-list" data-testid={kind === "SPELL" ? "play-spell-list" : "play-maneuver-list"}>
      {items.map((x) => (
        <li key={x.abilityId} className="play-row" data-testid={kind === "SPELL" ? "play-spell" : "play-maneuver"} data-availability={x.availability}>
          <button type="button" className="play-row__main" aria-pressed={isSelected(x)} onClick={() => onSelect(x)} data-testid="play-ability-open">
            <span className="play-row__name">
              {x.name} <span className="fcard-muted">r{String(x.revisionNumber)}</span>
            </span>
            <span className="play-row__meta">{x.costs === null ? "cost unavailable" : `${String(x.costs.finalApCost)} AP · ${String(x.costs.finalMpCost)} MP`}</span>
          </button>
          <Badge value={x.availability} />
          <button type="button" className="gov-link-button" onClick={() => onCard(x.cardKey)} data-testid="play-open-card">
            Card
          </button>
          <Reasons reasons={x.availability === "PENDING_INPUT" ? [] : x.reasons} />
        </li>
      ))}
    </ul>
  );
}

function MovementTab({ view, onSelect }: { view: PlayViewDto; onSelect: () => void }) {
  const m = view.workspace.runtime.movement;
  const allowance = view.workspace.resources.find((r) => r.resourceKey === "MOVEMENT_ALLOWANCE");
  return (
    <div data-testid="play-movement">
      <dl className="play-facts">
        <div>
          <dt>Movement (evaluated)</dt>
          <dd>{view.workspace.header.movement.value === null ? view.workspace.header.movement.unavailable : `${String(view.workspace.header.movement.value)} ${view.workspace.header.movement.unit ?? ""}`}</dd>
        </div>
        <div>
          <dt>Remaining Movement Allowance</dt>
          <dd data-testid="play-movement-remaining">{allowance === undefined ? "—" : `${String(allowance.current)} ft`}</dd>
        </div>
        <div>
          <dt>Granted this turn</dt>
          <dd data-testid="play-movement-grants">{m.grants.length === 0 ? "none" : m.grants.map((g) => `${String(g)} ft`).join(", ")}</dd>
        </div>
        <div>
          <dt>Segments this turn</dt>
          <dd data-testid="play-movement-segments">{m.segments.length === 0 ? "none" : m.segments.map((s) => `${String(s.distance)} ft ${s.terrainKey.toLowerCase()} (cost ${String(s.allowanceCost)})`).join("; ")}</dd>
        </div>
      </dl>
      <p className="fcard-muted">Take a Move or Sprint Action (General Actions) to gain allowance; spend it here in one or more segments. Positions are not tracked — record narrative positioning as a note.</p>
      <button type="button" className="fcard-button" onClick={onSelect} data-testid="play-movement-open">
        Spend movement…
      </button>
    </div>
  );
}

function ResultOnly({ result }: { result: { outcome: PlayOutcomeDto; committed: boolean; replayed: boolean } }) {
  return (
    <section className="play-panel play-result" aria-live="polite" data-testid="play-result" data-status={result.outcome.status} data-committed={String(result.committed)}>
      <h2>Result</h2>
      <p>
        <strong>{result.committed ? "Committed" : (STATUS_LABELS[result.outcome.status] ?? result.outcome.status)}.</strong> {result.outcome.summary}
      </p>
      <Reasons reasons={result.outcome.reasons} />
    </section>
  );
}

export { Reasons, Badge };
export const playLinks = (id: string) => ({ sheet: `/characters/${encodeURIComponent(id)}`, cards: `/characters/${encodeURIComponent(id)}/cards`, abilities: `/characters/${encodeURIComponent(id)}/abilities`, actions: `/characters/${encodeURIComponent(id)}/actions` });
