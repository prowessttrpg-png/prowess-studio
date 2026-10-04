import { EmptyState, formatEnumLabel } from "@prowess/ui";
import type { SourceDocumentDto, SourceReferenceDto } from "../_lib/api-client";

/**
 * "Sources for Latest Revision" (PAS-10 M1-WO9 §24–26). Scoped explicitly
 * to the Latest Revision — never implied to apply to every historical
 * Version (M1-WO10 will make per-revision provenance more navigable).
 * `file_reference` is shown only as an opaque developer-oriented
 * reference, never opened or parsed. Authority status labels (e.g.
 * `GOVERNING`) are shown as plain descriptive metadata — this page never
 * states or implies that a Source controls an active Ruleset.
 */
export function SourceReferenceSection({
  references,
  documents,
}: {
  references: SourceReferenceDto[];
  documents: Map<string, SourceDocumentDto>;
}) {
  return (
    <section aria-labelledby="sources-heading" data-testid="sources-section">
      <h2 id="sources-heading">Sources for Latest Revision</h2>
      {references.length === 0 ? (
        <EmptyState title="No sources" />
      ) : (
        <ul className="prowess-source-list">
          {references.map((reference) => {
            const document = documents.get(reference.sourceDocumentId);
            return (
              <li key={reference.id} className="prowess-source-list__item">
                <p className="prowess-source-list__title">
                  {document?.title ?? "Unknown source document"}
                  {document?.versionLabel ? ` (${document.versionLabel})` : null}
                </p>
                <dl className="prowess-detail-fields">
                  {document ? (
                    <>
                      <div className="prowess-detail-fields__row">
                        <dt>Source type</dt>
                        <dd>{formatEnumLabel(document.sourceType)}</dd>
                      </div>
                      <div className="prowess-detail-fields__row">
                        <dt>Authority status</dt>
                        <dd>
                          {document.authorityStatus ? (
                            <>
                              <span className="prowess-badge prowess-badge--authority">
                                {formatEnumLabel(document.authorityStatus)}
                              </span>
                              <span className="prowess-source-list__authority-note">
                                Descriptive only — does not control an active Ruleset.
                              </span>
                            </>
                          ) : (
                            <span className="prowess-detail-fields__empty">Not set</span>
                          )}
                        </dd>
                      </div>
                      {document.fileReference ? (
                        <div className="prowess-detail-fields__row">
                          <dt>File reference</dt>
                          <dd>
                            <code className="prowess-source-list__file-reference">
                              {document.fileReference}
                            </code>{" "}
                            <span className="prowess-source-list__opaque-note">(opaque reference)</span>
                          </dd>
                        </div>
                      ) : null}
                    </>
                  ) : null}
                  {reference.sectionLabel ? (
                    <div className="prowess-detail-fields__row">
                      <dt>Section</dt>
                      <dd>{reference.sectionLabel}</dd>
                    </div>
                  ) : null}
                  {reference.pageReference ? (
                    <div className="prowess-detail-fields__row">
                      <dt>Page</dt>
                      <dd>{reference.pageReference}</dd>
                    </div>
                  ) : null}
                  {reference.sourceExcerptNote ? (
                    <div className="prowess-detail-fields__row">
                      <dt>Note</dt>
                      <dd>{reference.sourceExcerptNote}</dd>
                    </div>
                  ) : null}
                </dl>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
