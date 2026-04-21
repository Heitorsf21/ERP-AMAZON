import { handle, ok } from "@/lib/api";
import { financeiroService } from "@/modules/financeiro/service";

// GET — lista o histórico de lotes de importação (mais recente primeiro).
// Usado pela aba "Histórico" do diálogo de importar.
export const GET = handle(async () => {
  const lotes = await financeiroService.listarImportacoes();
  return ok(lotes);
});
