import { handleAuth, ok } from "@/lib/api";
import { UsuarioRole } from "@/lib/auth";
import { contasReceberService } from "@/modules/contas-a-receber/service";

export const dynamic = "force-dynamic";

export const GET = handleAuth([UsuarioRole.FINANCEIRO], async () => {
  const totais = await contasReceberService.totais();
  return ok(totais);
});
