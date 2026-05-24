import { handleAuth, ok } from "@/lib/api";
import { UsuarioRole } from "@/lib/auth";
import { financeiroService } from "@/modules/financeiro/service";

export const DELETE = handleAuth(
  [UsuarioRole.FINANCEIRO],
  async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
    const { id } = await ctx.params;
    await financeiroService.removerMovimentacao(id);
    return ok({ ok: true });
  },
);
