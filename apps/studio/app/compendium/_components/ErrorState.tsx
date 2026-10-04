/**
 * An intentional error state (PAS-10 M1-WO9 §14). `message` must always be
 * a `CompendiumApiError.message` (or an equally safe, pre-sanitized
 * string) — never a raw `Response` body, Prisma detail, or stack trace.
 * The API layer (M1-WO8) already guarantees error messages are safe to
 * display; this component trusts that contract rather than re-sanitizing.
 */
export function ErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}) {
  return (
    <div className="prowess-compendium__error" role="alert" data-testid="error-state">
      <p className="prowess-compendium__error-message">{message}</p>
      {onRetry ? (
        <button type="button" className="prowess-compendium__retry" onClick={onRetry}>
          Try again
        </button>
      ) : null}
    </div>
  );
}
