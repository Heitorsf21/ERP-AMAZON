import { handle, ok } from "@/lib/api";
import { contasService } from "@/modules/contas-a-pagar/service";

export const dynamic = "force-dynamic";

export const GET = handle(async () => {
  const totais = await contasService.totaisDoMes();
  return ok(totais);
});
