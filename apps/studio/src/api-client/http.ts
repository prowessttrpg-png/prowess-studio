/**
 * Transport for the Studio governance UI (PAS-10 M2-WO10 §64). The ONLY place governance UI code calls
 * `fetch`. It calls relative `/api/...` URLs, decodes the standard `{ data }` / `{ data, pagination }` /
 * `{ code, message, field, details }` envelopes, and preserves the server's domain error code. It never
 * re-validates or re-interprets anything the server decided.
 */
export interface PaginationDto {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

/** Thrown for every non-2xx response, network failure, or unreadable/malformed payload. */
export class GovernanceApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly field: string | null;

  constructor(code: string, message: string, status: number, field: string | null = null) {
    super(message);
    this.name = "GovernanceApiError";
    this.code = code;
    this.status = status;
    this.field = field;
  }
}

async function request(method: "GET" | "POST", path: string, body?: unknown): Promise<{ status: number; json: Record<string, unknown> }> {
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new GovernanceApiError("NETWORK_ERROR", "Could not reach the server.", 0);
  }
  let json: unknown;
  try {
    json = await response.json();
  } catch {
    throw new GovernanceApiError("INVALID_RESPONSE", "The server returned an unreadable response.", response.status);
  }
  if (typeof json !== "object" || json === null || Array.isArray(json)) {
    throw new GovernanceApiError("INVALID_RESPONSE", "The server returned an unexpected response shape.", response.status);
  }
  const record = json as Record<string, unknown>;
  if (!response.ok) {
    const code = typeof record.code === "string" ? record.code : "UNKNOWN_ERROR";
    const message = typeof record.message === "string" ? record.message : "The request failed.";
    throw new GovernanceApiError(code, message, response.status, typeof record.field === "string" ? record.field : null);
  }
  if (!("data" in record)) {
    throw new GovernanceApiError("INVALID_RESPONSE", "The server response had no data.", response.status);
  }
  return { status: response.status, json: record };
}

/** GET a single `{ data }` result (which may legitimately be `null`). */
export async function apiGet<T>(path: string): Promise<T> {
  return (await request("GET", path)).json.data as T;
}

/** GET a `{ data, pagination }` list. */
export async function apiList<T>(path: string): Promise<{ items: T[]; pagination: PaginationDto | null }> {
  const { json } = await request("GET", path);
  if (!Array.isArray(json.data)) throw new GovernanceApiError("INVALID_RESPONSE", "Expected a list.", 200);
  return { items: json.data as T[], pagination: (json.pagination as PaginationDto | undefined) ?? null };
}

/** POST a command or creation; returns `data` (201 for creations, 200 for commands). */
export async function apiPost<T>(path: string, body?: unknown): Promise<T> {
  return (await request("POST", path, body)).json.data as T;
}

export function query(params: Record<string, string | number | undefined | null>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") q.set(k, String(v));
  const s = q.toString();
  return s === "" ? "" : `?${s}`;
}
