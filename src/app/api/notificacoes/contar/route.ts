import { handle, ok } from "@/lib/api";
import { requireSession } from "@/lib/auth";
import { notificacaoService } from "@/modules/notificacoes/service";

export const dynamic = "force-dynamic";

export const GET = handle(async () => {
  await requireSession();
  const total = await notificacaoService.contarNaoLidas();
  return ok({ total });
});
