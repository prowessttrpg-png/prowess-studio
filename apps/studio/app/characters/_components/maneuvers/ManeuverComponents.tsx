"use client";
import { formatEnumLabel } from "@prowess/ui";
import { useId, useState } from "react";
import type { ManeuverBuilderDto, ManeuverOptionDto } from "../../_lib/maneuver-types";
import { refName } from "../../_lib/spell-format";
import { actionLabel } from "../../_lib/maneuver-format";

export function ManeuverPicker({ title, options, names, onPick }: { title: string; options: ManeuverOptionDto[]; names: Record<string, string>; onPick: (o: ManeuverOptionDto) => void }) {
  const [search, setSearch] = useState(""); const id = useId();
  return <section aria-label={title}><h3>{title}</h3><label htmlFor={id}>Search {title}</label><input id={id} type="search" value={search} onChange={e => setSearch(e.target.value)} />
    <ul className="prowess-spell-picker__options">{options.filter(o => refName(names, o.ref).toLowerCase().includes(search.toLowerCase())).map(o => <li key={o.ref.entityVersionId}>
      <strong>{refName(names, o.ref)}</strong> {o.description} {o.traitScope ? `Scope: ${formatEnumLabel(o.traitScope)}` : ""} {o.consumesSlot === false ? "Obligatory — no ordinary Condition slot" : ""}
      <button type="button" className="gov-button" disabled={!o.available} onClick={() => onPick(o)} aria-label={`Select ${refName(names, o.ref)}`}>Select</button>
      {!o.available ? <p>{o.unavailableReason ?? "Unavailable"}</p> : null}
      {o.eligibility?.requirements.filter(q => q.satisfied === false).map((q, i) => <p key={i}>Requirement: {formatEnumLabel(q.prerequisiteKey)}</p>)}
    </li>)}</ul></section>;
}
export function ActionPicker({ data, onPick }: { data: ManeuverBuilderDto; onPick: (o: ManeuverBuilderDto["catalog"]["actions"][number]) => void }) {
  return <section aria-label="Available Actions">{(["WEAPON_ATTACK", "MOVEMENT", "DEFENSE", "INTERACTION"] as const).map(category => <section key={category} aria-label={formatEnumLabel(category)}><h3>{formatEnumLabel(category)}</h3>
    <ul>{data.catalog.actions.filter(a => a.category === category).map(a => <li key={a.optionKey} data-testid="maneuver-action-option"><strong>{actionLabel(data.names, a.source)}</strong> <button type="button" className="gov-button" disabled={!a.available} onClick={() => onPick(a)} aria-label={`Add ${actionLabel(data.names, a.source)}`}>Add Action</button>
      {a.reasons.map(q => <p key={q.code}>{q.message}</p>)}<details><summary>Exact Action identity and inherited profile</summary><pre className="maneuver-inspector">{JSON.stringify({ source: a.source, profile: a.profile }, null, 2)}</pre></details>
    </li>)}</ul>
    {!data.catalog.actions.some(a => a.category === category) ? <p>No exact {formatEnumLabel(category)} Action is supplied by this Release.</p> : null}
  </section>)}</section>;
}
