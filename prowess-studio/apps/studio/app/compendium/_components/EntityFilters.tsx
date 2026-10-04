import { formatEnumLabel } from "@prowess/ui";
import { ENTITY_TYPES, ENTITY_VERSION_STATUSES } from "@prowess/model";

export interface EntityFiltersValue {
  search: string;
  entityType: string;
  status: string;
  canonicalKey: string;
  keyword: string;
}

export interface EntityFiltersProps {
  value: EntityFiltersValue;
  onChange: (next: EntityFiltersValue) => void;
}

/**
 * Search + filter controls for the Entity list (PAS-10 M1-WO9 §4–6).
 * Purely controlled — owns no fetching or URL-state itself; `page.tsx` is
 * the one place that decides what a change here actually does (debounce,
 * write to the URL, refetch). `ENTITY_TYPES`/`ENTITY_VERSION_STATUSES` come
 * from `@prowess/model` — the framework-independent domain-types package,
 * safe for Compendium to import (it has zero Prisma/database dependency,
 * unlike `@prowess/db`, which Compendium must never import — PAS-10
 * M1-WO9 §1).
 */
export function EntityFilters({ value, onChange }: EntityFiltersProps) {
  function set<K extends keyof EntityFiltersValue>(key: K, next: EntityFiltersValue[K]) {
    onChange({ ...value, [key]: next });
  }

  return (
    <div className="prowess-entity-filters">
      <div className="prowess-entity-filters__search">
        <label htmlFor="compendium-search" className="prowess-entity-filters__label">
          Search
        </label>
        <input
          id="compendium-search"
          type="search"
          className="prowess-entity-filters__input"
          value={value.search}
          onChange={(event) => set("search", event.target.value)}
          placeholder="Search aliases and revision names…"
        />
        <p className="prowess-entity-filters__hint">
          Searches Entity aliases and EntityVersion display names (any revision). Not a
          full-text or fuzzy search.
        </p>
      </div>

      <div className="prowess-entity-filters__row">
        <div className="prowess-entity-filters__field">
          <label htmlFor="compendium-entity-type" className="prowess-entity-filters__label">
            Entity Type
          </label>
          <select
            id="compendium-entity-type"
            className="prowess-entity-filters__select"
            value={value.entityType}
            onChange={(event) => set("entityType", event.target.value)}
          >
            <option value="">All types</option>
            {ENTITY_TYPES.map((type) => (
              <option key={type} value={type}>
                {formatEnumLabel(type)}
              </option>
            ))}
          </select>
        </div>

        <div className="prowess-entity-filters__field">
          <label htmlFor="compendium-status" className="prowess-entity-filters__label">
            Latest Revision Status
          </label>
          <select
            id="compendium-status"
            className="prowess-entity-filters__select"
            value={value.status}
            onChange={(event) => set("status", event.target.value)}
          >
            <option value="">All statuses</option>
            {ENTITY_VERSION_STATUSES.map((status) => (
              <option key={status} value={status}>
                {formatEnumLabel(status)}
              </option>
            ))}
          </select>
          <p className="prowess-entity-filters__hint">
            Filters by each Entity&rsquo;s latest revision only — not Canon or Ruleset
            resolution.
          </p>
        </div>

        <div className="prowess-entity-filters__field">
          <label htmlFor="compendium-canonical-key" className="prowess-entity-filters__label">
            Canonical Key (exact)
          </label>
          <input
            id="compendium-canonical-key"
            type="text"
            className="prowess-entity-filters__input"
            value={value.canonicalKey}
            onChange={(event) => set("canonicalKey", event.target.value)}
            placeholder="spell.effect.damage.direct"
          />
        </div>

        <div className="prowess-entity-filters__field">
          <label htmlFor="compendium-keyword" className="prowess-entity-filters__label">
            Keyword ID
          </label>
          <input
            id="compendium-keyword"
            type="text"
            className="prowess-entity-filters__input"
            value={value.keyword}
            onChange={(event) => set("keyword", event.target.value)}
            placeholder="Keyword UUID"
          />
          <p className="prowess-entity-filters__hint">
            Matches Entity-level Keyword assignments only (not Latest Revision Keywords).
          </p>
        </div>
      </div>
    </div>
  );
}
