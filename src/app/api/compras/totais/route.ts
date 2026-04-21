import { handle, ok } from "@/lib/api";
import { comprasService } from "@/modules/compras/service";

export const dynamic = "force-dynamic";

export const GET = handle(async () => {
  const totais = await comprasService.totais();
  return ok(totais);
});
