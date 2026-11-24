"use client";

import { useState } from "react";
import type { AuthoringCatalogDto } from "../_lib/authoring-client";
import {
  AVAILABILITY_SHAPES,
  CARDINALITY_SHAPES,
  CARDINALITY_WORDS,
  CHOICE_SHAPES,
  CONDITION_MEANING_CURRENCY,
  CONDITION_MEANING_WORDS,
  CURRENCY_SHAPES,
  DURATION_CONCENTRATION_SHAPES,
  DURATION_COST_STATUS_SHAPES,
  DURATION_IMPLICIT_PARAMETERS,
  DURATION_RUNTIME_SHAPES,
  FOUNDATION_ACTION_WORDS,
  MANEUVER_CONDITION_MEANINGS,
  MEASURE_STATUS_SHAPES,
  MEASURE_STATUS_WORDS,
  MECHANIC_FACT_WORDS,
  MECHANIC_SET_MEMBERS,
  RANGE_SHAPES,
  RANGE_WORDS,
  REQUIREMENT_SHAPES,
  TARGETING_COST_SHAPES,
  TARGETING_COST_WORDS,
  TARGETING_PARAMETER_SHAPES,
  TARGETING_PARAMETER_WORDS,
  TARGETING_SOURCE_SHAPES,
  asArray,
  asObject,
  asParameterName,
  declaredParameters,
  factWord,
  nextKey,
  parameterWords,
  shapeOf,
  tokenOf,
  tokenWords,
} from "../_lib/component-mechanics";
import { Checks, ConstructionEditor, CostsEditor, NumberInput, OptionList, ParametersEditor, RefChooser, RefList, Section, Select, WordsInput, type MechanicsKinds } from "./ComponentMechanicsEditor";
import { asToken } from "../_lib/token-input";
import { ContentTokenSelect } from "./ContentTokenSelect";
import { FormulaEditor } from "./FormulaEditor";

/**
 * RULES-WO1 Phase G — game-language editors for the remaining Spell / Maneuver components: Targeting, Duration, Casting /
 * Maneuver Conditions and Foundations. Every option list comes from the catalog (the M5 vocabularies); distances are M4
 * Formulas composed by the server (FormulaEditor); every stored field the editor does not show is kept unchanged. The M5
 * readers stay the authority on legality — their issues are placed next to the control whose path they name.
 */
type Payload = Record<string, unknown>;
type Node = Record<string, unknown>;
const vocab = (catalog: AuthoringCatalogDto, name: string): readonly string[] => catalog.vocabularies[name] ?? [];
const opts = (values: readonly string[], words?: Readonly<Record<string, string>>) => values.map((v) => ({ value: v, label: words?.[v] ?? tokenWords(v) }));
/** The catalog token for a shape (falls back to the shape map's own key). */
function pick<M extends Readonly<Record<string, string>>>(catalog: AuthoringCatalogDto, list: string, map: M, shape: M[keyof M]): string {
  return vocab(catalog, list).find((v) => shapeOf(map, v) === shape) ?? tokenOf(map, shape);
}
const conflictWords = (v: unknown) => (typeof v === "string" ? v.replace(/-/g, "_") : "");
const conflictKey = (words: string) => words.replace(/_/g, "-");

function PlainName({ value, onChange, label, testId }: { value: string; onChange: (v: string) => void; label: string; testId: string }) {
  const [typed, setTyped] = useState<string | null>(null);
  return (
    <span className="gov-field">
      <label htmlFor={testId}>{label}</label>
      <input
        id={testId}
        data-testid={testId}
        value={typed ?? parameterWords(value)}
        onChange={(e) => {
          setTyped(e.target.value);
          onChange(asParameterName(e.target.value));
        }}
        onBlur={() => setTyped(null)}
        autoComplete="off"
      />
    </span>
  );
}

function RuleText({ value, onChange, label, testId }: { value: unknown; onChange: (v: string) => void; label: string; testId: string }) {
  return (
    <span className="gov-field">
      <label htmlFor={testId}>{label}</label>
      <textarea id={testId} data-testid={testId} value={typeof value === "string" ? value : ""} onChange={(e) => onChange(e.target.value)} />
    </span>
  );
}

/** "The rules settle it" or "it waits on a named open rules question" (kept, never used in play or construction). */
function Availability({ deferred, conflict, onChange, testId, path }: { deferred: boolean; conflict: unknown; onChange: (deferred: boolean, key: string | null) => void; testId: string; path: string }) {
  return (
    <div role="radiogroup" aria-label="Rules status">
      <label className="prowess-authoring__check">
        <input type="radio" name={`${testId}-availability`} data-testid={`${testId}-executable`} checked={!deferred} onChange={() => onChange(false, null)} /> The rules settle it — it can be used
      </label>
      <label className="prowess-authoring__check">
        <input type="radio" name={`${testId}-availability`} data-testid={`${testId}-deferred`} checked={deferred} onChange={() => onChange(true, typeof conflict === "string" ? conflict : "")} /> It waits on an open rules question (kept, never used)
      </label>
      {deferred ? <WordsInput label="Open question (for example M5 SC 044)" value={conflictWords(conflict)} testId={`${testId}-conflict`} path={path} onChange={(v) => onChange(true, conflictKey(v))} /> : null}
    </div>
  );
}

// ---- Compiled-mechanic checks (Condition applicability, Duration access) ---------------------------------------------

/**
 * A requirement over the ability's own compiled mechanics (decided when the Spell or Maneuver is built): "always", or
 * one or more checks such as "the ability makes an attack roll" or "the ability can target a Creature", joined by
 * all-of / any-of. A nested tree authored elsewhere is kept unchanged.
 */
function MechanicChecks({ value, onChange, catalog, testId, title, help, path }: { value: unknown; onChange: (v: Node) => void; catalog: AuthoringCatalogDto; testId: string; title: string; help: string; path: string }) {
  const numericFacts = vocab(catalog, "conditionNumericFacts");
  const setFacts = vocab(catalog, "conditionSetFacts");
  const node = asObject(value);
  const shape = shapeOf(REQUIREMENT_SHAPES, node.kind);
  const isGroup = shape === "all" || shape === "any";
  const checks = isGroup ? asArray(node.children) : [node];
  const simple = checks.every((n) => typeof n.factKey === "string" && (shapeOf(REQUIREMENT_SHAPES, n.kind) === "compare" || shapeOf(REQUIREMENT_SHAPES, n.kind) === "includes"));
  const toNode = (fact: string, member: string): Node => (setFacts.includes(fact) ? { kind: tokenOf(REQUIREMENT_SHAPES, "includes"), factKey: fact, member } : { kind: tokenOf(REQUIREMENT_SHAPES, "compare"), factKey: fact, operator: "==", expected: 1 });
  const always = numericFacts.find((f) => factWord(f) === "present") ?? "";
  const groupShape: "all" | "any" = shape === "any" ? "any" : "all";
  const write = (next: Node[]) => onChange(next.length === 1 && !isGroup ? next[0]! : { kind: tokenOf(REQUIREMENT_SHAPES, groupShape), children: next });
  return (
    <Section title={title} help={help} testId={testId}>
      {!simple ? (
        <p className="gov-muted" data-testid={`${testId}-kept`}>
          This requirement is nested; it is kept unchanged.
        </p>
      ) : (
        <>
          {checks.map((n, i) => {
            const fact = typeof n.factKey === "string" ? n.factKey : "";
            const members = MECHANIC_SET_MEMBERS[factWord(fact)];
            const member = typeof n.member === "string" ? n.member : "";
            const setAt = (next: Node) => write(checks.map((x, j) => (j === i ? next : x)));
            return (
              <div key={i} className="prowess-authoring__card" data-testid={`${testId}-${i}`}>
                <Select label="Only when" value={fact} options={[...numericFacts, ...setFacts].map((f) => ({ value: f, label: MECHANIC_FACT_WORDS[factWord(f)] ?? f }))} testId={`${testId}-${i}-fact`} path={path} onChange={(v) => setAt(toNode(v, ""))} />
                {setFacts.includes(fact) ? (
                  members ? (
                    <Select label="Which" value={member} options={opts(vocab(catalog, members))} testId={`${testId}-${i}-member`} onChange={(v) => setAt(toNode(fact, v))} />
                  ) : (
                    <WordsInput label="Which (in plain words)" value={member} testId={`${testId}-${i}-member`} onChange={(v) => setAt(toNode(fact, v))} />
                  )
                ) : null}
                {checks.length > 1 ? (
                  <button type="button" className="gov-link-button" data-testid={`${testId}-${i}-remove`} onClick={() => write(checks.filter((_, j) => j !== i))}>
                    Remove this check
                  </button>
                ) : null}
              </div>
            );
          })}
          {checks.length > 1 ? (
            <div role="radiogroup" aria-label="How the checks combine">
              {(["all", "any"] as const).map((g) => (
                <label key={g} className="prowess-authoring__check">
                  <input type="radio" name={`${testId}-mode`} data-testid={`${testId}-mode-${g}`} checked={groupShape === g} onChange={() => onChange({ kind: tokenOf(REQUIREMENT_SHAPES, g), children: checks })} /> {g === "all" ? "All of these hold" : "Any of these holds"}
                </label>
              ))}
            </div>
          ) : null}
          <button type="button" className="gov-link-button" data-testid={`${testId}-add`} onClick={() => onChange({ kind: tokenOf(REQUIREMENT_SHAPES, groupShape), children: [...checks, toNode(always, "")] })}>
            Add a check
          </button>
        </>
      )}
    </Section>
  );
}

/** The "always" requirement (the ability's mechanics are present). */
function alwaysNode(catalog: AuthoringCatalogDto): Node {
  return { kind: tokenOf(REQUIREMENT_SHAPES, "compare"), factKey: vocab(catalog, "conditionNumericFacts").find((f) => factWord(f) === "present") ?? "", operator: "==", expected: 1 };
}

// ---- Targeting ----------------------------------------------------------------------------------------------------

function initialTargetingRules(): Record<string, unknown> {
  return { deliveryFamily: "", cardinality: { kind: "" }, validTargets: [], range: { model: "" }, measures: [], origin: { modes: [], default: null }, placement: "", lineOfSight: "", lineOfEffect: "", cover: "", radiusCapable: false, parameters: [] };
}

/** A distance in feet (an M4 Formula over Stats, derived values and this component's size steps), edited by contributions. */
function Distance({ value, onChange, catalog, steps, tables = [], label, testId }: { value: unknown; onChange: (v: Record<string, unknown>) => void; catalog: AuthoringCatalogDto; steps: readonly string[]; tables?: readonly string[]; label: string; testId: string }) {
  const sources = vocab(catalog, "targetingVariableSources");
  const extra = sources.filter((k) => (shapeOf(TARGETING_SOURCE_SHAPES, k) === "steps" && steps.length > 0) || (shapeOf(TARGETING_SOURCE_SHAPES, k) === "table" && tables.length > 0));
  const sourceKinds = sources.filter((k) => {
    const s = shapeOf(TARGETING_SOURCE_SHAPES, k);
    return s === "stat" || s === "derived" || (s === "steps" && steps.length > 0) || (s === "table" && tables.length > 0);
  });
  const extended: AuthoringCatalogDto = { ...catalog, vocabularies: { ...catalog.vocabularies, formulaExtraSourceKinds: extra, formulaParameterChoices: [...steps], formulaTableChoices: [...tables] } };
  const none = vocab(catalog, "formulaRoundings").find((r) => shapeOf({ NONE: "none" }, r) === "none") ?? tokenOf({ NONE: "none" }, "none");
  const formula = value !== null && typeof value === "object" ? (value as Record<string, unknown>) : { expression: "0", rounding: none, minimum: null, unit: "ft", variables: [] };
  return (
    <div data-testid={testId}>
      <FormulaEditor value={formula} onChange={(v) => onChange({ ...v, unit: "ft" })} catalog={extended} sourceKinds={sourceKinds} label={label} noMaximum />
    </div>
  );
}

/** Renames a Targeting choice in everything that reads it (the cardinality, listed costs and distance inputs). */
function renameTargetingChoice(payload: Payload, t: Record<string, unknown>, from: string, to: string, field: "parameter" | "table" = "parameter"): Payload {
  const rename = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(rename);
    if (v === null || typeof v !== "object") return v;
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) out[k] = k === field && x === from ? to : rename(x);
    return out;
  };
  const rules = asObject(payload.rules);
  return { ...payload, costContributions: rename(payload.costContributions), rules: { ...rules, targeting: rename(t) } };
}

function TargetingParameters({ parameters, onChange, onRename, catalog, testId }: { parameters: unknown; onChange: (v: Node[]) => void; onRename: (from: string, to: string, next: Node[]) => void; catalog: AuthoringCatalogDto; testId: string }) {
  const list = asArray(parameters);
  const kinds = vocab(catalog, "targetingParameterKinds");
  const set = (i: number, next: Node) => onChange(list.map((p, j) => (j === i ? next : p)));
  const blank = (shape: string, name: string, k: string): Node =>
    shape === "list" ? { parameter: name, kind: k, allowed: [], default: null } : shape === "yesno" ? { parameter: name, kind: k, default: false } : shape === "steps" ? { parameter: name, kind: k, minimum: 0, default: 0 } : { parameter: name, kind: k, minimum: 1 };
  return (
    <Section title="Choices made when it is used" help="For example how many size steps the caster adds, or how many extra targets." testId={testId}>
      {list.length === 0 ? <p className="gov-muted">No choices.</p> : null}
      {list.map((p, i) => {
        const shape = shapeOf(TARGETING_PARAMETER_SHAPES, p.kind);
        const name = typeof p.parameter === "string" ? p.parameter : "";
        const allowed = Array.isArray(p.allowed) ? (p.allowed as string[]) : [];
        return (
          <div key={i} className="prowess-authoring__card" data-testid={`${testId}-${i}`}>
            <PlainName value={name} label="Name of the choice" testId={`${testId}-${i}-name`} onChange={(v) => onRename(name, v, list.map((q, j) => (j === i ? { ...q, parameter: v } : q)))} />
            <div role="radiogroup" aria-label="Type of choice">
              {kinds.map((k) => {
                const s = shapeOf(TARGETING_PARAMETER_SHAPES, k);
                return s === null ? null : (
                  <label key={k} className="prowess-authoring__check">
                    <input type="radio" name={`${testId}-${i}-type`} data-testid={`${testId}-${i}-type-${s}`} checked={shape === s} onChange={() => set(i, blank(s, name, k))} /> {TARGETING_PARAMETER_WORDS[s]}
                  </label>
                );
              })}
            </div>
            {shape === "number" || shape === "steps" ? <NumberInput label="Smallest" value={p.minimum} testId={`${testId}-${i}-min`} onChange={(v) => set(i, { ...p, minimum: v ?? 0 })} allowBlank={false} /> : null}
            {shape === "steps" ? <NumberInput label="Starts at" value={p.default} testId={`${testId}-${i}-default`} onChange={(v) => set(i, { ...p, default: v ?? 0 })} allowBlank={false} /> : null}
            {shape === "number" ? <p className="gov-muted">The user always states the number (it has no starting value).</p> : null}
            {shape === "list" ? (
              <>
                <OptionList label="Options" values={allowed} testId={`${testId}-${i}-options`} onChange={(v) => set(i, { ...p, allowed: v, default: typeof p.default === "string" && v.includes(p.default) ? p.default : null })} />
                <Select label="Chosen by default" value={p.default ?? ""} blank="None — the user chooses" options={opts(allowed)} testId={`${testId}-${i}-default`} onChange={(v) => set(i, { ...p, default: v === "" ? null : v })} />
              </>
            ) : null}
            {shape === "yesno" ? (
              <label className="prowess-authoring__check">
                <input type="checkbox" data-testid={`${testId}-${i}-default`} checked={p.default === true} onChange={(e) => set(i, { ...p, default: e.target.checked })} /> Yes by default
              </label>
            ) : null}
            <button type="button" className="gov-link-button" onClick={() => onChange(list.filter((_, j) => j !== i))}>
              Remove this choice
            </button>
          </div>
        );
      })}
      <button type="button" className="gov-button" data-testid={`${testId}-add`} onClick={() => onChange([...list, blank("steps", "", pick(catalog, "targetingParameterKinds", TARGETING_PARAMETER_SHAPES, "steps"))])}>
        Add a choice
      </button>
    </Section>
  );
}

/**
 * A value that depends on a Skill rank (for example the Martial Rank Base: Trained 5, Expert 10, Master 15). A distance
 * reads it through a "rank table" input; a rank with no row is "not authored at this rank" (never 0).
 */
function RankTables({ tables, onChange, onRename }: { tables: Node[]; onChange: (v: Node[]) => void; onRename: (from: string, to: string, next: Node[]) => void }) {
  const set = (i: number, next: Node) => onChange(tables.map((x, j) => (j === i ? next : x)));
  return (
    <Section title="Values by Skill rank" help="A value that depends on the user's rank in one Skill, read by a distance below (for example 5 / 10 / 15 by Martial rank)." testId="targeting-rank-table">
      {tables.length === 0 ? <p className="gov-muted">None.</p> : null}
      {tables.map((tb, i) => {
        const name = typeof tb.tableKey === "string" ? tb.tableKey : "";
        const entries = asArray(tb.entries);
        return (
          <div key={i} className="prowess-authoring__card" data-testid={`targeting-rank-table-${i}`}>
            <TableName value={name} testId={`targeting-rank-table-${i}-name`} onChange={(v) => onRename(name, v, tables.map((x, j) => (j === i ? { ...x, tableKey: v } : x)))} />
            <span className="gov-field">
              <label htmlFor={`targeting-rank-table-${i}-skill`}>By the rank in</label>
              <ContentTokenSelect id={`targeting-rank-table-${i}-skill`} value={tb.skillKey} options="skills" onChange={(v) => set(i, { ...tb, skillKey: v })} />
            </span>
            {entries.map((e, j) => (
              <div key={j} className="prowess-authoring__inline" data-testid={`targeting-rank-table-${i}-row-${j}`}>
                <span className="gov-field">
                  <label htmlFor={`targeting-rank-table-${i}-row-${j}-rank`}>Rank</label>
                  <ContentTokenSelect id={`targeting-rank-table-${i}-row-${j}-rank`} value={e.rankKey} options="skillRanks" onChange={(v) => set(i, { ...tb, entries: entries.map((x, k) => (k === j ? { ...x, rankKey: v } : x)) })} />
                </span>
                <NumberInput label="Value" value={e.value} testId={`targeting-rank-table-${i}-row-${j}-value`} onChange={(v) => set(i, { ...tb, entries: entries.map((x, k) => (k === j ? { ...x, value: v ?? 0 } : x)) })} allowBlank={false} />
                <button type="button" className="gov-link-button" onClick={() => set(i, { ...tb, entries: entries.filter((_, k) => k !== j) })}>
                  Remove this rank
                </button>
              </div>
            ))}
            <button type="button" className="gov-link-button" data-testid={`targeting-rank-table-${i}-add-row`} onClick={() => set(i, { ...tb, entries: [...entries, { rankKey: "", value: 0 }] })}>
              Add a rank
            </button>
            <button type="button" className="gov-link-button" onClick={() => onChange(tables.filter((_, j) => j !== i))}>
              Remove this table
            </button>
          </div>
        );
      })}
      <button type="button" className="gov-button" data-testid="targeting-rank-table-add" onClick={() => onChange([...tables, { tableKey: "", skillKey: "", entries: [] }])}>
        Add values by Skill rank
      </button>
    </Section>
  );
}

function TableName({ value, onChange, testId }: { value: string; onChange: (v: string) => void; testId: string }) {
  const [typed, setTyped] = useState<string | null>(null);
  return (
    <span className="gov-field">
      <label htmlFor={testId}>Name</label>
      <input id={testId} data-testid={testId} value={typed ?? tokenWords(value)} onChange={(e) => { setTyped(e.target.value); onChange(asToken(e.target.value, true)); }} onBlur={() => setTyped(null)} autoComplete="off" />
    </span>
  );
}

export function TargetingMechanicsEditor({ maneuver, payload, onPayloadChange, catalog, kinds }: { maneuver: boolean; payload: Payload; onPayloadChange: (p: Payload) => void; catalog: AuthoringCatalogDto; kinds: MechanicsKinds }) {
  const rules = asObject(payload.rules);
  const t = rules.targeting === undefined ? initialTargetingRules() : asObject(rules.targeting);
  const withT = (next: Record<string, unknown>, top: Payload = {}): Payload => ({ ...payload, ...top, rules: { ...rules, targeting: next } });
  const put = (patch: Record<string, unknown>) => onPayloadChange(withT({ ...t, ...patch }));
  const cardinality = asObject(t.cardinality);
  const range = asObject(t.range);
  const rShape = shapeOf(RANGE_SHAPES, range.model);
  const origin = asObject(t.origin);
  const modes = Array.isArray(origin.modes) ? (origin.modes as string[]) : [];
  const auraSources = Array.isArray(origin.sources) ? (origin.sources as string[]) : [];
  const measures = asArray(t.measures);
  const params = asArray(t.parameters);
  const named = (s: string) => params.filter((p) => shapeOf(TARGETING_PARAMETER_SHAPES, p.kind) === s).map((p) => String(p.parameter ?? "")).filter(Boolean);
  const steps = named("steps");
  const counts = named("number");
  const choosable = [...named("yesno"), ...named("list")];
  const rankTables = asArray(t.rankTables);
  const tables = rankTables.map((r) => String(r.tableKey ?? "")).filter(Boolean);
  const radiusOf = (m: unknown) => shapeOf({ RADIUS: "radius" }, m) === "radius";
  const setMeasures = (next: Node[]) => put({ measures: next, radiusCapable: next.some((m) => radiusOf(m.measure)) });
  const costs = asArray(payload.costContributions);
  const mp = pick(catalog, "costCurrencies", CURRENCY_SHAPES, "mp");
  const setCost = (i: number, data: Node) => onPayloadChange(withT(t, { costContributions: costs.map((c, j) => (j === i ? { ...c, currency: mp, data } : c)) }));
  return (
    <div className="prowess-authoring__mechanics" data-testid="targeting-mechanics">
      <Section title="How it is delivered" testId="targeting-delivery">
        <Select label="Delivery" value={t.deliveryFamily} options={opts(vocab(catalog, "deliveryFamilies"))} testId="targeting-delivery-family" path="payload.rules.targeting.deliveryFamily" onChange={(v) => put({ deliveryFamily: v })} />
        <div role="radiogroup" aria-label="How many targets">
          <p>How many targets</p>
          {vocab(catalog, "targetCardinalityKinds").map((k) => (
            <label key={k} className="prowess-authoring__check">
              <input type="radio" name="targeting-cardinality" data-testid={`targeting-cardinality-${shapeOf(CARDINALITY_SHAPES, k) ?? k}`} checked={cardinality.kind === k} onChange={() => put({ cardinality: shapeOf(CARDINALITY_SHAPES, k) === "selected" ? { kind: k, parameter: counts[0] ?? "", minimum: 2 } : { kind: k } })} /> {CARDINALITY_WORDS[k] ?? tokenWords(k)}
            </label>
          ))}
        </div>
        {shapeOf(CARDINALITY_SHAPES, cardinality.kind) === "selected" ? (
          <>
            <Select label="The number of targets comes from" value={cardinality.parameter} options={counts.map((c) => ({ value: c, label: parameterWords(c) }))} blank={counts.length === 0 ? "Add a number choice first" : "Choose…"} testId="targeting-cardinality-parameter" path="payload.rules.targeting.cardinality" onChange={(v) => put({ cardinality: { ...cardinality, parameter: v } })} />
            <NumberInput label="At least this many targets" value={cardinality.minimum} testId="targeting-cardinality-minimum" onChange={(v) => put({ cardinality: { ...cardinality, minimum: v ?? 2 } })} allowBlank={false} />
          </>
        ) : null}
        <Checks label="It can target" values={vocab(catalog, "targetCategories")} chosen={Array.isArray(t.validTargets) ? (t.validTargets as string[]) : []} testId="targeting-target" path="payload.rules.targeting.validTargets" onChange={(v) => put({ validTargets: v })} />
      </Section>

      <TargetingParameters
        parameters={t.parameters}
        catalog={catalog}
        testId="targeting-parameter"
        onChange={(v) => put({ parameters: v })}
        onRename={(from, to, next) => onPayloadChange(from === "" ? withT({ ...t, parameters: next }) : renameTargetingChoice(payload, { ...t, parameters: next }, from, to))}
      />

      <RankTables
        tables={rankTables}
        onChange={(v) => put({ rankTables: v })}
        onRename={(from, to, next) => onPayloadChange(from === "" ? withT({ ...t, rankTables: next }) : renameTargetingChoice(payload, { ...t, rankTables: next }, from, to, "table"))}
      />

      <Section title="Range" testId="targeting-range">
        <Select
          label="Range"
          value={range.model}
          options={opts(vocab(catalog, "targetingRangeModels"), RANGE_WORDS)}
          testId="targeting-range-model"
          path="payload.rules.targeting.range"
          onChange={(v) => {
            const s = shapeOf(RANGE_SHAPES, v);
            put({ range: s === "distance" ? { model: v, formula: range.formula ?? null } : s === "text" ? { model: v, ruleText: range.ruleText ?? "" } : { model: v } });
          }}
        />
        {rShape === "distance" ? <Distance value={range.formula} catalog={catalog} steps={steps} tables={tables} label="Range in feet" testId="targeting-range-distance" onChange={(f) => put({ range: { ...range, formula: f } })} /> : null}
        {rShape === "text" ? <RuleText value={range.ruleText} label="The special range rule, as written" testId="targeting-range-text" onChange={(v) => put({ range: { ...range, ruleText: v } })} /> : null}
      </Section>

      <Section title="Size of the area" help="Length, width or radius — leave a measure unused when the shape has none." testId="targeting-measures">
        {vocab(catalog, "targetingMeasures").map((m) => {
          const row = measures.find((x) => x.measure === m);
          const s = row === undefined ? null : shapeOf(MEASURE_STATUS_SHAPES, row.valueStatus);
          const setRow = (next: Node | null) => setMeasures(next === null ? measures.filter((x) => x.measure !== m) : row === undefined ? [...measures, next] : measures.map((x) => (x.measure === m ? next : x)));
          return (
            <div key={m} className="prowess-authoring__card" data-testid={`targeting-measure-${m}`}>
              <Select
                label={tokenWords(m)}
                value={row === undefined ? "" : row.valueStatus}
                blank="Not used"
                options={opts(vocab(catalog, "targetingMeasureStatuses"), MEASURE_STATUS_WORDS)}
                testId={`targeting-measure-${m}-status`}
                onChange={(v) => {
                  if (v === "") return setRow(null);
                  const shape = shapeOf(MEASURE_STATUS_SHAPES, v);
                  setRow(shape === "distance" ? { measure: m, valueStatus: v, formula: row?.formula ?? null } : shape === "deferred" ? { measure: m, valueStatus: v, conflictKey: row?.conflictKey ?? "", ruleText: row?.ruleText ?? "" } : { measure: m, valueStatus: v });
                }}
              />
              {s === "distance" ? <Distance value={row?.formula} catalog={catalog} steps={steps} tables={tables} label={`${tokenWords(m)} in feet`} testId={`targeting-measure-${m}-distance`} onChange={(f) => setRow({ ...row, formula: f })} /> : null}
              {s === "deferred" ? (
                <>
                  <WordsInput label="Open question it waits on (for example M5 SC 030)" value={conflictWords(row?.conflictKey)} testId={`targeting-measure-${m}-conflict`} onChange={(v) => setRow({ ...row, conflictKey: conflictKey(v) })} />
                  <RuleText value={row?.ruleText} label="The rule as written" testId={`targeting-measure-${m}-text`} onChange={(v) => setRow({ ...row, ruleText: v })} />
                </>
              ) : null}
            </div>
          );
        })}
      </Section>

      <Section title="Where it starts and how it is placed" testId="targeting-origin">
        <Checks label="It can start from" values={vocab(catalog, "targetingOriginModes")} chosen={modes} testId="targeting-origin" path="payload.rules.targeting.origin" onChange={(v) => put({ origin: { ...origin, modes: v, default: typeof origin.default === "string" && v.includes(origin.default) ? origin.default : null } })} />
        <Select label="Starts from, by default" value={origin.default ?? ""} blank="Decided by the Effect or the user" options={opts(modes)} testId="targeting-origin-default" onChange={(v) => put({ origin: { ...origin, default: v === "" ? null : v } })} />
        <Checks
          label="An Aura may be centred on (leave empty when it is not an Aura)"
          values={vocab(catalog, "auraSources")}
          chosen={auraSources}
          testId="targeting-aura"
          onChange={(v) => {
            const rest = Object.fromEntries(Object.entries(origin).filter(([k]) => k !== "sources" && k !== "defaultSource"));
            put({ origin: v.length === 0 ? rest : { ...rest, sources: v, defaultSource: typeof origin.defaultSource === "string" && v.includes(origin.defaultSource) ? origin.defaultSource : v[0] } });
          }}
        />
        {auraSources.length > 1 ? <Select label="Aura centred on, by default" value={origin.defaultSource ?? ""} blank={null} options={opts(auraSources)} testId="targeting-aura-default" onChange={(v) => put({ origin: { ...origin, defaultSource: v } })} /> : null}
        <Select label="Placement" value={t.placement} options={opts(vocab(catalog, "targetingPlacementModels"))} testId="targeting-placement" path="payload.rules.targeting.placement" onChange={(v) => put({ placement: v })} />
        <Select label="Line of sight" value={t.lineOfSight} options={opts(vocab(catalog, "sightPolicies"))} testId="targeting-line-of-sight" path="payload.rules.targeting.lineOfSight" onChange={(v) => put({ lineOfSight: v })} />
        <Select label="Line of effect" value={t.lineOfEffect} options={opts(vocab(catalog, "sightPolicies"))} testId="targeting-line-of-effect" path="payload.rules.targeting.lineOfEffect" onChange={(v) => put({ lineOfEffect: v })} />
        <Select label="Cover" value={t.cover} options={opts(vocab(catalog, "coverPolicies"))} testId="targeting-cover" path="payload.rules.targeting.cover" onChange={(v) => put({ cover: v })} />
      </Section>

      {maneuver ? (
        <p className="gov-muted" data-testid="targeting-maneuver-cost">
          A Maneuver Targeting carries no cost of its own: the Targeting Conversion Effect that uses it owns the AP / MP.
        </p>
      ) : (
        <Section title="Costs (MP)" help="A Spell Targeting lists exactly one base cost; size steps, extra targets and options can add to it." testId="targeting-cost">
          {costs.map((c, i) => {
            const d = asObject(c.data);
            const s = shapeOf(TARGETING_COST_SHAPES, d.kind);
            const chosen = params.find((p) => p.parameter === d.parameter);
            const chosenShape = shapeOf(TARGETING_PARAMETER_SHAPES, chosen?.kind);
            const selectable = chosenShape === "list" ? (Array.isArray(chosen?.allowed) ? (chosen.allowed as string[]) : []).filter((a) => a !== chosen?.default) : [];
            return (
              <div key={i} className="prowess-authoring__card" data-testid={`targeting-cost-${i}`}>
                <Select
                  label="How it is charged"
                  value={d.kind}
                  options={opts(vocab(catalog, "targetingCostKinds"), TARGETING_COST_WORDS)}
                  testId={`targeting-cost-${i}-kind`}
                  path={`payload.costContributions[${i}]`}
                  onChange={(k) => {
                    const shape = shapeOf(TARGETING_COST_SHAPES, k);
                    setCost(i, shape === "base" ? { kind: k, amount: 0 } : shape === "deferred" ? { kind: k, conflictKey: "" } : shape === "perStep" ? { kind: k, parameter: steps[0] ?? "", amount: 0, step: { size: 5, unit: "ft" } } : shape === "perTarget" ? { kind: k, parameter: counts[0] ?? "", amount: 0 } : { kind: k, parameter: choosable[0] ?? "", amount: 0, values: [] });
                  }}
                />
                {s !== null && s !== "deferred" ? <NumberInput label="MP cost" value={d.amount} testId={`targeting-cost-${i}-amount`} onChange={(v) => setCost(i, { ...d, amount: v ?? 0 })} allowBlank={false} /> : null}
                {s === "perStep" ? (
                  <>
                    <Select label="For each step of the choice" value={d.parameter} options={steps.map((x) => ({ value: x, label: parameterWords(x) }))} testId={`targeting-cost-${i}-parameter`} onChange={(v) => setCost(i, { ...d, parameter: v })} />
                    <NumberInput label="Each step adds (feet)" value={asObject(d.step).size} testId={`targeting-cost-${i}-step`} onChange={(v) => setCost(i, { ...d, step: { size: v ?? 0, unit: "ft" } })} allowBlank={false} />
                  </>
                ) : null}
                {s === "perTarget" ? <Select label="For each target counted by" value={d.parameter} options={counts.map((x) => ({ value: x, label: parameterWords(x) }))} testId={`targeting-cost-${i}-parameter`} onChange={(v) => setCost(i, { ...d, parameter: v })} /> : null}
                {s === "perSelection" ? (
                  <>
                    <Select
                      label="When this choice is made"
                      value={d.parameter}
                      options={choosable.map((x) => ({ value: x, label: parameterWords(x) }))}
                      testId={`targeting-cost-${i}-parameter`}
                      onChange={(v) => setCost(i, { ...d, parameter: v, values: shapeOf(TARGETING_PARAMETER_SHAPES, params.find((p) => p.parameter === v)?.kind) === "yesno" ? [true] : [] })}
                    />
                    {chosenShape === "list" ? <Checks label="It costs when the user picks" values={selectable} chosen={Array.isArray(d.values) ? (d.values as string[]) : []} testId={`targeting-cost-${i}-values`} onChange={(v) => setCost(i, { ...d, values: v })} /> : null}
                    {chosenShape === "yesno" ? <p className="gov-muted">It costs when the user answers yes.</p> : null}
                  </>
                ) : null}
                {s === "deferred" ? <WordsInput label="Open question it waits on (for example M5 SC 030)" value={conflictWords(d.conflictKey)} testId={`targeting-cost-${i}-conflict`} onChange={(v) => setCost(i, { ...d, conflictKey: conflictKey(v) })} /> : null}
                <button type="button" className="gov-link-button" onClick={() => onPayloadChange(withT(t, { costContributions: costs.filter((_, j) => j !== i) }))}>
                  Remove this cost
                </button>
              </div>
            );
          })}
          <button
            type="button"
            className="gov-button"
            data-testid="targeting-cost-add"
            onClick={() => onPayloadChange(withT(t, { costContributions: [...costs, { contributionKey: nextKey(costs.map((c) => String(c.contributionKey ?? "")), "targeting"), currency: mp, data: costs.length === 0 ? { kind: pick(catalog, "targetingCostKinds", TARGETING_COST_SHAPES, "base"), amount: 0 } : { kind: pick(catalog, "targetingCostKinds", TARGETING_COST_SHAPES, "perStep"), parameter: steps[0] ?? "", amount: 0, step: { size: 5, unit: "ft" } } }] }))}
          >
            Add a cost
          </button>
        </Section>
      )}

      <ConstructionEditor construction={rules.construction} catalog={catalog} kinds={kinds} testId="targeting-construction" onChange={(v) => onPayloadChange({ ...payload, rules: { ...rules, targeting: t, construction: v } })} />
    </div>
  );
}

// ---- Duration -----------------------------------------------------------------------------------------------------

/** The inert future-runtime markers a Duration implies (the reader refuses any that disagree; play does not run them). */
function runtimeFor(concept: string, catalog: AuthoringCatalogDto): Record<string, unknown> {
  const s = shapeOf(DURATION_RUNTIME_SHAPES, concept);
  return { sustain: s === "sustained", manaLock: s === "manaLock", concentration: pick(catalog, "durationConcentrationModes", DURATION_CONCENTRATION_SHAPES, s === "sustained" ? "concentration" : "none"), persists: s !== "instant" };
}

export function DurationMechanicsEditor({ branch, payload, onPayloadChange, catalog, kinds }: { branch: string; payload: Payload; onPayloadChange: (p: Payload) => void; catalog: AuthoringCatalogDto; kinds: MechanicsKinds }) {
  const rules = asObject(payload.rules);
  const concept = typeof payload.durationConcept === "string" ? payload.durationConcept : "";
  const executable = pick(catalog, "componentAvailability", AVAILABILITY_SHAPES, "executable");
  const deferred = pick(catalog, "componentAvailability", AVAILABILITY_SHAPES, "deferred");
  const d = rules.duration === undefined ? { branch, availability: executable, deferralKey: null, requirements: alwaysNode(catalog), futureRuntime: runtimeFor(concept, catalog), costStatus: tokenOf(DURATION_COST_STATUS_SHAPES, "unlisted") } : asObject(rules.duration);
  const write = (nextD: Record<string, unknown>, top: Payload = {}) => onPayloadChange({ ...payload, ...top, rules: { ...rules, duration: { ...nextD, futureRuntime: runtimeFor(typeof top.durationConcept === "string" ? top.durationConcept : concept, catalog) } } });
  const listed = shapeOf(DURATION_COST_STATUS_SHAPES, d.costStatus) === "authored";
  return (
    <div className="prowess-authoring__mechanics" data-testid="duration-mechanics">
      <Section title="How long it lasts" testId="duration-what">
        <Select label="Duration" value={concept} options={opts(vocab(catalog, "durationConcepts"))} testId="duration-concept" path="payload.durationConcept" onChange={(v) => write(d, { durationConcept: v })} />
        <p className="gov-muted" data-testid="duration-runtime">
          What it means in play (Sustain, Mana Lock, Concentration) follows from the Duration; play does not run it yet.
        </p>
        <Availability deferred={shapeOf(AVAILABILITY_SHAPES, d.availability) === "deferred"} conflict={d.deferralKey} testId="duration" path="payload.rules.duration.deferralKey" onChange={(isDef, key) => write({ ...d, availability: isDef ? deferred : executable, deferralKey: key })} />
      </Section>
      <MechanicChecks value={d.requirements} catalog={catalog} testId="duration-requirement" path="payload.rules.duration.requirements" title="When it may be chosen" help="Checked against the ability's own mechanics when the Spell or Maneuver is built. A Permanent Duration needs a real requirement." onChange={(v) => write({ ...d, requirements: v })} />
      <Section title="Cost" testId="duration-cost">
        <label className="prowess-authoring__check">
          <input type="checkbox" data-testid="duration-cost-listed" checked={listed} onChange={(e) => write({ ...d, costStatus: tokenOf(DURATION_COST_STATUS_SHAPES, e.target.checked ? "authored" : "unlisted") }, e.target.checked ? {} : { costContributions: [] })} /> The rules list a cost for this Duration
        </label>
        {listed ? (
          <CostsEditor costs={payload.costContributions} parameters={DURATION_IMPLICIT_PARAMETERS[concept] ?? []} catalog={catalog} testId="duration-cost" keyPrefix="duration" kinds={kinds} branchIsManeuver={false} onChange={(v) => write(d, { costContributions: v })} />
        ) : (
          <p className="gov-muted">No listed cost (which is not the same as a free Duration).</p>
        )}
      </Section>
      <ConstructionEditor construction={rules.construction} catalog={catalog} kinds={kinds} testId="duration-construction" onChange={(v) => onPayloadChange({ ...payload, rules: { ...rules, duration: d, construction: v } })} />
    </div>
  );
}

// ---- Casting / Maneuver Conditions ----------------------------------------------------------------------------------

export function ConditionMechanicsEditor({ branch, maneuver, payload, onPayloadChange, catalog, kinds }: { branch: string; maneuver: boolean; payload: Payload; onPayloadChange: (p: Payload) => void; catalog: AuthoringCatalogDto; kinds: MechanicsKinds }) {
  const rules = asObject(payload.rules);
  const executable = pick(catalog, "componentAvailability", AVAILABILITY_SHAPES, "executable");
  const deferred = pick(catalog, "componentAvailability", AVAILABILITY_SHAPES, "deferred");
  const c =
    rules.condition === undefined
      ? { branch, availability: executable, deferralKey: null, parameters: [], applicability: alwaysNode(catalog), runtimeRequirements: [], dependencies: [], consumesSlot: true, slotExemption: null, choice: { kind: tokenOf(CHOICE_SHAPES, "all") }, incompatibleRestrictions: [] }
      : asObject(rules.condition);
  const write = (patch: Record<string, unknown>, top: Payload = {}) => onPayloadChange({ ...payload, ...top, rules: { ...rules, condition: { ...c, ...patch } } });
  const restriction = asObject(payload.restriction);
  const choice = asObject(c.choice);
  const chooseOne = shapeOf(CHOICE_SHAPES, choice.kind) === "one";
  const declared = declaredParameters(c.parameters).filter((q) => q.name !== "");
  const lists = declared.filter((q) => q.shape === "list");
  const choiceOptions = lists.find((q) => q.name === choice.parameter)?.allowed ?? [];
  const runtime = asArray(c.runtimeRequirements);
  const meanings = vocab(catalog, "conditionCostMeanings").filter((m) => !maneuver || MANEUVER_CONDITION_MEANINGS[m] === true);
  const currencyFor = (meaning: string) => pick(catalog, "costCurrencies", CURRENCY_SHAPES, CONDITION_MEANING_CURRENCY[meaning] ?? "ap");
  const compare = tokenOf(REQUIREMENT_SHAPES, "compare");
  const isDeferred = shapeOf(AVAILABILITY_SHAPES, c.availability) === "deferred";
  return (
    <div className="prowess-authoring__mechanics" data-testid="condition-mechanics">
      <Section title="The restriction" help="What the caster or user must accept, in plain words (for example Must move first)." testId="condition-what">
        <WordsInput label="Restriction" value={restriction.restrictionKey} testId="condition-restriction" path="payload.restriction.restrictionKey" onChange={(v) => onPayloadChange({ ...payload, restriction: { ...restriction, restrictionKey: v, data: restriction.data ?? {} }, tradeoff: payload.tradeoff ?? {}, rules: { ...rules, condition: c } })} />
        <Availability deferred={isDeferred} conflict={c.deferralKey} testId="condition" path="payload.rules.condition.deferralKey" onChange={(isDef, key) => write({ availability: isDef ? deferred : executable, deferralKey: key }, isDef ? { costContributions: [] } : {})} />
        {isDeferred ? <p className="gov-muted">A Condition that waits on an open question lists no benefit until the question is answered.</p> : null}
      </Section>

      <ParametersEditor parameters={c.parameters} catalog={catalog} testId="condition-parameter" path="payload.rules.condition.parameters" help="A choice made when the Condition is taken (for example once per Scene, Combat or Mission)." onChange={(v) => write({ parameters: v })} />

      <MechanicChecks value={c.applicability} catalog={catalog} testId="condition-applicability" path="payload.rules.condition.applicability" title="When it may be taken" help="A Condition must really limit the ability: it is checked against the ability's own mechanics when the Spell or Maneuver is built." onChange={(v) => write({ applicability: v })} />

      <Section title="Checked in play" help="What play must confirm when the ability is used (for example the caster can speak). At least one is required. Play does not check these yet; they are recorded for the play runtime." testId="condition-runtime">
        {runtime.map((r, i) => {
          const req = asObject(r.requirement);
          const simple = shapeOf(REQUIREMENT_SHAPES, req.kind) === "compare" && typeof req.factKey === "string" && req.factKey.startsWith("runtime.");
          const fact = simple ? String(req.factKey).slice("runtime.".length) : "";
          const setAt = (next: Node) => write({ runtimeRequirements: runtime.map((x, j) => (j === i ? next : x)) });
          const expected = typeof req.expected === "number" ? req.expected : 1;
          return (
            <div key={i} className="prowess-authoring__card" data-testid={`condition-runtime-${i}`}>
              <WordsInput label="Name of the check" value={r.requirementKey} testId={`condition-runtime-${i}-name`} path={`payload.rules.condition.runtimeRequirements[${i}]`} onChange={(v) => setAt({ ...r, requirementKey: v })} />
              {simple ? (
                <>
                  <PlainName value={fact} label="What play checks (in plain words, for example can vocalize)" testId={`condition-runtime-${i}-fact`} onChange={(v) => setAt({ ...r, requirement: { kind: compare, factKey: `runtime.${v}`, operator: ">=", expected } })} />
                  <NumberInput label="At least" value={expected} testId={`condition-runtime-${i}-expected`} onChange={(v) => setAt({ ...r, requirement: { kind: compare, factKey: `runtime.${fact}`, operator: ">=", expected: v ?? 1 } })} allowBlank={false} />
                </>
              ) : (
                <p className="gov-muted">A nested play check, kept unchanged.</p>
              )}
              {declared.length > 0 ? (
                <Checks label="It reads these choices" values={declared.map((q) => q.name)} chosen={Array.isArray(r.parameters) ? (r.parameters as string[]) : []} wordMap={Object.fromEntries(declared.map((q) => [q.name, parameterWords(q.name)]))} testId={`condition-runtime-${i}-parameters`} onChange={(v) => setAt({ ...r, parameters: v })} />
              ) : null}
              <button type="button" className="gov-link-button" onClick={() => write({ runtimeRequirements: runtime.filter((_, j) => j !== i) })}>
                Remove this check
              </button>
            </div>
          );
        })}
        <button type="button" className="gov-button" data-testid="condition-runtime-add" onClick={() => write({ runtimeRequirements: [...runtime, { requirementKey: "", requirement: { kind: compare, factKey: "runtime.", operator: ">=", expected: 1 }, parameters: [] }] })}>
          Add a play check
        </button>
      </Section>

      <Section title="Its benefit" help={maneuver ? "A Maneuver Condition reduces the AP or MP cost (the total stays within the construction rule's cap)." : "A Casting Condition reduces the MP cost (within the rank's cap) or the AP cost, or commits extra AP."} testId="condition-benefit">
        <label className="prowess-authoring__check">
          <input type="checkbox" data-testid="condition-choose-one" checked={chooseOne} disabled={!chooseOne && lists.length === 0} onChange={(e) => write({ choice: e.target.checked ? { kind: tokenOf(CHOICE_SHAPES, "one"), parameter: lists[0]?.name ?? "" } : { kind: tokenOf(CHOICE_SHAPES, "all") } })} /> The user picks one of several benefits (add a list choice first)
        </label>
        {chooseOne ? <Select label="Picked with the choice" value={choice.parameter} options={lists.map((q) => ({ value: q.name, label: parameterWords(q.name) }))} testId="condition-choice-parameter" path="payload.rules.condition.choice" onChange={(v) => write({ choice: { ...choice, parameter: v } })} /> : null}
        <CostsEditor
          costs={payload.costContributions}
          parameters={c.parameters}
          catalog={catalog}
          testId="condition-cost"
          keyPrefix="condition"
          kinds={kinds}
          branchIsManeuver={false}
          onChange={(v) => write({}, { costContributions: v })}
          extra={(cost, set, i) => {
            const data = asObject(cost.data);
            return (
              <>
                <Select label="What it does" value={data.modifier} options={opts(meanings, CONDITION_MEANING_WORDS)} testId={`condition-cost-${i}-meaning`} path={`payload.costContributions[${i}].data.modifier`} onChange={(v) => set({ ...cost, currency: currencyFor(v), data: { ...data, modifier: v } })} />
                {chooseOne ? <Select label="Benefit for the option" value={data.option ?? ""} options={opts(choiceOptions)} testId={`condition-cost-${i}-option`} onChange={(v) => set({ ...cost, data: { ...data, option: v === "" ? null : v } })} /> : null}
              </>
            );
          }}
        />
      </Section>

      <Section title="How it combines" testId="condition-combine">
        <label className="prowess-authoring__check">
          <input type="checkbox" data-testid="condition-slot" checked={c.consumesSlot !== false} onChange={(e) => write({ consumesSlot: e.target.checked, slotExemption: e.target.checked ? null : typeof c.slotExemption === "string" ? c.slotExemption : "" })} /> It uses one of the ability&rsquo;s Condition slots
        </label>
        {c.consumesSlot === false ? <WordsInput label="The rule that exempts it (in plain words)" value={c.slotExemption} testId="condition-slot-exemption" path="payload.rules.condition.consumesSlot" onChange={(v) => write({ slotExemption: v })} /> : null}
        <OptionList label="Restrictions it cannot be combined with (in plain words)" values={Array.isArray(c.incompatibleRestrictions) ? (c.incompatibleRestrictions as string[]) : []} testId="condition-incompatible" onChange={(v) => write({ incompatibleRestrictions: [...v].sort() })} />
        <RefList label="Other components it depends on" kind="" value={c.dependencies} testId="condition-dependencies" onChange={(v) => write({ dependencies: v })} />
      </Section>
      {c.performance !== undefined ? <p className="gov-muted">This Condition also carries the Performance rule; it is kept unchanged.</p> : null}
      <ConstructionEditor construction={rules.construction} catalog={catalog} kinds={kinds} testId="condition-construction" onChange={(v) => onPayloadChange({ ...payload, rules: { ...rules, condition: c, construction: v } })} />
    </div>
  );
}

// ---- Foundation ---------------------------------------------------------------------------------------------------

export function FoundationMechanicsEditor({ payload, onPayloadChange, catalog, kinds }: { payload: Payload; onPayloadChange: (p: Payload) => void; catalog: AuthoringCatalogDto; kinds: MechanicsKinds }) {
  const rules = asObject(payload.rules);
  const action = asObject(rules.action);
  const targeting = asObject(action.targeting);
  const bound = rules.attack !== undefined;
  const putAction = (patch: Record<string, unknown>) => onPayloadChange({ ...payload, rules: { ...rules, action: { category: action.category ?? "", targeting: action.targeting ?? null, ...patch } } });
  return (
    <div className="prowess-authoring__mechanics" data-testid="foundation-mechanics">
      <Section title="What the Maneuver starts from" help="A Weapon Attack's dice, reach and Targeting are authored on its Weapon and Attack, and its Foundation is derived from them. Here you author a non-attack action: a movement, a defence or an interaction." testId="foundation-what">
        <WordsInput label="Foundation (in plain words, for example Action)" value={payload.foundationKind} testId="foundation-kind" path="payload.foundationKind" onChange={(v) => onPayloadChange({ ...payload, foundationKind: v })} />
        {bound ? (
          <p className="gov-muted" data-testid="foundation-attack-kept">
            This Foundation is bound to an exact Weapon Attack; that binding is kept unchanged (edit the Weapon or Attack instead).
          </p>
        ) : (
          <>
            <Select label="Kind of action" value={action.category} options={opts(vocab(catalog, "foundationActionCategories"), FOUNDATION_ACTION_WORDS)} testId="foundation-action-category" path="payload.rules.action.category" onChange={(v) => putAction({ category: v })} />
            <RefChooser label="Its Maneuver Targeting" kind={kinds.maneuverTargeting} value={targeting.definition ?? null} testId="foundation-action-targeting" onChange={(ref) => putAction({ targeting: ref === null ? null : { componentKey: "targeting", definition: ref, parameters: asObject(targeting.parameters) } })} />
          </>
        )}
      </Section>
      <CostsEditor costs={payload.costContributions} parameters={[]} catalog={catalog} testId="foundation-cost" keyPrefix="foundation" kinds={kinds} branchIsManeuver onChange={(v) => onPayloadChange({ ...payload, costContributions: v })} />
      <ConstructionEditor construction={rules.construction} catalog={catalog} kinds={kinds} testId="foundation-construction" onChange={(v) => onPayloadChange({ ...payload, rules: { ...rules, construction: v } })} />
    </div>
  );
}
