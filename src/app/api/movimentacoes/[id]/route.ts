import { handle, ok } from "@/lib/api";
import { financeiroService } from "@/modules/financeiro/service";

export const DELETE = handle(
  async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
    const { id } = await ctx.params;
    await financeiroService.removerMovimentacao(id);
    return ok({ ok: true });
  },
);
