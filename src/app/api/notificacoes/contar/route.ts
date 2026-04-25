import { handle, ok } from "@/lib/api";
import { notificacaoService } from "@/modules/notificacoes/service";

export const dynamic = "force-dynamic";

export const GET = handle(async () => {
  const total = await notificacaoService.contarNaoLidas();
  return ok({ total });
});
