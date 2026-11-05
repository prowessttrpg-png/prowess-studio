"use client";
import { formatEnumLabel } from "@prowess/ui";
import { useId } from "react";
import type { SpellParameterDto, SpellParametersDto } from "../../_lib/character-client";

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
