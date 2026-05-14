import { subDays } from "date-fns";
import { handle, ok } from "@/lib/api";
import { db } from "@/lib/db";
import { whereVendaAmazonContabilizavelEstrito } from "@/modules/vendas/filtros";

export const dynamic = "force-dynamic";

// Resumo agregado por produto para enriquecer a tabela principal sem N+1.
// Retorna agregados comerciais e de trafego por produto ativo.
export const GET = handle(async () => {
  const desde30d = subDays(new Date(), 30);
  const desde15dBuybox = subDays(new Date(), 15);

  const [produtos, vendas, reembolsos, buybox, traffic, ads] = await Promise.all([
    db.produto.findMany({
      where: { ativo: true },
      select: { id: true, sku: true },
    }),
    db.vendaAmazon.groupBy({
      by: ["sku"],
      where: whereVendaAmazonContabilizavelEstrito({
        dataVenda: { gte: desde30d },
      }),
      _sum: { quantidade: true },
    }),
    db.amazonReembolso.groupBy({
      by: ["sku"],
      where: { dataReembolso: { gte: desde30d } },
      _sum: { quantidade: true },
    }),
    db.buyBoxSnapshot.groupBy({
      by: ["sku"],
      where: { capturadoEm: { gte: desde15dBuybox } },
      _count: { _all: true },
      _sum: { numeroOfertas: true }, // nao usado; placeholder p/ contagem
    }),
    db.amazonSkuTrafficDaily.groupBy({
      by: ["sku"],
      where: { data: { gte: desde30d } },
      _sum: {
        sessoes: true,
        pageViews: true,
        unitsOrdered: true,
        orderedRevenueCentavos: true,
      },
      _avg: {
        buyBoxPercent: true,
      },
    }),
    db.amazonAdsMetricaDiaria.groupBy({
      by: ["sku"],
      where: { data: { gte: desde30d }, sku: { not: null } },
      _sum: {
        gastoCentavos: true,
        vendasCentavos: true,
        impressoes: true,
        cliques: true,
      },
    }),
  ]);

  // Para % do tempo com buybox, precisamos saber quantos snapshots tinham somosBuybox=true.
  // GroupBy não suporta filtro condicional dentro do agregado, então buscamos
  // separadamente os snapshots em que somosBuybox=true.
  const buyboxGanhos = await db.buyBoxSnapshot.groupBy({
    by: ["sku"],
    where: { capturadoEm: { gte: desde15dBuybox }, somosBuybox: true },
    _count: { _all: true },
  });

  const vendidoPorSku = new Map(
    vendas.map((v) => [v.sku, v._sum.quantidade ?? 0]),
  );
  const devolvidoPorSku = new Map(
    reembolsos.map((r) => [r.sku, r._sum.quantidade ?? 0]),
  );
  const totalSnapsPorSku = new Map(
    buybox.map((b) => [b.sku, b._count._all]),
  );
  const ganhosPorSku = new Map(
    buyboxGanhos.map((b) => [b.sku, b._count._all]),
  );
  const trafficPorSku = new Map(traffic.map((t) => [t.sku, t]));
  const adsPorSku = new Map(ads.map((a) => [a.sku, a]));

  const resultado = produtos.map((p) => {
    const vendido30d = vendidoPorSku.get(p.sku) ?? 0;
    const devolvido = devolvidoPorSku.get(p.sku) ?? 0;
    const totalSnaps = totalSnapsPorSku.get(p.sku) ?? 0;
    const ganhos = ganhosPorSku.get(p.sku) ?? 0;
    const trafficRow = trafficPorSku.get(p.sku);
    const trafficSum = trafficRow?._sum;
    const trafficAvg = trafficRow?._avg;
    const sessions30d = trafficSum?.sessoes ?? 0;
    const pageViews30d = trafficSum?.pageViews ?? 0;
    const trafficUnitsOrdered30d = trafficSum?.unitsOrdered ?? 0;

    const denominador = vendido30d + devolvido;
    const reembolsoPercent =
      denominador > 0
        ? Math.round((devolvido / denominador) * 1000) / 10
        : 0;
    const buyboxPercent =
      totalSnaps > 0 ? Math.round((ganhos / totalSnaps) * 1000) / 10 : null;

    const adsRow = adsPorSku.get(p.sku);
    const adsGasto = adsRow?._sum.gastoCentavos ?? 0;
    const adsVendas = adsRow?._sum.vendasCentavos ?? 0;
    const adsAcosPercent =
      adsVendas > 0 ? Math.round((adsGasto / adsVendas) * 1000) / 10 : null;

    return {
      id: p.id,
      sku: p.sku,
      vendido30d,
      buyboxPercent,
      reembolsoPercent,
      sessions30d,
      pageViews30d,
      trafficUnitsOrdered30d,
      trafficRevenueOrderedCentavos: trafficSum?.orderedRevenueCentavos ?? 0,
      trafficConversionPercent:
        sessions30d > 0
          ? Math.round((trafficUnitsOrdered30d / sessions30d) * 1000) / 10
          : null,
      trafficBuyBoxPercent:
        trafficAvg?.buyBoxPercent == null
          ? null
          : Math.round(trafficAvg.buyBoxPercent * 10) / 10,
      adsGastoCentavos30d: adsGasto,
      adsVendasCentavos30d: adsVendas,
      adsAcosPercent30d: adsAcosPercent,
      adsImpressoes30d: adsRow?._sum.impressoes ?? 0,
      adsCliques30d: adsRow?._sum.cliques ?? 0,
    };
  });

  return ok(resultado);
});
