"use client";

import { formatEnumLabel } from "@prowess/ui";
import { useId, useState } from "react";
import type { DefinitionRefDto, SpellCatalogDto, SpellComponentOptionDto, SpellParameterDto, SpellParametersDto } from "../../_lib/character-client";
import { keywordLabel, refName } from "../../_lib/spell-format";

/**
 * Builder building blocks (PAS-10 M6-WO7 §29–§38, §48–§62, §84–§85): the typed parameter fields and the searchable
 * component selector. Every option comes from the Character's exact Release catalog (no hard-coded list); locked options
 * stay visible with their reasons (§32); listed MP is the Definition's authored contribution, never a computed cost.
 */

/** The structured parameter contract of one component (§33, §56): typed inputs only — never a JSON editor. */
export function ParameterFields({ declared, values, onChange, label }: { declared: readonly SpellParameterDto[]; values: SpellParametersDto; onChange: (next: SpellParametersDto) => void; label: string }) {
  const base = useId();
  if (declared.length === 0) return null;
  return (
    <fieldset className="prowess-spell__parameters" data-testid="spell-parameters">
      <legend>{label} parameters</legend>
      {declared.map((p) => {
        const id = `${base}-${p.parameter}`;
        const current = values[p.parameter];
        const set = (v: number | string | boolean | null) => {
          const next = { ...values };
          if (v === null) delete next[p.parameter];
          else next[p.parameter] = v;
          onChange(next);
        };
        const bound = p.maximum ? (p.maximum.stat ? `max ${p.maximum.value ?? "?"} (${p.maximum.stat})` : `max ${p.maximum.value ?? "?"}`) : null;
        return (
          <div className="gov-field" key={p.parameter}>
            <label htmlFor={id}>
              {formatEnumLabel(p.parameter)}
              <span className="gov-muted">
                {" "}
                ({[p.minimum !== null ? `min ${p.minimum}` : null, bound, p.default !== null ? `default ${String(p.default)}` : null].filter(Boolean).join(", ")})
              </span>
            </label>
            {p.allowed !== null ? (
              <select id={id} value={current === undefined ? "" : String(current)} onChange={(e) => set(e.target.value === "" ? null : e.target.value)} data-testid={`spell-parameter-${p.parameter}`}>
                <option value="">Default{p.default !== null ? ` (${String(p.default)})` : ""}</option>
                {p.allowed.map((a) => (
                  <option key={a} value={a}>
                    {formatEnumLabel(a)}
                  </option>
                ))}
              </select>
            ) : typeof p.default === "boolean" ? (
              <input id={id} type="checkbox" checked={current === true} onChange={(e) => set(e.target.checked)} data-testid={`spell-parameter-${p.parameter}`} />
            ) : (
              <input
                id={id}
                type="number"
                inputMode="numeric"
                min={p.minimum ?? undefined}
                max={p.maximum?.value ?? undefined}
                step={p.increment ?? 1}
                value={typeof current === "number" ? current : ""}
                placeholder={p.default === null ? "" : String(p.default)}
                onChange={(e) => set(e.target.value === "" ? null : Number(e.target.value))}
                data-testid={`spell-parameter-${p.parameter}`}
              />
            )}
          </div>
        );
      })}
      <p className="gov-muted">Limits are the Release&apos;s; the server validates every value.</p>
    </fieldset>
  );
}

const requirementText = (r: NonNullable<SpellComponentOptionDto["eligibility"]>["requirements"][number], arcanaKey: string | null): string => {
  const q = r.required as { rankKey?: string; skillKey?: string; affinity?: unknown };
  const skill = q.skillKey === undefined ? "" : q.skillKey === arcanaKey ? "Arcane Authority Skill" : formatEnumLabel(String(q.skillKey).split(".").at(-1) ?? "");
  if (q.rankKey) return `Requires ${formatEnumLabel(q.rankKey)} ${skill}`.trim();
  return formatEnumLabel(r.prerequisiteKey);
};

/** Locked / unresolved reasons straight from the eligibility map (§32, §84). */
export function eligibilityReasons(o: SpellComponentOptionDto, arcanaKey: string | null): string[] {
  if (o.eligibility === null) return [];
  return [...o.eligibility.requirements.filter((r) => r.satisfied === false).map((r) => requirementText(r, arcanaKey)), ...o.eligibility.unresolved.map((u) => String((u as { message?: string }).message ?? "Unresolved requirement"))];
}

/** Strength / Weakness / explicit access relative to the chosen Affinity — a hint from authored Keyword lists (§131). */
export function alignmentOf(o: SpellComponentOptionDto, affinity: DefinitionRefDto | null): { kind: "STRENGTH" | "WEAKNESS" | "EXPLICIT" | "NONE"; text: string } | null {
  if (affinity === null) return null;
  const a = o.alignment.find((x) => x.affinity.entityVersionId === affinity.entityVersionId);
  if (!a) return { kind: "NONE", text: "No alignment with this Affinity" };
  if (a.weaknessKeys.length > 0) return { kind: "WEAKNESS", text: `Weakness match: ${a.weaknessKeys.map((k) => formatEnumLabel(k)).join(", ")} (accessible with the penalty M5 applies)` };
  if (a.strengthKeys.length > 0) return { kind: "STRENGTH", text: `Strength match: ${a.strengthKeys.map((k) => formatEnumLabel(k)).join(", ")}` };
  if (a.explicitAccess) return { kind: "EXPLICIT", text: "Explicit Affinity access" };
  return { kind: "NONE", text: "No alignment with this Affinity" };
}

export const listedMpText = (o: SpellComponentOptionDto): string => {
  const mp = o.contributions.filter((c) => c.currency === "MP");
  if (mp.length === 0) return "No listed MP";
  return mp.map((c) => (c.amount !== null ? `${c.amount} MP ${c.parameter ? `per ${formatEnumLabel(c.parameter).toLowerCase()}` : formatEnumLabel(c.kind).toLowerCase()}` : `${formatEnumLabel(c.kind)}${c.parameter ? ` (${c.parameter})` : ""}`)).join("; ");
};

function OptionSummary({ o, names, catalog, affinity }: { o: SpellComponentOptionDto; names: Record<string, string>; catalog: SpellCatalogDto; affinity: DefinitionRefDto | null }) {
  const reasons = eligibilityReasons(o, catalog.arcana.skillKey);
  const align = alignmentOf(o, affinity);
  return (
    <span className="prowess-spell-option__summary">
      <strong>{refName(names, o.ref)}</strong>
      <span className="gov-muted">
        {" "}
        {[o.category, o.subcategory].filter(Boolean).map((x) => formatEnumLabel(String(x))).join(" · ")}
        {o.availability === "DEFERRED" ? " · Deferred (not offered as usable)" : ""}
      </span>
      <br />
      <span className="gov-muted">Listed: {listedMpText(o)}</span>
      {o.keywords.length > 0 ? <span className="gov-muted"> · Keywords: {o.keywords.map(keywordLabel).join(", ")}</span> : null}
      {o.compatibility.length > 0 ? (
        <span className="gov-muted">
          {" "}
          · {o.compatibility.map((c) => `${formatEnumLabel(c.relation)}: ${c.allow.map((x) => formatEnumLabel(x)).join(", ")}`).join("; ")}
        </span>
      ) : null}
      {o.durationsAllowed.length > 0 ? <span className="gov-muted"> · Durations: {o.durationsAllowed.map((x) => formatEnumLabel(x)).join(", ")}</span> : null}
      {o.traitScope ? <span className="gov-muted"> · Scope: {formatEnumLabel(o.traitScope)}</span> : null}
      {o.description ? (
        <>
          <br />
          <span>{o.description}</span>
        </>
      ) : null}
      {o.eligibility ? (
        <>
          <br />
          <span className="gov-tag" data-testid="spell-option-eligibility" data-status={o.eligibility.status}>
            {o.eligibility.status === "ELIGIBLE" ? "Eligible" : o.eligibility.status === "INELIGIBLE" ? "Locked" : "Unresolved"}
          </span>
          {reasons.length > 0 ? <span data-testid="spell-option-reason"> {reasons.join("; ")}</span> : null}
        </>
      ) : null}
      {align ? (
        <>
          <br />
          <span className="gov-tag" data-testid="spell-option-alignment" data-alignment={align.kind}>
            {align.text}
          </span>
        </>
      ) : null}
    </span>
  );
}

/**
 * A searchable selector over one catalog (§85): search, category, Keyword, eligible-only and (for Effects) Targeting
 * compatibility filters. Single-choice selectors are radio groups; multi-choice ones add with a button. Locked and
 * deferred options are shown with their reason; deferred ones cannot be chosen.
 */
export function ComponentPicker({
  title,
  options,
  names,
  catalog,
  affinity,
  selectedVersionIds,
  onPick,
  mode,
  compatibleWith,
  disabledReason,
  testId,
}: {
  title: string;
  options: readonly SpellComponentOptionDto[];
  names: Record<string, string>;
  catalog: SpellCatalogDto;
  affinity: DefinitionRefDto | null;
  selectedVersionIds: readonly string[];
  onPick: (o: SpellComponentOptionDto) => void;
  mode: "single" | "add";
  compatibleWith?: string | null;
  disabledReason?: string | null;
  testId: string;
}) {
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [keyword, setKeyword] = useState("");
  const [eligibleOnly, setEligibleOnly] = useState(false);
  const [compatibleOnly, setCompatibleOnly] = useState(false);
  const base = useId();
  const categories = [...new Set(options.map((o) => o.category).filter((c): c is string => c !== null))].sort();
  const keywords = [...new Set(options.flatMap((o) => o.keywords))].sort();
  const q = search.trim().toLowerCase();
  const shown = options.filter(
    (o) =>
      (q === "" || refName(names, o.ref).toLowerCase().includes(q) || o.keywords.some((k) => k.includes(q)) || (o.category ?? "").toLowerCase().includes(q)) &&
      (category === "" || o.category === category) &&
      (keyword === "" || o.keywords.includes(keyword)) &&
      (!eligibleOnly || o.eligibility === null || o.eligibility.status === "ELIGIBLE") &&
      (!compatibleOnly || !compatibleWith || o.compatibility.every((c) => c.relation !== "TARGETING" || c.allow.includes(compatibleWith))),
  );
  return (
    <section className="prowess-spell-picker" aria-labelledby={`${base}-title`} data-testid={testId}>
      <h3 id={`${base}-title`}>{title}</h3>
      <div className="prowess-spell-picker__filters">
        <label className="gov-field">
          <span>Search</span>
          <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} data-testid={`${testId}-search`} />
        </label>
        {categories.length > 1 ? (
          <label className="gov-field">
            <span>Category</span>
            <select value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="">All</option>
              {categories.map((c) => (
                <option key={c} value={c}>
                  {formatEnumLabel(c)}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {keywords.length > 0 ? (
          <label className="gov-field">
            <span>Keyword</span>
            <select value={keyword} onChange={(e) => setKeyword(e.target.value)}>
              <option value="">All</option>
              {keywords.map((k) => (
                <option key={k} value={k}>
                  {keywordLabel(k)}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <label>
          <input type="checkbox" checked={eligibleOnly} onChange={(e) => setEligibleOnly(e.target.checked)} /> Eligible only
        </label>
        {compatibleWith ? (
          <label>
            <input type="checkbox" checked={compatibleOnly} onChange={(e) => setCompatibleOnly(e.target.checked)} /> Compatible with {formatEnumLabel(compatibleWith)} Targeting
          </label>
        ) : null}
      </div>
      {disabledReason ? (
        <p className="gov-muted" role="note" data-testid={`${testId}-disabled`}>
          {disabledReason}
        </p>
      ) : null}
      <ul className="prowess-spell-picker__options" role={mode === "single" ? "radiogroup" : undefined} aria-label={title}>
        {shown.map((o) => {
          const chosen = selectedVersionIds.includes(o.ref.entityVersionId);
          const deferred = o.availability === "DEFERRED";
          return (
            <li key={o.ref.entityVersionId} className="prowess-spell-option" data-testid="spell-option" data-key={o.ref.canonicalKey} data-chosen={chosen ? "true" : "false"}>
              {mode === "single" ? (
                <label>
                  <input type="radio" name={`${base}-choice`} checked={chosen} disabled={deferred} onChange={() => onPick(o)} aria-describedby={`${base}-${o.ref.entityVersionId}`} />{" "}
                  <span id={`${base}-${o.ref.entityVersionId}`}>
                    <OptionSummary o={o} names={names} catalog={catalog} affinity={affinity} />
                  </span>
                </label>
              ) : (
                <div>
                  <OptionSummary o={o} names={names} catalog={catalog} affinity={affinity} />{" "}
                  <button type="button" className="gov-button" disabled={deferred || Boolean(disabledReason)} onClick={() => onPick(o)} aria-label={`Add ${refName(names, o.ref)}`} data-testid="spell-option-add">
                    Add
                  </button>
                </div>
              )}
            </li>
          );
        })}
        {shown.length === 0 ? <li className="gov-muted">No component matches these filters.</li> : null}
      </ul>
    </section>
  );
}
