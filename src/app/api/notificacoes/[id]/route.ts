import { handle, ok } from "@/lib/api";
import { requireSession } from "@/lib/auth";
import { notificacaoService } from "@/modules/notificacoes/service";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export const PATCH = handle(async (_req: Request, { params }: Params) => {
  await requireSession();
  const { id } = await params;
  const notificacao = await notificacaoService.marcarLida(id);
  return ok(notificacao);
});
