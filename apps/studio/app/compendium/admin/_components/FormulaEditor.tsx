"use client";

import { formatEnumLabel } from "@prowess/ui";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { AuthoringCatalogDto } from "../_lib/authoring-client";
import { composeFormula, describeFormula, nameFormulaInput, renameFormulaInput, type FormulaDescriptionDto, type FormulaSourceDto, type FormulaTermDto } from "../_lib/rules-client";

/**
 * PRE-M7-WO1 — guided editor for an authored core Formula (`{ expression, rounding, minimum, maximum, unit, variables }`).
 *
 * The Studio never parses, prints or evaluates a Formula: every view and every rebuild comes from the server
 * (POST /api/compendium-rules/formula, the M4 parser). Contributions view: the expression's top-level terms with ordinary
 * controls — sign, number, input, divisor and rounding — plus Add / Remove. Inputs view: each declared variable and its
 * exact source; "Replace input" renames the variable everywhere through the parsed AST and re-declares it, so the rest of
 * the expression is untouched. Advanced: the raw expression, re-described by the server as it is typed. Guided edits
 * never drop data: every other Formula field is copied through, declarations the expression no longer reads are removed
 * only because the M5 contract refuses them, and an expression the contributions view cannot represent losslessly is
 * never rewritten (Advanced only). Legality is decided by the server's M5 validation; values come from the preview.
 */
type Formula = Record<string, unknown> & { expression?: unknown; rounding?: unknown; minimum?: unknown; maximum?: unknown; unit?: unknown; variables?: unknown };
type Decl = { variable: string; source: FormulaSourceDto };

const asDecls = (v: unknown): Decl[] => (Array.isArray(v) ? (v.filter((d) => d !== null && typeof d === "object") as Decl[]) : []);

/** The one extra value some source kinds carry, and the catalog vocabulary it is chosen from (structure, not values). */
const SOURCE_DETAIL: Readonly<Record<string, { readonly key: "stat" | "statistic" | "field" | "parameter" | "table"; readonly vocabulary: string; readonly prompt: string }>> = {
  STAT: { key: "stat", vocabulary: "prowessStats", prompt: "Stat" },
  // RULES-WO1 Phase G: a Targeting distance may read one of the component's own size choices (offered by the caller).
  PARAMETER: { key: "parameter", vocabulary: "formulaParameterChoices", prompt: "size choice" },
  DERIVED: { key: "statistic", vocabulary: "derivedStatistics", prompt: "derived statistic" },
  // RULES-WO1 Phase H: a Targeting Skill-rank table, and a construction / policy Formula's fixed input (offered by the caller).
  SKILL_RANK_TABLE: { key: "table", vocabulary: "formulaTableChoices", prompt: "rank table" },
  CONSTRUCTION_INPUT: { key: "field", vocabulary: "formulaInputChoices", prompt: "input" },
  CHARACTER: { key: "field", vocabulary: "characterFields", prompt: "Character value" },
};
/** RULES-WO1: a one-input Formula that reads one Stat as it is (used to start a new value from a Stat page). */
export function statFormula(stat: string): Formula {
  const kind = Object.entries(SOURCE_DETAIL).find(([, d]) => d.key === "stat")?.[0] ?? "";
  const variable = stat.toLowerCase();
  return { expression: variable, rounding: "", minimum: null, maximum: null, unit: null, variables: [{ variable, source: { kind, stat } }] };
}
export const sourceComplete = (s: FormulaSourceDto) => {
  const detail = SOURCE_DETAIL[s.kind];
  return s.kind !== "" && (detail === undefined || (typeof s[detail.key] === "string" && s[detail.key] !== ""));
};
const sameSource = (a: FormulaSourceDto, b: FormulaSourceDto) => a.kind === b.kind && a.stat === b.stat && a.statistic === b.statistic && a.field === b.field && a.parameter === b.parameter && a.table === b.table;
const messageOf = (e: unknown) => (e instanceof Error && e.message ? e.message : "The Formula service could not be reached.");

export function FormulaEditor({ value, onChange, catalog, sourceKinds, label, ownStatistic, noMaximum = false, variableStyle, noUnit = false, expressionOnly = false }: { value: unknown; onChange: (v: Formula) => void; catalog: AuthoringCatalogDto; sourceKinds: readonly string[]; label: string; ownStatistic?: string | null; /** RULES-WO1 Phase G: a contract with no maximum (a Targeting distance). */ noMaximum?: boolean; /** RULES-WO1 Phase G: input names in lowerCamel (an Effect formula). */ variableStyle?: "camel"; /** RULES-WO1 Phase H: a contract with no unit (construction / policy Formulas). */ noUnit?: boolean; /** RULES-WO1 Phase H: only the expression and its inputs (an engine policy Formula: no rounding, bounds or unit). */ expressionOnly?: boolean }) {
  const base = useId();
  const formula: Formula = value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Formula) : {};
  const expression = typeof formula.expression === "string" ? formula.expression : "";
  const decls = asDecls(formula.variables);
  const sources = decls.map((d) => d.source);
  const sourcesKey = JSON.stringify(sources);
  const [desc, setDesc] = useState<FormulaDescriptionDto | null>(null);
  /** RULES-WO1 Phase G: which expression + inputs `desc` describes — contributions are edited only from a current reading. */
  const [described, setDescribed] = useState<string | null>(null);
  const [mode, setMode] = useState<"GUIDED" | "ADVANCED" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const latest = useRef(0);
  const set = (patch: Partial<Formula>) => onChange({ ...formula, ...patch });

  // The server describes the current expression (debounced while typing). Stale answers are ignored.
  const refresh = useCallback(async (expr: string, srcs: readonly FormulaSourceDto[]) => {
    const ticket = ++latest.current;
    try {
      const d = await describeFormula(expr, srcs);
      if (ticket !== latest.current) return;
      setDesc(d);
      setDescribed(`${expr}\n${JSON.stringify(srcs)}`);
      setMode((m) => m ?? (d.guided.ok ? "GUIDED" : "ADVANCED"));
    } catch (e) {
      if (ticket === latest.current) setMessage(messageOf(e));
    }
  }, []);
  useEffect(() => {
    const t = setTimeout(() => void refresh(expression, JSON.parse(sourcesKey) as FormulaSourceDto[]), 150);
    return () => clearTimeout(t);
  }, [expression, sourcesKey, refresh]);

  // A contribution edit rebuilt from an out-of-date reading would silently drop the last change (e.g. two quick adds).
  const stale = described !== `${expression}\n${sourcesKey}`;
  const guided = desc?.guided ?? null;
  const terms = guided !== null && guided.ok ? guided.terms : null;
  const labelOf = (variable: string) => {
    const i = decls.findIndex((d) => d.variable === variable);
    return i < 0 ? "no source" : (desc?.sourceLabels[i] ?? "");
  };

  /** Rebuilds the expression from terms on the server and keeps exactly the declarations it reads (adding `add`). */
  const commitTerms = async (next: readonly FormulaTermDto[], add: readonly Decl[] = []) => {
    setBusy(true);
    try {
      const all = [...decls, ...add.filter((a) => !decls.some((d) => d.variable === a.variable))];
      const out = await composeFormula(next, all.map((d) => d.source));
      if (!out.ok) {
        setMessage(`Not applied: ${out.reason}`);
        return;
      }
      setMessage(null);
      set({ expression: out.expression, variables: (out.variables ?? []).map((v) => all.find((d) => d.variable === v) ?? { variable: v, source: { kind: "" } }) });
    } catch (e) {
      setMessage(messageOf(e));
    } finally {
      setBusy(false);
    }
  };
  const replaceTerm = (i: number, t: FormulaTermDto) => terms !== null && !stale && void commitTerms(terms.map((x, j) => (j === i ? t : x)));
  const removeTerm = (i: number) => terms !== null && !stale && void commitTerms(terms.filter((_, j) => j !== i));

  const replaceInput = async (variable: string, source: FormulaSourceDto) => {
    setBusy(true);
    try {
      const { variable: next } = await nameFormulaInput(source, decls.filter((d) => d.variable !== variable).map((d) => d.variable), variableStyle);
      const nextDecls = decls.map((d) => (d.variable === variable ? { variable: next, source } : d));
      const out = await renameFormulaInput(expression, variable, next, nextDecls.map((d) => d.source));
      if (!out.ok) {
        setMessage(out.reason);
        return;
      }
      setMessage(null);
      set({ expression: out.expression, variables: nextDecls });
    } catch (e) {
      setMessage(messageOf(e));
    } finally {
      setBusy(false);
    }
  };

  const addContribution = async (shape: Shape, sign: 1 | -1, n: number, source: FormulaSourceDto, second: FormulaSourceDto) => {
    if (terms === null || stale) return;
    const kept = terms.filter((t) => !(t.kind === "CONSTANT" && t.value === 0));
    if (shape === "CONSTANT") return commitTerms([...kept, { sign, kind: "CONSTANT", value: n }]);
    const added: Decl[] = [];
    // The input a source is read through: an existing declaration, else a new readable name from the server.
    const variableOf = async (s: FormulaSourceDto): Promise<string | null> => {
      const existing = [...decls, ...added].find((d) => sameSource(d.source, s));
      if (existing !== undefined) return existing.variable;
      try {
        const v = (await nameFormulaInput(s, [...decls, ...added].map((d) => d.variable), variableStyle)).variable;
        added.push({ variable: v, source: s });
        return v;
      } catch (e) {
        setMessage(messageOf(e));
        return null;
      }
    };
    const variable = await variableOf(source);
    if (variable === null) return;
    if (shape === "PRODUCT") {
      const other = await variableOf(second);
      if (other === null) return;
      return commitTerms([...kept, { sign, kind: "PRODUCT", variable, other }], added);
    }
    const term: FormulaTermDto = shape === "INPUT" ? { sign, kind: "INPUT", variable } : shape === "SCALED" ? { sign, kind: "SCALED", variable, factor: n } : { sign, kind: "DIVIDED", variable, divisor: n, rounding: "floor" };
    return commitTerms([...kept, term], added);
  };

  const ownRef = ownStatistic ? decls.some((d) => d.source.statistic === ownStatistic) : false;
  const parse = desc?.parse ?? null;

  return (
    <div className="prowess-formula" data-testid="formula-editor" aria-busy={busy || desc === null}>
      <div className="prowess-formula__summary">
        <span className="gov-muted">{label}</span>
        <code data-testid="formula-expression">{expression === "" ? "(empty)" : expression}</code>
      </div>
      <div role="group" aria-label={`${label}: editing mode`} className="prowess-formula__modes">
        <button type="button" aria-pressed={mode === "GUIDED"} disabled={terms === null} onClick={() => setMode("GUIDED")}>
          Contributions
        </button>
        <button type="button" aria-pressed={mode === "ADVANCED"} onClick={() => setMode("ADVANCED")}>
          Advanced expression
        </button>
      </div>
      {desc === null ? <p className="gov-muted" role="status">Reading the formula…</p> : null}
      {guided !== null && !guided.ok ? (
        <p className="gov-muted" data-testid="formula-guided-unavailable">
          The contributions view is not available for this expression ({guided.reason}). It is kept exactly as written; edit it as an advanced expression.
        </p>
      ) : null}

      {mode === "GUIDED" && terms !== null ? (
        <div>
          <ol className="prowess-formula__terms" aria-label={`${label}: contributions`}>
            {terms.map((t, i) => (
              <li key={i} className="prowess-formula__term" data-testid="formula-term" data-kind={t.kind}>
                <TermControls index={i} term={t} decls={decls} labelOf={labelOf} onChange={(nt) => replaceTerm(i, nt)} idBase={`${base}-${i}`} disabled={busy || stale} />
                <button type="button" className="gov-link-button" disabled={busy || stale} onClick={() => removeTerm(i)} aria-label={`Remove contribution ${i + 1} (${t.text ?? ""})`}>
                  Remove
                </button>
              </li>
            ))}
          </ol>
          {terms.length === 0 || expression.trim() === "0" ? <p className="gov-muted">No contributions: this rule&apos;s value is the constant 0 (a valid, neutral rule — the statistic still exists).</p> : null}
          <AddContribution sourceKinds={sourceKinds} catalog={catalog} disabled={busy || stale} onAdd={(shape, sign, n, source, second) => void addContribution(shape, sign, n, source, second)} />
        </div>
      ) : null}

      {mode === "ADVANCED" ? (
        <label className="gov-field">
          <span>{label}: expression (M4 safe formula — numbers, inputs, + − × ÷, parentheses, floor / ceil / min / max)</span>
          <input value={expression} onChange={(e) => set({ expression: e.target.value })} spellCheck={false} autoComplete="off" aria-invalid={(parse !== null && !parse.ok) || undefined} data-testid="formula-advanced-input" />
          {parse !== null && !parse.ok ? (
            <span className="gov-error" role="status" data-testid="formula-parse-error">
              {parse.problem}
            </span>
          ) : null}
        </label>
      ) : null}

      <fieldset className="prowess-authoring__nested">
        <legend>Inputs this rule reads</legend>
        {decls.length === 0 ? <p className="gov-muted">None.</p> : null}
        <ul className="prowess-formula__inputs" aria-label={`${label}: inputs`}>
          {decls.map((d, i) => (
            <li key={d.variable} data-testid="formula-input" data-variable={d.variable}>
              <code>{d.variable}</code> = {desc?.sourceLabels[i] ?? ""}{" "}
              <SourcePicker catalog={catalog} sourceKinds={sourceKinds} value={d.source} label={`Replace input ${d.variable}`} disabled={busy} onChoose={(s) => void replaceInput(d.variable, s)} />
            </li>
          ))}
        </ul>
        {parse !== null && parse.ok
          ? parse.variables
              .filter((v) => !decls.some((d) => d.variable === v))
              .map((v) => (
                <div key={v} className="gov-field">
                  <span className="gov-error">“{v}” is used but has no declared source.</span>
                  <SourcePicker catalog={catalog} sourceKinds={sourceKinds} value={{ kind: "" }} label={`Declare ${v}`} disabled={busy} onChoose={(s) => set({ variables: [...decls, { variable: v, source: s }] })} />
                </div>
              ))
          : null}
      </fieldset>

      {expressionOnly ? null : <div className="prowess-formula__settings">
        <label className="gov-field">
          <span>Rounding of the result</span>
          <select value={typeof formula.rounding === "string" ? formula.rounding : ""} onChange={(e) => set({ rounding: e.target.value })}>
            <option value="">Choose…</option>
            {(catalog.vocabularies.formulaRoundings ?? []).map((r) => (
              <option key={r} value={r}>
                {formatEnumLabel(r)}
              </option>
            ))}
          </select>
        </label>
        <NullableNumber label="Minimum result (optional)" value={formula.minimum} onChange={(v) => set({ minimum: v })} />
        {noMaximum ? null : <NullableNumber label="Maximum result (optional)" value={formula.maximum} onChange={(v) => set({ maximum: v })} />}
        {noUnit ? null : <label className="gov-field">
          <span>Unit (optional, e.g. ft)</span>
          <input value={typeof formula.unit === "string" ? formula.unit : ""} onChange={(e) => set({ unit: e.target.value === "" ? null : e.target.value })} spellCheck={false} />
        </label>}
      </div>}
      {(desc?.hazards ?? []).map((h) => (
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

function TermControls({ index, term, decls, labelOf, onChange, idBase, disabled }: { index: number; term: FormulaTermDto; decls: readonly Decl[]; labelOf: (v: string) => string; onChange: (t: FormulaTermDto) => void; idBase: string; disabled: boolean }) {
  const n = index + 1;
  const sign = (
    <select aria-label={`Contribution ${n} sign`} disabled={disabled} value={term.sign} onChange={(e) => onChange({ ...term, sign: Number(e.target.value) as 1 | -1 })}>
      <option value={1}>+ add</option>
      <option value={-1}>− subtract</option>
    </select>
  );
  const varSelect = (v: string, set: (x: string) => void, which = "input") => (
    <select aria-label={`Contribution ${n} ${which}`} disabled={disabled} value={v} onChange={(e) => set(e.target.value)}>
      {decls.map((d) => (
        <option key={d.variable} value={d.variable}>
          {d.variable} ({labelOf(d.variable)})
        </option>
      ))}
      {decls.some((d) => d.variable === v) ? null : <option value={v}>{v}</option>}
    </select>
  );
  const number = (lbl: string, v: number, set: (x: number) => void) => <input aria-label={`Contribution ${n} ${lbl}`} id={`${idBase}-${lbl}`} type="number" step="any" disabled={disabled} defaultValue={v} onBlur={(e) => e.target.value !== "" && Number(e.target.value) !== v && set(Number(e.target.value))} />;
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
    case "PRODUCT":
      return (
        <span className="prowess-formula__term-body">
          {sign} {varSelect(term.variable, (variable) => onChange({ ...term, variable }))} × {varSelect(term.other, (other) => onChange({ ...term, other }), "second input")}
        </span>
      );
    case "DIVIDED":
      return (
        <span className="prowess-formula__term-body">
          {sign}
          <select aria-label={`Contribution ${n} rounding`} disabled={disabled} value={term.rounding ?? ""} onChange={(e) => onChange({ ...term, rounding: e.target.value === "" ? null : (e.target.value as "floor" | "ceil") })}>
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
          {sign} <code>{term.text}</code> <span className="gov-muted">(edit as an advanced expression)</span>
        </span>
      );
  }
}

function SourcePicker({ catalog, sourceKinds, value, label, onChoose, disabled }: { catalog: AuthoringCatalogDto; sourceKinds: readonly string[]; value: FormulaSourceDto; label: string; onChoose: (s: FormulaSourceDto) => void; disabled: boolean }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<FormulaSourceDto>(value);
  if (!open)
    return (
      <button type="button" className="gov-link-button" disabled={disabled} onClick={() => setOpen(true)}>
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


function SourceFields({ catalog, sourceKinds, value, onChange, label }: { catalog: AuthoringCatalogDto; sourceKinds: readonly string[]; value: FormulaSourceDto; onChange: (s: FormulaSourceDto) => void; label: string }) {
  const kinds = sourceKinds.filter((k) => [...(catalog.vocabularies.formulaSourceKinds ?? []), ...(catalog.vocabularies.valueInputKinds ?? []), ...(catalog.vocabularies.formulaExtraSourceKinds ?? [])].includes(k));
  return (
    <>
      <select aria-label={`${label}: source`} value={value.kind} onChange={(e) => onChange({ kind: e.target.value })}>
        <option value="">Choose a source…</option>
        {kinds.map((k) => (
          <option key={k} value={k}>
            {SOURCE_DETAIL[k]?.key === "parameter" ? "One of this component's size choices" : formatEnumLabel(k)}
          </option>
        ))}
      </select>
      {SOURCE_DETAIL[value.kind] !== undefined ? <SourceDetail catalog={catalog} value={value} onChange={onChange} label={label} /> : null}
    </>
  );
}

function SourceDetail({ catalog, value, onChange, label }: { catalog: AuthoringCatalogDto; value: FormulaSourceDto; onChange: (s: FormulaSourceDto) => void; label: string }) {
  const detail = SOURCE_DETAIL[value.kind]!;
  return (
    <select aria-label={`${label}: ${detail.prompt}`} value={value[detail.key] ?? ""} onChange={(e) => onChange({ kind: value.kind, [detail.key]: e.target.value })}>
      <option value="">Choose a {detail.prompt}…</option>
      {(catalog.vocabularies[detail.vocabulary] ?? []).map((s) => (
        <option key={s} value={s}>
          {detail.key === "parameter" ? s.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase() : formatEnumLabel(s)}
        </option>
      ))}
    </select>
  );
}

type Shape = "INPUT" | "DIVIDED" | "SCALED" | "PRODUCT" | "CONSTANT";
function AddContribution({ sourceKinds, catalog, onAdd, disabled }: { sourceKinds: readonly string[]; catalog: AuthoringCatalogDto; onAdd: (shape: Shape, sign: 1 | -1, n: number, source: FormulaSourceDto, second: FormulaSourceDto) => void; disabled: boolean }) {
  const [shape, setShape] = useState<Shape>("DIVIDED");
  const [source, setSource] = useState<FormulaSourceDto>({ kind: "" });
  const [second, setSecond] = useState<FormulaSourceDto>({ kind: "" });
  const [number, setNumber] = useState("3");
  const [sign, setSign] = useState<1 | -1>(1);
  const add = () => onAdd(shape, sign, Number(number), source, second);
  const ready = shape === "CONSTANT" ? number !== "" && Number.isFinite(Number(number)) : shape === "PRODUCT" ? sourceComplete(source) && sourceComplete(second) : sourceComplete(source) && (shape === "INPUT" || (number !== "" && Number.isFinite(Number(number))));
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
        <option value="PRODUCT">an input × another input</option>
        <option value="INPUT">an input as it is</option>
        <option value="CONSTANT">a constant number</option>
      </select>
      {shape !== "CONSTANT" ? <SourceFields catalog={catalog} sourceKinds={sourceKinds} value={source} onChange={setSource} label="New contribution" /> : null}
      {shape === "PRODUCT" ? <SourceFields catalog={catalog} sourceKinds={sourceKinds} value={second} onChange={setSecond} label="Multiplied by" /> : null}
      {shape !== "INPUT" && shape !== "PRODUCT" ? <input aria-label={shape === "DIVIDED" ? "New contribution divisor" : shape === "SCALED" ? "New contribution multiplier" : "New contribution value"} type="number" step="any" value={number} onChange={(e) => setNumber(e.target.value)} /> : null}
      <button type="button" className="gov-button" onClick={add} disabled={!ready || disabled}>
        Add contribution
      </button>
    </fieldset>
  );
}
