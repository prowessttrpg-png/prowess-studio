export interface EmptyStateProps {
  title: string;
  description?: string;
}

/**
 * A deliberate "nothing here" state — distinct from an error state (see
 * `apps/studio`'s Compendium error components) so an empty result never
 * looks like a broken application (PAS-10 M1-WO9 §12). `role="status"` so
 * assistive tech announces the state without the page needing a focus
 * change.
 */
export function EmptyState({ title, description }: EmptyStateProps) {
  return (
    <div className="prowess-empty-state" data-testid="empty-state" role="status">
      <p className="prowess-empty-state__title">{title}</p>
      {description ? <p className="prowess-empty-state__description">{description}</p> : null}
    </div>
  );
}
