"use client";

import { useState } from "react";
import type { PlayActionDto, PlayAttackDto, PlayManeuverDto, PlayOutcomeDto, PlayPendingDto, PlaySpellDto, PlayViewDto } from "../../_lib/play-types";
import { rollFaces } from "./play-dice";
import { AVAILABILITY_LABELS, CLASSIFICATION_LABELS, Reasons, STATUS_LABELS, type Submitter } from "./PlayWorkspace";

/**
 * The Action Detail / Resolution panel (PAS-10 M6-WO10 §4, §12). It shows the selected entry's server-evaluated context,
 * collects only choices, targets and RAW roll results (from physical dice, the GM, or the optional digital roller), and
 * submits them for a server preview or commit. Pending requests are the engine's own; every result shown — hit / miss,
 * Save, Effect success, outcome — is the server's, and outcomes are always labelled NOT APPLIED.
 */
export type Selection =
  | { readonly kind: "GENERAL_ACTION"; readonly action: PlayActionDto }
  | { readonly kind: "WEAPON_ATTACK"; readonly attack: PlayAttackDto }
  | { readonly kind: "SPELL"; readonly spell: PlaySpellDto }
  | { readonly kind: "MANEUVER"; readonly maneuver: PlayManeuverDto }
  | { readonly kind: "MOVEMENT" };

export interface RollDraft {
  readonly mode: "NORMAL" | "ADVANTAGE" | "DISADVANTAGE";
  readonly rolls: readonly string[];
  readonly source: "PHYSICAL" | "DIGITAL" | "GM";
}
export const emptyRoll = (): RollDraft => ({ mode: "NORMAL", rolls: [""], source: "PHYSICAL" });
const diceFor = (mode: RollDraft["mode"]) => (mode === "NORMAL" ? 1 : 2);
/** The submitted roll: raw faces and their source, or null while incomplete. Never a total or a success claim. */
export function rollOperand(r: RollDraft): { mode: string; rolls: number[]; source: string } | null {
  if (r.rolls.length !== diceFor(r.mode) || !r.rolls.every((x) => /^\d{1,4}$/.test(x))) return null;
  return { mode: r.mode, rolls: r.rolls.map(Number), source: r.source };
}

export function RollInput({ roll, onChange, faces, dieKey, testid }: { roll: RollDraft; onChange: (r: RollDraft) => void; faces: number | null; dieKey: string | null; testid: string }) {
  return (
    <fieldset className="play-roll" data-testid={testid}>
      <legend>Roll{dieKey ? ` (${dieKey})` : ""}</legend>
      <label className="gov-field">
        <span>Mode</span>
        <select value={roll.mode} onChange={(e) => onChange({ ...roll, mode: e.target.value as RollDraft["mode"], rolls: Array.from({ length: diceFor(e.target.value as RollDraft["mode"]) }, (_, i) => roll.rolls[i] ?? "") })} data-testid={`${testid}-mode`}>
          <option value="NORMAL">Normal</option>
          <option value="ADVANTAGE">Advantage</option>
          <option value="DISADVANTAGE">Disadvantage</option>
        </select>
      </label>
      {roll.rolls.map((v, i) => (
        <label key={i} className="gov-field">
          <span>Die {String(i + 1)} face</span>
          <input inputMode="numeric" value={v} onChange={(e) => onChange({ ...roll, rolls: roll.rolls.map((x, j) => (j === i ? e.target.value : x)), source: roll.source === "DIGITAL" ? "PHYSICAL" : roll.source })} data-testid={`${testid}-face-${String(i)}`} />
        </label>
      ))}
      <label className="gov-field">
        <span>Source</span>
        <select value={roll.source} onChange={(e) => onChange({ ...roll, source: e.target.value as RollDraft["source"] })} data-testid={`${testid}-source`}>
          <option value="PHYSICAL">Physical dice</option>
          <option value="GM">GM provided</option>
          <option value="DIGITAL">Digital roller</option>
        </select>
      </label>
      {faces !== null ? (
        <button type="button" className="fcard-button" onClick={() => onChange({ ...roll, rolls: rollFaces(faces, diceFor(roll.mode)).map(String), source: "DIGITAL" })} data-testid={`${testid}-digital`}>
          Roll digitally
        </button>
      ) : null}
    </fieldset>
  );
}

/** The defender Stats a Saving Throw request needs — named by the server (the Release vocabulary), never by Studio. */
const statsOf = (q: PlayPendingDto): readonly string[] => q.defenderStats ?? [];
interface Answer {
  roll: RollDraft;
  targetDodge: string;
  defenderLevel: string;
  defenderStats: Record<string, string>;
  difficultyClass: string;
  stat: string;
}
const emptyAnswer = (): Answer => ({ roll: emptyRoll(), targetDodge: "", defenderLevel: "", defenderStats: {}, difficultyClass: "", stat: "" });
const num = (s: string) => (/^\d{1,4}$/.test(s) ? Number(s) : null);

function answerOf(q: PlayPendingDto, a: Answer): Record<string, unknown> | null {
  if (q.kind === "ATTACK_ROLL") {
    const roll = rollOperand(a.roll), dodge = num(a.targetDodge);
    return roll === null || dodge === null ? null : { requestKey: q.requestKey, kind: "ATTACK_ROLL", roll, targetDodge: dodge };
  }
  if (q.kind === "SAVING_THROW") {
    const roll = rollOperand(a.roll), level = num(a.defenderLevel);
    const keys = statsOf(q);
    const stats = Object.fromEntries(keys.map((s) => [s, num(a.defenderStats[s] ?? "")]));
    if (roll === null || level === null || keys.length === 0 || keys.some((s) => stats[s] === null)) return null;
    const dc = a.difficultyClass.trim() === "" ? null : num(a.difficultyClass);
    return { requestKey: q.requestKey, kind: "SAVING_THROW", roll, defender: { level, stats }, ...(dc === null ? {} : { difficultyClass: dc }) };
  }
  if (q.kind === "SAVE_REMOVAL" || q.kind === "SAVE_SELECTION") return a.stat ? { requestKey: q.requestKey, kind: q.kind, stat: a.stat } : null;
  return null;
}

function PendingInput({ q, answer, onChange, die }: { q: PlayPendingDto; answer: Answer; onChange: (a: Answer) => void; die: { dieKey: string; faces: number } }) {
  const id = `play-pending-${(q.requestKey ?? q.kind).replace(/[^A-Za-z0-9]/g, "_")}`;
  return (
    <fieldset className="play-pending" data-testid="play-pending" data-kind={q.kind} data-request={q.requestKey}>
      <legend>
        {q.kind.replace(/_/g, " ").toLowerCase()} {q.targetKey ? `— target ${q.targetKey}` : ""} {q.scope ? <span className="fcard-muted">({q.scope})</span> : null} · rolled by {q.by === "DEFENDER" ? "the defender (GM)" : "this Character"}
      </legend>
      {q.kind === "ATTACK_ROLL" ? (
        <>
          <RollInput roll={answer.roll} onChange={(roll) => onChange({ ...answer, roll })} faces={die.faces} dieKey={die.dieKey} testid={`${id}-roll`} />
          <label className="gov-field">
            <span>Target Dodge (GM provided)</span>
            <input inputMode="numeric" value={answer.targetDodge} onChange={(e) => onChange({ ...answer, targetDodge: e.target.value })} data-testid={`${id}-dodge`} />
          </label>
        </>
      ) : null}
      {q.kind === "SAVING_THROW" ? (
        <>
          <p className="fcard-muted">Describe the defender as the GM states it (player / GM provided — not validated against a canonical creature).</p>
          <label className="gov-field">
            <span>Defender Level</span>
            <input inputMode="numeric" value={answer.defenderLevel} onChange={(e) => onChange({ ...answer, defenderLevel: e.target.value })} data-testid={`${id}-level`} />
          </label>
          {statsOf(q).map((s) => (
            <label key={s} className="gov-field play-stat">
              <span>{s}</span>
              <input inputMode="numeric" value={answer.defenderStats[s] ?? ""} onChange={(e) => onChange({ ...answer, defenderStats: { ...answer.defenderStats, [s]: e.target.value } })} data-testid={`${id}-stat-${s}`} />
            </label>
          ))}
          <label className="gov-field">
            <span>Difficulty Class (blank: this Character&apos;s DC{q.defaultDifficultyClass == null ? "" : ` ${String(q.defaultDifficultyClass)}`})</span>
            <input inputMode="numeric" value={answer.difficultyClass} onChange={(e) => onChange({ ...answer, difficultyClass: e.target.value })} data-testid={`${id}-dc`} />
          </label>
          <RollInput roll={answer.roll} onChange={(roll) => onChange({ ...answer, roll })} faces={null} dieKey={null} testid={`${id}-roll`} />
        </>
      ) : null}
      {q.kind === "SAVE_REMOVAL" || q.kind === "SAVE_SELECTION" ? (
        <label className="gov-field">
          <span>{q.kind === "SAVE_REMOVAL" ? "Save the attacker removes" : "Save the defender uses"}</span>
          <select value={answer.stat} onChange={(e) => onChange({ ...answer, stat: e.target.value })} data-testid={`${id}-stat`}>
            <option value="">Choose…</option>
            {(q.options ?? []).map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        </label>
      ) : null}
    </fieldset>
  );
}

export function ActionDetailPanel({ view, selection, submitter, result, onCard }: { view: PlayViewDto; selection: Selection; submitter: Submitter; result: { outcome: PlayOutcomeDto; committed: boolean; replayed: boolean } | null; onCard: (key: string) => void }) {
  const w = view.workspace;
  const die = w.header.characterDie;
  const [chosenCost, setChosenCost] = useState("");
  const [trigger, setTrigger] = useState({ triggerKey: "", description: "" });
  const [profile, setProfile] = useState(selection.kind === "WEAPON_ATTACK" ? (selection.attack.damage[0]?.profileKey ?? "") : "");
  const [attackRoll, setAttackRoll] = useState<RollDraft>(emptyRoll());
  const [dodge, setDodge] = useState("");
  const [targets, setTargets] = useState<string[]>(["target1"]);
  const [groupTargets, setGroupTargets] = useState<Record<string, string[]>>({});
  const [answers, setAnswers] = useState<Record<string, Answer>>({});
  const [segments, setSegments] = useState<{ distance: string; terrainKey: string }[]>([{ distance: "", terrainKey: w.terrains[0]?.terrainKey ?? "NORMAL" }]);

  const pending = result !== null && result.outcome.status === "PENDING_INPUT" ? result.outcome.pending : [];
  const answerFor = (q: PlayPendingDto) => answers[q.requestKey ?? q.kind] ?? emptyAnswer();
  const inputs = pending.flatMap((q) => {
    const a = answerOf(q, answerFor(q));
    return a === null ? [] : [a];
  });
  const prior = (result?.outcome.operation.inputs as Record<string, unknown>[] | undefined) ?? [];

  const operation = (): Record<string, unknown> | null => {
    switch (selection.kind) {
      case "GENERAL_ACTION":
        return { kind: "GENERAL_ACTION", actionKey: selection.action.actionKey, ...(chosenCost ? { chosenCost: Number(chosenCost) } : {}), ...(selection.action.requiresTrigger && trigger.triggerKey ? { trigger } : {}) };
      case "WEAPON_ATTACK": {
        const roll = rollOperand(attackRoll), d = num(dodge);
        return { kind: "WEAPON_ATTACK", attackKey: selection.attack.attackKey, hand: selection.attack.hand, damageProfileKey: profile, ...(roll === null || d === null ? {} : { roll, targetDodge: d }) };
      }
      case "SPELL":
        return { kind: "SPELL", abilityId: selection.spell.abilityId, revisionNumber: selection.spell.revisionNumber, targets: targets.map((targetKey) => ({ targetKey })), inputs: [...prior.filter((p) => !inputs.some((i) => i.requestKey === p.requestKey)), ...inputs] };
      case "MANEUVER":
        return {
          kind: "MANEUVER",
          abilityId: selection.maneuver.abilityId,
          revisionNumber: selection.maneuver.revisionNumber,
          targets: targets.map((targetKey) => ({ targetKey })),
          groupTargets: selection.maneuver.groups.map((g) => ({ groupKey: g.groupKey, targetKeys: groupTargets[g.groupKey] ?? targets.slice(0, 1) })),
          inputs: [...prior.filter((p) => !inputs.some((i) => i.requestKey === p.requestKey)), ...inputs],
        };
      case "MOVEMENT":
        return segments.every((s) => num(s.distance) !== null) ? { kind: "MOVEMENT", segments: segments.map((s) => ({ distance: Number(s.distance), terrainKey: s.terrainKey })) } : null;
    }
  };
  const op = operation();

  const title = selection.kind === "GENERAL_ACTION" ? selection.action.name : selection.kind === "WEAPON_ATTACK" ? selection.attack.name : selection.kind === "SPELL" ? selection.spell.name : selection.kind === "MANEUVER" ? selection.maneuver.name : "Spend movement";
  const cardKey = selection.kind === "GENERAL_ACTION" ? selection.action.cardKey : selection.kind === "WEAPON_ATTACK" ? selection.attack.cardKey : selection.kind === "SPELL" ? selection.spell.cardKey : selection.kind === "MANEUVER" ? selection.maneuver.cardKey : null;

  return (
    <section className="play-panel play-resolution" aria-labelledby="play-resolution-title" data-testid="play-resolution" data-kind={selection.kind}>
      <header className="play-resolution__head">
        <h2 id="play-resolution-title">{title}</h2>
        {cardKey !== null ? (
          <button type="button" className="fcard-button" onClick={() => onCard(cardKey)} data-testid="play-resolution-card">
            Open card
          </button>
        ) : null}
      </header>

      {selection.kind === "GENERAL_ACTION" ? (
        <div>
          <dl className="play-facts">
            <div>
              <dt>Timing</dt>
              <dd>{selection.action.timing === "OWN_TURN" ? "own turn" : "outside own turn (reaction)"}</dd>
            </div>
            <div>
              <dt>AP</dt>
              <dd>{selection.action.ap.status === "AVAILABLE" ? String(selection.action.ap.value) : selection.action.ap.reason}</dd>
            </div>
            {selection.action.otherCosts.map((c) => (
              <div key={c.costKey}>
                <dt>{c.costKey.replace(/_/g, " ").toLowerCase()}</dt>
                <dd>{String(c.amount)}</dd>
              </div>
            ))}
            <div>
              <dt>Now</dt>
              <dd>{AVAILABILITY_LABELS[selection.action.availability]}</dd>
            </div>
          </dl>
          {selection.action.costModel?.model === "RANGE" || selection.action.costModel?.model === "MINIMUM" ? (
            <label className="gov-field">
              <span>Chosen AP cost ({selection.action.costModel.model === "RANGE" ? `${String(selection.action.costModel.minimum)}–${String(selection.action.costModel.maximum)}` : `at least ${String(selection.action.costModel.minimum)}`})</span>
              <input inputMode="numeric" value={chosenCost} onChange={(e) => setChosenCost(e.target.value)} data-testid="play-chosen-cost" />
            </label>
          ) : null}
          {selection.action.requiresTrigger ? (
            <fieldset className="play-roll">
              <legend>Triggering event (declared by the player; legality is the GM&apos;s call)</legend>
              <label className="gov-field">
                <span>Trigger key</span>
                <input value={trigger.triggerKey} onChange={(e) => setTrigger({ ...trigger, triggerKey: e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, "_") })} placeholder="ENEMY_ATTACKS" data-testid="play-trigger-key" />
              </label>
              <label className="gov-field">
                <span>What happened</span>
                <input value={trigger.description} maxLength={300} onChange={(e) => setTrigger({ ...trigger, description: e.target.value })} data-testid="play-trigger-description" />
              </label>
            </fieldset>
          ) : null}
          <Reasons reasons={selection.action.availability === "AVAILABLE" ? [] : selection.action.reasons} />
        </div>
      ) : null}

      {selection.kind === "WEAPON_ATTACK" ? (
        <div>
          <dl className="play-facts">
            <div>
              <dt>Weapon / hand / grip</dt>
              <dd>
                {w.names[selection.attack.weapon.entityVersionId] ?? selection.attack.weapon.canonicalKey} · {selection.attack.hand.replace(/_/g, " ").toLowerCase()} · {selection.attack.grip.replace(/_/g, " ").toLowerCase()}
              </dd>
            </div>
            <div>
              <dt>Cost (the Attack&apos;s own)</dt>
              <dd>
                {String(selection.attack.costs.ap ?? "—")} AP{selection.attack.costs.mp ? ` · ${String(selection.attack.costs.mp)} MP` : ""}
              </dd>
            </div>
            <div>
              <dt>Resolution</dt>
              <dd>{selection.attack.support.supported ? "Attack Roll vs target Dodge" : (selection.attack.support.reason ?? "not executable")}</dd>
            </div>
            <div>
              <dt>Range</dt>
              <dd>
                {selection.attack.range.mode.toLowerCase()}
                {selection.attack.range.reachFeet !== null ? ` · reach ${String(selection.attack.range.reachFeet)} ft` : ""}
                {selection.attack.range.rangeFeet !== null ? ` · ${String(selection.attack.range.rangeFeet)} ft` : ""}
              </dd>
            </div>
            {selection.attack.notExecuted.length ? (
              <div>
                <dt>Reference only</dt>
                <dd>{selection.attack.notExecuted.join(", ")}</dd>
              </div>
            ) : null}
          </dl>
          <label className="gov-field">
            <span>Damage profile (chosen — never auto-selected)</span>
            <select value={profile} onChange={(e) => setProfile(e.target.value)} data-testid="play-damage-profile">
              {selection.attack.damage.map((d) => (
                <option key={d.profileKey} value={d.profileKey}>
                  {d.damageType.toLowerCase()} {d.final?.expression ?? ""} {d.status === "FAIL_CLOSED" ? `(unavailable: ${d.reason ?? ""})` : ""}
                </option>
              ))}
            </select>
          </label>
          {selection.attack.support.supported ? (
            <>
              <RollInput roll={attackRoll} onChange={setAttackRoll} faces={die.faces} dieKey={die.dieKey} testid="play-attack-roll" />
              <label className="gov-field">
                <span>Target Dodge (GM provided)</span>
                <input inputMode="numeric" value={dodge} onChange={(e) => setDodge(e.target.value)} data-testid="play-attack-dodge" />
              </label>
            </>
          ) : (
            <p className="play-alert">This Attack cannot be resolved by an existing structured rule. Use its card as a reference and record the GM&apos;s ruling as a note.</p>
          )}
          <Reasons reasons={selection.attack.availability === "AVAILABLE" ? [] : selection.attack.reasons} />
        </div>
      ) : null}

      {selection.kind === "SPELL" || selection.kind === "MANEUVER" ? (
        <div>
          <AbilityFacts selection={selection} names={w.names} />
          <fieldset className="play-roll">
            <legend>Targets (labels only — target state is never changed)</legend>
            {targets.map((t, i) => (
              <label key={i} className="gov-field">
                <span>Target {String(i + 1)}</span>
                <input value={t} onChange={(e) => setTargets(targets.map((x, j) => (j === i ? e.target.value.replace(/[^A-Za-z0-9_-]/g, "_") : x)))} data-testid={`play-target-${String(i)}`} />
              </label>
            ))}
            <button type="button" className="gov-link-button" onClick={() => setTargets([...targets, `target${String(targets.length + 1)}`])} data-testid="play-target-add">
              Add target
            </button>
            {targets.length > 1 ? (
              <button type="button" className="gov-link-button" onClick={() => setTargets(targets.slice(0, -1))}>
                Remove last
              </button>
            ) : null}
          </fieldset>
          {selection.kind === "MANEUVER"
            ? selection.maneuver.groups.map((g) => (
                <fieldset key={g.groupKey} className="play-roll" data-testid="play-group">
                  <legend>
                    Group {g.groupKey} ({g.kind.replace(/_/g, " ").toLowerCase()}, {g.resolution.mode.replace(/_/g, " ").toLowerCase()})
                  </legend>
                  {targets.map((t) => (
                    <label key={t} className="play-inline">
                      <input
                        type="checkbox"
                        checked={(groupTargets[g.groupKey] ?? targets.slice(0, 1)).includes(t)}
                        onChange={(e) => {
                          const cur = groupTargets[g.groupKey] ?? targets.slice(0, 1);
                          setGroupTargets({ ...groupTargets, [g.groupKey]: e.target.checked ? [...cur, t] : cur.filter((x) => x !== t) });
                        }}
                        data-testid={`play-group-${g.groupKey}-${t}`}
                      />{" "}
                      {t}
                    </label>
                  ))}
                </fieldset>
              ))
            : null}
        </div>
      ) : null}

      {selection.kind === "MOVEMENT" ? (
        <div>
          {segments.map((s, i) => (
            <fieldset key={i} className="play-roll" data-testid="play-segment">
              <legend>Segment {String(i + 1)}</legend>
              <label className="gov-field">
                <span>Distance (ft)</span>
                <input inputMode="numeric" value={s.distance} onChange={(e) => setSegments(segments.map((x, j) => (j === i ? { ...x, distance: e.target.value } : x)))} data-testid={`play-segment-${String(i)}-distance`} />
              </label>
              <label className="gov-field">
                <span>Terrain</span>
                <select value={s.terrainKey} onChange={(e) => setSegments(segments.map((x, j) => (j === i ? { ...x, terrainKey: e.target.value } : x)))} data-testid={`play-segment-${String(i)}-terrain`}>
                  {w.terrains.map((t) => (
                    <option key={t.terrainKey} value={t.terrainKey}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </label>
            </fieldset>
          ))}
          <button type="button" className="gov-link-button" onClick={() => setSegments([...segments, { distance: "", terrainKey: w.terrains[0]?.terrainKey ?? "NORMAL" }])} data-testid="play-segment-add">
            Add segment
          </button>
          <p className="fcard-muted">Each segment&apos;s allowance cost is evaluated by the server from its terrain.</p>
        </div>
      ) : null}

      {pending.length ? (
        <div className="play-pending-list" data-testid="play-pending-list">
          <h3>Inputs the engine needs</h3>
          {pending.map((q, i) =>
            q.kind === "COST_CHOICE" ? null : <PendingInput key={q.requestKey ?? i} q={q} answer={answerFor(q)} onChange={(a) => setAnswers({ ...answers, [q.requestKey ?? q.kind]: a })} die={die} />,
          )}
        </div>
      ) : null}

      <p className="play-actions">
        <button type="button" className="fcard-button" disabled={submitter.busy || op === null} onClick={() => op && void submitter.preview(op)} data-testid="play-preview">
          Preview (no change)
        </button>
        <button type="button" className="fcard-button fcard-button--primary" disabled={submitter.busy || op === null} onClick={() => op && void submitter.commit(op)} data-testid="play-commit">
          Commit
        </button>
      </p>
      {result !== null ? <OutcomeView result={result} /> : null}
    </section>
  );
}

function AbilityFacts({ selection, names }: { selection: Extract<Selection, { kind: "SPELL" | "MANEUVER" }>; names: Readonly<Record<string, string>> }) {
  const x = selection.kind === "SPELL" ? selection.spell : selection.maneuver;
  return (
    <dl className="play-facts">
      <div>
        <dt>Revision</dt>
        <dd>
          r{String(x.revisionNumber)} · {x.state.replace(/_/g, " ").toLowerCase()}
        </dd>
      </div>
      <div>
        <dt>Cost (evaluated)</dt>
        <dd>{x.costs === null ? "unavailable" : `${String(x.costs.finalApCost)} AP · ${String(x.costs.finalMpCost)} MP${selection.kind === "SPELL" ? " (ME pays first)" : ""}`}</dd>
      </div>
      {selection.kind === "SPELL" ? (
        <>
          <div>
            <dt>Effects</dt>
            <dd>{selection.spell.chain === null ? "—" : selection.spell.chain.nodes.map((n) => `${names[n.definition.entityVersionId] ?? n.definition.canonicalKey} (${n.resolution.replace(/_/g, " ").toLowerCase()}, ${n.behavior.replace(/_/g, " ").toLowerCase()})`).join(" → ")}</dd>
          </div>
          <div>
            <dt>Duration</dt>
            <dd>{selection.spell.duration === null ? "—" : `${selection.spell.duration.mode.replace(/_/g, " ").toLowerCase()}${selection.spell.duration.becomesActiveMagic ? " · becomes Active Magic" : ""}${selection.spell.duration.sustain ? " · Sustain" : ""}${selection.spell.duration.concentration === "WO13" ? " · Concentration" : ""}`}</dd>
          </div>
          <div>
            <dt>Targets</dt>
            <dd>{selection.spell.targetLimit === null ? "—" : `${selection.spell.targetLimit.kind.replace(/_/g, " ").toLowerCase()}${selection.spell.targetLimit.maximum === null ? "" : ` (up to ${String(selection.spell.targetLimit.maximum)})`}`}</dd>
          </div>
        </>
      ) : (
        <>
          <div>
            <dt>Resolution groups</dt>
            <dd>{selection.maneuver.groups.map((g) => `${g.groupKey}: ${g.resolution.mode.replace(/_/g, " ").toLowerCase()}${g.effects.length ? ` + ${g.effects.map((e) => names[e.definition.entityVersionId] ?? e.definition.canonicalKey).join(", ")}` : ""}`).join(" · ")}</dd>
          </div>
          {selection.maneuver.separatelyPriced.length ? (
            <div>
              <dt>Prepared separately</dt>
              <dd>{selection.maneuver.separatelyPriced.map((s) => `${names[s.condition.entityVersionId] ?? s.condition.canonicalKey}: ${String(s.preparationAp)} AP (not included)`).join("; ")}</dd>
            </div>
          ) : null}
        </>
      )}
      <div>
        <dt>Now</dt>
        <dd>{AVAILABILITY_LABELS[x.availability]}</dd>
      </div>
    </dl>
  );
}

function OutcomeView({ result }: { result: { outcome: PlayOutcomeDto; committed: boolean; replayed: boolean } }) {
  const o = result.outcome;
  const resolution = o.trace.resolution as { outcomes?: { targetKey: string; effectKey: string; result: string; outcomeKey: string; operations: { kind: string }[]; applied: boolean }[]; hit?: boolean; total?: number | null; natural?: number | null; criticalHit?: boolean | null; groups?: { groupKey: string; targets: { targetKey: string; resolution: { result: string | null } }[] }[] } | undefined;
  const outcome = o.trace.outcome as { kind: string; profile?: { damageType: string; final: { expression?: string } | null }; onMiss?: string | null } | undefined;
  const changed = o.resourcesAfter?.filter((a) => o.resourcesBefore.find((b) => b.resourceKey === a.resourceKey)?.current !== a.current) ?? [];
  return (
    <div className="play-result" aria-live="polite" data-testid="play-result" data-status={o.status} data-committed={String(result.committed)}>
      <h3>
        {result.committed ? `Committed${result.replayed ? " (already recorded)" : ""}` : (STATUS_LABELS[o.status] ?? o.status)}
        {o.classification ? <span className="fcard-tag"> {CLASSIFICATION_LABELS[o.classification] ?? o.classification}</span> : null}
      </h3>
      <p data-testid="play-result-summary">{o.summary}</p>
      <Reasons reasons={o.reasons} />
      {!result.committed && o.status === "COMMITTABLE" ? <p className="fcard-muted">Preview only — nothing has been spent or recorded.</p> : null}
      {changed.length ? (
        <p data-testid="play-result-resources">
          {result.committed ? "Spent / changed: " : "Would change: "}
          {changed.map((a) => `${a.resourceKey} ${String(o.resourcesBefore.find((b) => b.resourceKey === a.resourceKey)?.current)} → ${String(a.current)}`).join(", ")}
        </p>
      ) : null}
      {resolution?.hit !== undefined ? (
        <p data-testid="play-result-check">
          Attack Roll: {resolution.hit ? "hit" : "miss"} (natural {String(resolution.natural)}, total {String(resolution.total)}){resolution.criticalHit ? " — critical" : ""}
        </p>
      ) : null}
      {outcome ? (
        <p data-testid="play-result-outcome">
          {outcome.kind === "DAMAGE_PROFILE" ? `Damage authorised: ${outcome.profile?.final?.expression ?? "—"} ${outcome.profile?.damageType.toLowerCase() ?? ""} — NOT APPLIED (roll and apply with the GM).` : `Miss: ${outcome.onMiss ?? "no effect"} — not applied.`}
        </p>
      ) : null}
      {resolution?.groups ? (
        <ul data-testid="play-result-groups">
          {resolution.groups.map((g) => (
            <li key={g.groupKey}>
              {g.groupKey}: {g.targets.map((t) => `${t.targetKey} ${t.resolution.result === null ? "pending" : t.resolution.result === "SUCCESS" ? "check succeeded" : "check failed"}`).join(", ")}
            </li>
          ))}
        </ul>
      ) : null}
      {resolution?.outcomes?.length ? (
        <ul data-testid="play-result-outcomes">
          {resolution.outcomes.map((x, i) => (
            <li key={i} data-result={x.result}>
              {x.targetKey} · {x.effectKey}: Effect {x.result === "SUCCESS" ? "succeeded" : "failed"} → {x.operations.map((op) => op.kind.replace(/_/g, " ").toLowerCase()).join(", ") || "no operation"} <strong>(not applied)</strong>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
