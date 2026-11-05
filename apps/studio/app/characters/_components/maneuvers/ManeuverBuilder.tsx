"use client";
import "./maneuvers.css";
import { formatEnumLabel } from "@prowess/ui";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { CharacterApiError, finalizeManeuver, getManeuverBuilder, rebuildManeuver, saveManeuverDraft, validateManeuver } from "../../_lib/character-client";
import type { ManeuverBuilderDto, ManeuverDraftDto, ManeuverEvaluationDto, ManeuverOptionDto } from "../../_lib/maneuver-types";
import { actionLabel, attachmentGroups, MANEUVER_STEPS, maneuverIssueStep, nextKey, ordered, renumber, type ManeuverStep } from "../../_lib/maneuver-format";
import { isFinalizable, refName, tagsFromText } from "../../_lib/spell-format";
import { ParameterFields } from "../abilities/ParameterFields";
import { ActionPicker, ManeuverPicker } from "./ManeuverComponents";
import { ManeuverCost, ManeuverReview, ManeuverState, ManeuverWarnings } from "./ManeuverReview";

const CONCEPT_LABELS = { name: "Name", description: "Description", visualDescription: "Visual description", notes: "Notes" };

type SaveState = "saved" | "unsaved" | "saving" | "conflict" | "error";
const SAVE_LABELS = { saved: "Saved", unsaved: "Unsaved changes", saving: "Saving…", conflict: "Conflict — this Maneuver changed elsewhere", error: "Not saved" };
const messageOf = (e: unknown) => e instanceof CharacterApiError ? `${e.message} (${e.code})` : "The request could not be completed.";

export function ManeuverBuilder({ characterId, maneuverId }: { characterId: string; maneuverId: string }) {
  const router = useRouter();
  const [data, setData] = useState<ManeuverBuilderDto | null>(null), [draft, setDraft] = useState<ManeuverDraftDto | null>(null);
  const [evaluation, setEvaluation] = useState<ManeuverEvaluationDto | null>(null), [save, setSave] = useState<SaveState>("saved");
  const [step, setStep] = useState<ManeuverStep>("CONCEPT"), [message, setMessage] = useState<string | null>(null), [busy, setBusy] = useState(false);
  const [members, setMembers] = useState<string[]>([]), [trait, setTrait] = useState<ManeuverOptionDto | null>(null), [traitTarget, setTraitTarget] = useState("");
  const version = useRef(0), pending = useRef<ManeuverDraftDto | null>(null), dirty = useRef(false), conflict = useRef(false), inFlight = useRef<Promise<boolean> | null>(null);
  const baseHref = `/characters/${encodeURIComponent(characterId)}/maneuvers/${encodeURIComponent(maneuverId)}`;
  const load = useCallback(async () => {
    try {
      const view = await getManeuverBuilder(characterId, maneuverId);
      version.current = view.maneuver.lockVersion; pending.current = view.maneuver.draft?.draft ?? null; dirty.current = false; conflict.current = false;
      setData(view); setDraft(pending.current); setEvaluation(view.maneuver.draft?.evaluation ?? null); setMembers(pending.current?.powerfulBlow?.actionKeys ?? []); setSave("saved"); setMessage(null);
    } catch (e) { setMessage(messageOf(e)); }
  }, [characterId, maneuverId]);
  useEffect(() => { void load(); }, [load]); // eslint-disable-line react-hooks/set-state-in-effect -- fetch on mount

  const persist = useCallback(async (): Promise<boolean> => {
    if (inFlight.current) await inFlight.current;
    if (conflict.current) return false;
    if (!dirty.current || !pending.current) return true;
    const sending = pending.current; dirty.current = false; setSave("saving");
    const run = (async () => {
      try {
        const view = await saveManeuverDraft(characterId, maneuverId, version.current, sending);
        version.current = view.maneuver.lockVersion;
        setData(d => d ? { ...d, ...view } : d);
        // A response to older choices must never present their evaluation as the edited draft's evaluation.
        if (!dirty.current) setEvaluation(view.maneuver.draft?.evaluation ?? null);
        setSave(dirty.current ? "unsaved" : "saved"); return !dirty.current;
      } catch (e) {
        dirty.current = true;
        if (e instanceof CharacterApiError && e.status === 409) { conflict.current = true; setSave("conflict"); }
        else setSave("error");
        setMessage(messageOf(e)); return false;
      } finally { inFlight.current = null; }
    })();
    inFlight.current = run; return run;
  }, [characterId, maneuverId]);
  const update = (fn: (d: ManeuverDraftDto) => ManeuverDraftDto) => {
    if (busy || !pending.current) return;
    const next = fn(pending.current); pending.current = next; dirty.current = true;
    setDraft(next); setEvaluation(null); setSave(conflict.current ? "conflict" : "unsaved");
  };
  useEffect(() => { if (save !== "unsaved") return; const timer = setTimeout(() => void persist(), 600); return () => clearTimeout(timer); }, [save, draft, persist]);
  useEffect(() => {
    const unload = (e: BeforeUnloadEvent) => { if (dirty.current || inFlight.current) { e.preventDefault(); e.returnValue = ""; } };
    const navigate = (e: MouseEvent) => {
      const anchor = e.target instanceof Element ? e.target.closest("a[href]") : null;
      if (anchor && (dirty.current || inFlight.current) && !window.confirm("Leave with unsaved Maneuver changes?")) { e.preventDefault(); e.stopPropagation(); }
    };
    window.addEventListener("beforeunload", unload); document.addEventListener("click", navigate, true);
    return () => { window.removeEventListener("beforeunload", unload); document.removeEventListener("click", navigate, true); };
  }, []);
  const go = (next: ManeuverStep) => { setStep(next); queueMicrotask(() => document.getElementById(`maneuver-step-${next}`)?.focus()); };
  const validate = async () => {
    if (!await persist()) return null;
    const checked = await validateManeuver(characterId, maneuverId, version.current);
    if (dirty.current) return null;
    setEvaluation(checked.evaluation); return checked.evaluation;
  };
  const command = async (fn: () => Promise<void>) => { setBusy(true); setMessage(null); try { await fn(); } catch (e) { if (e instanceof CharacterApiError && e.status === 409) { conflict.current = true; setSave("conflict"); } setMessage(messageOf(e)); } finally { setBusy(false); } };
  if (!data) return <div><h1>Signature Maneuver Builder</h1><p role={message ? "alert" : "status"}>{message ?? "Loading Maneuver…"}</p></div>;
  if (!draft) return <section className="gov-panel"><h1>{data.maneuver.current?.draft?.concept.name ?? "Signature Maneuver"}</h1><p>{data.maneuver.status === "RETIRED" ? "Retired — immutable history" : "Current revision remains active until a valid rebuild is finalized."}</p>
    {data.maneuver.status === "ACTIVE" ? <button type="button" disabled={busy} onClick={() => void command(async () => { await rebuildManeuver(characterId, maneuverId, version.current); await load(); })}>Start rebuild</button> : null}<Link href={baseHref}>Revision history</Link>{message ? <p role="alert">{message}</p> : null}</section>;
  const groups = attachmentGroups(draft, data.names);
  const uses = step === "EFFECTS" ? draft.effects : step === "TRAITS" ? draft.traits : draft.conditions;
  const options = step === "EFFECTS" ? data.catalog.effects : step === "TRAITS" ? data.catalog.traits : data.catalog.conditions;
  const targets = trait?.traitScope === "EFFECT_SPECIFIC" || trait?.traitScope === "RESOLUTION" ? draft.effects.map(e => ({ key: e.componentKey, label: refName(data.names, e.definition) })) : draft.actions.map(a => ({ key: trait?.traitScope === "TARGETING" ? `${a.componentKey}.targeting` : a.componentKey, label: `${a.componentKey}: ${actionLabel(data.names, a.source)}` }));
  return <div className="prowess-spell-builder maneuver-builder" data-testid="maneuver-builder">
    <nav aria-label="Breadcrumb"><Link href={`/characters/${encodeURIComponent(characterId)}/abilities`}>Abilities</Link> / <Link href={baseHref}>Maneuver history</Link></nav>
    <h1>Signature Maneuver Builder</h1>
    <div className="character-tabs" role="tablist" aria-label="Maneuver builder steps" onKeyDown={e => {
      const index = MANEUVER_STEPS.indexOf(step);
      const next = e.key === "Home" ? 0 : e.key === "End" ? MANEUVER_STEPS.length - 1 : e.key === "ArrowRight" || e.key === "ArrowDown" ? (index + 1) % MANEUVER_STEPS.length : e.key === "ArrowLeft" || e.key === "ArrowUp" ? (index + MANEUVER_STEPS.length - 1) % MANEUVER_STEPS.length : null;
      if (next !== null) { e.preventDefault(); go(MANEUVER_STEPS[next]!); }
    }}>{MANEUVER_STEPS.map(s => <button key={s} id={`maneuver-step-${s}`} role="tab" aria-selected={step === s} aria-controls="maneuver-panel" tabIndex={step === s ? 0 : -1} onClick={() => setStep(s)}>{formatEnumLabel(s)}</button>)}</div>
    <aside className="gov-panel" aria-label="Live Maneuver review">{evaluation ? <ManeuverState state={evaluation.state} /> : <span>Awaiting server evaluation</span>}<p role="status" aria-live="polite" data-testid="maneuver-save-state" data-save={save}>{SAVE_LABELS[save]}</p><ManeuverCost evaluation={evaluation} />
      <p>Martial: {data.catalog.martial.rankKey ?? "Unresolved"}. Action blocks: maximum {data.catalog.martial.maximumActionBlocks ?? "Unresolved"}.</p>
      <p>Global capacities — Effects: {data.catalog.martial.effectCapacity ?? "Unresolved"}; Traits: {data.catalog.martial.traitCapacity ?? "Unresolved"}; ordinary Conditions: {data.catalog.martial.conditionCapacity ?? "Unresolved"}.</p>
      <p>Shared Signature slots: {data.signature.used} / {data.signature.capacity ?? "Unresolved"}. Drafts use none.</p><ManeuverWarnings evaluation={evaluation} />
      <button type="button" disabled={busy || save === "conflict"} onClick={() => void persist()}>Save now</button>
      {save === "conflict" ? <p role="alert">Your local choices are retained. Saving and finalizing are blocked until you reload. <button type="button" onClick={() => { if (window.confirm("Discard these unsaved local choices and reload the saved Maneuver?")) void load(); }}>Reload saved Maneuver</button></p> : null}
    </aside>
    {message ? <p role="alert" className="gov-error">{message}</p> : null}
    {data.catalog.limitations.length ? <section aria-label="Release limitations"><h2>Release limitations</h2><ul>{data.catalog.limitations.map(q => <li key={q.code}>{q.message}</li>)}</ul></section> : null}
    {evaluation && (evaluation.issues.length || evaluation.missing.length) ? <section aria-label="Validation summary" data-testid="maneuver-issues"><h2>Needs attention</h2><ul>{evaluation.missing.map(q => <li key={q}><button onClick={() => go(MANEUVER_STEPS.includes(q as ManeuverStep) ? q as ManeuverStep : "REVIEW")}>{formatEnumLabel(q)}</button> required</li>)}{evaluation.issues.map((q, i) => <li key={i}><button onClick={() => go(maneuverIssueStep(q.path))}>{formatEnumLabel(maneuverIssueStep(q.path))}</button>: {q.message} <code>{q.code}</code></li>)}</ul></section> : null}
    <section id="maneuver-panel" role="tabpanel" aria-labelledby={`maneuver-step-${step}`} aria-busy={busy} className="gov-panel">
      <h2>{formatEnumLabel(step)}</h2>
      <fieldset disabled={busy}><legend>Maneuver editing controls</legend>
      {step === "CONCEPT" ? <>{(["name", "description", "visualDescription", "notes"] as const).map(key => <label className="gov-field" key={key}><span>{CONCEPT_LABELS[key]}</span><textarea aria-label={CONCEPT_LABELS[key]} value={draft.concept[key]} onChange={e => update(d => ({ ...d, concept: { ...d.concept, [key]: e.target.value } }))} /></label>)}<label className="gov-field">Narrative tags<input value={draft.concept.narrativeTags.join(", ")} onChange={e => update(d => ({ ...d, concept: { ...d.concept, narrativeTags: tagsFromText(e.target.value) } }))} /></label>
        <label className="gov-field">Optional Affinity<select value={draft.affinity?.entityVersionId ?? ""} onChange={e => update(d => ({ ...d, affinity: data.catalog.affinities.find(a => a.affinity.entityVersionId === e.target.value)?.affinity ?? null }))}><option value="">None</option>{data.catalog.affinities.map(a => <option key={a.affinity.entityVersionId} value={a.affinity.entityVersionId}>{refName(data.names, a.affinity)}</option>)}</select></label></> : null}
      {step === "ACTION_SELECTION" ? <ActionPicker data={data} onPick={a => update(d => ({ ...d, actions: [...d.actions, { componentKey: nextKey("action", d), order: d.actions.length + 1, source: a.source }] }))} /> : null}
      {step === "ACTION_SEQUENCE" ? <><ol>{ordered(draft.actions).map((a, i, rows) => <li key={a.componentKey} data-testid="maneuver-action-row"><strong>{a.componentKey}</strong>: {actionLabel(data.names, a.source)}
        <button type="button" aria-label={`Move ${a.componentKey} up`} disabled={i === 0} onClick={() => update(d => { const next = ordered(d.actions); [next[i - 1], next[i]] = [next[i]!, next[i - 1]!]; return { ...d, actions: renumber(next) }; })}>Up</button>
        <button type="button" aria-label={`Move ${a.componentKey} down`} disabled={i === rows.length - 1} onClick={() => update(d => { const next = ordered(d.actions); [next[i], next[i + 1]] = [next[i + 1]!, next[i]!]; return { ...d, actions: renumber(next) }; })}>Down</button>
        <button type="button" aria-label={`Remove ${a.componentKey}`} onClick={() => update(d => ({ ...d, actions: renumber(d.actions.filter(x => x.componentKey !== a.componentKey)) }))}>Remove</button>
        <p>Effects: {draft.effectAttachments.filter(e => e.actionKeys.includes(a.componentKey)).map(e => e.effectKey).join(", ") || "None attached"}; inherited targeting retained.</p>
      </li>)}</ol><fieldset><legend>Powerful Blow group</legend><p>Select exact Attack uses. The server validates compatibility; Effects must attach to the complete constituent set.</p>{draft.actions.map(a => <label key={a.componentKey}><input type="checkbox" disabled={!data.catalog.powerfulBlow.available || a.source.kind !== "WEAPON_ATTACK"} checked={members.includes(a.componentKey)} onChange={e => setMembers(previous => e.target.checked ? [...previous, a.componentKey] : previous.filter(k => k !== a.componentKey))} />{a.componentKey}</label>)}<button type="button" disabled={members.length < data.catalog.powerfulBlow.minimumRepetitions} onClick={() => update(d => ({ ...d, powerfulBlow: { actionKeys: members } }))}>Set Powerful Blow</button><button type="button" onClick={() => { setMembers([]); update(d => ({ ...d, powerfulBlow: null })); }}>Clear Powerful Blow</button></fieldset></> : null}
      {step === "EFFECTS" || step === "TRAITS" || step === "CONDITIONS" ? <><ManeuverPicker title={formatEnumLabel(step)} options={options} names={data.names} onPick={o => {
        if (step === "TRAITS") { setTrait(o); setTraitTarget(""); return; }
        update(d => { const field = step === "EFFECTS" ? "effects" : "conditions"; return { ...d, [field]: [...d[field], { componentKey: nextKey(field, d), order: d[field].length + 1, definition: o.ref, parameters: {} }] }; });
      }} />
        {step === "TRAITS" && trait ? <fieldset><legend>Add {refName(data.names, trait.ref)}</legend><p>Authorized scope: {trait.traitScope ?? "Unavailable"}</p>{trait.traitScope !== "ABILITY_WIDE" ? <label>Exact Trait target<select value={traitTarget} onChange={e => setTraitTarget(e.target.value)}><option value="">Choose a target</option>{targets.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}</select></label> : null}<button type="button" disabled={!trait.traitScope || (trait.traitScope !== "ABILITY_WIDE" && !traitTarget)} onClick={() => { update(d => ({ ...d, traits: [...d.traits, { componentKey: nextKey("trait", d), order: d.traits.length + 1, definition: trait.ref, parameters: {}, appliesTo: { scope: trait.traitScope!, componentKey: trait.traitScope === "ABILITY_WIDE" ? null : traitTarget } }] })); setTrait(null); }}>Add scoped Trait</button></fieldset> : null}
        <ol>{ordered(uses).map((u, i, rows) => <li key={u.componentKey}><strong>{u.componentKey}: {refName(data.names, u.definition)}</strong>
          <button type="button" disabled={i === 0} aria-label={`Move ${u.componentKey} up`} onClick={() => update(d => { const field = step === "EFFECTS" ? "effects" : step === "TRAITS" ? "traits" : "conditions"; const next = ordered(d[field]); [next[i - 1], next[i]] = [next[i]!, next[i - 1]!]; return { ...d, [field]: renumber(next) }; })}>Up</button>
          <button type="button" disabled={i === rows.length - 1} aria-label={`Move ${u.componentKey} down`} onClick={() => update(d => { const field = step === "EFFECTS" ? "effects" : step === "TRAITS" ? "traits" : "conditions"; const next = ordered(d[field]); [next[i], next[i + 1]] = [next[i + 1]!, next[i]!]; return { ...d, [field]: renumber(next) }; })}>Down</button>
          <button type="button" aria-label={`Remove ${u.componentKey}`} onClick={() => update(d => { const field = step === "EFFECTS" ? "effects" : step === "TRAITS" ? "traits" : "conditions"; return { ...d, [field]: d[field].filter(x => x.componentKey !== u.componentKey), ...(field === "effects" ? { effectAttachments: d.effectAttachments.filter(a => a.effectKey !== u.componentKey) } : {}) }; })}>Remove</button>
          <ParameterFields label={refName(data.names, u.definition)} declared={options.find(o => o.ref.entityVersionId === u.definition.entityVersionId)?.parameters ?? []} values={u.parameters} onChange={parameters => update(d => { const field = step === "EFFECTS" ? "effects" : step === "TRAITS" ? "traits" : "conditions"; return { ...d, [field]: d[field].map(x => x.componentKey === u.componentKey ? { ...x, parameters } : x) }; })} />
          {step === "EFFECTS" ? <label>Attach {u.componentKey} to<select aria-label={`Attach ${u.componentKey} to`} value={groups.find(g => JSON.stringify(g.actionKeys) === JSON.stringify(draft.effectAttachments.find(a => a.effectKey === u.componentKey)?.actionKeys))?.key ?? ""} onChange={e => { const group = groups.find(g => g.key === e.target.value); if (group) update(d => ({ ...d, effectAttachments: [...d.effectAttachments.filter(a => a.effectKey !== u.componentKey), { effectKey: u.componentKey, actionKeys: group.actionKeys }] })); }}><option value="">Choose Action or complete group</option>{groups.map(g => <option key={g.key} value={g.key}>{g.label}</option>)}</select></label> : null}
          {step === "TRAITS" ? <p>Scope: {formatEnumLabel(draft.traits.find(t => t.componentKey === u.componentKey)!.appliesTo.scope)}; target: {draft.traits.find(t => t.componentKey === u.componentKey)!.appliesTo.componentKey ?? "whole Maneuver"}</p> : null}
        </li>)}</ol>
      </> : null}
      {step === "DURATION" ? <><ManeuverPicker title="Duration" options={data.catalog.durations} names={data.names} onPick={o => update(d => ({ ...d, duration: { definition: o.ref, parameters: {} } }))} />{draft.duration ? <ParameterFields label={refName(data.names, draft.duration.definition)} declared={data.catalog.durations.find(o => o.ref.entityVersionId === draft.duration?.definition.entityVersionId)?.parameters ?? []} values={draft.duration.parameters} onChange={parameters => update(d => ({ ...d, duration: d.duration ? { ...d.duration, parameters } : null }))} /> : null}</> : null}
      {step === "CONDITIONS" ? <section aria-label="Performance requirements"><h3>Performance</h3>{!data.catalog.performanceCondition.present ? <p>The approved Performance Condition is missing from this Release.</p> : null}{data.performance?.map(p => <div key={p.definition.entityVersionId}><p>Actual Character rank: {p.currentRank ?? "Untrained / unavailable"}. Applies once to the complete Maneuver, as an obligatory Condition.</p><table className="gov-table"><caption>Release-authored Performance benefits</caption><thead><tr><th scope="col">Rank</th><th scope="col">MP reduction</th><th scope="col">Separate preparation AP</th></tr></thead><tbody>{p.benefits.map(b => <tr key={b.rank}><th scope="row">{formatEnumLabel(b.rank)}</th><td>{b.mpReduction}</td><td>{b.preparationAp}</td></tr>)}</tbody></table><p>Establish Performance before activation. Preparation is excluded from listed Maneuver AP.</p></div>)}</section> : null}
      {step === "REVIEW" || step === "FINALIZE" ? <ManeuverReview draft={draft} evaluation={evaluation} names={data.names} release={data.release} /> : null}
      <p className="gov-actions"><button type="button" disabled={busy || save === "conflict"} onClick={() => void command(async () => { await validate(); })}>Validate Maneuver</button>
        {step === "FINALIZE" ? <button type="button" className="gov-button gov-button--primary" disabled={busy || save !== "saved" || !isFinalizable(evaluation?.state)} onClick={() => void command(async () => { const checked = await validate(); if (!checked || !isFinalizable(checked.state)) return; await finalizeManeuver(characterId, maneuverId, version.current); dirty.current = false; router.push(baseHref); })}>Finalize Maneuver</button> : null}</p>
      </fieldset>
    </section>
  </div>;
}
