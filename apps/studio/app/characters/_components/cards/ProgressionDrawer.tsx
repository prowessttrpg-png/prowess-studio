"use client";

import Link from "next/link";
import { useEffect, useId, useRef, type KeyboardEvent } from "react";
import type { CardImprovementEntryDto } from "../../_lib/card-types";
import { IMPROVEMENT_STATUS_LABELS, PROGRESSION_LABELS, SUPPORT_LABELS, improvementGroups, refName, tokenText } from "../../_lib/card-format";

/**
 * One Action Improvement as the server evaluated it (PAS-10 M6-WO9 Phase C): status, rules text, each modification with
 * its support, each prerequisite with M4's verdict and the server's progression evidence, and every reason. Nothing is
 * re-evaluated here — an unmet Skill / Affinity rank stays "no authored progression path", never "Future".
 */
export function ImprovementDetail({ item, names }: { item: CardImprovementEntryDto; names: Record<string, string> }) {
  return (
    <article className="fcard-improvement fcard-improvement--detail" data-testid="improvement-detail" data-status={item.status} data-improvement={item.improvementKey}>
      <h4>
        {refName(names, item.improvement)} <span className="fcard-tag" data-testid="improvement-status">{IMPROVEMENT_STATUS_LABELS[item.status]}</span>
      </h4>
      <p>{item.rulesText}</p>
      <h5>Modifications</h5>
      <ul className="fcard-list">
        {item.modifications.map((m) => (
          <li key={m.modificationKey} data-support={m.support}>
            {tokenText(m.kind)} — {SUPPORT_LABELS[m.support] ?? tokenText(m.support)}
            {m.conditional ? " · applies only when its condition holds" : ""}
            {m.reason ? <span className="fcard-muted"> ({m.reason})</span> : null}
          </li>
        ))}
      </ul>
      <h5>Prerequisites</h5>
      {item.prerequisites.length === 0 ? (
        <p className="fcard-empty">None.</p>
      ) : (
        <ul className="fcard-list" data-testid="improvement-prerequisites">
          {item.prerequisites.map((q) => (
            <li key={q.prerequisiteKey} data-progression={q.progression}>
              {tokenText(q.kind)} ({q.prerequisiteKey}) — {PROGRESSION_LABELS[q.progression] ?? tokenText(q.progression)}
              {q.reason ? <span className="fcard-muted">: {q.reason}</span> : null}
            </li>
          ))}
        </ul>
      )}
      {item.reasons.length > 0 ? (
        <>
          <h5>Why</h5>
          <ul className="fcard-list" data-testid="improvement-reasons">
            {item.reasons.map((r, i) => (
              <li key={i}>
                <span className="fcard-tag">{r.code}</span> {r.message}
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </article>
  );
}

/** Improvements grouped in the approved order: Active, Conditional, Future, then Unavailable / Unresolved. */
export function ImprovementGroups({ items, names }: { items: readonly CardImprovementEntryDto[]; names: Record<string, string> }) {
  if (items.length === 0) return <p className="fcard-empty" data-testid="improvements-empty">This Release authors no improvements for this Action.</p>;
  return (
    <>
      {improvementGroups(items).map((g) =>
        g.items.length === 0 ? null : (
          <section key={g.key} className="fcard-drawer__group" data-testid={`improvement-group-${g.key.toLowerCase()}`} aria-label={g.title}>
            <h3>{g.title}</h3>
            {g.items.map((i) => (
              <ImprovementDetail key={i.improvementKey} item={i} names={names} />
            ))}
          </section>
        ),
      )}
    </>
  );
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';

/**
 * The Action progression drawer: a modal side drawer on desktop and a bottom sheet on narrow screens (CSS), with focus
 * trapping, Escape / backdrop dismissal and focus restoration to the control that opened it.
 */
export function ProgressionDrawer({ open, onClose, actionName, improvements, names, directoryHref }: { open: boolean; onClose: () => void; actionName: string; improvements: readonly CardImprovementEntryDto[]; names: Record<string, string>; directoryHref: string }) {
  const titleId = useId();
  const panel = useRef<HTMLDivElement | null>(null);
  const opener = useRef<Element | null>(null);
  useEffect(() => {
    if (!open) return;
    opener.current = document.activeElement;
    const first = panel.current?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? panel.current)?.focus();
    return () => {
      const back = opener.current;
      if (back instanceof HTMLElement) back.focus();
    };
  }, [open]);
  if (!open) return null;
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
      return;
    }
    if (e.key !== "Tab" || panel.current === null) return;
    const items = [...panel.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
    if (items.length === 0) return;
    const first = items[0] as HTMLElement;
    const last = items[items.length - 1] as HTMLElement;
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };
  return (
    <div className="fcard-drawer" data-testid="progression-drawer">
      <div className="fcard-drawer__backdrop" onClick={onClose} aria-hidden="true" />
      <div className="fcard-drawer__panel" role="dialog" aria-modal="true" aria-labelledby={titleId} ref={panel} tabIndex={-1} onKeyDown={onKeyDown}>
        <header className="fcard-drawer__header">
          <h2 id={titleId}>Progression — {actionName}</h2>
          <button type="button" className="fcard-button" onClick={onClose} data-testid="progression-close">
            Close
          </button>
        </header>
        <p className="fcard-muted">The card shows what you can do now. Improvements below are evaluated by the server for this Character and Release; nothing here unlocks or changes an Action.</p>
        <ImprovementGroups items={improvements} names={names} />
        <p>
          <Link href={directoryHref} data-testid="progression-directory-link">
            Open the complete Action Directory entry
          </Link>
        </p>
      </div>
    </div>
  );
}
