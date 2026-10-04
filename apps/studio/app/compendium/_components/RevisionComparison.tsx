import { KeywordChip, VersionStatusBadge } from "@prowess/ui";
import type { ReactNode } from "react";
import type { EntityVersionDto, KeywordAssignmentDto } from "../_lib/api-client";
import { categorizeKeywords, sameJson } from "../_lib/revision-selection";
import type { AsyncData, VersionSources } from "../_lib/use-version-details";
import { SourceReferenceSection } from "./SourceReferenceSection";
import { StructuredDataViewer } from "./StructuredDataViewer";

export interface ComparisonSide {
  version: EntityVersionDto;
  keywords: AsyncData<KeywordAssignmentDto[]>;
  sources: AsyncData<VersionSources>;
}

function Text({ value }: { value: string | null }) {
  return value === null ? (
    <span className="prowess-detail-fields__empty">None</span>
  ) : (
    <span className="prowess-compare-field__text">{value}</span>
  );
}

function CompareField({
  label,
  testId,
  same,
  aLabel,
  bLabel,
  a,
  b,
}: {
  label: string;
  testId: string;
  same: boolean;
  aLabel: string;
  bLabel: string;
  a: ReactNode;
  b: ReactNode;
}) {
  return (
    <div className="prowess-compare-field" data-testid={`compare-field-${testId}`}>
      <h3 className="prowess-compare-field__label">{label}</h3>
      <p className="prowess-compare-field__state">
        {same ? "Identical in both revisions" : "Differs between revisions"}
      </p>
      <div className="prowess-compare-field__columns">
        <div className="prowess-compare-field__cell" data-testid={`compare-${testId}-a`}>
          <span className="prowess-compare-field__side">{aLabel}</span>
          {a}
        </div>
        <div className="prowess-compare-field__cell" data-testid={`compare-${testId}-b`}>
          <span className="prowess-compare-field__side">{bLabel}</span>
          {b}
        </div>
      </div>
    </div>
  );
}

function KeywordGroup({
  title,
  testId,
  items,
}: {
  title: string;
  testId: string;
  items: KeywordAssignmentDto[];
}) {
  return (
    <div className="prowess-compare-keywords__group" data-testid={`compare-keywords-${testId}`}>
      <h4>{title}</h4>
      {items.length === 0 ? (
        <p className="prowess-detail-fields__empty">None</p>
      ) : (
        <ul className="prowess-keyword-section__list">
          {items.map((assignment) => (
            <li key={assignment.keyword.id}>
              <KeywordChip
                name={assignment.keyword.name}
                canonicalKey={assignment.keyword.canonicalKey}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Lightweight side-by-side comparison of two revisions (PAS-10 M1-WO10
 * §12–15). Textual only: it reports THAT two values differ, never which is
 * better, and attaches no mechanical meaning to a changed number (a changed
 * JSON value is not a "buff" or "nerf"). Keywords are categorized by
 * KeywordDefinition id; Sources stay Version-specific, and different
 * Sources do not imply one revision supersedes another. Which side is "A"
 * or "B" is carried in visible text, not color.
 */
export function RevisionComparison({ a, b }: { a: ComparisonSide; b: ComparisonSide }) {
  const aLabel = `Revision A (Revision ${a.version.revisionNumber})`;
  const bLabel = `Revision B (Revision ${b.version.revisionNumber})`;

  return (
    <section aria-labelledby="comparison-result-heading" data-testid="revision-comparison">
      <h2 id="comparison-result-heading">
        Revision Comparison — Revision {a.version.revisionNumber} and Revision {b.version.revisionNumber}
      </h2>
      <p className="prowess-compare-note">
        A textual side-by-side only. A difference here carries no game-balance or mechanical
        meaning, and neither revision is treated as better, newer in authority, or active.
      </p>

      <CompareField
        label="Display name"
        testId="display-name"
        same={a.version.displayName === b.version.displayName}
        aLabel={aLabel}
        bLabel={bLabel}
        a={<Text value={a.version.displayName} />}
        b={<Text value={b.version.displayName} />}
      />
      <CompareField
        label="Short description"
        testId="short-description"
        same={a.version.shortDescription === b.version.shortDescription}
        aLabel={aLabel}
        bLabel={bLabel}
        a={<Text value={a.version.shortDescription} />}
        b={<Text value={b.version.shortDescription} />}
      />
      <CompareField
        label="Rules text"
        testId="rules-text"
        same={a.version.rulesText === b.version.rulesText}
        aLabel={aLabel}
        bLabel={bLabel}
        a={<Text value={a.version.rulesText} />}
        b={<Text value={b.version.rulesText} />}
      />
      <CompareField
        label="Status"
        testId="status"
        same={a.version.status === b.version.status}
        aLabel={aLabel}
        bLabel={bLabel}
        a={<VersionStatusBadge status={a.version.status} />}
        b={<VersionStatusBadge status={b.version.status} />}
      />
      <CompareField
        label="Change type"
        testId="change-type"
        same={a.version.changeType === b.version.changeType}
        aLabel={aLabel}
        bLabel={bLabel}
        a={<Text value={a.version.changeType} />}
        b={<Text value={b.version.changeType} />}
      />
      <CompareField
        label="Change summary"
        testId="change-summary"
        same={a.version.changeSummary === b.version.changeSummary}
        aLabel={aLabel}
        bLabel={bLabel}
        a={<Text value={a.version.changeSummary} />}
        b={<Text value={b.version.changeSummary} />}
      />
      <CompareField
        label="Structured data"
        testId="structured-data"
        same={sameJson(a.version.structuredData, b.version.structuredData)}
        aLabel={aLabel}
        bLabel={bLabel}
        a={
          <StructuredDataViewer
            data={a.version.structuredData}
            emptyLabel="No structured data"
            label={`Structured data, Revision ${a.version.revisionNumber}`}
          />
        }
        b={
          <StructuredDataViewer
            data={b.version.structuredData}
            emptyLabel="No structured data"
            label={`Structured data, Revision ${b.version.revisionNumber}`}
          />
        }
      />

      <div className="prowess-compare-keywords" data-testid="compare-keywords">
        <h3>Version Keywords</h3>
        {a.keywords.status === "ready" && b.keywords.status === "ready" ? (
          (() => {
            const { onlyA, shared, onlyB } = categorizeKeywords(a.keywords.data, b.keywords.data);
            return (
              <>
                <KeywordGroup title={`Only in ${aLabel}`} testId="only-a" items={onlyA} />
                <KeywordGroup title="In both revisions" testId="shared" items={shared} />
                <KeywordGroup title={`Only in ${bLabel}`} testId="only-b" items={onlyB} />
              </>
            );
          })()
        ) : a.keywords.status === "error" || b.keywords.status === "error" ? (
          <p role="alert">Could not load Keywords for one of the revisions.</p>
        ) : (
          <p role="status">Loading Keywords…</p>
        )}
      </div>

      <div className="prowess-compare-sources">
        <p className="prowess-compare-note">
          Sources are recorded per revision. Different Sources do not mean one revision
          supersedes the other.
        </p>
        <div className="prowess-compare-field__columns">
          {[
            { side: a, key: "a" },
            { side: b, key: "b" },
          ].map(({ side, key }) =>
            side.sources.status === "ready" ? (
              <SourceReferenceSection
                key={key}
                references={side.sources.data.references}
                documents={side.sources.data.documents}
                heading={`Sources for Revision ${side.version.revisionNumber}`}
                headingId={`compare-sources-${key}-heading`}
                testId={`compare-sources-${key}`}
              />
            ) : (
              <p key={key} role={side.sources.status === "error" ? "alert" : "status"}>
                {side.sources.status === "error"
                  ? `Could not load Sources for Revision ${side.version.revisionNumber}.`
                  : `Loading Sources for Revision ${side.version.revisionNumber}…`}
              </p>
            ),
          )}
        </div>
      </div>
    </section>
  );
}
