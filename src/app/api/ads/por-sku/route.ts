import { handle, ok } from "@/lib/api";
import { db } from "@/lib/db";
import {
  getAdsPorSku,
  tacosPercentual,
} from "@/modules/amazon/ads-aggregation";
import { whereVendaAmazonContabilizavelEstrito } from "@/modules/vendas/filtros";

export const dynamic = "force-dynamic";

export const GET = handle(async (req: Request) => {
  const { searchParams } = new URL(req.url);
  const de = searchParams.get("de");
  const ate = searchParams.get("ate");

  if (!de || !ate) throw new Error("Parâmetros 'de' e 'ate' são obrigatórios");

  const inicio = new Date(`${de}T00:00:00.000Z`);
  const fim = new Date(`${ate}T23:59:59.999Z`);

  const itens = await getAdsPorSku({ de: inicio, ate: fim });
  const skus = itens.map((i) => i.sku);

  // Vendas Amazon por SKU no mesmo periodo (para TACOS e vendas organicas)
  const vendasPorSku = skus.length
    ? await db.vendaAmazon.groupBy({
        by: ["sku"],
        where: whereVendaAmazonContabilizavelEstrito({
          sku: { in: skus },
          dataVenda: { gte: inicio, lte: fim },
        }),
        _sum: { liquidoMarketplaceCentavos: true },
      })
    : [];
  const vendasAmazonPorSku = new Map(
    vendasPorSku.map(
      (v) => [v.sku, v._sum.liquidoMarketplaceCentavos ?? 0] as const,
    ),
  );

  const linhas = itens.map((i) => {
    const vendasAmazonCentavos = vendasAmazonPorSku.get(i.sku) ?? 0;
    const vendasOrganicasCentavos = Math.max(
      0,
      vendasAmazonCentavos - i.vendasAtribuidasCentavos,
    );
    return {
      sku: i.sku,
      asin: i.asin,
      gastoCentavos: i.gastoCentavos,
      vendasCentavos: i.vendasAtribuidasCentavos,
      cliques: i.cliques,
      impressoes: i.impressoes,
      pedidos: i.pedidos,
      unidades: i.unidades,
      acos: i.acosPercentual,
      roas: i.roas,
      ctr: i.ctrPercentual,
      cpc: i.cpcCentavos,
      conversao: i.taxaConversaoPercentual,
      vendasAmazonCentavos,
      vendasOrganicasCentavos,
      tacos: tacosPercentual(i.gastoCentavos, vendasAmazonCentavos),
    };
  });

  return ok(linhas);
});
