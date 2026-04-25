import { handle, ok } from "@/lib/api";
import { financeiroService } from "@/modules/financeiro/service";

export const dynamic = "force-dynamic";

// Totais do mês corrente para as mini-stats da página /caixa.
export const GET = handle(async () => {
  const totais = await financeiroService.totaisDoMes();
  return ok(totais);
});
