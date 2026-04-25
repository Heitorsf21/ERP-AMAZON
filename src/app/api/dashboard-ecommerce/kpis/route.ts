import { handle, ok } from "@/lib/api";
import { resolverPeriodoDeBusca, type IntervaloPeriodo } from "@/lib/periodo";
import { dashboardEcommerceService } from "@/modules/dashboard-ecommerce/service";

export const dynamic = "force-dynamic";

function deltaPercent(atual: number | null, anterior: number | null): number | null {
  if (atual == null || anterior == null || anterior === 0) return null;
  return ((atual - anterior) / Math.abs(anterior)) * 100;
}

function deltaPP(atual: number | null, anterior: number | null): number | null {
  if (atual == null || anterior == null) return null;
  return atual - anterior;
}

export const GET = handle(async (req: Request) => {
  const { searchParams } = new URL(req.url);
  const periodo = resolverPeriodoDeBusca(searchParams);

  const duracaoMs = periodo.ate.getTime() - periodo.de.getTime();
  const anterior: IntervaloPeriodo = {
    de: new Date(periodo.de.getTime() - duracaoMs),
    ate: new Date(periodo.ate.getTime() - duracaoMs),
  };

  const [kpis, prev] = await Promise.all([
    dashboardEcommerceService.obterKpis(periodo),
    dashboardEcommerceService.obterKpis(anterior),
  ]);

  return ok({
    ...kpis,
    delta: {
      faturamento: deltaPercent(kpis.faturamentoCentavos, prev.faturamentoCentavos),
      liquidoMarketplace: deltaPercent(kpis.liquidoMarketplaceCentavos, prev.liquidoMarketplaceCentavos),
      lucroBruto: deltaPercent(kpis.lucroBrutoCentavos, prev.lucroBrutoCentavos),
      margem: deltaPP(kpis.margemPercentual, prev.margemPercentual),
      numeroVendas: deltaPercent(kpis.numeroVendas, prev.numeroVendas),
      unidades: deltaPercent(kpis.unidades, prev.unidades),
      ticketMedio: deltaPercent(kpis.ticketMedioCentavos, prev.ticketMedioCentavos),
      roi: deltaPP(kpis.roiPercentual, prev.roiPercentual),
      valorAds: deltaPercent(kpis.valorAdsCentavos, prev.valorAdsCentavos),
      tacos: deltaPP(kpis.tacosPercentual, prev.tacosPercentual),
      lucroPosAds: deltaPercent(kpis.lucroPosAdsCentavos, prev.lucroPosAdsCentavos),
      roiPosAds: deltaPP(kpis.roiPosAdsPercentual, prev.roiPosAdsPercentual),
    },
  });
});
