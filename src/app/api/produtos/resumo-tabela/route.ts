import { subDays } from "date-fns";
import { handleAuth, ok } from "@/lib/api";
import { UsuarioRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { whereVendaAmazonContabilizavelEstrito } from "@/modules/vendas/filtros";

export const dynamic = "force-dynamic";

type TrafficRow = {
  sku: string;
  sessoes: number;
  pageViews: number;
  unitsOrdered: number;
  orderedRevenueCentavos: number;
  buyBoxPercent: number | null;
  conversaoPercent: number | null;
  atualizadoEm: Date;
};

type TrafficAggregate = {
  sessions: number;
  pageViews: number;
  unitsOrdered: number;
  orderedRevenueCentavos: number;
  buyBoxTotal: number;
  buyBoxCount: number;
  conversaoTotal: number;
  conversaoCount: number;
};

// Resumo agregado por produto para enriquecer a tabela principal sem N+1.
// Vendas/ads seguem janela de 30d; traffic usa o ultimo report processado,
// porque a Amazon pode atualizar um report recente com datas internas antigas.
export const GET = handleAuth([UsuarioRole.OPERADOR], async () => {
  const desde30d = subDays(new Date(), 30);
  const desde15dBuybox = subDays(new Date(), 15);

  const produtos = await db.produto.findMany({
    where: { ativo: true },
    select: { id: true, sku: true },
  });
  const skus = produtos.map((p) => p.sku);

  const ultimoTraffic = skus.length
    ? await db.amazonSkuTrafficDaily.findFirst({
        where: { sku: { in: skus } },
        orderBy: { atualizadoEm: "desc" },
        select: { atualizadoEm: true },
      })
    : null;
  const janelaUltimoTraffic = ultimoTraffic
    ? new Date(ultimoTraffic.atualizadoEm.getTime() - 15 * 60_000)
    : null;

  const [vendas, reembolsos, buybox, buyboxGanhos, trafficRows, ads] =
    await Promise.all([
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
      }),
      db.buyBoxSnapshot.groupBy({
        by: ["sku"],
        where: { capturadoEm: { gte: desde15dBuybox }, somosBuybox: true },
        _count: { _all: true },
      }),
      janelaUltimoTraffic
        ? db.amazonSkuTrafficDaily.findMany({
            where: {
              sku: { in: skus },
              atualizadoEm: { gte: janelaUltimoTraffic },
            },
            select: {
              sku: true,
              sessoes: true,
              pageViews: true,
              unitsOrdered: true,
              orderedRevenueCentavos: true,
              buyBoxPercent: true,
              conversaoPercent: true,
              atualizadoEm: true,
            },
          })
        : Promise.resolve([] as TrafficRow[]),
      skus.length
        ? db.amazonAdsMetricaDiaria.groupBy({
            by: ["sku"],
            where: {
              data: { gte: desde30d },
              sku: { in: skus },
            },
            _sum: {
              gastoCentavos: true,
              vendasCentavos: true,
              impressoes: true,
              cliques: true,
            },
          })
        : Promise.resolve([]),
    ]);

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
  const trafficPorSku = aggregateTraffic(trafficRows);
  const adsPorSku = new Map(ads.map((a) => [a.sku, a]));

  const resultado = produtos.map((p) => {
    const vendido30d = vendidoPorSku.get(p.sku) ?? 0;
    const devolvido = devolvidoPorSku.get(p.sku) ?? 0;
    const totalSnaps = totalSnapsPorSku.get(p.sku) ?? 0;
    const ganhos = ganhosPorSku.get(p.sku) ?? 0;
    const traffic = trafficPorSku.get(p.sku);
    const sessions30d = traffic?.sessions ?? 0;
    const pageViews30d = traffic?.pageViews ?? 0;
    const trafficUnitsOrdered30d = traffic?.unitsOrdered ?? 0;

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

    const conversaoMedia =
      traffic && traffic.conversaoCount > 0
        ? Math.round((traffic.conversaoTotal / traffic.conversaoCount) * 10) / 10
        : null;

    return {
      id: p.id,
      sku: p.sku,
      vendido30d,
      buyboxPercent,
      reembolsoPercent,
      sessions30d,
      pageViews30d,
      trafficUnitsOrdered30d,
      trafficRevenueOrderedCentavos: traffic?.orderedRevenueCentavos ?? 0,
      trafficConversionPercent:
        sessions30d > 0
          ? Math.round((trafficUnitsOrdered30d / sessions30d) * 1000) / 10
          : conversaoMedia,
      trafficBuyBoxPercent:
        traffic && traffic.buyBoxCount > 0
          ? Math.round((traffic.buyBoxTotal / traffic.buyBoxCount) * 10) / 10
          : null,
      adsGastoCentavos30d: adsGasto,
      adsVendasCentavos30d: adsVendas,
      adsAcosPercent30d: adsAcosPercent,
      adsImpressoes30d: adsRow?._sum.impressoes ?? 0,
      adsCliques30d: adsRow?._sum.cliques ?? 0,
    };
  });

  const skusComTraffic = new Set(
    trafficRows
      .filter(
        (r) =>
          r.sessoes > 0 ||
          r.pageViews > 0 ||
          r.unitsOrdered > 0 ||
          r.orderedRevenueCentavos > 0,
      )
      .map((r) => r.sku),
  );

  return ok({
    itens: resultado,
    cobertura: {
      totalProdutos: produtos.length,
      trafficRows: trafficRows.length,
      skusComTraffic: skusComTraffic.size,
      buyboxSnapshots15d: buybox.reduce((total, b) => total + b._count._all, 0),
      skusComBuybox15d: buybox.length,
      trafficAtualizadoEm: ultimoTraffic?.atualizadoEm.toISOString() ?? null,
    },
  });
});

function aggregateTraffic(rows: TrafficRow[]) {
  const map = new Map<string, TrafficAggregate>();

  for (const row of rows) {
    const current = map.get(row.sku) ?? {
      sessions: 0,
      pageViews: 0,
      unitsOrdered: 0,
      orderedRevenueCentavos: 0,
      buyBoxTotal: 0,
      buyBoxCount: 0,
      conversaoTotal: 0,
      conversaoCount: 0,
    };

    current.sessions += row.sessoes;
    current.pageViews += row.pageViews;
    current.unitsOrdered += row.unitsOrdered;
    current.orderedRevenueCentavos += row.orderedRevenueCentavos;
    if (row.buyBoxPercent != null) {
      current.buyBoxTotal += row.buyBoxPercent;
      current.buyBoxCount += 1;
    }
    if (row.conversaoPercent != null) {
      current.conversaoTotal += row.conversaoPercent;
      current.conversaoCount += 1;
    }
    map.set(row.sku, current);
  }

  return map;
}
