"use client";

import { useId, useState, type ReactNode } from "react";
import type { AuthoringCatalogDto, AuthoringKindDto, ValidationIssueDto } from "../_lib/authoring-client";
import { descriptorFor, groupsOf, GENERIC_DESCRIPTOR, type FieldDescriptor } from "../_lib/descriptors";
import { fieldDomId, fieldErrorId, issuesForField, stableStringify, type DefinitionCandidate } from "../_lib/definition-form";
import { AuthoredDataEditor } from "./AuthoredDataEditor";
import { KeywordPicker } from "./KeywordPicker";

/**
 * The structured Prowess Definition editor (PAS-10 M6-WO1 §12–13, §28, §57–59, §68). It renders the fields the
 * authoring descriptor names for the kind's M5 shared contract, with options taken from the catalog (the M5
 * vocabularies) — and nothing else. It never checks legality: every issue shown next to a field came from the server's
 * M5 validation boundary (§14). Raw JSON is available only as read-only inspection, plus an explicitly enabled
 * developer edit (§12).
 */
type Payload = Record<string, unknown>;

function FieldErrors({ fieldKey, issues }: { fieldKey: string; issues: ValidationIssueDto[] }) {
  if (issues.length === 0) return null;
  return (
    <ul id={fieldErrorId(fieldKey)} className="prowess-authoring__field-errors">
      {issues.map((i, n) => (
        <li key={n}>
          <strong>{i.severity === "ERROR" ? "Error" : "Warning"}:</strong> {i.path ? <code>{i.path}</code> : null} {i.message}
        </li>
      ))}
    </ul>
  );
}

function Shell({ field, issues, children, composite }: { field: FieldDescriptor; issues: ValidationIssueDto[]; children: ReactNode; composite: boolean }) {
  const describedBy = [field.help ? `${fieldDomId(field.key)}-help` : null, issues.length > 0 ? fieldErrorId(field.key) : null].filter(Boolean).join(" ") || undefined;
  const body = (
    <>
      {field.help ? (
        <p id={`${fieldDomId(field.key)}-help`} className="gov-muted">
          {field.help}
        </p>
      ) : null}
      {children}
      <FieldErrors fieldKey={field.key} issues={issues} />
    </>
  );
  if (composite) {
    return (
      <fieldset id={fieldDomId(field.key)} tabIndex={-1} className="prowess-authoring__field" aria-describedby={describedBy} aria-invalid={issues.some((i) => i.severity === "ERROR") || undefined}>
        <legend>
          {field.label}
          {field.required ? " (required)" : ""}
        </legend>
        {body}
      </fieldset>
    );
  }
  return <div className="prowess-authoring__field gov-field">{body}</div>;
}

function LabeledControl({ field, issues, children }: { field: FieldDescriptor; issues: ValidationIssueDto[]; children: (props: { id: string; "aria-describedby"?: string; "aria-invalid"?: boolean }) => ReactNode }) {
  const describedBy = [field.help ? `${fieldDomId(field.key)}-help` : null, issues.length > 0 ? fieldErrorId(field.key) : null].filter(Boolean).join(" ") || undefined;
  return (
    <div className="prowess-authoring__field gov-field">
      <label htmlFor={fieldDomId(field.key)}>
        {field.label}
        {field.required ? " (required)" : ""}
      </label>
      {field.help ? (
        <p id={`${fieldDomId(field.key)}-help`} className="gov-muted">
          {field.help}
        </p>
      ) : null}
      {children({ id: fieldDomId(field.key), "aria-describedby": describedBy, "aria-invalid": issues.some((i) => i.severity === "ERROR") || undefined })}
      <FieldErrors fieldKey={field.key} issues={issues} />
    </div>
  );
}

const asArray = (v: unknown): Array<Record<string, unknown>> => (Array.isArray(v) ? (v as Array<Record<string, unknown>>) : []);
const asObject = (v: unknown): Record<string, unknown> => (v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

function FieldControl({ field, value, onChange, catalog, issues }: { field: FieldDescriptor; value: unknown; onChange: (v: unknown) => void; catalog: AuthoringCatalogDto; issues: ValidationIssueDto[] }) {
  const listId = useId();
  switch (field.input) {
    case "select": {
      const options = catalog.vocabularies[field.vocabulary] ?? [];
      return (
        <LabeledControl field={field} issues={issues}>
          {(p) => (
            <select {...p} value={typeof value === "string" ? value : ""} onChange={(e) => onChange(e.target.value)}>
              <option value="">Choose…</option>
              {options.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          )}
        </LabeledControl>
      );
    }
    case "token":
      return (
        <LabeledControl field={{ ...field, help: field.help ?? "An explicit SCREAMING_SNAKE_CASE token." }} issues={issues}>
          {(p) => <input {...p} value={typeof value === "string" ? value : ""} onChange={(e) => onChange(e.target.value)} autoComplete="off" spellCheck={false} />}
        </LabeledControl>
      );
    case "keywords": {
      const keys = Array.isArray(value) ? (value as string[]) : [];
      return (
        <Shell field={field} issues={issues} composite>
          {keys.length === 0 ? <p className="gov-muted">No Keywords.</p> : null}
          <ul className="prowess-authoring__chips" aria-label="Definition Keywords">
            {keys.map((k) => (
              <li key={k} className="prowess-keyword-chip">
                <code>{k}</code>{" "}
                <button type="button" className="gov-link-button" onClick={() => onChange(keys.filter((x) => x !== k))} aria-label={`Remove Keyword ${k}`}>
                  Remove
                </button>
              </li>
            ))}
          </ul>
          <KeywordPicker label="Add a Definition Keyword" exclude={keys} onPick={(k) => onChange([...keys, k.canonicalKey])} />
        </Shell>
      );
    }
    case "compatibility": {
      const rows = asArray(value);
      const set = (i: number, patch: Record<string, unknown>) => onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
      return (
        <Shell field={field} issues={issues} composite>
          <datalist id={listId}>
            {(catalog.vocabularies.componentContracts ?? []).map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
          <ol className="prowess-authoring__rows">
            {rows.map((r, i) => (
              <li key={i} className="prowess-authoring__row">
                <label className="gov-field">
                  <span>Relation</span>
                  <input list={listId} value={typeof r.relation === "string" ? r.relation : ""} onChange={(e) => set(i, { relation: e.target.value })} spellCheck={false} />
                </label>
                <label className="gov-field">
                  <span>Allowed labels (comma-separated, exact)</span>
                  <input
                    value={Array.isArray(r.allow) ? (r.allow as string[]).join(", ") : ""}
                    onChange={(e) => set(i, { allow: e.target.value.split(",").map((s) => s.trim()).filter((s) => s !== "") })}
                    spellCheck={false}
                  />
                </label>
                <button type="button" className="gov-button" onClick={() => onChange(rows.filter((_, j) => j !== i))} aria-label={`Remove compatibility rule ${i + 1}`}>
                  Remove
                </button>
              </li>
            ))}
          </ol>
          <button type="button" className="gov-button" onClick={() => onChange([...rows, { relation: "", allow: [] }])}>
            Add compatibility rule
          </button>
        </Shell>
      );
    }
    case "costContributions": {
      const rows = asArray(value);
      const set = (i: number, patch: Record<string, unknown>) => onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
      return (
        <Shell field={field} issues={issues} composite>
          <ol className="prowess-authoring__rows">
            {rows.map((r, i) => (
              <li key={i} className="prowess-authoring__row">
                <label className="gov-field">
                  <span>Contribution key</span>
                  <input value={typeof r.contributionKey === "string" ? r.contributionKey : ""} onChange={(e) => set(i, { contributionKey: e.target.value })} spellCheck={false} />
                </label>
                <label className="gov-field">
                  <span>Currency</span>
                  <select value={typeof r.currency === "string" ? r.currency : ""} onChange={(e) => set(i, { currency: e.target.value })}>
                    <option value="">Choose…</option>
                    {(catalog.vocabularies.costCurrencies ?? []).map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </label>
                <fieldset className="prowess-authoring__nested">
                  <legend>Cost data</legend>
                  <AuthoredDataEditor value={asObject(r.data)} onChange={(data) => set(i, { data })} label={`Cost contribution ${i + 1} data`} />
                </fieldset>
                <button type="button" className="gov-button" onClick={() => onChange(rows.filter((_, j) => j !== i))} aria-label={`Remove cost contribution ${i + 1}`}>
                  Remove
                </button>
              </li>
            ))}
          </ol>
          <button type="button" className="gov-button" onClick={() => onChange([...rows, { contributionKey: "", currency: "", data: {} }])}>
            Add cost contribution
          </button>
        </Shell>
      );
    }
    case "outcomes": {
      const rows = asArray(value);
      const set = (i: number, patch: Record<string, unknown>) => onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
      return (
        <Shell field={field} issues={issues} composite>
          <ol className="prowess-authoring__rows">
            {rows.map((r, i) => (
              <li key={i} className="prowess-authoring__row">
                <label className="gov-field">
                  <span>Outcome key</span>
                  <input value={typeof r.outcomeKey === "string" ? r.outcomeKey : ""} onChange={(e) => set(i, { outcomeKey: e.target.value })} spellCheck={false} />
                </label>
                <fieldset className="prowess-authoring__nested">
                  <legend>Outcome data</legend>
                  <AuthoredDataEditor value={asObject(r.data)} onChange={(data) => set(i, { data })} label={`Outcome ${i + 1} data`} />
                </fieldset>
                <button type="button" className="gov-button" onClick={() => onChange(rows.filter((_, j) => j !== i))} aria-label={`Remove outcome ${i + 1}`}>
                  Remove
                </button>
              </li>
            ))}
          </ol>
          <button type="button" className="gov-button" onClick={() => onChange([...rows, { outcomeKey: "", data: {} }])}>
            Add outcome
          </button>
        </Shell>
      );
    }
    case "resolution": {
      const r = value === null || value === undefined ? null : asObject(value);
      return (
        <Shell field={field} issues={issues} composite>
          <label className="prowess-authoring__inline">
            <input type="checkbox" checked={r !== null} onChange={(e) => onChange(e.target.checked ? { mode: "", data: {} } : null)} /> This Effect has its own resolution
          </label>
          {r !== null ? (
            <>
              <label className="gov-field">
                <span>Resolution mode</span>
                <select value={typeof r.mode === "string" ? r.mode : ""} onChange={(e) => onChange({ ...r, mode: e.target.value })}>
                  <option value="">Choose…</option>
                  {(catalog.vocabularies.resolutionModes ?? []).map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </label>
              <fieldset className="prowess-authoring__nested">
                <legend>Resolution data</legend>
                <AuthoredDataEditor value={asObject(r.data)} onChange={(data) => onChange({ ...r, data })} label="Resolution data" />
              </fieldset>
            </>
          ) : null}
        </Shell>
      );
    }
    case "restriction": {
      const r = asObject(value);
      return (
        <Shell field={field} issues={issues} composite>
          <label className="gov-field">
            <span>Restriction key (SCREAMING_SNAKE_CASE)</span>
            <input value={typeof r.restrictionKey === "string" ? r.restrictionKey : ""} onChange={(e) => onChange({ ...r, restrictionKey: e.target.value })} spellCheck={false} />
          </label>
          <fieldset className="prowess-authoring__nested">
            <legend>Restriction data</legend>
            <AuthoredDataEditor value={asObject(r.data)} onChange={(data) => onChange({ ...r, data })} label="Restriction data" />
          </fieldset>
        </Shell>
      );
    }
    case "authoredData":
      return (
        <Shell field={field} issues={issues} composite>
          <AuthoredDataEditor value={asObject(value)} onChange={onChange as (v: Record<string, unknown>) => void} label={field.label} />
        </Shell>
      );
  }
}

function LegacyTermsEditor({ candidate, onChange, catalog }: { candidate: DefinitionCandidate; onChange: (c: DefinitionCandidate) => void; catalog: AuthoringCatalogDto }) {
  const id = useId();
  const terms = candidate.legacyTerms ?? [];
  const available = catalog.legacyTerms.filter((t) => !terms.some((x) => x.legacyTerm === t.legacyTerm));
  const set = (next: typeof terms) => {
    const copy = { ...candidate };
    if (next.length === 0) delete copy.legacyTerms;
    else copy.legacyTerms = next;
    onChange(copy);
  };
  return (
    <fieldset className="prowess-authoring__field">
      <legend>Legacy terminology (provenance)</legend>
      <p className="gov-muted">Record a historical source term this Definition was structured from. Provenance only: the payload always uses the canonical term, and a legacy term never becomes a new mechanic.</p>
      <ul className="prowess-authoring__chips" aria-label="Recorded legacy terms">
        {terms.map((t) => (
          <li key={t.legacyTerm} className="prowess-keyword-chip">
            {t.legacyTerm} → {t.canonicalTerm}{" "}
            <button type="button" className="gov-link-button" onClick={() => set(terms.filter((x) => x.legacyTerm !== t.legacyTerm))} aria-label={`Remove legacy term ${t.legacyTerm}`}>
              Remove
            </button>
          </li>
        ))}
      </ul>
      {available.length > 0 ? (
        <label className="gov-field" htmlFor={id}>
          <span>Add an inventoried legacy term</span>
          <select
            id={id}
            value=""
            onChange={(e) => {
              const t = available.find((x) => x.legacyTerm === e.target.value);
              if (t) set([...terms, t]);
            }}
          >
            <option value="">Choose…</option>
            {available.map((t) => (
              <option key={t.legacyTerm} value={t.legacyTerm}>
                {t.legacyTerm} → {t.canonicalTerm}
              </option>
            ))}
          </select>
        </label>
      ) : null}
    </fieldset>
  );
}

function RawJson({ candidate, onChange, readOnly }: { candidate: DefinitionCandidate; onChange: (c: DefinitionCandidate) => void; readOnly: boolean }) {
  const id = useId();
  const [enabled, setEnabled] = useState(false);
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  return (
    <details className="prowess-authoring__raw">
      <summary>Advanced: inspect the Definition as JSON</summary>
      <pre className="lab-json" aria-label="Definition JSON (read-only)">{JSON.stringify(candidate, null, 2)}</pre>
      {readOnly ? null : (
        <>
          <label className="prowess-authoring__inline">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => {
                setEnabled(e.target.checked);
                setText(JSON.stringify(candidate, null, 2));
                setError("");
              }}
            />{" "}
            Enable developer JSON editing (debugging only — the structured editor above is the normal workflow)
          </label>
          {enabled ? (
            <div className="gov-field">
              <label htmlFor={id}>Developer JSON</label>
              <textarea id={id} className="lab-json" rows={14} value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} />
              {error ? <p className="gov-bad" role="alert">{error}</p> : null}
              <button
                type="button"
                className="gov-button"
                onClick={() => {
                  try {
                    const parsed = JSON.parse(text) as unknown;
                    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
                    const next = parsed as DefinitionCandidate;
                    if (next.definitionKind !== candidate.definitionKind) throw new Error("kind");
                    onChange(next);
                    setError("");
                  } catch (e) {
                    setError(e instanceof Error && e.message === "kind" ? `The Definition kind stays ${candidate.definitionKind}.` : "Not a JSON object.");
                  }
                }}
              >
                Apply JSON to the form
              </button>
            </div>
          ) : null}
        </>
      )}
    </details>
  );
}

export function DefinitionEditor({
  kind,
  catalog,
  candidate,
  onChange,
  issues,
  readOnly = false,
}: {
  kind: AuthoringKindDto;
  catalog: AuthoringCatalogDto;
  candidate: DefinitionCandidate;
  onChange: (c: DefinitionCandidate) => void;
  issues: readonly ValidationIssueDto[];
  readOnly?: boolean;
}) {
  const descriptor = descriptorFor(kind, candidate.schemaVersion);
  const generic = descriptor === GENERIC_DESCRIPTOR;
  const setField = (key: string, v: unknown) => onChange({ ...candidate, payload: key === "" ? (v as Payload) : { ...candidate.payload, [key]: v } });
  return (
    <div className="prowess-authoring__definition" data-definition-kind={kind.definitionKind}>
      <p className="prowess-authoring__purpose">{descriptor.purpose}</p>
      <p className="gov-muted">
        {kind.definitionKind} · family {kind.systemFamily}
        {kind.branch ? ` · ${kind.branch} branch` : ""}
        {kind.sharedContract ? ` · ${kind.sharedContract} contract` : ""} · payload schema version {candidate.schemaVersion}
      </p>
      <fieldset disabled={readOnly} className="prowess-authoring__groups">
        <legend className="prowess-visually-hidden">Prowess Definition fields</legend>
        {groupsOf(descriptor).map((group) => (
          <section key={group} className="prowess-authoring__group" aria-label={group}>
            <h4>{group}</h4>
            {descriptor.fields
              .filter((f) => f.group === group)
              .map((f) => (
                <FieldControl key={`${f.key}:${stableStringify(kind.definitionKind)}`} field={f} value={generic ? candidate.payload : candidate.payload[f.key]} onChange={(v) => setField(f.key, v)} catalog={catalog} issues={issuesForField(issues, f.key)} />
              ))}
          </section>
        ))}
        <LegacyTermsEditor candidate={candidate} onChange={onChange} catalog={catalog} />
      </fieldset>
      <RawJson candidate={candidate} onChange={onChange} readOnly={readOnly} />
    </div>
  );
}
