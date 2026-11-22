"use client";

import {
  createContext,
  useContext,
  useId,
  useState,
  type ReactNode,
} from "react";
import type {
  AuthoringCatalogDto,
  ValidationIssueDto,
} from "../_lib/authoring-client";
import { asToken } from "../_lib/token-input";
import {
  ATTACK_TYPE_WORDS,
  COST_SHAPES,
  COST_SHAPE_WORDS,
  DIRECTIONS,
  LIMIT_SHAPES,
  MODE_SHAPES,
  MODE_WORDS,
  OPERATION_FIELDS,
  OPERATION_WORDS,
  OUTCOME_WORDS,
  PARAMETER_SHAPES,
  PARAMETER_SHAPE_WORDS,
  PREREQUISITE_SHAPES,
  RESOLUTION_POLICY_SHAPES,
  SAVE_POLICY_WORDS,
  STACK_SHAPES,
  TRAIT_EVENTS,
  TRAIT_MEASURES,
  TRAIT_MODIFICATION_SHAPES,
  TRAIT_MODIFICATION_WORDS,
  TRAIT_OPERATIONS,
  asArray,
  asObject,
  asParameterName,
  costWords,
  declaredParameters,
  nextKey,
  parameterWords,
  renameParameterReferences,
  shapeOf,
  tokenOf,
  tokenWords,
  type ParameterShape,
  initialEffectRules,
  initialTraitRules,
} from "../_lib/component-mechanics";
import { ContentTokenSelect } from "./ContentTokenSelect";
import { DefinitionReferencePicker } from "./DefinitionReferencePicker";

/**
 * RULES-WO1 Phase F — guided, game-language editors for Spell / Maneuver components (Effects and Traits) and the
 * construction rules every component shares. Authors choose what an Effect does, how it resolves, the choices a caster
 * makes, what it costs and what happens on a success or a failure — never typing a property name, choosing a data
 * type, copying a key or writing syntax. Every stored key the editor does not show is kept unchanged (lossless), and the
 * server's M5 validation remains the authority on legality.
 */
type Payload = Record<string, unknown>;
export interface MechanicsKinds {
  readonly affinity: string;
  readonly maneuverTargeting: string;
}

const words = (v: string, map?: Readonly<Record<string, string>>) =>
  map?.[v] ?? tokenWords(v);
const vocab = (catalog: AuthoringCatalogDto, name: string): readonly string[] =>
  catalog.vocabularies[name] ?? [];

/** Server issues, placed next to the control whose stored path they name (§47). */
export const MechanicsIssues = createContext<readonly ValidationIssueDto[]>([]);
function useIssues(path: string | undefined): ValidationIssueDto[] {
  const all = useContext(MechanicsIssues);
  if (path === undefined) return [];
  return all.filter(
    (i) =>
      i.path === path ||
      i.path.startsWith(`${path}.`) ||
      i.path.startsWith(`${path}[`),
  );
}
function IssueList({
  id,
  issues,
}: {
  id: string;
  issues: readonly ValidationIssueDto[];
}) {
  if (issues.length === 0) return null;
  return (
    <ul id={id} className="prowess-authoring__field-errors">
      {issues.map((i, n) => (
        <li key={n}>
          <strong>{i.severity === "ERROR" ? "Error" : "Warning"}:</strong>{" "}
          {i.message}
        </li>
      ))}
    </ul>
  );
}
const invalid = (issues: readonly ValidationIssueDto[], id: string) =>
  issues.length > 0
    ? {
        "aria-invalid": issues.some((i) => i.severity === "ERROR") || undefined,
        "aria-describedby": `${id}-issues`,
      }
    : {};

function Section({
  title,
  help,
  children,
  testId,
}: {
  title: string;
  help?: string;
  children: ReactNode;
  testId: string;
}) {
  return (
    <fieldset className="prowess-authoring__field" data-testid={testId}>
      <legend>{title}</legend>
      {help ? <p className="gov-muted">{help}</p> : null}
      {children}
    </fieldset>
  );
}

function NumberInput({
  label,
  value,
  onChange,
  testId,
  step,
  allowBlank = true,
  path,
}: {
  label: string;
  value: unknown;
  onChange: (v: number | null) => void;
  testId: string;
  step?: string;
  allowBlank?: boolean;
  path?: string;
}) {
  const id = useId();
  const issues = useIssues(path);
  return (
    <span className="gov-field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        {...invalid(issues, id)}
        type="number"
        step={step ?? "1"}
        data-testid={testId}
        value={typeof value === "number" ? String(value) : ""}
        onChange={(e) => {
          const raw = e.target.value;
          if (raw === "") onChange(allowBlank ? null : 0);
          else if (Number.isFinite(Number(raw))) onChange(Number(raw));
        }}
      />
      <IssueList id={`${id}-issues`} issues={issues} />
    </span>
  );
}

/** Words typed in plain language, stored as a token ("Roll quality" → ROLL_QUALITY). */
function WordsInput({
  label,
  value,
  onChange,
  testId,
  path,
}: {
  label: string;
  value: unknown;
  onChange: (v: string) => void;
  testId: string;
  path?: string;
}) {
  const id = useId();
  const issues = useIssues(path);
  const [typed, setTyped] = useState<string | null>(null);
  const stored = typeof value === "string" ? value : "";
  return (
    <span className="gov-field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        {...invalid(issues, id)}
        data-testid={testId}
        value={typed ?? (stored === "" ? "" : tokenWords(stored))}
        onChange={(e) => {
          setTyped(e.target.value);
          onChange(asToken(e.target.value, true));
        }}
        onBlur={() => setTyped(null)}
        autoComplete="off"
      />
      <IssueList id={`${id}-issues`} issues={issues} />
    </span>
  );
}

function Select({
  label,
  value,
  options,
  onChange,
  testId,
  blank = "Choose…",
  path,
}: {
  label: string;
  value: unknown;
  options: readonly { value: string; label: string }[];
  onChange: (v: string) => void;
  testId: string;
  blank?: string | null;
  path?: string;
}) {
  const id = useId();
  const issues = useIssues(path);
  const current = typeof value === "string" ? value : "";
  const known = options.some((o) => o.value === current);
  return (
    <span className="gov-field">
      <label htmlFor={id}>{label}</label>
      <select
        id={id}
        {...invalid(issues, id)}
        data-testid={testId}
        value={current}
        onChange={(e) => onChange(e.target.value)}
      >
        {blank !== null ? <option value="">{blank}</option> : null}
        {current !== "" && !known ? (
          <option value={current}>{tokenWords(current)} (as stored)</option>
        ) : null}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <IssueList id={`${id}-issues`} issues={issues} />
    </span>
  );
}

function Checks({
  label,
  values,
  chosen,
  onChange,
  testId,
  wordMap,
  path,
}: {
  label: string;
  values: readonly string[];
  chosen: readonly string[];
  onChange: (v: string[]) => void;
  testId: string;
  wordMap?: Readonly<Record<string, string>>;
  path?: string;
}) {
  const id = useId();
  const issues = useIssues(path);
  return (
    <div
      role="group"
      aria-label={label}
      className="prowess-authoring__checks"
      {...invalid(issues, id)}
    >
      <IssueList id={`${id}-issues`} issues={issues} />
      <p>{label}</p>
      {values.map((v) => (
        <label key={v} className="prowess-authoring__check">
          <input
            type="checkbox"
            data-testid={`${testId}-${v}`}
            checked={chosen.includes(v)}
            onChange={(e) =>
              onChange(
                e.target.checked
                  ? values.filter((x) => x === v || chosen.includes(x))
                  : chosen.filter((x) => x !== v),
              )
            }
          />{" "}
          {words(v, wordMap)}
        </label>
      ))}
    </div>
  );
}

/** One option list typed in plain words (each option stored as a token). */
function OptionList({
  label,
  values,
  onChange,
  testId,
}: {
  label: string;
  values: readonly string[];
  onChange: (v: string[]) => void;
  testId: string;
}) {
  const [draft, setDraft] = useState("");
  const id = useId();
  const add = () => {
    const t = asToken(draft, true);
    if (t !== "" && !values.includes(t)) onChange([...values, t]);
    setDraft("");
  };
  return (
    <div role="group" aria-label={label}>
      <p>{label}</p>
      {values.length === 0 ? (
        <p className="gov-muted">No options yet.</p>
      ) : null}
      <ul>
        {values.map((v) => (
          <li key={v}>
            {tokenWords(v)}{" "}
            <button
              type="button"
              className="gov-link-button"
              onClick={() => onChange(values.filter((x) => x !== v))}
              aria-label={`Remove option ${tokenWords(v)}`}
            >
              Remove
            </button>
          </li>
        ))}
      </ul>
      <label htmlFor={id}>Add an option</label>{" "}
      <input
        id={id}
        data-testid={`${testId}-new`}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            add();
          }
        }}
        autoComplete="off"
      />{" "}
      <button
        type="button"
        className="gov-button"
        data-testid={`${testId}-add`}
        onClick={add}
      >
        Add option
      </button>
    </div>
  );
}

/** An exact Definition reference, chosen by search; shown by its name. */
function RefChooser({
  label,
  kind,
  value,
  onChange,
  testId,
}: {
  label: string;
  kind: string;
  value: unknown;
  onChange: (v: Record<string, unknown> | null) => void;
  testId: string;
}) {
  const [picking, setPicking] = useState(false);
  const ref = asObject(value);
  const key =
    typeof ref.canonicalKey === "string"
      ? ref.canonicalKey
      : typeof ref.$ref === "string"
        ? ref.$ref
        : "";
  return (
    <div data-testid={testId}>
      <p>
        {label}:{" "}
        {key === "" ? (
          <span className="gov-muted">not chosen</span>
        ) : (
          <strong>
            {tokenWords((key.split(".").pop() ?? key).toUpperCase())}
          </strong>
        )}
      </p>
      {picking ? (
        <DefinitionReferencePicker
          label={`Choose ${label.toLowerCase()}`}
          definitionKind={kind}
          onSelect={(r) => {
            onChange(r as unknown as Record<string, unknown>);
            setPicking(false);
          }}
          onCancel={() => setPicking(false)}
        />
      ) : (
        <button
          type="button"
          className="gov-link-button"
          onClick={() => setPicking(true)}
        >
          {key === "" ? "Choose" : "Change"}
        </button>
      )}
      {key !== "" ? (
        <button
          type="button"
          className="gov-link-button"
          onClick={() => onChange(null)}
        >
          Clear
        </button>
      ) : null}
    </div>
  );
}

// ---- Choices made when the component is used (the M5 parameter grammar shared by Effects, Traits and Conditions) ----

export function ParametersEditor({
  parameters,
  onChange,
  catalog,
  testId,
  onRename,
  help,
  path,
}: {
  parameters: unknown;
  onChange: (v: Array<Record<string, unknown>>) => void;
  catalog: AuthoringCatalogDto;
  testId: string;
  onRename?: (from: string, to: string) => void;
  help?: string;
  path?: string;
}) {
  const list = asArray(parameters);
  const kinds = vocab(catalog, "effectParameterKinds");
  const limitKinds = vocab(catalog, "effectLimitKinds");
  const stats = vocab(catalog, "prowessStats");
  const set = (i: number, next: Record<string, unknown>) =>
    onChange(list.map((p, j) => (j === i ? next : p)));
  const shapeToken = (shape: ParameterShape) =>
    kinds.find((k) => shapeOf(PARAMETER_SHAPES, k) === shape) ??
    tokenOf(PARAMETER_SHAPES, shape);
  const blank = (
    shape: ParameterShape,
    name: string,
  ): Record<string, unknown> =>
    shape === "number"
      ? {
          parameter: name,
          kind: shapeToken(shape),
          minimum: 1,
          maximum: null,
          increment: 1,
          default: null,
        }
      : shape === "list"
        ? {
            parameter: name,
            kind: shapeToken(shape),
            allowed: [],
            default: null,
          }
        : { parameter: name, kind: shapeToken(shape), default: false };
  return (
    <Section
      title="Choices made when it is used"
      help={
        help ??
        "Each choice the caster or user makes (how many dice, which damage type, how far). Costs and outcomes below read these choices."
      }
      testId={testId}
    >
      {list.length === 0 ? <p className="gov-muted">No choices yet.</p> : null}
      {list.map((p, i) => {
        const name = typeof p.parameter === "string" ? p.parameter : "";
        const shape = shapeOf(PARAMETER_SHAPES, p.kind);
        const max = asObject(p.maximum);
        const maxShape =
          p.maximum == null ? "none" : shapeOf(LIMIT_SHAPES, max.kind);
        const allowed = Array.isArray(p.allowed) ? (p.allowed as string[]) : [];
        return (
          <div
            key={i}
            className="prowess-authoring__card"
            data-testid={`${testId}-${i}`}
          >
            <ChoiceName
              path={path === undefined ? undefined : `${path}[${i}].parameter`}
              name={name}
              testId={`${testId}-${i}-name`}
              onChange={(to) => {
                set(i, { ...p, parameter: to });
                onRename?.(name, to);
              }}
            />
            <div role="radiogroup" aria-label="Type of choice">
              {kinds.map((k) => {
                const s = shapeOf(PARAMETER_SHAPES, k);
                if (s === null) return null;
                return (
                  <label key={k} className="prowess-authoring__check">
                    <input
                      type="radio"
                      name={`${testId}-${i}-type`}
                      data-testid={`${testId}-${i}-type-${s}`}
                      checked={shape === s}
                      onChange={() => set(i, blank(s, name))}
                    />{" "}
                    {PARAMETER_SHAPE_WORDS[s]}
                  </label>
                );
              })}
            </div>
            {shape === "number" ? (
              <div>
                <NumberInput
                  label="Smallest"
                  value={p.minimum}
                  testId={`${testId}-${i}-min`}
                  path={
                    path === undefined ? undefined : `${path}[${i}].minimum`
                  }
                  onChange={(v) => set(i, { ...p, minimum: v })}
                />
                <NumberInput
                  label="In steps of"
                  value={p.increment}
                  testId={`${testId}-${i}-step`}
                  path={
                    path === undefined ? undefined : `${path}[${i}].increment`
                  }
                  onChange={(v) => set(i, { ...p, increment: v ?? 1 })}
                />
                <NumberInput
                  label="Starts at (leave empty to make the choice required)"
                  value={p.default}
                  testId={`${testId}-${i}-default`}
                  path={
                    path === undefined ? undefined : `${path}[${i}].default`
                  }
                  onChange={(v) => set(i, { ...p, default: v })}
                />
                <div role="radiogroup" aria-label="Largest">
                  <p>Largest</p>
                  <label className="prowess-authoring__check">
                    <input
                      type="radio"
                      name={`${testId}-${i}-max`}
                      data-testid={`${testId}-${i}-max-none`}
                      checked={maxShape === "none"}
                      onChange={() => set(i, { ...p, maximum: null })}
                    />{" "}
                    No limit
                  </label>
                  {limitKinds.map((k) => {
                    const s = shapeOf(LIMIT_SHAPES, k);
                    if (s === null) return null;
                    return (
                      <label key={k} className="prowess-authoring__check">
                        <input
                          type="radio"
                          name={`${testId}-${i}-max`}
                          data-testid={`${testId}-${i}-max-${s}`}
                          checked={maxShape === s}
                          onChange={() =>
                            set(i, {
                              ...p,
                              maximum:
                                s === "fixed"
                                  ? { kind: k, value: 1 }
                                  : { kind: k, stat: "" },
                            })
                          }
                        />{" "}
                        {s === "fixed"
                          ? "A fixed number"
                          : "Up to the user's Stat"}
                      </label>
                    );
                  })}
                  {maxShape === "fixed" ? (
                    <NumberInput
                      label="Largest number"
                      value={max.value}
                      testId={`${testId}-${i}-max-value`}
                      path={
                        path === undefined ? undefined : `${path}[${i}].maximum`
                      }
                      onChange={(v) =>
                        set(i, { ...p, maximum: { ...max, value: v ?? 0 } })
                      }
                    />
                  ) : null}
                  {maxShape === "stat" ? (
                    <Select
                      label="Stat"
                      value={max.stat}
                      options={stats.map((s) => ({ value: s, label: s }))}
                      testId={`${testId}-${i}-max-stat-choice`}
                      onChange={(v) =>
                        set(i, { ...p, maximum: { ...max, stat: v } })
                      }
                    />
                  ) : null}
                </div>
              </div>
            ) : null}
            {shape === "list" ? (
              <div>
                <OptionList
                  label="Options"
                  values={allowed}
                  testId={`${testId}-${i}-options`}
                  onChange={(v) =>
                    set(i, {
                      ...p,
                      allowed: v,
                      default:
                        typeof p.default === "string" && v.includes(p.default)
                          ? p.default
                          : null,
                    })
                  }
                />
                <Select
                  label="Chosen by default"
                  value={p.default ?? ""}
                  blank="Nothing — the choice is required"
                  options={allowed.map((a) => ({
                    value: a,
                    label: tokenWords(a),
                  }))}
                  testId={`${testId}-${i}-default`}
                  path={
                    path === undefined ? undefined : `${path}[${i}].default`
                  }
                  onChange={(v) =>
                    set(i, { ...p, default: v === "" ? null : v })
                  }
                />
              </div>
            ) : null}
            {shape === "yesno" ? (
              <label className="prowess-authoring__check">
                <input
                  type="checkbox"
                  data-testid={`${testId}-${i}-default`}
                  checked={p.default === true}
                  onChange={(e) => set(i, { ...p, default: e.target.checked })}
                />{" "}
                Yes by default
              </label>
            ) : null}
            <button
              type="button"
              className="gov-link-button"
              onClick={() => onChange(list.filter((_, j) => j !== i))}
            >
              Remove this choice
            </button>
          </div>
        );
      })}
      <button
        type="button"
        className="gov-button"
        data-testid={`${testId}-add`}
        onClick={() => onChange([...list, blank("number", "")])}
      >
        Add a choice
      </button>
    </Section>
  );
}

function ChoiceName({
  name,
  onChange,
  testId,
  path,
}: {
  name: string;
  onChange: (v: string) => void;
  testId: string;
  path?: string;
}) {
  const id = useId();
  const issues = useIssues(path);
  const [typed, setTyped] = useState<string | null>(null);
  return (
    <span className="gov-field">
      <label htmlFor={id}>Name of the choice</label>
      <input
        id={id}
        {...invalid(issues, id)}
        data-testid={testId}
        value={typed ?? parameterWords(name)}
        onChange={(e) => {
          setTyped(e.target.value);
          onChange(asParameterName(e.target.value));
        }}
        onBlur={() => setTyped(null)}
        placeholder="for example Damage dice"
        autoComplete="off"
      />
      <IssueList id={`${id}-issues`} issues={issues} />
    </span>
  );
}

// ---- Listed costs (the M5 cost grammar: a fixed amount, per step of a number choice, by an option chosen) ----------

export function CostsEditor({
  costs,
  onChange,
  parameters,
  catalog,
  testId,
  keyPrefix,
  extra,
  kinds,
  branchIsManeuver,
}: {
  costs: unknown;
  onChange: (v: Array<Record<string, unknown>>) => void;
  parameters: unknown;
  catalog: AuthoringCatalogDto;
  testId: string;
  keyPrefix: string;
  /** Extra controls per cost (an Ability Condition's meaning / option). */
  extra?: (
    cost: Record<string, unknown>,
    set: (next: Record<string, unknown>) => void,
    i: number,
  ) => ReactNode;
  kinds: MechanicsKinds;
  branchIsManeuver: boolean;
}) {
  const list = asArray(costs);
  const currencies = vocab(catalog, "costCurrencies");
  const costKinds = vocab(catalog, "effectCostKinds");
  const ranks = vocab(catalog, "affinityRanks");
  const declared = declaredParameters(parameters);
  const numbers = declared.filter((d) => d.shape === "number" && d.name !== "");
  const lists = declared.filter((d) => d.shape === "list" && d.name !== "");
  const set = (i: number, next: Record<string, unknown>) =>
    onChange(list.map((c, j) => (j === i ? next : c)));
  return (
    <Section
      title="Costs"
      help="What using it costs, in AP or MP. The Rules Engine adds these up in the Spell or Maneuver builder — this editor never computes a total."
      testId={testId}
    >
      {list.length === 0 ? <p className="gov-muted">No costs yet.</p> : null}
      {list.map((c, i) => {
        const data = asObject(c.data);
        const shape = shapeOf(COST_SHAPES, data.kind);
        const chosen = lists.find((l) => l.name === data.parameter);
        const reduction =
          data.affinityReduction === undefined
            ? null
            : asObject(data.affinityReduction);
        const setData = (d: Record<string, unknown>) =>
          set(i, { ...c, data: d });
        return (
          <div
            key={i}
            className="prowess-authoring__card"
            data-testid={`${testId}-${i}`}
          >
            <p className="gov-muted" data-testid={`${testId}-${i}-summary`}>
              {costWords(c)}
            </p>
            <CostIssues i={i} />
            <Select
              label="Paid in"
              value={c.currency}
              options={currencies.map((v) => ({ value: v, label: v }))}
              testId={`${testId}-${i}-currency`}
              path={`payload.costContributions[${i}].currency`}
              onChange={(v) => set(i, { ...c, currency: v })}
            />
            <div role="radiogroup" aria-label="How it is charged">
              {costKinds.map((k) => {
                const s = shapeOf(COST_SHAPES, k);
                if (s === null) return null;
                const keep = Object.fromEntries(
                  Object.entries(data).filter(
                    ([key]) =>
                      ![
                        "kind",
                        "amount",
                        "parameter",
                        "includedUnits",
                        "amounts",
                        "affinityReduction",
                      ].includes(key),
                  ),
                );
                return (
                  <label key={k} className="prowess-authoring__check">
                    <input
                      type="radio"
                      name={`${testId}-${i}-shape`}
                      data-testid={`${testId}-${i}-shape-${s}`}
                      checked={shape === s}
                      onChange={() =>
                        setData(
                          s === "fixed"
                            ? { ...keep, kind: k, amount: 0 }
                            : s === "perNumber"
                              ? {
                                  ...keep,
                                  kind: k,
                                  parameter: numbers[0]?.name ?? "",
                                  amount: 0,
                                  includedUnits: 0,
                                }
                              : {
                                  ...keep,
                                  kind: k,
                                  parameter: lists[0]?.name ?? "",
                                  amounts: Object.fromEntries(
                                    (lists[0]?.allowed ?? []).map((a) => [
                                      a,
                                      0,
                                    ]),
                                  ),
                                },
                        )
                      }
                    />{" "}
                    {COST_SHAPE_WORDS[s]}
                  </label>
                );
              })}
            </div>
            {shape === "fixed" || shape === "perNumber" ? (
              <NumberInput
                label={shape === "fixed" ? "Amount" : "Amount for each step"}
                value={data.amount}
                testId={`${testId}-${i}-amount`}
                path={`payload.costContributions[${i}].data.amount`}
                onChange={(v) => setData({ ...data, amount: v ?? 0 })}
                allowBlank={false}
              />
            ) : null}
            {shape === "perNumber" ? (
              <>
                <Select
                  label="For each step of the choice"
                  value={data.parameter}
                  options={numbers.map((n) => ({
                    value: n.name,
                    label: parameterWords(n.name),
                  }))}
                  testId={`${testId}-${i}-parameter`}
                  path={`payload.costContributions[${i}].data.parameter`}
                  blank={
                    numbers.length === 0
                      ? "Add a number choice first"
                      : "Choose…"
                  }
                  onChange={(v) => setData({ ...data, parameter: v })}
                />
                <NumberInput
                  label="Steps included free"
                  value={data.includedUnits ?? 0}
                  testId={`${testId}-${i}-included`}
                  path={`payload.costContributions[${i}].data.includedUnits`}
                  onChange={(v) => setData({ ...data, includedUnits: v ?? 0 })}
                  allowBlank={false}
                />
              </>
            ) : null}
            {shape === "perOption" ? (
              <>
                <Select
                  label="Depends on the choice"
                  value={data.parameter}
                  options={lists.map((n) => ({
                    value: n.name,
                    label: parameterWords(n.name),
                  }))}
                  testId={`${testId}-${i}-parameter`}
                  path={`payload.costContributions[${i}].data.parameter`}
                  blank={
                    lists.length === 0 ? "Add a list choice first" : "Choose…"
                  }
                  onChange={(v) =>
                    setData({
                      ...data,
                      parameter: v,
                      amounts: Object.fromEntries(
                        (lists.find((l) => l.name === v)?.allowed ?? []).map(
                          (a) => [a, asObject(data.amounts)[a] ?? 0],
                        ),
                      ),
                    })
                  }
                />
                {(chosen?.allowed ?? []).map((opt) => (
                  <NumberInput
                    key={opt}
                    label={`Amount for ${tokenWords(opt)}`}
                    value={asObject(data.amounts)[opt]}
                    testId={`${testId}-${i}-amount-${opt}`}
                    onChange={(v) =>
                      setData({
                        ...data,
                        amounts: { ...asObject(data.amounts), [opt]: v ?? 0 },
                      })
                    }
                    allowBlank={false}
                  />
                ))}
              </>
            ) : null}
            {branchIsManeuver && shape === "fixed" ? (
              <div>
                <label className="prowess-authoring__check">
                  <input
                    type="checkbox"
                    data-testid={`${testId}-${i}-affinity`}
                    checked={reduction !== null}
                    onChange={(e) =>
                      setData(
                        e.target.checked
                          ? {
                              ...data,
                              affinityReduction: {
                                affinities: [],
                                byRank: {},
                                minimum: 0,
                              },
                            }
                          : Object.fromEntries(
                              Object.entries(data).filter(
                                ([k]) => k !== "affinityReduction",
                              ),
                            ),
                      )
                    }
                  />{" "}
                  Reduced by the user&rsquo;s rank in a relevant Affinity
                </label>
                {reduction !== null ? (
                  <div>
                    <RefList
                      label="Relevant Affinities"
                      kind={kinds.affinity}
                      value={reduction.affinities}
                      onChange={(v) =>
                        setData({
                          ...data,
                          affinityReduction: { ...reduction, affinities: v },
                        })
                      }
                      testId={`${testId}-${i}-affinities`}
                    />
                    {ranks.map((r) => (
                      <NumberInput
                        key={r}
                        label={`Reduction at ${tokenWords(r)}`}
                        value={asObject(reduction.byRank)[r]}
                        testId={`${testId}-${i}-rank-${r}`}
                        onChange={(v) => {
                          const byRank = { ...asObject(reduction.byRank) };
                          if (v === null) delete byRank[r];
                          else byRank[r] = v;
                          setData({
                            ...data,
                            affinityReduction: { ...reduction, byRank },
                          });
                        }}
                      />
                    ))}
                    <NumberInput
                      label="Never below"
                      value={reduction.minimum}
                      testId={`${testId}-${i}-minimum`}
                      onChange={(v) =>
                        setData({
                          ...data,
                          affinityReduction: { ...reduction, minimum: v ?? 0 },
                        })
                      }
                      allowBlank={false}
                    />
                  </div>
                ) : null}
              </div>
            ) : null}
            {extra?.(c, (next) => set(i, next), i)}
            <button
              type="button"
              className="gov-link-button"
              onClick={() => onChange(list.filter((_, j) => j !== i))}
            >
              Remove this cost
            </button>
          </div>
        );
      })}
      <button
        type="button"
        className="gov-button"
        data-testid={`${testId}-add`}
        onClick={() =>
          onChange([
            ...list,
            {
              contributionKey: nextKey(
                list.map((c) => String(c.contributionKey ?? "")),
                keyPrefix,
              ),
              currency: currencies[0] ?? "",
              data: {
                kind:
                  costKinds.find((k) => shapeOf(COST_SHAPES, k) === "fixed") ??
                  "",
                amount: 0,
              },
            },
          ])
        }
      >
        Add a cost
      </button>
    </Section>
  );
}

function CostIssues({ i }: { i: number }) {
  const all = useIssues(`payload.costContributions[${i}]`);
  return (
    <IssueList
      id={`cost-${i}-issues`}
      issues={all.filter(
        (x) => !/(currency|amount|parameter|includedUnits)$/.test(x.path),
      )}
    />
  );
}

function RefList({
  label,
  kind,
  value,
  onChange,
  testId,
}: {
  label: string;
  kind: string;
  value: unknown;
  onChange: (v: Array<Record<string, unknown>>) => void;
  testId: string;
}) {
  const [picking, setPicking] = useState(false);
  const list = asArray(value);
  const nameOf = (r: Record<string, unknown>) => {
    const key =
      typeof r.canonicalKey === "string"
        ? r.canonicalKey
        : typeof r.$ref === "string"
          ? r.$ref
          : "?";
    return tokenWords((key.split(".").pop() ?? key).toUpperCase());
  };
  return (
    <div data-testid={testId} role="group" aria-label={label}>
      <p>{label}</p>
      {list.length === 0 ? <p className="gov-muted">None chosen.</p> : null}
      <ul>
        {list.map((r, i) => (
          <li key={i}>
            {nameOf(r)}{" "}
            <button
              type="button"
              className="gov-link-button"
              onClick={() => onChange(list.filter((_, j) => j !== i))}
              aria-label={`Remove ${nameOf(r)}`}
            >
              Remove
            </button>
          </li>
        ))}
      </ul>
      {picking ? (
        <DefinitionReferencePicker
          label={`Add to ${label.toLowerCase()}`}
          definitionKind={kind}
          onSelect={(r) => {
            onChange([...list, r as unknown as Record<string, unknown>]);
            setPicking(false);
          }}
          onCancel={() => setPicking(false)}
        />
      ) : (
        <button
          type="button"
          className="gov-link-button"
          onClick={() => setPicking(true)}
        >
          Add
        </button>
      )}
    </div>
  );
}

// ---- Construction rules shared by every component: requirements to build with it, stacking, Affinity access ---------

export function ConstructionEditor({
  construction,
  onChange,
  catalog,
  kinds,
  testId,
}: {
  construction: unknown;
  onChange: (v: Record<string, unknown> | undefined) => void;
  catalog: AuthoringCatalogDto;
  kinds: MechanicsKinds;
  testId: string;
}) {
  const c = asObject(construction);
  const pre = asArray(c.prerequisites);
  const preKinds = vocab(catalog, "constructionPrerequisiteKinds");
  const affinityRanks = vocab(catalog, "affinityRanks");
  const stackKinds = vocab(catalog, "stackLimitKinds");
  const tracks = vocab(catalog, "constructionSkillTracks");
  const stacking = asObject(c.stacking);
  const limit = asObject(stacking.limit);
  const stackShape =
    stacking.stackable === true ? shapeOf(STACK_SHAPES, limit.kind) : "no";
  const put = (patch: Record<string, unknown>) => onChange({ ...c, ...patch });
  const setPre = (i: number, next: Record<string, unknown>) =>
    put({ prerequisites: pre.map((p, j) => (j === i ? next : p)) });
  const keyFor = (p: Record<string, unknown>, i: number) => {
    const base =
      shapeOf(PREREQUISITE_SHAPES, p.kind) === "skill"
        ? `${String(p.skillKey ?? "")} ${String(p.minimumRank ?? "")}`
        : `${String(asObject(p.affinity).canonicalKey ?? asObject(p.affinity).$ref ?? "")} ${String(p.minimumRank ?? "")}`;
    const token = asToken(base, true) || `REQUIREMENT_${i + 1}`;
    return pre.some((q, j) => j !== i && q.prerequisiteKey === token)
      ? `${token}_${i + 1}`
      : token;
  };
  const withKey = (i: number, next: Record<string, unknown>) =>
    setPre(i, { ...next, prerequisiteKey: keyFor(next, i) });
  return (
    <Section
      title="To build with it"
      help="What a character needs before a Spell or Maneuver may include this component, whether it can be taken more than once, and which Affinities give access to it."
      testId={testId}
    >
      {pre.length === 0 ? <p className="gov-muted">No requirements.</p> : null}
      {pre.map((p, i) => {
        const shape = shapeOf(PREREQUISITE_SHAPES, p.kind);
        return (
          <div
            key={i}
            className="prowess-authoring__card"
            data-testid={`${testId}-requirement-${i}`}
          >
            {shape === "skill" ? (
              <>
                <span className="gov-field">
                  <label htmlFor={`${testId}-${i}-skill`}>Skill</label>
                  <ContentTokenSelect
                    id={`${testId}-${i}-skill`}
                    value={p.skillKey}
                    options="skills"
                    onChange={(v) => withKey(i, { ...p, skillKey: v })}
                  />
                </span>
                <span className="gov-field">
                  <label htmlFor={`${testId}-${i}-rank`}>
                    At least this rank
                  </label>
                  <ContentTokenSelect
                    id={`${testId}-${i}-rank`}
                    value={p.minimumRank}
                    options="skillRanks"
                    onChange={(v) => withKey(i, { ...p, minimumRank: v })}
                  />
                </span>
              </>
            ) : (
              <>
                <RefChooser
                  label="Affinity"
                  kind={kinds.affinity}
                  value={p.affinity}
                  onChange={(v) => withKey(i, { ...p, affinity: v })}
                  testId={`${testId}-${i}-affinity`}
                />
                <Select
                  label="At least this Affinity rank"
                  value={p.minimumRank}
                  options={affinityRanks.map((r) => ({
                    value: r,
                    label: tokenWords(r),
                  }))}
                  testId={`${testId}-${i}-affinity-rank`}
                  onChange={(v) => withKey(i, { ...p, minimumRank: v })}
                />
              </>
            )}
            <button
              type="button"
              className="gov-link-button"
              onClick={() =>
                put({ prerequisites: pre.filter((_, j) => j !== i) })
              }
            >
              Remove this requirement
            </button>
          </div>
        );
      })}
      {preKinds.map((k) => {
        const s = shapeOf(PREREQUISITE_SHAPES, k);
        if (s === null) return null;
        return (
          <button
            key={k}
            type="button"
            className="gov-button"
            data-testid={`${testId}-add-${s}`}
            onClick={() =>
              put({
                prerequisites: [
                  ...pre,
                  s === "skill"
                    ? {
                        prerequisiteKey: `REQUIREMENT_${pre.length + 1}`,
                        kind: k,
                        skillKey: "",
                        minimumRank: "",
                      }
                    : {
                        prerequisiteKey: `REQUIREMENT_${pre.length + 1}`,
                        kind: k,
                        affinity: null,
                        minimumRank: "",
                      },
                ],
              })
            }
          >
            {s === "skill"
              ? "Requires a Skill rank"
              : "Requires an Affinity rank"}
          </button>
        );
      })}
      <div role="radiogroup" aria-label="Taken more than once">
        <p>Can it be taken more than once in one Spell or Maneuver?</p>
        <label className="prowess-authoring__check">
          <input
            type="radio"
            name={`${testId}-stack`}
            data-testid={`${testId}-stack-no`}
            checked={stackShape === "no"}
            onChange={() => put({ stacking: { stackable: false } })}
          />{" "}
          No
        </label>
        {stackKinds.map((k) => {
          const s = shapeOf(STACK_SHAPES, k);
          if (s === null) return null;
          return (
            <label key={k} className="prowess-authoring__check">
              <input
                type="radio"
                name={`${testId}-stack`}
                data-testid={`${testId}-stack-${s}`}
                checked={stackShape === s}
                onChange={() =>
                  put({
                    stacking: {
                      stackable: true,
                      limit:
                        s === "fixed"
                          ? { kind: k, maximum: 2 }
                          : { kind: k, track: tracks[0] ?? "" },
                    },
                  })
                }
              />{" "}
              {s === "fixed"
                ? "Yes, up to a fixed number of times"
                : "Yes, up to the Rank Value of a training track"}
            </label>
          );
        })}
        {stackShape === "fixed" ? (
          <NumberInput
            label="Up to this many times"
            value={limit.maximum}
            testId={`${testId}-stack-maximum`}
            onChange={(v) =>
              put({
                stacking: { ...stacking, limit: { ...limit, maximum: v ?? 1 } },
              })
            }
            allowBlank={false}
          />
        ) : null}
        {stackShape === "track" ? (
          <Select
            label="Training track"
            value={limit.track}
            options={tracks.map((t) => ({ value: t, label: tokenWords(t) }))}
            testId={`${testId}-stack-track`}
            onChange={(v) =>
              put({ stacking: { ...stacking, limit: { ...limit, track: v } } })
            }
          />
        ) : null}
      </div>
      <RefList
        label="Affinities that give access to it"
        kind={kinds.affinity}
        value={c.affinityAccess}
        onChange={(v) => put({ affinityAccess: v })}
        testId={`${testId}-affinity-access`}
      />
    </Section>
  );
}

// ---- The Effect: what it does, how it resolves, its choices, costs and outcomes -------------------------------------

export function EffectMechanicsEditor({
  branch,
  maneuver,
  payload,
  onPayloadChange,
  catalog,
  kinds,
}: {
  branch: string;
  maneuver: boolean;
  payload: Payload;
  onPayloadChange: (p: Payload) => void;
  catalog: AuthoringCatalogDto;
  kinds: MechanicsKinds;
}) {
  const policies = vocab(catalog, "effectResolutionPolicies");
  const ownPolicy =
    policies.find((p) => shapeOf(RESOLUTION_POLICY_SHAPES, p) === "own") ??
    tokenOf(RESOLUTION_POLICY_SHAPES, "own");
  const inheritPolicy =
    policies.find((p) => shapeOf(RESOLUTION_POLICY_SHAPES, p) === "inherit") ??
    tokenOf(RESOLUTION_POLICY_SHAPES, "inherit");
  const rules = asObject(payload.rules);
  const effect =
    rules.effect === undefined
      ? initialEffectRules(branch, ownPolicy)
      : asObject(rules.effect);
  const putEffect = (patch: Record<string, unknown>, top: Payload = {}) =>
    onPayloadChange({
      ...payload,
      ...top,
      rules: { ...rules, effect: { ...effect, ...patch } },
    });
  const resolution =
    payload.resolution === null || payload.resolution === undefined
      ? null
      : asObject(payload.resolution);
  const inherits =
    shapeOf(RESOLUTION_POLICY_SHAPES, effect.resolutionPolicy) === "inherit";
  const modeShape =
    resolution === null ? null : shapeOf(MODE_SHAPES, resolution.mode);
  const save = asObject(effect.saveProfile);
  const duration = asObject(effect.duration);
  const families = vocab(catalog, "spellEffectFamilies");
  const subfamilies = vocab(catalog, "effectSubfamilies");
  const modes = vocab(catalog, "resolutionModes");
  const parameters = effect.parameters;
  const outcomes = asArray(payload.outcomes);
  const outcomeKeys = vocab(catalog, "effectOutcomeKeys");
  const formulas = asArray(effect.formulas);
  const extraTop =
    typeof payload.parameters === "object" &&
    payload.parameters !== null &&
    Object.keys(payload.parameters).length > 0;
  const setResolution = (next: { mode: string } | "inherit") => {
    if (next === "inherit")
      return putEffect(
        {
          resolutionPolicy: inheritPolicy,
          attackType: null,
          saveProfile: null,
        },
        { resolution: null },
      );
    const shape = shapeOf(MODE_SHAPES, next.mode);
    putEffect(
      {
        resolutionPolicy: ownPolicy,
        attackType: shape === "attack" ? (effect.attackType ?? null) : null,
        saveProfile:
          shape === "save"
            ? (effect.saveProfile ?? { validSaves: [], selectionPolicy: "" })
            : null,
      },
      { resolution: { mode: next.mode, data: resolution?.data ?? {} } },
    );
  };
  return (
    <div
      className="prowess-authoring__mechanics"
      data-testid="effect-mechanics"
    >
      <Section title="What it does" testId="effect-what">
        {maneuver ? (
          <WordsInput
            label="Effect family (for example Damage, or Targeting conversion)"
            value={payload.effectFamily}
            testId="effect-family"
            path="payload.effectFamily"
            onChange={(v) => onPayloadChange({ ...payload, effectFamily: v })}
          />
        ) : (
          <Select
            label="Effect family"
            value={payload.effectFamily}
            options={families.map((f) => ({ value: f, label: tokenWords(f) }))}
            testId="effect-family"
            path="payload.effectFamily"
            onChange={(v) => onPayloadChange({ ...payload, effectFamily: v })}
          />
        )}
        <Select
          label="Kind of effect (optional)"
          value={effect.effectSubfamily ?? ""}
          blank="None"
          options={subfamilies.map((f) => ({ value: f, label: tokenWords(f) }))}
          testId="effect-subfamily"
          path="payload.rules.effect.effectSubfamily"
          onChange={(v) => putEffect({ effectSubfamily: v === "" ? null : v })}
        />
        <Checks
          label="It can affect"
          values={vocab(catalog, "targetCategories")}
          chosen={
            Array.isArray(effect.targetCategories)
              ? (effect.targetCategories as string[])
              : []
          }
          testId="effect-target"
          path="payload.rules.effect.targetCategories"
          onChange={(v) => putEffect({ targetCategories: v })}
        />
      </Section>

      <Section title="How it resolves" testId="effect-resolution">
        <ResolutionIssues />
        <div role="radiogroup" aria-label="How it resolves">
          {modes.map((m) => (
            <label key={m} className="prowess-authoring__check">
              <input
                type="radio"
                name="effect-resolution"
                data-testid={`effect-resolution-${shapeOf(MODE_SHAPES, m) ?? m}`}
                checked={!inherits && resolution?.mode === m}
                onChange={() => setResolution({ mode: m })}
              />{" "}
              {words(m, MODE_WORDS)}
            </label>
          ))}
          {maneuver ? (
            <label className="prowess-authoring__check">
              <input
                type="radio"
                name="effect-resolution"
                data-testid="effect-resolution-inherit"
                checked={inherits}
                onChange={() => setResolution("inherit")}
              />{" "}
              It uses the Maneuver&rsquo;s own roll
            </label>
          ) : null}
        </div>
        {modeShape === "attack" ? (
          <Select
            label="Kind of attack"
            value={effect.attackType ?? ""}
            options={vocab(catalog, "effectAttackTypes").map((a) => ({
              value: a,
              label: words(a, ATTACK_TYPE_WORDS),
            }))}
            testId="effect-attack-type"
            path="payload.rules.effect.attackType"
            onChange={(v) => putEffect({ attackType: v === "" ? null : v })}
          />
        ) : null}
        {modeShape === "save" ? (
          <>
            <Checks
              label="Saving Throws it allows"
              values={vocab(catalog, "prowessStats")}
              chosen={
                Array.isArray(save.validSaves)
                  ? (save.validSaves as string[])
                  : []
              }
              testId="effect-save"
              path="payload.rules.effect.saveProfile"
              onChange={(v) =>
                putEffect({ saveProfile: { ...save, validSaves: v } })
              }
              wordMap={Object.fromEntries(
                vocab(catalog, "prowessStats").map((s) => [s, s]),
              )}
            />
            <Select
              label="Which Save is used"
              value={save.selectionPolicy ?? ""}
              options={vocab(catalog, "effectSaveSelectionPolicies").map(
                (s) => ({ value: s, label: words(s, SAVE_POLICY_WORDS) }),
              )}
              testId="effect-save-policy"
              path="payload.rules.effect.saveProfile.selectionPolicy"
              onChange={(v) =>
                putEffect({ saveProfile: { ...save, selectionPolicy: v } })
              }
            />
          </>
        ) : null}
      </Section>

      <ParametersEditor
        parameters={parameters}
        catalog={catalog}
        testId="effect-parameter"
        path="payload.rules.effect.parameters"
        onChange={(v) => putEffect({ parameters: v })}
        onRename={(from, to) => {
          const renamed = renameParameterReferences(payload, from, to);
          const r = asObject(renamed.rules);
          const e = asObject(r.effect ?? effect);
          onPayloadChange({
            ...renamed,
            rules: {
              ...r,
              effect: {
                ...e,
                parameters: asArray(e.parameters).map((p) =>
                  p.parameter === from ? { ...p, parameter: to } : p,
                ),
              },
            },
          });
        }}
      />

      <CostsEditor
        costs={payload.costContributions}
        parameters={parameters}
        catalog={catalog}
        testId="effect-cost"
        keyPrefix="cost"
        kinds={kinds}
        branchIsManeuver={maneuver}
        onChange={(v) => onPayloadChange({ ...payload, costContributions: v })}
      />

      <Section
        title="What happens"
        help="What the Effect does on a success and on a failure. Each line reads the choices above."
        testId="effect-outcomes"
      >
        {outcomeKeys.map((key) => {
          const index = outcomes.findIndex((o) => o.outcomeKey === key);
          const outcome = index < 0 ? null : outcomes[index]!;
          const ops = asArray(asObject(outcome?.data).operations);
          const setOps = (
            next: Array<Record<string, unknown>>,
            effectPatch?: Record<string, unknown>,
          ) => {
            const nextOutcome = {
              ...(outcome ?? { outcomeKey: key }),
              data: { ...asObject(outcome?.data), operations: next },
            };
            const nextOutcomes =
              index < 0
                ? [...outcomes, nextOutcome]
                : outcomes.map((o, j) => (j === index ? nextOutcome : o));
            if (effectPatch === undefined)
              onPayloadChange({ ...payload, outcomes: nextOutcomes });
            else putEffect(effectPatch, { outcomes: nextOutcomes });
          };
          return (
            <div
              key={key}
              className="prowess-authoring__card"
              data-testid={`effect-outcome-${key}`}
            >
              <h5>{words(key, OUTCOME_WORDS)}</h5>
              {ops.length === 0 ? (
                <p className="gov-muted">Nothing set yet.</p>
              ) : null}
              {ops.map((op, j) => (
                <OperationRow
                  key={j}
                  path={
                    index < 0
                      ? undefined
                      : `payload.outcomes[${index}].data.operations[${j}]`
                  }
                  op={op}
                  parameters={parameters}
                  testId={`effect-outcome-${key}-${j}`}
                  kinds={kinds}
                  onChange={(next, effectPatch) =>
                    setOps(
                      ops.map((o, k) => (k === j ? next : o)),
                      effectPatch,
                    )
                  }
                  onRemove={() => setOps(ops.filter((_, k) => k !== j))}
                />
              ))}
              <Select
                label="Add what happens"
                value=""
                options={vocab(catalog, "effectOutcomeOperations").map((o) => ({
                  value: o,
                  label: words(o, OPERATION_WORDS),
                }))}
                testId={`effect-outcome-${key}-add`}
                blank="Choose…"
                onChange={(v) =>
                  v !== "" && setOps([...ops, { kind: v, data: {} }])
                }
              />
            </div>
          );
        })}
        {outcomes.filter((o) => !outcomeKeys.includes(String(o.outcomeKey)))
          .length > 0 ? (
          <p className="gov-muted">
            This Effect also stores other outcomes; they are kept unchanged.
          </p>
        ) : null}
      </Section>

      <Section title="How long it lasts" testId="effect-duration">
        <Checks
          label="Durations it allows"
          values={vocab(catalog, "durationConcepts")}
          chosen={
            Array.isArray(duration.allowed)
              ? (duration.allowed as string[])
              : []
          }
          testId="effect-duration"
          path="payload.rules.effect.duration"
          onChange={(v) =>
            putEffect({
              duration: {
                ...duration,
                allowed: v,
                default:
                  typeof duration.default === "string" &&
                  v.includes(duration.default)
                    ? duration.default
                    : null,
              },
            })
          }
        />
        <Select
          label="Default duration"
          value={duration.default ?? ""}
          blank="None"
          options={(Array.isArray(duration.allowed)
            ? (duration.allowed as string[])
            : []
          ).map((d) => ({ value: d, label: tokenWords(d) }))}
          testId="effect-duration-default"
          path="payload.rules.effect.duration.default"
          onChange={(v) =>
            putEffect({
              duration: { ...duration, default: v === "" ? null : v },
            })
          }
        />
        <label className="prowess-authoring__check">
          <input
            type="checkbox"
            data-testid="effect-duration-sustain"
            checked={duration.sustainEligible === true}
            onChange={(e) =>
              putEffect({
                duration: { ...duration, sustainEligible: e.target.checked },
              })
            }
          />{" "}
          It can be Sustained
        </label>
        <label className="prowess-authoring__check">
          <input
            type="checkbox"
            data-testid="effect-duration-manalock"
            checked={duration.manaLockEligible === true}
            onChange={(e) =>
              putEffect({
                duration: { ...duration, manaLockEligible: e.target.checked },
              })
            }
          />{" "}
          It can be held with a Mana Lock
        </label>
      </Section>

      <ConstructionEditor
        construction={rules.construction}
        catalog={catalog}
        kinds={kinds}
        testId="effect-construction"
        onChange={(v) =>
          onPayloadChange({
            ...payload,
            rules: {
              ...rules,
              ...(rules.effect === undefined ? {} : { effect }),
              construction: v,
            },
          })
        }
      />

      <Section
        title="Restrictions"
        help="Named limits on this Effect, in plain words (for example Removes only the authored category)."
        testId="effect-restrictions"
      >
        <OptionList
          label="Restrictions"
          values={
            Array.isArray(effect.restrictions)
              ? (effect.restrictions as string[])
              : []
          }
          testId="effect-restriction"
          onChange={(v) => putEffect({ restrictions: v })}
        />
      </Section>

      {formulas.length > 0 || extraTop ? (
        <p className="gov-muted" data-testid="effect-kept">
          {formulas.length > 0
            ? `This Effect also has ${formulas.length} authored formula${formulas.length === 1 ? "" : "s"}; ${formulas.length === 1 ? "it is" : "they are"} kept unchanged. `
            : ""}
          {extraTop
            ? "It also stores older parameter data, kept unchanged."
            : ""}
        </p>
      ) : null}
    </div>
  );
}

function ResolutionIssues() {
  const a = useIssues("payload.resolution");
  const b = useIssues("payload.rules.effect.resolutionPolicy");
  return <IssueList id="effect-resolution-issues" issues={[...a, ...b]} />;
}

function OperationRow({
  op,
  parameters,
  testId,
  onChange,
  onRemove,
  kinds,
  path,
}: {
  path?: string;
  op: Record<string, unknown>;
  parameters: unknown;
  testId: string;
  onChange: (
    v: Record<string, unknown>,
    effectPatch?: Record<string, unknown>,
  ) => void;
  onRemove: () => void;
  kinds: MechanicsKinds;
}) {
  const kind = String(op.kind ?? "");
  const data = asObject(op.data);
  const fields = OPERATION_FIELDS[kind] ?? [];
  const declared = declaredParameters(parameters).filter((d) => d.name !== "");
  const shown = new Set(fields.map((f) => f.key));
  const others = Object.keys(data).filter((k) => !shown.has(k));
  const dataWith = (key: string, v: unknown) =>
    v === undefined
      ? Object.fromEntries(Object.entries(data).filter(([k]) => k !== key))
      : { ...data, [key]: v };
  const setData = (key: string, v: unknown) =>
    onChange({ ...op, data: dataWith(key, v) });
  const opIssues = useIssues(path);
  return (
    <div className="prowess-authoring__operation" data-testid={testId}>
      <IssueList
        id={`${testId}-issues`}
        issues={opIssues.filter((x) => !/\.data\.[A-Za-z]+$/.test(x.path))}
      />
      <p>
        <strong>{words(kind, OPERATION_WORDS)}</strong>
      </p>
      {fields.map((f) => {
        const ft = `${testId}-${f.key}`;
        if (f.control === "number" || f.control === "list") {
          const options = declared
            .filter(
              (d) => d.shape === (f.control === "number" ? "number" : "list"),
            )
            .map((d) => ({ value: d.name, label: parameterWords(d.name) }));
          return (
            <Select
              key={f.key}
              label={f.label}
              value={data[f.key] ?? ""}
              options={options}
              testId={ft}
              path={path === undefined ? undefined : `${path}.data.${f.key}`}
              blank={
                f.optional
                  ? "Not used"
                  : options.length === 0
                    ? `Add a ${f.control === "number" ? "number" : "list"} choice first`
                    : "Choose…"
              }
              onChange={(v) =>
                setData(f.key, v === "" ? (f.optional ? undefined : "") : v)
              }
            />
          );
        }
        if (f.control === "words")
          return (
            <WordsInput
              key={f.key}
              label={f.label}
              value={data[f.key]}
              testId={ft}
              onChange={(v) => setData(f.key, v)}
            />
          );
        if (f.control === "direction")
          return (
            <Select
              key={f.key}
              label={f.label}
              value={data[f.key] ?? ""}
              options={Object.keys(DIRECTIONS).map((d) => ({
                value: d,
                label: DIRECTIONS[d] as string,
              }))}
              testId={ft}
              onChange={(v) => setData(f.key, v)}
            />
          );
        if (f.control === "fraction")
          return (
            <NumberInput
              key={f.key}
              label={f.label}
              value={data[f.key]}
              step="0.5"
              testId={ft}
              onChange={(v) => setData(f.key, v ?? undefined)}
            />
          );
        return (
          <RefChooser
            key={f.key}
            label={f.label}
            kind={kinds.maneuverTargeting}
            value={
              typeof data[f.key] === "string"
                ? { canonicalKey: data[f.key] }
                : null
            }
            testId={ft}
            onChange={(ref) =>
              onChange(
                {
                  ...op,
                  data: dataWith(
                    f.key,
                    ref === null ? undefined : ref.canonicalKey,
                  ),
                },
                {
                  targetingConversion:
                    ref === null ? null : { destination: ref },
                },
              )
            }
          />
        );
      })}
      {others.length > 0 ? (
        <p className="gov-muted">
          Also stored with this line (kept unchanged):{" "}
          {others.map((k) => parameterWords(k)).join(", ")}.
        </p>
      ) : null}
      <button type="button" className="gov-link-button" onClick={onRemove}>
        Remove this line
      </button>
    </div>
  );
}

// ---- The Trait: what it modifies, the choices it offers, its costs and where it may be used -------------------------

export function TraitMechanicsEditor({
  family,
  maneuver,
  traitKind,
  payload,
  onPayloadChange,
  catalog,
  kinds,
}: {
  family: string;
  maneuver: boolean;
  traitKind: string;
  payload: Payload;
  onPayloadChange: (p: Payload) => void;
  catalog: AuthoringCatalogDto;
  kinds: MechanicsKinds;
}) {
  const rules = asObject(payload.rules);
  const trait =
    rules.trait === undefined
      ? initialTraitRules(family)
      : asObject(rules.trait);
  const putTrait = (patch: Record<string, unknown>, top: Payload = {}) =>
    onPayloadChange({
      ...payload,
      ...top,
      rules: { ...rules, trait: { ...trait, ...patch } },
    });
  const mods = asArray(trait.modifications);
  const declared = declaredParameters(trait.parameters).filter(
    (d) => d.name !== "",
  );
  const numbers = declared
    .filter((d) => d.shape === "number")
    .map((d) => ({ value: d.name, label: parameterWords(d.name) }));
  const lists = declared
    .filter((d) => d.shape === "list")
    .map((d) => ({ value: d.name, label: parameterWords(d.name) }));
  const setMod = (i: number, next: Record<string, unknown>) =>
    putTrait({ modifications: mods.map((m, j) => (j === i ? next : m)) });
  const blankMod = (k: string): Record<string, unknown> => {
    const s = shapeOf(TRAIT_MODIFICATION_SHAPES, k);
    if (s === "resolution") return { kind: k, mode: "", validSaves: [] };
    if (s === "trigger") return { kind: k, event: "" };
    if (s === "damageType")
      return { kind: k, parameter: lists[0]?.value ?? "" };
    if (s === "cost")
      return {
        kind: k,
        parameter: numbers[0]?.value ?? "",
        currency: "",
        operation: "",
      };
    return {
      kind: k,
      parameter: numbers[0]?.value ?? "",
      measure: "",
      operation: "",
    };
  };
  return (
    <div className="prowess-authoring__mechanics" data-testid="trait-mechanics">
      <Section title="The Trait" testId="trait-what">
        <span className="gov-field">
          <label htmlFor="trait-name">Name shown to players</label>
          <input
            id="trait-name"
            data-testid="trait-name"
            value={typeof trait.name === "string" ? trait.name : ""}
            onChange={(e) => putTrait({ name: e.target.value })}
          />
        </span>
        <span className="gov-field">
          <label htmlFor="trait-description">What it does, in words</label>
          <textarea
            id="trait-description"
            data-testid="trait-description"
            value={
              typeof trait.description === "string" ? trait.description : ""
            }
            onChange={(e) => putTrait({ description: e.target.value })}
          />
        </span>
      </Section>
      <ParametersEditor
        parameters={trait.parameters}
        catalog={catalog}
        testId="trait-parameter"
        path="payload.rules.trait.parameters"
        onChange={(v) => putTrait({ parameters: v })}
        onRename={(from, to) => {
          const renamed = renameParameterReferences(payload, from, to);
          const r = asObject(renamed.rules);
          const t = asObject(r.trait ?? trait);
          onPayloadChange({
            ...renamed,
            rules: {
              ...r,
              trait: {
                ...t,
                parameters: asArray(t.parameters).map((p) =>
                  p.parameter === from ? { ...p, parameter: to } : p,
                ),
              },
            },
          });
        }}
      />
      <Section
        title="What it changes"
        help="Each change the Trait makes. A Trait never adds an outcome of its own."
        testId="trait-modifications"
      >
        {mods.length === 0 ? (
          <p className="gov-muted">No changes yet.</p>
        ) : null}
        {mods.map((m, i) => {
          const s = shapeOf(TRAIT_MODIFICATION_SHAPES, m.kind);
          const t = `trait-modification-${i}`;
          return (
            <div key={i} className="prowess-authoring__card" data-testid={t}>
              <p>
                <strong>
                  {words(String(m.kind ?? ""), TRAIT_MODIFICATION_WORDS)}
                </strong>
              </p>
              {s === "resolution" ? (
                <>
                  <Select
                    label="Now resolves by"
                    value={m.mode}
                    options={vocab(catalog, "resolutionModes").map((v) => ({
                      value: v,
                      label: words(v, MODE_WORDS),
                    }))}
                    testId={`${t}-mode`}
                    onChange={(v) =>
                      setMod(i, {
                        ...m,
                        mode: v,
                        validSaves:
                          shapeOf(MODE_SHAPES, v) === "save"
                            ? (m.validSaves ?? [])
                            : [],
                      })
                    }
                  />
                  {shapeOf(MODE_SHAPES, m.mode) === "save" ? (
                    <Checks
                      label="Saving Throws it allows"
                      values={vocab(catalog, "prowessStats")}
                      chosen={
                        Array.isArray(m.validSaves)
                          ? (m.validSaves as string[])
                          : []
                      }
                      testId={`${t}-save`}
                      onChange={(v) => setMod(i, { ...m, validSaves: v })}
                      wordMap={Object.fromEntries(
                        vocab(catalog, "prowessStats").map((x) => [x, x]),
                      )}
                    />
                  ) : null}
                </>
              ) : null}
              {s === "trigger" ? (
                <Select
                  label="When"
                  value={m.event}
                  options={Object.keys(TRAIT_EVENTS).map((v) => ({
                    value: v,
                    label: TRAIT_EVENTS[v] as string,
                  }))}
                  testId={`${t}-event`}
                  onChange={(v) => setMod(i, { ...m, event: v })}
                />
              ) : null}
              {s === "damageType" ? (
                <Select
                  label="The damage type comes from"
                  value={m.parameter}
                  options={lists}
                  testId={`${t}-parameter`}
                  blank={
                    lists.length === 0 ? "Add a list choice first" : "Choose…"
                  }
                  onChange={(v) => setMod(i, { ...m, parameter: v })}
                />
              ) : null}
              {s === "cost" || s === "measure" ? (
                <>
                  {s === "measure" ? (
                    <Select
                      label="Measure"
                      value={m.measure}
                      options={Object.keys(TRAIT_MEASURES).map((v) => ({
                        value: v,
                        label: TRAIT_MEASURES[v] as string,
                      }))}
                      testId={`${t}-measure`}
                      onChange={(v) => setMod(i, { ...m, measure: v })}
                    />
                  ) : null}
                  {s === "cost" ? (
                    <Select
                      label="Cost in"
                      value={m.currency}
                      options={vocab(catalog, "costCurrencies").map((v) => ({
                        value: v,
                        label: v,
                      }))}
                      testId={`${t}-currency`}
                      onChange={(v) => setMod(i, { ...m, currency: v })}
                    />
                  ) : null}
                  <Select
                    label="How"
                    value={m.operation}
                    options={Object.keys(TRAIT_OPERATIONS).map((v) => ({
                      value: v,
                      label: TRAIT_OPERATIONS[v] as string,
                    }))}
                    testId={`${t}-operation`}
                    onChange={(v) => setMod(i, { ...m, operation: v })}
                  />
                  <Select
                    label="The number comes from"
                    value={m.parameter}
                    options={numbers}
                    testId={`${t}-parameter`}
                    blank={
                      numbers.length === 0
                        ? "Add a number choice first"
                        : "Choose…"
                    }
                    onChange={(v) => setMod(i, { ...m, parameter: v })}
                  />
                </>
              ) : null}
              <button
                type="button"
                className="gov-link-button"
                onClick={() =>
                  putTrait({ modifications: mods.filter((_, j) => j !== i) })
                }
              >
                Remove this change
              </button>
            </div>
          );
        })}
        <Select
          label="Add a change"
          value=""
          options={vocab(catalog, "traitModifications").map((v) => ({
            value: v,
            label: words(v, TRAIT_MODIFICATION_WORDS),
          }))}
          testId="trait-modification-add"
          onChange={(v) =>
            v !== "" && putTrait({ modifications: [...mods, blankMod(v)] })
          }
        />
      </Section>
      <CostsEditor
        costs={payload.costContributions}
        parameters={trait.parameters}
        catalog={catalog}
        testId="trait-cost"
        keyPrefix="cost"
        kinds={kinds}
        branchIsManeuver={false}
        onChange={(v) => onPayloadChange({ ...payload, costContributions: v })}
      />
      <Section title="Where it may be used" testId="trait-where">
        <Checks
          label={
            maneuver
              ? "Effect families it works with (none chosen = any)"
              : "Spell Effect families it works with (none chosen = any)"
          }
          values={vocab(catalog, "spellEffectFamilies")}
          chosen={
            Array.isArray(trait.effectFamilies)
              ? (trait.effectFamilies as string[])
              : []
          }
          testId="trait-family"
          onChange={(v) => putTrait({ effectFamilies: [...v].sort() })}
        />
        {maneuver ? (
          <OptionList
            label="Foundation categories it works with (in plain words)"
            values={
              Array.isArray(trait.foundationCategories)
                ? (trait.foundationCategories as string[])
                : []
            }
            testId="trait-foundation"
            onChange={(v) => putTrait({ foundationCategories: [...v].sort() })}
          />
        ) : null}
        <RefChooser
          label="Only with this Affinity (optional)"
          kind={kinds.affinity}
          value={trait.affinity}
          testId="trait-affinity"
          onChange={(v) => putTrait({ affinity: v })}
        />
        <TraitKeyList
          label="Traits it cannot be combined with"
          values={
            Array.isArray(trait.incompatibleTraits)
              ? (trait.incompatibleTraits as string[])
              : []
          }
          kind={traitKind}
          onChange={(v) => putTrait({ incompatibleTraits: [...v].sort() })}
        />
      </Section>
      <ConstructionEditor
        construction={rules.construction}
        catalog={catalog}
        kinds={kinds}
        testId="trait-construction"
        onChange={(v) =>
          onPayloadChange({
            ...payload,
            rules: {
              ...rules,
              ...(rules.trait === undefined ? {} : { trait }),
              construction: v,
            },
          })
        }
      />
    </div>
  );
}

/** Incompatible Traits are stored as exact canonical keys; they are chosen by search, never typed. */
function TraitKeyList({
  label,
  values,
  onChange,
  kind,
}: {
  label: string;
  values: readonly string[];
  onChange: (v: string[]) => void;
  kind?: string;
}) {
  const [picking, setPicking] = useState(false);
  return (
    <div role="group" aria-label={label} data-testid="trait-incompatible">
      <p>{label}</p>
      {values.length === 0 ? <p className="gov-muted">None.</p> : null}
      <ul>
        {values.map((v) => (
          <li key={v}>
            {tokenWords((v.split(".").pop() ?? v).toUpperCase())}{" "}
            <button
              type="button"
              className="gov-link-button"
              onClick={() => onChange(values.filter((x) => x !== v))}
            >
              Remove
            </button>
          </li>
        ))}
      </ul>
      {picking ? (
        <DefinitionReferencePicker
          label={`Add to ${label.toLowerCase()}`}
          definitionKind={kind}
          onSelect={(r) => {
            if (!values.includes(r.canonicalKey))
              onChange([...values, r.canonicalKey]);
            setPicking(false);
          }}
          onCancel={() => setPicking(false)}
        />
      ) : (
        <button
          type="button"
          className="gov-link-button"
          onClick={() => setPicking(true)}
        >
          Add a Trait
        </button>
      )}
    </div>
  );
}
