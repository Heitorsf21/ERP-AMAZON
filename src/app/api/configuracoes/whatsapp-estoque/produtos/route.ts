import { handleAuth, ok } from "@/lib/api";
import { UsuarioRole } from "@/lib/auth";
import { listarProdutosMonitorados } from "@/modules/whatsapp-estoque/service";

export const dynamic = "force-dynamic";

export const GET = handleAuth([UsuarioRole.ADMIN], async (req: Request) => {
  const { searchParams } = new URL(req.url);
  const busca = searchParams.get("busca") ?? undefined;
  const produtos = await listarProdutosMonitorados(busca);
  return ok({ produtos });
});
