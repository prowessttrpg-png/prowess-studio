"use client";

import { formatEnumLabel } from "@prowess/ui";
import { useContext } from "react";
import type { CharacterSheetDto, SheetSignatureSpellDto } from "../../_lib/character-client";
import { SheetModeContext } from "./SheetPanels";

/**
 * Signature Spells in the Actions panel (PAS-10 M6-WO7 §94–§95, §134): one compact line per active Spell's CURRENT
 * revision — "Ember Bolt · 2 AP · 11 MP · Single Target · 45 ft · Damage". Every value is the server's M5 evaluation;
 * nothing is cast, spent or rolled. Print shows the compact list only (never full chains).
 */
const PRINT_SPELL_ROWS = 4;

const spellRange = (s: SheetSignatureSpellDto): string => (s.range === null ? "" : s.range.value !== null ? `${s.range.value} ${s.range.unit ?? ""}`.trim() : (s.range.ruleText ?? formatEnumLabel(s.range.model)));

export function SignatureSpellRows({ sheet }: { sheet: CharacterSheetDto }) {
  const mode = useContext(SheetModeContext);
  const rows = mode === "print" ? sheet.signatureSpells.slice(0, PRINT_SPELL_ROWS) : sheet.signatureSpells;
  if (rows.length === 0) return null;
  const id = encodeURIComponent(sheet.identity.id);
  return (
    <div className="sheet-attacks" data-testid="sheet-signature-spells">
      <table className="sheet-table sheet-table--attacks">
        <caption>Signature Spells</caption>
        <thead>
          <tr>
            <th scope="col">Spell</th>
            <th scope="col">AP · MP</th>
            <th scope="col">Targeting</th>
            <th scope="col">Effects</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((s) => (
            <tr key={s.id} data-testid="sheet-spell-row" data-state={s.state}>
              <th scope="row">
                {mode === "digital" ? <a href={`/characters/${id}/spells/${encodeURIComponent(s.id)}`}>{s.name}</a> : s.name}
                {s.deferred.length > 0 ? <span className="sheet-muted" data-testid="sheet-spell-deferred"> (runtime deferred: {s.deferred.map((d) => d.conflictKey).join(", ")})</span> : null}
              </th>
              <td data-testid="sheet-spell-cost">{s.finalAp !== null && s.finalMp !== null ? `${s.finalAp} AP · ${s.finalMp} MP` : "Cost unresolved"}</td>
              <td data-testid="sheet-spell-targeting">
                {s.targeting ? (sheet.names[s.targeting.entityVersionId] ?? s.targeting.canonicalKey) : "—"}
                {spellRange(s) ? ` · ${spellRange(s)}` : ""}
              </td>
              <td>{s.effectFamilies.map((f) => formatEnumLabel(f)).join(", ") || "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {mode === "print" && sheet.signatureSpells.length > rows.length ? <p className="sheet-muted">More Signature Spells are listed in the digital sheet.</p> : null}
    </div>
  );
}
