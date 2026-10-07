import { NextResponse } from "next/server";
import { SESSION_COOKIE_NAME, buildSessionClearCookieOptions } from "@/lib/session";
import { CHAVEIRO_COOKIE } from "@/modules/lojas/chaveiro";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE_NAME, "", buildSessionClearCookieOptions());
  // "Sair" também esquece as lojas vinculadas neste aparelho.
  res.cookies.set(CHAVEIRO_COOKIE, "", buildSessionClearCookieOptions());
  return res;
}
