"use client";

import { useEffect, useRef, useState } from "react";
import { EVALUATION_CONTEXT_FAMILIES, EVALUATION_OPERATIONS } from "@prowess/rules";
import type { EvaluationBinding, EvaluationOperation, EvaluationPlan, EvaluationStepResult, ExplanationDocument } from "@prowess/rules";
import { GovernanceApiError, apiList, query } from "../../../../src/api-client/http";
import type { ManifestDto, ReleaseDto, RulesetDto } from "../../../../src/api-client/types";
import { runRulesEvaluation, type RulesEvaluationRequest, type RulesEvaluationResponse } from "../../../../src/api-client/rules";
import { orderedSteps, parseObject, snapshotRequest } from "../_lib/editor";
import { samplePlan } from "../_lib/sample";
import { ChildOutput, Diagnostics, ExplanationView, Raw, StepOverview, TraceView } from "./views";

type Pane = "PLAN" | "RUN" | "DETAILS";
type Tab = "OVERVIEW" | "INPUT" | "OUTPUT" | "TRACE" | "PROVENANCE" | "RAW";
type Family = "actor" | "build" | "runtime";
interface DraftStep { editorId: number; stepKey: string; order: number; operation: EvaluationOperation; inputText: string; bindings: EvaluationBinding[] }
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const errorText = (error: unknown): string => error instanceof GovernanceApiError ? `${error.code}: ${error.status >= 500 ? "The server could not complete the request." : error.message}` : error instanceof Error ? error.message : "Could not complete the request.";

function asDraft(plan: EvaluationPlan): DraftStep[] {
  return plan.steps.map((step, index) => ({ editorId: index, stepKey: step.stepKey, order: step.order, operation: step.operation, inputText: JSON.stringify(step.input, null, 2), bindings: [...step.bindings] }));
}

/** Read-only, paginated M2 lists. No record is ever selected automatically. */
function ExactSelector({ mode, rulesetId, exactId, onMode, onRuleset, onExact }: {
  mode: "MANIFEST" | "RELEASE"; rulesetId: string; exactId: string;
  onMode: (mode: "MANIFEST" | "RELEASE") => void; onRuleset: (id: string) => void; onExact: (id: string) => void;
}) {
  const [rulesets, setRulesets] = useState<RulesetDto[]>([]);
  const [records, setRecords] = useState<Array<ManifestDto | ReleaseDto>>([]);
  const [rulesetPage, setRulesetPage] = useState(1);
  const [recordPage, setRecordPage] = useState(1);
  const [moreRulesets, setMoreRulesets] = useState(false);
  const [moreRecords, setMoreRecords] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    apiList<RulesetDto>(`/api/rulesets${query({ page: rulesetPage, pageSize: 100 })}`).then(result => {
      if (!live) return;
      setRulesets(previous => rulesetPage === 1 ? result.items : [...previous, ...result.items]);
      setMoreRulesets(result.pagination !== null && result.pagination.page < result.pagination.totalPages);
    }, failure => { if (live) setError(errorText(failure)); });
    return () => { live = false; };
  }, [rulesetPage]);
  useEffect(() => {
    if (!rulesetId) return;
    let live = true;
    apiList<ManifestDto | ReleaseDto>(`/api/rulesets/${encodeURIComponent(rulesetId)}/${mode === "MANIFEST" ? "manifests" : "releases"}${query({ page: recordPage, pageSize: 100 })}`).then(result => {
      if (!live) return;
      setRecords(previous => recordPage === 1 ? result.items : [...previous, ...result.items]);
      setMoreRecords(result.pagination !== null && result.pagination.page < result.pagination.totalPages);
      setLoading(false);
      setError(null);
    }, failure => { if (live) { setError(errorText(failure)); setLoading(false); } });
    return () => { live = false; };
  }, [mode, rulesetId, recordPage]);
  const resetList = () => { setRecords([]); setMoreRecords(false); setRecordPage(1); setError(null); setLoading(true); };
  const selected = records.find(record => record.id === exactId);
  return <fieldset className="lab-card"><legend>Exact Ruleset selection</legend>
    <div role="group" aria-label="Ruleset selection mode">{(["MANIFEST", "RELEASE"] as const).map(value => <button type="button" aria-pressed={mode === value} key={value} onClick={() => { if (mode !== value) { resetList(); onMode(value); } }}>{value === "MANIFEST" ? "Manifest" : "Release"}</button>)}</div>
    <label>Ruleset<select value={rulesetId} onChange={event => { resetList(); onRuleset(event.target.value); }}><option value="">Choose a Ruleset</option>{rulesets.map(r => <option key={r.id} value={r.id}>{r.name} · {r.id}</option>)}</select></label>
    {moreRulesets && <button type="button" onClick={() => setRulesetPage(rulesetPage + 1)}>Load more Rulesets</button>}
    <label>Exact {mode === "MANIFEST" ? "Manifest" : "Release"}<select value={exactId} disabled={!rulesetId || loading} onChange={event => onExact(event.target.value)}><option value="">Choose an exact record</option>{records.map(r => <option key={r.id} value={r.id}>{"releaseNumber" in r ? `Release ${r.releaseNumber} · ${r.versionLabel}` : `Development Manifest ${r.manifestVersion}`} · {r.id}</option>)}</select></label>
    {moreRecords && <button type="button" onClick={() => { setLoading(true); setRecordPage(recordPage + 1); }}>Load more records</button>}
    {loading && rulesetId && <p role="status">Loading exact records…</p>}
    {rulesetId && !loading && records.length === 0 && !error && <p>No exact {mode === "MANIFEST" ? "Manifests" : "Releases"} available. Create one in Rulesets &amp; Canon Manager.</p>}
    {selected && <details><summary>Selected record identity</summary><Raw value={selected} label="Exact selected record" /></details>}
    {error && <p role="alert">{error}</p>}
  </fieldset>;
}

function BindingEditor({ bindings, earlier, onChange }: { bindings: readonly EvaluationBinding[]; earlier: readonly DraftStep[]; onChange: (bindings: EvaluationBinding[]) => void }) {
  const change = (index: number, binding: EvaluationBinding) => onChange(bindings.map((old, i) => i === index ? binding : old));
  return <fieldset><legend>Bindings — exact copies</legend>
    {bindings.map((binding, index) => <fieldset className="lab-card" key={index}><legend>Binding {index + 1}</legend>
      <label>Target pointer<input value={binding.target} onChange={event => change(index, { ...binding, target: event.target.value })} /></label>
      <label>Source type<select value={binding.source.kind} onChange={event => change(index, { ...binding, source: event.target.value === "CONTEXT" ? { kind: "CONTEXT", context: "ACTOR", pointer: "" } : { kind: "STEP", stepKey: "", pointer: "" } })}><option value="CONTEXT">Context</option><option value="STEP">Prior Step</option></select></label>
      {binding.source.kind === "CONTEXT" ? <label>Context family<select value={binding.source.context} onChange={event => change(index, { ...binding, source: { kind: "CONTEXT", context: event.target.value as "ACTOR", pointer: binding.source.pointer } })}>{EVALUATION_CONTEXT_FAMILIES.map(f => <option key={f}>{f}</option>)}</select></label> : <label>Prior step<select value={binding.source.stepKey} onChange={event => change(index, { ...binding, source: { kind: "STEP", stepKey: event.target.value, pointer: binding.source.pointer } })}><option value="">Choose an earlier step</option>{earlier.map(step => <option key={step.editorId} value={step.stepKey}>{step.order} · {step.stepKey}</option>)}</select></label>}
      <label>Source pointer<input value={binding.source.pointer} onChange={event => change(index, { ...binding, source: { ...binding.source, pointer: event.target.value } })} /></label>
      {binding.source.pointer === "" && <p>{binding.source.kind === "STEP" ? "Whole Response" : "Whole Context"}</p>}
      <button type="button" onClick={() => onChange(bindings.filter((_, i) => i !== index))}>Remove binding {index + 1}</button>
    </fieldset>)}
    {new Set(bindings.map(binding => binding.target)).size !== bindings.length && <p role="status">Repeated target pointers. The server will validate the binding conflicts.</p>}
    <button type="button" onClick={() => onChange([...bindings, { target: "", source: { kind: "CONTEXT", context: "ACTOR", pointer: "" } }])}>Add Binding</button>
  </fieldset>;
}

export function RulesLab() {
  const [mode, setMode] = useState<"MANIFEST" | "RELEASE">("MANIFEST");
  const [rulesetId, setRulesetId] = useState("");
  const [exactId, setExactId] = useState("");
  const [evaluationKey, setEvaluationKey] = useState("lab.example");
  const [contexts, setContexts] = useState<Record<Family, string>>({ actor: "null", build: "null", runtime: "null" });
  const [steps, setSteps] = useState<DraftStep[]>([]);
  const [designations, setDesignations] = useState({ primaryStepKey: "", validationStepKey: "", explanationStepKey: "" });
  const [editingId, setEditingId] = useState<number | null>(null);
  const [importText, setImportText] = useState("");
  const [pane, setPane] = useState<Pane>("PLAN");
  const [tab, setTab] = useState<Tab>("OVERVIEW");
  const [selectedStepKey, setSelectedStepKey] = useState("");
  const [explanationKey, setExplanationKey] = useState("");
  const [focusPath, setFocusPath] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const [requestError, setRequestError] = useState<string | null>(null);
  const [editorError, setEditorError] = useState<string | null>(null);
  const [response, setResponse] = useState<RulesEvaluationResponse | null>(null);
  const [requestSnapshot, setRequestSnapshot] = useState<RulesEvaluationRequest | null>(null);
  const [revision, setRevision] = useState(0);
  const [runRevision, setRunRevision] = useState<number | null>(null);
  const nextId = useRef(0);
  const changed = () => setRevision(value => value + 1);
  const ordered = orderedSteps(steps);
  const editing = steps.find(step => step.editorId === editingId);
  const editingPosition = ordered.findIndex(step => step.editorId === editingId);
  const resultStep = response?.data?.steps.find(step => step.stepKey === selectedStepKey);
  const stale = response !== null && revision !== runRevision;

  const updateStep = (patch: Partial<DraftStep>) => { changed(); setSteps(previous => previous.map(step => step.editorId === editingId ? { ...step, ...patch } : step)); };
  const request = (): RulesEvaluationRequest => {
    if (!exactId) throw new Error("Choose an exact Manifest or Release before running.");
    const plan: EvaluationPlan = {
      ...Object.fromEntries(Object.entries(designations).map(([key, value]) => [key, value || null])),
      steps: steps.map(step => {
        if (!step.stepKey) throw new Error("Each step needs an explicit stepKey.");
        const input = parseObject(step.inputText, `${step.stepKey} input`);
        if (input === null) throw new Error(`${step.stepKey} input must be a JSON object.`);
        return { stepKey: step.stepKey, order: step.order, operation: step.operation, input: input as EvaluationPlan["steps"][number]["input"], bindings: step.bindings };
      }),
    };
    return { ruleset: mode === "MANIFEST" ? { kind: "MANIFEST", manifestId: exactId } : { kind: "RELEASE", releaseId: exactId }, evaluationKey, actor: parseObject(contexts.actor, "Actor context"), build: parseObject(contexts.build, "Build context"), runtime: parseObject(contexts.runtime, "Runtime context"), plan: plan as unknown as Record<string, unknown> };
  };
  let preview: RulesEvaluationRequest | null = null;
  let syntaxError: string | null = null;
  try { preview = request(); } catch (error) { syntaxError = errorText(error); }

  const run = async () => {
    if (inFlight.current) return;
    let sent: RulesEvaluationRequest;
    try { sent = snapshotRequest(request()); } catch (error) { setEditorError(errorText(error)); return; }
    inFlight.current = true; setBusy(true); setRequestError(null); setEditorError(null);
    // An older successful response must never look like the result of a failed request.
    setResponse(null); setRequestSnapshot(sent); setRunRevision(revision); setPane("RUN");
    try {
      const result = await runRulesEvaluation(sent);
      setResponse(result);
      setSelectedStepKey(result.data?.primaryStepKey ?? result.data?.steps[0]?.stepKey ?? "");
      setExplanationKey(result.data?.explanationStepKey ?? "");
      setFocusPath(null);
    } catch (error) { setRequestError(errorText(error)); }
    finally { inFlight.current = false; setBusy(false); }
  };
  const loadSample = () => {
    const sample = samplePlan(); const drafts = asDraft(sample);
    setSteps(drafts); nextId.current = drafts.length;
    setContexts({ actor: JSON.stringify({ stats: { divisor: 4 } }, null, 2), build: "null", runtime: "null" });
    setDesignations({ primaryStepKey: sample.primaryStepKey ?? "", validationStepKey: sample.validationStepKey ?? "", explanationStepKey: sample.explanationStepKey ?? "" });
    setEditingId(drafts[0]?.editorId ?? null); setEditorError(null); changed();
  };
  const reset = () => {
    if (revision > 0 && !window.confirm("Reset the lab? All locally entered inputs and results will be discarded.")) return;
    setSteps([]); setContexts({ actor: "null", build: "null", runtime: "null" }); setDesignations({ primaryStepKey: "", validationStepKey: "", explanationStepKey: "" });
    setExactId(""); setRulesetId(""); setMode("MANIFEST"); setEvaluationKey("lab.example"); setResponse(null); setRequestSnapshot(null); setRequestError(null); setEditorError(null); setEditingId(null); setImportText(""); changed();
  };
  const selectStep = (step: EvaluationStepResult) => { setSelectedStepKey(step.stepKey); setFocusPath(null); setTab("OVERVIEW"); setPane("DETAILS"); };
  const explanationSteps = response?.data?.steps.filter(step => step.operation === "EXPLANATION" || step.operation === "EXPLANATION_PROJECT") ?? [];
  const explanationStep = explanationSteps.find(step => step.stepKey === explanationKey);
  const explanation = explanationStep?.response?.data as unknown as ExplanationDocument | null | undefined;
  const validationStep = response?.data?.steps.find(step => step.stepKey === response.data?.validationStepKey);
  const traceLink = (contributionKey: string, path: string) => {
    // Follow only explicit authored binding identity. Never reconstruct resolved inputs in the browser.
    const original = requestSnapshot?.plan as unknown as EvaluationPlan | undefined;
    const authored = original?.steps.find(step => step.stepKey === explanationKey);
    const source = authored?.bindings.find(binding => binding.target === "/document" && binding.source.kind === "STEP" && binding.source.pointer === "/data")?.source;
    const canonical = authored?.operation === "EXPLANATION" ? authored : source?.kind === "STEP" ? original?.steps.find(step => step.stepKey === source.stepKey) : undefined;
    const input = canonical?.input.input;
    if (!object(input) || !Array.isArray(input.contributions)) return;
    const index = input.contributions.findIndex(item => object(item) && item.contributionKey === contributionKey);
    const binding = canonical?.bindings.find(item => item.target === `/input/contributions/${index}/response` && item.source.kind === "STEP" && item.source.pointer === "");
    if (binding?.source.kind !== "STEP") return;
    setSelectedStepKey(binding.source.stepKey); setFocusPath(path); setTab("TRACE"); setPane("DETAILS");
  };
  const importPlan = () => {
    try {
      const raw = parseObject(importText, "Plan");
      if (!raw || !Array.isArray(raw.steps)) throw new Error("Plan must contain a steps array.");
      // Only editor shape checks here; operation inputs and plan semantics still run on WO10.
      for (const step of raw.steps) {
        if (!object(step) || typeof step.stepKey !== "string" || typeof step.order !== "number" || !(EVALUATION_OPERATIONS as readonly unknown[]).includes(step.operation) || !object(step.input) || (step.bindings !== undefined && !Array.isArray(step.bindings))) throw new Error("Each editor step requires stepKey, numeric order, supported operation, input object and bindings array.");
        for (const binding of (step.bindings ?? []) as unknown[]) if (!object(binding) || typeof binding.target !== "string" || !object(binding.source) || typeof binding.source.pointer !== "string" || (binding.source.kind !== "CONTEXT" && binding.source.kind !== "STEP") || (binding.source.kind === "CONTEXT" && !(EVALUATION_CONTEXT_FAMILIES as readonly unknown[]).includes(binding.source.context)) || (binding.source.kind === "STEP" && typeof binding.source.stepKey !== "string")) throw new Error("Each editor binding requires a target, source kind, source identity and string pointer.");
      }
      const plan = raw as unknown as EvaluationPlan;
      const drafts = asDraft({ ...plan, steps: plan.steps.map(step => ({ ...step, bindings: step.bindings ?? [] })) });
      setSteps(drafts); nextId.current = drafts.length; setEditingId(drafts[0]?.editorId ?? null);
      setDesignations({ primaryStepKey: plan.primaryStepKey ?? "", validationStepKey: plan.validationStepKey ?? "", explanationStepKey: plan.explanationStepKey ?? "" });
      setEditorError(null); changed();
    } catch (error) { setEditorError(errorText(error)); }
  };

  return <section className="rules-lab">
    <header className="lab-header"><div><h1>Rules Inspector</h1><p>Inspect and test exact Rules Engine evaluations.</p><p>Calculation Lab · local, ephemeral request state</p></div><div className="lab-actions"><button type="button" onClick={loadSample} disabled={busy}>Load neutral sample</button><button type="button" onClick={reset} disabled={busy}>Reset Lab</button></div></header>
    <div className="lab-mobile-tabs" role="tablist" aria-label="Lab panes">{(["PLAN", "RUN", "DETAILS"] as const).map(value => <button type="button" role="tab" aria-selected={pane === value} aria-controls={`lab-${value}`} id={`lab-tab-${value}`} key={value} onClick={() => setPane(value)}>{value}</button>)}</div>
    <div className="lab-grid" data-pane={pane}>
      <section className="lab-pane" id="lab-PLAN" aria-label="Plan editor">
        <h2>PLAN / CONTEXT</h2><ExactSelector mode={mode} rulesetId={rulesetId} exactId={exactId} onMode={value => { setMode(value); setExactId(""); changed(); }} onRuleset={value => { setRulesetId(value); setExactId(""); changed(); }} onExact={value => { setExactId(value); changed(); }} />
        <label>Evaluation key<input value={evaluationKey} onChange={event => { setEvaluationKey(event.target.value); changed(); }} /></label>
        <fieldset><legend>Contexts — server-resolved Ruleset context</legend>{(["actor", "build", "runtime"] as const).map(family => <details key={family}><summary>{family.toUpperCase()} · {contexts[family].trim() === "null" ? "NULL" : "Enabled"}</summary>
          <label>{family} context mode<select value={contexts[family].trim() === "null" ? "NULL" : "ENABLED"} onChange={event => { setContexts(old => ({ ...old, [family]: event.target.value === "NULL" ? "null" : "{}" })); changed(); }}><option value="NULL">Null</option><option value="ENABLED">Enabled</option></select></label>
          <label>{family} JSON<textarea value={contexts[family]} spellCheck={false} onChange={event => { setContexts(old => ({ ...old, [family]: event.target.value })); changed(); }} /></label>
        </details>)}</fieldset>
        <h3>Steps — order, then stepKey</h3>
        {new Set(steps.map(step => step.order)).size !== steps.length && <p role="status">Orders tie: stepKey resolves ties by code-unit order.</p>}
        <ol className="lab-step-list" aria-label="Authored execution order">{ordered.map(step => <li key={step.editorId}><button type="button" aria-pressed={editingId === step.editorId} onClick={() => setEditingId(step.editorId)}>{step.order} · {step.operation} · {step.stepKey || "Missing stepKey"}</button></li>)}</ol>
        <button type="button" onClick={() => { const id = nextId.current++; const draft: DraftStep = { editorId: id, stepKey: `step-${id + 1}`, order: 10, operation: "FORMULA", inputText: "{}", bindings: [] }; setSteps(old => [...old, draft]); setEditingId(id); changed(); }}>Add Step</button>
        {editing && <fieldset><legend>Edit Step</legend>
          <label>stepKey<input value={editing.stepKey} required onChange={event => updateStep({ stepKey: event.target.value })} /></label>
          <label>Order<input type="number" value={editing.order} onChange={event => updateStep({ order: Number(event.target.value) })} /></label>
          <label>Operation<select value={editing.operation} onChange={event => updateStep({ operation: event.target.value as EvaluationOperation })}>{EVALUATION_OPERATIONS.map(operation => <option key={operation}>{operation}</option>)}</select></label>
          <label>Input template JSON<textarea value={editing.inputText} spellCheck={false} onChange={event => updateStep({ inputText: event.target.value })} /></label>
          <BindingEditor bindings={editing.bindings} earlier={ordered.slice(0, editingPosition)} onChange={bindings => updateStep({ bindings })} />
          <button type="button" onClick={() => { const id = nextId.current++; setSteps(old => [...old, { ...editing, editorId: id, stepKey: `step-${id + 1}`, bindings: editing.bindings.map(binding => ({ ...binding, source: { ...binding.source } })) }]); setEditingId(id); changed(); }}>Duplicate Step</button>
          <button type="button" onClick={() => { setSteps(old => old.filter(step => step.editorId !== editingId)); setEditingId(null); changed(); }}>Remove Step</button>
        </fieldset>}
        <fieldset><legend>Explicit plan designations</legend>{(["primaryStepKey", "validationStepKey", "explanationStepKey"] as const).map(field => <label key={field}>{field === "primaryStepKey" ? "Primary Step" : field === "validationStepKey" ? "Validation Step" : "Explanation Step"}<select value={designations[field]} onChange={event => { setDesignations(old => ({ ...old, [field]: event.target.value })); changed(); }}><option value="">None</option>{ordered.filter(step => field === "primaryStepKey" || step.operation === (field === "validationStepKey" ? "VALIDATION" : "EXPLANATION")).map(step => <option key={step.editorId} value={step.stepKey}>{step.stepKey}</option>)}</select></label>)}</fieldset>
        <details><summary>Import plan JSON</summary><label>Plan JSON<textarea value={importText} onChange={event => setImportText(event.target.value)} spellCheck={false} /></label><button type="button" onClick={importPlan}>Use plan JSON</button></details>
        <details><summary>Request JSON preview</summary><Raw value={preview} label="Request JSON" /></details>
        {syntaxError && <p role="status">{syntaxError}</p>}{editorError && <p role="alert">{editorError}</p>}
        <button type="button" className="lab-run" onClick={run} disabled={busy || preview === null}>{busy ? "Running…" : "Run Evaluation"}</button>
      </section>
      <section className="lab-pane" id="lab-RUN" aria-label="Evaluation result"><h2>EXECUTION / EXPLANATION</h2>
        <p role="status" aria-live="polite">{busy ? "Running" : requestError ? "Request Error" : response?.data?.executionStatus ?? (response ? `Evaluation returned: ${response.status}` : "Idle")}</p>
        {requestError && <div role="alert" className="lab-banner"><h3>Request Error — evaluation did not run</h3><p>{requestError}</p></div>}
        {!response && !busy && !requestError && <p>Configure an exact Ruleset and Evaluation Plan, then run the evaluation.</p>}
        {response && <>
          {stale && <p role="status" className="lab-banner">STALE — Inputs changed since this evaluation. Run again for fresh output.</p>}
          <h3>{response.data?.evaluationKey ?? requestSnapshot?.evaluationKey}</h3><p>Run execution: <strong>{response.data?.executionStatus ?? "No run — plan or context invalid"}</strong></p><p>Orchestration RuleEngine status: <strong>{response.status}</strong></p>
          <details><summary>Exact evaluated Ruleset identity</summary><Raw value={response.ruleset} /></details>
          <ol className="lab-step-list" aria-label="Executed step timeline">{response.data?.steps.map(step => <li key={step.stepKey}><button type="button" onClick={() => selectStep(step)}>{step.order} · {step.stepKey} · {step.operation} · {step.executionStatus}{step.response && ` / ${step.response.status}`}</button>{step.executionStatus === "BLOCKED" && step.blockedBy.map((binding, index) => <p key={index}>{binding.reason} · {binding.target}</p>)}</li>)}</ol>
          <h3>Validation</h3>{validationStep?.response ? <Diagnostics response={validationStep.response} /> : <p>No Validation step was included or its response is unavailable.</p>}
          <h3>Explanation</h3>
          {explanationSteps.length ? <><label>Returned explanation step<select value={explanationKey} onChange={event => setExplanationKey(event.target.value)}><option value="">Select an exact explanation result</option>{explanationSteps.map(step => <option key={step.stepKey} value={step.stepKey}>{step.stepKey} · {step.operation} · {step.response?.data && object(step.response.data) ? String(step.response.data.level) : step.executionStatus}</option>)}</select></label>
            {explanation ? <ExplanationView document={explanation} onTrace={traceLink} /> : <p>Select an available returned explanation. No local explanation is generated.</p>}</> : <p>No Explanation step was included in this plan.</p>}
          <h3>Orchestration diagnostics</h3><Diagnostics response={response} />
          <details><summary>Evaluated request snapshot</summary><Raw value={requestSnapshot} label="Evaluated request snapshot" /></details><details><summary>Exact run response</summary><Raw value={response} /></details>
        </>}
      </section>
      <section className="lab-pane" id="lab-DETAILS" aria-label="Selected step inspector"><h2>INSPECTOR</h2>
        {!resultStep ? <p>Select a returned step to inspect.</p> : <><h3>{resultStep.stepKey}</h3><div role="tablist" aria-label="Inspector tabs">{(["OVERVIEW", "INPUT", "OUTPUT", "TRACE", "PROVENANCE", "RAW"] as const).map(value => <button type="button" role="tab" aria-selected={tab === value} aria-controls={`inspector-${value}`} key={value} onClick={() => setTab(value)}>{value}</button>)}</div>
          <div role="tabpanel" id={`inspector-${tab}`} aria-label={tab}>
            {tab === "OVERVIEW" && <StepOverview step={resultStep} />}
            {tab === "INPUT" && <><h4>AUTHORED INPUT TEMPLATE</h4><Raw value={(requestSnapshot?.plan as unknown as EvaluationPlan)?.steps.find(step => step.stepKey === resultStep.stepKey)?.input} /><h4>RESOLVED INPUT — returned trace</h4><p>WO10 does not return a standalone resolved input object. Exact primitive input records are shown where supplied in the trace.</p><TraceView trace={resultStep.response?.trace ?? null} stepKey={resultStep.stepKey} /></>}
            {tab === "OUTPUT" && <ChildOutput response={resultStep.response} />}
            {tab === "TRACE" && <TraceView trace={resultStep.response?.trace ?? null} focus={focusPath} stepKey={resultStep.stepKey} />}
            {tab === "PROVENANCE" && <><h4>Ruleset Provenance — exact returned identity</h4><Raw value={resultStep.response?.ruleset} /><h4>Rule Provenance — exact trace records</h4><TraceView trace={resultStep.response?.trace ?? null} stepKey={resultStep.stepKey} /></>}
            {tab === "RAW" && <Raw value={resultStep} label="Raw step result" />}
          </div></>}
      </section>
    </div>
  </section>;
}
