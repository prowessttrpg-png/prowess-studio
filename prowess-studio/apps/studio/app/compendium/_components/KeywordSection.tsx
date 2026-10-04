import { EmptyState, KeywordChip } from "@prowess/ui";
import type { KeywordAssignmentDto } from "../_lib/api-client";

/**
 * Renders one Keyword assignment list under its own heading (PAS-10
 * M1-WO9 §20–21). Used twice on the detail page with two different
 * headings — "Entity Keywords" and "Latest Revision Keywords" — never
 * merged into one undifferentiated list, preserving the Entity-level vs.
 * Version-level distinction M1-WO5 established. Displaying a Keyword here
 * implies nothing mechanical about it.
 */
export function KeywordSection({
  heading,
  headingId,
  assignments,
  emptyLabel,
}: {
  heading: string;
  headingId: string;
  assignments: KeywordAssignmentDto[];
  emptyLabel: string;
}) {
  return (
    <section aria-labelledby={headingId} data-testid="keyword-section">
      <h2 id={headingId}>{heading}</h2>
      {assignments.length === 0 ? (
        <EmptyState title={emptyLabel} />
      ) : (
        <ul className="prowess-keyword-section__list">
          {assignments.map((assignment) => (
            <li key={assignment.keyword.id}>
              <KeywordChip name={assignment.keyword.name} canonicalKey={assignment.keyword.canonicalKey} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
