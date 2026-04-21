import { handle, ok } from "@/lib/api";
import { financeiroService } from "@/modules/financeiro/service";

export const dynamic = "force-dynamic";

// F3: retorna saldo atual, comprometido (contas ABERTA + VENCIDA), livre e
// projeção de caixa 0/7/15/30 dias. Tudo calculado internamente, sem API externa.
export const GET = handle(async () => {
  const saldo = await financeiroService.calcularSaldoCompleto();
  return ok(saldo);
});
