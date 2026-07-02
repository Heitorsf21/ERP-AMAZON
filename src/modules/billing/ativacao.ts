import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { expiracaoConvite, gerarTokenConvite } from "@/modules/plataforma/convite";

/**
 * Entrega do acesso pós-pagamento da landing. O session_id do Stripe é a
 * credencial de quem pagou; aqui trocamos o stripeCustomerId (extraído da
 * session VALIDADA na rota) por um convite de definição de senha.
 *
 * Regra anti-porta-dos-fundos: só reemitimos convite enquanto o admin NUNCA
 * definiu senha (sessionVersion === 0). Depois disso o link de retorno do
 * Stripe deixa de dar acesso — "conta já ativa, faça login".
 */

export type AtivacaoResult =
  | { status: "processando" }
  | { status: "ja-ativo" }
  | { status: "convite"; token: string; email: string; empresaNome: string };

export async function ativarPorCustomer(
  stripeCustomerId: string,
): Promise<AtivacaoResult> {
  const empresa = await db.empresa.findFirst({
    where: { stripeCustomerId },
    select: { id: true, nome: true },
  });
  if (!empresa) return { status: "processando" };

  const admin = await db.usuario.findFirst({
    where: { empresaId: empresa.id, role: "ADMIN" },
    orderBy: { createdAt: "asc" },
    select: { id: true, email: true, sessionVersion: true },
  });
  if (!admin) return { status: "processando" };

  if (admin.sessionVersion > 0) return { status: "ja-ativo" };

  const { rawToken, tokenHash } = gerarTokenConvite();
  await db.$transaction([
    db.conviteUsuario.updateMany({
      where: { usuarioId: admin.id, usadoEm: null },
      data: { usadoEm: new Date() },
    }),
    db.conviteUsuario.create({
      data: { usuarioId: admin.id, tokenHash, expiresAt: expiracaoConvite() },
    }),
  ]);

  logger.info(
    { empresaId: empresa.id, usuarioId: admin.id },
    "[checkout-publico] convite de ativacao emitido",
  );
  return { status: "convite", token: rawToken, email: admin.email, empresaNome: empresa.nome };
}
