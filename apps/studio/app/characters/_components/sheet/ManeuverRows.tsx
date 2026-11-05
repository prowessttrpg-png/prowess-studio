"use client";
import { useContext } from "react";
import type { CharacterSheetDto } from "../../_lib/character-client";
import { actionLabel, ordered } from "../../_lib/maneuver-format";
import { refName, STATE_LABELS } from "../../_lib/spell-format";
import { SheetModeContext } from "./SheetPanels";

const PRINT_MANEUVER_ROWS = 4;
export function SignatureManeuverRows({ sheet }: { sheet: CharacterSheetDto }) {
  const mode = useContext(SheetModeContext), all = sheet.signatureManeuvers ?? [];
  const rows = mode === "print" ? all.slice(0, PRINT_MANEUVER_ROWS) : all;
  if (!rows.length) return null;
  return <div className="sheet-attacks" data-testid="sheet-signature-maneuvers"><table className="sheet-table"><caption>Signature Maneuvers</caption><thead><tr><th scope="col">Maneuver / revision</th><th scope="col">AP · MP</th><th scope="col">Action sequence</th><th scope="col">Effects / Keywords</th></tr></thead><tbody>{rows.map(m => <tr key={m.id} data-testid="sheet-maneuver-row"><th scope="row">{mode === "digital" ? <a href={`/characters/${encodeURIComponent(sheet.identity.id)}/maneuvers/${encodeURIComponent(m.id)}`}>{m.name}</a> : m.name} · r{m.revisionNumber}<span className="sheet-muted"> ({STATE_LABELS[m.state]})</span>{m.warnings.map((q, i) => <span className="sheet-muted" key={i}> {q.message}</span>)}</th><td>{m.finalApCost !== null && m.finalMpCost !== null ? `${m.finalApCost} AP · ${m.finalMpCost} MP` : "Cost unresolved"}</td><td>{ordered(m.actions).map(a => actionLabel(sheet.names, a.source)).join(" → ")}</td><td>{m.effects.map(r => refName(sheet.names, r)).join(", ")} {m.keywords.join(", ")}</td></tr>)}</tbody></table>{mode === "print" && all.length > rows.length ? <p className="sheet-muted">More Maneuvers are listed in the digital sheet.</p> : null}</div>;
}
