import { handle, ok } from "@/lib/api";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

type LinhaSku = {
  sku: string;
  asin: string | null;
  gastoCentavos: number;
  vendasCentavos: number;
  cliques: number;
  impressoes: number;
  pedidos: number;
  unidades: number;
  acos: number | null;
  roas: number | null;
  ctr: number | null;
  cpc: number | null;
  conversao: number | null;
  vendasAmazonCentavos: number;
  vendasOrganicasCentavos: number;
  tacos: number | null;
};

export const GET = handle(async (req: Request) => {
  const { searchParams } = new URL(req.url);
  const de = searchParams.get("de");
  const ate = searchParams.get("ate");

  if (!de || !ate) throw new Error("Parâmetros 'de' e 'ate' são obrigatórios");

  const inicio = new Date(`${de}T00:00:00.000Z`);
  const fim = new Date(`${ate}T23:59:59.999Z`);

  const campanhas = await db.adsCampanha.findMany({
    where: {
      periodoInicio: { lte: fim },
      periodoFim: { gte: inicio },
    },
    select: {
      sku: true,
      asin: true,
      gastoCentavos: true,
      vendasAtribuidasCentavos: true,
      cliques: true,
      impressoes: true,
      pedidos: true,
      unidades: true,
    },
  });

  // Agrupa por SKU (ignorando linhas sem SKU)
  const mapa = new Map<string, LinhaSku>();
  for (const c of campanhas) {
    const sku = c.sku?.trim();
    if (!sku) continue;
    const linha = mapa.get(sku) ?? {
      sku,
      asin: c.asin,
      gastoCentavos: 0,
      vendasCentavos: 0,
      cliques: 0,
      impressoes: 0,
      pedidos: 0,
      unidades: 0,
      acos: null,
      roas: null,
      ctr: null,
      cpc: null,
      conversao: null,
      vendasAmazonCentavos: 0,
      vendasOrganicasCentavos: 0,
      tacos: null,
    };
    linha.gastoCentavos += c.gastoCentavos;
    linha.vendasCentavos += c.vendasAtribuidasCentavos;
    linha.cliques += c.cliques;
    linha.impressoes += c.impressoes;
    linha.pedidos += c.pedidos;
    linha.unidades += c.unidades;
    if (!linha.asin && c.asin) linha.asin = c.asin;
    mapa.set(sku, linha);
  }

  // Vendas Amazon por SKU no mesmo período
  const skus = Array.from(mapa.keys());
  if (skus.length > 0) {
    const vendasPorSku = await db.vendaAmazon.groupBy({
      by: ["sku"],
      where: {
        sku: { in: skus },
        dataVenda: { gte: inicio, lte: fim },
      },
      _sum: { liquidoMarketplaceCentavos: true },
    });

    for (const v of vendasPorSku) {
      const linha = mapa.get(v.sku);
      if (!linha) continue;
      linha.vendasAmazonCentavos = v._sum.liquidoMarketplaceCentavos ?? 0;
    }
  }

  const linhas = Array.from(mapa.values()).map((l) => {
    const acos =
      l.vendasCentavos > 0 ? (l.gastoCentavos / l.vendasCentavos) * 100 : null;
    const roas = l.gastoCentavos > 0 ? l.vendasCentavos / l.gastoCentavos : null;
    const ctr = l.impressoes > 0 ? (l.cliques / l.impressoes) * 100 : null;
    const cpc = l.cliques > 0 ? Math.round(l.gastoCentavos / l.cliques) : null;
    const conversao = l.cliques > 0 ? (l.pedidos / l.cliques) * 100 : null;
    const vendasOrganicasCentavos = Math.max(
      0,
      l.vendasAmazonCentavos - l.vendasCentavos,
    );
    const tacos =
      l.vendasAmazonCentavos > 0
        ? (l.gastoCentavos / l.vendasAmazonCentavos) * 100
        : null;
    return {
      ...l,
      acos,
      roas,
      ctr,
      cpc,
      conversao,
      vendasOrganicasCentavos,
      tacos,
    };
  });

  linhas.sort((a, b) => b.gastoCentavos - a.gastoCentavos);

  return ok(linhas);
});
