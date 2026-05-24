import { handleAuth, ok } from "@/lib/api";
import { UsuarioRole } from "@/lib/auth";
import { estoqueService } from "@/modules/estoque/service";

export const dynamic = "force-dynamic";

export const GET = handleAuth([UsuarioRole.OPERADOR], async () => {
  const totais = await estoqueService.totais();
  return ok(totais);
});
