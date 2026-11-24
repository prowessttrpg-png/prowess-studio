"use client";

import { useId, useState } from "react";
import type { AuthoringCatalogDto } from "../_lib/authoring-client";
import { REQUIREMENT_SHAPES, asObject, asParameterName, parameterWords, shapeOf, tokenOf, tokenWords } from "../_lib/component-mechanics";
import { asToken } from "../_lib/token-input";
import { FormulaEditor } from "./FormulaEditor";

/**
 * RULES-WO1 Phase H — guided controls for the remaining established mechanics that used to need technical fields or
 * syntax: construction / policy Formulas over fixed inputs, how a roll's natural result is read, written rule notes
 * (never executed), an Action Improvement's play-time condition and an open-question reference. Every stored value the
 * control cannot show is kept unchanged and shown as such.
 */
type Obj = Record<string, unknown>;
/** The formula-guide source kind for a construction / policy Formula's fixed input (its name is the variable). */
const FIXED_INPUT = "CONSTRUCTION_INPUT";

/**
 * A Formula over a slot's fixed inputs (for example "base effects" and "trades"), composed from contributions by the
 * server. Stored exactly as the contract reads it: `{ expression, variables }` plus rounding / minimum where the slot has
 * them. `allInputs`: the slot always declares every input, in order (engine policy Formulas).
 */
export function FixedInputFormula({ value, onChange, catalog, inputs, allInputs = false, expressionOnly = false, label }: { value: unknown; onChange: (v: Obj) => void; catalog: AuthoringCatalogDto; inputs: readonly string[]; allInputs?: boolean; expressionOnly?: boolean; label: string }) {
  const stored = asObject(value);
  const variables = Array.isArray(stored.variables) ? (stored.variables as string[]) : [];
  const asFormula = { ...stored, expression: typeof stored.expression === "string" ? stored.expression : "0", variables: variables.map((v) => ({ variable: v, source: { kind: FIXED_INPUT, field: v } })) };
  const extended: AuthoringCatalogDto = { ...catalog, vocabularies: { ...catalog.vocabularies, formulaExtraSourceKinds: [FIXED_INPUT], formulaInputChoices: [...inputs] } };
  return (
    <div data-testid={`fixed-formula-${label.replace(/\W+/g, "-").toLowerCase()}`}>
      <p className="gov-muted">Reads: {inputs.map((i) => i.replace(/_/g, " ")).join(", ")}.</p>
      <FormulaEditor
        value={asFormula}
        catalog={extended}
        sourceKinds={[FIXED_INPUT]}
        label={label}
        noMaximum
        noUnit
        expressionOnly={expressionOnly}
        onChange={(v) => {
          const used = (Array.isArray(v.variables) ? (v.variables as Array<{ variable: string }>) : []).map((d) => d.variable);
          const next: Obj = { ...stored, expression: v.expression, variables: allInputs ? [...inputs] : used };
          if (!expressionOnly) {
            if (v.rounding !== undefined) next.rounding = v.rounding;
            if (v.minimum !== undefined) next.minimum = v.minimum;
          }
          delete next.maximum;
          delete next.unit;
          onChange(next);
        }}
      />
    </div>
  );
}

/**
 * How the natural result is read from the dice, for each roll mode: the die as rolled, or the higher / lower of two.
 * Built from the roll mode's natural rolls (catalog); an expression written some other way is kept and shown.
 */
export function NaturalSelectionEditor({ value, onChange, catalog, allowNone, testId }: { value: unknown; onChange: (v: unknown) => void; catalog: AuthoringCatalogDto; allowNone: boolean; testId: string }) {
  const modes = catalog.vocabularies.rollModes ?? [];
  const none = value === null;
  const obj = asObject(value);
  const choicesFor = (mode: string): Array<{ label: string; expression: string }> => {
    const rolls = catalog.fixedLists?.[`naturalRolls:${mode}`] ?? [];
    if (rolls.length === 1) return [{ label: "The die as rolled", expression: rolls[0]! }];
    if (rolls.length === 2) return [{ label: "The higher of the two dice", expression: `max(${rolls[0]}, ${rolls[1]})` }, { label: "The lower of the two dice", expression: `min(${rolls[0]}, ${rolls[1]})` }];
    return [];
  };
  const initial = () => Object.fromEntries(modes.map((m) => [m, { expression: choicesFor(m)[0]?.expression ?? "" }]));
  return (
    <div data-testid={testId}>
      {allowNone ? (
        <label className="prowess-authoring__check">
          <input type="checkbox" data-testid={`${testId}-none`} checked={none} onChange={(e) => onChange(e.target.checked ? null : initial())} /> This procedure rolls no dice
        </label>
      ) : null}
      {none
        ? null
        : modes.map((mode) => {
            const current = asObject(obj[mode]);
            const expression = typeof current.expression === "string" ? current.expression : "";
            const choices = choicesFor(mode);
            const known = choices.some((c) => c.expression === expression);
            return (
              <span key={mode} className="gov-field">
                <label htmlFor={`${testId}-${mode}`}>{tokenWords(mode)}</label>
                <select id={`${testId}-${mode}`} data-testid={`${testId}-${mode}`} value={known ? expression : ""} onChange={(e) => onChange({ ...obj, [mode]: { ...current, expression: e.target.value } })}>
                  {known ? null : <option value="">{expression === "" ? "Choose…" : "Kept as written (see below)"}</option>}
                  {choices.map((c) => (
                    <option key={c.expression} value={c.expression}>
                      {c.label}
                    </option>
                  ))}
                </select>
                {!known && expression !== "" ? (
                  <span className="gov-muted" data-testid={`${testId}-${mode}-kept`}>
                    Written as <code>{expression}</code> — kept unchanged unless you choose above.
                  </span>
                ) : null}
              </span>
            );
          })}
    </div>
  );
}

/**
 * Written rule notes: a heading in plain words and its text. They are carried with the Definition but never executed.
 * A stored note that is not plain text is kept and listed as such.
 */
export function WrittenNotesEditor({ value, onChange, testId, label }: { value: unknown; onChange: (v: Obj) => void; testId: string; label: string }) {
  const obj = asObject(value);
  const entries = Object.entries(obj);
  const text = entries.filter(([, v]) => typeof v === "string") as Array<[string, string]>;
  const kept = entries.filter(([, v]) => typeof v !== "string");
  const [heading, setHeading] = useState("");
  const id = useId();
  const replaceKey = (from: string, to: string) => onChange(Object.fromEntries(entries.map(([k, v]) => (k === from ? [to, v] : [k, v]))));
  return (
    <div data-testid={testId}>
      <p className="gov-muted">Written for readers and the GM; play does not run these notes.</p>
      {text.length === 0 ? <p className="gov-muted">No {label.toLowerCase()}.</p> : null}
      {text.map(([k, v], i) => (
        <div key={k} className="prowess-authoring__card" data-testid={`${testId}-${i}`}>
          <span className="gov-field">
            <label htmlFor={`${id}-${i}-h`}>Heading</label>
            <input id={`${id}-${i}-h`} data-testid={`${testId}-${i}-heading`} defaultValue={tokenWords(k)} onBlur={(e) => { const t = asToken(e.target.value, true); if (t !== "" && t !== k && !(t in obj)) replaceKey(k, t); }} autoComplete="off" />
          </span>
          <span className="gov-field">
            <label htmlFor={`${id}-${i}-t`}>Text</label>
            <textarea id={`${id}-${i}-t`} data-testid={`${testId}-${i}-text`} value={v} onChange={(e) => onChange({ ...obj, [k]: e.target.value })} />
          </span>
          <button type="button" className="gov-link-button" onClick={() => onChange(Object.fromEntries(entries.filter(([x]) => x !== k)))}>
            Remove this note
          </button>
        </div>
      ))}
      {kept.length > 0 ? (
        <p className="gov-muted" data-testid={`${testId}-kept`}>
          Also stored (kept unchanged): {kept.map(([k]) => tokenWords(k)).join(", ")}.
        </p>
      ) : null}
      <span className="gov-field">
        <label htmlFor={`${id}-new`}>New note heading</label>
        <input id={`${id}-new`} data-testid={`${testId}-new`} value={heading} onChange={(e) => setHeading(e.target.value)} autoComplete="off" />
      </span>
      <button
        type="button"
        className="gov-button"
        data-testid={`${testId}-add`}
        disabled={asToken(heading, true) === "" || asToken(heading, true) in obj}
        onClick={() => {
          onChange({ ...obj, [asToken(heading, true)]: "" });
          setHeading("");
        }}
      >
        Add a note
      </button>
    </div>
  );
}

/**
 * When an Action Improvement's modification applies: always, or only when a play-time check holds (named in plain words;
 * decided at use — no rule evaluates it before then). Another stored requirement is kept unchanged.
 */
export function PlayCheckEditor({ value, onChange, testId }: { value: unknown; onChange: (v: unknown) => void; testId: string }) {
  const node = asObject(value);
  const compare = tokenOf(REQUIREMENT_SHAPES, "compare");
  const simple = value !== null && value !== undefined && shapeOf(REQUIREMENT_SHAPES, node.kind) === "compare" && typeof node.factKey === "string" && node.factKey.startsWith("runtime.");
  const nested = value !== null && value !== undefined && !simple;
  const fact = simple ? String(node.factKey).slice("runtime.".length) : "";
  const expected = typeof node.expected === "number" ? node.expected : 1;
  const [typed, setTyped] = useState<string | null>(null);
  const write = (f: string, n: number) => onChange({ kind: compare, factKey: `runtime.${f}`, operator: ">=", expected: n });
  return (
    <div data-testid={testId} role="radiogroup" aria-label="When it applies">
      <label className="prowess-authoring__check">
        <input type="radio" name={`${testId}-mode`} data-testid={`${testId}-always`} checked={value === null || value === undefined} onChange={() => onChange(null)} /> Always
      </label>
      <label className="prowess-authoring__check">
        <input type="radio" name={`${testId}-mode`} data-testid={`${testId}-when`} checked={simple || nested} onChange={() => write("", 1)} /> Only when a play-time check holds
      </label>
      {nested ? (
        <p className="gov-muted" data-testid={`${testId}-kept`}>
          A nested requirement is stored; it is kept unchanged.
        </p>
      ) : null}
      {simple ? (
        <>
          <span className="gov-field">
            <label htmlFor={`${testId}-fact`}>What play checks (in plain words, for example has moved this turn)</label>
            <input id={`${testId}-fact`} data-testid={`${testId}-fact`} value={typed ?? parameterWords(fact)} onChange={(e) => { setTyped(e.target.value); write(asParameterName(e.target.value), expected); }} onBlur={() => setTyped(null)} autoComplete="off" />
          </span>
          <span className="gov-field">
            <label htmlFor={`${testId}-expected`}>At least</label>
            <input id={`${testId}-expected`} data-testid={`${testId}-expected`} type="number" min={0} value={expected} onChange={(e) => write(fact, Number.isFinite(Number(e.target.value)) ? Math.max(0, Math.trunc(Number(e.target.value))) : 1)} />
          </span>
          <p className="gov-muted">Decided when the Action is used; play records it and does not evaluate it yet.</p>
        </>
      ) : null}
    </div>
  );
}

/** An optional reference to an open rules question (for example M5-SC-044), typed in plain words ("M5 SC 044"). */
export function OpenQuestionInput({ value, onChange, testId, label }: { value: unknown; onChange: (v: string | null) => void; testId: string; label: string }) {
  const stored = typeof value === "string" ? value : "";
  const [typed, setTyped] = useState<string | null>(null);
  return (
    <span className="gov-field">
      <label htmlFor={testId}>{label}</label>
      <input
        id={testId}
        data-testid={testId}
        value={typed ?? stored.replace(/-/g, " ")}
        placeholder="for example M5 SC 044"
        onChange={(e) => {
          setTyped(e.target.value);
          const words = e.target.value.trim().toUpperCase().split(/[\s_-]+/).filter(Boolean);
          onChange(words.length === 0 ? null : words.join("-"));
        }}
        onBlur={() => setTyped(null)}
        autoComplete="off"
      />
    </span>
  );
}
