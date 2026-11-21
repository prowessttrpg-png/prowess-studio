"use client";

import { COMPENDIUM_STAT_TOKENS } from "@prowess/model";
import { useState } from "react";
import { previewReference, type ReferencePreviewDto } from "../_lib/rules-client";
import { asToken } from "../_lib/token-input";

/**
 * RULES-WO1 Phase C — preview of a SAVED Armor, Summon engine or Mission rule for sample inputs. All numbers come from
 * the server (the M5 / M4 code of the contract). The panel always says that the rule is not used in play yet.
 */
const words = (v: unknown) => (typeof v === "string" ? v.charAt(0) + v.slice(1).toLowerCase().replace(/_/g, " ") : "—");
const messageOf = (e: unknown) => (e instanceof Error ? e.message : "The preview could not be calculated.");

export function ReferencePreviewPanel({ entityVersionId, sample, unsavedChanges }: { entityVersionId: string; sample: "SHEET" | "TIERED_SHEET" | "ROLL_OR_CLOCK" | "AT_LEVEL" | "SAMPLE_WEAPON"; unsavedChanges: boolean }) {
  const [stats, setStats] = useState<Record<string, number>>(() => Object.fromEntries(COMPENDIUM_STAT_TOKENS.map((s) => [s, 4])));
  const [tierKey, setTierKey] = useState("");
  const [roll, setRoll] = useState(1);
  const [filled, setFilled] = useState(2);
  const [level, setLevel] = useState(1);
  const [loading, setLoading] = useState(12);
  const [reloadAp, setReloadAp] = useState(3);
  const [apPerTurn, setApPerTurn] = useState(3);
  const [result, setResult] = useState<ReferencePreviewDto | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const int = (v: string) => (Number.isFinite(Number(v)) ? Math.max(0, Math.trunc(Number(v))) : 0);

  async function run() {
    setBusy(true);
    setError("");
    try {
      setResult(await previewReference({ entityVersionId, sample: { stats, ...(tierKey !== "" ? { tierKey } : {}), roll, filled, level, loading, reloadAp, apPerTurn } }));
    } catch (e) {
      setResult(null);
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  }
  const r = result?.result ?? null;
  const show = (v: unknown) => (v === null || v === undefined ? "—" : typeof v === "boolean" ? (v ? "yes" : "no") : Array.isArray(v) ? (v.length === 0 ? "none" : v.join("; ")) : String(v));

  return (
    <section className="gov-card prowess-rule-preview" aria-label="Preview with sample inputs" data-testid="reference-preview">
      <h2>Preview with sample inputs</h2>
      <p className="gov-bad" role="note" data-testid="reference-not-in-play">
        Preview only — play does not use this rule yet.
      </p>
      {unsavedChanges ? <p className="gov-bad">You have unsaved edits. The preview uses the last saved Draft.</p> : null}
      {sample === "SAMPLE_WEAPON" ? (
        <fieldset className="prowess-authoring__nested">
          <legend>Sample weapon</legend>
          <label className="gov-field">
            <span>Loading (attacks per load)</span>
            <input aria-label="Sample Loading" type="number" min={0} value={loading} onChange={(e) => setLoading(int(e.target.value))} />
          </label>
          <label className="gov-field">
            <span>Reload AP</span>
            <input aria-label="Sample Reload AP" type="number" min={0} value={reloadAp} onChange={(e) => setReloadAp(int(e.target.value))} />
          </label>
          <label className="gov-field">
            <span>AP each turn</span>
            <input aria-label="Sample AP each turn" type="number" min={1} value={apPerTurn} onChange={(e) => setApPerTurn(Math.max(1, int(e.target.value)))} />
          </label>
        </fieldset>
      ) : null}
      {sample === "AT_LEVEL" ? (
        <label className="gov-field">
          <span>Level</span>
          <input aria-label="Sample Level" type="number" min={1} value={level} onChange={(e) => setLevel(Math.max(1, int(e.target.value)))} />
        </label>
      ) : null}
      {sample === "SAMPLE_WEAPON" ? null : sample !== "ROLL_OR_CLOCK" ? (
        <fieldset className="prowess-authoring__nested">
          <legend>Sample Character</legend>
          {COMPENDIUM_STAT_TOKENS.map((s) => (
            <label key={s} className="gov-field">
              <span>{s}</span>
              <input aria-label={`Sample ${s}`} type="number" min={0} value={stats[s] ?? 0} onChange={(e) => setStats((x) => ({ ...x, [s]: int(e.target.value) }))} />
            </label>
          ))}
          {sample === "TIERED_SHEET" ? (
            <label className="gov-field">
              <span>Tier name</span>
              <input aria-label="Sample tier" value={tierKey} onChange={(e) => setTierKey(asToken(e.target.value))} onBlur={(e) => setTierKey(asToken(e.target.value, true))} placeholder="TIER_1" />
            </label>
          ) : null}
        </fieldset>
      ) : (
        <fieldset className="prowess-authoring__nested">
          <legend>Sample</legend>
          <label className="gov-field">
            <span>Roll (for a table)</span>
            <input aria-label="Sample roll" type="number" min={1} value={roll} onChange={(e) => setRoll(Math.max(1, int(e.target.value)))} />
          </label>
          <label className="gov-field">
            <span>Filled segments (for a Threat Clock)</span>
            <input aria-label="Sample filled segments" type="number" min={0} value={filled} onChange={(e) => setFilled(int(e.target.value))} />
          </label>
        </fieldset>
      )}
      <button type="button" className="gov-button" onClick={() => void run()} disabled={busy} data-testid="reference-preview-run">
        {busy ? "Calculating…" : "Calculate"}
      </button>
      {error !== "" ? (
        <p className="gov-bad" role="alert">
          {error}
        </p>
      ) : null}
      {r !== null ? (
        <dl className="gov-dl" data-testid="reference-preview-result">
          {"armorValue" in r ? (
            <>
              <dt>Armor granted</dt>
              <dd>{show(r.armorValue)}</dd>
              <dt>AGI that counts toward Dodge</dt>
              <dd data-testid="preview-armor-agi">
                {show(r.agiCountedForDodge)}
                {r.agiCapped === true ? " (capped by the armor)" : ""}
              </dd>
              <dt>Meets the Strength requirement</dt>
              <dd data-testid="preview-armor-str">{show(r.meetsStrengthRequirement)}</dd>
              <dt>Movement penalty</dt>
              <dd>{show(r.movementPenaltyFeet)} ft</dd>
              <dt>Stealth</dt>
              <dd>{r.stealthDisadvantage === true ? "Disadvantage" : "Normal"}</dd>
            </>
          ) : "apSplit" in r ? (
            <>
              <dt>Loading after changes</dt>
              <dd>{show(r.loading)}</dd>
              <dt>Attacks before a reload</dt>
              <dd data-testid="preview-reload-attacks">{show(r.attacksBeforeReload)}{r.burstAttacksBeforeReload !== null ? ` (${show(r.burstAttacksBeforeReload)} Bursts)` : ""}</dd>
              <dt>Reload</dt>
              <dd data-testid="preview-reload-split">
                {show(r.reloadAp)} AP over {show(r.turnsToReload)} turn(s): {Array.isArray(r.apSplit) ? (r.apSplit as number[]).map((a) => `${a} AP`).join(" then ") : "—"}
              </dd>
            </>
          ) : "values" in r && Array.isArray(r.values) ? (
            <>
              {(r.values as Array<{ scalingKey: string; label: string; unit: string | null; value: number | null; reason: string | null }>).map((v) => (
                <div key={v.scalingKey} style={{ display: "contents" }}>
                  <dt>{v.label} at Level {show(r.level)}</dt>
                  <dd data-testid={`preview-scaling-${v.scalingKey}`}>{v.value === null ? `— (${v.reason ?? "not available"})` : `${v.value}${v.unit ? ` ${v.unit}` : ""}`}</dd>
                </div>
              ))}
            </>
          ) : "castingAp" in r ? (
            <>
              <dt>Total MP</dt>
              <dd>{show(r.totalMp)}</dd>
              <dt>Casting AP</dt>
              <dd data-testid="preview-summon-ap">{show(r.castingAp)}</dd>
              <dt>Sustain MP each round</dt>
              <dd>{show(r.sustainMp)}</dd>
              <dt>Sustain AP each round</dt>
              <dd>{show(r.sustainApPerRound)}</dd>
              <dt>Most active at once</dt>
              <dd>{show(r.maxActive)}</dd>
              <dt>Counts toward Concentration</dt>
              <dd>{r.countsTowardConcentration === null ? "not decided (open question)" : show(r.countsTowardConcentration)}</dd>
              {r.economy !== null && typeof r.economy === "object" ? (
                <>
                  <dt>Who acts</dt>
                  <dd data-testid="preview-summon-economy">
                    {words((r.economy as Record<string, unknown>).actionModel)}; acts {words((r.economy as Record<string, unknown>).actsWhen).toLowerCase()};{" "}
                    {(r.economy as Record<string, unknown>).summonApPerRound !== null ? `its own ${show((r.economy as Record<string, unknown>).summonApPerRound)} AP each round` : "no AP of its own"}
                    {(r.economy as Record<string, unknown>).usesCasterAp === true ? "; uses the caster's AP" : ""}
                  </dd>
                </>
              ) : null}
            </>
          ) : "result" in r ? (
            <>
              <dt>Roll {show(r.roll)}</dt>
              <dd data-testid="preview-table-result">{show(r.result)}</dd>
            </>
          ) : "reached" in r ? (
            <>
              <dt>
                {show(r.filled)} of {show(r.segments)} segments
              </dt>
              <dd data-testid="preview-clock-reached">{show(r.reached)}{r.complete === true ? " — the clock is complete" : ""}</dd>
            </>
          ) : (
            <dd>This kind of Mission rule is written text; there is nothing to calculate.</dd>
          )}
        </dl>
      ) : null}
    </section>
  );
}
