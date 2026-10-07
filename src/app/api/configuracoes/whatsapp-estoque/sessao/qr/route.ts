import { handleAuth, ok, erro } from "@/lib/api";
import { UsuarioRole } from "@/lib/auth";
import { getWhatsappEstoqueConfig } from "@/modules/whatsapp-estoque/config";
import {
  obterQrSessaoWaha,
  obterStatusSessaoWaha,
} from "@/modules/whatsapp-estoque/waha-client";

export const dynamic = "force-dynamic";

/**
 * QR de pareamento do WhatsApp (`{ qr: "data:image/png;base64,..." }`), só
 * quando a sessão está em SCAN_QR_CODE; senão 409. O QR gira a cada ~20 s,
 * então a UI busca de novo periodicamente — nunca cachear.
 */
export const GET = handleAuth([UsuarioRole.ADMIN], async () => {
  const config = await getWhatsappEstoqueConfig();
  if (!config.wahaUrl) return erro(400, "URL do WAHA não configurada.");
  const sessao = {
    baseUrl: config.wahaUrl,
    session: config.wahaSession,
    apiKey: config.wahaApiKey || undefined,
  };

  const atual = await obterStatusSessaoWaha(sessao);
  if (!atual.ok) {
    return erro(502, atual.erro ?? "Falha ao consultar a sessão do WhatsApp.");
  }
  if (atual.status !== "SCAN_QR_CODE") {
    return erro(
      409,
      `A sessão do WhatsApp não está aguardando QR (status ${atual.status ?? "desconhecido"}).`,
    );
  }

  const qr = await obterQrSessaoWaha(sessao);
  if (!qr.ok || !qr.dataUrl) {
    return erro(502, qr.erro ?? "Falha ao obter o QR do WhatsApp.");
  }
  return ok({ qr: qr.dataUrl }, { headers: { "Cache-Control": "no-store" } });
});
