import { handle, ok } from "@/lib/api";
import { notificacaoService } from "@/modules/notificacoes/service";

export const dynamic = "force-dynamic";

export const GET = handle(async (req: Request) => {
  const { searchParams } = new URL(req.url);
  const soNaoLidas = searchParams.get("naoLidas") === "true";
  const notificacoes = await notificacaoService.listar(soNaoLidas);
  return ok(notificacoes);
});

export const POST = handle(async () => {
  const resultado = await notificacaoService.gerarNotificacoes();
  return ok(resultado);
});
