import { handle, ok } from "@/lib/api";
import { estoqueService } from "@/modules/estoque/service";

export const dynamic = "force-dynamic";

export const GET = handle(async () => {
  const totais = await estoqueService.totais();
  return ok(totais);
});
