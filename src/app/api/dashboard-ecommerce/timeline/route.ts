import { handleAuth, ok } from "@/lib/api";
import { resolverPeriodoDeBusca } from "@/lib/periodo";
import { dashboardEcommerceService } from "@/modules/dashboard-ecommerce/service";
import { consolidarTimeline } from "@/modules/lojas/consolidado";
import { lojasDaVisaoTodas, naLoja, pedeVisaoTodas } from "@/modules/lojas/visao-todas";

export const dynamic = "force-dynamic";

export const GET = handleAuth(async (req: Request) => {
  const { searchParams } = new URL(req.url);
  const periodo = resolverPeriodoDeBusca(searchParams);
  const todas = pedeVisaoTodas(searchParams) ? await lojasDaVisaoTodas() : null;

  if (!todas) {
    return ok(await dashboardEcommerceService.obterTimeline(periodo));
  }

  const listas = await Promise.all(
    todas.lojas.map((loja) =>
      naLoja(loja.empresaId, () => dashboardEcommerceService.obterTimeline(periodo)),
    ),
  );
  return ok(consolidarTimeline(listas));
});
