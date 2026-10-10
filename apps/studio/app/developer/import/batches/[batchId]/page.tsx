"use client";

import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import {
  analyzeMatches,
  completeImportReview,
  extractImportBatch,
  getCandidate,
  getImportBatch,
  getReviewSummary,
  getSourceOutline,
  listBatchCandidates,
  listBatchDecisions,
  listCandidateDecisions,
  listMatchRuns,
  verifyExtraction,
  type ExtractionCandidateDto,
  type ImportBatchDto,
  type SourceSectionDto,
} from "../../../../../src/api-client";
import { IdLine, Loading, Resource, useResource } from "../../../rulesets/_components/primitives";
import { CandidateDetail } from "../../_components/candidate";
import { BatchLifecycle, BatchStatusBadge, BoundaryNote, CandidateStatusBadge, ConfidenceBadge, ImportError, KindBadge, ReviewProgress, TechnicalDetails } from "../../_components/common";
import {
  CompleteReviewPanel,
  ConflictEvidence,
  DecisionHistory,
  DecisionPanel,
  MatchAssessmentView,
  MatchRunSelector,
  SourceEvidence,
  useAssessment,
  useCandidateGroups,
} from "../../_components/review";
import { candidateSectionId, extractorTitle, formatDate, REVIEWABLE_BATCH, sectionPath, shortHash } from "../../_lib/presentation";

const TABS = [
  { id: "queue", label: "Queue" },
  { id: "source", label: "Source" },
  { id: "details", label: "Details" },
  { id: "history", label: "History" },
] as const;
type Tab = (typeof TABS)[number]["id"];
const PAGE_SIZE = 25;
const int = (v: string | null, d: number) => (v !== null && /^\d+$/.test(v) ? Number(v) : d);

function BatchHeader({ batch, sections }: { batch: ImportBatchDto; sections: readonly SourceSectionDto[] }) {
  return (
    <header className="imp-batch-header" aria-label="Batch">
      <h1>
        {batch.label} <BatchStatusBadge status={batch.status} />
      </h1>
      <BatchLifecycle status={batch.status} />
      <dl className="imp-fields">
        <div>
          <dt>Source</dt>
          <dd>
            <Link href={`/developer/import/sources/${batch.sourceSnapshotId}`}>Source Snapshot {batch.sourceSnapshotId.slice(0, 8)}</Link>
          </dd>
        </div>
        <div>
          <dt>Scope</dt>
          <dd>{batch.scopeType === "SNAPSHOT" ? "Whole Snapshot" : `Section Subtree: ${sectionPath(batch.scopeSectionId, sections) ?? batch.scopeSectionId}`}</dd>
        </div>
        <div>
          <dt>Extractor</dt>
          <dd>
            {extractorTitle(batch.extractorKey, batch.extractorVersion)} <code>{`${batch.extractorKey}@${batch.extractorVersion}`}</code>
          </dd>
        </div>
        <div>
          <dt>Comparison context</dt>
          <dd>{batch.comparisonManifestId ? `Manifest ${batch.comparisonManifestId.slice(0, 8)} (exact, historical)` : "None"}</dd>
        </div>
        <div>
          <dt>Created</dt>
          <dd>{formatDate(batch.createdAt)}</dd>
        </div>
        <div>
          <dt>Extraction output hash</dt>
          <dd>
            <code data-testid="output-hash">{shortHash(batch.extractionOutputHash)}</code>
          </dd>
        </div>
      </dl>
      <TechnicalDetails
        rows={[
          ["Batch id", <IdLine key="b" id={batch.id} />],
          ["Batch fingerprint", batch.batchFingerprint],
          ["Structure hash", batch.sourceStructureHash],
          ["Extraction output hash", batch.extractionOutputHash ?? "—"],
          ["Review Ruleset", batch.reviewRulesetId ?? "—"],
          ["Comparison Manifest", batch.comparisonManifestId ?? "—"],
        ]}
      />
    </header>
  );
}

function Integrity({ batch }: { batch: ImportBatchDto }) {
  const v = useResource(() => (batch.extractionOutputHash ? verifyExtraction(batch.id) : Promise.resolve(null)), [batch.id, batch.extractionOutputHash]);
  if (!batch.extractionOutputHash) return null;
  return (
    <section aria-label="Extraction integrity" className="imp-integrity" data-testid="extraction-integrity">
      <h4>Extraction Integrity</h4>
      {v.loading ? <Loading label="Verifying…" /> : null}
      {v.error ? <ImportError error={v.error} title="Verification unavailable" /> : null}
      {v.data ? (
        v.data.persistedSetMatches && v.data.extractorOutputMatches ? (
          <p data-testid="integrity-ok">✓ Stored candidate set matches output hash</p>
        ) : (
          <p data-testid="integrity-mismatch">⚠ Verification mismatch (stored set: {v.data.persistedSetMatches ? "matches" : "differs"}; extractor re-run: {v.data.extractorOutputMatches ? "matches" : "differs"})</p>
        )
      ) : null}
      <p className="gov-muted">Integrity is separate from review status; checking it changes nothing.</p>
    </section>
  );
}

function CandidateInspector({
  candidateId,
  batch,
  matchRunId,
  nonce,
  onRecorded,
}: {
  candidateId: string;
  batch: ImportBatchDto;
  matchRunId: string | null;
  nonce: number;
  onRecorded: (advance: boolean) => void;
}) {
  const candidate = useResource(() => getCandidate(candidateId), [candidateId, nonce]);
  const history = useResource(() => listCandidateDecisions(candidateId, { pageSize: 100 }), [candidateId, nonce]);
  const assessment = useAssessment(matchRunId, candidateId);
  const groups = useCandidateGroups(matchRunId, candidateId);
  const refresh = () => {
    candidate.reload();
    history.reload();
  };
  return (
    <Resource state={candidate}>
      {(c: ExtractionCandidateDto) => (
        <>
          <CandidateDetail candidate={c} />
          <section aria-label="Match analysis">
            <h4>Match Analysis</h4>
            {!matchRunId ? <p className="gov-muted">No exact MatchRun selected.</p> : null}
            {assessment.data ? <MatchAssessmentView assessment={assessment.data} /> : null}
            {"error" in assessment && assessment.error ? <ImportError error={assessment.error} title="Assessment unavailable" /> : null}
            {groups.length > 0 ? (
              <p data-testid="duplicate-membership">
                Potentially same Entity identity as other Candidates ({groups.length} duplicate group{groups.length === 1 ? "" : "s"}) — not a delete instruction.
              </p>
            ) : null}
            <ConflictEvidence batchId={batch.id} matchRunId={matchRunId} candidateId={c.id} />
          </section>
          <DecisionPanel
            candidate={c}
            batch={batch}
            matchRunId={matchRunId}
            assessment={assessment.data}
            groups={groups}
            history={history.data?.items ?? []}
            onRecorded={(_d, advance) => {
              refresh();
              onRecorded(advance);
            }}
            onStale={refresh}
          />
        </>
      )}
    </Resource>
  );
}

function Workspace() {
  const { batchId } = useParams<{ batchId: string }>();
  const search = useSearchParams();
  const router = useRouter();
  const page = int(search.get("page"), 1);
  const historyPage = int(search.get("historyPage"), 1);
  const selectedId = search.get("candidate");
  const [tab, setTab] = useState<Tab>(selectedId ? "details" : "queue");
  const [nonce, setNonce] = useState(0);
  const [busy, setBusy] = useState<"extract" | "match" | null>(null);
  const [commandError, setCommandError] = useState<unknown>(null);

  const batch = useResource(() => getImportBatch(batchId), [batchId, nonce]);
  const outline = useResource(() => (batch.data ? getSourceOutline(batch.data.sourceSnapshotId) : Promise.resolve(null)), [batch.data?.sourceSnapshotId]);
  const runs = useResource(() => listMatchRuns(batchId, { pageSize: 100 }), [batchId, nonce]);
  const runParam = search.get("matchRun");
  const onlyRun = runs.data && runs.data.items.length === 1 ? runs.data.items[0]!.id : null;
  const matchRunId = runParam ?? onlyRun;
  const summary = useResource(() => getReviewSummary(batchId, matchRunId ?? undefined), [batchId, matchRunId, nonce]);
  const candidates = useResource(() => listBatchCandidates(batchId, { page, pageSize: PAGE_SIZE }), [batchId, page, nonce]);
  const batchHistory = useResource(() => listBatchDecisions(batchId, { page: historyPage, pageSize: 25 }), [batchId, historyPage, nonce]);
  const sections = outline.data?.sections ?? [];

  const navigate = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(search.toString());
    for (const [k, v] of Object.entries(changes)) {
      if (v === null) next.delete(k);
      else next.set(k, v);
    }
    next.delete("existing");
    router.replace(`/developer/import/batches/${batchId}?${next.toString()}`, { scroll: false });
  };
  const select = (id: string) => {
    navigate({ candidate: id });
    setTab("details");
  };
  const items = candidates.data?.items ?? [];
  const index = items.findIndex((c) => c.id === selectedId);
  const step = (delta: number) => {
    const target = items[index + delta];
    if (target) select(target.id);
  };

  const run = async (kind: "extract" | "match") => {
    setBusy(kind);
    setCommandError(null);
    try {
      if (kind === "extract") await extractImportBatch(batchId);
      else {
        const { run: r } = await analyzeMatches(batchId);
        navigate({ matchRun: r.id });
      }
      setNonce((n) => n + 1);
    } catch (e) {
      setCommandError(e);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Resource state={batch}>
      {(b: ImportBatchDto) => {
        const readOnly = b.status === "COMPLETED";
        return (
          <div className="imp-batch" data-testid="batch-workspace" data-read-only={readOnly ? "true" : undefined}>
            <BatchHeader batch={b} sections={sections} />
            {search.get("existing") ? <p role="status">An identical Batch already existed for this exact source, scope and extractor — this is that Batch; nothing new was created.</p> : null}
            <BoundaryNote>Approved for Import is not Canon. An Import Conflict is not a Ruleset RuleConflict. Review Complete is not published or imported content.</BoundaryNote>
            {commandError ? <ImportError error={commandError} title={busy === "match" ? "Matching failed" : "Command failed"} /> : null}
            {b.status === "CREATED" ? (
              <section aria-label="Extraction" className="gov-card">
                <p>This Batch has not been extracted yet. Extraction runs the Batch&apos;s exact registered extractor over its pinned source structure.</p>
                <button type="button" className="gov-button gov-button--primary" onClick={() => void run("extract")} disabled={busy !== null} aria-busy={busy === "extract"}>
                  {busy === "extract" ? "Extracting…" : "Run Extraction"}
                </button>
              </section>
            ) : null}

            <div className="imp-tabs" role="tablist" aria-label="Workspace panes">
              {TABS.map((t) => (
                <button key={t.id} type="button" role="tab" id={`tab-${t.id}`} aria-selected={tab === t.id} aria-controls={`pane-${t.id}`} className="imp-tab" onClick={() => setTab(t.id)}>
                  {t.label}
                </button>
              ))}
            </div>

            <div className="imp-workspace" data-tab={tab}>
              <aside className="imp-pane imp-pane--source" id="pane-source" role="tabpanel" aria-labelledby="tab-source" data-pane="source" aria-label="Context and source evidence">
                <Integrity batch={b} />
                <Resource state={runs}>
                  {({ items: runItems }) => (
                    <MatchRunSelector runs={runItems} selectedId={matchRunId} onSelect={(id) => navigate({ matchRun: id })} onAnalyze={() => void run("match")} busy={busy === "match"} readOnly={readOnly || !REVIEWABLE_BATCH(b.status)} />
                  )}
                </Resource>
                {onlyRun && !runParam ? <p className="gov-muted" data-testid="only-run-note">Only one MatchRun exists, so it is shown ({onlyRun.slice(0, 8)}). Nothing is stored as “current”.</p> : null}
                {selectedId && outline.data ? (
                  <EvidenceFor key={`${selectedId}:${nonce}`} candidateId={selectedId} sections={sections} snapshotId={b.sourceSnapshotId} />
                ) : (
                  <p className="gov-muted">Select a Candidate to see its exact source evidence.</p>
                )}
              </aside>

              <section className="imp-pane imp-pane--queue" id="pane-queue" role="tabpanel" aria-labelledby="tab-queue" data-pane="queue" aria-label="Review queue">
                <Resource state={summary}>{(s) => <ReviewProgress summary={s} />}</Resource>
                <Resource state={candidates}>
                  {({ items: rows, pagination }) =>
                    rows.length === 0 ? (
                      <p className="gov-muted">{b.status === "CREATED" ? "Batch not extracted — run extraction to produce Candidates." : "No Candidates were extracted."}</p>
                    ) : (
                      <>
                        <p className="gov-muted">Source order. {pagination ? `Page ${pagination.page} of ${pagination.totalPages} · ${pagination.total} Candidates` : null}</p>
                        <ul className="imp-queue" aria-label="Candidates">
                          {rows.map((c) => (
                            <li key={c.id}>
                              <button type="button" className="imp-queue__row" aria-current={c.id === selectedId ? "true" : undefined} onClick={() => select(c.id)} data-testid="queue-row" data-ordinal={c.ordinal}>
                                <span className="imp-queue__ordinal">#{c.ordinal}</span> <span className="imp-queue__label">{c.displayLabel}</span>
                                <span className="imp-badges">
                                  <KindBadge kind={c.candidateKind} /> <ConfidenceBadge confidence={c.confidence} /> <CandidateStatusBadge status={c.status} />
                                </span>
                                <span className="gov-muted imp-queue__context">{sectionPath(candidateSectionId(c, sections), sections) ?? "outside any section"}</span>
                              </button>
                            </li>
                          ))}
                        </ul>
                        <nav aria-label="Candidate navigation" className="gov-actions">
                          <button type="button" className="gov-button" onClick={() => step(-1)} disabled={index <= 0}>
                            Previous Candidate
                          </button>
                          <button type="button" className="gov-button" onClick={() => step(1)} disabled={index < 0 || index >= rows.length - 1}>
                            Next Candidate
                          </button>
                          {pagination && pagination.totalPages > 1 ? (
                            <>
                              <button type="button" className="gov-button" disabled={page <= 1} onClick={() => navigate({ page: String(page - 1) })}>
                                Previous page
                              </button>
                              <button type="button" className="gov-button" disabled={page >= pagination.totalPages} onClick={() => navigate({ page: String(page + 1) })}>
                                Next page
                              </button>
                            </>
                          ) : null}
                        </nav>
                      </>
                    )
                  }
                </Resource>
                <Resource state={summary}>{(s) => <CompleteReviewPanel batch={b} summary={s} onComplete={async () => {
                  try {
                    await completeImportReview(batchId);
                  } catch (e) {
                    setCommandError(e);
                  }
                  setNonce((n) => n + 1);
                }} />}</Resource>
              </section>

              <section className="imp-pane imp-pane--details" id="pane-details" role="tabpanel" aria-labelledby="tab-details" data-pane="details" aria-label="Inspector">
                {selectedId ? (
                  <CandidateInspector
                    key={selectedId}
                    candidateId={selectedId}
                    batch={b}
                    matchRunId={matchRunId}
                    nonce={nonce}
                    onRecorded={(advance) => {
                      setNonce((n) => n + 1);
                      if (advance) step(1);
                    }}
                  />
                ) : (
                  <p className="gov-muted">Select a Candidate from the queue.</p>
                )}
              </section>

              <section className="imp-pane imp-pane--history" id="pane-history" role="tabpanel" aria-labelledby="tab-history" data-pane="history" aria-label="History">
                {selectedId ? <CandidateHistory candidateId={selectedId} nonce={nonce} /> : null}
                <Resource state={batchHistory}>
                  {({ items: decisions, pagination }) => (
                    <>
                      <DecisionHistory decisions={decisions} title="Batch decision history" />
                      {pagination && pagination.totalPages > 1 ? (
                        <nav aria-label="History pages" className="gov-actions">
                          <button type="button" className="gov-button" disabled={historyPage <= 1} onClick={() => navigate({ historyPage: String(historyPage - 1) })}>
                            Previous history page
                          </button>
                          <button type="button" className="gov-button" disabled={historyPage >= pagination.totalPages} onClick={() => navigate({ historyPage: String(historyPage + 1) })}>
                            Next history page
                          </button>
                        </nav>
                      ) : null}
                    </>
                  )}
                </Resource>
              </section>
            </div>
          </div>
        );
      }}
    </Resource>
  );
}

function EvidenceFor({ candidateId, sections, snapshotId }: { candidateId: string; sections: readonly SourceSectionDto[]; snapshotId: string }) {
  const candidate = useResource(() => getCandidate(candidateId), [candidateId]);
  return <Resource state={candidate}>{(c: ExtractionCandidateDto) => <SourceEvidence candidate={c} sections={sections} snapshotId={snapshotId} />}</Resource>;
}

function CandidateHistory({ candidateId, nonce }: { candidateId: string; nonce: number }) {
  const history = useResource(() => listCandidateDecisions(candidateId, { pageSize: 100 }), [candidateId, nonce]);
  return <Resource state={history}>{({ items }) => <DecisionHistory decisions={items} title="Candidate decision history" />}</Resource>;
}

export default function BatchWorkspacePage() {
  return (
    <Suspense fallback={<Loading />}>
      <Workspace />
    </Suspense>
  );
}
