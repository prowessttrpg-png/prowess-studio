"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { releaseHref, sectionsHref } from "../../compendium/rulesets/_lib/reference-urls";
import {
  EncounterApiError,
  commandEncounter,
  getEncounter,
  newSubmissionKey,
  releaseLabel,
  searchEncounterCandidates,
  type EncounterCandidateDto,
  type EncounterCommand,
  type EncounterDto,
  type EncounterParticipantDto,
} from "../_lib/encounter-client";

const UNSAVED = "You have unsaved changes to this encounter's details. Leave without saving?";

/** Protects typed-but-unsaved details (name / notes) from a reload or an in-app link. Roster actions save immediately. */
function useUnsavedGuard(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = (event.target as Element | null)?.closest?.("a[href]");
      if (anchor === null || anchor === undefined || anchor.getAttribute("target") === "_blank") return;
      if (!window.confirm(UNSAVED)) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    document.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      document.removeEventListener("click", onClick, true);
    };
  }, [dirty]);
}

/**
 * The encounter preparation workspace (M7-WO1). Every roster change is ONE server command carrying the version it was
 * prepared against and a per-submission idempotency key; the server decides legality and readiness and returns the new
 * encounter, which is rendered as given. A stale command reloads and explains; a lost response is retried with the SAME
 * key, so it can never apply twice. There is no combat control here.
 */
export function EncounterWorkspace({ id }: { id: string }) {
  const [encounter, setEncounter] = useState<EncounterDto | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: "ok" | "error" | "stale"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("");
  const [notes, setNotes] = useState("");
  const [newSide, setNewSide] = useState("");
  const pending = useRef<{ signature: string; key: string } | null>(null);

  const adopt = useCallback((e: EncounterDto) => {
    setEncounter(e);
    setName(e.name);
    setNotes(e.notes ?? "");
  }, []);
  const load = useCallback(async () => {
    try {
      adopt(await getEncounter(id));
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof EncounterApiError ? `${e.message}` : "Could not load this encounter.");
    }
  }, [id, adopt]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount
    void load();
  }, [load]);

  const dirty = encounter !== null && encounter.status === "PREPARATION" && (name !== encounter.name || notes !== (encounter.notes ?? ""));
  useUnsavedGuard(dirty);

  const run = async (command: EncounterCommand, success: string): Promise<boolean> => {
    if (encounter === null) return false;
    const signature = JSON.stringify([command, encounter.version]);
    if (pending.current?.signature !== signature) pending.current = { signature, key: newSubmissionKey() };
    setBusy(true);
    setNotice(null);
    try {
      const result = await commandEncounter(encounter.id, command, encounter.version, pending.current.key);
      pending.current = null;
      adopt(result.encounter);
      setNotice({ kind: "ok", text: result.replayed ? `${success} (already saved — confirmed).` : success });
      return true;
    } catch (e) {
      const err = e instanceof EncounterApiError ? e : new EncounterApiError("UNKNOWN_ERROR", "The change could not be saved.", 0);
      if (err.code === "NETWORK_ERROR") {
        setNotice({ kind: "error", text: "The server could not be reached, so this change is not confirmed. Try the same action again — it will not be applied twice." });
      } else {
        pending.current = null;
        if (err.code === "ENCOUNTER.STALE_WRITE" || err.code === "ENCOUNTER.ARCHIVED") {
          await load();
          setNotice({ kind: "stale", text: `${err.message} The encounter has been reloaded with the latest saved state; review it and repeat your change if it is still needed.` });
        } else setNotice({ kind: "error", text: err.message });
      }
      return false;
    } finally {
      setBusy(false);
    }
  };

  if (loadError !== null)
    return (
      <div className="prowess-encounter">
        <nav className="gov-crumbs" aria-label="Breadcrumb">
          <Link href="/encounters">Encounters</Link>
        </nav>
        <p className="gov-error" role="alert">
          {loadError}
        </p>
      </div>
    );
  if (encounter === null) return <p role="status">Loading encounter…</p>;

  const archived = encounter.status === "ARCHIVED";
  const byId = new Map(encounter.participants.map((p) => [p.id, p]));
  const unassigned = encounter.participants.filter((p) => p.sideId === null);
  const disabled = busy || archived;

  return (
    <div className="prowess-encounter" data-testid="encounter-workspace">
      <nav className="gov-crumbs" aria-label="Breadcrumb">
        <Link href="/encounters">Encounters</Link> / <span aria-current="page">{encounter.name}</span>
      </nav>
      <header className="prowess-encounter__header">
        <h1>{encounter.name}</h1>
        <p>
          <span className="gov-badge" data-testid="encounter-status">
            {archived ? "Archived — read-only" : "In preparation"}
          </span>{" "}
          <span data-testid="encounter-release">{releaseLabel(encounter.release)}</span>
        </p>
        <p className="gov-muted">
          Rules: <Link href={releaseHref(encounter.release.rulesetId, encounter.release.id)}>this exact Release in the Rules Reference</Link> ·{" "}
          <Link href={sectionsHref(encounter.release.rulesetId, encounter.release.id)}>browse its rules by topic</Link>. Only completed Characters built on this Release can join.
        </p>
      </header>

      {notice !== null ? (
        <p className={notice.kind === "ok" ? "gov-ok" : "gov-error"} role={notice.kind === "ok" ? "status" : "alert"} data-testid={`encounter-notice-${notice.kind}`}>
          {notice.text}
        </p>
      ) : null}

      <section className="gov-panel" aria-labelledby="encounter-readiness-heading" data-testid="encounter-readiness" aria-live="polite">
        <h2 id="encounter-readiness-heading">Readiness</h2>
        <p data-testid="readiness-state">
          <strong>{encounter.readiness.state === "PREPARED" ? "Prepared — nothing blocks the roster." : encounter.readiness.state === "ARCHIVED" ? "Archived." : "Not prepared yet."}</strong>
        </p>
        {encounter.readiness.blocking.length > 0 && !archived ? (
          <ul aria-label="What still needs attention">
            {encounter.readiness.blocking.map((b, i) => (
              <li key={`b${i}`} data-code={b.code}>
                {b.message}
              </li>
            ))}
          </ul>
        ) : null}
        {encounter.readiness.warnings.length > 0 ? (
          <ul aria-label="Warnings">
            {encounter.readiness.warnings.map((w, i) => (
              <li key={`w${i}`} data-code={w.code}>
                Note: {w.message}
              </li>
            ))}
          </ul>
        ) : null}
        <p className="gov-muted" data-testid="combat-unavailable">
          Start combat — not available yet. {encounter.readiness.combat.reason}
        </p>
      </section>

      <section className="gov-panel" aria-labelledby="encounter-details-heading">
        <h2 id="encounter-details-heading">Details</h2>
        <form
          className="gov-form"
          aria-label="Encounter details"
          onSubmit={(e) => {
            e.preventDefault();
            void run({ kind: "UPDATE_METADATA", name, notes: notes.trim() === "" ? null : notes }, "Details saved.");
          }}
        >
          <label className="gov-field">
            <span>Name (required)</span>
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} readOnly={archived} />
          </label>
          <label className="gov-field">
            <span>Notes (optional)</span>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={4000} rows={3} readOnly={archived} />
          </label>
          {!archived ? (
            <p className="gov-actions">
              <button type="submit" className="gov-button" disabled={busy || !dirty || name.trim() === ""}>
                Save details
              </button>
              {dirty ? <span data-testid="details-unsaved">Unsaved changes</span> : null}
            </p>
          ) : null}
        </form>
      </section>

      <section className="gov-panel" aria-labelledby="encounter-sides-heading">
        <h2 id="encounter-sides-heading">Sides and participants</h2>
        {encounter.sides.length === 0 ? <p className="gov-muted">No sides yet. Add a side, then assign participants to it.</p> : null}
        <div className="prowess-encounter__sides">
          {encounter.sides.map((side) => (
            <SideCard
              key={side.id}
              side={side}
              members={side.participantIds.map((pid) => byId.get(pid)).filter((p): p is EncounterParticipantDto => p !== undefined)}
              sides={encounter.sides}
              disabled={disabled}
              archived={archived}
              run={run}
            />
          ))}
          {unassigned.length > 0 ? (
            <section className="gov-card prowess-encounter__side" aria-label="Not assigned to a side" data-testid="side-unassigned">
              <h3>Not assigned to a side</h3>
              <ParticipantList members={unassigned} sides={encounter.sides} currentSide={null} disabled={disabled} archived={archived} run={run} />
            </section>
          ) : null}
        </div>
        {!archived ? (
          <form
            className="prowess-encounter__inline"
            aria-label="Add a side"
            onSubmit={async (e) => {
              e.preventDefault();
              if (await run({ kind: "ADD_SIDE", name: newSide }, `Side “${newSide.trim()}” added.`)) setNewSide("");
            }}
          >
            <label className="gov-field">
              <span>New side name</span>
              <input value={newSide} onChange={(e) => setNewSide(e.target.value)} maxLength={80} />
            </label>
            <button type="submit" className="gov-button" disabled={busy || newSide.trim() === ""}>
              Add side
            </button>
          </form>
        ) : null}
      </section>

      {!archived ? <AddParticipants encounter={encounter} disabled={busy} run={run} /> : null}

      <section className="gov-panel" aria-labelledby="encounter-history-heading">
        <h2 id="encounter-history-heading">History</h2>
        <ol className="prowess-encounter__history" data-testid="encounter-history" reversed>
          {encounter.recentEvents.map((ev) => (
            <li key={ev.id}>
              {ev.summary} <span className="gov-muted">· {new Date(ev.createdAt).toLocaleString()}</span>
            </li>
          ))}
        </ol>
      </section>

      {!archived ? (
        <section className="gov-panel" aria-labelledby="encounter-archive-heading">
          <h2 id="encounter-archive-heading">Archive</h2>
          <p>Archiving keeps this encounter and its history as a read-only record. It cannot be edited afterwards. Characters are not changed.</p>
          <button
            type="button"
            className="gov-button"
            disabled={busy}
            onClick={() => {
              if (window.confirm(`Archive “${encounter.name}”? It becomes read-only.`)) void run({ kind: "ARCHIVE" }, "Encounter archived.");
            }}
          >
            Archive encounter
          </button>
        </section>
      ) : null}
    </div>
  );
}

type Run = (command: EncounterCommand, success: string) => Promise<boolean>;

function SideCard({ side, members, sides, disabled, archived, run }: { side: EncounterDto["sides"][number]; members: EncounterParticipantDto[]; sides: EncounterDto["sides"]; disabled: boolean; archived: boolean; run: Run }) {
  const [rename, setRename] = useState(side.name);
  return (
    <section className="gov-card prowess-encounter__side" aria-label={`Side ${side.name}`} data-testid="encounter-side">
      <h3>{side.name}</h3>
      {members.length === 0 ? <p className="gov-muted">No participants on this side.</p> : <ParticipantList members={members} sides={sides} currentSide={side.id} disabled={disabled} archived={archived} run={run} />}
      {!archived ? (
        <div className="prowess-encounter__inline">
          <label className="gov-field">
            <span>Rename side “{side.name}”</span>
            <input value={rename} onChange={(e) => setRename(e.target.value)} maxLength={80} />
          </label>
          <button type="button" className="gov-button" disabled={disabled || rename.trim() === "" || rename.trim() === side.name} onClick={() => void run({ kind: "RENAME_SIDE", sideId: side.id, name: rename }, `Side renamed “${rename.trim()}”.`)}>
            Rename
          </button>
          <button
            type="button"
            className="gov-link-button"
            disabled={disabled || members.length > 0}
            aria-describedby={members.length > 0 ? `side-${side.id}-occupied` : undefined}
            onClick={() => {
              if (window.confirm(`Remove side “${side.name}”?`)) void run({ kind: "REMOVE_SIDE", sideId: side.id }, `Side “${side.name}” removed.`);
            }}
          >
            Remove side “{side.name}”
          </button>
          {members.length > 0 ? (
            <span id={`side-${side.id}-occupied`} className="gov-muted">
              Move or remove its participants before removing this side.
            </span>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function ParticipantList({ members, sides, currentSide, disabled, archived, run }: { members: EncounterParticipantDto[]; sides: EncounterDto["sides"]; currentSide: string | null; disabled: boolean; archived: boolean; run: Run }) {
  return (
    <ul className="prowess-encounter__members">
      {members.map((p) => (
        <ParticipantRow key={p.id} p={p} sides={sides} currentSide={currentSide} disabled={disabled} archived={archived} run={run} />
      ))}
    </ul>
  );
}

function ParticipantRow({ p, sides, currentSide, disabled, archived, run }: { p: EncounterParticipantDto; sides: EncounterDto["sides"]; currentSide: string | null; disabled: boolean; archived: boolean; run: Run }) {
  const [target, setTarget] = useState("");
  const name = p.character.name;
  const options = [...sides.filter((s) => s.id !== currentSide).map((s) => ({ value: s.id, label: s.name })), ...(currentSide === null ? [] : [{ value: "none", label: "No side" }])];
  return (
    <li data-testid="encounter-participant">
      <strong>{name}</strong> <span className="gov-muted">Level {p.character.level}</span> · <Link href={`/characters/${encodeURIComponent(p.character.id)}`}>Sheet</Link> · <Link href={`/characters/${encodeURIComponent(p.character.id)}/cards`}>Cards</Link>
      {p.standalone?.combatActive === true ? <span className="gov-badge"> Standalone combat active</span> : null}
      {!archived ? (
        <div className="prowess-encounter__inline">
          <label className="gov-field">
            <span>Move {name} to</span>
            <select value={target} onChange={(e) => setTarget(e.target.value)} disabled={disabled}>
              <option value="">Choose…</option>
              {options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="gov-button"
            disabled={disabled || target === ""}
            onClick={async () => {
              const to = target === "none" ? null : target;
              if (await run({ kind: "MOVE_PARTICIPANT", participantId: p.id, sideId: to }, `${name} moved.`)) setTarget("");
            }}
          >
            Move {name}
          </button>
          <button
            type="button"
            className="gov-link-button"
            disabled={disabled}
            onClick={() => {
              if (window.confirm(`Remove ${name} from this encounter? The Character itself is not changed.`)) void run({ kind: "REMOVE_PARTICIPANT", participantId: p.id }, `${name} removed from the roster.`);
            }}
          >
            Remove {name} from the roster
          </button>
        </div>
      ) : null}
    </li>
  );
}

const ELIGIBILITY_LABEL: Record<EncounterCandidateDto["eligibility"], string> = {
  ELIGIBLE: "Can join",
  ALREADY_MEMBER: "Already in this encounter",
  NOT_COMPLETE: "Not completed",
  OTHER_RELEASE: "Different Release",
};

function AddParticipants({ encounter, disabled, run }: { encounter: EncounterDto; disabled: boolean; run: Run }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<EncounterCandidateDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [side, setSide] = useState<string>("");
  const seq = useRef(0);
  const search = useCallback(async () => {
    const mine = ++seq.current;
    try {
      const found = await searchEncounterCandidates(encounter.id, q);
      if (mine === seq.current) {
        setResults(found);
        setError(null);
      }
    } catch (e) {
      if (mine === seq.current) setError(e instanceof EncounterApiError ? e.message : "Could not search Characters.");
    }
  }, [encounter.id, q]);
  useEffect(() => {
    const t = setTimeout(() => void search(), 250);
    return () => clearTimeout(t);
    // The version is a dependency so eligibility is re-read from the server after every roster change.
  }, [search, encounter.version]);
  return (
    <section className="gov-panel" aria-labelledby="encounter-add-heading">
      <h2 id="encounter-add-heading">Add Characters</h2>
      <div className="prowess-encounter__inline">
        <label className="gov-field">
          <span>Search Characters by name</span>
          <input value={q} onChange={(e) => setQ(e.target.value)} maxLength={120} />
        </label>
        <label className="gov-field">
          <span>Add to side</span>
          <select value={side} onChange={(e) => setSide(e.target.value)}>
            <option value="">No side yet</option>
            {encounter.sides.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      {error !== null ? (
        <p className="gov-error" role="alert">
          {error}
        </p>
      ) : null}
      {results === null && error === null ? <p role="status">Searching…</p> : null}
      {results !== null && results.length === 0 ? <p className="gov-muted">No Character matches. Characters are created in the Character Library.</p> : null}
      {results !== null && results.length > 0 ? (
        <ul className="prowess-encounter__candidates" aria-label="Characters" data-testid="encounter-candidates">
          {results.map((c) => (
            <li key={c.id} data-testid="encounter-candidate" data-eligibility={c.eligibility}>
              <strong>{c.name}</strong> <span className="gov-muted">Level {c.level}</span> <span className="gov-badge">{ELIGIBILITY_LABEL[c.eligibility]}</span>
              {c.reason !== null ? <span className="gov-muted"> {c.reason}</span> : null}{" "}
              {c.eligibility === "ELIGIBLE" ? (
                <button
                  type="button"
                  className="gov-button"
                  disabled={disabled}
                  onClick={() => void run({ kind: "ADD_PARTICIPANT", characterId: c.id, sideId: side === "" ? null : side }, `${c.name} added.`)}
                >
                  Add {c.name}
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
