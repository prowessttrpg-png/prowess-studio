"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { formatEnumLabel } from "@prowess/ui";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  CharacterApiError,
  advanceCharacter,
  getAdvancementContext,
  previewAdvancement,
  type AdvancementChoicesDto,
  type AdvancementContextDto,
  type AdvancementPreviewDto,
  type AffinityOptionDto,
  type SelectionDto,
} from "../_lib/character-client";
import { AdvancementHistory } from "./CharacterProgress";
import { releaseLabel } from "./CharacterReview";

/**
 * Advance a completed Character ONE Level (PAS-10 M6-WO4 §69–§77): Next Level summary → Stat Points → Skill
 * advancement → Affinity progression → Review → Advance Character. Every step, option and number comes from the
 * Character's exact Release through the server (the advancement context and a debounced, side-effect-free preview);
 * steps the next Level grants nothing for are skipped. Nothing is saved until Advance Character, which commits the whole
 * advancement atomically at the loaded version.
 */
type Step = "summary" | "stats" | "skills" | "affinity" | "review";
const PREVIEW_DEBOUNCE_MS = 250;
const EMPTY: AdvancementChoicesDto = { statAllocations: {}, skillAdvancements: [], affinityChoice: null };
const sel = (r: { entityId: string; entityVersionId: string }): SelectionDto => ({ entityId: r.entityId, entityVersionId: r.entityVersionId });

function optionLabel(o: AffinityOptionDto): string {
  if (o.action === "RANK_UP") return `${formatEnumLabel(o.optionKey)}: raise ${o.target === "PRIMARY" ? "the Primary Affinity" : "an owned Affinity"} from ${formatEnumLabel(o.from ?? "")} to ${formatEnumLabel(o.to ?? "")}`;
  if (o.action === "GAIN_AFFINITY") return `${formatEnumLabel(o.optionKey)}: gain a ${formatEnumLabel(o.role ?? "")} Affinity at ${formatEnumLabel(o.startingRank ?? "unresolved")}`;
  return formatEnumLabel(o.optionKey);
}

export function AdvancementWizard({ characterId }: { characterId: string }) {
  const router = useRouter();
  const [ctx, setCtx] = useState<AdvancementContextDto | null>(null);
  const [choices, setChoices] = useState<AdvancementChoicesDto>(EMPTY);
  const [preview, setPreview] = useState<AdvancementPreviewDto | null>(null);
  const [step, setStep] = useState<Step>("summary");
  const [message, setMessage] = useState<{ kind: "error" | "stale"; text: string } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoadError(null);
    setMessage(null);
    try {
      const loaded = await getAdvancementContext(characterId);
      setCtx(loaded);
      setChoices(EMPTY);
      setStep("summary");
      setPreview(loaded.maximumLevelReached ? null : await previewAdvancement(characterId, EMPTY));
    } catch (e) {
      setLoadError(e instanceof CharacterApiError ? `${e.message} (${e.code})` : "Could not load this Character's advancement.");
    }
  }, [characterId]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount
    void load();
  }, [load]);

  // The server previews every change (authoritative numbers, issues and access changes).
  const seq = useRef(0);
  const update = (next: AdvancementChoicesDto) => {
    setChoices(next);
    setMessage(null);
    const mine = ++seq.current;
    setTimeout(() => {
      if (mine !== seq.current) return;
      previewAdvancement(characterId, next).then(
        (p) => mine === seq.current && setPreview(p),
        () => undefined,
      );
    }, PREVIEW_DEBOUNCE_MS);
  };

  if (loadError !== null) {
    return (
      <p className="gov-error" role="alert">
        {loadError} <button type="button" className="gov-link-button" onClick={() => void load()}>Try again</button>
      </p>
    );
  }
  if (ctx === null) return <p role="status">Loading advancement…</p>;
  const backLink = (
    <Link href={`/characters/${encodeURIComponent(ctx.character.id)}`}>Back to {ctx.character.name}</Link>
  );
  if (ctx.maximumLevelReached || ctx.next === null) {
    return (
      <div className="prowess-character" data-testid="advancement-max-level">
        <h1>{ctx.character.name}</h1>
        <p className="gov-ok">Maximum Level Reached — Level {ctx.profile.level} is the highest Level of {releaseLabel(ctx.release)}.</p>
        <p>{backLink}</p>
        <AdvancementHistory history={ctx.history} names={ctx.names} />
      </div>
    );
  }
  const next = ctx.next;
  const affinityChoice = next.affinity !== null && !next.affinity.automatic;
  const steps: Step[] = ["summary", ...(next.statPoints > 0 ? (["stats"] as const) : []), ...(next.skillAdvancements > 0 ? (["skills"] as const) : []), ...(affinityChoice ? (["affinity"] as const) : []), "review"];
  const labels: Record<Step, string> = { summary: "Next Level", stats: "Stat Points", skills: "Skill Advancement", affinity: "Affinity Progression", review: "Review" };
  const at = steps.indexOf(step);
  const issues = preview?.issues ?? [];
  const issuesFor = (prefix: string) => issues.filter((i) => i.path.startsWith(prefix));
  const statsAfter = preview?.after?.stats ?? null;
  const remaining = preview?.statPoints?.remaining ?? null;

  const issueList = (prefix: string) => {
    const list = issuesFor(prefix);
    if (list.length === 0) return null;
    return (
      <ul className="prowess-character__issues" aria-label="Problems in this step">
        {list.map((i, n) => (
          <li key={n} className={i.severity === "ERROR" ? "gov-bad" : "gov-muted"}>
            {i.severity === "ERROR" ? "Not allowed: " : "To do: "}
            {i.message}
          </li>
        ))}
      </ul>
    );
  };
  const allocated = (stat: string) => choices.statAllocations[stat] ?? 0;
  const setStat = (stat: string, delta: 1 | -1) => {
    const value = allocated(stat) + delta;
    const statAllocations = { ...choices.statAllocations };
    if (value <= 0) delete statAllocations[stat];
    else statAllocations[stat] = value;
    update({ ...choices, statAllocations });
  };
  const chosenSkill = choices.skillAdvancements[0] ?? null;

  const commit = async () => {
    setBusy(true);
    setMessage(null);
    try {
      await advanceCharacter(ctx.character.id, ctx.character.lockVersion, choices);
      router.push(`/characters/${encodeURIComponent(ctx.character.id)}`);
    } catch (e) {
      if (e instanceof CharacterApiError && e.code === "CHARACTER.STALE_WRITE") setMessage({ kind: "stale", text: e.message });
      else setMessage({ kind: "error", text: e instanceof CharacterApiError ? `${e.message} (${e.code})` : "The advancement failed." });
      setBusy(false);
    }
  };

  return (
    <div className="prowess-character prowess-character__wizard" data-testid="advancement-wizard">
      <header className="prowess-reference__header">
        <p className="gov-eyebrow">Advance Character</p>
        <h1>{ctx.character.name}</h1>
        <p className="gov-meta">
          <span className="gov-tag" data-testid="advance-release">
            Pinned to {releaseLabel(ctx.release)}
          </span>
          <span className="gov-tag" data-testid="advance-levels">
            Level {next.fromLevel} → {next.toLevel}
          </span>
        </p>
        <p>{backLink}</p>
      </header>
      <nav aria-label="Advancement steps">
        <ol className="prowess-character__steps">
          {steps.map((s, i) => (
            <li key={s}>
              <button type="button" className="gov-link-button" aria-current={s === step ? "step" : undefined} onClick={() => setStep(s)}>
                {i + 1}. {labels[s]}
              </button>
            </li>
          ))}
        </ol>
      </nav>

      <section className="gov-panel" aria-labelledby="advance-step-heading">
        <h2 id="advance-step-heading">{labels[step]}</h2>

        {step === "summary" ? (
          <dl className="gov-dl" data-testid="next-level-summary">
            <dt>Level</dt>
            <dd>
              {next.fromLevel} → {next.toLevel}
            </dd>
            <dt>Character Die</dt>
            <dd data-testid="summary-die">
              d{next.characterDie.before.faces} → d{next.characterDie.after.faces}
            </dd>
            <dt>Stat Points</dt>
            <dd data-testid="summary-stat-points">{next.statPoints}</dd>
            <dt>Skill advancements</dt>
            <dd data-testid="summary-skill-advancements">{next.skillAdvancements}</dd>
            <dt>Affinity progression</dt>
            <dd data-testid="summary-affinity">{next.affinity === null ? "None at this Level" : next.affinity.automatic ? `Automatic: ${next.affinity.options.map(optionLabel).join("; ")}` : `Choose one: ${next.affinity.options.map(optionLabel).join(" | ")}`}</dd>
          </dl>
        ) : null}

        {step === "stats" ? (
          <div>
            <p role="status" data-testid="advance-points">
              Points Remaining: {remaining ?? "…"} of {next.statPoints}
            </p>
            <table className="prowess-reference__table" aria-label="Stat advancement">
              <thead>
                <tr>
                  <th scope="col">Stat</th>
                  <th scope="col">Present</th>
                  <th scope="col">This Level</th>
                  <th scope="col">After</th>
                  <th scope="col">Adjust</th>
                </tr>
              </thead>
              <tbody>
                {ctx.profile.stats.map((s) => {
                  const after = statsAfter?.find((x) => x.stat === s.stat);
                  return (
                    <tr key={s.stat} data-testid={`advance-stat-${s.stat}`}>
                      <th scope="row">{s.stat}</th>
                      <td>{s.final}</td>
                      <td>+{allocated(s.stat)}</td>
                      <td>{after?.final ?? "…"}</td>
                      <td>
                        <button type="button" className="gov-button" aria-label={`Remove a point from ${s.stat}`} disabled={allocated(s.stat) <= 0} onClick={() => setStat(s.stat, -1)}>
                          −
                        </button>{" "}
                        <button type="button" className="gov-button" aria-label={`Add a point to ${s.stat}`} disabled={remaining === null || remaining <= 0 || s.final >= s.maximum} onClick={() => setStat(s.stat, 1)}>
                          +
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {issueList("statAllocations")}
          </div>
        ) : null}

        {step === "skills" ? (
          <div>
            <fieldset className="gov-fieldset">
              <legend>Train New (becomes Trained)</legend>
              {ctx.skillOptions.trainNew.map((o) => (
                <label key={o.ref.entityVersionId} className="gov-field" data-testid="skill-train-option">
                  <input type="radio" name="skill-advancement" checked={chosenSkill?.action === "TRAIN_NEW" && chosenSkill.skill.entityVersionId === o.ref.entityVersionId} onChange={() => update({ ...choices, skillAdvancements: [{ action: "TRAIN_NEW", skill: sel(o.ref) }] })} /> {o.displayName}
                </label>
              ))}
            </fieldset>
            <fieldset className="gov-fieldset">
              <legend>Upgrade Existing (one rank)</legend>
              {ctx.skillOptions.upgrade.map((o) => (
                <label key={o.ref.entityVersionId} className="gov-field" data-testid="skill-upgrade-option">
                  <input type="radio" name="skill-advancement" checked={chosenSkill?.action === "UPGRADE" && chosenSkill.skill.entityVersionId === o.ref.entityVersionId} onChange={() => update({ ...choices, skillAdvancements: [{ action: "UPGRADE", skill: sel(o.ref) }] })} /> {o.displayName}{" "}
                  <span className="gov-muted">({formatEnumLabel(o.rankKey ?? "")})</span>
                </label>
              ))}
            </fieldset>
            {issueList("skillAdvancements")}
          </div>
        ) : null}

        {step === "affinity" && next.affinity !== null ? (
          <div>
            <fieldset className="gov-fieldset">
              <legend>Choose one Affinity progression option</legend>
              {next.affinity.options.map((o) => (
                <label key={o.optionKey} className="gov-field" data-testid="affinity-option">
                  <input type="radio" name="affinity-option" checked={choices.affinityChoice?.optionKey === o.optionKey} onChange={() => update({ ...choices, affinityChoice: { optionKey: o.optionKey, affinity: null } })} /> {optionLabel(o)}
                </label>
              ))}
            </fieldset>
            {(() => {
              const option = next.affinity?.options.find((o) => o.optionKey === choices.affinityChoice?.optionKey);
              if (option === undefined || (option.action === "RANK_UP" && option.target === "PRIMARY")) return null;
              const pool = option.action === "GAIN_AFFINITY" ? ctx.affinityOptions.gain : ctx.affinityOptions.owned.filter((a) => a.rankKey === option.from);
              return (
                <label className="gov-field">
                  <span>{option.action === "GAIN_AFFINITY" ? "Affinity to gain" : "Affinity to raise"}</span>
                  <select
                    value={choices.affinityChoice?.affinity?.entityVersionId ?? ""}
                    onChange={(e) => {
                      const picked = pool.find((a) => a.ref.entityVersionId === e.target.value);
                      update({ ...choices, affinityChoice: { optionKey: option.optionKey, affinity: picked === undefined ? null : sel(picked.ref) } });
                    }}
                  >
                    <option value="">Choose an Affinity…</option>
                    {pool.map((a) => (
                      <option key={a.ref.entityVersionId} value={a.ref.entityVersionId}>
                        {a.displayName}
                      </option>
                    ))}
                  </select>
                </label>
              );
            })()}
            {issueList("affinityChoice")}
          </div>
        ) : null}

        {step === "review" ? (
          <div data-testid="advance-review">
            {preview?.after && preview.before ? (
              <table className="prowess-reference__table" aria-label="Before and after">
                <thead>
                  <tr>
                    <th scope="col">Value</th>
                    <th scope="col">Before</th>
                    <th scope="col">After</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <th scope="row">Level</th>
                    <td>{preview.before.level}</td>
                    <td data-testid="review-after-level">{preview.after.level}</td>
                  </tr>
                  <tr>
                    <th scope="row">Character Die</th>
                    <td>d{preview.before.characterDie.faces}</td>
                    <td data-testid="review-after-die">d{preview.after.characterDie.faces}</td>
                  </tr>
                  {preview.after.stats.map((s) => (
                    <tr key={s.stat}>
                      <th scope="row">{s.stat}</th>
                      <td>{preview.before?.stats.find((x) => x.stat === s.stat)?.final}</td>
                      <td data-testid={`review-after-${s.stat}`}>{s.final}</td>
                    </tr>
                  ))}
                  {preview.after.skills.map((s) => (
                    <tr key={s.skill.entityId}>
                      <th scope="row">{ctx.names[s.skill.entityVersionId] ?? s.skill.canonicalKey}</th>
                      <td>{formatEnumLabel(preview.before?.skills.find((x) => x.skill.entityId === s.skill.entityId)?.rankKey ?? "UNTRAINED")}</td>
                      <td>{formatEnumLabel(s.rankKey)}</td>
                    </tr>
                  ))}
                  {preview.after.affinities.map((a) => (
                    <tr key={a.affinity.entityId}>
                      <th scope="row">
                        {a.affinity.canonicalKey} ({formatEnumLabel(a.role)})
                      </th>
                      <td>{formatEnumLabel(preview.before?.affinities.find((x) => x.affinity.entityId === a.affinity.entityId)?.rank ?? "—")}</td>
                      <td data-testid="review-after-affinity">{formatEnumLabel(a.rank)}</td>
                    </tr>
                  ))}
                  {preview.after.derivedStatistics.map((d) => (
                    <tr key={d.statistic}>
                      <th scope="row">{formatEnumLabel(d.statistic)}</th>
                      <td>{preview.before?.derivedStatistics.find((x) => x.statistic === d.statistic)?.value}</td>
                      <td data-testid={`review-after-${d.statistic}`}>{d.value}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="gov-muted">The review appears once every entitlement of this Level is chosen.</p>
            )}
            {preview?.accessChanges ? (
              <section aria-label="Access changes" data-testid="access-changes">
                <h3>Access changes</h3>
                {preview.accessChanges.tracks.length === 0 && preview.accessChanges.newlyEligible.length === 0 ? <p className="gov-muted">No change in construction access.</p> : null}
                <ul className="gov-list">
                  {preview.accessChanges.tracks.map((t) => (
                    <li key={t.track}>
                      {formatEnumLabel(t.track.split(":")[0] ?? t.track)}
                      {t.track.includes(":") ? ` ${t.track.split(":")[1]}` : ""}: {formatEnumLabel(t.before)} → {formatEnumLabel(t.after)}
                    </li>
                  ))}
                  {preview.accessChanges.newlyEligible.map((d) => (
                    <li key={d.entityVersionId} data-testid="newly-eligible">
                      Newly available: {d.canonicalKey}
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
            {issues.length > 0 ? (
              <ul className="prowess-character__issues" aria-label="Remaining problems">
                {issues.map((i, n) => (
                  <li key={n} className={i.severity === "ERROR" ? "gov-bad" : "gov-muted"}>
                    {i.severity === "ERROR" ? "Not allowed: " : "To do: "}
                    {i.message}
                  </li>
                ))}
              </ul>
            ) : preview?.status === "READY" ? (
              <p className="gov-ok" data-testid="advance-ready">
                Ready — this advancement satisfies every rule of the Character&apos;s Release.
              </p>
            ) : null}
          </div>
        ) : null}
      </section>

      {message !== null ? (
        <p className="gov-bad" role="alert" data-testid="advance-message">
          {message.text}
          {message.kind === "stale" ? (
            <>
              {" "}
              <button type="button" className="gov-link-button" onClick={() => void load()}>
                Reload the Character
              </button>
            </>
          ) : null}
        </p>
      ) : null}
      <p className="gov-actions">
        <button type="button" className="gov-button" disabled={at <= 0 || busy} onClick={() => setStep(steps[at - 1] as Step)}>
          Back
        </button>
        <button type="button" className="gov-button" disabled={at >= steps.length - 1 || busy} onClick={() => setStep(steps[at + 1] as Step)}>
          Next
        </button>
        <button type="button" className="gov-button gov-button--consequential" disabled={busy || preview?.status !== "READY"} onClick={() => void commit()}>
          Advance Character
        </button>
      </p>
      {preview?.status !== "READY" ? <p className="gov-muted">Advance Character becomes available once every entitlement of this Level is chosen and the server accepts the advancement.</p> : null}
    </div>
  );
}
