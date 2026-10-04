import type { ReactNode } from "react";
import type { AsyncData } from "../_lib/use-version-details";
import { ErrorState } from "./ErrorState";
import { LoadingState } from "./LoadingState";

/**
 * Wraps one VERSION-SCOPED section (a revision's Keywords or Sources,
 * PAS-10 M1-WO10 §22–23). While loading or after a failure it renders the
 * section's own heading with a local loading/error state, so a slow or
 * failed Version-specific request never blanks the rest of the page. Once
 * ready it renders `children`, which supplies the real section (and its
 * own heading).
 */
export function VersionScopedSection<T>({
  heading,
  headingId,
  state,
  loadingLabel,
  onRetry,
  children,
}: {
  heading: string;
  headingId: string;
  state: AsyncData<T>;
  loadingLabel: string;
  onRetry: () => void;
  children: (data: T) => ReactNode;
}) {
  if (state.status === "ready") {
    return <>{children(state.data)}</>;
  }
  return (
    <section aria-labelledby={headingId} data-testid="version-scoped-pending">
      <h2 id={headingId}>{heading}</h2>
      {state.status === "loading" ? (
        <LoadingState label={loadingLabel} />
      ) : (
        <ErrorState message={state.message} onRetry={onRetry} />
      )}
    </section>
  );
}
