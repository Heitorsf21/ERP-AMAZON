import { handle, ok } from "@/lib/api";
import { db } from "@/lib/db";
import { whereVendaAmazonContabilizavel } from "@/modules/vendas/filtros";

export const dynamic = "force-dynamic";

type Campanha = {
  id: string;
  nomeCampanha: string;
  sku: string | null;
  asin: string | null;
  impressoes: number;
  cliques: number;
  gastoCentavos: number;
  vendasAtribuidasCentavos: number;
  pedidos: number;
  unidades: number;
  acosPercentual: number | null;
  roas: number | null;
  periodoInicio: Date;
  periodoFim: Date;
};

type CampanhaEnriquecida = Campanha & {
  ctrPercentual: number | null;
  cpcCentavos: number | null;
  taxaConversaoPercentual: number | null;
};

function calcularDerivados(c: Campanha): CampanhaEnriquecida {
  const ctrPercentual =
    c.impressoes > 0 ? (c.cliques / c.impressoes) * 100 : null;
  const cpcCentavos =
    c.cliques > 0 ? Math.round(c.gastoCentavos / c.cliques) : null;
  const taxaConversaoPercentual =
    c.cliques > 0 ? (c.pedidos / c.cliques) * 100 : null;
  return {
    ...c,
    ctrPercentual,
    cpcCentavos,
    taxaConversaoPercentual,
  };
}

async function totalFaturamentoAmazon(de: Date, ate: Date): Promise<number> {
  const agg = await db.vendaAmazon.aggregate({
    _sum: { liquidoMarketplaceCentavos: true },
    where: whereVendaAmazonContabilizavel({
      dataVenda: { gte: de, lte: ate },
    }),
  });
  return agg._sum.liquidoMarketplaceCentavos ?? 0;
}

function deltaPct(atual: number, anterior: number): number | null {
  if (anterior === 0) return atual === 0 ? 0 : null;
  return ((atual - anterior) / Math.abs(anterior)) * 100;
}

function parseDataInicio(d: string): Date {
  return new Date(`${d}T00:00:00.000Z`);
}

function parseDataFim(d: string): Date {
  return new Date(`${d}T23:59:59.999Z`);
}

async function carregarBloco(de: Date, ate: Date) {
  const campanhas = (await db.adsCampanha.findMany({
    where: {
      periodoInicio: { lte: ate },
      periodoFim: { gte: de },
    },
    orderBy: [{ acosPercentual: "desc" }, { gastoCentavos: "desc" }],
  })) as Campanha[];

  const totalGasto = campanhas.reduce((a, c) => a + c.gastoCentavos, 0);
  const totalVendas = campanhas.reduce(
    (a, c) => a + c.vendasAtribuidasCentavos,
    0,
  );
  const acosGeral = totalVendas > 0 ? (totalGasto / totalVendas) * 100 : null;
  const roasGeral = totalGasto > 0 ? totalVendas / totalGasto : null;
  const faturamentoAmazon = await totalFaturamentoAmazon(de, ate);
  const tacos =
    faturamentoAmazon > 0 ? (totalGasto / faturamentoAmazon) * 100 : null;

  return {
    campanhas,
    totalGasto,
    totalVendas,
    acosGeral,
    roasGeral,
    tacos,
    faturamentoAmazon,
  };
}

export const GET = handle(async (req: Request) => {
  const { searchParams } = new URL(req.url);
  const de = searchParams.get("de");
  const ate = searchParams.get("ate");
  const comparar = searchParams.get("comparar") === "true";

  // Sem período: comportamento legado (todas as campanhas)
  if (!de || !ate) {
    const campanhas = (await db.adsCampanha.findMany({
      orderBy: [{ acosPercentual: "desc" }, { gastoCentavos: "desc" }],
    })) as Campanha[];
    const totalGasto = campanhas.reduce((a, c) => a + c.gastoCentavos, 0);
    const totalVendas = campanhas.reduce(
      (a, c) => a + c.vendasAtribuidasCentavos,
      0,
    );
    const acosGeral =
      totalVendas > 0 ? (totalGasto / totalVendas) * 100 : null;
    const roasGeral = totalGasto > 0 ? totalVendas / totalGasto : null;
    return ok({
      campanhas: campanhas.map(calcularDerivados),
      totalGasto,
      totalVendas,
      acosGeral,
      roasGeral,
      tacos: null,
      faturamentoAmazon: null,
    });
  }

  const inicio = parseDataInicio(de);
  const fim = parseDataFim(ate);
  const atual = await carregarBloco(inicio, fim);

  const baseRetorno = {
    campanhas: atual.campanhas.map(calcularDerivados),
    totalGasto: atual.totalGasto,
    totalVendas: atual.totalVendas,
    acosGeral: atual.acosGeral,
    roasGeral: atual.roasGeral,
    tacos: atual.tacos,
    faturamentoAmazon: atual.faturamentoAmazon,
  };

  if (!comparar) return ok(baseRetorno);

  const duracaoMs = fim.getTime() - inicio.getTime();
  const fimAnterior = new Date(inicio.getTime() - 1);
  const inicioAnterior = new Date(fimAnterior.getTime() - duracaoMs);
  const anterior = await carregarBloco(inicioAnterior, fimAnterior);

  return ok({
    ...baseRetorno,
    comparativo: {
      periodo: {
        de: inicioAnterior.toISOString().slice(0, 10),
        ate: fimAnterior.toISOString().slice(0, 10),
      },
      totalGasto: anterior.totalGasto,
      totalVendas: anterior.totalVendas,
      acosGeral: anterior.acosGeral,
      roasGeral: anterior.roasGeral,
      tacos: anterior.tacos,
      delta: {
        gasto: deltaPct(atual.totalGasto, anterior.totalGasto),
        vendas: deltaPct(atual.totalVendas, anterior.totalVendas),
        acos:
          atual.acosGeral != null && anterior.acosGeral != null
            ? deltaPct(atual.acosGeral, anterior.acosGeral)
            : null,
        roas:
          atual.roasGeral != null && anterior.roasGeral != null
            ? deltaPct(atual.roasGeral, anterior.roasGeral)
            : null,
        tacos:
          atual.tacos != null && anterior.tacos != null
            ? deltaPct(atual.tacos, anterior.tacos)
            : null,
      },
    },
  });
});

export const DELETE = handle(async (req: Request) => {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) return ok({ ok: false });
  await db.adsCampanha.delete({ where: { id } });
  return ok({ ok: true });
});
