/**
 * Shared helpers for calling Next.js App Router route handlers directly as
 * functions (no running server needed) against the real
 * `prowess_studio_test` database.
 */

export function jsonRequest(url: string, method: string, body?: unknown): Request {
  return new Request(url, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

export function getRequest(url: string): Request {
  return new Request(url, { method: "GET" });
}

/** Wraps a route param object the way Next.js's async `params` expects it. */
export function routeParams<T extends Record<string, string>>(value: T): { params: Promise<T> } {
  return { params: Promise.resolve(value) };
}

let fixtureCounter = 0;

/** Unique, synthetic canonical keys — never a real Prowess concept. */
export function nextCanonicalKey(label: string): string {
  fixtureCounter += 1;
  return `test.api.${label}_${fixtureCounter}`;
}
