"use client";

import { parseFormulaExpression } from "@prowess/rules";
import { formatEnumLabel } from "@prowess/ui";
import { useId, useMemo, useState } from "react";
import { applyTerms, guidedFormula, printFormula, termExpression, termHazards, type FormulaTerm } from "../../_lib/formula-model";
import { renameVariable, sourceLabel, variableNameFor, type FormulaSourceDto } from "../../_lib/formula-sources";
import type { AuthoringCatalogDto } from "../_lib/authoring-client";

/**
 * PRE-M7-WO1 — guided editor for an authored core Formula (`{ expression, rounding, minimum, maximum, unit, variables }`).
 *
 * Contributions view: the expression's top-level terms (see formula-model.ts) with ordinary controls — sign, number,
 * input, divisor and rounding — plus Add / Remove. Inputs view: each declared variable and its exact source; "Replace
 * input" renames the variable everywhere through the parsed AST and re-declares it, so the rest of the expression is
 * untouched. Advanced: the raw expression, parsed live by the M4 parser. Guided edits never drop data: every other
 * Formula field is copied through, unused declarations are removed only because the M5 contract refuses them, and an
 * expression the contributions view cannot represent losslessly is never rewritten (Advanced only).
 *
 * Nothing here evaluates. Legality is decided by the server's M5 validation; values come from the server preview.
 */
type Formula = Record<string, unknown> & { expression?: unknown; rounding?: unknown; minimum?: unknown; maximum?: unknown; unit?: unknown; variables?: unknown };
type Decl = { variable: string; source: FormulaSourceDto };

const asDecls = (v: unknown): Decl[] => (Array.isArray(v) ? (v.filter((d) => d !== null && typeof d === "object") as Decl[]) : []);

export function FormulaEditor({ value, onChange, catalog, sourceKinds, label, ownStatistic }: { value: unknown; onChange: (v: Formula) => void; catalog: AuthoringCatalogDto; sourceKinds: readonly string[]; label: string; ownStatistic?: string | null }) {
  const base = useId();
  const formula: Formula = value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Formula) : {};
  const expression = typeof formula.expression === "string" ? formula.expression : "";
  const decls = asDecls(formula.variables);
  const guided = useMemo(() => guidedFormula(expression === "" ? "0" : expression), [expression]);
  const parsed = useMemo(() => parseFormulaExpression(expression), [expression]);
  const [mode, setMode] = useState<"GUIDED" | "ADVANCED">(guided.ok ? "GUIDED" : "ADVANCED");
  const [message, setMessage] = useState<string | null>(null);
  const set = (patch: Partial<Formula>) => onChange({ ...formula, ...patch });

  /** Rebuilds the expression from terms and keeps exactly the declarations it reads (adding new ones given). */
  const commitTerms = (terms: readonly FormulaTerm[], add: readonly Decl[] = []) => {
    const out = applyTerms(terms);
    if (!out.ok) {
      setMessage(`Not applied: ${out.reason}`);
      return;
    }
    const all = [...decls, ...add.filter((a) => !decls.some((d) => d.variable === a.variable))];
    setMessage(null);
    set({ expression: out.expression, variables: out.variables.map((v) => all.find((d) => d.variable === v) ?? { variable: v, source: { kind: "" } }) });
  };
  const replaceTerm = (i: number, t: FormulaTerm) => guided.ok && commitTerms(guided.terms.map((x, j) => (j === i ? t : x)));
  const removeTerm = (i: number) => guided.ok && commitTerms(guided.terms.filter((_, j) => j !== i));

  const replaceInput = (variable: string, source: FormulaSourceDto) => {
    const next = variableNameFor(source, decls.filter((d) => d.variable !== variable).map((d) => d.variable));
    if (!parsed.ok) {
      setMessage("Fix the expression before replacing an input.");
      return;
    }
    const renamed = next === variable ? expression : printFormula(renameVariable(parsed.ast, variable, next));
    setMessage(null);
    set({ expression: renamed, variables: decls.map((d) => (d.variable === variable ? { variable: next, source } : d)) });
  };

  const hazards = guided.ok ? termHazards(guided.terms) : [];
  const ownRef = ownStatistic ? decls.some((d) => d.source.kind === "DERIVED" && d.source.statistic === ownStatistic) : false;

  return (
    <div className="prowess-formula" data-testid="formula-editor">
      <div className="prowess-formula__summary">
        <span className="gov-muted">{label}</span>
        <code data-testid="formula-expression">{expression === "" ? "(empty)" : expression}</code>
      </div>
      <div role="group" aria-label={`${label}: editing mode`} className="prowess-formula__modes">
        <button type="button" aria-pressed={mode === "GUIDED"} disabled={!guided.ok} onClick={() => setMode("GUIDED")}>
          Contributions
        </button>
        <button type="button" aria-pressed={mode === "ADVANCED"} onClick={() => setMode("ADVANCED")}>
          Advanced expression
        </button>
      </div>
      {!guided.ok ? (
        <p className="gov-muted" data-testid="formula-guided-unavailable">
          The contributions view is not available for this expression ({guided.reason}). It is kept exactly as written; edit it as an advanced expression.
        </p>
      ) : null}

      {mode === "GUIDED" && guided.ok ? (
        <div>
          <ol className="prowess-formula__terms" aria-label={`${label}: contributions`}>
            {guided.terms.map((t, i) => (
              <li key={i} className="prowess-formula__term" data-testid="formula-term" data-kind={t.kind}>
                <TermControls index={i} term={t} decls={decls} onChange={(nt) => replaceTerm(i, nt)} idBase={`${base}-${i}`} />
                <button type="button" className="gov-link-button" onClick={() => removeTerm(i)} aria-label={`Remove contribution ${i + 1} (${termExpression(t)})`}>
                  Remove
                </button>
              </li>
            ))}
          </ol>
          {guided.terms.length === 0 || expression.trim() === "0" ? <p className="gov-muted">No contributions: this rule&apos;s value is the constant 0 (a valid, neutral rule — the statistic still exists).</p> : null}
          <AddContribution sourceKinds={sourceKinds} catalog={catalog} decls={decls} onAdd={(term, decl) => commitTerms(guided.terms.filter((t) => !(t.kind === "CONSTANT" && t.value === 0)).concat(term), decl === null ? [] : [decl])} />
        </div>
      ) : null}

      {mode === "ADVANCED" ? (
        <label className="gov-field">
          <span>{label}: expression (M4 safe formula — numbers, inputs, + − × ÷, parentheses, floor / ceil / min / max)</span>
          <input value={expression} onChange={(e) => set({ expression: e.target.value })} spellCheck={false} autoComplete="off" aria-invalid={!parsed.ok || undefined} data-testid="formula-advanced-input" />
          {!parsed.ok ? (
            <span className="gov-error" role="status" data-testid="formula-parse-error">
              {parsed.diagnostics.map((d) => d.message).join("; ")}
            </span>
          ) : null}
        </label>
      ) : null}

      <fieldset className="prowess-authoring__nested">
        <legend>Inputs this rule reads</legend>
        {decls.length === 0 ? <p className="gov-muted">None.</p> : null}
        <ul className="prowess-formula__inputs" aria-label={`${label}: inputs`}>
          {decls.map((d) => (
            <li key={d.variable} data-testid="formula-input" data-variable={d.variable}>
              <code>{d.variable}</code> = {sourceLabel(d.source)}
              <SourcePicker catalog={catalog} sourceKinds={sourceKinds} value={d.source} label={`Replace input ${d.variable}`} onChoose={(s) => replaceInput(d.variable, s)} />
            </li>
          ))}
        </ul>
        {parsed.ok
          ? parsed.variables
              .filter((v) => !decls.some((d) => d.variable === v))
              .map((v) => (
                <div key={v} className="gov-field">
                  <span className="gov-error">“{v}” is used but has no declared source.</span>
                  <SourcePicker catalog={catalog} sourceKinds={sourceKinds} value={{ kind: "" }} label={`Declare ${v}`} onChoose={(s) => set({ variables: [...decls, { variable: v, source: s }] })} />
                </div>
              ))
          : null}
      </fieldset>

      <div className="prowess-formula__settings">
        <label className="gov-field">
          <span>Rounding of the result</span>
          <select value={typeof formula.rounding === "string" ? formula.rounding : ""} onChange={(e) => set({ rounding: e.target.value })}>
            {(catalog.vocabularies.formulaRoundings ?? []).map((r) => (
              <option key={r} value={r}>
                {r === "NONE" ? "None (exact)" : formatEnumLabel(r)}
              </option>
            ))}
          </select>
        </label>
        <NullableNumber label="Minimum result (optional)" value={formula.minimum} onChange={(v) => set({ minimum: v })} />
        <NullableNumber label="Maximum result (optional)" value={formula.maximum} onChange={(v) => set({ maximum: v })} />
        <label className="gov-field">
          <span>Unit (optional, e.g. ft)</span>
          <input value={typeof formula.unit === "string" ? formula.unit : ""} onChange={(e) => set({ unit: e.target.value === "" ? null : e.target.value })} spellCheck={false} />
        </label>
      </div>
      {hazards.map((h) => (
        <p key={h} className="gov-error" role="status">
          {h}
        </p>
      ))}
      {ownRef ? <p className="gov-error" role="status">This rule reads its own statistic — the engine will refuse the cycle.</p> : null}
      {message !== null ? (
        <p className="gov-error" role="status">
          {message}
        </p>
      ) : null}
    </div>
  );
}

function NullableNumber({ label, value, onChange }: { label: string; value: unknown; onChange: (v: number | null) => void }) {
  return (
    <label className="gov-field">
      <span>{label}</span>
      <input type="number" step={1} value={typeof value === "number" ? value : ""} onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))} />
    </label>
  );
}

function TermControls({ index, term, decls, onChange, idBase }: { index: number; term: FormulaTerm; decls: readonly Decl[]; onChange: (t: FormulaTerm) => void; idBase: string }) {
  const n = index + 1;
  const sign = (
    <select aria-label={`Contribution ${n} sign`} value={term.sign} onChange={(e) => onChange({ ...term, sign: Number(e.target.value) as 1 | -1 })}>
      <option value={1}>+ add</option>
      <option value={-1}>− subtract</option>
    </select>
  );
  const varSelect = (v: string, set: (x: string) => void) => (
    <select aria-label={`Contribution ${n} input`} value={v} onChange={(e) => set(e.target.value)}>
      {decls.map((d) => (
        <option key={d.variable} value={d.variable}>
          {d.variable} ({sourceLabel(d.source)})
        </option>
      ))}
      {decls.some((d) => d.variable === v) ? null : <option value={v}>{v}</option>}
    </select>
  );
  const number = (lbl: string, v: number, set: (x: number) => void) => <input aria-label={`Contribution ${n} ${lbl}`} id={`${idBase}-${lbl}`} type="number" step="any" value={v} onChange={(e) => e.target.value !== "" && set(Number(e.target.value))} />;
  switch (term.kind) {
    case "CONSTANT":
      return (
        <span className="prowess-formula__term-body">
          {sign} constant {number("value", term.value, (value) => onChange({ ...term, value }))}
        </span>
      );
    case "INPUT":
      return (
        <span className="prowess-formula__term-body">
          {sign} {varSelect(term.variable, (variable) => onChange({ ...term, variable }))}
        </span>
      );
    case "SCALED":
      return (
        <span className="prowess-formula__term-body">
          {sign} {number("multiplier", term.factor, (factor) => onChange({ ...term, factor }))} × {varSelect(term.variable, (variable) => onChange({ ...term, variable }))}
        </span>
      );
    case "DIVIDED":
      return (
        <span className="prowess-formula__term-body">
          {sign}
          <select aria-label={`Contribution ${n} rounding`} value={term.rounding ?? ""} onChange={(e) => onChange({ ...term, rounding: e.target.value === "" ? null : (e.target.value as "floor" | "ceil") })}>
            <option value="floor">round down</option>
            <option value="ceil">round up</option>
            <option value="">exact</option>
          </select>
          {varSelect(term.variable, (variable) => onChange({ ...term, variable }))} ÷ {number("divisor", term.divisor, (divisor) => onChange({ ...term, divisor }))}
        </span>
      );
    case "OTHER":
      return (
        <span className="prowess-formula__term-body">
          {sign} <code>{termExpression({ ...term, sign: 1 })}</code> <span className="gov-muted">(edit as an advanced expression)</span>
        </span>
      );
  }
}

function SourcePicker({ catalog, sourceKinds, value, label, onChoose }: { catalog: AuthoringCatalogDto; sourceKinds: readonly string[]; value: FormulaSourceDto; label: string; onChoose: (s: FormulaSourceDto) => void }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<FormulaSourceDto>(value);
  if (!open)
    return (
      <button type="button" className="gov-link-button" onClick={() => setOpen(true)}>
        {label}
      </button>
    );
  return (
    <span className="prowess-formula__source" role="group" aria-label={label}>
      <SourceFields catalog={catalog} sourceKinds={sourceKinds} value={draft} onChange={setDraft} label={label} />
      <button
        type="button"
        className="gov-button"
        onClick={() => {
          onChoose(draft);
          setOpen(false);
        }}
        disabled={!sourceComplete(draft)}
      >
        Apply
      </button>
      <button type="button" className="gov-link-button" onClick={() => setOpen(false)}>
        Cancel
      </button>
    </span>
  );
}

export const sourceComplete = (s: FormulaSourceDto) => s.kind !== "" && (s.kind !== "STAT" || typeof s.stat === "string") && (s.kind !== "DERIVED" || typeof s.statistic === "string") && (s.kind !== "CHARACTER" || typeof s.field === "string");

function SourceFields({ catalog, sourceKinds, value, onChange, label }: { catalog: AuthoringCatalogDto; sourceKinds: readonly string[]; value: FormulaSourceDto; onChange: (s: FormulaSourceDto) => void; label: string }) {
  const kinds = sourceKinds.filter((k) => (catalog.vocabularies.formulaSourceKinds ?? []).includes(k));
  return (
    <>
      <select aria-label={`${label}: source`} value={value.kind} onChange={(e) => onChange({ kind: e.target.value })}>
        <option value="">Choose a source…</option>
        {kinds.map((k) => (
          <option key={k} value={k}>
            {formatEnumLabel(k)}
          </option>
        ))}
      </select>
      {value.kind === "STAT" ? (
        <select aria-label={`${label}: Stat`} value={value.stat ?? ""} onChange={(e) => onChange({ kind: "STAT", stat: e.target.value })}>
          <option value="">Choose a Stat…</option>
          {(catalog.vocabularies.prowessStats ?? []).map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      ) : null}
      {value.kind === "DERIVED" ? (
        <select aria-label={`${label}: derived statistic`} value={value.statistic ?? ""} onChange={(e) => onChange({ kind: "DERIVED", statistic: e.target.value })}>
          <option value="">Choose a statistic…</option>
          {(catalog.vocabularies.derivedStatistics ?? []).map((s) => (
            <option key={s} value={s}>
              {formatEnumLabel(s)}
            </option>
          ))}
        </select>
      ) : null}
      {value.kind === "CHARACTER" ? (
        <select aria-label={`${label}: Character value`} value={value.field ?? ""} onChange={(e) => onChange({ kind: "CHARACTER", field: e.target.value })}>
          <option value="">Choose a value…</option>
          {(catalog.vocabularies.characterFields ?? []).map((s) => (
            <option key={s} value={s}>
              {formatEnumLabel(s)}
            </option>
          ))}
        </select>
      ) : null}
    </>
  );
}

function AddContribution({ sourceKinds, catalog, decls, onAdd }: { sourceKinds: readonly string[]; catalog: AuthoringCatalogDto; decls: readonly Decl[]; onAdd: (t: FormulaTerm, d: Decl | null) => void }) {
  const [shape, setShape] = useState<"INPUT" | "DIVIDED" | "SCALED" | "CONSTANT">("DIVIDED");
  const [source, setSource] = useState<FormulaSourceDto>({ kind: "" });
  const [number, setNumber] = useState("3");
  const [sign, setSign] = useState<1 | -1>(1);
  const add = () => {
    const n = Number(number);
    if (shape === "CONSTANT") return onAdd({ sign, kind: "CONSTANT", value: n }, null);
    const existing = decls.find((d) => JSON.stringify(d.source) === JSON.stringify(source));
    const variable = existing?.variable ?? variableNameFor(source, decls.map((d) => d.variable));
    const decl = existing === undefined ? { variable, source } : null;
    if (shape === "INPUT") onAdd({ sign, kind: "INPUT", variable }, decl);
    else if (shape === "SCALED") onAdd({ sign, kind: "SCALED", variable, factor: n }, decl);
    else onAdd({ sign, kind: "DIVIDED", variable, divisor: n, rounding: "floor" }, decl);
  };
  const ready = shape === "CONSTANT" ? number !== "" && Number.isFinite(Number(number)) : sourceComplete(source) && (shape === "INPUT" || (number !== "" && Number.isFinite(Number(number))));
  return (
    <fieldset className="prowess-authoring__nested" data-testid="formula-add">
      <legend>Add a contribution</legend>
      <select aria-label="New contribution sign" value={sign} onChange={(e) => setSign(Number(e.target.value) as 1 | -1)}>
        <option value={1}>+ add</option>
        <option value={-1}>− subtract</option>
      </select>
      <select aria-label="New contribution shape" value={shape} onChange={(e) => setShape(e.target.value as typeof shape)}>
        <option value="DIVIDED">an input ÷ a number, rounded down</option>
        <option value="SCALED">a number × an input</option>
        <option value="INPUT">an input as it is</option>
        <option value="CONSTANT">a constant number</option>
      </select>
      {shape !== "CONSTANT" ? <SourceFields catalog={catalog} sourceKinds={sourceKinds} value={source} onChange={setSource} label="New contribution" /> : null}
      {shape !== "INPUT" ? <input aria-label={shape === "DIVIDED" ? "New contribution divisor" : shape === "SCALED" ? "New contribution multiplier" : "New contribution value"} type="number" step="any" value={number} onChange={(e) => setNumber(e.target.value)} /> : null}
      <button type="button" className="gov-button" onClick={add} disabled={!ready}>
        Add contribution
      </button>
    </fieldset>
  );
}
