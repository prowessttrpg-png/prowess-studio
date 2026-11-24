"use client";

import { formatEnumLabel } from "@prowess/ui";
import type { AuthoringCatalogDto } from "../_lib/authoring-client";
import { SourceSectionPicker } from "./SourceSectionPicker";
import { asToken } from "../_lib/token-input";

/**
 * RULES-WO1 Phase C — guided editor for a whole MISSION_RULE payload. The shape decides which part exists: a die-range
 * table (rows of "from – to: result"), a Threat Clock (segments, visibility, escalation points), Intel uses or written
 * reference points. Switching the shape keeps the other parts' data only after the author confirms; the server's M5
 * reader decides legality (every roll covered exactly once, escalations inside the clock and in order).
 */
type Rule = Record<string, unknown> & { ruleKey?: unknown; shape?: unknown; source?: unknown };
type Row = { from: number | null; to: number | null; result: string };
type Escalation = { atSegment: number | null; text: string };
const obj = (v: unknown): Record<string, unknown> => (v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const arr = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
const num = (s: string): number | null => (s.trim() === "" || !Number.isFinite(Number(s)) ? null : Math.trunc(Number(s)));

/** Each shape's part is the payload field named after the shape in lower case (the M5 contract's rule). */
/** The payload part a shape fills: its name in camelCase (a roll table fills `rollTable`). */
const partOf = (shape: string) => shape.toLowerCase().replace(/_([a-z])/g, (_m, c: string) => c.toUpperCase());
const INITIAL: Record<string, unknown> = { rollTable: { dieCount: 1, dieFaces: 20, rows: [] }, clock: { segments: 6, visibility: "", advancesWhen: [], escalations: [] }, intel: { uses: [] }, points: [] };

function Lines({ value, onChange, label }: { value: unknown; onChange: (v: string[]) => void; label: string }) {
  const items = arr<string>(value);
  return (
    <label className="gov-field">
      <span>{label} (one per line)</span>
      <textarea rows={3} value={items.join("\n")} onChange={(e) => onChange(e.target.value.split("\n").filter((x) => x.trim() !== ""))} />
    </label>
  );
}

export function MissionRuleEditor({ value, onChange, catalog, shapesVocabulary = "missionRuleShapes" }: { value: unknown; onChange: (v: Rule) => void; catalog: AuthoringCatalogDto; shapesVocabulary?: string }) {
  const rule: Rule = obj(value);
  const shape = typeof rule.shape === "string" ? rule.shape : "";
  const set = (patch: Partial<Rule>) => onChange({ ...rule, ...patch });
  const shapes = catalog.vocabularies[shapesVocabulary] ?? [];
  const part = shape === "" ? "" : partOf(shape);
  const chooseShape = (next: string) => {
    const patch: Record<string, unknown> = { shape: next };
    for (const key of Object.keys(INITIAL)) patch[key] = key === partOf(next) ? (rule[key] ?? INITIAL[key]) : null;
    const dropped = shapes.filter((s) => s !== next && rule[partOf(s)] !== null && rule[partOf(s)] !== undefined);
    if (dropped.length > 0 && !window.confirm(`Switching to ${formatEnumLabel(next)} removes the ${dropped.map((s) => formatEnumLabel(s)).join(", ")} part. Continue?`)) return;
    set(patch);
  };
  const table = obj(rule.rollTable);
  const rows = arr<Row>(table.rows);
  const clock = obj(rule.clock);
  const escalations = arr<Escalation>(clock.escalations);
  return (
    <div data-testid="mission-rule-editor">
      <label className="gov-field">
        <span>Rule name used by other rules</span>
        <input value={typeof rule.ruleKey === "string" ? rule.ruleKey : ""} onChange={(e) => set({ ruleKey: asToken(e.target.value) })} onBlur={(e) => set({ ruleKey: asToken(e.target.value, true) })} placeholder="CONTRACT_CLAUSES" spellCheck={false} />
        <small className="gov-muted">Filled in from the Display Name; change it only if two rules would share a name.</small>
      </label>
      <label className="gov-field">
        <span>Kind of rule</span>
        <select value={shape} onChange={(e) => chooseShape(e.target.value)}>
          <option value="">Choose…</option>
          {shapes.map((s) => (
            <option key={s} value={s}>
              {formatEnumLabel(s)}
            </option>
          ))}
        </select>
      </label>

      {part === "rollTable" ? (
        <fieldset className="prowess-authoring__nested" data-testid="mission-table">
          <legend>Table</legend>
          <label className="gov-field">
            <span>Number of dice</span>
            <input type="number" min={1} value={typeof table.dieCount === "number" ? table.dieCount : ""} onChange={(e) => set({ rollTable: { ...table, dieCount: num(e.target.value) } })} />
          </label>
          <label className="gov-field">
            <span>Die faces</span>
            <input type="number" min={2} value={typeof table.dieFaces === "number" ? table.dieFaces : ""} onChange={(e) => set({ rollTable: { ...table, dieFaces: num(e.target.value) } })} />
          </label>
          <ol>
            {rows.map((r, i) => (
              <li key={i} className="prowess-authoring__row">
                <label className="gov-field">
                  <span>From</span>
                  <input aria-label={`Row ${i + 1} from`} type="number" value={r.from ?? ""} onChange={(e) => set({ rollTable: { ...table, rows: rows.map((x, j) => (j === i ? { ...x, from: num(e.target.value) } : x)) } })} />
                </label>
                <label className="gov-field">
                  <span>To</span>
                  <input aria-label={`Row ${i + 1} to`} type="number" value={r.to ?? ""} onChange={(e) => set({ rollTable: { ...table, rows: rows.map((x, j) => (j === i ? { ...x, to: num(e.target.value) } : x)) } })} />
                </label>
                <label className="gov-field">
                  <span>Result</span>
                  <input aria-label={`Row ${i + 1} result`} value={r.result ?? ""} onChange={(e) => set({ rollTable: { ...table, rows: rows.map((x, j) => (j === i ? { ...x, result: e.target.value } : x)) } })} />
                </label>
                <button type="button" className="gov-link-button" onClick={() => set({ rollTable: { ...table, rows: rows.filter((_, j) => j !== i) } })}>
                  Remove row {i + 1}
                </button>
              </li>
            ))}
          </ol>
          <button type="button" className="gov-button" onClick={() => set({ rollTable: { ...table, rows: [...rows, { from: rows.length === 0 ? null : (rows.at(-1)?.to ?? null), to: null, result: "" }] } })}>
            Add row
          </button>
          <p className="gov-muted">Every possible roll must be covered exactly once, from the lowest to the highest.</p>
        </fieldset>
      ) : null}

      {part === "clock" ? (
        <fieldset className="prowess-authoring__nested" data-testid="mission-clock">
          <legend>Threat Clock</legend>
          <label className="gov-field">
            <span>Segments</span>
            <input type="number" min={1} value={typeof clock.segments === "number" ? clock.segments : ""} onChange={(e) => set({ clock: { ...clock, segments: num(e.target.value) } })} />
          </label>
          <label className="gov-field">
            <span>Visibility</span>
            <select value={typeof clock.visibility === "string" ? clock.visibility : ""} onChange={(e) => set({ clock: { ...clock, visibility: e.target.value } })}>
              <option value="">Choose…</option>
              {(catalog.vocabularies.clockVisibilities ?? []).map((v) => (
                <option key={v} value={v}>
                  {formatEnumLabel(v)}
                </option>
              ))}
            </select>
          </label>
          <Lines label="Advances when" value={clock.advancesWhen} onChange={(v) => set({ clock: { ...clock, advancesWhen: v } })} />
          <ol>
            {escalations.map((esc, i) => (
              <li key={i} className="prowess-authoring__row">
                <label className="gov-field">
                  <span>At segment</span>
                  <input aria-label={`Escalation ${i + 1} segment`} type="number" value={esc.atSegment ?? ""} onChange={(e) => set({ clock: { ...clock, escalations: escalations.map((x, j) => (j === i ? { ...x, atSegment: num(e.target.value) } : x)) } })} />
                </label>
                <label className="gov-field">
                  <span>What happens</span>
                  <input aria-label={`Escalation ${i + 1} text`} value={esc.text ?? ""} onChange={(e) => set({ clock: { ...clock, escalations: escalations.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)) } })} />
                </label>
                <button type="button" className="gov-link-button" onClick={() => set({ clock: { ...clock, escalations: escalations.filter((_, j) => j !== i) } })}>
                  Remove escalation {i + 1}
                </button>
              </li>
            ))}
          </ol>
          <button type="button" className="gov-button" onClick={() => set({ clock: { ...clock, escalations: [...escalations, { atSegment: null, text: "" }] } })}>
            Add escalation point
          </button>
        </fieldset>
      ) : null}

      {part === "intel" ? <Lines label="What an Intel token can do" value={obj(rule.intel).uses} onChange={(v) => set({ intel: { uses: v } })} /> : null}
      {part === "points" ? <Lines label="Rule points" value={rule.points} onChange={(v) => set({ points: v })} /> : null}

      <fieldset className="prowess-authoring__nested">
        <legend>Source</legend>
        <SourceSectionPicker value={rule.source} onChange={(v) => set({ source: v })} />
      </fieldset>
    </div>
  );
}
