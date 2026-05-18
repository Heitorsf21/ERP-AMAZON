import { handle, ok } from "@/lib/api";
import { db } from "@/lib/db";
import {
  getAdsCampanhas,
  tacosPercentual,
  type AdsCampanhaItem,
  type FonteAds,
} from "@/modules/amazon/ads-aggregation";
import { whereVendaAmazonContabilizavelEstrito } from "@/modules/vendas/filtros";

export const dynamic = "force-dynamic";

type CampanhaPayload = AdsCampanhaItem;

async function totalFaturamentoAmazon(de: Date, ate: Date): Promise<number> {
  const agg = await db.vendaAmazon.aggregate({
    _sum: { liquidoMarketplaceCentavos: true },
    where: whereVendaAmazonContabilizavelEstrito({
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
  const [{ itens, resumo }, faturamentoAmazon] = await Promise.all([
    getAdsCampanhas({ de, ate }),
    totalFaturamentoAmazon(de, ate),
  ]);

  return {
    campanhas: itens,
    totalGasto: resumo.gastoCentavos,
    totalVendas: resumo.vendasAtribuidasCentavos,
    acosGeral: resumo.acosPercentual,
    roasGeral: resumo.roas,
    tacos: tacosPercentual(resumo.gastoCentavos, faturamentoAmazon),
    faturamentoAmazon,
    origem: resumo.fonte,
  };
}

type Bloco = Awaited<ReturnType<typeof carregarBloco>>;

function shapeBase(bloco: Bloco): {
  campanhas: CampanhaPayload[];
  totalGasto: number;
  totalVendas: number;
  acosGeral: number | null;
  roasGeral: number | null;
  tacos: number | null;
  faturamentoAmazon: number | null;
  origem: FonteAds;
} {
  return {
    campanhas: bloco.campanhas,
    totalGasto: bloco.totalGasto,
    totalVendas: bloco.totalVendas,
    acosGeral: bloco.acosGeral,
    roasGeral: bloco.roasGeral,
    tacos: bloco.tacos,
    faturamentoAmazon: bloco.faturamentoAmazon,
    origem: bloco.origem,
  };
}

export const GET = handle(async (req: Request) => {
  const { searchParams } = new URL(req.url);
  const de = searchParams.get("de");
  const ate = searchParams.get("ate");
  const comparar = searchParams.get("comparar") === "true";

  // Sem periodo: retrocompat — usa janela default de 30 dias para evitar
  // varrer tudo. (Antes retornava todas as campanhas legacy, mas com sync
  // ativo isso pode ser custoso.)
  if (!de || !ate) {
    const fim = new Date();
    const inicio = new Date(fim);
    inicio.setUTCDate(inicio.getUTCDate() - 30);
    const bloco = await carregarBloco(inicio, fim);
    return ok({ ...shapeBase(bloco), faturamentoAmazon: null });
  }

  const inicio = parseDataInicio(de);
  const fim = parseDataFim(ate);
  const atual = await carregarBloco(inicio, fim);
  const baseRetorno = shapeBase(atual);

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
      origem: anterior.origem,
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
  // DELETE so afeta legacy AdsCampanha — itens de sync nao tem id real
  // e sao recriados pelo proximo ciclo do worker.
  await db.adsCampanha.delete({ where: { id } });
  return ok({ ok: true });
});
