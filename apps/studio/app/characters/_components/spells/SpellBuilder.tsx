"use client";

import { formatEnumLabel } from "@prowess/ui";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  CharacterApiError,
  finalizeSpell,
  getSpellBuilder,
  rebuildSpell,
  saveSpellDraft,
  validateSpell,
  type SignatureSpellBuilderDto,
  type SignatureSpellDraftDto,
  type SpellComponentOptionDto,
  type SpellEvaluationDto,
  type SpellOrderedUseDto,
  type SpellTraitUseDto,
} from "../../_lib/character-client";
import { authorityLabel, isFinalizable, refName, SPELL_STEPS, stepOf, tagsFromText, type BuilderStep } from "../../_lib/spell-format";
import { ComponentPicker, ParameterFields } from "./SpellComponents";
import { RuntimeWarnings, SpellCost, SpellReview, SpellStateBadge } from "./SpellReview";

/**
 * The Signature Spell Builder (PAS-10 M6-WO7 §19–§75, §121–§131). It GATHERS selections and prose; the server's M5
 * evaluation decides legality, capacity, Keywords, cost and runtime readiness, and is shown as given. Authority and
 * Affinity are never auto-chosen (§24, §26); invalid components are marked, never silently removed (§28); the draft is
 * autosaved with optimistic concurrency (§87, §126). Nothing is cast (§100).
 */

type SaveState = "saved" | "unsaved" | "saving" | "conflict" | "error";
const SAVE_LABELS: Record<SaveState, string> = { saved: "Saved", unsaved: "Unsaved changes", saving: "Saving…", conflict: "Conflict — this Spell changed elsewhere", error: "Not saved" };
const AUTOSAVE_MS = 600;
/** The one M5 chain behaviour that names its successors (M5-WO12); the offered behaviours come from the catalog. */
const BRANCH = "BRANCH";

const nextKey = (prefix: string, used: readonly string[]): string => {
  let n = 1;
  while (used.includes(`${prefix}${n}`)) n += 1;
  return `${prefix}${n}`;
};
/** Effect order is the authored list position (§42, M6-I086): 1, 2, 3… in the order the player arranged. */
const renumber = <T extends SpellOrderedUseDto>(list: readonly T[]): T[] => list.map((x, i) => ({ ...x, order: i + 1 }));
const sortByOrder = <T extends { order: number }>(list: readonly T[]): T[] => [...list].sort((a, b) => a.order - b.order);

function StepTabs({ step, onChoose, evaluation }: { step: BuilderStep; onChoose: (s: BuilderStep) => void; evaluation: SpellEvaluationDto | null }) {
  const flagged = new Set(evaluation?.issues.map((i) => i.step) ?? []);
  return (
    <div
      className="character-tabs prowess-spell-builder__steps"
      role="tablist"
      aria-label="Spell builder steps"
      onKeyDown={(e) => {
        const at = SPELL_STEPS.findIndex((s) => s.key === step);
        const to = e.key === "ArrowRight" || e.key === "ArrowDown" ? at + 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? at - 1 : e.key === "Home" ? 0 : e.key === "End" ? SPELL_STEPS.length - 1 : null;
        if (to === null) return;
        e.preventDefault();
        const next = SPELL_STEPS[(to + SPELL_STEPS.length) % SPELL_STEPS.length]!.key;
        onChoose(next);
        (e.currentTarget.querySelector(`#spell-step-${next}`) as HTMLButtonElement | null)?.focus();
      }}
    >
      {SPELL_STEPS.map((s, i) => (
        <button key={s.key} type="button" role="tab" id={`spell-step-${s.key}`} aria-selected={step === s.key} aria-controls={`spell-panel-${s.key}`} tabIndex={step === s.key ? 0 : -1} onClick={() => onChoose(s.key)} data-testid={`spell-step-${s.key}`}>
          {i + 1}. {s.label}
          {flagged.has(s.key as never) ? <span className="prowess-spell__flag"> (needs attention)</span> : null}
        </button>
      ))}
    </div>
  );
}

/** The accessible validation summary (§124, §127): every server issue with a link to its step. */
function IssueSummary({ evaluation, onGo }: { evaluation: SpellEvaluationDto | null; onGo: (s: BuilderStep) => void }) {
  if (!evaluation || evaluation.issues.length === 0) return null;
  return (
    <section className="gov-panel prowess-spell__issues" role="region" aria-labelledby="spell-issues-heading" data-testid="spell-issues">
      <h3 id="spell-issues-heading">
        {evaluation.state === "INCOMPLETE" ? "Still to choose" : "Problems"} ({evaluation.issues.length})
      </h3>
      <ul>
        {evaluation.issues.map((q, i) => (
          <li key={`${q.code}-${q.path}-${i}`} data-testid="spell-issue" data-step={q.step} data-code={q.code}>
            <button type="button" className="gov-link-button" onClick={() => onGo(stepOf(q.step))}>
              {formatEnumLabel(q.step)}
            </button>
            : {q.message} <code className="gov-muted">{q.code}</code>
          </li>
        ))}
      </ul>
    </section>
  );
}

function LivePanel({ data, draft, evaluation, save, onGo }: { data: SignatureSpellBuilderDto; draft: SignatureSpellDraftDto; evaluation: SpellEvaluationDto | null; save: SaveState; onGo: (s: BuilderStep) => void }) {
  const c = evaluation?.construction;
  return (
    <aside className="prowess-spell-builder__live gov-panel" aria-label="Live review" data-testid="spell-live">
      <h2>{draft.concept.name || "Unnamed Spell"}</h2>
      <p>
        {evaluation ? <SpellStateBadge state={evaluation.state} /> : null}{" "}
        <span className="gov-tag" role="status" aria-live="polite" data-testid="spell-save-state" data-save={save}>
          {SAVE_LABELS[save]}
        </span>
      </p>
      <SpellCost evaluation={evaluation} />
      <ul className="gov-muted">
        <li>Authority: {authorityLabel(draft.authority)}</li>
        <li data-testid="spell-live-effects">Effects: {c ? `${c.usage.effects} / ${c.capacity.effects.remaining ?? "—"}` : `${draft.effects.length} chosen`}</li>
        <li data-testid="spell-live-traits">Traits: {c ? `${c.usage.traits} / ${c.traitCapacity.ordinary.effective ?? "—"}` : `${draft.traits.length} chosen`}</li>
        <li data-testid="spell-live-conditions">Casting Conditions: {c ? `${c.usage.conditions} / ${c.capacity.conditions.capacity ?? "—"}` : `${draft.castingConditions.length} chosen`}</li>
        <li data-testid="spell-live-slots">
          Signature slots: {c ? `used ${c.signature.usedBefore} / ${c.signature.capacity ?? "—"} · after finalizing ${c.signature.projected} / ${c.signature.capacity ?? "—"}` : `${data.signature.used} / ${data.signature.capacity ?? "—"} (drafts use none)`}
        </li>
      </ul>
      <RuntimeWarnings evaluation={evaluation} />
      {evaluation && evaluation.issues.length > 0 ? (
        <p>
          <button type="button" className="gov-link-button" onClick={() => onGo("REVIEW")}>
            {evaluation.issues.length} issue{evaluation.issues.length === 1 ? "" : "s"} — review
          </button>
        </p>
      ) : null}
    </aside>
  );
}

export function SpellBuilder({ characterId, spellId }: { characterId: string; spellId: string }) {
  const router = useRouter();
  const [data, setData] = useState<SignatureSpellBuilderDto | null>(null);
  const [draft, setDraft] = useState<SignatureSpellDraftDto | null>(null);
  const [evaluation, setEvaluation] = useState<SpellEvaluationDto | null>(null);
  const [save, setSave] = useState<SaveState>("saved");
  const [step, setStep] = useState<BuilderStep>("CONCEPT");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const version = useRef(0);
  const inFlight = useRef<Promise<boolean> | null>(null);
  const pendingDraft = useRef<SignatureSpellDraftDto | null>(null);
  const dirty = useRef(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const view = await getSpellBuilder(characterId, spellId);
      version.current = view.spell.lockVersion;
      setData(view);
      const working = view.spell.draft?.draft ?? null;
      setDraft(working);
      pendingDraft.current = working;
      dirty.current = false;
      setEvaluation(view.spell.draft?.evaluation ?? null);
      setSave("saved");
    } catch (e) {
      setError(e instanceof CharacterApiError ? `${e.message} (${e.code})` : "Could not load the Spell builder.");
    }
  }, [characterId, spellId]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount
    void load();
  }, [load]);

  /** Saves the pending selections (one request at a time); returns whether everything is saved. */
  const persist = useCallback(async (): Promise<boolean> => {
    if (inFlight.current) await inFlight.current;
    if (!dirty.current || pendingDraft.current === null) return true;
    const sending = pendingDraft.current;
    dirty.current = false;
    setSave("saving");
    const run = (async () => {
      try {
        const saved = await saveSpellDraft(characterId, spellId, version.current, sending);
        version.current = saved.spell.lockVersion;
        setEvaluation(saved.spell.draft?.evaluation ?? null);
        setData((d) => (d === null ? d : { ...d, spell: saved.spell, signature: saved.signature, names: { ...d.names, ...saved.names } }));
        setSave(dirty.current ? "unsaved" : "saved");
        return true;
      } catch (e) {
        dirty.current = true;
        if (e instanceof CharacterApiError && e.status === 409) setSave("conflict");
        else {
          setSave("error");
          setMessage(e instanceof CharacterApiError ? `${e.message} (${e.code})` : "Could not save the draft.");
        }
        return false;
      } finally {
        inFlight.current = null;
      }
    })();
    inFlight.current = run;
    return run;
  }, [characterId, spellId]);

  const update = (fn: (d: SignatureSpellDraftDto) => SignatureSpellDraftDto) => {
    setDraft((d) => {
      if (d === null) return d;
      const next = fn(d);
      pendingDraft.current = next;
      dirty.current = true;
      return next;
    });
    setSave((s) => (s === "conflict" ? s : "unsaved"));
  };

  useEffect(() => {
    if (save !== "unsaved") return;
    const t = setTimeout(() => void persist(), AUTOSAVE_MS);
    return () => clearTimeout(t);
  }, [save, draft, persist]);

  useEffect(() => {
    if (save === "saved") return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [save]);

  if (error !== null) return <p className="gov-error" role="alert">{error}</p>;
  if (data === null) return <p role="status">Loading the Spell builder…</p>;
  const id = encodeURIComponent(characterId);
  const detailHref = `/characters/${id}/spells/${encodeURIComponent(spellId)}`;
  const crumbs = (
    <nav className="gov-crumbs" aria-label="Breadcrumb">
      <Link href="/characters">Characters</Link> / <Link href={`/characters/${id}`}>{data.character.name}</Link> / <Link href={`/characters/${id}/abilities`}>Abilities</Link> / <span aria-current="page">Build Spell</span>
    </nav>
  );
  if (draft === null) {
    return (
      <div className="prowess-spell-builder" data-testid="spell-builder-readonly">
        {crumbs}
        <h1>{data.spell.current?.draft?.concept.name ?? "Signature Spell"}</h1>
        {data.spell.status === "ACTIVE" ? (
          <>
            <p>This Spell is finalized (Revision {data.spell.current?.revisionNumber}). Rebuilding starts a new draft from it; the current revision stays in use until a valid rebuild is finalized.</p>
            <button
              type="button"
              className="gov-button gov-button--primary"
              disabled={busy}
              data-testid="spell-start-rebuild"
              onClick={async () => {
                setBusy(true);
                try {
                  await rebuildSpell(characterId, spellId, version.current);
                  await load();
                } catch (e) {
                  setMessage(e instanceof CharacterApiError ? `${e.message} (${e.code})` : "Could not start the rebuild.");
                } finally {
                  setBusy(false);
                }
              }}
            >
              Start rebuild
            </button>
          </>
        ) : (
          <p>A retired Spell is history; it is never edited.</p>
        )}
        {message ? <p role="alert">{message}</p> : null}
        <p>
          <Link href={detailHref}>Back to the Spell</Link>
        </p>
      </div>
    );
  }

  const catalog = data.catalog;
  const names = data.names;
  const c = evaluation?.construction ?? null;
  const targetingOption = draft.targeting ? catalog.targeting.find((o) => o.ref.entityVersionId === draft.targeting!.definition.entityVersionId) ?? null : null;
  const optionOf = (list: readonly SpellComponentOptionDto[], versionId: string) => list.find((o) => o.ref.entityVersionId === versionId) ?? null;
  const effects = sortByOrder(draft.effects);
  const effectFull = c !== null && c.capacity.effects.remaining !== null && c.usage.effects >= c.capacity.effects.remaining;
  const trades = c?.capacity.trades ?? null;
  const goto = (s: BuilderStep) => {
    setStep(s);
    requestAnimationFrame(() => document.getElementById(`spell-step-${s}`)?.focus());
  };
  const chain = draft.effectChain as { failurePolicy?: string; nodes?: Array<{ effectKey: string; behavior: string; branch?: { success: string | null; failure: string | null } }> } | null;

  const finalize = async () => {
    setBusy(true);
    setMessage(null);
    try {
      if (!(await persist())) return;
      await finalizeSpell(characterId, spellId, version.current);
      router.push(detailHref);
    } catch (e) {
      setMessage(e instanceof CharacterApiError ? `${e.message} (${e.code})` : "Could not finalize the Spell.");
      if (e instanceof CharacterApiError && e.status === 409) setSave("conflict");
    } finally {
      setBusy(false);
    }
  };

  const panel = (() => {
    switch (step) {
      case "CONCEPT":
        return (
          <section aria-labelledby="spell-concept-heading">
            <h2 id="spell-concept-heading">Concept</h2>
            <p className="gov-muted">The name and texts are yours. They never create mechanics: damage type, Affinity and every rule come only from the components you choose.</p>
            <label className="gov-field">
              <span>Spell name</span>
              <input value={draft.concept.name} maxLength={120} onChange={(e) => update((d) => ({ ...d, concept: { ...d.concept, name: e.target.value } }))} data-testid="spell-name" />
            </label>
            <label className="gov-field">
              <span>Description</span>
              <textarea value={draft.concept.description} maxLength={4000} onChange={(e) => update((d) => ({ ...d, concept: { ...d.concept, description: e.target.value } }))} data-testid="spell-description" />
            </label>
            <label className="gov-field">
              <span>Visual / narrative description</span>
              <textarea value={draft.concept.visualDescription} maxLength={4000} onChange={(e) => update((d) => ({ ...d, concept: { ...d.concept, visualDescription: e.target.value } }))} />
            </label>
            <label className="gov-field">
              <span>Notes (optional)</span>
              <textarea value={draft.concept.notes} maxLength={4000} onChange={(e) => update((d) => ({ ...d, concept: { ...d.concept, notes: e.target.value } }))} />
            </label>
            <label className="gov-field">
              <span>Narrative tags (comma separated — never mechanical Keywords)</span>
              <input defaultValue={draft.concept.narrativeTags.join(", ")} onBlur={(e) => update((d) => ({ ...d, concept: { ...d.concept, narrativeTags: tagsFromText(e.target.value) } }))} />
            </label>
          </section>
        );
      case "AUTHORITY":
        return (
          <section aria-labelledby="spell-authority-heading">
            <h2 id="spell-authority-heading">Authority</h2>
            <p className="gov-muted">Choose explicitly. Capacities come from the chosen Authority only — Arcane and Affinity capacities never stack. Changing Authority re-validates every component; nothing is removed for you.</p>
            <fieldset>
              <legend>Spell Authority</legend>
              {catalog.vocabularies.authorities.map((a) => (
                <label key={a} className="prowess-spell-choice">
                  <input type="radio" name="spell-authority" checked={draft.authority === a} onChange={() => update((d) => ({ ...d, authority: a as SignatureSpellDraftDto["authority"] }))} data-testid={`spell-authority-${a}`} /> {authorityLabel(a)}
                  {a === "ARCANE_AUTHORITY" ? (
                    <span className="gov-muted">
                      {" "}
                      — your Arcane Authority Skill rank: <strong data-testid="spell-arcana-rank">{catalog.arcana.rankKey ? formatEnumLabel(catalog.arcana.rankKey) : "none"}</strong>
                      {(() => {
                        const row = catalog.arcana.ranks.find((r) => r.rankKey === catalog.arcana.rankKey);
                        return row ? ` (Effects ${row.effectCapacity ?? "—"}, Traits ${row.traitCapacity ?? "—"}, Casting Conditions ${row.conditionCapacity ?? "—"})` : "";
                      })()}
                    </span>
                  ) : null}
                </label>
              ))}
            </fieldset>
            <fieldset data-testid="spell-affinity-choices">
              <legend>{draft.authority === "AFFINITY_AUTHORITY" ? "Affinity (required for Affinity Authority)" : "Governing Affinity (optional)"}</legend>
              <label className="prowess-spell-choice">
                <input type="radio" name="spell-affinity" checked={draft.affinity === null} onChange={() => update((d) => ({ ...d, affinity: null }))} /> None
              </label>
              {catalog.affinities.length === 0 ? <p className="gov-muted">This Character owns no Affinity.</p> : null}
              {catalog.affinities.map((a) => (
                <label key={a.affinity.entityVersionId} className="prowess-spell-choice" data-testid="spell-affinity-option">
                  <input type="radio" name="spell-affinity" checked={draft.affinity?.entityVersionId === a.affinity.entityVersionId} onChange={() => update((d) => ({ ...d, affinity: a.affinity }))} /> <strong>{refName(names, a.affinity)}</strong> — {formatEnumLabel(a.role)}, rank{" "}
                  {formatEnumLabel(a.rank)}
                  <span className="gov-muted">
                    {" "}
                    · Strengths: {a.strengths.map((s) => formatEnumLabel(s.strengthKey)).join(", ") || "none"} · Weaknesses: {a.weaknesses.map((w) => `${formatEnumLabel(w.weaknessKey)}${w.severity ? ` (${formatEnumLabel(w.severity)})` : ""}`).join(", ") || "none"}
                    {a.rankRule ? ` · Authority capacity: Effects ${a.rankRule.effectCapacity ?? "—"}, Traits ${a.rankRule.traitCapacity ?? "—"}; Strength discount ${a.rankRule.strengthDiscountPercent ?? 0}%` : ""}
                  </span>
                </label>
              ))}
            </fieldset>
            {evaluation?.construction ? (
              <p data-testid="spell-authority-result">
                M5: {formatEnumLabel(evaluation.construction.access.path)} — rank {evaluation.construction.access.rank ? formatEnumLabel(evaluation.construction.access.rank) : "none"}
                {evaluation.construction.access.minimumRank ? ` (minimum ${formatEnumLabel(evaluation.construction.access.minimumRank)})` : ""} — {evaluation.construction.access.satisfied ? "access granted" : "access NOT granted"}
              </p>
            ) : null}
          </section>
        );
      case "TARGETING":
        return (
          <section aria-labelledby="spell-targeting-heading">
            <h2 id="spell-targeting-heading">Targeting</h2>
            <ComponentPicker
              title="Targeting options"
              options={catalog.targeting}
              names={names}
              catalog={catalog}
              affinity={draft.affinity}
              selectedVersionIds={draft.targeting ? [draft.targeting.definition.entityVersionId] : []}
              mode="single"
              testId="spell-targeting-picker"
              onPick={(o) => update((d) => ({ ...d, targeting: { definition: o.ref, parameters: {} } }))}
            />
            {draft.targeting && targetingOption ? <ParameterFields label={refName(names, draft.targeting.definition)} declared={targetingOption.parameters} values={draft.targeting.parameters} onChange={(p) => update((d) => ({ ...d, targeting: d.targeting ? { ...d.targeting, parameters: p } : null }))} /> : null}
            {evaluation?.targeting ? (
              <p data-testid="spell-targeting-result">
                Range: {evaluation.targeting.range ? `${evaluation.targeting.range.value ?? "—"} ${evaluation.targeting.range.unit ?? ""}` : "—"}
                {evaluation.targeting.targetCount ? ` · Targets: ${formatEnumLabel(evaluation.targeting.targetCount.kind)}${evaluation.targeting.targetCount.count !== null ? ` (${evaluation.targeting.targetCount.count})` : ""}` : ""}
              </p>
            ) : null}
          </section>
        );
      case "EFFECTS":
        return (
          <section aria-labelledby="spell-effects-heading">
            <h2 id="spell-effects-heading">Effects</h2>
            <p data-testid="spell-effect-capacity">
              Effects used: {c ? `${c.usage.effects} / ${c.capacity.effects.remaining ?? "—"}` : `${draft.effects.length} (capacity shown once Authority, Targeting, an Effect and a Duration are chosen)`}
              {trades && trades.requested > 0 ? ` — ${trades.requested} Effect slot${trades.requested === 1 ? "" : "s"} traded for Traits` : ""}
            </p>
            <ol className="prowess-spell-effects" aria-label="Chosen Effects in order" data-testid="spell-effect-list">
              {effects.map((e, i) => {
                const o = optionOf(catalog.effects, e.definition.entityVersionId);
                const result = evaluation?.effects.find((x) => x.componentKey === e.componentKey);
                const move = (delta: number) =>
                  update((d) => {
                    const list = sortByOrder(d.effects);
                    const to = i + delta;
                    if (to < 0 || to >= list.length) return d;
                    [list[i], list[to]] = [list[to]!, list[i]!];
                    return { ...d, effects: renumber(list) };
                  });
                return (
                  <li key={e.componentKey} data-testid="spell-effect" data-effect={e.componentKey} data-key={e.definition.canonicalKey}>
                    <strong>
                      Effect {i + 1}: {refName(names, e.definition)}
                    </strong>{" "}
                    <span className="gov-muted">({e.componentKey})</span>
                    {result && !result.valid ? <span className="gov-error"> Invalid: {result.problems.join("; ") || "see problems"}</span> : null}
                    {result ? <span className="gov-muted"> · {formatEnumLabel(result.family)} · {formatEnumLabel(result.targetingStatus)}</span> : null}
                    <span className="gov-actions">
                      <button type="button" className="gov-button" disabled={i === 0} onClick={() => move(-1)} aria-label={`Move ${refName(names, e.definition)} earlier`} data-testid="spell-effect-up">
                        ↑ Earlier
                      </button>
                      <button type="button" className="gov-button" disabled={i === effects.length - 1} onClick={() => move(1)} aria-label={`Move ${refName(names, e.definition)} later`} data-testid="spell-effect-down">
                        ↓ Later
                      </button>
                      <button type="button" className="gov-button" onClick={() => update((d) => ({ ...d, effects: renumber(sortByOrder(d.effects).filter((x) => x.componentKey !== e.componentKey)) }))} aria-label={`Remove ${refName(names, e.definition)}`}>
                        Remove
                      </button>
                    </span>
                    {o ? <ParameterFields label={`Effect ${i + 1}`} declared={o.parameters} values={e.parameters} onChange={(p) => update((d) => ({ ...d, effects: d.effects.map((x) => (x.componentKey === e.componentKey ? { ...x, parameters: p } : x)) }))} /> : null}
                  </li>
                );
              })}
            </ol>
            <fieldset className="prowess-spell__exchange" data-testid="spell-trait-exchange">
              <legend>Effect-slot exchange</legend>
              {trades === null ? (
                <p className="gov-muted">The exchange is shown once the Spell can be evaluated.</p>
              ) : !trades.exchangeAvailable ? (
                <p className="gov-muted">The Release offers no Effect-slot exchange.</p>
              ) : (
                <>
                  <p>
                    Traded: {trades.requested} / {trades.maximum} allowed
                  </p>
                  <button type="button" className="gov-button" disabled={trades.requested >= trades.maximum} onClick={() => update((d) => ({ ...d, constructionOptions: { effectSlotsTradedForTraits: d.constructionOptions.effectSlotsTradedForTraits + 1 } }))} data-testid="spell-trade-slot">
                    Trade 1 unused Effect slot for +1 Trait slot
                  </button>{" "}
                  <button type="button" className="gov-button" disabled={trades.requested === 0} onClick={() => update((d) => ({ ...d, constructionOptions: { effectSlotsTradedForTraits: d.constructionOptions.effectSlotsTradedForTraits - 1 } }))} data-testid="spell-untrade-slot">
                    Return 1 traded slot
                  </button>
                  {trades.requested >= trades.maximum ? <p className="gov-muted">No further trade: at least the Release&apos;s minimum number of Effect slots must remain.</p> : null}
                </>
              )}
            </fieldset>
            <ComponentPicker
              title="Add an Effect"
              options={catalog.effects}
              names={names}
              catalog={catalog}
              affinity={draft.affinity}
              selectedVersionIds={[]}
              mode="add"
              compatibleWith={targetingOption?.category ?? null}
              disabledReason={effectFull ? `Effect capacity reached (${c!.usage.effects} / ${c!.capacity.effects.remaining}). Remove an Effect, return a traded slot or choose a different Authority to add another.` : null}
              testId="spell-effect-picker"
              onPick={(o) =>
                update((d) => {
                  const list = sortByOrder(d.effects);
                  return { ...d, effects: renumber([...list, { componentKey: nextKey("effect", d.effects.map((x) => x.componentKey)), definition: o.ref, order: 0, parameters: {} }]) };
                })
              }
            />
          </section>
        );
      case "EFFECT_CHAIN":
        return (
          <section aria-labelledby="spell-chain-heading">
            <h2 id="spell-chain-heading">Effect Chain</h2>
            <p className="gov-muted">The chain uses the Release&apos;s routing vocabulary only. Without an explicit chain, the ruled default applies. A later Effect that is not triggered is not a failure.</p>
            <label>
              <input
                type="checkbox"
                checked={chain !== null}
                data-testid="spell-chain-explicit"
                onChange={(e) =>
                  update((d) => ({
                    ...d,
                    effectChain: e.target.checked ? { failurePolicy: catalog.vocabularies.chainFailurePolicies[0], nodes: sortByOrder(d.effects).map((x) => ({ effectKey: x.componentKey, behavior: catalog.vocabularies.chainBehaviors[0]! })) } : null,
                  }))
                }
              />{" "}
              Author an explicit Effect Chain
            </label>
            {chain !== null ? (
              <>
                <label className="gov-field">
                  <span>Failure policy</span>
                  <select value={chain.failurePolicy ?? ""} onChange={(e) => update((d) => ({ ...d, effectChain: { ...(d.effectChain ?? {}), failurePolicy: e.target.value } }))} data-testid="spell-chain-policy">
                    {catalog.vocabularies.chainFailurePolicies.map((p) => (
                      <option key={p} value={p}>
                        {formatEnumLabel(p)}
                      </option>
                    ))}
                  </select>
                </label>
                <table className="gov-table" data-testid="spell-chain-table">
                  <thead>
                    <tr>
                      <th scope="col">Effect</th>
                      <th scope="col">After it resolves</th>
                      <th scope="col">Branch (success / failure)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {effects.map((e) => {
                      const node = chain.nodes?.find((n) => n.effectKey === e.componentKey);
                      const setNode = (patch: Partial<{ behavior: string; branch: { success: string | null; failure: string | null } | undefined }>) =>
                        update((d) => {
                          const cur = (d.effectChain ?? {}) as typeof chain;
                          const nodes = [...(cur?.nodes ?? [])].filter((n) => n.effectKey !== e.componentKey);
                          const merged = { effectKey: e.componentKey, behavior: node?.behavior ?? catalog.vocabularies.chainBehaviors[0]!, ...(node?.branch ? { branch: node.branch } : {}), ...patch };
                          if (merged.behavior !== BRANCH) delete (merged as { branch?: unknown }).branch;
                          return { ...d, effectChain: { ...cur, nodes: [...nodes, merged] } };
                        });
                      const others = effects.filter((x) => x.componentKey !== e.componentKey);
                      return (
                        <tr key={e.componentKey}>
                          <th scope="row">{refName(names, e.definition)}</th>
                          <td>
                            <select aria-label={`Chain behaviour after ${refName(names, e.definition)}`} value={node?.behavior ?? ""} onChange={(ev) => setNode({ behavior: ev.target.value, ...(ev.target.value === BRANCH ? { branch: { success: others[0]?.componentKey ?? null, failure: others[1]?.componentKey ?? null } } : {}) })} data-testid="spell-chain-behavior">
                              <option value="" disabled>
                                Not listed
                              </option>
                              {catalog.vocabularies.chainBehaviors.map((b) => (
                                <option key={b} value={b}>
                                  {formatEnumLabel(b)}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td>
                            {node?.behavior === BRANCH ? (
                              <>
                                {(["success", "failure"] as const).map((side) => (
                                  <select key={side} aria-label={`On ${side} go to`} value={node.branch?.[side] ?? ""} onChange={(ev) => setNode({ branch: { success: node.branch?.success ?? null, failure: node.branch?.failure ?? null, [side]: ev.target.value === "" ? null : ev.target.value } })}>
                                    <option value="">{side === "success" ? "On success: none" : "On failure: none"}</option>
                                    {others.map((x) => (
                                      <option key={x.componentKey} value={x.componentKey}>
                                        {side === "success" ? "On success: " : "On failure: "}
                                        {refName(names, x.definition)}
                                      </option>
                                    ))}
                                  </select>
                                ))}
                              </>
                            ) : (
                              "—"
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </>
            ) : null}
            {evaluation?.chain ? (
              <>
                <h3>Chain as M5 reads it</h3>
                <ol data-testid="spell-chain-plan">
                  {evaluation.chain.nodes.map((n) => (
                    <li key={n.effectKey}>
                      {refName(names, n.definition)} — {formatEnumLabel(n.resolution ?? "none")}; then {formatEnumLabel(n.behavior)} ({formatEnumLabel(n.behaviorSource)})
                      {n.successor ? ` → ${n.successor}` : ""}
                    </li>
                  ))}
                </ol>
              </>
            ) : null}
          </section>
        );
      case "TRAITS": {
        const scopeTargets = catalog.vocabularies.traitScopeTargets;
        const targetsFor = (scope: string): Array<{ key: string | null; label: string }> => {
          const slot = scopeTargets[scope] ?? null;
          if (slot === null) return [{ key: null, label: "The whole Spell" }];
          if (slot === "effects") return effects.map((e) => ({ key: e.componentKey, label: refName(names, e.definition) }));
          if (slot === "conditions") return draft.castingConditions.map((x) => ({ key: x.componentKey, label: refName(names, x.definition) }));
          return [{ key: slot, label: formatEnumLabel(slot) }];
        };
        return (
          <section aria-labelledby="spell-traits-heading">
            <h2 id="spell-traits-heading">Traits</h2>
            <p data-testid="spell-trait-capacity">
              Traits used: {c ? `${c.traitCapacity.ordinary.used} / ${c.traitCapacity.ordinary.effective ?? "—"} (base ${c.traitCapacity.ordinary.base ?? "—"}${trades && trades.requested > 0 ? `, +${trades.requested} by exchange` : ""})` : `${draft.traits.length} chosen`}
            </p>
            {c?.traitCapacity.affinityAdditional.conflictKey ? (
              <p className="gov-muted">
                Additional Affinity Trait capacity is unresolved (<code>{c.traitCapacity.affinityAdditional.conflictKey}</code>) and refused; Affinity Traits may use ordinary or exchanged slots.
              </p>
            ) : null}
            <ul data-testid="spell-trait-list">
              {draft.traits.map((t) => {
                const o = optionOf(catalog.traits, t.definition.entityVersionId);
                const options = targetsFor(t.appliesTo.scope);
                return (
                  <li key={t.componentKey} data-testid="spell-trait" data-key={t.definition.canonicalKey}>
                    <strong>{refName(names, t.definition)}</strong> — {formatEnumLabel(t.appliesTo.scope)}{" "}
                    {options.length > 0 ? (
                      <select
                        aria-label={`${refName(names, t.definition)} applies to`}
                        value={t.appliesTo.componentKey ?? ""}
                        onChange={(e) => update((d) => ({ ...d, traits: d.traits.map((x) => (x.componentKey === t.componentKey ? { ...x, appliesTo: { ...x.appliesTo, componentKey: e.target.value === "" ? null : e.target.value } } : x)) }))}
                      >
                        {options.map((x) => (
                          <option key={x.key ?? "spell"} value={x.key ?? ""}>
                            {x.label}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span className="gov-error">nothing to apply it to yet</span>
                    )}
                    {draft.authority === "AFFINITY_AUTHORITY" ? (
                      <label>
                        {" "}
                        <input
                          type="checkbox"
                          checked={draft.additionalAffinityTraits.includes(t.componentKey)}
                          onChange={(e) => update((d) => ({ ...d, additionalAffinityTraits: e.target.checked ? [...d.additionalAffinityTraits, t.componentKey] : d.additionalAffinityTraits.filter((k) => k !== t.componentKey) }))}
                        />{" "}
                        Request in additional Affinity Trait capacity
                      </label>
                    ) : null}{" "}
                    <button type="button" className="gov-button" onClick={() => update((d) => ({ ...d, traits: d.traits.filter((x) => x.componentKey !== t.componentKey), additionalAffinityTraits: d.additionalAffinityTraits.filter((k) => k !== t.componentKey) }))} aria-label={`Remove ${refName(names, t.definition)}`}>
                      Remove
                    </button>
                    {o ? <ParameterFields label={refName(names, t.definition)} declared={o.parameters} values={t.parameters} onChange={(p) => update((d) => ({ ...d, traits: d.traits.map((x) => (x.componentKey === t.componentKey ? { ...x, parameters: p } : x)) }))} /> : null}
                  </li>
                );
              })}
            </ul>
            <ComponentPicker
              title="Add a Trait"
              options={catalog.traits}
              names={names}
              catalog={catalog}
              affinity={draft.affinity}
              selectedVersionIds={[]}
              mode="add"
              testId="spell-trait-picker"
              onPick={(o) =>
                update((d) => {
                  // A Trait without an authored scope applies to the whole Spell (the M5 scope whose target slot is none).
                  const scope = o.traitScope ?? Object.keys(scopeTargets).find((k) => scopeTargets[k] === null) ?? "";
                  const target = targetsFor(scope)[0]?.key ?? null;
                  const trait: SpellTraitUseDto = { componentKey: nextKey("trait", d.traits.map((x) => x.componentKey)), definition: o.ref, order: 0, parameters: {}, appliesTo: { scope, componentKey: target } };
                  return { ...d, traits: renumber([...d.traits, trait]) };
                })
              }
            />
            <p className="gov-muted">Metamagic is never added dynamically; only Traits the Release authors are offered.</p>
          </section>
        );
      }
      case "DURATION": {
        const o = draft.duration ? optionOf(catalog.durations, draft.duration.definition.entityVersionId) : null;
        return (
          <section aria-labelledby="spell-duration-heading">
            <h2 id="spell-duration-heading">Duration</h2>
            <ComponentPicker title="Duration options" options={catalog.durations} names={names} catalog={catalog} affinity={draft.affinity} selectedVersionIds={draft.duration ? [draft.duration.definition.entityVersionId] : []} mode="single" testId="spell-duration-picker" onPick={(x) => update((d) => ({ ...d, duration: { definition: x.ref, parameters: {} } }))} />
            {draft.duration && o ? <ParameterFields label={refName(names, draft.duration.definition)} declared={o.parameters} values={draft.duration.parameters} onChange={(p) => update((d) => ({ ...d, duration: d.duration ? { ...d.duration, parameters: p } : null }))} /> : null}
            {o?.futureRuntime ? (
              <p className="gov-muted">
                Runtime metadata: Sustain {o.futureRuntime.sustain ? "yes" : "no"} · Mana Lock {o.futureRuntime.manaLock ? "yes" : "no"} · Concentration {formatEnumLabel(o.futureRuntime.concentration)}
              </p>
            ) : null}
            {evaluation?.runtime.sustain ? (
              <p data-testid="spell-duration-sustain">
                Sustain (M5-WO13 policy): {evaluation.runtime.sustain.mpPerRound ?? "unresolved"} MP and {evaluation.runtime.sustain.apPerRound} AP per round
              </p>
            ) : null}
            {evaluation?.runtime.manaLock ? (
              <p data-testid="spell-duration-mana-lock">
                Mana Lock — Runtime: Deferred, Reason: <code>{evaluation.runtime.manaLock.conflictKey}</code>
              </p>
            ) : null}
          </section>
        );
      }
      case "CASTING_CONDITIONS":
        return (
          <section aria-labelledby="spell-conditions-heading">
            <h2 id="spell-conditions-heading">Casting Conditions</h2>
            <p data-testid="spell-condition-capacity">
              Casting Conditions: {c ? `${c.usage.conditions} / ${c.capacity.conditions.capacity ?? "—"}` : `${draft.castingConditions.length} chosen`} <span className="gov-muted">(capacity always comes from your Arcane Authority Skill rank)</span>
            </p>
            {evaluation?.cost ? (
              <p>
                Listed reduction {evaluation.cost.castingConditions.listedPercent}% → effective {evaluation.cost.castingConditions.effectivePercent}% (cap {evaluation.cost.castingConditions.maximumPercent}%)
              </p>
            ) : null}
            {!catalog.performanceCondition.present ? <p className="gov-muted" data-testid="spell-performance-gap">This Release authors no performance Casting Condition (content gap); none is offered.</p> : null}
            <ul>
              {sortByOrder(draft.castingConditions).map((x) => {
                const o = optionOf(catalog.castingConditions, x.definition.entityVersionId);
                return (
                  <li key={x.componentKey} data-testid="spell-condition" data-key={x.definition.canonicalKey}>
                    <strong>{refName(names, x.definition)}</strong>{" "}
                    <button type="button" className="gov-button" onClick={() => update((d) => ({ ...d, castingConditions: renumber(sortByOrder(d.castingConditions).filter((y) => y.componentKey !== x.componentKey)) }))} aria-label={`Remove ${refName(names, x.definition)}`}>
                      Remove
                    </button>
                    {o ? <ParameterFields label={refName(names, x.definition)} declared={o.parameters} values={x.parameters} onChange={(p) => update((d) => ({ ...d, castingConditions: d.castingConditions.map((y) => (y.componentKey === x.componentKey ? { ...y, parameters: p } : y)) }))} /> : null}
                  </li>
                );
              })}
            </ul>
            <ComponentPicker
              title="Add a Casting Condition"
              options={catalog.castingConditions}
              names={names}
              catalog={catalog}
              affinity={draft.affinity}
              selectedVersionIds={[]}
              mode="add"
              testId="spell-condition-picker"
              onPick={(o) => update((d) => ({ ...d, castingConditions: renumber([...sortByOrder(d.castingConditions), { componentKey: nextKey("condition", d.castingConditions.map((y) => y.componentKey)), definition: o.ref, order: 0, parameters: {} }]) }))}
            />
          </section>
        );
      case "REVIEW":
        return (
          <section aria-labelledby="spell-review-heading">
            <h2 id="spell-review-heading">Review</h2>
            <IssueSummary evaluation={evaluation} onGo={goto} />
            <SpellReview draft={draft} evaluation={evaluation} release={data.release} names={names} />
            <button
              type="button"
              className="gov-button"
              disabled={busy}
              data-testid="spell-validate"
              onClick={async () => {
                setBusy(true);
                try {
                  if (!(await persist())) return;
                  const v = await validateSpell(characterId, spellId, version.current);
                  setEvaluation(v.evaluation);
                  setMessage(`Validated: ${v.evaluation.state === "VALID" || v.evaluation.state === "VALID_WITH_RUNTIME_DEFERRED" ? "ready to finalize" : "not finalizable yet"}.`);
                } catch (e) {
                  setMessage(e instanceof CharacterApiError ? `${e.message} (${e.code})` : "Could not validate.");
                } finally {
                  setBusy(false);
                }
              }}
            >
              Validate
            </button>
          </section>
        );
      case "FINALIZE":
        return (
          <section aria-labelledby="spell-finalize-heading">
            <h2 id="spell-finalize-heading">Finalize</h2>
            {c ? (
              <p data-testid="spell-finalize-slots">
                Signature slots used {c.signature.usedBefore} / {c.signature.capacity ?? "—"} · after finalizing {c.signature.projected} / {c.signature.capacity ?? "—"}
              </p>
            ) : null}
            <IssueSummary evaluation={evaluation} onGo={goto} />
            {evaluation?.state === "VALID_WITH_RUNTIME_DEFERRED" ? <p>This Spell is valid; part of its runtime behaviour is deferred to unresolved M5 rules and is shown wherever the Spell appears.</p> : null}
            <button type="button" className="gov-button gov-button--primary" disabled={busy || !isFinalizable(evaluation?.state) || save === "conflict"} onClick={() => void finalize()} data-testid="spell-finalize">
              {data.spell.current ? `Finalize Revision ${data.spell.current.revisionNumber + 1}` : "Finalize Spell"}
            </button>
            {!isFinalizable(evaluation?.state) ? <p className="gov-muted" data-testid="spell-finalize-unavailable">Finalize is unavailable until the Spell is valid. The draft stays saved.</p> : null}
            {data.spell.current ? (
              <p>
                <button
                  type="button"
                  className="gov-button"
                  disabled={busy}
                  data-testid="spell-discard-rebuild"
                  onClick={async () => {
                    setBusy(true);
                    try {
                      await saveSpellDraft(characterId, spellId, version.current, null);
                      dirty.current = false;
                      setSave("saved");
                      router.push(detailHref);
                    } catch (e) {
                      setMessage(e instanceof CharacterApiError ? `${e.message} (${e.code})` : "Could not discard the rebuild.");
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  Discard rebuild (keep Revision {data.spell.current.revisionNumber})
                </button>
              </p>
            ) : null}
          </section>
        );
    }
  })();

  return (
    <div className="prowess-spell-builder" data-testid="spell-builder">
      {crumbs}
      <header className="prowess-reference__header">
        <h1>{data.spell.current ? `Rebuild: ${data.spell.current.draft?.concept.name ?? "Spell"}` : "Build a Signature Spell"}</h1>
        <p className="gov-muted">
          {data.character.name} · Rules of {data.release.rulesetName} {data.release.versionLabel}. The builder validates; it never casts, rolls or spends.
        </p>
      </header>
      {save === "conflict" ? (
        <p className="gov-error" role="alert" data-testid="spell-conflict">
          This Spell changed elsewhere since you loaded it. <button type="button" className="gov-link-button" onClick={() => void load()}>Reload the saved draft</button> (your unsaved edits will be replaced).
        </p>
      ) : null}
      {message ? (
        <p role="status" data-testid="spell-message">
          {message}
        </p>
      ) : null}
      <StepTabs step={step} onChoose={setStep} evaluation={evaluation} />
      <div className="prowess-spell-builder__layout">
        <div role="tabpanel" id={`spell-panel-${step}`} aria-labelledby={`spell-step-${step}`} className="prowess-spell-builder__panel" data-testid={`spell-panel-${step}`}>
          {panel}
          <p className="gov-actions">
            <button type="button" className="gov-button" disabled={save === "saved" || save === "saving"} onClick={() => void persist()} data-testid="spell-save">
              Save draft
            </button>
          </p>
        </div>
        <LivePanel data={data} draft={draft} evaluation={evaluation} save={save} onGo={goto} />
      </div>
    </div>
  );
}
