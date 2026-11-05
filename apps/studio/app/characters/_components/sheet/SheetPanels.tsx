"use client";

import { formatEnumLabel } from "@prowess/ui";
import { createContext, useContext, useId, useState, type ReactNode } from "react";
import type { CharacterSheetDto, PossessionDto, SheetResourceDto, SheetValueDto } from "../../_lib/character-client";
import { RuleLink } from "../CharacterReview";
import { WeaponAttackRows, WeaponSlots } from "./WeaponPanels";
import { SignatureSpellRows } from "./SpellRows";
import { SignatureManeuverRows } from "./ManeuverRows";
import { BoltIcon, DiamondIcon, DropIcon, EffectsIcon, EquipmentFigure, GearIcon, PlusIcon, QuillIcon, RingIcon, SatchelIcon, ShieldIcon, SkillsIcon, StatsIcon, SwordsIcon, TriadIcon, WeightIcon } from "./SheetIcons";

/**
 * The Field Manual sheet's sections (PAS-10 M6-WO5 §16–§64). Every number is the server's CharacterSheetView value —
 * these components only FORMAT (a "+" sign, a unit) and never compute a rule. Values the Release does not define show
 * "—" with the server's reason. In `print` mode there are no controls, links or inputs.
 */
export type SheetMode = "digital" | "print";
/** The sheet's presentation mode for nested sections (print has no controls). */
export const SheetModeContext = createContext<SheetMode>("digital");

/** A navy section banner with a replaceable icon. `collapsible` sections fold on narrow screens (§74). */
export function SheetSection({ id, title, icon, children, collapsible = false, className = "", testId }: { id: string; title: string; icon: ReactNode; children: ReactNode; collapsible?: boolean; className?: string; testId?: string }) {
  const [collapsed, setCollapsed] = useState(false);
  const mode = useContext(SheetModeContext);
  const headingId = `sheet-${id}-heading`;
  return (
    <section className={`sheet-section sheet-section--${id} ${className}`} aria-labelledby={headingId} data-testid={testId ?? `sheet-${id}`}>
      <div className="sheet-section__banner">
        <h2 className="sheet-section__heading" id={headingId}>
          <span className="sheet-section__icon">{icon}</span>
          <span className="sheet-section__title">{title}</span>
        </h2>
        {collapsible && mode === "digital" ? (
          <button type="button" className="sheet-section__toggle" aria-expanded={!collapsed} aria-controls={`sheet-${id}-body`} onClick={() => setCollapsed(!collapsed)}>
            <span className="sheet-sr">{collapsed ? `Show ${title}` : `Hide ${title}`}</span>
            <span aria-hidden="true">{collapsed ? "▸" : "▾"}</span>
          </button>
        ) : null}
      </div>
      <div className={`sheet-section__body${collapsed ? " is-collapsed" : ""}`} id={`sheet-${id}-body`}>
        {children}
      </div>
    </section>
  );
}

const signed = (n: number) => (n >= 0 ? `+${n}` : String(n));
/** Formats a server value; unavailable values render "—" with the server's reason for screen readers and a tooltip. */
export function Value({ v, sign = false, testId }: { v: SheetValueDto; sign?: boolean; testId?: string }) {
  if (v.value === null) {
    return (
      <span className="sheet-value sheet-value--unavailable" title={v.unavailable ?? undefined} data-testid={testId}>
        <span aria-hidden="true">—</span>
        <span className="sheet-sr">Unavailable: {v.unavailable}</span>
      </span>
    );
  }
  return (
    <span className="sheet-value" data-testid={testId}>
      {sign ? signed(v.value) : v.value}
      {v.unit ? ` ${v.unit}` : ""}
    </span>
  );
}

const refLink = (sheet: CharacterSheetDto, mode: SheetMode, ref: { entityId: string; entityVersionId: string; canonicalKey: string; definitionKind: string; systemFamily: string } | null, fallback = "—") => {
  if (ref === null) return fallback;
  const label = sheet.names[ref.entityVersionId] ?? ref.canonicalKey;
  return mode === "print" ? label : <RuleLink release={sheet.release} refDto={ref} label={label} />;
};

// ---- Page 1 --------------------------------------------------------------------------------------------------------

export function PersonnelHeader({ sheet, mode, companyPac, onCompanyPac }: { sheet: CharacterSheetDto; mode: SheetMode; companyPac: string; onCompanyPac: (value: string) => void }) {
  const id = sheet.identity;
  return (
    <div className="sheet-personnel" data-testid="sheet-personnel">
      <h1 className="sheet-personnel__title">
        <span aria-hidden="true">✦</span> Character Personnel File <span aria-hidden="true">✦</span>
      </h1>
      <span className="sheet-stamp" aria-label="Status: Active">
        Active
      </span>
      <dl className="sheet-personnel__fields">
        <div className="sheet-personnel__name">
          <dt>Name</dt>
          <dd data-testid="sheet-name">{id.name}</dd>
        </div>
        <div>
          <dt>Level</dt>
          <dd data-testid="sheet-level">{id.level}</dd>
        </div>
        <div>
          <dt>Species</dt>
          <dd data-testid="sheet-species">{refLink(sheet, mode, id.ancestry)}</dd>
        </div>
        <div className="sheet-personnel__company">
          <dt>
            <label htmlFor="sheet-company-pac">Company / PAC</label>
          </dt>
          <dd>
            {mode === "print" ? (
              <span data-testid="sheet-company">{companyPac || "—"}</span>
            ) : (
              <input id="sheet-company-pac" className="sheet-line-input" value={companyPac} maxLength={sheet.notes.limits.companyPac} onChange={(e) => onCompanyPac(e.target.value)} placeholder="Descriptive only" />
            )}
          </dd>
        </div>
        <div>
          <dt>Affinity</dt>
          <dd data-testid="sheet-primary-affinity">{refLink(sheet, mode, id.primaryAffinity)}</dd>
        </div>
      </dl>
    </div>
  );
}

export function StatsPanel({ sheet }: { sheet: CharacterSheetDto }) {
  return (
    <SheetSection id="stats" title="Stats" icon={<StatsIcon />}>
      <table className="sheet-table sheet-table--stats">
        <caption className="sheet-sr">Stat totals and Saving Throw modifiers</caption>
        <thead>
          <tr>
            <th scope="col">Stat</th>
            <th scope="col">Total</th>
            <th scope="col">Save</th>
          </tr>
        </thead>
        <tbody>
          {sheet.mechanics.stats.map((s) => (
            <tr key={s.stat}>
              <th scope="row">{s.stat}</th>
              <td data-testid={`sheet-stat-${s.stat}`}>{s.total}</td>
              <td>
                <Value v={s.savingThrow} sign testId={`sheet-save-${s.stat}`} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </SheetSection>
  );
}

export function CoreValuesPanel({ sheet }: { sheet: CharacterSheetDto }) {
  const c = sheet.mechanics.combat;
  const rows: Array<[string, string, ReactNode]> = [
    ["die", "Character Die", <span key="die" className="sheet-value">d{c.characterDie.faces}</span>],
    ["dodge", "Dodge", <Value key="dodge" v={c.dodge} />],
    ["dc", "Character DC", <Value key="dc" v={c.characterDc} />],
    ["initiative", "Initiative", <Value key="initiative" v={c.initiative} sign />],
    ["accuracy", "Accuracy", <Value key="accuracy" v={c.accuracy} sign />],
    ["movement", "Movement", <Value key="movement" v={c.movement} />],
    ["armor", "Armor", <Value key="armor" v={c.armor} />],
    ["range", "Sight (Range)", <Value key="range" v={c.range} />],
  ];
  return (
    <SheetSection id="core" title="Core Values & Combat" icon={<ShieldIcon />}>
      <dl className="sheet-core">
        {rows.map(([key, label, value]) => (
          <div key={key} className="sheet-core__row" data-testid={`sheet-core-${key}`}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
        <div className="sheet-core__row sheet-core__row--wide" data-testid="sheet-core-concentration">
          <dt>Concentration</dt>
          <dd>
            <span className="sheet-sr">Current / Max: </span>
            <Value v={{ value: null, unit: null, unavailable: c.concentration.maximum.unavailable, source: null }} /> / <Value v={c.concentration.maximum} />
          </dd>
        </div>
      </dl>
    </SheetSection>
  );
}

/** Presentation labels and order for the Release's resource keys (unknown keys still render, after these). */
const RESOURCE_LABELS: Record<string, string> = { HP: "HP (Health)", MP: "MP (Mana)", ME: "ME (Mana Efficiency)", AP: "AP (Action Points)", COUNTER_ACTION: "Counter Actions" };
const RESOURCE_ORDER = Object.keys(RESOURCE_LABELS);
export const resourceLabel = (key: string) => RESOURCE_LABELS[key] ?? formatEnumLabel(key);
export const orderedResources = (resources: readonly SheetResourceDto[]) => [...resources].sort((a, b) => (RESOURCE_ORDER.indexOf(a.resourceKey) === -1 ? 99 : RESOURCE_ORDER.indexOf(a.resourceKey)) - (RESOURCE_ORDER.indexOf(b.resourceKey) === -1 ? 99 : RESOURCE_ORDER.indexOf(b.resourceKey)));

function ResourceControl({ r, mode, busy, onSet }: { r: SheetResourceDto; mode: SheetMode; busy: boolean; onSet: (value: number) => void }) {
  const label = resourceLabel(r.resourceKey);
  const [draft, setDraft] = useState<string | null>(null);
  const current = r.current;
  const commit = () => {
    if (draft === null) return;
    const n = Number(draft);
    setDraft(null);
    if (draft.trim() !== "" && Number.isInteger(n) && n !== current) onSet(n);
  };
  return (
    <div className="sheet-resource" data-testid={`sheet-resource-${r.resourceKey}`}>
      <div className="sheet-resource__label">{label}</div>
      <div className="sheet-resource__value">
        {mode === "print" ? (
          <span>{current ?? "—"}</span>
        ) : (
          <>
            <button type="button" className="sheet-step" aria-label={`Decrease ${label}`} disabled={busy || current === null || current <= r.minimum} onClick={() => current !== null && onSet(current - 1)}>
              −
            </button>
            <input
              className="sheet-resource__input"
              inputMode="numeric"
              aria-label={`Current ${label}`}
              value={draft ?? (current === null ? "" : String(current))}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commit}
              onKeyDown={(e) => {
                if (e.key === "Enter") commit();
                if (e.key === "Escape") setDraft(null);
              }}
            />
            <button type="button" className="sheet-step" aria-label={`Increase ${label}`} disabled={busy || current === null || r.maximum === null || current >= r.maximum} onClick={() => current !== null && onSet(current + 1)}>
              +
            </button>
          </>
        )}
        <span className="sheet-resource__max" aria-label={`Maximum ${label}`} data-testid={`sheet-resource-max-${r.resourceKey}`}>
          <span aria-hidden="true">/ </span>
          {r.maximum ?? "—"}
        </span>
      </div>
      {mode === "digital" && r.maximum !== null && current !== r.maximum ? (
        <button type="button" className="sheet-link" disabled={busy} onClick={() => onSet(r.maximum as number)}>
          Reset to max
        </button>
      ) : null}
    </div>
  );
}

export function ResourcesPanel({ sheet, mode, busy, message, onSet }: { sheet: CharacterSheetDto; mode: SheetMode; busy: boolean; message: string | null; onSet: (key: string, value: number) => void }) {
  return (
    <SheetSection id="resources" title="Resources" icon={<DropIcon />}>
      <div className="sheet-resources">
        {orderedResources(sheet.resources).map((r) => (
          <ResourceControl key={r.resourceKey} r={r} mode={mode} busy={busy} onSet={(v) => onSet(r.resourceKey, v)} />
        ))}
      </div>
      {message !== null ? (
        <p className="sheet-error" role="alert" data-testid="sheet-resource-message">
          {message}
        </p>
      ) : null}
    </SheetSection>
  );
}

export function SkillsPanel({ sheet, mode }: { sheet: CharacterSheetDto; mode: SheetMode }) {
  const name = (s: CharacterSheetDto["mechanics"]["skills"][number]) => sheet.names[s.skill.entityVersionId] ?? s.skill.canonicalKey;
  const skills = [...sheet.mechanics.skills].sort((a, b) => name(a).localeCompare(name(b)));
  const half = Math.ceil(skills.length / 2);
  const rankLabels = skills[0]?.ranks.map((r) => r.rankKey) ?? [];
  const column = (list: typeof skills, key: string) => (
    <table className="sheet-table sheet-table--skills" key={key}>
      <caption className="sheet-sr">Skills {key === "a" ? "(first column)" : "(second column)"}</caption>
      <thead>
        <tr>
          <th scope="col">Skill</th>
          <th scope="col">Score</th>
          {rankLabels.map((r) => (
            <th scope="col" key={r} title={formatEnumLabel(r)}>
              <abbr title={formatEnumLabel(r)}>{r.charAt(0)}</abbr>
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {list.map((s) => (
          <tr key={s.skill.entityId} data-testid="sheet-skill" data-skill={name(s)}>
            <th scope="row">
              <DiamondIcon className="sheet-skill__icon" /> {refLink(sheet, mode, s.skill)}
            </th>
            <td data-testid="sheet-skill-score">{s.score === null ? "—" : signed(s.score)}</td>
            {s.ranks.map((r) => (
              <td key={r.rankKey}>
                <span className={`sheet-box${r.held ? " is-held" : ""}`} role="img" aria-label={`${formatEnumLabel(r.rankKey)}: ${r.held ? "yes" : "no"}`} data-testid={`sheet-skill-rank-${r.rankKey}`} data-held={r.held}>
                  {r.held ? "✓" : ""}
                </span>
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
  return (
    <SheetSection id="skills" title="Skills" icon={<SkillsIcon />}>
      {skills.length === 0 ? (
        <p className="sheet-empty">This Release defines no Skills.</p>
      ) : (
        <div className="sheet-skills">
          {column(skills.slice(0, half), "a")}
          {column(skills.slice(half), "b")}
        </div>
      )}
    </SheetSection>
  );
}

/** Long free text: an editable textarea digitally; ruled lines with explicit continuation in print (§76). */
export function NotesText({ label, value, mode, onChange, max, testId, empty, printLines, continuation }: { label: string; value: string; mode: SheetMode; onChange: (v: string) => void; max: number; testId: string; empty: string; printLines: number; continuation: string }) {
  const id = useId();
  if (mode === "print") {
    const lines = value.split("\n");
    const shown = lines.slice(0, printLines);
    const overflow = lines.length > printLines || value.length > printLines * 90;
    return (
      <div className="sheet-lines" data-testid={testId} data-overflow={overflow}>
        {value.trim() === "" ? <p className="sheet-empty">{empty}</p> : <p className="sheet-lines__text">{overflow ? shown.join("\n").slice(0, printLines * 90) : value}</p>}
        {overflow ? <p className="sheet-continued">{continuation}</p> : null}
      </div>
    );
  }
  return (
    <div className="sheet-notes-field">
      <label htmlFor={id} className="sheet-sr">
        {label}
      </label>
      <textarea id={id} className="sheet-lines sheet-lines__input" data-testid={testId} value={value} maxLength={max} placeholder={empty} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

/** Weapon Attack rows printed on page 1 (the digital sheet lists them all); the rest of the panel stays Action Notes. */
const PRINT_ATTACK_ROWS = 6;
/** Printed Action Note lines: the whole panel without Weapon Attacks, a short block below them otherwise. */
export const actionNoteLines = (sheet: CharacterSheetDto) => (sheet.weaponAttacks.length === 0 && sheet.signatureSpells.length === 0 && !sheet.signatureManeuvers?.length ? 14 : 4);

export function ActionsPanel({ sheet, mode, value, onChange }: { sheet: CharacterSheetDto; mode: SheetMode; value: string; onChange: (v: string) => void }) {
  // M6-WO6: compact Weapon Attack rows sit above the Action Notes; on paper they take some of the notes' lines.
  return (
    <SheetSection id="actions" title="Actions" icon={<SwordsIcon />}>
      <p className="sheet-muted sheet-digital-only">Weapon Attacks are previews from your exact Release (nothing is rolled or spent). Action Notes are your own reminders — they never create or change an action. Signature Spells and Maneuvers show their current active revisions.</p>
      <WeaponAttackRows sheet={sheet} printRows={PRINT_ATTACK_ROWS} />
      <SignatureSpellRows sheet={sheet} />
      <SignatureManeuverRows sheet={sheet} />
      <NotesText label="Action Notes" value={value} mode={mode} onChange={onChange} max={sheet.notes.limits.actionNotes} testId="sheet-action-notes" empty="No action notes yet." printLines={actionNoteLines(sheet)} continuation="Action Notes continue on the supplemental page." />
    </SheetSection>
  );
}

// ---- Page 2 --------------------------------------------------------------------------------------------------------

export function GrantedEffectsPanel({ sheet, mode }: { sheet: CharacterSheetDto; mode: SheetMode }) {
  return (
    <SheetSection id="effects" title="Granted Effects & Conditions" icon={<EffectsIcon />}>
      <table className="sheet-table sheet-table--effects">
        <caption className="sheet-sr">Effects and Conditions currently applying</caption>
        <thead>
          <tr>
            <th scope="col">Source</th>
            <th scope="col">Effect / Condition</th>
            <th scope="col">Duration</th>
            <th scope="col">Notes</th>
          </tr>
        </thead>
        <tbody>
          {sheet.grantedEffects.length === 0 ? (
            <tr>
              <td colSpan={4} className="sheet-empty" data-testid="sheet-effects-empty">
                No current granted effects.
              </td>
            </tr>
          ) : (
            sheet.grantedEffects.map((e, i) => (
              <tr key={i}>
                <td>{refLink(sheet, mode, e.source)}</td>
                <td>{e.effect}</td>
                <td>{e.duration ?? "—"}</td>
                <td>{e.notes ?? ""}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </SheetSection>
  );
}

export function AffinityPanel({ sheet, mode }: { sheet: CharacterSheetDto; mode: SheetMode }) {
  const affinities = sheet.mechanics.affinities;
  const many = affinities.length > 1;
  const owner = (a: (typeof affinities)[number]) => (many ? ` (${sheet.names[a.affinity.entityVersionId] ?? a.affinity.canonicalKey})` : "");
  const strengths = affinities.flatMap((a) => a.strengths.map((s) => ({ key: `${a.affinity.entityId}:${s.strengthKey}`, text: `${formatEnumLabel(s.strengthKey)}${owner(a)}` })));
  const weaknesses = affinities.flatMap((a) =>
    a.weaknesses.map((w) => ({ key: `${a.affinity.entityId}:${w.weaknessKey}`, text: `${formatEnumLabel(w.weaknessKey)} — +${w.activationPenaltyPercent}% activation${w.severity ? ` (${formatEnumLabel(w.severity)})` : ""}${owner(a)}` })),
  );
  return (
    <SheetSection id="affinity" title="Affinity Profile" icon={<TriadIcon />}>
      <ul className="sheet-affinities">
        {affinities.map((a) => (
          <li key={a.affinity.entityId} data-testid="sheet-affinity-row">
            <strong>{refLink(sheet, mode, a.affinity)}</strong> — {formatEnumLabel(a.role)}, {formatEnumLabel(a.rank)}
            {a.authority ? (
              <span className="sheet-muted">
                {" "}
                · Authority {a.authority.eligible === null ? "unresolved" : a.authority.eligible ? "available" : "locked"} (needs {formatEnumLabel(a.authority.minimumRank)})
              </span>
            ) : null}
          </li>
        ))}
      </ul>
      <div className="sheet-sw">
        <div>
          <h3 className="sheet-sw__head">
            <PlusIcon /> Strengths
          </h3>
          <ul className="sheet-sw__list" data-testid="sheet-strengths">
            {strengths.length === 0 ? <li className="sheet-empty">None recorded.</li> : strengths.map((s) => <li key={s.key}>{s.text}</li>)}
          </ul>
        </div>
        <div>
          <h3 className="sheet-sw__head">
            <BoltIcon /> Weaknesses
          </h3>
          <ul className="sheet-sw__list" data-testid="sheet-weaknesses">
            {weaknesses.length === 0 ? <li className="sheet-empty">None recorded.</li> : weaknesses.map((w) => <li key={w.key}>{w.text}</li>)}
          </ul>
        </div>
      </div>
    </SheetSection>
  );
}

/** M6-WO6 integration boundary: intentional empty slots until the equipment domain exists (§54–§57). */
export function EquipmentPanel({ sheet, onLoadoutSaved }: { sheet: CharacterSheetDto; onLoadoutSaved?: () => void }) {
  const slots = sheet.equipment.accessorySlots;
  return (
    <SheetSection id="equipment" title="Equipment & Gear" icon={<GearIcon />} collapsible>
      <div className="sheet-equipment" data-testid="sheet-equipment-slots" data-available={sheet.equipment.available}>
        <dl className="sheet-equipment__slots">
          {/* M6-WO6: the Main-hand / Off-hand Weapon slots; Armor stays a later equipment update. */}
          <WeaponSlots sheet={sheet} onLoadoutSaved={onLoadoutSaved} />
          <div>
            <dt>Armor</dt>
            <dd className="sheet-empty">Not equipped</dd>
          </div>
          <div>
            <dt>Accessories (Attunement)</dt>
            <dd className="sheet-empty" data-testid="sheet-accessory-slots">
              {slots === null ? "Slots follow Attunement, which this Release does not define yet." : `${slots} slot(s)`}
            </dd>
          </div>
        </dl>
        <EquipmentFigure className="sheet-equipment__figure" />
      </div>
      <p className="sheet-muted sheet-digital-only">{sheet.equipment.available ? "Weapons come from your exact Release. Armor and accessories arrive with a later equipment update." : "This Release has no Weapon Library yet. Armor and accessories arrive with a later equipment update."}</p>
    </SheetSection>
  );
}

export function AttunementPanel({ sheet }: { sheet: CharacterSheetDto }) {
  const a = sheet.mechanics.attunement;
  return (
    <SheetSection id="attunement" title="Attunement" icon={<RingIcon />} collapsible>
      <dl className="sheet-pair">
        <div>
          <dt>Max</dt>
          <dd>
            <Value v={a.maximum} testId="sheet-attunement-max" />
          </dd>
        </div>
        <div>
          <dt>Used</dt>
          <dd>
            <Value v={a.used} />
          </dd>
        </div>
      </dl>
    </SheetSection>
  );
}

export function CarryPanel({ sheet }: { sheet: CharacterSheetDto }) {
  const c = sheet.mechanics.carry;
  return (
    <SheetSection id="carry" title="Carry & Weight" icon={<WeightIcon />} collapsible>
      <dl className="sheet-pair">
        <div>
          <dt>Current Weight</dt>
          <dd>
            <Value v={c.currentWeight} testId="sheet-carry-weight" />
          </dd>
        </div>
        <div>
          <dt>Max Load</dt>
          <dd>
            <Value v={c.maximumLoad} />
          </dd>
        </div>
      </dl>
    </SheetSection>
  );
}

export function PossessionsPanel({ sheet, mode, rows, onChange, printRows }: { sheet: CharacterSheetDto; mode: SheetMode; rows: PossessionDto[]; onChange: (rows: PossessionDto[]) => void; printRows: number }) {
  const L = sheet.notes.limits;
  const set = (i: number, key: keyof PossessionDto, value: string) => onChange(rows.map((r, j) => (j === i ? { ...r, [key]: value } : r)));
  const shown = mode === "print" ? rows.slice(0, printRows) : rows;
  return (
    <SheetSection id="possessions" title="Possessions" icon={<SatchelIcon />} collapsible>
      <table className="sheet-table sheet-table--possessions">
        <caption className="sheet-sr">Possessions (descriptive only)</caption>
        <thead>
          <tr>
            <th scope="col">Category</th>
            <th scope="col">Item</th>
            <th scope="col">Wt.</th>
            {mode === "digital" ? <th scope="col"><span className="sheet-sr">Remove</span></th> : null}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={mode === "digital" ? 4 : 3} className="sheet-empty" data-testid="sheet-possessions-empty">
                No possessions recorded.
              </td>
            </tr>
          ) : (
            shown.map((r, i) =>
              mode === "print" ? (
                <tr key={i} data-testid="sheet-possession">
                  <td>{r.category}</td>
                  <td>{r.item}</td>
                  <td>{r.weight}</td>
                </tr>
              ) : (
                <tr key={i} data-testid="sheet-possession">
                  <td>
                    <input className="sheet-cell-input" aria-label={`Category of possession ${i + 1}`} value={r.category} maxLength={L.category} onChange={(e) => set(i, "category", e.target.value)} />
                  </td>
                  <td>
                    <input className="sheet-cell-input" aria-label={`Item of possession ${i + 1}`} value={r.item} maxLength={L.item} onChange={(e) => set(i, "item", e.target.value)} />
                  </td>
                  <td>
                    <input className="sheet-cell-input sheet-cell-input--narrow" aria-label={`Weight of possession ${i + 1}`} value={r.weight} maxLength={L.weight} onChange={(e) => set(i, "weight", e.target.value)} />
                  </td>
                  <td>
                    <button type="button" className="sheet-link" aria-label={`Remove possession ${i + 1}`} onClick={() => onChange(rows.filter((_, j) => j !== i))}>
                      ✕
                    </button>
                  </td>
                </tr>
              ),
            )
          )}
        </tbody>
      </table>
      {mode === "print" && rows.length > printRows ? <p className="sheet-continued">{rows.length - printRows} more possession(s) continue on the supplemental page.</p> : null}
      {mode === "digital" ? (
        <p className="sheet-actions">
          <button type="button" className="sheet-button" disabled={rows.length >= L.possessions} onClick={() => onChange([...rows, { category: "", item: "", weight: "" }])}>
            Add possession
          </button>
          <span className="sheet-muted">Descriptive only — the equipment update will track real gear and weight.</span>
        </p>
      ) : null}
    </SheetSection>
  );
}

export function CharacterNotesPanel({ sheet, mode, value, onChange }: { sheet: CharacterSheetDto; mode: SheetMode; value: string; onChange: (v: string) => void }) {
  return (
    <SheetSection id="notes" title="Character Notes" icon={<QuillIcon />}>
      <NotesText label="Character Notes" value={value} mode={mode} onChange={onChange} max={sheet.notes.limits.characterNotes} testId="sheet-character-notes" empty="No notes yet — background, contacts, mission notes, reminders." printLines={14} continuation="Character Notes continue on the supplemental page." />
    </SheetSection>
  );
}
