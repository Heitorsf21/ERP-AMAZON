import { handleAuth, ok } from "@/lib/api";
import { resolverPeriodoDeBusca, type IntervaloPeriodo } from "@/lib/periodo";
import { dashboardEcommerceService } from "@/modules/dashboard-ecommerce/service";
import { calcularDeltasKpis, consolidarKpis } from "@/modules/lojas/consolidado";
import { lojasDaVisaoTodas, naLoja, pedeVisaoTodas } from "@/modules/lojas/visao-todas";

export const dynamic = "force-dynamic";

export const GET = handleAuth(async (req: Request) => {
  const { searchParams } = new URL(req.url);
  const periodo = resolverPeriodoDeBusca(searchParams);

  const duracaoMs = periodo.ate.getTime() - periodo.de.getTime();
  const anterior: IntervaloPeriodo = {
    de: new Date(periodo.de.getTime() - duracaoMs),
    ate: new Date(periodo.ate.getTime() - duracaoMs),
  };

  const todas = pedeVisaoTodas(searchParams) ? await lojasDaVisaoTodas() : null;

  if (!todas) {
    const [kpis, prev] = await Promise.all([
      dashboardEcommerceService.obterKpis(periodo),
      dashboardEcommerceService.obterKpis(anterior),
    ]);
    return ok({ ...kpis, delta: calcularDeltasKpis(kpis, prev) });
  }

  // Visão "Todas": cada loja calcula no próprio tenant; a soma é pura.
  const porLoja = await Promise.all(
    todas.lojas.map((loja) =>
      naLoja(loja.empresaId, async () => {
        const [kpis, prev] = await Promise.all([
          dashboardEcommerceService.obterKpis(periodo),
          dashboardEcommerceService.obterKpis(anterior),
        ]);
        return { loja, kpis, prev };
      }),
    ),
  );
  const atual = consolidarKpis(
    porLoja.map(({ loja, kpis }) => ({ loja, kpis })),
    todas.atualEmpresaId,
  );
  const prev = consolidarKpis(
    porLoja.map(({ loja, prev: kpis }) => ({ loja, kpis })),
    todas.atualEmpresaId,
  );
  return ok({ ...atual, delta: calcularDeltasKpis(atual, prev) });
});
