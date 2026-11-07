"use client";

import Link from "next/link";
import { useState } from "react";
import type { PlayEventDto, PlayTimingEventDto, PlayViewDto, PlayWorkspaceDto, SheetValueDto } from "../../_lib/play-types";
import { CLASSIFICATION_LABELS, playLinks, Reasons, type Submitter } from "./PlayWorkspace";
import { RollInput, emptyRoll, rollOperand, type RollDraft } from "./ActionDetailPanel";

/**
 * Play Workspace panels (PAS-10 M6-WO10): the Character header, timing controls, resource dashboard (with the labelled
 * manual adjustment), the Active Magic panel and the activity log. Presentation and input only — every value shown is
 * the server's, and every control submits an operation the server evaluates.
 */
const value = (v: SheetValueDto) => (v.value === null ? <span className="fcard-muted">{v.unavailable ?? "unavailable"}</span> : `${String(v.value)}${v.unit ? ` ${v.unit}` : ""}`);
const TIMING_LABELS: Record<PlayTimingEventDto, string> = { BEGIN_COMBAT: "Begin combat", START_ROUND: "Start round", START_TURN: "Start my turn", END_TURN: "End my turn", END_ROUND: "End round", END_COMBAT: "End combat" };
const PHASE_LABELS: Record<string, string> = { OUT_OF_COMBAT: "Out of combat", AWAITING_ROUND: "Combat — between rounds", ROUND: "Combat — round in progress" };
const TURN_LABELS: Record<string, string> = { NOT_TAKEN: "turn not taken", ACTIVE: "my turn", ENDED: "turn ended" };

export function PlayHeader({ view, release }: { view: PlayViewDto; release: string }) {
  const w = view.workspace;
  const h = w.header;
  const c = w.runtime.combat;
  const links = playLinks(view.character.id);
  return (
    <header className="play-header" data-testid="play-header">
      <div className="play-header__identity">
        <h1 className="play-header__name">{view.character.name}</h1>
        <p className="play-header__sub">
          Level {view.character.level} · {release} · Character Die <span data-testid="play-die">{h.characterDie.dieKey}</span>
        </p>
        <p className="play-header__context" data-testid="play-context" data-phase={c.phase} data-turn={c.turn} data-round={c.round ?? ""}>
          {PHASE_LABELS[c.phase]}
          {c.round !== null ? ` · Round ${String(c.round)}` : ""}
          {c.active ? ` · ${TURN_LABELS[c.turn] ?? c.turn}` : ""}
          {c.surprised ? " · surprised (GM)" : ""}
        </p>
      </div>
      <dl className="play-header__stats">
        {(
          [
            ["Dodge", h.dodge],
            ["Accuracy", h.accuracy],
            ["Character DC", h.characterDc],
            ["Armor", h.armor],
            ["Initiative", h.initiative],
            ["Movement", h.movement],
            ["Range", h.range],
          ] as const
        ).map(([label, v]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value(v)}</dd>
          </div>
        ))}
      </dl>
      <nav className="play-header__nav" aria-label="Character pages">
        <Link className="fcard-button" href={links.sheet}>
          Character Sheet
        </Link>
        <Link className="fcard-button" href={links.cards}>
          Cards
        </Link>
        <Link className="fcard-button" href={links.abilities}>
          Abilities &amp; Builders
        </Link>
        <Link className="fcard-button" href={links.actions}>
          Action Directory
        </Link>
      </nav>
    </header>
  );
}

export function TimingBar({ workspace, submitter }: { workspace: PlayWorkspaceDto; submitter: Submitter }) {
  const [surprised, setSurprised] = useState(false);
  const legal = new Set(workspace.timing.legal);
  return (
    <section className="play-panel play-timing" aria-label="Turn and round timing" data-testid="play-timing">
      {(Object.keys(TIMING_LABELS) as PlayTimingEventDto[]).map((event) => (
        <button key={event} type="button" className="fcard-button" disabled={submitter.busy || !legal.has(event)} onClick={() => void submitter.commit({ kind: "TIMING", event, ...(event === "BEGIN_COMBAT" ? { surprised } : {}) })} data-testid={`play-timing-${event}`}>
          {TIMING_LABELS[event]}
        </button>
      ))}
      {legal.has("BEGIN_COMBAT") ? (
        <label className="play-inline">
          <input type="checkbox" checked={surprised} onChange={(e) => setSurprised(e.target.checked)} data-testid="play-surprised" /> Surprised (GM determination)
        </label>
      ) : null}
      <p className="fcard-muted play-timing__note">Refreshes and expiries run only on these explicit events, by the Release&apos;s authored timing. Nothing advances on its own.</p>
    </section>
  );
}

export function ResourceDashboard({ workspace, submitter }: { workspace: PlayWorkspaceDto; submitter: Submitter }) {
  const [key, setKey] = useState("HP");
  const [after, setAfter] = useState("");
  const [reason, setReason] = useState("");
  const conc = workspace.concentration;
  return (
    <section className="play-panel" aria-labelledby="play-resources-title" data-testid="play-resources">
      <h2 id="play-resources-title">Resources</h2>
      <ul className="play-resources">
        {workspace.resources.map((r) => (
          <li key={r.resourceKey} className="play-resource" data-testid="play-resource" data-resource={r.resourceKey} data-current={r.current}>
            <span className="play-resource__name">{r.name}</span>
            <span className="play-resource__value" data-testid={`play-resource-${r.resourceKey}`}>
              {String(r.current)}
              {r.maximum === null ? "" : ` / ${String(r.maximum)}`}
            </span>
            {r.reservedCapacity ? <span className="fcard-tag">reserved {String(r.reservedCapacity)}</span> : null}
            <span className="fcard-muted play-resource__timing">{[...r.refresh.map((x) => `refreshes ${x.timing.replace(/_/g, " ").toLowerCase()}`), ...r.expiry.map((x) => `expires ${x.timing.replace(/_/g, " ").toLowerCase()}`)].join(" · ") || (r.runtimeOnly ? "runtime only" : "no automatic refresh")}</span>
          </li>
        ))}
        <li className="play-resource" data-testid="play-concentration">
          <span className="play-resource__name">Concentration</span>
          {"capacity" in conc ? (
            <span className="play-resource__value">
              {String(conc.used)} / {String(conc.capacity)} in use{conc.dc === null ? "" : ` · test DC ${String(conc.dc)}`}
            </span>
          ) : (
            <span className="fcard-muted">{conc.unavailable}</span>
          )}
        </li>
      </ul>
      <details className="play-manual">
        <summary>Manual adjustment (player / GM)</summary>
        <p className="fcard-muted">A correction or adjudicated result. It is recorded as a manual adjustment — never as a rules-engine calculation — and checked against the Release&apos;s bounds.</p>
        <form
          className="play-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (!/^\d+$/.test(after)) return;
            void submitter.commit({ kind: "MANUAL_ADJUSTMENT", resourceKey: key, after: Number(after), ...(reason.trim() ? { reason: reason.trim() } : {}) });
          }}
        >
          <label className="gov-field">
            <span>Resource</span>
            <select value={key} onChange={(e) => setKey(e.target.value)} data-testid="play-manual-resource">
              {workspace.resources.map((r) => (
                <option key={r.resourceKey} value={r.resourceKey}>
                  {r.name}
                </option>
              ))}
            </select>
          </label>
          <label className="gov-field">
            <span>New current value</span>
            <input inputMode="numeric" value={after} onChange={(e) => setAfter(e.target.value)} data-testid="play-manual-value" />
          </label>
          <label className="gov-field">
            <span>Reason (optional)</span>
            <input value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} data-testid="play-manual-reason" />
          </label>
          <button type="submit" className="fcard-button" disabled={submitter.busy || !/^\d+$/.test(after)} data-testid="play-manual-submit">
            Record manual adjustment
          </button>
        </form>
      </details>
    </section>
  );
}

const TRIGGERS = ["TAKES_DAMAGE", "GRAPPLED", "RESTRAINED", "KNOCKED_PRONE", "FORCIBLY_MOVED", "STUNNED", "DAZED", "FAILED_RELEVANT_SAVE", "MAGICAL_DISRUPTION", "MULTIPLE_UNSTABLE_EFFECTS", "CONCENTRATION_TEST_REQUIRED"];
const ENDS = ["DISPELLED", "BANISHED", "DESTROYED", "SOURCE_ENDED", "INTERRUPTED", "RULE_TERMINATED"];

export function ActiveMagicPanel({ workspace, submitter, onCard }: { workspace: PlayWorkspaceDto; submitter: Submitter; onCard: (key: string) => void }) {
  const state = workspace.activeMagic.state;
  const effects = state?.effects ?? [];
  const live = effects.filter((e) => e.status !== "ENDED");
  const [selection, setSelection] = useState<string[]>([]);
  const [target, setTarget] = useState<string>("");
  const [trigger, setTrigger] = useState(TRIGGERS[0]!);
  const [roll, setRoll] = useState<RollDraft>(emptyRoll());
  const [invest, setInvest] = useState("1");
  const [channelSpell, setChannelSpell] = useState("");
  const [ending, setEnding] = useState({ key: "", end: ENDS[0]!, sourceKey: "" });
  const pending = workspace.activeMagic.pendingDecision;
  const die = workspace.header.characterDie;
  const spells = workspace.spells.filter((s) => s.state === "VALID");
  const concentrationTargets = [...live.filter((e) => e.concentration.required).map((e) => e.activeEffectKey), ...(state?.channel ? ["CHANNEL"] : [])];
  const operand = rollOperand(roll);
  return (
    <div data-testid="play-active-magic">
      {pending !== null ? (
        <p className="play-alert" role="status" data-testid="play-magic-pending">
          {pending === "MAINTENANCE_SELECTION" ? "Not every Sustain upkeep can be paid: choose which Effects to maintain (in order). The engine never chooses for you." : "A Concentration Save is pending: enter the roll below."}
        </p>
      ) : null}
      {effects.length === 0 && state?.channel == null ? <p className="fcard-empty">No Active Magic. Casting a Spell with a persistent Duration activates it here.</p> : null}
      <ul className="play-list">
        {effects.map((e) => (
          <li key={e.activeEffectKey} className="play-effect" data-testid="play-effect" data-status={e.status} data-effect={e.activeEffectKey}>
            <h3>
              {e.ability.signatureAbilityId !== undefined ? (workspace.spells.find((s) => s.abilityId === e.ability.signatureAbilityId)?.name ?? "Signature Spell") : e.ability.canonicalKey}
              {e.ability.revisionNumber !== undefined ? <span className="fcard-muted"> r{String(e.ability.revisionNumber)}</span> : null} <span className="fcard-tag">{e.status.replace(/_/g, " ").toLowerCase()}</span>
            </h3>
            <dl className="play-facts">
              <div>
                <dt>Duration</dt>
                <dd>
                  {e.duration.concept.toLowerCase()}
                  {e.duration.remainingRounds === null ? "" : ` · ${String(e.duration.remainingRounds)} round(s) left`} · {e.duration.dismissal === "FREE_ACTION" ? "dismissible" : "not dismissible"}
                </dd>
              </div>
              {e.sustain ? (
                <div>
                  <dt>Sustain</dt>
                  <dd>
                    {String(e.sustain.apCost)} AP + {String(e.sustain.mpCost)} mana per round{e.sustain.meEligible ? " (ME first)" : ""}
                    {e.sustain.lastPayment ? ` · last paid ${String(e.sustain.lastPayment.ap)} AP, ${String(e.sustain.lastPayment.me)} ME, ${String(e.sustain.lastPayment.mp)} MP` : " · not yet maintained"}
                  </dd>
                </div>
              ) : null}
              <div>
                <dt>Concentration</dt>
                <dd>{e.concentration.required ? "uses a slot" : "none"}</dd>
              </div>
              {e.manaLock ? (
                <div>
                  <dt>Mana Lock</dt>
                  <dd>{String(e.manaLock.reservedMp)} MP reserved (not spent)</dd>
                </div>
              ) : null}
              <div>
                <dt>Persistent outcomes</dt>
                <dd>{e.outcomes.map((o) => `${o.targetKey}: ${o.outcomeKey.toLowerCase()} (not applied)`).join("; ")}</dd>
              </div>
              {e.ticks.length ? (
                <div>
                  <dt>Ticks</dt>
                  <dd>{e.ticks.map((t) => `${t.timing.replace(/_/g, " ").toLowerCase()} on ${t.targetKey}`).join("; ")}</dd>
                </div>
              ) : null}
              {e.endReason ? (
                <div>
                  <dt>Ended</dt>
                  <dd>
                    {e.endReason.replace(/_/g, " ").toLowerCase()} ({e.endedBy?.event.toLowerCase()})
                  </dd>
                </div>
              ) : null}
            </dl>
            {e.status !== "ENDED" ? (
              <p className="play-actions">
                {e.duration.dismissal === "FREE_ACTION" ? (
                  <button type="button" className="fcard-button" disabled={submitter.busy} onClick={() => void submitter.commit({ kind: "ACTIVE_MAGIC", event: "DISMISS", activeEffectKey: e.activeEffectKey })} data-testid="play-effect-dismiss">
                    Dismiss
                  </button>
                ) : null}
                {pending === "MAINTENANCE_SELECTION" && e.status === "PENDING_MAINTENANCE" ? (
                  <label className="play-inline">
                    <input type="checkbox" checked={selection.includes(e.activeEffectKey)} onChange={(x) => setSelection(x.target.checked ? [...selection, e.activeEffectKey] : selection.filter((k) => k !== e.activeEffectKey))} /> maintain
                  </label>
                ) : null}
              </p>
            ) : null}
            {e.ability.signatureAbilityId !== undefined && e.ability.revisionNumber !== undefined ? (
              <button type="button" className="gov-link-button" onClick={() => onCard(`SIGNATURE_SPELL:${e.ability.signatureAbilityId}:${String(e.ability.revisionNumber)}`)}>
                Card
              </button>
            ) : null}
          </li>
        ))}
      </ul>
      {state?.channel ? (
        <section className="play-effect" data-testid="play-channel">
          <h3>Channel</h3>
          <p>
            {String(state.channel.investedAp)} of {String(state.channel.requiredAp)} AP invested · {state.channel.status.toLowerCase()} · MP payment {state.channel.mpPayment.status.toLowerCase()} ({state.channel.mpPayment.conflictKey})
          </p>
          <p className="play-actions">
            <label className="gov-field">
              <span>Invest AP</span>
              <input inputMode="numeric" value={invest} onChange={(x) => setInvest(x.target.value)} data-testid="play-channel-amount" />
            </label>
            <button type="button" className="fcard-button" disabled={submitter.busy || !/^\d+$/.test(invest)} onClick={() => void submitter.commit({ kind: "ACTIVE_MAGIC", event: "CHANNEL_INVEST", amount: Number(invest) })} data-testid="play-channel-invest">
              Invest
            </button>
            <button type="button" className="fcard-button" disabled={submitter.busy} onClick={() => void submitter.commit({ kind: "ACTIVE_MAGIC", event: "CHANNEL_STOP" })} data-testid="play-channel-stop">
              Stop channeling (no refund)
            </button>
          </p>
        </section>
      ) : null}
      <section className="play-magic-controls">
        <h3>Lifecycle</h3>
        <p className="play-actions">
          <button type="button" className="fcard-button" disabled={submitter.busy || !live.some((e) => e.sustain !== null)} onClick={() => void submitter.commit({ kind: "ACTIVE_MAGIC", event: "MAINTENANCE", ...(pending === "MAINTENANCE_SELECTION" ? { selection } : {}) })} data-testid="play-magic-maintain">
            {pending === "MAINTENANCE_SELECTION" ? "Maintain selected (in order)" : "Pay Sustain upkeep"}
          </button>
        </p>
        {concentrationTargets.length ? (
          <form
            className="play-form"
            onSubmit={(x) => {
              x.preventDefault();
              void submitter.commit({ kind: "ACTIVE_MAGIC", event: "CONCENTRATION_TEST", trigger, target: target || concentrationTargets[0], ...(operand === null ? {} : { roll: operand }) });
            }}
          >
            <label className="gov-field">
              <span>Concentration test — trigger</span>
              <select value={trigger} onChange={(x) => setTrigger(x.target.value)} data-testid="play-conc-trigger">
                {TRIGGERS.map((t) => (
                  <option key={t} value={t}>
                    {t.replace(/_/g, " ").toLowerCase()}
                  </option>
                ))}
              </select>
            </label>
            <label className="gov-field">
              <span>Disrupted</span>
              <select value={target || concentrationTargets[0]} onChange={(x) => setTarget(x.target.value)} data-testid="play-conc-target">
                {concentrationTargets.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </label>
            <RollInput roll={roll} onChange={setRoll} faces={die.faces} dieKey={die.dieKey} testid="play-conc-roll" />
            <button type="submit" className="fcard-button" disabled={submitter.busy} data-testid="play-conc-submit">
              {operand === null ? "Require the test (enter the roll later)" : "Resolve Concentration Save"}
            </button>
          </form>
        ) : null}
        {live.length ? (
          <form
            className="play-form"
            onSubmit={(x) => {
              x.preventDefault();
              void submitter.commit({ kind: "ACTIVE_MAGIC", event: "EXTERNAL_END", activeEffectKey: ending.key || live[0]!.activeEffectKey, end: ending.end, sourceKey: ending.sourceKey });
            }}
          >
            <label className="gov-field">
              <span>External end (GM)</span>
              <select value={ending.key || live[0]!.activeEffectKey} onChange={(x) => setEnding({ ...ending, key: x.target.value })}>
                {live.map((e) => (
                  <option key={e.activeEffectKey} value={e.activeEffectKey}>
                    {e.activeEffectKey}
                  </option>
                ))}
              </select>
            </label>
            <select value={ending.end} onChange={(x) => setEnding({ ...ending, end: x.target.value })} aria-label="End reason">
              {ENDS.map((x) => (
                <option key={x} value={x}>
                  {x.toLowerCase()}
                </option>
              ))}
            </select>
            <label className="gov-field">
              <span>Source (exact rule / event)</span>
              <input value={ending.sourceKey} onChange={(x) => setEnding({ ...ending, sourceKey: x.target.value })} />
            </label>
            <button type="submit" className="fcard-button" disabled={submitter.busy || !ending.sourceKey.trim()}>
              Record external end
            </button>
          </form>
        ) : null}
        {state?.channel == null && spells.length ? (
          <p className="play-actions">
            <label className="gov-field">
              <span>Channel a Spell</span>
              <select value={channelSpell || spells[0]!.abilityId} onChange={(x) => setChannelSpell(x.target.value)} data-testid="play-channel-spell">
                {spells.map((s) => (
                  <option key={s.abilityId} value={s.abilityId}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="fcard-button"
              disabled={submitter.busy}
              onClick={() => {
                const s = spells.find((x) => x.abilityId === (channelSpell || spells[0]!.abilityId))!;
                void submitter.commit({ kind: "ACTIVE_MAGIC", event: "CHANNEL_START", abilityId: s.abilityId, revisionNumber: s.revisionNumber });
              }}
              data-testid="play-channel-start"
            >
              Start channeling
            </button>
          </p>
        ) : null}
      </section>
    </div>
  );
}

const NOTE_CATEGORIES = [
  { key: "GM_ADJUDICATION", label: "GM-assisted adjudication" },
  { key: "POSITION", label: "Narrative positioning" },
  { key: "GENERAL", label: "General note" },
];

export function ActivityLog({ events, submitter }: { characterId: string; events: readonly PlayEventDto[]; submitter: Submitter }) {
  const [text, setText] = useState("");
  const [category, setCategory] = useState("GM_ADJUDICATION");
  const ordered = [...events].reverse(); // chronological (the API returns newest first)
  return (
    <section className="play-panel play-log" aria-labelledby="play-log-title" data-testid="play-log">
      <h2 id="play-log-title">Activity Log</h2>
      {ordered.length === 0 ? <p className="fcard-empty">No committed gameplay yet.</p> : null}
      <ol className="play-log__list">
        {ordered.map((e) => (
          <li key={e.id} className={`play-log__item play-log__item--${e.classification.toLowerCase()}`} data-testid="play-event" data-sequence={e.sequence} data-classification={e.classification}>
            <span className="play-log__seq">#{String(e.sequence)}</span> <span className="fcard-tag">{CLASSIFICATION_LABELS[e.classification] ?? e.classification}</span> {e.summary}
            <Reasons reasons={e.record.reasons ?? []} />
          </li>
        ))}
      </ol>
      <form
        className="play-form"
        onSubmit={(x) => {
          x.preventDefault();
          if (!text.trim()) return;
          void submitter.commit({ kind: "NOTE", category, text: text.trim() }).then(() => setText(""));
        }}
      >
        <label className="gov-field">
          <span>Record a note</span>
          <select value={category} onChange={(x) => setCategory(x.target.value)} data-testid="play-note-category">
            {NOTE_CATEGORIES.map((c) => (
              <option key={c.key} value={c.key}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
        <textarea value={text} maxLength={2000} onChange={(x) => setText(x.target.value)} aria-label="Note text" data-testid="play-note-text" />
        <button type="submit" className="fcard-button" disabled={submitter.busy || !text.trim()} data-testid="play-note-submit">
          Record note (not an engine result)
        </button>
      </form>
    </section>
  );
}
