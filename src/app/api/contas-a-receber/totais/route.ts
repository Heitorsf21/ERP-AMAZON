import { handle, ok } from "@/lib/api";
import { contasReceberService } from "@/modules/contas-a-receber/service";

export const dynamic = "force-dynamic";

export const GET = handle(async () => {
  const totais = await contasReceberService.totais();
  return ok(totais);
});
