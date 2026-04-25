import { handle, ok } from "@/lib/api";
import { requireSession } from "@/lib/auth";
import { buscarGlobal } from "@/modules/busca/service";

export const dynamic = "force-dynamic";

export const GET = handle(async (req: Request) => {
  await requireSession();
  const url = new URL(req.url);
  const q = url.searchParams.get("q") ?? "";
  const limit = Math.min(Number(url.searchParams.get("limit") ?? 5), 20);
  const resultados = await buscarGlobal(q, limit);
  return ok(resultados);
});
