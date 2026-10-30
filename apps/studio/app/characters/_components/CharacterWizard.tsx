"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CharacterApiError,
  candidateFrom,
  checkCharacter,
  completeCoreCreation,
  getCharacter,
  getCreationContext,
  saveCreation,
  saveProfile,
  type CandidateDto,
  type CharacterDto,
  type CreationContextDto,
  type OptionDto,
  type ResolutionDto,
  type SelectionDto,
} from "../_lib/character-client";
import { CharacterReview, RuleLink, releaseLabel } from "./CharacterReview";

/**
 * The core Character creation wizard (PAS-10 M6-WO3 §56–§69): Concept → Race / Ancestry → Stats → Skills → Primary
 * Affinity → Review. Every option comes from the Character's exact Release (the creation-context read); every number
 * shown (baseline, Ancestry modifiers, finals, points remaining, derived statistics) is the server's resolution of the
 * current choices — the wizard re-checks on every change and never calculates rules itself. Saving is explicit
 * (Save & Continue, optimistic lockVersion); completion is explicit and server-validated.
 */
const STEPS = ["Concept", "Race / Ancestry", "Stats", "Skills", "Primary Affinity", "Review"] as const;
const CHECK_DEBOUNCE_MS = 250;

interface StatGrant {
  grantKey: string;
  kind: string;
  stat?: string;
  amount: number;
  count?: number;
  allowedStats?: string[];
}
interface SkillGrant {
  grantKey: string;
  rankKey: string;
  selectionKind: string;
  count: number;
  options: SelectionDto[];
}
interface AncestryPayload {
  baseHp: number;
  baseMp: number;
  statGrants: StatGrant[];
  skillGrants: SkillGrant[];
}
const ancestryOf = (o: OptionDto | undefined) => (o?.payload ?? null) as unknown as AncestryPayload | null;
const same = (a: SelectionDto | null | undefined, b: SelectionDto | null | undefined) => !!a && !!b && a.entityId === b.entityId && a.entityVersionId === b.entityVersionId;
const sel = (o: OptionDto): SelectionDto => ({ entityId: o.ref.entityId, entityVersionId: o.ref.entityVersionId });
const signed = (n: number) => (n >= 0 ? `+${n}` : String(n));

export function CharacterWizard({ characterId }: { characterId: string }) {
  const router = useRouter();
  const [character, setCharacter] = useState<CharacterDto | null>(null);
  const [context, setContext] = useState<CreationContextDto | null>(null);
  const [candidate, setCandidate] = useState<CandidateDto | null>(null);
  const [profile, setProfile] = useState<{ name: string; concept: string }>({ name: "", concept: "" });
  const [check, setCheck] = useState<ResolutionDto | null>(null);
  const [step, setStep] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error" | "stale"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const [c, ctx] = await Promise.all([getCharacter(characterId), getCreationContext(characterId)]);
      setCharacter(c);
      setContext(ctx);
      setCandidate(candidateFrom(c.choices));
      setProfile({ name: c.name, concept: c.concept ?? "" });
      setCheck(c.resolution);
      setDirty(false);
    } catch (e) {
      setLoadError(e instanceof CharacterApiError ? `${e.message} (${e.code})` : "Could not load this Character.");
    }
  }, [characterId]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount
    void load();
  }, [load]);

  // Live server check of the current (unsaved) choices — authoritative numbers for every step.
  const checkSeq = useRef(0);
  useEffect(() => {
    if (candidate === null || !dirty) return;
    const seq = ++checkSeq.current;
    const t = setTimeout(() => {
      checkCharacter(characterId, candidate).then(
        (r) => seq === checkSeq.current && setCheck(r),
        () => undefined,
      );
    }, CHECK_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [candidate, characterId, dirty]);

  const options = useMemo(() => {
    const byVersion = new Map<string, OptionDto>();
    for (const o of [...(context?.ancestries ?? []), ...(context?.skills ?? []), ...(context?.affinities ?? [])]) byVersion.set(o.ref.entityVersionId, o);
    return byVersion;
  }, [context]);
  const names = useMemo(() => ({ ...(character?.names ?? {}), ...Object.fromEntries([...options.entries()].map(([k, v]) => [k, v.displayName])) }), [character, options]);

  if (loadError !== null) {
    return (
      <p className="gov-error" role="alert">
        {loadError} <button type="button" className="gov-link-button" onClick={() => void load()}>Try again</button>
      </p>
    );
  }
  if (character === null || context === null || candidate === null) return <p role="status">Loading Character…</p>;
  const release = character.release;

  if (character.status === "CORE_COMPLETE") {
    return (
      <div className="prowess-character" data-testid="wizard-read-only">
        <h1>{character.name}</h1>
        <p className="gov-ok">Core Creation Complete — the mechanical creation choices are frozen.</p>
        <p>
          <Link href={`/characters/${encodeURIComponent(character.id)}`}>View Character</Link>
        </p>
        <CharacterReview release={release} resolution={character.resolution} names={names} level={character.level} />
      </div>
    );
  }
  if (context.capability.status !== "READY") {
    return (
      <div className="gov-bad" role="alert">
        This Character&apos;s Release cannot build a Character: {context.capability.missing.map((m) => m.requirement).join(", ")}.
      </div>
    );
  }

  const update = (next: CandidateDto) => {
    setCandidate(next);
    setDirty(true);
    setMessage(null);
  };
  const ancestryOption = context.ancestries.find((a) => same(sel(a), candidate.ancestry));
  const ancestry = ancestryOf(ancestryOption);
  const resolved = check?.resolved;
  const remaining = resolved?.pointsRemaining ?? null;
  const skillTaken = (s: SelectionDto, except?: number) => candidate.skills.some((x, i) => i !== except && x.skill.entityId === s.entityId);
  const optionName = (s: SelectionDto) => options.get(s.entityVersionId)?.displayName ?? s.entityId;

  const handleError = (e: unknown) => {
    if (e instanceof CharacterApiError && e.code === "CHARACTER.STALE_WRITE") setMessage({ kind: "stale", text: `${e.message}` });
    else setMessage({ kind: "error", text: e instanceof CharacterApiError ? `${e.message} (${e.code})` : "The request failed." });
  };

  const saveAndContinue = async () => {
    setBusy(true);
    setMessage(null);
    try {
      let current = character;
      if (profile.name !== current.name || (profile.concept || null) !== current.concept) current = await saveProfile(current.id, current.lockVersion, profile.name, profile.concept.trim() === "" ? null : profile.concept);
      if (dirty) current = await saveCreation(current.id, current.lockVersion, candidate);
      setCharacter(current);
      setCheck(current.resolution);
      setCandidate(candidateFrom(current.choices));
      setDirty(false);
      setMessage({ kind: "ok", text: "Saved." });
      setStep((s) => Math.min(s + 1, STEPS.length - 1));
    } catch (e) {
      handleError(e);
    } finally {
      setBusy(false);
    }
  };
  const runCheck = async () => {
    setBusy(true);
    try {
      setCheck(await checkCharacter(character.id, candidate));
    } catch (e) {
      handleError(e);
    } finally {
      setBusy(false);
    }
  };
  const complete = async () => {
    setBusy(true);
    setMessage(null);
    try {
      await completeCoreCreation(character.id, character.lockVersion);
      router.push(`/characters/${encodeURIComponent(character.id)}`);
    } catch (e) {
      handleError(e);
      setBusy(false);
    }
  };
  const canComplete = !dirty && character.resolution.status === "READY" && check?.status === "READY";

  const chooseAncestry = (o: OptionDto) => {
    const payload = ancestryOf(o);
    // A new Ancestry clears the previous Ancestry's choices; FIXED Skill grants are pre-filled (the server still checks).
    const fixed = (payload?.skillGrants ?? []).filter((g) => g.selectionKind === "FIXED").flatMap((g) => g.options.map((s) => ({ skill: { entityId: s.entityId, entityVersionId: s.entityVersionId }, sourceKind: "ANCESTRY", sourceGrantKey: g.grantKey })));
    update({ ...candidate, ancestry: sel(o), ancestryStatChoices: [], skills: [...fixed, ...candidate.skills.filter((s) => s.sourceKind !== "ANCESTRY" && !fixed.some((f) => f.skill.entityId === s.skill.entityId))] });
  };
  const setStatChoice = (grantKey: string, slot: number, stat: string) => {
    const others = candidate.ancestryStatChoices.filter((c) => c.grantKey !== grantKey);
    const mine = candidate.ancestryStatChoices.filter((c) => c.grantKey === grantKey).map((c) => c.stat);
    mine[slot] = stat;
    update({ ...candidate, ancestryStatChoices: [...others, ...mine.filter((s) => s).map((s) => ({ grantKey, stat: s }))] });
  };
  const allocate = (stat: string, delta: number) => {
    const current = candidate.statAllocations[stat] ?? 0;
    update({ ...candidate, statAllocations: { ...candidate.statAllocations, [stat]: Math.max(0, current + delta) } });
  };
  const setSkillSlot = (sourceKind: string, grantKey: string | null, slot: number, versionId: string) => {
    const group = candidate.skills.filter((s) => s.sourceKind === sourceKind && s.sourceGrantKey === grantKey);
    const rest = candidate.skills.filter((s) => !(s.sourceKind === sourceKind && s.sourceGrantKey === grantKey));
    const chosen = group.map((g) => g.skill);
    const option = context.skills.find((o) => o.ref.entityVersionId === versionId);
    const next = [...chosen];
    if (option === undefined) next.splice(slot, 1);
    else next[slot] = sel(option);
    update({ ...candidate, skills: [...rest, ...next.filter(Boolean).map((skill) => ({ skill, sourceKind, sourceGrantKey: grantKey }))] });
  };

  const skillSelect = (label: string, sourceKind: string, grantKey: string | null, slot: number, pool: OptionDto[]) => {
    const group = candidate.skills.filter((s) => s.sourceKind === sourceKind && s.sourceGrantKey === grantKey);
    const value = group[slot]?.skill;
    const ownIndex = value ? candidate.skills.findIndex((s) => same(s.skill, value)) : -1;
    return (
      <label className="gov-field" key={`${sourceKind}-${grantKey}-${slot}`}>
        <span>{label}</span>
        <select value={value?.entityVersionId ?? ""} onChange={(e) => setSkillSlot(sourceKind, grantKey, slot, e.target.value)}>
          <option value="">Choose a Skill…</option>
          {pool.map((o) => (
            <option key={o.ref.entityVersionId} value={o.ref.entityVersionId} disabled={skillTaken(sel(o), ownIndex)}>
              {o.displayName}
              {skillTaken(sel(o), ownIndex) ? " (already chosen)" : ""}
            </option>
          ))}
        </select>
      </label>
    );
  };

  const issuesFor = (prefix: string) => (check?.issues ?? []).filter((i) => i.path.startsWith(prefix));
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

  return (
    <div className="prowess-character prowess-character__wizard" data-testid="character-wizard">
      <header className="prowess-reference__header">
        <p className="gov-eyebrow">Character creation — Draft</p>
        <h1>{character.name}</h1>
        <p className="gov-meta">
          <span className="gov-tag" data-testid="wizard-release">
            Pinned to {releaseLabel(release)}
          </span>
          <span className="gov-tag">Level {character.level}</span>
          {context.characterDie ? <span className="gov-tag">Character Die d{context.characterDie.faces}</span> : null}
        </p>
      </header>
      <nav aria-label="Creation steps">
        <ol className="prowess-character__steps">
          {STEPS.map((s, i) => (
            <li key={s}>
              <button type="button" className="gov-link-button" aria-current={i === step ? "step" : undefined} onClick={() => setStep(i)}>
                {i + 1}. {s}
              </button>
            </li>
          ))}
        </ol>
      </nav>

      <section className="gov-panel" aria-labelledby="wizard-step-heading">
        <h2 id="wizard-step-heading">{STEPS[step]}</h2>

        {step === 0 ? (
          <div>
            <label className="gov-field">
              <span>Name</span>
              <input value={profile.name} onChange={(e) => setProfile({ ...profile, name: e.target.value })} maxLength={120} />
            </label>
            <label className="gov-field">
              <span>Concept (optional, descriptive only)</span>
              <textarea value={profile.concept} onChange={(e) => setProfile({ ...profile, concept: e.target.value })} maxLength={2000} />
            </label>
          </div>
        ) : null}

        {step === 1 ? (
          <div>
            <ul className="prowess-reference__cards" aria-label="Ancestries">
              {context.ancestries.map((o) => {
                const p = ancestryOf(o);
                const chosen = same(sel(o), candidate.ancestry);
                return (
                  <li key={o.ref.entityVersionId} className="gov-card" data-testid="ancestry-card">
                    <label>
                      <input type="radio" name="ancestry" checked={chosen} onChange={() => chooseAncestry(o)} /> <strong>{o.displayName}</strong>
                    </label>
                    {o.shortDescription ? <p>{o.shortDescription}</p> : null}
                    {p ? (
                      <ul className="gov-muted">
                        <li>
                          Base HP {p.baseHp} · Base MP {p.baseMp}
                        </li>
                        {p.statGrants.map((g) => (
                          <li key={g.grantKey}>{g.kind === "FIXED" ? `${signed(g.amount)} ${g.stat}` : `${signed(g.amount)} to ${g.count} different Stats (${(g.allowedStats ?? []).join(", ")})`}</li>
                        ))}
                        {p.skillGrants.map((g) => (
                          <li key={g.grantKey}>
                            Skills: {g.selectionKind === "FIXED" ? g.options.map(optionName).join(", ") : g.selectionKind === "CHOOSE_FROM" ? `choose ${g.count}: ${g.options.map(optionName).join(" or ")}` : `choose ${g.count} of any Skill`}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                    <RuleLink release={release} refDto={o.ref} label="Rules Reference" />
                  </li>
                );
              })}
            </ul>
            {ancestry !== null
              ? ancestry.statGrants
                  .filter((g) => g.kind === "CHOOSE_DISTINCT")
                  .map((g) => {
                    const mine = candidate.ancestryStatChoices.filter((c) => c.grantKey === g.grantKey).map((c) => c.stat);
                    return (
                      <fieldset key={g.grantKey} className="gov-fieldset">
                        <legend>
                          {signed(g.amount)} to {g.count} different Stats
                        </legend>
                        {Array.from({ length: g.count ?? 0 }, (_, slot) => (
                          <label className="gov-field" key={slot}>
                            <span>
                              Stat choice {slot + 1} of {g.count}
                            </span>
                            <select value={mine[slot] ?? ""} onChange={(e) => setStatChoice(g.grantKey, slot, e.target.value)}>
                              <option value="">Choose a Stat…</option>
                              {(g.allowedStats ?? []).map((s) => (
                                <option key={s} value={s} disabled={mine.includes(s) && mine[slot] !== s}>
                                  {s}
                                </option>
                              ))}
                            </select>
                          </label>
                        ))}
                      </fieldset>
                    );
                  })
              : null}
            {issueList("ancestry")}
          </div>
        ) : null}

        {step === 2 ? (
          <div>
            <p data-testid="points-remaining" role="status">
              Points Remaining: {remaining ?? "…"}
              {resolved?.pointBudget !== null && resolved?.pointBudget !== undefined ? ` of ${resolved.pointBudget}` : ""}
            </p>
            <table className="prowess-reference__table" aria-label="Stats">
              <thead>
                <tr>
                  <th scope="col">Stat</th>
                  <th scope="col">Base</th>
                  <th scope="col">Ancestry</th>
                  <th scope="col">Allocated</th>
                  <th scope="col">Final</th>
                  <th scope="col">Adjust</th>
                </tr>
              </thead>
              <tbody>
                {context.stats.map((s) => {
                  const r = resolved?.stats.find((x) => x.stat === s.stat);
                  const allocated = candidate.statAllocations[s.stat] ?? 0;
                  return (
                    <tr key={s.stat} data-testid={`stat-row-${s.stat}`}>
                      <th scope="row">{s.stat}</th>
                      <td>{r?.baseline ?? s.minimum}</td>
                      <td>{r ? signed(r.ancestry) : "…"}</td>
                      <td>{signed(allocated)}</td>
                      <td>{r?.final ?? "…"}</td>
                      <td>
                        <button type="button" className="gov-button" aria-label={`Remove a point from ${s.stat}`} disabled={allocated <= 0} onClick={() => allocate(s.stat, -1)}>
                          −
                        </button>{" "}
                        <button type="button" className="gov-button" aria-label={`Add a point to ${s.stat}`} disabled={remaining === null || remaining <= 0 || (r !== undefined && r.final >= r.maximum)} onClick={() => allocate(s.stat, 1)}>
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

        {step === 3 ? (
          <div>
            <h3>Race Skills</h3>
            {ancestry === null ? <p className="gov-muted">Choose an Ancestry first.</p> : null}
            {ancestry?.skillGrants.map((g) =>
              g.selectionKind === "FIXED" ? (
                <p key={g.grantKey}>Granted: {g.options.map(optionName).join(", ")}</p>
              ) : (
                <fieldset key={g.grantKey} className="gov-fieldset">
                  <legend>{g.selectionKind === "CHOOSE_FROM" ? `Choose ${g.count}: ${g.options.map(optionName).join(" or ")}` : `Choose ${g.count} of any Skill`}</legend>
                  {Array.from({ length: g.count }, (_, slot) =>
                    skillSelect(`Race Skill ${slot + 1}`, "ANCESTRY", g.grantKey, slot, g.selectionKind === "CHOOSE_FROM" ? context.skills.filter((o) => g.options.some((x) => same(x, sel(o)))) : context.skills),
                  )}
                </fieldset>
              ),
            )}
            <h3>Free Training</h3>
            <fieldset className="gov-fieldset">
              <legend>Choose {resolved?.freeSkillCount ?? "…"} trained Skills</legend>
              {Array.from({ length: resolved?.freeSkillCount ?? 0 }, (_, slot) => skillSelect(`Free Skill ${slot + 1}`, "FREE", null, slot, context.skills))}
            </fieldset>
            {issueList("skills")}
          </div>
        ) : null}

        {step === 4 ? (
          <div>
            <ul className="prowess-reference__cards" aria-label="Affinities">
              {context.affinities
                .filter((o) => o.executable)
                .map((o) => {
                  const p = (o.payload ?? {}) as { identity?: { text?: string; themes?: string[] }; strengths?: unknown[]; weaknesses?: unknown[] };
                  return (
                    <li key={o.ref.entityVersionId} className="gov-card" data-testid="affinity-card">
                      <label>
                        <input type="radio" name="affinity" checked={same(sel(o), candidate.primaryAffinity)} onChange={() => update({ ...candidate, primaryAffinity: sel(o) })} /> <strong>{o.displayName}</strong>
                      </label>
                      {p.identity?.text ? <p>{p.identity.text}</p> : null}
                      <p className="gov-muted">
                        {(p.identity?.themes ?? []).join(", ")}
                        {p.strengths ? ` · ${p.strengths.length} Strength rule(s)` : ""}
                        {p.weaknesses ? ` · ${p.weaknesses.length} Weakness rule(s)` : ""}
                      </p>
                      <RuleLink release={release} refDto={o.ref} label="Rules Reference" />
                    </li>
                  );
                })}
            </ul>
            {issueList("primaryAffinity")}
          </div>
        ) : null}

        {step === 5 && check !== null ? (
          <div>
            <CharacterReview release={release} resolution={check} names={names} level={character.level} />
            {check.issues.length > 0 ? (
              <ul className="prowess-character__issues" aria-label="Remaining problems">
                {check.issues.map((i, n) => (
                  <li key={n} className={i.severity === "ERROR" ? "gov-bad" : "gov-muted"}>
                    {i.severity === "ERROR" ? "Not allowed: " : "To do: "}
                    {i.message}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="gov-ok" data-testid="check-ready">
                Ready — this Character satisfies every creation rule of its Release.
              </p>
            )}
          </div>
        ) : null}
      </section>

      {message !== null ? (
        <p className={message.kind === "ok" ? "gov-ok" : "gov-bad"} role={message.kind === "ok" ? "status" : "alert"} data-testid="wizard-message">
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
        <button type="button" className="gov-button" disabled={step === 0 || busy} onClick={() => setStep(step - 1)}>
          Back
        </button>
        <button type="button" className="gov-button gov-button--primary" disabled={busy} onClick={() => void saveAndContinue()}>
          Save &amp; Continue
        </button>
        <button type="button" className="gov-button" disabled={busy} onClick={() => void runCheck()}>
          Check Character
        </button>
        <button type="button" className="gov-button gov-button--consequential" disabled={busy || !canComplete} onClick={() => void complete()}>
          Complete Core Creation
        </button>
      </p>
      {!canComplete ? <p className="gov-muted">Complete Core Creation becomes available once the saved Character passes every creation rule (save your changes, then Check Character).</p> : null}
    </div>
  );
}
