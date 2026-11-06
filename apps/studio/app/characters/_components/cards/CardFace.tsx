"use client";

import type { ReactNode } from "react";
import type {
  AttackSectionDto,
  CardDto,
  CardImprovementEntryDto,
  CardPropertyEntryDto,
  CardRequirementEntryDto,
  CardTraitEntryDto,
  GeneralActionSectionDto,
  InstructionBlockDto,
  ManeuverSectionDto,
  SpellSectionDto,
  WeaponSectionDto,
} from "../../_lib/card-types";
import { AVAILABILITY_LABELS, CATEGORY_LABELS, IMPROVEMENT_STATUS_LABELS, rangeText, refName, tokenText, valueShort, valueText } from "../../_lib/card-format";

/**
 * Prowess Field Manual card faces (PAS-10 M6-WO9 Phase C). Both faces are built from ONE Card Presentation Contract as
 * an ordered list of blocks, so the digital viewer (every mode) and the print renderer show exactly the same content —
 * print only paginates the blocks. Mechanical language is the server's generated instructions, verbatim; labels here are
 * presentation of vocabulary tokens. No list is truncated: every Effect, Trait, Condition, property and source is shown.
 */
export interface CardBlock {
  readonly key: string;
  readonly title: string;
  readonly body: ReactNode;
  /** Long reference blocks start collapsed in compact digital views (never in print). */
  readonly reference?: boolean;
  /**
   * Print only: the same content as separately placeable items (one list entry each), so a long list continues on the
   * next card page instead of overflowing it. Digital views always render `body`.
   */
  readonly printItems?: readonly { readonly key: string; readonly body: ReactNode }[];
}

const BLOCK_KIND_LABEL: Readonly<Record<InstructionBlockDto["kind"], string>> = { TARGETS: "Targets", DELIVERY: "Delivery", STEP: "Step", GROUP: "Resolution group", UNRESOLVED: "Unresolved", NOTE: "Note" };

/** The generated "How to Use" instructions, in the server's order, each block labelled for screen readers. */
export function Instructions({ card, limit }: { card: CardDto; limit?: number }) {
  const blocks = limit === undefined ? card.instructions.blocks : card.instructions.blocks.slice(0, limit);
  return (
    <ol className="fcard-instructions" data-testid="card-instructions" data-status={card.instructions.status}>
      {blocks.map((b) => (
        <li key={b.key} className={`fcard-instructions__block fcard-instructions__block--${b.kind.toLowerCase()}`} data-kind={b.kind} data-testid="card-instruction">
          <span className="fcard-sr">{BLOCK_KIND_LABEL[b.kind]}: </span>
          {b.text}
        </li>
      ))}
    </ol>
  );
}

function CategoryGlyph({ category }: { category: CardDto["category"] }) {
  // Simple line glyphs per category (decoration only, aria-hidden).
  const paths: Record<CardDto["category"], string> = {
    SIGNATURE_SPELL: "M32 8 L38 26 L56 32 L38 38 L32 56 L26 38 L8 32 L26 26 Z",
    SIGNATURE_MANEUVER: "M14 50 L50 14 M42 14 L50 14 L50 22 M14 14 L50 50 M14 42 L14 50 L22 50",
    WEAPON: "M32 6 L36 40 L32 46 L28 40 Z M20 44 L44 44 M32 46 L32 58",
    ATTACK: "M10 32 L46 32 M38 22 L50 32 L38 42 M10 22 L18 32 L10 42",
    GENERAL_ACTION: "M32 9 A23 23 0 1 0 32.01 9 M32 18 L32 34 L42 40",
    MAGE_ART: "M16 48 L48 16 M20 16 L48 44 M32 8 L32 56",
  };
  return (
    <svg viewBox="0 0 64 64" className="fcard-art__glyph" aria-hidden="true" focusable="false">
      <path d={paths[category]} fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** The approved no-art state (decision C3): a framed category emblem — never a portrait or an uploaded image. */
export function CardArt({ card, size }: { card: CardDto; size: "large" | "small" }) {
  return (
    <div className={`fcard-art fcard-art--${size}`} data-testid="card-art" data-art="placeholder" role="img" aria-label={`${CATEGORY_LABELS[card.category]} — no artwork`}>
      <CategoryGlyph category={card.category} />
      <span className="fcard-art__caption" aria-hidden="true">
        {CATEGORY_LABELS[card.category]}
      </span>
    </div>
  );
}

export function CardHeader({ card }: { card: CardDto }) {
  const ability = card.provenance.ability;
  return (
    <header className="fcard-header">
      <p className="fcard-header__type">
        {CATEGORY_LABELS[card.category]}
        {ability !== null ? <span> · {ability.revisionNumber === null ? "Draft" : `Revision ${ability.revisionNumber}`}</span> : null}
      </p>
      <h3 className="fcard-header__name" data-testid="card-name">
        {card.name}
      </h3>
      <p className="fcard-badge" data-testid="card-availability" data-availability={card.availability}>
        {AVAILABILITY_LABELS[card.availability]}
      </p>
    </header>
  );
}

export function CostStrip({ card }: { card: CardDto }) {
  return (
    <dl className="fcard-costs" data-testid="card-costs">
      <div>
        <dt>AP</dt>
        <dd data-testid="card-ap" title={valueText(card.costs.ap, "AP")}>
          {valueShort(card.costs.ap)}
        </dd>
      </div>
      <div>
        <dt>MP</dt>
        <dd data-testid="card-mp" title={valueText(card.costs.mp, "MP")}>
          {valueShort(card.costs.mp)}
        </dd>
      </div>
    </dl>
  );
}

const resolutionOf = (card: CardDto): string => {
  const s = card.section;
  if (s.kind === "ATTACK") return tokenText(String(s.resolution.mode ?? "—"));
  if (card.rules.status !== "AVAILABLE") return card.rules.status === "DEFERRED" ? `Deferred — ${card.rules.reason}` : "—";
  const kind = card.rules.value.kind;
  return kind === "SPELL_CHAIN" ? "Effect Chain, per target" : kind === "MANEUVER_GROUPS" ? "Independent Action groups" : kind === "GENERAL_ACTION" ? "Action" : tokenText(kind);
};

/** Targeting, range, resolution, duration and essential conditions (front facts). */
function FrontFacts({ card, names }: { card: CardDto; names: Record<string, string> }) {
  const s = card.section;
  const rows: [string, string][] = [];
  if (card.targeting.status === "AVAILABLE") {
    const t = card.targeting.value;
    rows.push(["Targeting", `${t.targeting === null ? tokenText(t.targetCount.kind) : refName(names, t.targeting)}${t.targetCount.count === null ? "" : ` · ${t.targetCount.count}`}`]);
    rows.push(["Range", rangeText(card)]);
  } else if (s.kind !== "WEAPON" && s.kind !== "GENERAL_ACTION" && s.kind !== "MAGE_ART") rows.push(["Targeting", card.targeting.status === "DEFERRED" ? `Deferred — ${card.targeting.reason}` : card.targeting.reason]);
  if (s.kind !== "WEAPON" && s.kind !== "MAGE_ART") rows.push(["Resolution", resolutionOf(card)]);
  if (s.kind === "SIGNATURE_SPELL") {
    rows.push(["Duration", refName(names, s.duration)]);
    if (s.castingConditions.length > 0) rows.push(["Casting Conditions", s.castingConditions.map((c) => refName(names, c)).join(", ")]);
  }
  if (s.kind === "SIGNATURE_MANEUVER") {
    rows.push(["Duration", refName(names, s.duration)]);
    if (s.conditions.length > 0) rows.push(["Conditions", s.conditions.map((c) => refName(names, c)).join(", ")]);
  }
  if (s.kind === "GENERAL_ACTION") rows.push(["Timing", `${tokenText(s.timing)}${s.requiresTrigger ? " · requires a trigger" : ""}`]);
  if (s.kind === "WEAPON") rows.push(["Held", `${tokenText(s.equipped.hand)} · ${tokenText(s.equipped.grip)}`]);
  if (s.kind === "ATTACK") rows.push(["Held", `${tokenText(s.equipped.hand)} · ${tokenText(s.equipped.grip)} · ${refName(names, s.weapon)}`]);
  return (
    <dl className="fcard-facts" data-testid="card-facts">
      {rows.map(([k, v]) => (
        <div key={k}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

/** The primary Effect summary: the first resolving instruction block, verbatim (STEP or GROUP), else the first block. */
export function primarySummary(card: CardDto): InstructionBlockDto | null {
  return card.instructions.blocks.find((b) => b.kind === "STEP" || b.kind === "GROUP") ?? card.instructions.blocks[0] ?? null;
}

/** Front blocks. `compact` keeps the full instructions inspectable through a disclosure (illustrated cards). */
export function frontBlocks(card: CardDto, names: Record<string, string>, opts: { compact: boolean }): CardBlock[] {
  const summary = primarySummary(card);
  const blocks: CardBlock[] = [{ key: "facts", title: "At a glance", body: <FrontFacts card={card} names={names} /> }];
  if (card.section.kind === "MAGE_ART") {
    blocks.push({ key: "domain", title: "Status", body: <p data-testid="card-domain">{card.section.domain.status === "AVAILABLE" ? "" : card.section.domain.reason}</p> });
    return blocks;
  }
  if (summary !== null) blocks.push({ key: "summary", title: "Primary Effect", body: <p className="fcard-summary" data-testid="card-summary">{summary.text}</p> });
  blocks.push({
    key: "how",
    title: "How to Use",
    body: opts.compact ? (
      <details className="fcard-disclosure" data-testid="card-full-instructions">
        <summary>Complete instructions ({card.instructions.blocks.length})</summary>
        <Instructions card={card} />
      </details>
    ) : (
      <Instructions card={card} />
    ),
  });
  return blocks;
}

// ---- back --------------------------------------------------------------------------------------------------------

const yesNo = (v: boolean | null) => (v === null ? "Unresolved" : v ? "Met" : "Not met");
const STATUS_WORDS: Readonly<Record<string, string>> = { EXECUTABLE: "Applied", REFERENCE_ONLY: "Reference only — not executed", DEFERRED: "Deferred — not executed" };

function Properties({ list, names }: { list: readonly CardPropertyEntryDto[]; names: Record<string, string> }) {
  if (list.length === 0) return <p className="fcard-empty">None.</p>;
  return (
    <ul className="fcard-list" data-testid="card-properties">
      {list.map((p, i) => (
        <li key={`${p.traitKey}-${i}`} data-status={p.executionStatus}>
          <strong>{refName(names, p.trait)}</strong> <span className="fcard-tag">{STATUS_WORDS[p.executionStatus] ?? tokenText(p.executionStatus)}</span>
          {Object.keys(p.parameters).length > 0 ? <span> ({Object.entries(p.parameters).map(([k, v]) => `${tokenText(k)} ${v}`).join(", ")})</span> : null}
          {p.summary ? <span> — {p.summary}</span> : null}
        </li>
      ))}
    </ul>
  );
}
function Requirements({ list }: { list: readonly CardRequirementEntryDto[] }) {
  if (list.length === 0) return <p className="fcard-empty">No requirements.</p>;
  return (
    <ul className="fcard-list" data-testid="card-requirements">
      {list.map((q) => (
        <li key={q.requirementKey}>
          {q.required} — has {q.actual} <span className="fcard-tag">{yesNo(q.satisfied)}</span>
        </li>
      ))}
    </ul>
  );
}
function Traits({ list, names }: { list: readonly CardTraitEntryDto[]; names: Record<string, string> }) {
  if (list.length === 0) return <p className="fcard-empty">No Traits.</p>;
  return (
    <ol className="fcard-list" data-testid="card-traits">
      {list.map((t) => (
        <li key={t.componentKey}>
          <strong>{refName(names, t.trait)}</strong> <span className="fcard-tag">{tokenText(t.scope.scope)}{t.scope.componentKey ? ` · ${t.scope.componentKey}` : ""}</span>
          {t.modifications.length > 0 ? (
            <ul>
              {t.modifications.map((m, i) => (
                <li key={i}>
                  {tokenText(m.kind)}
                  {m.targetComponentKey ? ` → ${m.targetComponentKey}` : ""}
                  {m.selected !== null ? `: ${String(m.selected)}` : ""}
                </li>
              ))}
            </ul>
          ) : null}
        </li>
      ))}
    </ol>
  );
}
function Generic({ value }: { value: unknown }) {
  // Structured server data shown as nested key / value lists (no interpretation).
  if (value === null || typeof value !== "object") return <>{value === null ? "—" : String(value)}</>;
  if (Array.isArray(value))
    return (
      <ul className="fcard-list">
        {value.map((v, i) => (
          <li key={i}>
            <Generic value={v} />
          </li>
        ))}
      </ul>
    );
  return (
    <dl className="fcard-kv">
      {Object.entries(value as Record<string, unknown>).map(([k, v]) => (
        <div key={k}>
          <dt>{tokenText(k.replace(/([a-z])([A-Z])/g, "$1_$2"))}</dt>
          <dd>{(v as { canonicalKey?: string })?.canonicalKey !== undefined ? (v as { canonicalKey: string }).canonicalKey : <Generic value={v} />}</dd>
        </div>
      ))}
    </dl>
  );
}

export function ImprovementSummary({ item, names }: { item: CardImprovementEntryDto; names: Record<string, string> }) {
  return (
    <div className="fcard-improvement" data-testid="improvement" data-status={item.status}>
      <p>
        <strong>{refName(names, item.improvement)}</strong> <span className="fcard-tag" data-testid="improvement-status">{IMPROVEMENT_STATUS_LABELS[item.status]}</span>
      </p>
      <p>{item.rulesText}</p>
    </div>
  );
}

function costRows(card: CardDto) {
  if (card.costs.breakdown.length === 0) return <p className="fcard-empty">No itemized costs: AP {valueText(card.costs.ap, "AP")}; MP {valueText(card.costs.mp, "MP")}.</p>;
  return (
    <table className="fcard-table" data-testid="card-cost-breakdown">
      <caption className="fcard-sr">Cost breakdown</caption>
      <thead>
        <tr>
          <th scope="col">Line</th>
          <th scope="col">Value</th>
          <th scope="col">Source</th>
        </tr>
      </thead>
      <tbody>
        {card.costs.breakdown.map((l, i) => (
          <tr key={i}>
            <th scope="row">{l.label}</th>
            <td>
              {l.value} {l.currency === "PERCENT" ? "%" : l.currency}
            </td>
            <td>{l.source ? l.source.canonicalKey : "—"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function spellBlocks(s: SpellSectionDto, names: Record<string, string>): CardBlock[] {
  const rt = s.runtime;
  return [
    {
      key: "spell-identity",
      title: "Authority & Affinity",
      body: (
        <dl className="fcard-kv">
          <div>
            <dt>Authority</dt>
            <dd>{s.authority ? tokenText(s.authority) : "—"}</dd>
          </div>
          <div>
            <dt>Affinity</dt>
            <dd>{refName(names, s.affinity)}</dd>
          </div>
          <div>
            <dt>Keywords</dt>
            <dd>{s.keywords.length === 0 ? "—" : s.keywords.map((k) => tokenText(k.replace(/^keyword\./, ""))).join(", ")}</dd>
          </div>
        </dl>
      ),
    },
    { key: "traits", title: "Traits", body: <Traits list={s.traits} names={names} />, printItems: s.traits.length === 0 ? undefined : s.traits.map((t) => ({ key: t.componentKey, body: <Traits list={[t]} names={names} /> })) },
    {
      key: "runtime",
      title: "Runtime",
      body: (
        <dl className="fcard-kv">
          <div>
            <dt>Sustain</dt>
            <dd>{rt.sustain === null ? "None" : rt.sustain.status === "AVAILABLE" ? `${rt.sustain.value.mpPerRound ?? "—"} MP and ${rt.sustain.value.apPerRound} AP per round${rt.sustain.value.meEligible ? " (ME eligible)" : ""}` : rt.sustain.reason}</dd>
          </div>
          <div>
            <dt>Mana Lock</dt>
            <dd>{rt.manaLock === null ? "None" : rt.manaLock.status === "AVAILABLE" ? "—" : `Deferred — ${rt.manaLock.reason}`}</dd>
          </div>
          <div>
            <dt>Concentration</dt>
            <dd>{rt.concentration ?? "None"}</dd>
          </div>
        </dl>
      ),
    },
  ];
}
function maneuverBlocks(s: ManeuverSectionDto, names: Record<string, string>): CardBlock[] {
  return [
    {
      key: "actions",
      title: "Action sequence",
      body: (
        <ol className="fcard-list" data-testid="card-actions">
          {[...s.actions]
            .sort((a, b) => a.order - b.order)
            .map((a) => (
              <li key={a.actionKey}>
                <strong>{a.actionKey}</strong> — {refName(names, a.source)}
                {a.weapon ? ` (${refName(names, a.weapon)})` : ""}
              </li>
            ))}
        </ol>
      ),
    },
    { key: "traits", title: "Traits", body: <Traits list={s.traits} names={names} />, printItems: s.traits.length === 0 ? undefined : s.traits.map((t) => ({ key: t.componentKey, body: <Traits list={[t]} names={names} /> })) },
    ...(s.performance === null ? [] : [{ key: "performance", title: "Condition benefits", body: s.performance.status === "AVAILABLE" ? <Generic value={s.performance.value} /> : <p>{s.performance.reason}</p> }]),
  ];
}
function weaponBlocks(s: WeaponSectionDto, names: Record<string, string>): CardBlock[] {
  return [
    {
      key: "weapon-identity",
      title: "Weapon",
      body: (
        <dl className="fcard-kv">
          <div>
            <dt>Profile</dt>
            <dd>
              {tokenText(s.profileKind)} · {tokenText(s.equipmentRole)}
            </dd>
          </div>
          <div>
            <dt>Category</dt>
            <dd>{s.category ? tokenText(s.category) : "Not authored"}</dd>
          </div>
          <div>
            <dt>Handedness</dt>
            <dd>{s.handedness ? tokenText(s.handedness) : "Not authored"}</dd>
          </div>
          <div>
            <dt>Scaling</dt>
            <dd>
              {tokenText(s.scalingModel)} · Power {s.power.status === "AVAILABLE" ? s.power.value : s.power.status === "DEFERRED" ? s.power.reason : s.power.reason}
            </dd>
          </div>
          {s.martialRankKey ? (
            <div>
              <dt>Martial rank</dt>
              <dd>{tokenText(s.martialRankKey)}</dd>
            </div>
          ) : null}
          {s.exampleForms.length > 0 ? (
            <div>
              <dt>Example forms</dt>
              <dd>{s.exampleForms.join(", ")}</dd>
            </div>
          ) : null}
        </dl>
      ),
    },
    { key: "properties", title: "Weapon properties", body: <Properties list={s.properties} names={names} /> },
    ...(s.equippedModifiers.length > 0
      ? [{ key: "modifiers", title: "Equipped modifiers", body: <ul className="fcard-list">{s.equippedModifiers.map((m) => <li key={m.modifierKey}>{tokenText(m.target)}: {m.value}</li>)}</ul> }]
      : []),
    ...(s.grantedFeatures.length > 0
      ? [{ key: "features", title: "Granted features", body: <ul className="fcard-list">{s.grantedFeatures.map((g) => <li key={g.featureKey}>{g.summary} <span className="fcard-tag">{STATUS_WORDS[g.executionStatus] ?? tokenText(g.executionStatus)}</span></li>)}</ul> }]
      : []),
    { key: "requirements", title: "Requirements", body: <Requirements list={s.requirements} /> },
    { key: "moveset", title: "Moves", body: <ol className="fcard-list" data-testid="card-moveset">{s.moveset.map((m) => <li key={m.cardKey}>{refName(names, m.attack)}</li>)}</ol> },
  ];
}
function attackBlocks(s: AttackSectionDto, names: Record<string, string>): CardBlock[] {
  const r = s.range;
  return [
    {
      key: "damage",
      title: "Damage profiles",
      printItems: s.damage.map((d, i) => ({
        key: d.profileKey,
        body: (
          <ol className="fcard-list" start={i + 1}>
            <li>
              <strong>{d.final ?? "Unresolved"}</strong> {tokenText(d.damageType)} <span className="fcard-tag">{tokenText(d.scaling)}</span>
              {d.reason ? <span> — {d.reason}</span> : null}
              <ol className="fcard-steps">
                {d.steps.map((st, k) => (
                  <li key={k}>
                    {tokenText(st.step)}: {st.detail}
                  </li>
                ))}
              </ol>
            </li>
          </ol>
        ),
      })),
      body: (
        <ol className="fcard-list" data-testid="card-damage">
          {s.damage.map((d) => (
            <li key={d.profileKey} data-profile={d.profileKey}>
              <strong>{d.final ?? "Unresolved"}</strong> {tokenText(d.damageType)} <span className="fcard-tag">{tokenText(d.scaling)}</span>
              {d.reason ? <span> — {d.reason}</span> : null}
              <ol className="fcard-steps">
                {d.steps.map((st, i) => (
                  <li key={i}>
                    {tokenText(st.step)}: {st.detail}
                  </li>
                ))}
              </ol>
            </li>
          ))}
        </ol>
      ),
    },
    {
      key: "attack-range",
      title: "Range & accuracy",
      body: (
        <dl className="fcard-kv">
          <div>
            <dt>Mode</dt>
            <dd>{tokenText(r.mode)}</dd>
          </div>
          {r.reachFeet !== null ? (
            <div>
              <dt>Reach</dt>
              <dd>{r.reachFeet} ft</dd>
            </div>
          ) : null}
          {r.rangeFeet !== null ? (
            <div>
              <dt>Range</dt>
              <dd>
                {r.rangeFeet} ft{r.basis ? ` (${r.basis.stat} ${r.basis.statScore} × ${r.basis.feetPerPoint} ft)` : ""}
              </dd>
            </div>
          ) : null}
          {r.lengthFeet !== null ? (
            <div>
              <dt>Length</dt>
              <dd>{r.lengthFeet} ft</dd>
            </div>
          ) : null}
          {r.area !== null ? (
            <div>
              <dt>Area</dt>
              <dd>
                {tokenText(r.area.shape)} {r.area.radiusFeet} ft
              </dd>
            </div>
          ) : null}
          <div>
            <dt>Accuracy</dt>
            <dd>{s.accuracyModifier}</dd>
          </div>
        </dl>
      ),
    },
    { key: "weapon-properties", title: "Weapon properties", body: <Properties list={s.properties.weapon} names={names} /> },
    { key: "move-properties", title: "Move properties", body: <Properties list={s.properties.move} names={names} /> },
    { key: "requirements", title: "Requirements", body: <Requirements list={s.requirements} /> },
  ];
}
function actionBlocks(s: GeneralActionSectionDto, names: Record<string, string>): CardBlock[] {
  return [
    ...(s.otherCosts.length > 0 ? [{ key: "other-costs", title: "Other costs", body: <ul className="fcard-list">{s.otherCosts.map((c) => <li key={c.costKey}>{c.amount} {tokenText(c.costKey)} ({tokenText(c.policy)})</li>)}</ul> }] : []),
    ...(s.movementGrant === null
      ? []
      : [
          {
            key: "movement",
            title: "Movement grant",
            body: (
              <dl className="fcard-kv" data-testid="card-movement">
                <div>
                  <dt>Formula</dt>
                  <dd>
                    {s.movementGrant.expression}
                    {s.movementGrant.unit ? ` (${s.movementGrant.unit})` : ""}
                  </dd>
                </div>
                {s.movementGrant.inputs.map((x) => (
                  <div key={x.variable}>
                    <dt>{x.statistic ? tokenText(x.statistic) : x.variable} now</dt>
                    <dd>{x.current.status === "AVAILABLE" ? x.current.value : x.current.reason}</dd>
                  </div>
                ))}
                <div>
                  <dt>Granted</dt>
                  <dd>{s.movementGrant.value.status === "AVAILABLE" ? s.movementGrant.value.value : `Deferred — ${s.movementGrant.value.reason}`}</dd>
                </div>
              </dl>
            ),
          },
        ]),
    {
      key: "improvements",
      title: "Improvements",
      printItems: s.improvements.length === 0 ? undefined : s.improvements.map((i) => ({ key: i.improvementKey, body: <ImprovementSummary item={i} names={names} /> })),
      body:
        s.improvements.length === 0 ? (
          <p className="fcard-empty" data-testid="card-no-improvements">
            This Release authors no improvements for this Action.
          </p>
        ) : (
          <div data-testid="card-improvements">
            {s.improvements.map((i) => (
              <ImprovementSummary key={i.improvementKey} item={i} names={names} />
            ))}
          </div>
        ),
    },
  ];
}

/** Back blocks: the full rules, category details, costs, limitations and provenance — nothing omitted. */
export function backBlocks(card: CardDto, names: Record<string, string>, release: string | null): CardBlock[] {
  const s = card.section;
  const blocks: CardBlock[] = [];
  if (s.kind !== "MAGE_ART") blocks.push({ key: "rules", title: s.kind === "SIGNATURE_SPELL" ? "Effects in order" : s.kind === "SIGNATURE_MANEUVER" ? "Resolution groups" : "Rules", body: <Instructions card={card} /> });
  if (s.kind === "SIGNATURE_SPELL") blocks.push(...spellBlocks(s, names));
  if (s.kind === "SIGNATURE_MANEUVER") blocks.push(...maneuverBlocks(s, names));
  if (s.kind === "WEAPON") blocks.push(...weaponBlocks(s, names));
  if (s.kind === "ATTACK") blocks.push(...attackBlocks(s, names));
  if (s.kind === "GENERAL_ACTION") blocks.push(...actionBlocks(s, names));
  if (s.kind !== "MAGE_ART") blocks.push({ key: "costs", title: "Costs", body: costRows(card) });
  const limits = [...card.limitations, ...card.instructions.unresolved.filter((u) => !card.limitations.some((l) => l.code === u.code && l.message === u.message))];
  blocks.push({
    key: "limitations",
    title: "Limitations & deferrals",
    body:
      limits.length === 0 ? (
        <p className="fcard-empty">None reported.</p>
      ) : (
        <ul className="fcard-list" data-testid="card-limitations">
          {limits.map((l, i) => (
            <li key={i}>
              <span className="fcard-tag">{l.code}</span> {l.message}
            </li>
          ))}
        </ul>
      ),
  });
  const p = card.provenance;
  blocks.push({
    key: "provenance",
    title: "Source & revision",
    reference: true,
    body: (
      <div data-testid="card-provenance">
        <dl className="fcard-kv">
          {release ? (
            <div>
              <dt>Release</dt>
              <dd>{release}</dd>
            </div>
          ) : null}
          <div>
            <dt>Snapshot</dt>
            <dd data-testid="card-key">{card.snapshot.cardKey} · contract v{card.snapshot.contractVersion}</dd>
          </div>
          {p.ability ? (
            <div>
              <dt>Revision</dt>
              <dd data-testid="card-revision">
                {p.ability.revisionNumber === null ? "Working draft" : `Revision ${p.ability.revisionNumber}`} · {tokenText(p.ability.revisionRole)}
              </dd>
            </div>
          ) : null}
          <div>
            <dt>Evaluated by</dt>
            <dd>
              {p.evaluation.authority} · {tokenText(p.evaluation.state)}
            </dd>
          </div>
        </dl>
        {p.sources.length > 0 ? (
          <ol className="fcard-list fcard-sources" data-testid="card-sources">
            {p.sources.map((r, i) => (
              <li key={`${r.entityVersionId}-${i}`}>
                {refName(names, r)} <span className="fcard-mono">{r.canonicalKey}</span>
              </li>
            ))}
          </ol>
        ) : null}
        {s.kind === "GENERAL_ACTION" ? <p className="fcard-mono">Source locators: {[...s.source.locators, ...s.source.conflicts].join(", ") || "—"}</p> : null}
      </div>
    ),
    printItems: [
      {
        key: "identity",
        body: (
          <dl className="fcard-kv">
            {release ? (
              <div>
                <dt>Release</dt>
                <dd>{release}</dd>
              </div>
            ) : null}
            <div>
              <dt>Snapshot</dt>
              <dd>
                {card.snapshot.cardKey} · contract v{card.snapshot.contractVersion}
              </dd>
            </div>
            {p.ability ? (
              <div>
                <dt>Revision</dt>
                <dd>
                  {p.ability.revisionNumber === null ? "Working draft" : `Revision ${p.ability.revisionNumber}`} · {tokenText(p.ability.revisionRole)}
                </dd>
              </div>
            ) : null}
            <div>
              <dt>Evaluated by</dt>
              <dd>
                {p.evaluation.authority} · {tokenText(p.evaluation.state)}
              </dd>
            </div>
          </dl>
        ),
      },
      ...p.sources.map((r, i) => ({
        key: `source.${i}`,
        body: (
          <ol className="fcard-list fcard-sources" start={i + 1}>
            <li>
              {refName(names, r)} <span className="fcard-mono">{r.canonicalKey}</span>
            </li>
          </ol>
        ),
      })),
      ...(s.kind === "GENERAL_ACTION" ? [{ key: "locators", body: <p className="fcard-mono">Source locators: {[...s.source.locators, ...s.source.conflicts].join(", ") || "—"}</p> }] : []),
    ],
  });
  return blocks;
}

/** Renders blocks as titled sections; `collapsible` turns reference blocks into disclosures (digital only). */
export function BlockList({ blocks, collapsible, headingLevel = 4 }: { blocks: readonly CardBlock[]; collapsible: boolean; headingLevel?: 3 | 4 }) {
  const H = headingLevel === 3 ? "h3" : "h4";
  return (
    <>
      {blocks.map((b) =>
        collapsible && b.reference ? (
          <details key={b.key} className="fcard-section fcard-disclosure" data-block={b.key}>
            <summary>{b.title}</summary>
            {b.body}
          </details>
        ) : (
          <section key={b.key} className="fcard-section" data-block={b.key} aria-label={b.title === "" ? undefined : b.title}>
            {b.title === "" ? null : <H className="fcard-section__title">{b.title}</H>}
            {b.body}
          </section>
        ),
      )}
    </>
  );
}

export function CardFront({ card, names, variant }: { card: CardDto; names: Record<string, string>; variant: "illustrated" | "tactical" }) {
  return (
    <div className={`fcard fcard--front fcard--${variant} fcard--${card.category.toLowerCase()}`} data-testid="card-front" data-category={card.category}>
      <CardHeader card={card} />
      <CardArt card={card} size={variant === "illustrated" ? "large" : "small"} />
      <CostStrip card={card} />
      <BlockList blocks={frontBlocks(card, names, { compact: variant === "illustrated" })} collapsible />
    </div>
  );
}
export function CardBack({ card, names, release }: { card: CardDto; names: Record<string, string>; release: string | null }) {
  return (
    <div className={`fcard fcard--back fcard--${card.category.toLowerCase()}`} data-testid="card-back" data-category={card.category}>
      <header className="fcard-header fcard-header--back">
        <p className="fcard-header__type">{CATEGORY_LABELS[card.category]} · Back</p>
        <h3 className="fcard-header__name">{card.name}</h3>
      </header>
      <BlockList blocks={backBlocks(card, names, release)} collapsible />
    </div>
  );
}
