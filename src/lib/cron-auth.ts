import { NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";

/** Comparação constant-time de strings (evita timing attack no secret). */
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export function verifyCronRequest(req: NextRequest): {
  ok: boolean;
  motivo?: string;
} {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV !== "production") return { ok: true };
    return { ok: false, motivo: "CRON_SECRET nao configurado" };
  }

  const header = req.headers.get("authorization");
  if (header && safeEqual(header, `Bearer ${secret}`)) return { ok: true };
  return { ok: false, motivo: "Token invalido" };
}
