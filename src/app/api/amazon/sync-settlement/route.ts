import { handleAuth, ok } from "@/lib/api";
import { UsuarioRole } from "@/lib/auth";
import { syncSettlementReports } from "@/modules/amazon/service";

export const dynamic = "force-dynamic";

export const POST = handleAuth([UsuarioRole.ADMIN], async () => {
  const result = await syncSettlementReports();
  return ok(result);
});
