"use client";

import { COMPENDIUM_STAT_TOKENS } from "@prowess/model";
import { formatEnumLabel } from "@prowess/ui";
import { useState } from "react";
import { previewAuthoredRules, type AuthoredRulesPreviewDto, type AuthoredRulesSideDto, type AuthoredValueDto } from "../_lib/rules-client";

/**
 * RULES-WO1 — preview of authored rules for ONE sample Character: every calculated value (with each Skill benefit's
 * addition) and the Concentration rule (capacity, per-Effect upkeep and the AP still payable after assigned points).
 * Compares the published Release with an in-memory candidate that includes the saved Draft. Every number comes from the
 * server, which runs the same code as the Character sheet. Nothing is saved, published or applied to any Character, and
 * the Concentration preview never claims that combat already uses the rule.
 */
const CANON_LABEL: Record<string, string> = { CANONICAL: "Canonical", OWNER_PROVIDED: "Owner ruling", TEST_ONLY: "Test only — not canon" };
const messageOf = (e: unknown) => (e instanceof Error ? e.message : "The preview could not be calculated.");

export function canonBadge(status: string) {
  return (
    <span className={`gov-tag prowess-canon prowess-canon--${status.toLowerCase()}`} data-testid="canon-badge" data-canon={status}>
      {CANON_LABEL[status] ?? formatEnumLabel(status)}
    </span>
  );
}

function valueText(v: AuthoredValueDto): string {
  if (v.total === null) return `Unavailable — ${v.unavailable ?? "not available"}`;
  const unit = v.unit ? ` ${v.unit}` : "";
  return v.baseStated ? `${v.total}${unit}` : `+${v.total}${unit} from bonuses (base not stated in the rulebook)`;
}

function ValuesTable({ side, caption }: { side: AuthoredRulesSideDto; caption: string }) {
  if (side.values.length === 0) return <p className="gov-muted">{caption}: no calculated values.</p>;
  return (
    <table className="gov-table" data-testid="authored-values">
      <caption>{caption}</caption>
      <thead>
        <tr>
          <th scope="col">Value</th>
          <th scope="col">Result</th>
          <th scope="col">From bonuses</th>
          <th scope="col">Status</th>
        </tr>
      </thead>
      <tbody>
        {side.values.map((v) => (
          <tr key={v.valueKey} data-testid={`authored-value-${v.valueKey}`}>
            <th scope="row">{v.displayName ?? formatEnumLabel(v.valueKey)}</th>
            <td data-testid="authored-value-result">{valueText(v)}</td>
            <td>
              {v.contributions.length === 0
                ? "—"
                : v.contributions.map((c) => (
                    <span key={`${c.benefitKey}.${c.contributionKey}`} className="prowess-contribution">
                      {formatEnumLabel(c.benefitKey)} ({formatEnumLabel(c.minimumRankKey)}+): {c.applies ? (c.amount === null ? "could not be evaluated" : `+${c.amount}`) : "not at this rank"}
                      <br />
                    </span>
                  ))}
            </td>
            <td>{canonBadge(v.canonStatus)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ConcentrationTable({ side }: { side: AuthoredRulesSideDto }) {
  return (
    <>
      {side.concentration.map((c) => (
        <section key={c.canonicalKey} className="gov-card gov-card--compact" data-testid="concentration-preview">
          <h3>{c.displayName ?? "Concentration"}</h3>
          <p className="gov-bad" role="note" data-testid="concentration-not-in-play">
            Preview only — combat does not use this rule yet.
          </p>
          <p>
            Concentration points: <strong data-testid="concentration-capacity">{c.preview.capacity ?? "unavailable"}</strong> · assigned {c.preview.assignedPoints} · free {c.preview.freePoints ?? "—"}
          </p>
          {c.preview.effects.length > 0 ? (
            <table className="gov-table">
              <thead>
                <tr>
                  <th scope="col">Sustained Spell</th>
                  <th scope="col">Cast AP</th>
                  <th scope="col">Upkeep AP</th>
                  <th scope="col">Points assigned</th>
                  <th scope="col">AP covered</th>
                  <th scope="col">AP still paid</th>
                </tr>
              </thead>
              <tbody>
                {c.preview.effects.map((e, i) => (
                  <tr key={i} data-testid="concentration-effect">
                    <th scope="row">{e.label}</th>
                    <td>{e.castAp}</td>
                    <td data-testid="concentration-upkeep">{e.upkeepAp ?? "—"}</td>
                    <td>{e.assignedPoints}</td>
                    <td>{e.coveredAp ?? "—"}</td>
                    <td data-testid="concentration-payable">{e.payableAp ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
          <p className="gov-muted">
            {c.preview.mpUpkeepStillPaid ? "MP upkeep is still paid. " : "This rule waives MP upkeep. "}
            {c.preview.manaLockStillApplies ? "Mana Lock still applies." : "This rule waives Mana Lock."}
          </p>
          {c.preview.issues.length > 0 ? (
            <ul className="gov-bad" data-testid="concentration-issues">
              {c.preview.issues.map((i) => (
                <li key={i.message}>{i.message}</li>
              ))}
            </ul>
          ) : null}
          {c.preview.openQuestions.length > 0 ? (
            <details>
              <summary>Open questions this rule does not decide ({c.preview.openQuestions.length})</summary>
              <ul>
                {c.preview.openQuestions.map((q) => (
                  <li key={q}>{q}</li>
                ))}
              </ul>
            </details>
          ) : null}
        </section>
      ))}
    </>
  );
}

export function AuthoredRulePreviewPanel({ releaseId, drafts, unsavedChanges = false, focusStat }: { releaseId: string; drafts: readonly string[]; unsavedChanges?: boolean; focusStat?: string }) {
  const [level, setLevel] = useState(1);
  const [stats, setStats] = useState<Record<string, number>>(() => Object.fromEntries(COMPENDIUM_STAT_TOKENS.map((s) => [s, s === focusStat ? 6 : 3])));
  const [skillRanks, setSkillRanks] = useState<Record<string, string>>({});
  const [effects, setEffects] = useState([{ label: "Sustained Spell", castAp: 5, assignedPoints: 1 }]);
  const [result, setResult] = useState<AuthoredRulesPreviewDto | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true);
    setError("");
    try {
      setResult(
        await previewAuthoredRules({
          releaseId,
          drafts: [...drafts],
          sample: { level, stats, skillRanks: Object.entries(skillRanks).filter(([, r]) => r !== "").map(([skillEntityId, rankKey]) => ({ skillEntityId, rankKey })), effects },
        }),
      );
    } catch (e) {
      setResult(null);
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  }
  const int = (v: string) => (Number.isFinite(Number(v)) ? Math.max(0, Math.trunc(Number(v))) : 0);
  const skills = result === null ? [] : [...result.candidate.skills, ...result.published.skills.filter((s) => !result.candidate.skills.some((c) => c.entityId === s.entityId))];
  const ranks = result?.candidate.ranks.length ? result.candidate.ranks : (result?.published.ranks ?? []);
  const hasConcentration = result !== null && (result.candidate.concentration.length > 0 || result.published.concentration.length > 0);

  return (
    <section className="gov-card prowess-rule-preview" aria-label="Preview this rule" data-testid="authored-rule-preview">
      <h2>Preview this rule for a sample Character</h2>
      <p className="gov-muted">
        Compares this Release with the same Release including {drafts.length === 1 ? "the saved Draft" : `${drafts.length} saved Drafts`}. Nothing is saved or published, and no Character changes.
      </p>
      {unsavedChanges ? (
        <p className="gov-bad" role="note">
          You have unsaved edits. The preview uses the last saved Draft — save first to include them.
        </p>
      ) : null}
      <fieldset className="prowess-authoring__nested">
        <legend>Sample Character</legend>
        <label className="gov-field">
          <span>Level</span>
          <input type="number" min={1} value={level} onChange={(e) => setLevel(Math.max(1, int(e.target.value)))} />
        </label>
        {COMPENDIUM_STAT_TOKENS.map((s) => (
          <label key={s} className="gov-field">
            <span>{s}</span>
            <input aria-label={`Sample ${s}`} type="number" min={0} value={stats[s] ?? 0} onChange={(e) => setStats((x) => ({ ...x, [s]: int(e.target.value) }))} />
          </label>
        ))}
        {skills.map((sk) => (
          <label key={sk.entityId} className="gov-field">
            <span>{sk.displayName ?? sk.canonicalKey} rank</span>
            <select aria-label={`Sample ${sk.displayName ?? sk.canonicalKey} rank`} value={skillRanks[sk.entityId] ?? ""} onChange={(e) => setSkillRanks((x) => ({ ...x, [sk.entityId]: e.target.value }))}>
              <option value="">Untrained</option>
              {ranks.slice(1).map((r) => (
                <option key={r} value={r}>
                  {formatEnumLabel(r)}
                </option>
              ))}
            </select>
          </label>
        ))}
      </fieldset>
      {hasConcentration || drafts.length > 0 ? (
        <fieldset className="prowess-authoring__nested">
          <legend>Sustained Spells (for the Concentration rule)</legend>
          {effects.map((e, i) => (
            <div key={i} className="prowess-authoring__row">
              <label className="gov-field">
                <span>Cast AP</span>
                <input aria-label={`Effect ${i + 1} cast AP`} type="number" min={0} value={e.castAp} onChange={(ev) => setEffects((xs) => xs.map((x, j) => (j === i ? { ...x, castAp: int(ev.target.value) } : x)))} />
              </label>
              <label className="gov-field">
                <span>Concentration points assigned</span>
                <input aria-label={`Effect ${i + 1} points`} type="number" min={0} value={e.assignedPoints} onChange={(ev) => setEffects((xs) => xs.map((x, j) => (j === i ? { ...x, assignedPoints: int(ev.target.value) } : x)))} />
              </label>
              <button type="button" className="gov-link-button" onClick={() => setEffects((xs) => xs.filter((_, j) => j !== i))}>
                Remove Spell {i + 1}
              </button>
            </div>
          ))}
          <button type="button" className="gov-link-button" onClick={() => setEffects((xs) => [...xs, { label: `Sustained Spell ${xs.length + 1}`, castAp: 2, assignedPoints: 0 }])}>
            Add a Sustained Spell
          </button>
        </fieldset>
      ) : null}
      <button type="button" className="gov-button" onClick={() => void run()} disabled={busy} data-testid="authored-preview-run">
        {busy ? "Calculating…" : "Calculate"}
      </button>
      {error !== "" ? (
        <p className="gov-bad" role="alert">
          {error}
        </p>
      ) : null}
      {result !== null ? (
        <div data-testid="authored-preview-result">
          <ValuesTable side={result.candidate} caption="With this Draft" />
          <ValuesTable side={result.published} caption="Published Release" />
          <ConcentrationTable side={result.candidate} />
          {result.candidate.problems.length > 0 ? (
            <ul className="gov-bad" data-testid="authored-preview-problems">
              {result.candidate.problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
