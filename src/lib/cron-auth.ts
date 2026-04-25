import { NextRequest } from "next/server";

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
  if (header === `Bearer ${secret}`) return { ok: true };
  return { ok: false, motivo: "Token invalido" };
}
