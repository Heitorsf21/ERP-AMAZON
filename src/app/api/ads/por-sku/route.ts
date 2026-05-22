import { handle, ok } from "@/lib/api";
import { db } from "@/lib/db";
import { PeriodoPreset, resolverPeriodo } from "@/lib/periodo";
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

  // Interpreta YYYY-MM-DD como dia BRT (timezone America/Sao_Paulo) — front
  // envia dia local do <input type="date">. UTC midnight pega 21h do dia
  // anterior em BRT e contamina a query.
  const { de: inicio, ate: fim } = resolverPeriodo(
    PeriodoPreset.PERSONALIZADO,
    de,
    ate,
  );

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
