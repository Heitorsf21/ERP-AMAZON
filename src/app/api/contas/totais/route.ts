import { handleAuth, ok } from "@/lib/api";
import { UsuarioRole } from "@/lib/auth";
import { contasService } from "@/modules/contas-a-pagar/service";

export const dynamic = "force-dynamic";

export const GET = handleAuth([UsuarioRole.FINANCEIRO], async () => {
  const totais = await contasService.totaisDoMes();
  return ok(totais);
});
