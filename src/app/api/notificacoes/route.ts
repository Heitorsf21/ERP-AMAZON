import { handle, ok } from "@/lib/api";
import { requireRole, requireSession, UsuarioRole } from "@/lib/auth";
import { notificacaoService } from "@/modules/notificacoes/service";

export const dynamic = "force-dynamic";

export const GET = handle(async (req: Request) => {
  await requireSession();
  const { searchParams } = new URL(req.url);
  const soNaoLidas = searchParams.get("naoLidas") === "true";
  const limitRaw = Number(searchParams.get("limit"));
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? limitRaw : undefined;
  const notificacoes = await notificacaoService.listar(soNaoLidas, limit);
  return ok({ notificacoes });
});

export const POST = handle(async () => {
  await requireRole(UsuarioRole.ADMIN);
  const resultado = await notificacaoService.gerarNotificacoes();
  return ok(resultado);
});
