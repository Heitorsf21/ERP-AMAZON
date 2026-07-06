import { handleAuth, ok } from "@/lib/api";
import { assertTenantPrimario, UsuarioRole } from "@/lib/auth";
import { syncSettlementReports } from "@/modules/amazon/service";

export const dynamic = "force-dynamic";

export const POST = handleAuth([UsuarioRole.ADMIN], async () => {
  // Sync usa a credencial SP-API GLOBAL legada (ConfiguracaoSistema da empresa
  // primária) e materializa dados no tenant do chamador — só a primária dispara.
  assertTenantPrimario();
  const result = await syncSettlementReports();
  return ok(result);
});
