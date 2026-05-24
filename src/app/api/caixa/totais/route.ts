import { handleAuth, ok } from "@/lib/api";
import { UsuarioRole } from "@/lib/auth";
import { financeiroService } from "@/modules/financeiro/service";

export const dynamic = "force-dynamic";

// Totais do mês corrente para as mini-stats da página /caixa.
export const GET = handleAuth([UsuarioRole.FINANCEIRO], async () => {
  const totais = await financeiroService.totaisDoMes();
  return ok(totais);
});
