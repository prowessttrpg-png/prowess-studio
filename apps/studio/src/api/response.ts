import { NextResponse } from "next/server";

/** `{ data: ... }` — the standard single-resource success shape (PAS-10 M1-WO8 §3). */
export function apiSuccess<T>(data: T, status = 200): NextResponse {
  return NextResponse.json({ data }, { status });
}

export interface PaginationMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

/** `{ data: [...], pagination: {...} }` — the standard list success shape (PAS-10 M1-WO8 §3). */
export function apiSuccessList<T>(items: T[], page: number, pageSize: number, total: number): NextResponse {
  const pagination: PaginationMeta = {
    page,
    pageSize,
    total,
    totalPages: pageSize > 0 ? Math.ceil(total / pageSize) : 0,
  };
  return NextResponse.json({ data: items, pagination });
}
