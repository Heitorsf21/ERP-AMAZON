import { handle, ok } from "@/lib/api";
import { notificacaoService } from "@/modules/notificacoes/service";

export const dynamic = "force-dynamic";

export const POST = handle(async () => {
  const resultado = await notificacaoService.marcarTodasLidas();
  return ok(resultado);
});
