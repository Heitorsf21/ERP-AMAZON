import { z } from "zod";
import { handleAuth, ok, erro } from "@/lib/api";
import { UsuarioRole } from "@/lib/auth";
import { getWhatsappEstoqueConfig } from "@/modules/whatsapp-estoque/config";
import {
  obterStatusSessaoWaha,
  reiniciarSessaoWaha,
  type SessaoWahaInput,
} from "@/modules/whatsapp-estoque/waha-client";

export const dynamic = "force-dynamic";

const SEM_CACHE = { headers: { "Cache-Control": "no-store" } };

const reconectarSchema = z.object({ acao: z.literal("reconectar") });

/** Sessão do WAHA a partir da config da empresa (null sem URL configurada). */
async function sessaoDaConfig(): Promise<SessaoWahaInput | null> {
  const config = await getWhatsappEstoqueConfig();
  if (!config.wahaUrl) return null;
  return {
    baseUrl: config.wahaUrl,
    session: config.wahaSession,
    apiKey: config.wahaApiKey || undefined,
  };
}

/** Status da conexão do WhatsApp: `{ status, conta }` (conta = 4 últimos dígitos). */
export const GET = handleAuth([UsuarioRole.ADMIN], async () => {
  const sessao = await sessaoDaConfig();
  if (!sessao) return erro(400, "URL do WAHA não configurada.");

  const atual = await obterStatusSessaoWaha(sessao);
  if (!atual.ok) {
    return erro(502, atual.erro ?? "Falha ao consultar a sessão do WhatsApp.");
  }
  return ok({ status: atual.status ?? null, conta: atual.conta ?? null }, SEM_CACHE);
});

/**
 * `{ acao: "reconectar" }`: se a sessão caiu (FAILED/STOPPED), reinicia.
 * Devolve o status após a chamada (normalmente STARTING; a UI acompanha até
 * WORKING ou SCAN_QR_CODE).
 */
export const POST = handleAuth([UsuarioRole.ADMIN], async (req: Request) => {
  reconectarSchema.parse(await req.json());

  const sessao = await sessaoDaConfig();
  if (!sessao) return erro(400, "URL do WAHA não configurada.");

  const antes = await obterStatusSessaoWaha(sessao);
  if (!antes.ok) {
    return erro(502, antes.erro ?? "Falha ao consultar a sessão do WhatsApp.");
  }
  if (antes.status !== "FAILED" && antes.status !== "STOPPED") {
    return ok({ status: antes.status ?? null, conta: antes.conta ?? null }, SEM_CACHE);
  }

  const reinicio = await reiniciarSessaoWaha(sessao);
  if (!reinicio.ok) {
    return erro(502, reinicio.erro ?? "Falha ao reiniciar a sessão do WhatsApp.");
  }

  const depois = await obterStatusSessaoWaha(sessao);
  if (!depois.ok) {
    return erro(502, depois.erro ?? "Falha ao consultar a sessão do WhatsApp.");
  }
  return ok({ status: depois.status ?? null, conta: depois.conta ?? null }, SEM_CACHE);
});
