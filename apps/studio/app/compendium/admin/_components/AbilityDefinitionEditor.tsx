"use client";

import { formatEnumLabel } from "@prowess/ui";
import { useEffect, useId, useState } from "react";
import type { AuthoringCatalogDto, DefinitionReferenceDto } from "../_lib/authoring-client";
import { getVersion } from "../_lib/authoring-client";
import { isExactReference } from "../_lib/definition-form";
import { AuthoredDataEditor } from "./AuthoredDataEditor";
import { DefinitionReferencePicker } from "./DefinitionReferencePicker";

/**
 * PRE-M7-WO1 — guided editor for a reusable Compendium Spell or Maneuver Definition (SPELL_DEFINITION /
 * MANEUVER_DEFINITION). These are Compendium content, distinct from a Character's personal Signature Spell / Maneuver
 * (which the Character builders own and which pin their own components).
 *
 * The designer writes the name and description, then fills labelled component slots — Targeting, Effects, Traits,
 * Duration, Conditions, Affinity (Spell) or Actions / attachments / Powerful Blow (Maneuver) — by searching for an
 * EXACT revision of a compatible component kind. Each use's declared parameters (read from that exact revision) get
 * typed inputs; values the form does not show are kept. Order is authored explicitly (Up / Down). Every stored key the
 * form does not show is copied through unchanged, and the Spell effect chain stays available as advanced structured data.
 * Legality (slot rules, capacity, attachments) is decided by the unchanged M5 validator on Validate / Save.
 *
 * Component kinds are resolved from the live catalog by contract and branch (never a hard-coded kind list).
 */
type Json = Record<string, unknown>;
type Ref = DefinitionReferenceDto["ref"];
type Use = { componentKey: string; definition: Ref | null; parameters: Json; order?: number; appliesTo?: { scope: string; componentKey: string | null } };
export type AbilityBranch = "spell" | "maneuver";

const asObject = (v: unknown): Json => (v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Json) : {});
const asUses = (v: unknown): Use[] => (Array.isArray(v) ? (v.filter((x) => x !== null && typeof x === "object") as Use[]) : []);
const asStrings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

/** The component contracts a slot accepts (structure only; values come from the catalog). */
const SLOT_CONTRACT = { TARGETING: "targeting", EFFECT: "effects", TRAIT: "traits", DURATION: "duration", ABILITY_CONDITION: "conditions", FOUNDATION: "actions" } as const;
type SlotName = (typeof SLOT_CONTRACT)[keyof typeof SLOT_CONTRACT];
/** Which slot a scoped Trait's target lives in (null = the whole ability). */
const SCOPE_TARGET: Readonly<Record<string, SlotName | null>> = { ABILITY_WIDE: null, EFFECT_SPECIFIC: "effects", TARGETING: "targeting", DURATION: "duration", CONDITION: "conditions", ACTION_SPECIFIC: "actions", RESOLUTION: "actions" };
const SLOT_TITLE: Record<SlotName, string> = { targeting: "Targeting", effects: "Effects", traits: "Traits", duration: "Duration", conditions: "Conditions", actions: "Actions (foundations)" };
const SLOT_ITEM: Record<SlotName, string> = { targeting: "Targeting", effects: "Effect", traits: "Trait", duration: "Duration", conditions: "Condition", actions: "Action" };

/** Catalog kinds a slot accepts for a branch: the branch's own kind plus any branch-free shared kind of that contract. */
export function slotKinds(catalog: AuthoringCatalogDto, branch: AbilityBranch, slot: SlotName): string[] {
  const contract = (Object.keys(SLOT_CONTRACT) as Array<keyof typeof SLOT_CONTRACT>).find((c) => SLOT_CONTRACT[c] === slot);
  return catalog.kinds.filter((k) => k.sharedContract === contract && (k.branch === branch.toUpperCase() || k.branch === null) && k.authorable).map((k) => k.definitionKind);
}

function nextKey(prefix: string, taken: readonly string[]): string {
  for (let i = 1; ; i += 1) if (!taken.includes(`${prefix}${i}`)) return `${prefix}${i}`;
}

/** Declared parameters of one exact component revision (read from its stored payload; presentation only). */
interface Declared {
  parameter: string;
  kind: string;
  minimum: number | null;
  maximum: number | null;
  increment: number | null;
  default: number | string | boolean | null;
  allowed: string[] | null;
}
function useDeclaredParameters(ref: Ref | null): Declared[] | null {
  const [declared, setDeclared] = useState<Declared[] | null>(null);
  const id = ref?.entityVersionId ?? null;
  useEffect(() => {
    if (id === null) return;
    let live = true;
    getVersion(id).then(
      (v) => {
        if (!live) return;
        const def = asObject(asObject(v.structuredData).prowessDefinition);
        const raw = asObject(def.payload).parameters;
        const rows = Array.isArray(raw) ? raw.filter((x) => x !== null && typeof x === "object").map((x) => x as Json) : [];
        setDeclared(
          rows.map((q) => {
            const max = asObject(q.maximum);
            const d = q.default;
            return {
              parameter: String(q.parameter),
              kind: String(q.kind ?? ""),
              minimum: typeof q.minimum === "number" ? q.minimum : null,
              maximum: typeof max.value === "number" ? max.value : null,
              increment: typeof q.increment === "number" ? q.increment : null,
              default: typeof d === "number" || typeof d === "string" || typeof d === "boolean" ? d : null,
              allowed: Array.isArray(q.allowed) ? q.allowed.filter((a): a is string => typeof a === "string") : null,
            };
          }),
        );
      },
      () => live && setDeclared([]),
    );
    return () => {
      live = false;
    };
  }, [id]);
  return id === null ? null : declared;
}

function ParameterInputs({ use, onChange, label }: { use: Use; onChange: (parameters: Json) => void; label: string }) {
  const base = useId();
  const declared = useDeclaredParameters(use.definition);
  const values = asObject(use.parameters);
  if (declared === null) return null;
  const known = new Set(declared.map((d) => d.parameter));
  const extra = Object.keys(values).filter((k) => !known.has(k));
  const set = (k: string, v: unknown) => {
    const next = { ...values };
    if (v === null || v === "") delete next[k];
    else next[k] = v;
    onChange(next);
  };
  return (
    <fieldset className="prowess-authoring__nested" data-testid="ability-parameters">
      <legend>{label} parameters</legend>
      {declared.length === 0 ? <p className="gov-muted">This component declares no parameters.</p> : null}
      {declared.map((d) => {
        const id = `${base}-${d.parameter}`;
        const v = values[d.parameter];
        const hint = [d.minimum !== null ? `min ${d.minimum}` : null, d.maximum !== null ? `max ${d.maximum}` : null, d.default !== null ? `default ${String(d.default)}` : null].filter(Boolean).join(", ");
        return (
          <div className="gov-field" key={d.parameter}>
            <label htmlFor={id}>
              {formatEnumLabel(d.parameter)} {hint ? <span className="gov-muted">({hint})</span> : null}
            </label>
            {d.allowed !== null ? (
              <select id={id} value={typeof v === "string" ? v : ""} onChange={(e) => set(d.parameter, e.target.value)}>
                <option value="">Default</option>
                {d.allowed.map((a) => (
                  <option key={a} value={a}>
                    {formatEnumLabel(a)}
                  </option>
                ))}
              </select>
            ) : typeof d.default === "boolean" ? (
              <input id={id} type="checkbox" checked={v === true} onChange={(e) => set(d.parameter, e.target.checked)} />
            ) : (
              <input id={id} type="number" step={d.increment ?? 1} min={d.minimum ?? undefined} max={d.maximum ?? undefined} value={typeof v === "number" ? v : ""} placeholder={d.default === null ? "" : String(d.default)} onChange={(e) => set(d.parameter, e.target.value === "" ? null : Number(e.target.value))} />
            )}
          </div>
        );
      })}
      {extra.length > 0 ? (
        <details>
          <summary>Other stored values ({extra.join(", ")}) — kept as authored</summary>
          <AuthoredDataEditor value={Object.fromEntries(extra.map((k) => [k, values[k]]))} onChange={(v) => onChange({ ...Object.fromEntries(Object.entries(values).filter(([k]) => known.has(k))), ...v })} label={`${label} other values`} />
        </details>
      ) : null}
    </fieldset>
  );
}

function RefLabel({ target: r }: { target: Ref | null }) {
  if (r === null) return <span className="gov-error">No component chosen yet</span>;
  return (
    <span>
      <code>{r.canonicalKey}</code> <span className="gov-tag">{formatEnumLabel(r.definitionKind)}</span>
    </span>
  );
}

function KindAndPicker({ kinds, label, onSelect, onCancel }: { kinds: readonly string[]; label: string; onSelect: (r: Ref) => void; onCancel: () => void }) {
  const [kind, setKind] = useState(kinds[0] ?? "");
  return (
    <div className="prowess-authoring__inline">
      {kinds.length > 1 ? (
        <label className="gov-field">
          <span>Component kind</span>
          <select value={kind} onChange={(e) => setKind(e.target.value)}>
            {kinds.map((k) => (
              <option key={k} value={k}>
                {formatEnumLabel(k)}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <DefinitionReferencePicker key={kind} label={label} definitionKind={kind || undefined} onSelect={onSelect} onCancel={onCancel} />
    </div>
  );
}

/** One component slot: a single optional / required use, or an ordered list. */
function Slot({
  slot,
  kinds,
  value,
  list,
  required,
  onChange,
  onCreateChild,
  extra,
}: {
  slot: SlotName;
  kinds: readonly string[];
  value: unknown;
  list: boolean;
  required: boolean;
  onChange: (v: unknown) => void;
  onCreateChild?: (kind: string) => void;
  extra?: (u: Use, set: (u: Use) => void) => React.ReactNode;
}) {
  const [picking, setPicking] = useState<number | "new" | null>(null);
  const uses = list ? asUses(value).slice().sort((a, b) => (a.order ?? 0) - (b.order ?? 0)) : value === null || value === undefined ? [] : [asObject(value) as Use];
  const commit = (next: Use[]) => onChange(list ? next.map((u, i) => ({ ...u, order: i + 1 })) : (next[0] ?? null));
  const keys = uses.map((u) => u.componentKey);
  const prefix = slot === "targeting" ? "targeting" : slot === "duration" ? "duration" : SLOT_ITEM[slot].toLowerCase();
  const item = SLOT_ITEM[slot];
  return (
    <section className="prowess-authoring__nested" aria-label={SLOT_TITLE[slot]} data-testid={`ability-slot-${slot}`}>
      <h5>
        {SLOT_TITLE[slot]} {required ? <span className="gov-tag">required</span> : <span className="gov-tag">optional</span>}
      </h5>
      {kinds.length === 0 ? <p className="gov-muted">This Ruleset catalog has no authorable component kind for this slot.</p> : null}
      {uses.length === 0 ? <p className="gov-muted">None yet.</p> : null}
      <ol className="prowess-formula__terms">
        {uses.map((u, i) => (
          <li key={`${u.componentKey}-${i}`} className="prowess-impact" data-testid="ability-use">
            <p>
              <strong>{item} {list ? i + 1 : ""}</strong> <RefLabel target={isExactReference(u.definition) ? (u.definition as Ref) : null} />
            </p>
            <div className="gov-actions">
              <button type="button" className="gov-link-button" onClick={() => setPicking(i)}>
                Change {item.toLowerCase()} {list ? i + 1 : ""}
              </button>
              {list ? (
                <>
                  <button type="button" className="gov-link-button" disabled={i === 0} onClick={() => commit(uses.map((x, j) => (j === i - 1 ? uses[i]! : j === i ? uses[i - 1]! : x)))} aria-label={`Move ${item} ${i + 1} up`}>
                    Up
                  </button>
                  <button type="button" className="gov-link-button" disabled={i === uses.length - 1} onClick={() => commit(uses.map((x, j) => (j === i + 1 ? uses[i]! : j === i ? uses[i + 1]! : x)))} aria-label={`Move ${item} ${i + 1} down`}>
                    Down
                  </button>
                </>
              ) : null}
              {!required || list ? (
                <button type="button" className="gov-link-button" onClick={() => commit(uses.filter((_, j) => j !== i))} aria-label={`Remove ${item} ${list ? i + 1 : ""}`.trim()}>
                  Remove
                </button>
              ) : null}
            </div>
            {picking === i ? (
              <KindAndPicker
                kinds={kinds}
                label={`Choose the exact ${item}`}
                onSelect={(r) => {
                  // A different component keeps no stale parameter values (they belonged to the old contract).
                  commit(uses.map((x, j) => (j === i ? { ...x, definition: r, parameters: x.definition?.entityVersionId === r.entityVersionId ? x.parameters : {} } : x)));
                  setPicking(null);
                }}
                onCancel={() => setPicking(null)}
              />
            ) : null}
            {isExactReference(u.definition) ? <ParameterInputs use={u} label={`${item} ${list ? i + 1 : ""}`.trim()} onChange={(parameters) => commit(uses.map((x, j) => (j === i ? { ...x, parameters } : x)))} /> : null}
            {extra ? extra(u, (nu) => commit(uses.map((x, j) => (j === i ? nu : x)))) : null}
          </li>
        ))}
      </ol>
      {list || uses.length === 0 ? (
        picking === "new" ? (
          <KindAndPicker
            kinds={kinds}
            label={`Search for an existing ${item}`}
            onSelect={(r) => {
              commit([...uses, { componentKey: slot === "targeting" ? "targeting" : nextKey(prefix, keys), definition: r, parameters: {} }]);
              setPicking(null);
            }}
            onCancel={() => setPicking(null)}
          />
        ) : (
          <div className="gov-actions">
            <button type="button" className="gov-button" disabled={kinds.length === 0} onClick={() => setPicking("new")} data-testid={`ability-add-${slot}`}>
              Add {item}
            </button>
            {onCreateChild && kinds[0] ? (
              <button type="button" className="gov-link-button" onClick={() => onCreateChild(kinds[0] as string)} data-testid={`ability-create-${slot}`}>
                Create a new {item} (returns here with your unsaved changes)
              </button>
            ) : null}
          </div>
        )
      ) : null}
    </section>
  );
}

export function AbilityDefinitionEditor({
  branch,
  payload,
  onPayloadChange,
  catalog,
  affinityKind,
  onCreateChild,
}: {
  branch: AbilityBranch;
  payload: Json;
  onPayloadChange: (next: Json) => void;
  catalog: AuthoringCatalogDto;
  affinityKind: string;
  onCreateChild?: (kind: string, slot: string) => void;
}) {
  const composition = asObject(payload.composition);
  const setComposition = (patch: Json) => onPayloadChange({ ...payload, composition: { ...composition, ...patch } });
  const kindsOf = (slot: SlotName) => slotKinds(catalog, branch, slot);
  const href = onCreateChild ? (slot: string) => (kind: string) => onCreateChild(kind, slot) : undefined;
  const scopes = catalog.vocabularies.traitScopes ?? [];
  const actions = asUses(payload.actions);
  const effects = asUses(composition.effects);
  const authority = asObject(composition.authority).authority;
  const branchData = asObject(composition.branch);
  const attachments = (Array.isArray(payload.effectAttachments) ? payload.effectAttachments : []) as Array<{ effectKey: string; actionKeys: string[] }>;
  const powerful = payload.powerfulBlow === null || payload.powerfulBlow === undefined ? null : asStrings(asObject(payload.powerfulBlow).actionKeys);
  const targetsFor = (slot: SlotName | null): Use[] => (slot === null ? [] : slot === "actions" ? actions : slot === "targeting" || slot === "duration" ? (composition[slot] ? [asObject(composition[slot]) as Use] : []) : asUses(composition[slot]));

  const traitExtra = (u: Use, set: (u: Use) => void) => {
    const scope = u.appliesTo?.scope ?? "";
    const targetSlot = SCOPE_TARGET[scope] ?? null;
    const targets = targetsFor(targetSlot);
    return (
      <div className="prowess-authoring__inline">
        <label className="gov-field">
          <span>Applies to</span>
          <select value={scope} onChange={(e) => set({ ...u, appliesTo: { scope: e.target.value, componentKey: (SCOPE_TARGET[e.target.value] ?? null) === null ? null : (targetsFor(SCOPE_TARGET[e.target.value] ?? null)[0]?.componentKey ?? "") } })}>
            <option value="">Choose…</option>
            {scopes.map((s) => (
              <option key={s} value={s}>
                {formatEnumLabel(s)}
              </option>
            ))}
          </select>
        </label>
        {targetSlot !== null ? (
          <label className="gov-field">
            <span>Which {SLOT_ITEM[targetSlot].toLowerCase()}</span>
            <select value={u.appliesTo?.componentKey ?? ""} onChange={(e) => set({ ...u, appliesTo: { scope, componentKey: e.target.value } })}>
              <option value="">Choose…</option>
              {targets.map((t) => (
                <option key={t.componentKey} value={t.componentKey}>
                  {t.componentKey} — {t.definition?.canonicalKey ?? "?"}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </div>
    );
  };

  const attachmentExtra = (u: Use) => {
    if (branch !== "maneuver") return null;
    const current = attachments.find((a) => a.effectKey === u.componentKey)?.actionKeys ?? [];
    const toggle = (actionKey: string, on: boolean) => {
      const nextKeys = on ? [...current, actionKey] : current.filter((k) => k !== actionKey);
      const others = attachments.filter((a) => a.effectKey !== u.componentKey);
      onPayloadChange({ ...payload, effectAttachments: nextKeys.length === 0 ? others : [...others, { effectKey: u.componentKey, actionKeys: nextKeys }] });
    };
    return (
      <fieldset className="prowess-authoring__inline" data-testid="ability-attachment">
        <legend>Attached to actions</legend>
        {actions.length === 0 ? <span className="gov-muted">Add an action first.</span> : null}
        {actions.map((a) => (
          <label key={a.componentKey} className="prowess-rule-preview__toggle">
            <input type="checkbox" checked={current.includes(a.componentKey)} onChange={(e) => toggle(a.componentKey, e.target.checked)} /> {a.componentKey}
          </label>
        ))}
      </fieldset>
    );
  };

  return (
    <div className="prowess-ability-editor" data-testid="ability-editor" data-branch={branch}>
      <label className="gov-field">
        <span>Name (required)</span>
        <input value={typeof payload.name === "string" ? payload.name : ""} onChange={(e) => onPayloadChange({ ...payload, name: e.target.value })} data-testid="ability-name" />
      </label>
      <label className="gov-field">
        <span>Description (what it does, in plain words — never parsed into mechanics)</span>
        <textarea rows={4} value={typeof payload.description === "string" ? payload.description : ""} onChange={(e) => onPayloadChange({ ...payload, description: e.target.value })} data-testid="ability-description" />
      </label>
      <label className="gov-field">
        <span>Composition key (a stable internal label for this composition)</span>
        <input value={typeof composition.compositionKey === "string" ? composition.compositionKey : ""} onChange={(e) => setComposition({ compositionKey: e.target.value })} autoComplete="off" spellCheck={false} />
      </label>
      {branch === "spell" ? (
        <label className="gov-field">
          <span>Spell authority</span>
          <select value={typeof authority === "string" ? authority : ""} onChange={(e) => setComposition({ authority: e.target.value === "" ? null : { authority: e.target.value } })} data-testid="ability-authority">
            <option value="">Choose…</option>
            <option value="ARCANE_AUTHORITY">Arcane Authority</option>
            <option value="AFFINITY_AUTHORITY">Affinity Authority</option>
          </select>
        </label>
      ) : null}
      <label className="gov-field">
        <span>Keywords (exact labels, comma-separated)</span>
        <input value={asStrings(composition.keywords).join(", ")} onChange={(e) => setComposition({ keywords: e.target.value.split(",").map((x) => x.trim()).filter((x) => x !== "") })} autoComplete="off" />
      </label>

      {branch === "maneuver" ? <Slot slot="actions" kinds={kindsOf("actions")} value={payload.actions} list required onChange={(v) => onPayloadChange({ ...payload, actions: v })} onCreateChild={href?.("actions")} /> : null}
      {branch === "spell" ? <Slot slot="targeting" kinds={kindsOf("targeting")} value={composition.targeting} list={false} required onChange={(v) => setComposition({ targeting: v })} onCreateChild={href?.("targeting")} /> : null}
      <Slot slot="effects" kinds={kindsOf("effects")} value={composition.effects} list required={false} onChange={(v) => setComposition({ effects: v })} onCreateChild={href?.("effects")} extra={branch === "maneuver" ? (u) => attachmentExtra(u) : undefined} />
      <Slot slot="traits" kinds={kindsOf("traits")} value={composition.traits} list required={false} onChange={(v) => setComposition({ traits: (v as Use[]).map((t) => ({ ...t, appliesTo: t.appliesTo ?? { scope: scopes.find((s) => SCOPE_TARGET[s] === null) ?? "", componentKey: null } })) })} onCreateChild={href?.("traits")} extra={traitExtra} />
      <Slot slot="duration" kinds={kindsOf("duration")} value={composition.duration} list={false} required={false} onChange={(v) => setComposition({ duration: v })} onCreateChild={href?.("duration")} />
      <Slot slot="conditions" kinds={kindsOf("conditions")} value={composition.conditions} list required={false} onChange={(v) => setComposition({ conditions: v })} onCreateChild={href?.("conditions")} />

      <section className="prowess-authoring__nested" aria-label="Affinity" data-testid="ability-affinity">
        <h5>
          Affinity <span className="gov-tag">optional</span>
        </h5>
        <AffinityUse value={composition.affinity} kind={affinityKind} onChange={(v) => setComposition({ affinity: v })} />
      </section>

      {branch === "maneuver" ? (
        <fieldset className="prowess-authoring__nested" data-testid="ability-powerful-blow">
          <legend>Powerful Blow (commits two or more actions together; it is not an Effect)</legend>
          <label className="prowess-rule-preview__toggle">
            <input type="checkbox" checked={powerful !== null} onChange={(e) => onPayloadChange({ ...payload, powerfulBlow: e.target.checked ? { actionKeys: actions.map((a) => a.componentKey) } : null })} /> This Maneuver is a Powerful Blow
          </label>
          {powerful !== null
            ? actions.map((a) => (
                <label key={a.componentKey} className="prowess-rule-preview__toggle">
                  <input type="checkbox" checked={powerful.includes(a.componentKey)} onChange={(e) => onPayloadChange({ ...payload, powerfulBlow: { actionKeys: e.target.checked ? [...powerful, a.componentKey] : powerful.filter((k) => k !== a.componentKey) } })} /> {a.componentKey}
                </label>
              ))
            : null}
        </fieldset>
      ) : null}

      {branch === "spell" ? (
        <>
          <label className="gov-field">
            <span>Effect slots traded for Trait slots</span>
            <input type="number" min={0} step={1} value={typeof asObject(payload.constructionOptions).effectSlotsTradedForTraits === "number" ? (asObject(payload.constructionOptions).effectSlotsTradedForTraits as number) : 0} onChange={(e) => onPayloadChange({ ...payload, constructionOptions: { ...asObject(payload.constructionOptions), effectSlotsTradedForTraits: e.target.value === "" ? 0 : Number(e.target.value) } })} />
          </label>
          <label className="gov-field">
            <span>Additional Affinity Traits (exact labels, comma-separated; need an authoritative capacity grant)</span>
            <input value={asStrings(payload.additionalAffinityTraits).join(", ")} onChange={(e) => onPayloadChange({ ...payload, additionalAffinityTraits: e.target.value.split(",").map((x) => x.trim()).filter((x) => x !== "") })} autoComplete="off" />
          </label>
          <details>
            <summary>Advanced: effect chain (structured data)</summary>
            <p className="gov-muted">The order and conditions linking this Spell&apos;s Effects. Leave empty for independent Effects.</p>
            <AuthoredDataEditor value={asObject(branchData.effectChain)} onChange={(v) => setComposition({ branch: { ...branchData, effectChain: Object.keys(v).length === 0 ? null : v } })} label="Effect chain" />
          </details>
        </>
      ) : null}
      <p className="gov-muted">
        Effects stay reusable Definitions; the values chosen here belong to this use only. A component revised later does not change this Definition — choose the newer revision here when you want it.
      </p>
    </div>
  );
}

function AffinityUse({ value, kind, onChange }: { value: unknown; kind: string; onChange: (v: unknown) => void }) {
  const [picking, setPicking] = useState(false);
  const use = value === null || value === undefined ? null : (asObject(value) as Use);
  return (
    <div>
      {use ? (
        <p>
          <RefLabel target={isExactReference(use.definition) ? (use.definition as Ref) : null} />{" "}
          <button type="button" className="gov-link-button" onClick={() => onChange(null)}>
            Remove Affinity
          </button>
        </p>
      ) : (
        <p className="gov-muted">None.</p>
      )}
      {picking ? (
        <DefinitionReferencePicker
          label="Choose the exact Affinity"
          definitionKind={kind}
          onSelect={(r) => {
            onChange({ componentKey: "affinity", definition: r, parameters: use?.parameters ?? {} });
            setPicking(false);
          }}
          onCancel={() => setPicking(false)}
        />
      ) : (
        <button type="button" className="gov-link-button" onClick={() => setPicking(true)}>
          {use ? "Change Affinity" : "Add an Affinity"}
        </button>
      )}
    </div>
  );
}

/** Adds a newly created child component (exact reference) to a slot of an ability payload — the round-trip return. */
export function withChildComponent(payload: Json, slot: string, ref: Ref, scopes: readonly string[]): Json {
  const composition = asObject(payload.composition);
  const componentUse = (key: string) => ({ componentKey: key, definition: ref, parameters: {} });
  if (slot === "targeting") return { ...payload, composition: { ...composition, targeting: componentUse("targeting") } };
  if (slot === "duration") return { ...payload, composition: { ...composition, duration: componentUse("duration") } };
  const listOf = slot === "actions" ? asUses(payload.actions) : asUses(composition[slot]);
  const prefix = slot === "actions" ? "action" : slot === "effects" ? "effect" : slot === "traits" ? "trait" : "condition";
  const next: Use = { ...componentUse(nextKey(prefix, listOf.map((u) => u.componentKey))), order: listOf.length + 1, ...(slot === "traits" ? { appliesTo: { scope: scopes.find((x) => SCOPE_TARGET[x] === null) ?? "", componentKey: null } } : {}) };
  return slot === "actions" ? { ...payload, actions: [...listOf, next] } : { ...payload, composition: { ...composition, [slot]: [...listOf, next] } };
}
