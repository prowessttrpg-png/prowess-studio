import { timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

export function proxy(request: NextRequest) {
  if (process.env.PROWESS_DESKTOP_MODE !== "true") return NextResponse.next();

  const secret = process.env.PROWESS_DESKTOP_BACKEND_TOKEN;
  const candidate = request.headers.get("x-prowess-desktop-backend");
  if (!secret || !/^[a-f0-9]{64}$/.test(secret) || !candidate || !/^[a-f0-9]{64}$/.test(candidate) ||
      !timingSafeEqual(Buffer.from(secret, "hex"), Buffer.from(candidate, "hex"))) {
    return new NextResponse("Forbidden", { status: 403, headers: { "Cache-Control": "no-store" } });
  }
  return NextResponse.next();
}
