"use client";

import { useId, useState, type ReactNode } from "react";
import type { AuthoringCatalogDto, AuthoringKindDto, ValidationIssueDto } from "../_lib/authoring-client";
import { formatEnumLabel } from "@prowess/ui";
import { descriptorFor, groupsOf, GENERIC_DESCRIPTOR, initialFieldValue, type FieldDescriptor } from "../_lib/descriptors";
import { fieldDomId, fieldErrorId, issuesForField, stableStringify, type DefinitionCandidate } from "../_lib/definition-form";
import { AuthoredDataEditor } from "./AuthoredDataEditor";
import { DefinitionReferencePicker } from "./DefinitionReferencePicker";
import { FormulaEditor } from "./FormulaEditor";
import { SourceSectionPicker } from "./SourceSectionPicker";
import { MissionRuleEditor } from "./MissionRuleEditor";
import { ContentTokenList, ContentTokenSelect } from "./ContentTokenSelect";
import { IntegerListInput, OptionalFeetInput, RowsEditor } from "./GuidedInputs";
import { AbilityDefinitionEditor } from "./AbilityDefinitionEditor";
import { EffectMechanicsEditor, MechanicsIssues, OptionList, TraitMechanicsEditor } from "./ComponentMechanicsEditor";
import { ConditionMechanicsEditor, DurationMechanicsEditor, FoundationMechanicsEditor, TargetingMechanicsEditor } from "./ComponentRulesEditors";
import { FixedInputFormula, NaturalSelectionEditor, OpenQuestionInput, PlayCheckEditor, WrittenNotesEditor } from "./RuleControls";
import { TRAIT_FAMILY_SHAPES, nextKey, shapeOf, traitFamilyFor } from "../_lib/component-mechanics";
import { KeywordPicker } from "./KeywordPicker";
import { asToken } from "../_lib/token-input";
import {
  AttackRefsEditor,
  AttackResolutionEditor,
  AttackTargetingEditor,
  DamageProfilesEditor,
  EquippedModifiersEditor,
  GrantedFeaturesEditor,
  NullableSelect,
  TextListEditor,
  TraitContractEditor,
  TraitParametersEditor,
  TraitUseEditor,
  TraitUsesEditor,
  UseSitesEditor,
  WeaponRequirementsEditor,
} from "./WeaponEditors";

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
/** A nested field's value: key "" is the containing record itself (a whole-record variant). */
const sub = (o: Record<string, unknown>, key: string): unknown => (key === "" ? o : o[key]);
const put = (o: Record<string, unknown>, key: string, v: unknown): Record<string, unknown> => (key === "" ? asObject(v) : { ...o, [key]: v });

function FieldControl({ field, value, onChange, catalog, issues, payload, onCreateChild }: { field: FieldDescriptor; value: unknown; onChange: (v: unknown) => void; catalog: AuthoringCatalogDto; issues: ValidationIssueDto[]; payload?: Payload; onCreateChild?: (kind: string, slot: string) => void }) {
  const listId = useId();
  switch (field.input) {
    case "select": {
      const options = catalog.vocabularies[field.vocabulary] ?? catalog.fixedLists?.[field.vocabulary] ?? [];
      return (
        <LabeledControl field={field} issues={issues}>
          {(p) => (
            <select {...p} value={typeof value === "string" ? value : ""} onChange={(e) => onChange(e.target.value)}>
              <option value="">Choose…</option>
              {options.map((o) => (
                <option key={o} value={o}>
                  {formatEnumLabel(o)}
                </option>
              ))}
            </select>
          )}
        </LabeledControl>
      );
    }
    case "token":
      return (
        // RULES-WO1 Phase D: every name field is typed in plain words and stored (and shown) as the token ("Tier 1" →
        // TIER_1). The server still refuses a malformed raw token (M5 reader); only the typing is helped here.
        <LabeledControl field={{ ...field, help: field.help ?? "Type a short name in plain words; it is stored in capitals with underscores (Tier 1 → TIER_1)." }} issues={issues}>
          {(p) => <input {...p} value={typeof value === "string" ? value : ""} onChange={(e) => onChange(asToken(e.target.value))} onBlur={(e) => onChange(asToken(e.target.value, true))} autoComplete="off" spellCheck={false} />}
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
      // RULES-WO1: every compatibility rule is built from lists and pickers — the relation is chosen from the M5 list,
      // and each allowed label is chosen by name (a Definition, a Keyword) or typed in plain words (a vocabulary label).
      // The stored value is still the exact label the M5 reader requires.
      const rows = asArray(value);
      const set = (i: number, patch: Record<string, unknown>) => onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
      return (
        <Shell field={field} issues={issues} composite>
          <ol className="prowess-authoring__rows">
            {rows.map((r, i) => (
              <CompatibilityRow key={i} index={i} row={r} relations={catalog.vocabularies.compatibilityRelations ?? []} onChange={(patch) => set(i, patch)} onRemove={() => onChange(rows.filter((_, j) => j !== i))} />
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
                {/* RULES-WO1 Phase F: the contribution's key is generated and kept — never typed by the author. */}
                <label className="gov-field">
                  <span>Paid in</span>
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
          <button type="button" className="gov-button" onClick={() => onChange([...rows, { contributionKey: nextKey(rows.map((r) => String(r.contributionKey ?? "")), "cost"), currency: "", data: {} }])}>
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
            <span>Restriction name (plain words)</span>
            <input value={typeof r.restrictionKey === "string" ? r.restrictionKey : ""} onChange={(e) => onChange({ ...r, restrictionKey: asToken(e.target.value) })} onBlur={(e) => onChange({ ...r, restrictionKey: asToken(e.target.value, true) })} spellCheck={false} />
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
    // ---- M6-WO3 character-facing inputs (structured, never raw JSON) ----------------------------------------------
    case "integer":
      return (
        <LabeledControl field={field} issues={issues}>
          {(p) => (
            <input
              {...p}
              type="number"
              step={1}
              value={typeof value === "number" ? value : ""}
              onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
            />
          )}
        </LabeledControl>
      );
    case "source":
      // RULES-WO1: rulebook sections are chosen by title; the section keys are only shown under "Section keys".
      return (
        <Shell field={field} issues={issues} composite>
          <SourceSectionPicker value={value} onChange={onChange} />
        </Shell>
      );
    case "statGrants":
      return (
        <Shell field={field} issues={issues} composite>
          <StatGrantsEditor rows={asArray(value)} onChange={onChange} catalog={catalog} />
        </Shell>
      );
    case "skillGrants":
      return (
        <Shell field={field} issues={issues} composite>
          <SkillGrantsEditor rows={asArray(value)} onChange={onChange} catalog={catalog} optionKind={field.optionKind} />
        </Shell>
      );
    case "advancementLevels":
      return (
        <Shell field={field} issues={issues} composite>
          <AdvancementLevelsEditor rows={asArray(value)} onChange={onChange} />
        </Shell>
      );
    // ---- M6-WO6 Weapon / Attack / Equipment Trait inputs (structured, never raw JSON) -----------------------------
    case "nullableSelect":
      return (
        <LabeledControl field={field} issues={issues}>
          {(p) => <NullableSelect {...p} value={value} options={catalog.vocabularies[field.vocabulary] ?? []} onChange={onChange} emptyLabel="Not authored" />}
        </LabeledControl>
      );
    case "text":
      return <LabeledControl field={field} issues={issues}>{(p) => <textarea {...p} value={typeof value === "string" ? value : ""} onChange={(e) => onChange(field.nullable === true && e.target.value === "" ? null : e.target.value)} />}</LabeledControl>;
    case "textList":
      return (
        <Shell field={field} issues={issues} composite>
          <TextListEditor rows={value} onChange={onChange} label={field.label} />
        </Shell>
      );
    case "traitUses":
      return (
        <Shell field={field} issues={issues} composite>
          <TraitUsesEditor rows={value} onChange={onChange} label={field.label} refKind={field.refKind} />
        </Shell>
      );
    case "traitUse":
      return (
        <Shell field={field} issues={issues} composite>
          <TraitUseEditor value={value} onChange={onChange} label={field.label} refKind={field.refKind} />
        </Shell>
      );
    case "attackRefs":
      return (
        <Shell field={field} issues={issues} composite>
          <AttackRefsEditor rows={value} onChange={onChange} refKind={field.refKind} />
        </Shell>
      );
    case "damageProfiles":
      return (
        <Shell field={field} issues={issues} composite>
          <DamageProfilesEditor rows={value} onChange={onChange} catalog={catalog} />
        </Shell>
      );
    case "weaponRequirements":
      return (
        <Shell field={field} issues={issues} composite>
          <WeaponRequirementsEditor rows={value} onChange={onChange} catalog={catalog} />
        </Shell>
      );
    case "equippedModifiers":
      return (
        <Shell field={field} issues={issues} composite>
          <EquippedModifiersEditor rows={value} onChange={onChange} catalog={catalog} />
        </Shell>
      );
    case "grantedFeatures":
      return (
        <Shell field={field} issues={issues} composite>
          <GrantedFeaturesEditor rows={value} onChange={onChange} catalog={catalog} />
        </Shell>
      );
    case "attackTargeting":
      return (
        <Shell field={field} issues={issues} composite>
          <AttackTargetingEditor value={value} onChange={onChange} catalog={catalog} />
        </Shell>
      );
    case "attackResolution":
      return (
        <Shell field={field} issues={issues} composite>
          <AttackResolutionEditor value={value} onChange={onChange} catalog={catalog} />
        </Shell>
      );
    case "traitParameters":
      return (
        <Shell field={field} issues={issues} composite>
          <TraitParametersEditor rows={value} onChange={onChange} catalog={catalog} />
        </Shell>
      );
    case "useSites":
      return (
        <Shell field={field} issues={issues} composite>
          <UseSitesEditor rows={value} onChange={onChange} catalog={catalog} />
        </Shell>
      );
    case "traitContract":
      return (
        <Shell field={field} issues={issues} composite>
          <TraitContractEditor value={value} onChange={onChange} />
        </Shell>
      );
    case "coreFormula": {
      const own = field.ownStatisticKey !== undefined ? payload?.[field.ownStatisticKey] : undefined;
      return (
        <Shell field={field} issues={issues} composite>
          <FormulaEditor value={value} onChange={onChange} catalog={catalog} sourceKinds={catalog.vocabularies[field.sources] ?? []} label={field.label} ownStatistic={typeof own === "string" ? own : null} />
        </Shell>
      );
    }
    // ---- RULES-WO1 Phase D: one Mage Art scaling — a level table OR a Formula over Stats and Level, with its text ----
    case "mageArtScaling": {
      const sc = asObject(value);
      const table = sc.byLevel !== null && sc.byLevel !== undefined;
      const rows = Array.isArray(sc.byLevel) ? (sc.byLevel as Array<{ fromLevel?: number | null; toLevel?: number | null; value?: number | null }>) : [];
      const set = (patch: Record<string, unknown>) => onChange({ ...sc, ...patch });
      const num = (v: string) => (v.trim() === "" || !Number.isFinite(Number(v)) ? null : Math.trunc(Number(v)));
      return (
        <Shell field={field} issues={issues} composite>
          <FieldControl field={{ key: "scalingKey", label: "Scaling name", group: "", input: "token", required: true }} value={sc.scalingKey} onChange={(v) => set({ scalingKey: v })} catalog={catalog} issues={[]} />
          <FieldControl field={{ key: "label", label: "Label", group: "", input: "line", required: true }} value={sc.label} onChange={(v) => set({ label: v })} catalog={catalog} issues={[]} />
          <label className="gov-field">
            <span>Unit (optional, e.g. ft)</span>
            <input value={typeof sc.unit === "string" ? sc.unit : ""} onChange={(e) => set({ unit: e.target.value.trim() === "" ? null : e.target.value })} />
          </label>
          <div role="radiogroup" aria-label="How it scales">
            <label className="prowess-authoring__inline">
              <input type="radio" name={`${listId}-scaling`} checked={table} onChange={() => set({ byLevel: [], formula: null })} /> By a Level table
            </label>
            <label className="prowess-authoring__inline">
              <input type="radio" name={`${listId}-scaling`} checked={!table} onChange={() => set({ byLevel: null, formula: initialFieldValue({ key: "formula", label: "", group: "", input: "coreFormula", sources: "mageArtScalingSourceKinds", required: true }) })} /> By a Formula (Stats and Level)
            </label>
          </div>
          {table ? (
            <fieldset className="prowess-authoring__nested" data-testid="mage-art-level-table">
              <legend>Level table (every Level covered once, in order)</legend>
              <ol>
                {rows.map((r, i) => (
                  <li key={i} className="prowess-authoring__row">
                    <label className="gov-field">
                      <span>From Level</span>
                      <input aria-label={`Level row ${i + 1} from`} type="number" value={r.fromLevel ?? ""} onChange={(e) => set({ byLevel: rows.map((x, j) => (j === i ? { ...x, fromLevel: num(e.target.value) } : x)) })} />
                    </label>
                    <label className="gov-field">
                      <span>To Level</span>
                      <input aria-label={`Level row ${i + 1} to`} type="number" value={r.toLevel ?? ""} onChange={(e) => set({ byLevel: rows.map((x, j) => (j === i ? { ...x, toLevel: num(e.target.value) } : x)) })} />
                    </label>
                    <label className="gov-field">
                      <span>Value</span>
                      <input aria-label={`Level row ${i + 1} value`} type="number" value={r.value ?? ""} onChange={(e) => set({ byLevel: rows.map((x, j) => (j === i ? { ...x, value: num(e.target.value) } : x)) })} />
                    </label>
                    <button type="button" className="gov-link-button" onClick={() => set({ byLevel: rows.filter((_, j) => j !== i) })}>
                      Remove row {i + 1}
                    </button>
                  </li>
                ))}
              </ol>
              <button type="button" className="gov-button" onClick={() => set({ byLevel: [...rows, { fromLevel: rows.length === 0 ? 1 : null, toLevel: null, value: null }] })}>
                Add Level row
              </button>
            </fieldset>
          ) : (
            <FieldControl field={{ key: "formula", label: "Formula", group: "", input: "coreFormula", sources: "mageArtScalingSourceKinds", required: true }} value={sc.formula} onChange={(v) => set({ formula: v })} catalog={catalog} issues={[]} />
          )}
          <FieldControl field={{ key: "text", label: "As written", group: "", input: "text", required: true }} value={sc.text} onChange={(v) => set({ text: v })} catalog={catalog} issues={[]} />
        </Shell>
      );
    }
    // ---- RULES-WO1: a Formula the rulebook may leave unstated, an optional source, a list of exact references --------
    case "optionalFormula": {
      const present = value !== null && value !== undefined;
      return (
        <Shell field={field} issues={issues} composite>
          <div role="radiogroup" aria-label={field.label}>
            <label className="prowess-authoring__inline">
              <input type="radio" name={`${listId}-optional`} checked={present} onChange={() => onChange(initialFieldValue({ ...field, input: "coreFormula" }))} /> {field.presentLabel}
            </label>
            <label className="prowess-authoring__inline">
              <input type="radio" name={`${listId}-optional`} checked={!present} onChange={() => onChange(null)} /> {field.absentLabel}
            </label>
          </div>
          {present ? <FormulaEditor value={value} onChange={onChange} catalog={catalog} sourceKinds={catalog.vocabularies[field.sources] ?? []} label={field.label} /> : <p className="gov-muted" data-testid="formula-not-stated">Not stated in the rulebook — no base value is invented.</p>}
        </Shell>
      );
    }
    case "optionalSource": {
      const present = value !== null && value !== undefined;
      return (
        <Shell field={field} issues={issues} composite>
          <label className="prowess-authoring__inline">
            <input type="checkbox" checked={present} onChange={(e) => onChange(e.target.checked ? { locators: [], conflicts: [] } : null)} /> Cite rulebook sections
          </label>
          {present ? <FieldControl field={{ key: field.key, label: field.label, group: field.group, input: "source", required: true }} value={value} onChange={onChange} catalog={catalog} issues={[]} payload={payload} /> : null}
        </Shell>
      );
    }
    case "contentToken":
      return (
        <LabeledControl field={field} issues={issues}>
          {(p) => <ContentTokenSelect id={p.id} describedBy={p["aria-describedby"]} value={value} onChange={(v) => onChange(v === "" && !field.required ? null : v)} options={field.options} />}
        </LabeledControl>
      );
    case "contentTokenList":
      return (
        <Shell field={field} issues={issues} composite>
          <ContentTokenList value={value} onChange={onChange} options={field.options} label={field.label} />
        </Shell>
      );
    case "triState":
      return (
        <Shell field={field} issues={issues} composite>
          <div role="radiogroup" aria-label={field.label}>
            {([[true, field.yes], [false, field.no], [null, field.unknown]] as const).map(([v, label]) => (
              <label key={String(v)} className="prowess-authoring__inline">
                <input type="radio" name={`${listId}-tri`} checked={value === v || (v === null && value === undefined)} onChange={() => onChange(v)} /> {label}
              </label>
            ))}
          </div>
        </Shell>
      );
    case "missionRule":
      return (
        <Shell field={field} issues={issues} composite>
          <MissionRuleEditor value={value} onChange={onChange} catalog={catalog} shapesVocabulary={field.shapes ?? "missionRuleShapes"} />
        </Shell>
      );
    case "refList": {
      const items = asArray(value);
      return (
        <Shell field={field} issues={issues} composite>
          <RefList items={items} onChange={onChange} refKind={field.refKind} itemLabel={field.itemLabel} />
        </Shell>
      );
    }
    // ---- PRE-M7-WO1 guided runtime / progression inputs -------------------------------------------------------------
    case "rows":
      return (
        <Shell field={field} issues={issues} composite>
          <RowsEditor value={value} onChange={onChange} columns={field.columns} itemLabel={field.itemLabel} label={field.label} catalog={catalog} />
        </Shell>
      );
    case "integerList":
      return <LabeledControl field={field} issues={issues}>{(p) => <IntegerListInput id={p.id} describedBy={p["aria-describedby"]} value={value} onChange={onChange} />}</LabeledControl>;
    case "optionalFeet":
      return <LabeledControl field={field} issues={issues}>{(p) => <OptionalFeetInput id={p.id} describedBy={p["aria-describedby"]} value={value} onChange={onChange} />}</LabeledControl>;
    // ---- PRE-M7-WO1 recursive structure (every key the form does not show is kept) -----------------------------------
    case "group": {
      if (value === null || value === undefined) {
        const ruling = field.defaultFrom === undefined ? undefined : catalog.rulingDefaults?.[field.defaultFrom];
        return (
          <Shell field={field} issues={issues} composite>
            <p className="gov-muted">Not set.</p>
            {ruling !== undefined ? (
              <button type="button" className="gov-link-button" data-testid={`${field.key}-add-ruling`} onClick={() => onChange(JSON.parse(JSON.stringify(ruling)))}>
                Add {field.label.toLowerCase()} — start from the Core Playtest ruling
              </button>
            ) : null}
            <button type="button" className="gov-link-button" onClick={() => onChange(Object.fromEntries(field.fields.map((f) => [f.key, initialFieldValue(f)])))}>
              Set {field.label.toLowerCase()}
            </button>
          </Shell>
        );
      }
      const obj = asObject(value);
      return (
        <Shell field={field} issues={issues} composite>
          {field.fields.map((sf) => (
            <FieldControl key={sf.key} field={{ ...sf, key: `${field.key}.${sf.key}` }} value={sub(obj, sf.key)} onChange={(v) => onChange(put(obj, sf.key, v))} catalog={catalog} issues={[]} payload={payload} />
          ))}
          {field.nullable || field.absent ? (
            <button type="button" className="gov-link-button" onClick={() => onChange(field.absent ? undefined : null)}>
              {field.absent ? "Remove" : "Clear"} {field.label.toLowerCase()}
            </button>
          ) : null}
        </Shell>
      );
    }
    case "list": {
      const items = asArray(value);
      const setAt = (i: number, v: unknown) => onChange(items.map((x, j) => (j === i ? v : x)));
      const move = (i: number, d: -1 | 1) => {
        const next = [...items];
        const [x] = next.splice(i, 1);
        next.splice(i + d, 0, x as Record<string, unknown>);
        onChange(next);
      };
      return (
        <Shell field={field} issues={issues} composite>
          {items.length === 0 ? <p className="gov-muted">None.</p> : null}
          <ol className="prowess-formula__terms">
            {items.map((item, i) => (
              <li key={i} className="prowess-impact" data-testid="guided-list-item">
                <p>
                  <strong>
                    {field.itemLabel} {i + 1}
                  </strong>
                </p>
                {field.item.map((sf) => (
                  <FieldControl key={sf.key} field={{ ...sf, key: `${field.key}.${i}.${sf.key}` }} value={sub(asObject(item), sf.key)} onChange={(v) => setAt(i, put(asObject(item), sf.key, v))} catalog={catalog} issues={[]} payload={payload} />
                ))}
                <div className="gov-actions">
                  <button type="button" className="gov-link-button" disabled={i === 0} onClick={() => move(i, -1)} aria-label={`Move ${field.itemLabel} ${i + 1} up`}>
                    Up
                  </button>
                  <button type="button" className="gov-link-button" disabled={i === items.length - 1} onClick={() => move(i, 1)} aria-label={`Move ${field.itemLabel} ${i + 1} down`}>
                    Down
                  </button>
                  <button type="button" className="gov-link-button" onClick={() => onChange(items.filter((_, j) => j !== i))} aria-label={`Remove ${field.itemLabel} ${i + 1}`}>
                    Remove
                  </button>
                </div>
              </li>
            ))}
          </ol>
          <button
            type="button"
            className="gov-button"
            onClick={() =>
              // A whole-item field (key "", e.g. a Mage Art scaling or a prerequisite chosen by kind) starts as that field's
              // own initial value — never as a record under an empty key (which a later kind switch would refuse to drop).
              onChange([...items, field.item.length === 1 && field.item[0]!.key === "" ? (initialFieldValue(field.item[0]!) ?? {}) : Object.fromEntries(field.item.map((f) => [f.key, initialFieldValue(f)]))])
            }
          >
            Add {field.itemLabel.toLowerCase()}
          </button>
        </Shell>
      );
    }
    case "variant": {
      const obj = value === null || value === undefined ? null : asObject(value);
      const current = obj === null ? "" : String(obj[field.discriminator] ?? "");
      const fields = field.variants[current] ?? [];
      const choose = (next: string) => {
        if (next === "" && field.nullable) return onChange(null);
        const nextFields = field.variants[next] ?? [];
        const keep = new Set([field.discriminator, ...nextFields.map((f) => f.key)]);
        const dropped = obj === null ? [] : Object.keys(obj).filter((k) => !keep.has(k) && obj[k] !== null && obj[k] !== undefined && obj[k] !== "");
        // Switching shape never silently discards populated data: the designer confirms what will be dropped.
        const labelOfKey = (k: string) => Object.values(field.variants).flat().find((f) => f.key === k)?.label ?? formatEnumLabel(k);
        if (dropped.length > 0 && !window.confirm(`Switching to ${formatEnumLabel(next)} removes: ${dropped.map(labelOfKey).join(", ")}. Continue?`)) return;
        onChange({ [field.discriminator]: next, ...Object.fromEntries(nextFields.map((f) => [f.key, obj?.[f.key] ?? initialFieldValue(f)])) });
      };
      return (
        <Shell field={field} issues={issues} composite>
          <label className="gov-field">
            <span>{formatEnumLabel(field.discriminator).replace(/^./, (c) => c.toUpperCase())}</span>
            <select value={current} onChange={(e) => choose(e.target.value)}>
              <option value="">{field.nullable ? "None" : "Choose…"}</option>
              {(catalog.vocabularies[field.vocabulary] ?? []).map((o) => (
                <option key={o} value={o}>
                  {formatEnumLabel(o)}
                </option>
              ))}
            </select>
          </label>
          {obj !== null
            ? fields.map((sf) => <FieldControl key={sf.key} field={{ ...sf, key: `${field.key}.${sf.key}` }} value={sub(obj, sf.key)} onChange={(v) => onChange(put(obj, sf.key, v))} catalog={catalog} issues={[]} payload={payload} />)
            : null}
        </Shell>
      );
    }
    case "multiSelect": {
      const chosen = Array.isArray(value) ? (value as unknown[]) : [];
      return (
        <Shell field={field} issues={issues} composite>
          {(catalog.vocabularies[field.vocabulary] ?? []).map((o) => (
            <label key={o} className="prowess-rule-preview__toggle">
              <input type="checkbox" checked={chosen.includes(o)} onChange={(e) => onChange(e.target.checked ? [...chosen, o] : chosen.filter((x) => x !== o))} /> {formatEnumLabel(o)}
            </label>
          ))}
        </Shell>
      );
    }
    case "byVocabulary": {
      // One sub-record per value of a vocabulary (e.g. per roll mode); values the vocabulary does not list are kept.
      const obj = asObject(value);
      return (
        <Shell field={field} issues={issues} composite>
          {(catalog.vocabularies[field.vocabulary] ?? []).map((v) => (
            <fieldset key={v} className="prowess-authoring__nested">
              <legend>{formatEnumLabel(v)}</legend>
              {field.fields.map((sf) => (
                <FieldControl key={sf.key} field={{ ...sf, key: `${field.key}.${v}.${sf.key}` }} value={asObject(obj[v])[sf.key]} onChange={(x) => onChange({ ...obj, [v]: { ...asObject(obj[v]), [sf.key]: x } })} catalog={catalog} issues={[]} payload={payload} />
              ))}
            </fieldset>
          ))}
        </Shell>
      );
    }
    // ---- RULES-WO1 Phase H: guided controls for formerly technical fields ------------------------------------------
    case "fixedFormula":
      return (
        <Shell field={field} issues={issues} composite>
          <FixedInputFormula value={value} onChange={onChange} catalog={catalog} inputs={catalog.fixedLists?.[field.inputs] ?? []} allInputs={field.allInputs} expressionOnly={field.expressionOnly} label={field.label} />
        </Shell>
      );
    case "naturalSelection":
      return (
        <Shell field={field} issues={issues} composite>
          <NaturalSelectionEditor value={value} onChange={onChange} catalog={catalog} allowNone={field.allowNone ?? false} testId={`natural-${field.key.replace(/^\W+/, "").replace(/\W+/g, "-")}`} />
        </Shell>
      );
    case "writtenNotes":
      return (
        <Shell field={field} issues={issues} composite>
          <WrittenNotesEditor value={value} onChange={onChange} label={field.label} testId={`notes-${field.key.replace(/^\W+/, "").replace(/\W+/g, "-")}`} />
        </Shell>
      );
    case "playCheck":
      return (
        <Shell field={field} issues={issues} composite>
          <PlayCheckEditor value={value} onChange={onChange} testId={`play-check-${field.key.replace(/^\W+/, "").replace(/\W+/g, "-")}`} />
        </Shell>
      );
    case "openQuestion":
      return (
        <Shell field={field} issues={issues} composite>
          <OpenQuestionInput value={value} onChange={onChange} label={field.label} testId={`open-question-${field.key.replace(/^\W+/, "").replace(/\W+/g, "-")}`} />
        </Shell>
      );
    case "selectMap": {
      const obj = asObject(value);
      const keys = catalog.vocabularies[field.keys] ?? catalog.fixedLists?.[field.keys] ?? [];
      const options = catalog.vocabularies[field.vocabulary] ?? [];
      return (
        <Shell field={field} issues={issues} composite>
          {keys.map((k) => (
            <label key={k} className="gov-field">
              <span>{formatEnumLabel(k)}</span>
              <select data-testid={`select-map-${field.key.replace(/^\W+/, "").replace(/\W+/g, "-")}-${k}`} value={typeof obj[k] === "string" ? (obj[k] as string) : ""} onChange={(e) => onChange({ ...obj, [k]: e.target.value })}>
                <option value="">Choose…</option>
                {options.map((o) => (
                  <option key={o} value={o}>
                    {formatEnumLabel(o)}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </Shell>
      );
    }
    case "fixedChoice": {
      const options = catalog.fixedLists?.[field.list] ?? [];
      // Words for the comparison a roll uses (the stored value stays the exact operator the reader requires).
      const words = (o: string) => (options.length === 1 && field.list === "rollComparisonOperators" ? "meets or exceeds the difficulty" : o);
      return (
        <LabeledControl field={field} issues={issues}>
          {(p) => (
            <select {...p} value={typeof value === "string" ? value : ""} onChange={(e) => onChange(e.target.value)}>
              <option value="">Choose…</option>
              {options.map((o) => (
                <option key={o} value={o}>
                  {words(o)}
                </option>
              ))}
            </select>
          )}
        </LabeledControl>
      );
    }
    case "wordList":
      return (
        <Shell field={field} issues={issues} composite>
          <OptionList label={field.label} values={Array.isArray(value) ? (value as string[]) : []} testId={`words-${field.key.replace(/^\W+/, "").replace(/\W+/g, "-")}`} onChange={onChange} />
        </Shell>
      );
    case "optionalData":
      // Optional advanced data: absent stays absent (never written as an empty object).
      return (
        <Shell field={field} issues={issues} composite>
          {value === undefined ? (
            <>
              <p className="gov-muted">Not set.</p>
              <button type="button" className="gov-link-button" onClick={() => onChange({})}>
                Add {field.label.toLowerCase()}
              </button>
            </>
          ) : (
            <>
              <AuthoredDataEditor value={asObject(value)} onChange={onChange as (v: Record<string, unknown>) => void} label={field.label} />
              <button type="button" className="gov-link-button" onClick={() => onChange(undefined)}>
                Remove {field.label.toLowerCase()}
              </button>
            </>
          )}
        </Shell>
      );
    case "line":
      return <LabeledControl field={field} issues={issues}>{(p) => <input {...p} value={typeof value === "string" ? value : ""} onChange={(e) => onChange(e.target.value)} autoComplete="off" spellCheck={false} />}</LabeledControl>;
    case "reference":
      return (
        <Shell field={field} issues={issues} composite>
          <SingleReference value={value} refKind={field.refKind} label={field.label} onChange={onChange} />
        </Shell>
      );
    case "abilityDefinition":
      return (
        <Shell field={field} issues={issues} composite>
          <AbilityDefinitionEditor branch={field.branch} affinityKind={field.affinityKind} payload={payload ?? {}} onPayloadChange={onChange} catalog={catalog} onCreateChild={onCreateChild} />
        </Shell>
      );
    case "componentMechanics": {
      const maneuver = shapeOf(TRAIT_FAMILY_SHAPES, field.branch) === "maneuver";
      const kinds = field.kinds ?? { affinity: "", maneuverTargeting: "" };
      return (
        <Shell field={field} issues={issues} composite>
          <MechanicsIssues.Provider value={issues}>
            {field.contract === "effect" ? (
              <EffectMechanicsEditor branch={field.branch ?? ""} maneuver={maneuver} payload={payload ?? {}} onPayloadChange={onChange} catalog={catalog} kinds={kinds} />
            ) : field.contract === "trait" ? (
              <TraitMechanicsEditor family={traitFamilyFor(field.branch)} maneuver={maneuver} traitKind={field.definitionKind ?? ""} payload={payload ?? {}} onPayloadChange={onChange} catalog={catalog} kinds={kinds} />
            ) : field.contract === "targeting" ? (
              <TargetingMechanicsEditor maneuver={maneuver} payload={payload ?? {}} onPayloadChange={onChange} catalog={catalog} kinds={kinds} />
            ) : field.contract === "duration" ? (
              <DurationMechanicsEditor branch={field.branch ?? ""} payload={payload ?? {}} onPayloadChange={onChange} catalog={catalog} kinds={kinds} />
            ) : field.contract === "condition" ? (
              <ConditionMechanicsEditor branch={field.branch ?? ""} maneuver={maneuver} payload={payload ?? {}} onPayloadChange={onChange} catalog={catalog} kinds={kinds} />
            ) : (
              <FoundationMechanicsEditor payload={payload ?? {}} onPayloadChange={onChange} catalog={catalog} kinds={kinds} />
            )}
          </MechanicsIssues.Provider>
        </Shell>
      );
    }
    case "boolean":
      return <LabeledControl field={field} issues={issues}>{(p) => <input {...p} type="checkbox" checked={value === true} onChange={(e) => onChange(e.target.checked)} />}</LabeledControl>;
    case "equipmentSource":
      return (
        <Shell field={field} issues={issues} composite>
          <SourceSectionPicker value={value} onChange={onChange} extraListFields={[{ key: "designerAuthority", label: "Designer authority (comma-separated, e.g. M6-WO6 §103)" }]} />
        </Shell>
      );
  }
}

/** M6-WO4 Character Advancement Rule: one row per Level — Stat Points and Skill advancements gained on reaching it. */
function AdvancementLevelsEditor({ rows, onChange }: { rows: Array<Record<string, unknown>>; onChange: (v: unknown) => void }) {
  const set = (i: number, key: string, raw: string) => onChange(rows.map((r, j) => (j === i ? { ...r, [key]: raw === "" ? "" : Number(raw) } : r)));
  const num = (v: unknown) => (typeof v === "number" ? String(v) : "");
  return (
    <div>
      {rows.length === 0 ? <p className="gov-muted">No Levels yet.</p> : null}
      <table className="prowess-reference__table" aria-label="Advancement by Level">
        <thead>
          <tr>
            <th scope="col">Level</th>
            <th scope="col">Stat Points</th>
            <th scope="col">Skill advancements</th>
            <th scope="col">Remove</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              <td>
                <input type="number" step={1} aria-label={`Level of row ${i + 1}`} value={num(r.level)} onChange={(e) => set(i, "level", e.target.value)} />
              </td>
              <td>
                <input type="number" step={1} aria-label={`Stat Points of row ${i + 1}`} value={num(r.statPoints)} onChange={(e) => set(i, "statPoints", e.target.value)} />
              </td>
              <td>
                <input type="number" step={1} aria-label={`Skill advancements of row ${i + 1}`} value={num(r.skillAdvancements)} onChange={(e) => set(i, "skillAdvancements", e.target.value)} />
              </td>
              <td>
                <button type="button" className="gov-link-button" onClick={() => onChange(rows.filter((_, j) => j !== i))}>
                  Remove row {i + 1}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button type="button" className="gov-button" onClick={() => onChange([...rows, { level: "", statPoints: "", skillAdvancements: "" }])}>
        Add Level
      </button>
    </div>
  );
}

/** M6-WO3 Ancestry Stat grants: FIXED (one Stat) or CHOOSE_DISTINCT (count of different allowed Stats). */
function StatGrantsEditor({ rows, onChange, catalog }: { rows: Array<Record<string, unknown>>; onChange: (v: unknown) => void; catalog: AuthoringCatalogDto }) {
  const stats = catalog.vocabularies.prowessStats ?? [];
  const kinds = catalog.vocabularies.ancestryStatGrantKinds ?? [];
  const set = (i: number, next: Record<string, unknown>) => onChange(rows.map((r, j) => (j === i ? next : r)));
  return (
    <div>
      {rows.length === 0 ? <p className="gov-muted">No Stat grants.</p> : null}
      {rows.map((r, i) => {
        const choice = r.kind !== undefined && r.kind !== kinds[0];
        const allowed = Array.isArray(r.allowedStats) ? (r.allowedStats as string[]) : [];
        return (
          <fieldset key={i} className="prowess-authoring__nested" aria-label={`Stat grant ${i + 1}`}>
            <legend>Stat grant {i + 1}</legend>
            <label className="gov-field">
              <span>Grant key</span>
              <input value={String(r.grantKey ?? "")} onChange={(e) => set(i, { ...r, grantKey: e.target.value })} autoComplete="off" spellCheck={false} />
            </label>
            <label className="gov-field">
              <span>Grant kind</span>
              <select
                value={String(r.kind ?? "")}
                onChange={(e) => set(i, e.target.value === kinds[0] ? { grantKey: r.grantKey ?? "", kind: e.target.value, stat: "", amount: r.amount ?? 1 } : { grantKey: r.grantKey ?? "", kind: e.target.value, count: 1, amount: r.amount ?? 1, allowedStats: [] })}
              >
                <option value="">Choose…</option>
                {kinds.map((k) => (
                  <option key={k} value={k}>
                    {k}
                  </option>
                ))}
              </select>
            </label>
            {!choice ? (
              <label className="gov-field">
                <span>Stat</span>
                <select value={String(r.stat ?? "")} onChange={(e) => set(i, { ...r, stat: e.target.value })}>
                  <option value="">Choose…</option>
                  {stats.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <>
                <label className="gov-field">
                  <span>Number of different Stats</span>
                  <input type="number" step={1} value={typeof r.count === "number" ? r.count : ""} onChange={(e) => set(i, { ...r, count: e.target.value === "" ? null : Number(e.target.value) })} />
                </label>
                <fieldset className="prowess-authoring__nested">
                  <legend>Allowed Stats</legend>
                  {stats.map((s) => (
                    <label key={s} className="prowess-authoring__inline">
                      <input type="checkbox" checked={allowed.includes(s)} onChange={(e) => set(i, { ...r, allowedStats: e.target.checked ? [...allowed, s] : allowed.filter((x) => x !== s) })} /> {s}
                    </label>
                  ))}
                </fieldset>
              </>
            )}
            <label className="gov-field">
              <span>Amount</span>
              <input type="number" step={1} value={typeof r.amount === "number" ? r.amount : ""} onChange={(e) => set(i, { ...r, amount: e.target.value === "" ? null : Number(e.target.value) })} />
            </label>
            <button type="button" className="gov-link-button" onClick={() => onChange(rows.filter((_, j) => j !== i))}>
              Remove Stat grant {i + 1}
            </button>
          </fieldset>
        );
      })}
      <button type="button" className="gov-button" onClick={() => onChange([...rows, { grantKey: "", kind: kinds[0] ?? "", stat: "", amount: 1 }])}>
        Add Stat grant
      </button>
    </div>
  );
}

/** M6-WO3 Ancestry starting-Skill grants; options are EXACT SKILL references chosen with the reference picker. */
function SkillGrantsEditor({ rows, onChange, catalog, optionKind }: { rows: Array<Record<string, unknown>>; onChange: (v: unknown) => void; catalog: AuthoringCatalogDto; optionKind: string }) {
  const kinds = catalog.vocabularies.ancestrySkillSelectionKinds ?? [];
  const [picking, setPicking] = useState<number | null>(null);
  const set = (i: number, next: Record<string, unknown>) => onChange(rows.map((r, j) => (j === i ? next : r)));
  return (
    <div>
      {rows.length === 0 ? <p className="gov-muted">No starting Skill grants.</p> : null}
      {rows.map((r, i) => {
        const options = Array.isArray(r.options) ? (r.options as Array<Record<string, unknown>>) : [];
        return (
          <fieldset key={i} className="prowess-authoring__nested" aria-label={`Skill grant ${i + 1}`}>
            <legend>Skill grant {i + 1}</legend>
            <label className="gov-field">
              <span>Grant key</span>
              <input value={String(r.grantKey ?? "")} onChange={(e) => set(i, { ...r, grantKey: e.target.value })} autoComplete="off" spellCheck={false} />
            </label>
            <label className="gov-field">
              <span>Selection</span>
              <select value={String(r.selectionKind ?? "")} onChange={(e) => set(i, { ...r, selectionKind: e.target.value })}>
                <option value="">Choose…</option>
                {kinds.map((k) => (
                  <option key={k} value={k}>
                    {k}
                  </option>
                ))}
              </select>
            </label>
            <label className="gov-field">
              <span>Number of Skills</span>
              <input type="number" step={1} value={typeof r.count === "number" ? r.count : ""} onChange={(e) => set(i, { ...r, count: e.target.value === "" ? null : Number(e.target.value) })} />
            </label>
            <label className="gov-field">
              <span>Starting rank</span>
              <input value={String(r.rankKey ?? "")} onChange={(e) => set(i, { ...r, rankKey: e.target.value })} autoComplete="off" spellCheck={false} />
            </label>
            <ul aria-label={`Skill options of grant ${i + 1}`}>
              {options.map((o, j) => (
                <li key={j}>
                  <code>{String(o.canonicalKey)}</code>{" "}
                  <button type="button" className="gov-link-button" onClick={() => set(i, { ...r, options: options.filter((_, k) => k !== j) })}>
                    Remove option {String(o.canonicalKey)}
                  </button>
                </li>
              ))}
            </ul>
            {picking === i ? (
              <DefinitionReferencePicker
                label={`Add an exact Skill to grant ${i + 1}`}
                definitionKind={optionKind}
                onSelect={(ref) => {
                  set(i, { ...r, options: [...options, ref] });
                  setPicking(null);
                }}
                onCancel={() => setPicking(null)}
              />
            ) : (
              <button type="button" className="gov-button" onClick={() => setPicking(i)}>
                Add Skill option
              </button>
            )}
            <button type="button" className="gov-link-button" onClick={() => onChange(rows.filter((_, j) => j !== i))}>
              Remove Skill grant {i + 1}
            </button>
          </fieldset>
        );
      })}
      <button type="button" className="gov-button" onClick={() => onChange([...rows, { grantKey: "", rankKey: "", selectionKind: kinds[0] ?? "", count: 1, options: [] }])}>
        Add Skill grant
      </button>
    </div>
  );
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
  onCreateChild,
}: {
  kind: AuthoringKindDto;
  catalog: AuthoringCatalogDto;
  candidate: DefinitionCandidate;
  onChange: (c: DefinitionCandidate) => void;
  issues: readonly ValidationIssueDto[];
  readOnly?: boolean;
  /** PRE-M7-WO1: create a reusable child component as its own Draft and return here (the caller keeps unsaved work). */
  onCreateChild?: (kind: string, slot: string) => void;
}) {
  const descriptor = descriptorFor(kind, candidate.schemaVersion);
  const generic = descriptor === GENERIC_DESCRIPTOR;
  const setField = (key: string, v: unknown) => onChange({ ...candidate, payload: key === "" ? (v as Payload) : { ...candidate.payload, [key]: v } });
  return (
    <div className="prowess-authoring__definition" data-definition-kind={kind.definitionKind}>
      <p className="prowess-authoring__purpose">{descriptor.purpose}</p>
      {descriptor === GENERIC_DESCRIPTOR ? (
        <p className="gov-muted" data-testid="generic-editor-build-note">
          If you expected a guided editor here, check <a href="/about">About this build</a>: it shows which build is running and which kinds it edits with a guided editor.
        </p>
      ) : null}
      <p className="gov-muted">
        {kind.definitionKind} · family {kind.systemFamily}
        {kind.branch ? ` · ${kind.branch} branch` : ""}
        {kind.sharedContract ? ` · ${kind.sharedContract} contract` : ""} · payload schema version {candidate.schemaVersion}
      </p>
      <fieldset disabled={readOnly} className="prowess-authoring__groups">
        <legend className="prowess-visually-hidden">Prowess Definition fields</legend>
        {groupsOf(descriptor).map((group) => (
          <section key={group} id={`group-${group.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`} className="prowess-authoring__group" aria-label={group}>
            <h4>{group}</h4>
            {descriptor.fields
              .filter((f) => f.group === group)
              .map((f) => (
                <FieldControl key={`${f.key}:${stableStringify(kind.definitionKind)}`} field={f} value={generic || f.key === "" ? candidate.payload : candidate.payload[f.key]} onChange={(v) => setField(f.key, v)} catalog={catalog} issues={issuesForField(issues, f.key)} payload={candidate.payload} onCreateChild={onCreateChild} />
              ))}
          </section>
        ))}
        <LegacyTermsEditor candidate={candidate} onChange={onChange} catalog={catalog} />
      </fieldset>
      <RawJson candidate={candidate} onChange={onChange} readOnly={readOnly} />
    </div>
  );
}

/** RULES-WO1: a list of exact Definition references (e.g. the Actions a Skill benefit grants). */
/** One compatibility rule: a relation from the list; allowed labels chosen by name or typed in plain words. */
function CompatibilityRow({ index, row, relations, onChange, onRemove }: { index: number; row: Record<string, unknown>; relations: readonly string[]; onChange: (patch: Record<string, unknown>) => void; onRemove: () => void }) {
  const [adding, setAdding] = useState<"" | "definition" | "keyword" | "label">("");
  const [label, setLabel] = useState("");
  const allow = Array.isArray(row.allow) ? (row.allow as string[]) : [];
  const add = (l: string) => {
    if (l !== "" && !allow.includes(l)) onChange({ allow: [...allow, l] });
    setAdding("");
    setLabel("");
  };
  return (
    <li className="prowess-authoring__row" data-testid="compatibility-rule">
      <label className="gov-field">
        <span>Relation</span>
        <select value={typeof row.relation === "string" ? row.relation : ""} onChange={(e) => onChange({ relation: e.target.value })}>
          <option value="">Choose…</option>
          {relations.map((r) => (
            <option key={r} value={r}>
              {formatEnumLabel(r)}
            </option>
          ))}
        </select>
      </label>
      <div>
        <span>Allowed</span>
        {allow.length === 0 ? <p className="gov-muted">Nothing chosen yet.</p> : null}
        <ul aria-label={`Compatibility rule ${index + 1}: allowed`}>
          {allow.map((l) => (
            <li key={l} data-testid="compatibility-allowed">
              {refWords({ canonicalKey: l })}{" "}
              <button type="button" className="gov-link-button" onClick={() => onChange({ allow: allow.filter((x) => x !== l) })} aria-label={`Remove ${refWords({ canonicalKey: l })}`}>
                Remove
              </button>
            </li>
          ))}
        </ul>
        {adding === "definition" ? (
          <DefinitionReferencePicker label="Choose an allowed Definition" onSelect={(r) => add(String(r.canonicalKey))} onCancel={() => setAdding("")} />
        ) : adding === "keyword" ? (
          <KeywordPicker label="Choose an allowed Keyword" exclude={allow} onPick={(k) => add(k.canonicalKey)} />
        ) : adding === "label" ? (
          <label className="gov-field">
            <span>Allowed label in plain words</span>
            <input value={label} onChange={(e) => setLabel(asToken(e.target.value))} onBlur={(e) => setLabel(asToken(e.target.value, true))} />
            <button type="button" className="gov-button" disabled={asToken(label, true) === ""} onClick={() => add(asToken(label, true))}>
              Add
            </button>
          </label>
        ) : (
          <p className="gov-actions">
            <button type="button" className="gov-button" onClick={() => setAdding("definition")}>
              Add a Definition
            </button>{" "}
            <button type="button" className="gov-button" onClick={() => setAdding("keyword")}>
              Add a Keyword
            </button>{" "}
            <button type="button" className="gov-link-button" onClick={() => setAdding("label")}>
              Add another label
            </button>
          </p>
        )}
      </div>
      <button type="button" className="gov-button" onClick={onRemove} aria-label={`Remove compatibility rule ${index + 1}`}>
        Remove
      </button>
    </li>
  );
}

/** A reference in words: the last part of its key ("….rw1.reference.grappling" → "Grappling"). The picker hands back only the
 *  exact reference (M6-WO1), and the Canonical Key is suggested from the Display Name, so this reads as the entry's name. */
function refWords(r: Record<string, unknown>): string {
  const last = String(r.canonicalKey ?? "").split(".").at(-1) ?? "";
  const words = last.replace(/_[0-9a-z]{6,}$/, "").split("_").filter((w) => w !== "").join(" ").toLowerCase();
  return words === "" ? "Unnamed rule" : words.charAt(0).toUpperCase() + words.slice(1);
}

function RefList({ items, onChange, refKind, itemLabel }: { items: readonly Record<string, unknown>[]; onChange: (v: unknown) => void; refKind: string; itemLabel: string }) {
  const [picking, setPicking] = useState(false);
  return (
    <div>
      {items.length === 0 ? <p className="gov-muted">None.</p> : null}
      <ol>
        {items.map((r, i) => (
          <li key={`${String(r.entityVersionId)}-${i}`}>
            <strong data-testid="ref-list-name">{refWords(r)}</strong>{" "}
            <button type="button" className="gov-link-button" onClick={() => onChange(items.filter((_, j) => j !== i))} aria-label={`Remove ${itemLabel} ${i + 1}`}>
              Remove
            </button>
          </li>
        ))}
      </ol>
      {picking ? (
        <DefinitionReferencePicker
          label={`Choose the exact ${itemLabel.toLowerCase()}`}
          definitionKind={refKind}
          onSelect={(r) => {
            onChange([...items, r]);
            setPicking(false);
          }}
          onCancel={() => setPicking(false)}
        />
      ) : (
        <button type="button" className="gov-button" onClick={() => setPicking(true)}>
          Add {itemLabel.toLowerCase()}
        </button>
      )}
    </div>
  );
}

/** One exact Definition reference (never a name, never "latest"), chosen with the reference picker. */
function SingleReference({ value, refKind, label, onChange }: { value: unknown; refKind: string; label: string; onChange: (v: unknown) => void }) {
  const [picking, setPicking] = useState(false);
  const ref = value !== null && typeof value === "object" ? (value as { canonicalKey?: string; definitionKind?: string }) : null;
  return (
    <div>
      {ref?.canonicalKey ? (
        <p>
          <code>{ref.canonicalKey}</code> <span className="gov-tag">{formatEnumLabel(ref.definitionKind ?? "")}</span>
        </p>
      ) : (
        <p className="gov-muted">Not chosen.</p>
      )}
      {picking ? (
        <DefinitionReferencePicker
          label={`Choose the exact ${label.toLowerCase()}`}
          definitionKind={refKind}
          onSelect={(r) => {
            onChange(r);
            setPicking(false);
          }}
          onCancel={() => setPicking(false)}
        />
      ) : (
        <button type="button" className="gov-link-button" onClick={() => setPicking(true)}>
          {ref ? `Change ${label.toLowerCase()}` : `Choose ${label.toLowerCase()}`}
        </button>
      )}
    </div>
  );
}
