import { handle, ok } from "@/lib/api";
import { requireSession } from "@/lib/auth";
import { notificacaoService } from "@/modules/notificacoes/service";

export const dynamic = "force-dynamic";

export const POST = handle(async () => {
  await requireSession();
  const resultado = await notificacaoService.marcarTodasLidas();
  return ok(resultado);
});
