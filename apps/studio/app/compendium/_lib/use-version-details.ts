import { useCallback, useEffect, useRef, useState } from "react";
import {
  CompendiumApiError,
  listEntityVersionKeywords,
  listEntityVersionSources,
  resolveSourceDocuments,
  type KeywordAssignmentDto,
  type SourceDocumentDto,
  type SourceReferenceDto,
} from "./api-client";

export type AsyncData<T> =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: T };

export interface VersionSources {
  references: SourceReferenceDto[];
  documents: Map<string, SourceDocumentDto>;
}

export interface VersionDetailState {
  keywords: AsyncData<KeywordAssignmentDto[]>;
  sources: AsyncData<VersionSources>;
}

const LOADING = { status: "loading" } as const;

function messageFrom(error: unknown, fallback: string): string {
  return error instanceof CompendiumApiError ? error.message : fallback;
}

/**
 * Loads the VERSION-SCOPED data (Keywords and Sources) for the given
 * Version ids (PAS-10 M1-WO10 §19–23, §37). Stable Entity-level data is
 * deliberately not handled here — it loads once, elsewhere, and is never
 * refetched when the selected revision changes.
 *
 * Each Version's Keywords and Sources are requested at most once per page
 * lifetime (a small per-page cache, not a cache framework), and fail
 * independently: a Keyword failure never hides Sources or the Entity. The
 * SourceDocument cache is shared across Versions, so two revisions citing
 * the same document cost one document request.
 *
 * "Loading" is derived from the absence of an entry rather than set
 * synchronously inside the effect.
 */
export function useVersionDetails(versionIds: string[]) {
  const [states, setStates] = useState<Record<string, Partial<VersionDetailState>>>({});
  const [retryTick, setRetryTick] = useState(0);
  const requested = useRef(new Set<string>());
  const documentCache = useRef(new Map<string, Promise<SourceDocumentDto>>());
  const idsKey = versionIds.join(",");

  const patch = useCallback((id: string, partial: Partial<VersionDetailState>) => {
    setStates((previous) => ({ ...previous, [id]: { ...previous[id], ...partial } }));
  }, []);

  useEffect(() => {
    const ids = idsKey === "" ? [] : idsKey.split(",");
    for (const id of ids) {
      if (!requested.current.has(`keywords:${id}`)) {
        requested.current.add(`keywords:${id}`);
        void listEntityVersionKeywords(id).then(
          (data) => patch(id, { keywords: { status: "ready", data } }),
          (error: unknown) =>
            patch(id, {
              keywords: {
                status: "error",
                message: messageFrom(error, "Could not load this revision's Keywords."),
              },
            }),
        );
      }
      if (!requested.current.has(`sources:${id}`)) {
        requested.current.add(`sources:${id}`);
        void listEntityVersionSources(id)
          .then(async (references) => ({
            references,
            documents: await resolveSourceDocuments(references, documentCache.current),
          }))
          .then(
            (data) => patch(id, { sources: { status: "ready", data } }),
            (error: unknown) =>
              patch(id, {
                sources: {
                  status: "error",
                  message: messageFrom(error, "Could not load this revision's Sources."),
                },
              }),
          );
      }
    }
  }, [idsKey, retryTick, patch]);

  const get = (id: string): VersionDetailState => ({
    keywords: states[id]?.keywords ?? LOADING,
    sources: states[id]?.sources ?? LOADING,
  });

  const retry = useCallback((id: string, part: "keywords" | "sources") => {
    requested.current.delete(`${part}:${id}`);
    setStates((previous) => {
      const current = { ...previous[id] };
      delete current[part];
      return { ...previous, [id]: current };
    });
    setRetryTick((tick) => tick + 1);
  }, []);

  return { get, retry };
}
