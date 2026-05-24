import { handle, ok } from "@/lib/api";
import { requireSession } from "@/lib/auth";
import { contasReceberService } from "@/modules/contas-a-receber/service";

export const dynamic = "force-dynamic";

export const GET = handle(async (req: Request) => {
  await requireSession();
  const url = new URL(req.url);
  const status = url.searchParams.get("status") ?? undefined;
  const contas = await contasReceberService.listar(status);
  return ok(contas);
});
