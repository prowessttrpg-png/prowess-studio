export interface PaginationProps {
  page: number;
  totalPages: number;
  total: number;
  onPageChange: (page: number) => void;
}

/**
 * Previous/next pagination controls plus a page/result-count status line.
 * Purely presentational — owns no fetching or URL-state logic; the caller
 * (e.g. apps/studio's Compendium) decides what `onPageChange` actually
 * does (update a query param, refetch, etc.), per PAS-10 M1-WO9 §29's
 * "keep Next.js routing/fetching logic in apps/studio."
 *
 * Renders nothing when there's only one page — the caller is expected to
 * only mount this when `totalPages > 0` in the first place (an empty
 * result set shows `EmptyState` instead, never a "Page 1 of 0").
 */
export function Pagination({ page, totalPages, total, onPageChange }: PaginationProps) {
  if (totalPages <= 1) {
    return (
      <div className="prowess-pagination" data-testid="pagination">
        <span className="prowess-pagination__status">
          {total} {total === 1 ? "result" : "results"}
        </span>
      </div>
    );
  }

  const hasPrevious = page > 1;
  const hasNext = page < totalPages;

  return (
    <nav className="prowess-pagination" aria-label="Pagination" data-testid="pagination">
      <button
        type="button"
        className="prowess-pagination__button"
        onClick={() => onPageChange(page - 1)}
        disabled={!hasPrevious}
        aria-label="Previous page"
      >
        Previous
      </button>
      <span className="prowess-pagination__status">
        Page {page} of {totalPages} &middot; {total} {total === 1 ? "result" : "results"}
      </span>
      <button
        type="button"
        className="prowess-pagination__button"
        onClick={() => onPageChange(page + 1)}
        disabled={!hasNext}
        aria-label="Next page"
      >
        Next
      </button>
    </nav>
  );
}
