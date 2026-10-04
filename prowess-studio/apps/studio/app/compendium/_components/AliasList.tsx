import { EmptyState } from "@prowess/ui";
import type { EntityAliasDto } from "../_lib/api-client";

/** Alias display (PAS-10 M1-WO9 §19) — read-only; no alias editing in this Work Order. */
export function AliasList({ aliases }: { aliases: EntityAliasDto[] }) {
  return (
    <section aria-labelledby="aliases-heading" data-testid="aliases-section">
      <h2 id="aliases-heading">Aliases</h2>
      {aliases.length === 0 ? (
        <EmptyState title="No aliases" />
      ) : (
        <ul className="prowess-alias-list">
          {aliases.map((alias) => (
            <li key={alias.id} className="prowess-alias-list__item">
              <span className="prowess-alias-list__alias">{alias.alias}</span>
              {alias.context ? (
                <span className="prowess-alias-list__context">{alias.context}</span>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
