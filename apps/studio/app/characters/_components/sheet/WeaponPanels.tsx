"use client";

import { formatEnumLabel } from "@prowess/ui";
import { useContext, useState } from "react";
import { CharacterApiError, getWeapons, updateWeaponLoadout, type CharacterAttackDto, type CharacterSheetDto, type CharacterWeaponsDto, type EquippedSummaryDto, type WeaponLoadoutInputDto } from "../../_lib/character-client";
import { accuracyText, damageListText, movePropertiesText, propertyText, rangeText, resolutionText } from "../../_lib/weapon-format";
import { SheetModeContext } from "./SheetPanels";

/**
 * Weapon integration of the Field Manual sheet (PAS-10 M6-WO6 §86–§88, §143, §182). The loadout controls send ONLY the
 * loadout choice (exact Weapon pairs and the Versatile grip); the Weapon list comes from the Character's exact Release
 * via the server (no Weapon catalog lives here). Attack rows show the server's previews compactly — the large Actions
 * panel stays free for Spells, Maneuvers and future combat actions.
 */

const HAND_LABEL: Record<string, string> = { UNARMED: "Unarmed", MAIN_HAND: "Main-hand", OFF_HAND: "Off-hand" };

function weaponName(sheet: { names: Record<string, string> }, ref: { entityVersionId: string; canonicalKey: string }) {
  return sheet.names[ref.entityVersionId] ?? ref.canonicalKey;
}

function EquippedSlot({ sheet, label, equipped, testId }: { sheet: CharacterSheetDto; label: string; equipped: EquippedSummaryDto | null; testId: string }) {
  return (
    <div>
      <dt>{label}</dt>
      {equipped === null ? (
        <dd className="sheet-empty" data-testid={testId}>
          None
        </dd>
      ) : (
        <dd data-testid={testId} data-weapon={equipped.weapon.entityVersionId}>
          <strong>{weaponName(sheet, equipped.weapon)}</strong>{" "}
          <span className="sheet-muted">
            {[equipped.category === null ? null : formatEnumLabel(equipped.category), equipped.grip === "TWO_HANDED" ? "Two-handed grip" : "One-handed grip", equipped.scalingModel === "STATIC" ? "Static damage" : equipped.power === null ? formatEnumLabel(equipped.scalingModel) : `Power ${equipped.power}`].filter((x) => x !== null).join(" · ")}
          </span>
          {equipped.properties.length > 0 ? <span className="sheet-weapon__props"> — {equipped.properties.map(propertyText).join(", ")}</span> : null}
        </dd>
      )}
    </div>
  );
}

/** Choose the Main-hand / Off-hand Weapons and the Versatile grip; the server validates against the exact Release. */
function LoadoutEditor({ sheet, onSaved }: { sheet: CharacterSheetDto; onSaved: () => void }) {
  const [data, setData] = useState<CharacterWeaponsDto | null>(null);
  const [draft, setDraft] = useState<WeaponLoadoutInputDto | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const open = async () => {
    setMessage(null);
    try {
      const w = await getWeapons(sheet.identity.id);
      setData(w);
      const pair = (e: EquippedSummaryDto | null) => (e === null ? null : { entityId: e.weapon.entityId, entityVersionId: e.weapon.entityVersionId });
      setDraft({ mainHand: pair(w.loadout.mainHand), mainHandGrip: w.loadout.mainHand?.handedness === "VERSATILE" ? w.loadout.mainHand.grip : null, offHand: pair(w.loadout.offHand) });
    } catch (e) {
      setMessage(e instanceof CharacterApiError ? `${e.message} (${e.code})` : "Could not load the Weapons.");
    }
  };
  if (data === null || draft === null) {
    return (
      <div className="sheet-digital-only">
        <button type="button" className="sheet-button" onClick={() => void open()} data-testid="sheet-loadout-edit">
          Change Weapons
        </button>
        {message !== null ? (
          <p className="sheet-error" role="alert">
            {message}
          </p>
        ) : null}
      </div>
    );
  }
  const option = (id: { entityVersionId: string } | null) => (id === null ? null : (data.options.find((o) => o.weapon.entityVersionId === id.entityVersionId) ?? null));
  const main = option(draft.mainHand);
  const select = (value: string) => {
    const o = data.options.find((x) => x.weapon.entityVersionId === value);
    return o === undefined ? null : { entityId: o.weapon.entityId, entityVersionId: o.weapon.entityVersionId };
  };
  const label = (o: CharacterWeaponsDto["options"][number]) => `${data.names[o.weapon.entityVersionId] ?? o.weapon.canonicalKey}${o.equippable ? "" : ` — ${o.reasons.join("; ")}`}`;
  const held = data.options.filter((o) => o.profileKind !== "UNARMED");
  const save = async () => {
    setBusy(true);
    setMessage(null);
    try {
      await updateWeaponLoadout(sheet.identity.id, data.loadout.version, draft);
      setData(null);
      setDraft(null);
      onSaved();
    } catch (e) {
      setMessage(e instanceof CharacterApiError ? (e.code === "CHARACTER.STALE_WRITE" ? "The loadout changed elsewhere — reopen to see the latest." : e.message) : "Could not save the loadout.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <form
      className="sheet-loadout sheet-digital-only"
      data-testid="sheet-loadout-form"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <label>
        <span>Main-hand</span>
        <select data-testid="sheet-loadout-main" value={draft.mainHand?.entityVersionId ?? ""} onChange={(e) => setDraft({ ...draft, mainHand: select(e.target.value), mainHandGrip: option(select(e.target.value))?.handedness === "VERSATILE" ? "ONE_HANDED" : null })}>
          <option value="">None</option>
          {held.map((o) => (
            <option key={o.weapon.entityVersionId} value={o.weapon.entityVersionId} disabled={!o.equippable}>
              {label(o)}
            </option>
          ))}
        </select>
      </label>
      {main?.handedness === "VERSATILE" ? (
        <label>
          <span>Grip</span>
          <select data-testid="sheet-loadout-grip" value={draft.mainHandGrip ?? ""} onChange={(e) => setDraft({ ...draft, mainHandGrip: e.target.value === "TWO_HANDED" ? "TWO_HANDED" : "ONE_HANDED" })}>
            <option value="ONE_HANDED">One-handed</option>
            <option value="TWO_HANDED">Two-handed</option>
          </select>
        </label>
      ) : null}
      <label>
        <span>Off-hand</span>
        <select data-testid="sheet-loadout-off" value={draft.offHand?.entityVersionId ?? ""} onChange={(e) => setDraft({ ...draft, offHand: select(e.target.value) })}>
          <option value="">None</option>
          {held
            .filter((o) => o.handedness !== "TWO_HANDED")
            .map((o) => (
              <option key={o.weapon.entityVersionId} value={o.weapon.entityVersionId} disabled={!o.equippable}>
                {label(o)}
              </option>
            ))}
        </select>
      </label>
      <p className="sheet-actions">
        <button type="submit" className="sheet-button" disabled={busy} data-testid="sheet-loadout-save">
          {busy ? "Saving…" : "Save Weapons"}
        </button>
        <button
          type="button"
          className="sheet-link"
          onClick={() => {
            setData(null);
            setDraft(null);
          }}
        >
          Cancel
        </button>
      </p>
      {message !== null ? (
        <p className="sheet-error" role="alert" data-testid="sheet-loadout-error">
          {message}
        </p>
      ) : null}
    </form>
  );
}

/** Main-hand / Off-hand Weapons (the WO5 Equipment & Gear slots, now filled). Armor and Accessories stay later work. */
export function WeaponSlots({ sheet, onLoadoutSaved }: { sheet: CharacterSheetDto; onLoadoutSaved?: () => void }) {
  const mode = useContext(SheetModeContext);
  const e = sheet.equipment;
  return (
    <>
      <EquippedSlot sheet={sheet} label="Main-hand" equipped={e.mainHand} testId="sheet-main-hand" />
      <EquippedSlot sheet={sheet} label="Off-hand" equipped={e.mainHand?.grip === "TWO_HANDED" ? null : e.offHand} testId="sheet-off-hand" />
      {e.loadoutStatus !== "VALID" ? (
        <div>
          <dt>Loadout</dt>
          <dd className="sheet-error" data-testid="sheet-loadout-issues">
            {e.loadoutIssues.map((i) => i.message).join(" ")}
          </dd>
        </div>
      ) : null}
      {mode === "digital" && e.available && onLoadoutSaved !== undefined ? (
        <div className="sheet-loadout__controls">
          <LoadoutEditor sheet={sheet} onSaved={onLoadoutSaved} />
        </div>
      ) : null}
    </>
  );
}

function AttackRow({ sheet, a, mode }: { sheet: CharacterSheetDto; a: CharacterAttackDto; mode: string }) {
  const acc = accuracyText(a);
  return (
    <tr data-testid="sheet-attack-row" data-move={a.moveKey} data-hand={a.hand}>
      <th scope="row">
        <span className="sheet-attack__move">{sheet.names[a.attack.entityVersionId] ?? formatEnumLabel(a.moveKey)}</span>
        {a.hand !== "UNARMED" ? null : <span className="sheet-muted"> (Unarmed)</span>}
        {mode === "digital" ? (
          <>
            {" "}
            ·{" "}
            <a href={`/characters/${encodeURIComponent(sheet.identity.id)}/cards?attack=${encodeURIComponent(a.attackKey)}&hand=${encodeURIComponent(a.hand)}`} data-testid="sheet-attack-card">
              Card
            </a>
          </>
        ) : null}
      </th>
      <td data-testid="sheet-attack-ap">
        {a.apCost}
        {a.mpCost > 0 ? ` + ${a.mpCost} MP` : ""}
      </td>
      <td data-testid="sheet-attack-damage">{damageListText(a)}</td>
      <td data-testid="sheet-attack-range" title={resolutionText(a)}>
        {rangeText(a)}
      </td>
      <td data-testid="sheet-attack-properties">
        {movePropertiesText(a)}
        {acc !== null ? `${a.moveProperties.length === 0 ? "" : ", "}${acc}` : ""}
      </td>
    </tr>
  );
}

/** Compact Weapon Attack rows for the Actions panel (Move · AP · Damage · Range · Properties). */
export function WeaponAttackRows({ sheet, printRows }: { sheet: CharacterSheetDto; printRows: number }) {
  const mode = useContext(SheetModeContext);
  const rows = mode === "print" ? sheet.weaponAttacks.slice(0, printRows) : sheet.weaponAttacks;
  if (rows.length === 0) return null;
  const hands = [...new Set(rows.map((a) => a.hand))];
  return (
    <div className="sheet-attacks" data-testid="sheet-weapon-attacks">
      {hands.map((hand) => {
        const group = rows.filter((a) => a.hand === hand);
        const first = group[0] as CharacterAttackDto;
        return (
          <table key={hand} className="sheet-table sheet-table--attacks" data-testid={`sheet-attacks-${hand.toLowerCase()}`}>
            <caption>
              {HAND_LABEL[hand] ?? hand}: {weaponName(sheet, first.weapon)}
            </caption>
            <thead>
              <tr>
                <th scope="col">Move</th>
                <th scope="col">AP</th>
                <th scope="col">Damage</th>
                <th scope="col">Range</th>
                <th scope="col">Properties</th>
              </tr>
            </thead>
            <tbody>
              {group.map((a) => (
                <AttackRow key={a.attackKey} sheet={sheet} a={a} mode={mode} />
              ))}
            </tbody>
          </table>
        );
      })}
      {mode === "print" && sheet.weaponAttacks.length > rows.length ? <p className="sheet-muted">More Weapon Attacks are listed in the digital sheet.</p> : null}
      {mode === "digital" && sheet.dualWield.available ? <p className="sheet-muted" data-testid="sheet-dual-wield">Dual Wielding available: one Move from each hand for the higher AP of the two.</p> : null}
    </div>
  );
}
