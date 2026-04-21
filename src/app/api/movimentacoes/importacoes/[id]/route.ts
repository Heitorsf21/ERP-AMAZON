import { handle, ok } from "@/lib/api";
import { financeiroService } from "@/modules/financeiro/service";

// DELETE — remove o lote e as movimentações geradas por ele.
// Cascade manual via service (referenciaId é polimórfico, sem FK formal).
export const DELETE = handle(
  async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
    const { id } = await ctx.params;
    const r = await financeiroService.removerImportacao(id);
    return ok(r);
  },
);
