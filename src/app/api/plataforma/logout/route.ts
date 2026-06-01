import { NextResponse } from "next/server";
import { PLATAFORMA_COOKIE_NAME, buildPlataformaClearCookie } from "@/lib/plataforma-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(PLATAFORMA_COOKIE_NAME, "", buildPlataformaClearCookie());
  return res;
}
