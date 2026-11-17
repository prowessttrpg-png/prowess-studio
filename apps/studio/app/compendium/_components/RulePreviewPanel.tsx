"use client";

import { COMPENDIUM_STAT_TOKENS } from "@prowess/model";
import { formatEnumLabel } from "@prowess/ui";
import { useState } from "react";
import { previewRuleCandidate, type PreviewExampleDto, type RuleCandidatePreviewDto } from "../admin/_lib/authoring-client";

/**
 * PRE-M7-WO1 — side-effect-free rule preview. Sends the SAVED Draft revision ids and explicit example inputs to the
 * server, which evaluates every derived statistic twice through the shared compiler and M4 orchestration: once for the
 * published Release and once for a never-persisted candidate in which the Drafts replace their pins. Nothing is saved,
 * published, cached or applied to any Character. Values shown come only from the server.
 */
type Row = { label: string; level: number; stats: Record<string, number>; baseHp: number; baseMp: number };

const defaultRows = (vary: string): Row[] =>
  [2, 3, 5, 6, 8].map((v) => ({ label: `${vary} ${v}`, level: 1, stats: Object.fromEntries(COMPENDIUM_STAT_TOKENS.map((s) => [s, s === vary ? v : 3])), baseHp: 10, baseMp: 5 }));

const messageOf = (e: unknown) => (e instanceof Error ? e.message : "The preview could not be calculated.");

export function RulePreviewPanel({ releaseId, drafts, vary = "STR", focus = [], unsavedChanges = false, title = "Preview the effect" }: { releaseId: string; drafts: readonly string[]; vary?: string; focus?: readonly string[]; unsavedChanges?: boolean; title?: string }) {
  const [rows, setRows] = useState<Row[]>(() => defaultRows(vary));
  const [result, setResult] = useState<RuleCandidatePreviewDto | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [showAll, setShowAll] = useState(false);

  async function run() {
    setBusy(true);
    setError("");
    try {
      const examples: PreviewExampleDto[] = rows.map((r) => ({ label: r.label, level: r.level, stats: r.stats, baseHp: r.baseHp, baseMp: r.baseMp }));
      setResult(await previewRuleCandidate({ releaseId, drafts: [...drafts], examples }));
    } catch (e) {
      setResult(null);
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  }

  const setNum = (i: number, patch: (r: Row, n: number) => Row) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const n = Number(e.target.value);
    setRows((rs) => rs.map((r, j) => (j === i ? patch(r, Number.isFinite(n) ? Math.trunc(n) : 0) : r)));
  };

  const statistics = result?.examples[0]?.published.values.map((v) => v.statistic) ?? [];
  const shown = statistics.filter((s) => showAll || result?.changed.includes(s) || focus.includes(s));

  return (
    <section className="gov-card prowess-rule-preview" aria-label={title} data-testid="rule-preview">
      <h2>{title}</h2>
      <p className="gov-muted">
        Compares this Release with the same Release using {drafts.length === 0 ? "no Draft changes" : drafts.length === 1 ? "the saved Draft" : `${drafts.length} saved Drafts`}. Nothing is saved or published, and no Character changes.
      </p>
      {unsavedChanges ? (
        <p className="gov-bad" role="note" data-testid="rule-preview-unsaved">
          You have unsaved edits. The preview uses the last saved Draft — save first to include them.
        </p>
      ) : null}
      <details>
        <summary>Example Characters ({rows.length})</summary>
        <div className="prowess-table-scroll">
          <table className="prowess-rule-table" data-testid="rule-preview-examples">
            <thead>
              <tr>
                <th scope="col">Example</th>
                <th scope="col">Level</th>
                {COMPENDIUM_STAT_TOKENS.map((s) => (
                  <th scope="col" key={s}>
                    {s}
                  </th>
                ))}
                <th scope="col">Base HP</th>
                <th scope="col">Base MP</th>
                <th scope="col">
                  <span className="prowess-visually-hidden">Remove</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  <td>
                    <input aria-label={`Example ${i + 1} name`} value={r.label} maxLength={80} onChange={(e) => setRows((rs) => rs.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} />
                  </td>
                  <td>
                    <input aria-label={`${r.label} level`} type="number" min={1} value={r.level} onChange={setNum(i, (x, n) => ({ ...x, level: n }))} className="prowess-rule-preview__num" />
                  </td>
                  {COMPENDIUM_STAT_TOKENS.map((s) => (
                    <td key={s}>
                      <input aria-label={`${r.label} ${s}`} type="number" min={0} value={r.stats[s]} onChange={setNum(i, (x, n) => ({ ...x, stats: { ...x.stats, [s]: n } }))} className="prowess-rule-preview__num" data-testid={`rule-preview-${i}-${s}`} />
                    </td>
                  ))}
                  <td>
                    <input aria-label={`${r.label} base HP`} type="number" min={0} value={r.baseHp} onChange={setNum(i, (x, n) => ({ ...x, baseHp: n }))} className="prowess-rule-preview__num" />
                  </td>
                  <td>
                    <input aria-label={`${r.label} base MP`} type="number" min={0} value={r.baseMp} onChange={setNum(i, (x, n) => ({ ...x, baseMp: n }))} className="prowess-rule-preview__num" />
                  </td>
                  <td>
                    <button type="button" className="gov-link-button" disabled={rows.length === 1} onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}>
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <button type="button" className="gov-button" disabled={rows.length >= 12} onClick={() => setRows((rs) => [...rs, { ...(rs[rs.length - 1] as Row), label: `Example ${rs.length + 1}` }])}>
          Add an example
        </button>
      </details>
      <div className="gov-actions">
        <button type="button" className="gov-button gov-button--primary" onClick={() => void run()} disabled={busy} data-testid="rule-preview-run">
          {busy ? "Calculating…" : "Calculate preview"}
        </button>
      </div>
      {error ? (
        <p className="gov-error" role="alert" data-testid="rule-preview-error">
          {error}
        </p>
      ) : null}
      {result !== null ? (
        <div aria-live="polite" data-testid="rule-preview-result">
          {result.candidateProblems.length > 0 ? (
            <div className="gov-error" role="alert" data-testid="rule-preview-problems">
              <p>The changed rules cannot be calculated:</p>
              <ul>
                {result.candidateProblems.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            </div>
          ) : null}
          <p role="status" data-testid="rule-preview-summary">
            {result.changed.length === 0 ? "No calculated value changes for these examples." : `Changes: ${result.changed.map(formatEnumLabel).join(", ")}.`}
          </p>
          {statistics.length > 0 ? (
            <>
              <label className="prowess-rule-preview__toggle">
                <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} /> Show unchanged values too
              </label>
              <div className="prowess-table-scroll">
                <table className="prowess-rule-table" data-testid="rule-preview-table">
                  <caption className="prowess-visually-hidden">Published value → value with the Draft, per example</caption>
                  <thead>
                    <tr>
                      <th scope="col">Value</th>
                      {result.examples.map((ex) => (
                        <th scope="col" key={ex.label}>
                          {ex.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((s) => (
                      <tr key={s} data-testid={`rule-preview-row-${s}`} data-changed={result.changed.includes(s) ? "true" : "false"}>
                        <th scope="row">{formatEnumLabel(s)}</th>
                        {result.examples.map((ex) => {
                          const before = ex.published.values.find((v) => v.statistic === s)?.value ?? null;
                          const after = ex.candidate.values.find((v) => v.statistic === s)?.value ?? null;
                          return (
                            <td key={ex.label}>
                              {before === after ? (
                                <span>{before ?? "—"}</span>
                              ) : (
                                <span>
                                  {before ?? "—"} → <strong>{after ?? "—"}</strong>
                                </span>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : null}
          {result.examples.some((ex) => !ex.published.ok || !ex.candidate.ok) ? (
            <ul className="gov-muted" data-testid="rule-preview-example-problems">
              {result.examples.flatMap((ex) => [...ex.published.problems.map((p) => `${ex.label} (published): ${p}`), ...ex.candidate.problems.map((p) => `${ex.label} (with Draft): ${p}`)]).map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
