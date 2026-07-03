import { NextRequest } from "next/server";
import { handle, ok } from "@/lib/api";
import { auditLog, redactForAudit } from "@/lib/audit";
import { assertEmpresaPrimaria, requireRole, UsuarioRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { isEmpresaPrimaria } from "@/lib/tenant-context";
import {
  AMAZON_CONFIG_KEYS,
  getAmazonConfig,
  isAmazonConfigured,
  saveAmazonConfig,
} from "@/modules/amazon/service";

export const dynamic = "force-dynamic";

export const GET = handle(async () => {
  const session = await requireRole(UsuarioRole.ADMIN);
  // A config de ConfiguracaoSistema (amazon_*) é a credencial GLOBAL legado da
  // empresa primária — ADMIN de outra empresa não a enxerga (só o status da
  // própria conta OAuth, usado pelo card de Integrações).
  const exporConfigGlobal = isEmpresaPrimaria(session.empresaId);
  const config = exporConfigGlobal ? await getAmazonConfig() : null;
  // Mascarar chaves secretas na resposta. NUNCA expor sufixo dos segredos —
  // valor mascarado fixo sem comprimento real.
  const safe: Record<string, string> = {};
  for (const key of AMAZON_CONFIG_KEYS) {
    const val = config?.[key] ?? "";
    if (
      val &&
      (key.includes("secret") || key.includes("token"))
    ) {
      safe[key] = "••••••••";
    } else {
      safe[key] = val;
    }
  }
  // Status da conta OAuth da empresa (F02) — mesmo espelho de /api/amazon/ads/config.
  const conta = session.empresaId
    ? await db.amazonAccount.findFirst({
        where: { empresaId: session.empresaId, ativa: true },
        orderBy: { updatedAt: "desc" },
        select: {
          refreshTokenEnc: true,
          sellerId: true,
          status: true,
          conectadoEm: true,
        },
      })
    : null;
  return ok({
    config: safe,
    configurado: config ? isAmazonConfigured(config) : !!conta?.refreshTokenEnc,
    conta: conta
      ? {
          oauthConectado: !!conta.refreshTokenEnc,
          status: conta.status,
          sellerId: conta.sellerId,
          conectadoEm: conta.conectadoEm,
        }
      : null,
  });
});

export const POST = handle(async (req: NextRequest) => {
  const session = await requireRole(UsuarioRole.ADMIN);
  // Escrita na credencial GLOBAL: só a empresa primária. Sem este gate, um
  // ADMIN de outro tenant sobrescreveria/apagaria a credencial da mundofs.
  assertEmpresaPrimaria(session);
  const antes = await getAmazonConfig();
  const body = await req.json() as Record<string, string>;
  // Aceitar apenas chaves conhecidas; ignorar campos extras
  const updates: Record<string, string> = {};
  for (const key of AMAZON_CONFIG_KEYS) {
    if (key in body) updates[key] = String(body[key] ?? "");
  }
  await saveAmazonConfig(updates);
  const depois = await getAmazonConfig();
  await auditLog({
    session,
    req,
    acao: "CONFIG_ATUALIZADA",
    entidade: "AmazonConfig",
    antes: redactForAudit(antes),
    depois: redactForAudit(depois),
    metadata: { chaves: Object.keys(updates) },
  });
  return ok({ ok: true });
});
