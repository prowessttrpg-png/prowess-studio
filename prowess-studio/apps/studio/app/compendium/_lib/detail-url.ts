/**
 * Builds an Entity-detail URL from the current query string plus changes
 * (PAS-10 M1-WO10 §3). `null` removes a param. Everything not mentioned is
 * preserved — so choosing a revision keeps an active comparison, and
 * "Return to Latest Revision" (`{ revision: null }`) keeps it too.
 */
export function buildDetailHref(
  entityId: string,
  current: URLSearchParams,
  updates: Record<string, string | null>,
): string {
  const params = new URLSearchParams(current.toString());
  for (const [key, value] of Object.entries(updates)) {
    if (value === null) {
      params.delete(key);
    } else {
      params.set(key, value);
    }
  }
  const query = params.toString();
  return `/compendium/entities/${entityId}${query.length > 0 ? `?${query}` : ""}`;
}
