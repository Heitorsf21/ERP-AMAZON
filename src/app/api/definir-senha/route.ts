import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { db } from "@/lib/db";
import { hashTokenConvite } from "@/modules/plataforma/convite";
import { originViolationResponse } from "@/lib/origin-check";
import { consumeRateLimit, getClientIp } from "@/lib/auth-rate-limit";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  token: z.string().min(20).max(200),
  novaSenha: z.string().min(8).max(200),
});

export async function POST(req: Request) {
  const bloqueio = originViolationResponse(req);
  if (bloqueio) return bloqueio;

  // Rate-limit por IP (namespaced p/ nao colidir com login).
  const ip = getClientIp(req.headers);
  const rl = await consumeRateLimit(`definir-senha:${ip}`, 15 * 60_000, 10);
  if (rl.limited) {
    return NextResponse.json(
      { erro: "MUITAS_TENTATIVAS" },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSeconds) } },
    );
  }

  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ erro: "JSON_INVALIDO" }, { status: 400 }); }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ erro: "DADOS_INVALIDOS" }, { status: 400 });

  const tokenHash = hashTokenConvite(parsed.data.token);
  const convite = await db.conviteUsuario.findUnique({ where: { tokenHash } });

  // TOCTOU aceito: o intervalo entre este findUnique e o update de `usadoEm`
  // (~bcrypt) permite, em tese, duplo-uso do MESMO token por requisicoes
  // simultaneas. Risco proporcional ao modelo de ameaca de um link de convite
  // (URL one-time enviada a um inbox especifico) + o form desabilita o botao no
  // submit. Se virar credencial de maior valor, trocar por update condicional
  // (WHERE usadoEm IS NULL) tratando 0 linhas como LINK_INVALIDO.
  // Resposta UNIFORME para inexistente/expirado/usado (anti-enumeracao).
  const invalido =
    !convite || convite.usadoEm != null || convite.expiresAt.getTime() < Date.now();
  if (invalido) {
    return NextResponse.json({ erro: "LINK_INVALIDO" }, { status: 400 });
  }

  const senhaHash = await bcrypt.hash(parsed.data.novaSenha, 12);
  await db.$transaction([
    db.usuario.update({
      where: { id: convite!.usuarioId },
      data: { senhaHash, sessionVersion: { increment: 1 } },
    }),
    db.conviteUsuario.update({
      where: { id: convite!.id },
      data: { usadoEm: new Date() },
    }),
  ]);

  logger.info({ usuarioId: convite!.usuarioId }, "[convite] senha definida");
  return NextResponse.json({ ok: true });
}
