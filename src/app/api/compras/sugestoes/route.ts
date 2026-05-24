import { handleAuth, ok } from "@/lib/api";
import { UsuarioRole } from "@/lib/auth";
import { comprasService } from "@/modules/compras/service";

export const dynamic = "force-dynamic";

export const GET = handleAuth([UsuarioRole.OPERADOR], async () => {
  const sugestoes = await comprasService.sugestoes();
  return ok(sugestoes);
});
