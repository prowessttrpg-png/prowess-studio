"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { CharacterApiError, getSheet, updatePlayState, updateSheetNotes, type CharacterSheetDto, type SheetNotesInputDto } from "../../_lib/character-client";
import { releaseLabel } from "../CharacterReview";
import { PortraitFrame } from "./PortraitFrame";
import { CompassStar } from "./SheetIcons";
import { ActionsPanel, actionNoteLines, AffinityPanel, AttunementPanel, CarryPanel, CharacterNotesPanel, CoreValuesPanel, EquipmentPanel, GrantedEffectsPanel, PersonnelHeader, PossessionsPanel, ResourcesPanel, SheetModeContext, SkillsPanel, StatsPanel, type SheetMode } from "./SheetPanels";
import "./character-sheet.css";

/**
 * The Digital Character Sheet (PAS-10 M6-WO5) — the Prowess Field Manual personnel file, rebuilt from components.
 * Page 1 holds high-frequency play (identity, portrait, Stats, Core Values & Combat, Resources, Skills, Actions);
 * Page 2 holds persistent state (Granted Effects & Conditions, Affinity Profile, Equipment & Gear, Attunement,
 * Carry & Weight, Possessions, Character Notes). One server read model feeds everything; nothing here calculates a rule.
 *
 *   - Resources save inline (one compare-and-set request per change, serialized so rapid clicks never conflict).
 *   - Company / PAC, Action Notes, Character Notes and possessions autosave together (debounced).
 *   - `mode="print"` renders the fixed two-page composition with no controls, plus a supplemental page only when text
 *     or possessions overflow the paper (never silently clipped).
 */
const NOTES_DEBOUNCE_MS = 700;
const PRINT_POSSESSION_ROWS = 11;

type SaveState = "idle" | "saving" | "saved" | "error";

export function CharacterSheet({ characterId, mode = "digital" }: { characterId: string; mode?: SheetMode }) {
  const [sheet, setSheet] = useState<CharacterSheetDto | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notes, setNotes] = useState<SheetNotesInputDto | null>(null);
  const [notesState, setNotesState] = useState<{ state: SaveState; message: string | null }>({ state: "idle", message: null });
  const [resourceMessage, setResourceMessage] = useState<string | null>(null);
  const [resourceBusy, setResourceBusy] = useState(false);
  const notesVersion = useRef(0);
  const playVersion = useRef(0);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const notesTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const accept = useCallback((next: CharacterSheetDto, withNotes: boolean) => {
    setSheet(next);
    notesVersion.current = next.notes.version;
    playVersion.current = next.playStateVersion;
    if (withNotes) setNotes({ companyPac: next.identity.companyPac, actionNotes: next.notes.actionNotes, characterNotes: next.notes.characterNotes, possessions: next.notes.possessions });
  }, []);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      accept(await getSheet(characterId), true);
    } catch (e) {
      setLoadError(e instanceof CharacterApiError ? `${e.message} (${e.code})` : "Could not load the Character Sheet.");
    }
  }, [accept, characterId]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount
    void load();
  }, [load]);
  useEffect(() => () => void (notesTimer.current !== null && clearTimeout(notesTimer.current)), []);

  const setResource = (key: string, value: number) => {
    setResourceBusy(true);
    setResourceMessage(null);
    queue.current = queue.current.then(async () => {
      try {
        accept(await updatePlayState(characterId, playVersion.current, { [key]: value }), false);
      } catch (e) {
        setResourceMessage(e instanceof CharacterApiError ? (e.code === "CHARACTER.STALE_WRITE" ? "This sheet changed elsewhere — reloaded the latest values." : `${e.message} (${e.code})`) : "Could not save that value.");
        if (e instanceof CharacterApiError && e.code === "CHARACTER.STALE_WRITE") accept(await getSheet(characterId), false);
      } finally {
        setResourceBusy(false);
      }
    });
  };

  const saveNotes = (next: SheetNotesInputDto) => {
    setNotesState({ state: "saving", message: null });
    queue.current = queue.current.then(async () => {
      try {
        accept(await updateSheetNotes(characterId, notesVersion.current, { ...next, companyPac: next.companyPac === "" ? null : next.companyPac }), false);
        setNotesState({ state: "saved", message: null });
      } catch (e) {
        setNotesState({ state: "error", message: e instanceof CharacterApiError ? (e.code === "CHARACTER.STALE_WRITE" ? "These notes changed elsewhere. Reload the sheet before editing again." : `${e.message} (${e.code})`) : "Could not save the notes." });
      }
    });
  };
  const editNotes = (patch: Partial<SheetNotesInputDto>) => {
    if (notes === null) return;
    const next = { ...notes, ...patch };
    setNotes(next);
    setNotesState({ state: "saving", message: null });
    if (notesTimer.current !== null) clearTimeout(notesTimer.current);
    notesTimer.current = setTimeout(() => saveNotes(next), NOTES_DEBOUNCE_MS);
  };

  if (loadError !== null) {
    return (
      <p className="gov-error" role="alert">
        {loadError}{" "}
        <button type="button" className="gov-link-button" onClick={() => void load()}>
          Try again
        </button>
      </p>
    );
  }
  if (sheet === null || notes === null) return <p role="status">Loading the Character Sheet…</p>;

  const possessionsOverflow = notes.possessions.length > PRINT_POSSESSION_ROWS;
  const textOverflow = (value: string, lines: number) => value.split("\n").length > lines || value.length > lines * 90;
  const actionLines = actionNoteLines(sheet);
  const supplemental = mode === "print" && (possessionsOverflow || textOverflow(notes.actionNotes, actionLines) || textOverflow(notes.characterNotes, 14));

  return (
    <SheetModeContext.Provider value={mode}>
    <div className={`character-sheet character-sheet--${mode}`} data-testid="character-sheet" data-mode={mode}>
      {mode === "digital" ? (
        <div className="sheet-toolbar">
          <p className="sheet-muted" data-testid="sheet-release">
            Pinned to {releaseLabel(sheet.release)} — every value on this sheet comes from that Release.
          </p>
          <p className="sheet-actions">
            <span role="status" className="sheet-muted" data-testid="sheet-notes-status">
              {notesState.state === "saving" ? "Saving notes…" : notesState.state === "saved" ? "All notes saved." : ""}
            </span>
            <Link className="sheet-button" href={`/characters/${encodeURIComponent(sheet.identity.id)}/print`} target="_blank" rel="noopener">
              Print sheet
            </Link>
          </p>
          {notesState.message !== null ? (
            <p className="sheet-error" role="alert">
              {notesState.message}
            </p>
          ) : null}
        </div>
      ) : null}
      <div className="sheet-pages">
        <article className="sheet-page sheet-page--1" aria-label="Character Sheet page 1" data-testid="sheet-page-1">
          <PageHeader />
          <div className="sheet-p1-top">
            <PortraitFrame sheet={sheet} editable={mode === "digital"} onSheet={(next) => accept(next, false)} />
            <PersonnelHeader sheet={sheet} mode={mode} companyPac={notes.companyPac ?? ""} onCompanyPac={(v) => editNotes({ companyPac: v })} />
          </div>
          <div className="sheet-p1-grid">
            <StatsPanel sheet={sheet} />
            <CoreValuesPanel sheet={sheet} />
            <ResourcesPanel sheet={sheet} mode={mode} busy={resourceBusy} message={resourceMessage} onSet={setResource} />
          </div>
          <SkillsPanel sheet={sheet} mode={mode} />
          <ActionsPanel sheet={sheet} mode={mode} value={notes.actionNotes} onChange={(v) => editNotes({ actionNotes: v })} />
          <PageFooter n={1} />
        </article>
        <article className="sheet-page sheet-page--2" aria-label="Character Sheet page 2" data-testid="sheet-page-2">
          <PageHeader />
          <GrantedEffectsPanel sheet={sheet} mode={mode} />
          <AffinityPanel sheet={sheet} mode={mode} />
          <EquipmentPanel sheet={sheet} onLoadoutSaved={() => void getSheet(characterId).then((next) => accept(next, false))} />
          <div className="sheet-p2-pair">
            <AttunementPanel sheet={sheet} />
            <CarryPanel sheet={sheet} />
          </div>
          <div className="sheet-p2-pair sheet-p2-pair--wide">
            <PossessionsPanel sheet={sheet} mode={mode} rows={notes.possessions} onChange={(rows) => editNotes({ possessions: rows })} printRows={PRINT_POSSESSION_ROWS} />
            <CharacterNotesPanel sheet={sheet} mode={mode} value={notes.characterNotes} onChange={(v) => editNotes({ characterNotes: v })} />
          </div>
          <PageFooter n={2} />
        </article>
        {supplemental ? (
          <article className="sheet-page sheet-page--supplement" aria-label="Character Sheet supplemental page" data-testid="sheet-page-supplement">
            <PageHeader />
            <h2 className="sheet-section__banner sheet-section__heading">Supplemental — continued text</h2>
            {textOverflow(notes.actionNotes, actionLines) ? (
              <section>
                <h3>Action Notes (complete)</h3>
                <p className="sheet-lines__text">{notes.actionNotes}</p>
              </section>
            ) : null}
            {textOverflow(notes.characterNotes, 14) ? (
              <section>
                <h3>Character Notes (complete)</h3>
                <p className="sheet-lines__text">{notes.characterNotes}</p>
              </section>
            ) : null}
            {possessionsOverflow ? (
              <section>
                <h3>Possessions (continued)</h3>
                <ul>
                  {notes.possessions.slice(PRINT_POSSESSION_ROWS).map((p, i) => (
                    <li key={i}>
                      {p.category} — {p.item} {p.weight ? `(${p.weight})` : ""}
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
            <PageFooter n={3} />
          </article>
        ) : null}
      </div>
    </div>
    </SheetModeContext.Provider>
  );
}

function PageHeader() {
  return (
    <header className="sheet-page__header">
      <span className="sheet-brand">
        <CompassStar className="sheet-brand__star" /> PROWESS <small>Field Manuals</small>
      </span>
      <span className="sheet-page__rule" aria-hidden="true" />
      <span className="sheet-brand__doc">Character Sheet</span>
    </header>
  );
}

function PageFooter({ n }: { n: number }) {
  return (
    <footer className="sheet-page__footer">
      <span className="sheet-page__number" aria-label={`Page ${n}`}>
        {n}
      </span>
    </footer>
  );
}
