import { NextResponse } from "next/server";
import { z } from "zod";
import crypto from "node:crypto";
import { db } from "@/lib/db";
import { enviarEmail } from "@/lib/email";

// Rate limit: máx 5 solicitações de recuperação por IP:email em 1 hora
const RECOVERY_WINDOW_MS = 60 * 60_000;
const RECOVERY_MAX = 5;
const recoveryBuckets = new Map<string, { count: number; resetAt: number }>();

function checkRecoveryRateLimit(req: Request, email: string): boolean {
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "unknown";
  const key = `${ip}:${email}`;
  const now = Date.now();
  const bucket = recoveryBuckets.get(key);
  const active =
    bucket && bucket.resetAt > now
      ? bucket
      : { count: 0, resetAt: now + RECOVERY_WINDOW_MS };
  active.count += 1;
  recoveryBuckets.set(key, active);
  return active.count > RECOVERY_MAX;
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  email: z.string().email().max(200),
});

function sha256(s: string): string {
  return crypto.createHash("sha256").update(s).digest("hex");
}

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ erro: "JSON_INVALIDO" }, { status: 400 });
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ erro: "DADOS_INVALIDOS" }, { status: 400 });
  }

  const email = parsed.data.email.toLowerCase().trim();

  if (checkRecoveryRateLimit(req, email)) {
    // Retorna 200 para não vazar informação, mas não envia email
    return NextResponse.json({ ok: true });
  }

  const user = await db.usuario.findUnique({ where: { email } });

  // Sempre retorna 200 — não vaza se email existe ou não.
  if (!user || !user.ativo) {
    return NextResponse.json({ ok: true });
  }

  const tokenPlain = crypto.randomBytes(32).toString("hex");
  const tokenHash = sha256(tokenPlain);
  const expiresAt = new Date(Date.now() + 60 * 60_000); // 1 hora

  // Invalida tokens antigos do usuário
  await db.tokenRecuperacaoSenha.updateMany({
    where: { usuarioId: user.id, usadoEm: null },
    data: { usadoEm: new Date() },
  });

  await db.tokenRecuperacaoSenha.create({
    data: {
      usuarioId: user.id,
      tokenHash,
      expiresAt,
    },
  });

  const baseUrl = process.env.APP_URL?.trim() || "http://localhost:3000";
  const link = `${baseUrl}/redefinir-senha?token=${tokenPlain}`;

  await enviarEmail({
    to: user.email,
    subject: "Redefinir senha — ERP Mundo F&S",
    html: `
      <div style="font-family: -apple-system, sans-serif; max-width: 480px; margin: 0 auto;">
        <h2 style="color: #0b1220;">Redefinir senha</h2>
        <p>Olá ${user.nome},</p>
        <p>Você solicitou redefinição de senha. Clique no botão abaixo para criar uma nova senha (link expira em 1 hora):</p>
        <p style="text-align: center; margin: 24px 0;">
          <a href="${link}" style="display: inline-block; background: #4f46e5; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: 600;">Redefinir senha</a>
        </p>
        <p style="color: #6b7280; font-size: 13px;">Ou cole este link no navegador: <br><code style="font-size: 11px;">${link}</code></p>
        <p style="color: #6b7280; font-size: 13px;">Se você não solicitou, ignore este email — sua senha continua a mesma.</p>
      </div>
    `,
  });

  return NextResponse.json({ ok: true });
}
