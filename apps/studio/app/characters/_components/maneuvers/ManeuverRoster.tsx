"use client";
import Link from "next/link";
import type { ManeuverEntryDto } from "../../_lib/maneuver-types";
import { actionLabel, maneuverCost, ordered, shownManeuver } from "../../_lib/maneuver-format";
import { ManeuverState, ManeuverWarnings } from "./ManeuverReview";

export function ManeuverRoster({ characterId, entries, names }: { characterId: string; entries: ManeuverEntryDto[]; names: Record<string, string> }) {
  const href = (id: string) => `/characters/${encodeURIComponent(characterId)}/maneuvers/${encodeURIComponent(id)}`;
  const active = entries.filter(e => e.status !== "RETIRED"), retired = entries.filter(e => e.status === "RETIRED");
  return <section aria-label="Signature Maneuvers" data-testid="abilities-maneuvers"><h3>Signature Maneuvers</h3>
    <Link className="gov-button" href={`/characters/${encodeURIComponent(characterId)}/maneuvers/new`}>New Signature Maneuver</Link>
    {active.length ? <table className="gov-table"><caption>Active and draft Maneuvers</caption><thead><tr><th scope="col">Name / revision</th><th scope="col">Action sequence</th><th scope="col">AP / MP</th><th scope="col">State</th></tr></thead><tbody>{active.map(entry => {
      const shown = shownManeuver(entry), c = maneuverCost(shown.evaluation);
      return <tr key={entry.id}><th scope="row"><Link href={href(entry.id)}>{shown.draft?.concept.name ?? "Unreadable Maneuver"}</Link> · {entry.current ? `Revision ${entry.current.revisionNumber}` : "Draft"}{entry.current && entry.draft ? " (rebuild in progress)" : ""}<ManeuverWarnings evaluation={shown.evaluation} /></th><td>{shown.draft ? ordered(shown.draft.actions).map(a => actionLabel(names, a.source)).join(" → ") : "Unavailable"}</td><td>{c ? `${c.ap.finalApCost} AP / ${c.mp.finalMpCost} MP` : "Unresolved"}</td><td>{entry.status} <ManeuverState state={entry.state} /></td></tr>;
    })}</tbody></table> : <p>No Signature Maneuvers yet.</p>}
    {retired.length ? <details><summary>Retired Maneuvers ({retired.length})</summary><ul>{retired.map(e => <li key={e.id}><Link href={href(e.id)}>{shownManeuver(e).draft?.concept.name ?? "Unreadable Maneuver"} — revision history</Link></li>)}</ul></details> : null}
  </section>;
}
