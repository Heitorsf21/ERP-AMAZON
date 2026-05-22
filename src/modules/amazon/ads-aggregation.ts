/**
 * Camada centralizada de agregacao de Amazon Ads.
 *
 * Regra de precedencia (espelha a logica da DRE):
 *  1) Se ha registros em AmazonAdsMetricaDiaria com gasto > 0 no periodo,
 *     fonte = SYNC -> retorna APENAS dados do sync oficial.
 *  2) Caso contrario, soma AdsCampanha (legacy CSV) + AdsGastoManual.
 *     - Ambos > 0  -> MIXED
 *     - So legacy  -> LEGACY
 *     - So manual  -> MANUAL
 *     - Nada       -> VAZIO
 *
 * Esse modulo e a unica fonte de verdade para os endpoints /api/ads/* e o
 * service do dashboard-ecommerce. Helpers de calculo (ACOS/ROAS/CTR/CPC/conv)
 * sao puros e reutilizaveis.
 */

import { formatInTimeZone } from "date-fns-tz";
import { db } from "@/lib/db";
import { TIMEZONE } from "@/lib/date";
import { dividirPorFronteiraHoje, type IntervaloPeriodo } from "@/lib/periodo";

/**
 * O Ads Reporting API entrega "date" (YYYY-MM-DD) no timezone do profile (BRT).
 * Persistimos como UTC midnight ancorado ao dia BRT — ex: dia BRT 21/05 vira
 * `2026-05-21T00:00:00.000Z`. Mas o periodo do dashboard vem BRT-shifted em UTC
 * (ex: "Ontem" = `2026-05-21T03:00:00Z` ate `2026-05-22T02:59:59Z`).
 *
 * Esse helper realinha: converte os limites BRT-shifted UTC para o "primeiro dia
 * BRT" e "ultimo dia BRT" como UTC midnight, alinhando com a coluna `data`.
 */
function rangeDataDiario(periodo: IntervaloPeriodo): { gte: Date; lte: Date } {
  const inicioDiaBrt = formatInTimeZone(periodo.de, TIMEZONE, "yyyy-MM-dd");
  const fimDiaBrt = formatInTimeZone(periodo.ate, TIMEZONE, "yyyy-MM-dd");
  return {
    gte: new Date(`${inicioDiaBrt}T00:00:00.000Z`),
    lte: new Date(`${fimDiaBrt}T23:59:59.999Z`),
  };
}

export type FonteAds =
  | "SYNC"
  | "STREAM"
  | "MIXED_STREAM_SYNC"
  | "LEGACY"
  | "MANUAL"
  | "MIXED"
  | "VAZIO";

export type AdsMetricasBase = {
  gastoCentavos: number;
  vendasAtribuidasCentavos: number;
  impressoes: number;
  cliques: number;
  pedidos: number;
  unidades: number;
};

export type AdsMetricasDerivadas = {
  acosPercentual: number | null;
  roas: number | null;
  ctrPercentual: number | null;
  cpcCentavos: number | null;
  taxaConversaoPercentual: number | null;
};

export type AdsResumo = AdsMetricasBase &
  AdsMetricasDerivadas & {
    fonte: FonteAds;
  };

export type AdsCampanhaItem = AdsMetricasBase &
  AdsMetricasDerivadas & {
    id: string;
    nomeCampanha: string;
    sku: string | null;
    asin: string | null;
    periodoInicio: Date;
    periodoFim: Date;
  };

export type AdsTimelinePonto = AdsMetricasBase &
  AdsMetricasDerivadas & {
    data: string;
  };

export type AdsPorSkuItem = AdsMetricasBase &
  AdsMetricasDerivadas & {
    sku: string;
    asin: string | null;
  };

// ────────────────────────────────────────────────────────────────────────────
// Helpers puros
// ────────────────────────────────────────────────────────────────────────────

const METRICAS_BASE_VAZIA: AdsMetricasBase = {
  gastoCentavos: 0,
  vendasAtribuidasCentavos: 0,
  impressoes: 0,
  cliques: 0,
  pedidos: 0,
  unidades: 0,
};

export function calcularDerivadas(m: AdsMetricasBase): AdsMetricasDerivadas {
  return {
    acosPercentual:
      m.vendasAtribuidasCentavos > 0
        ? (m.gastoCentavos / m.vendasAtribuidasCentavos) * 100
        : null,
    roas:
      m.gastoCentavos > 0 ? m.vendasAtribuidasCentavos / m.gastoCentavos : null,
    ctrPercentual: m.impressoes > 0 ? (m.cliques / m.impressoes) * 100 : null,
    cpcCentavos: m.cliques > 0 ? Math.round(m.gastoCentavos / m.cliques) : null,
    taxaConversaoPercentual:
      m.cliques > 0 ? (m.pedidos / m.cliques) * 100 : null,
  };
}

export function tacosPercentual(
  gastoCentavos: number,
  faturamentoCentavos: number,
): number | null {
  if (faturamentoCentavos <= 0) return null;
  return (gastoCentavos / faturamentoCentavos) * 100;
}

function acumular(a: AdsMetricasBase, b: AdsMetricasBase): AdsMetricasBase {
  return {
    gastoCentavos: a.gastoCentavos + b.gastoCentavos,
    vendasAtribuidasCentavos:
      a.vendasAtribuidasCentavos + b.vendasAtribuidasCentavos,
    impressoes: a.impressoes + b.impressoes,
    cliques: a.cliques + b.cliques,
    pedidos: a.pedidos + b.pedidos,
    unidades: a.unidades + b.unidades,
  };
}

function valorSobreposto(
  inicioGasto: Date,
  fimGasto: Date,
  periodo: IntervaloPeriodo,
  valorCentavos: number,
): number {
  const inicio = Math.max(inicioGasto.getTime(), periodo.de.getTime());
  const fim = Math.min(fimGasto.getTime(), periodo.ate.getTime());
  if (fim < inicio) return 0;

  const duracaoGasto = Math.max(1, fimGasto.getTime() - inicioGasto.getTime());
  const duracaoSobreposta = Math.max(1, fim - inicio);

  return Math.round(valorCentavos * (duracaoSobreposta / duracaoGasto));
}

function classificarFonte(
  legacyTemDado: boolean,
  manualTemDado: boolean,
): FonteAds {
  if (legacyTemDado && manualTemDado) return "MIXED";
  if (legacyTemDado) return "LEGACY";
  if (manualTemDado) return "MANUAL";
  return "VAZIO";
}

function diaIso(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function inicioSemanaUtc(date: Date): Date {
  const d = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
  const diaSemana = d.getUTCDay();
  d.setUTCDate(d.getUTCDate() - diaSemana);
  return d;
}

// ────────────────────────────────────────────────────────────────────────────
// Aggregations: histórico (daily report) vs intraday (Marketing Stream).
// ────────────────────────────────────────────────────────────────────────────

async function aggregarHistorico(
  periodo: IntervaloPeriodo,
): Promise<AdsMetricasBase> {
  const agg = await db.amazonAdsMetricaDiaria.aggregate({
    where: { data: rangeDataDiario(periodo) },
    _sum: {
      gastoCentavos: true,
      vendasCentavos: true,
      impressoes: true,
      cliques: true,
      pedidos: true,
      unidades: true,
    },
  });
  return {
    gastoCentavos: agg._sum.gastoCentavos ?? 0,
    vendasAtribuidasCentavos: agg._sum.vendasCentavos ?? 0,
    impressoes: agg._sum.impressoes ?? 0,
    cliques: agg._sum.cliques ?? 0,
    pedidos: agg._sum.pedidos ?? 0,
    unidades: agg._sum.unidades ?? 0,
  };
}

async function aggregarStream(
  periodo: IntervaloPeriodo,
): Promise<AdsMetricasBase> {
  const agg = await db.amazonAdsMetricaHoraria.aggregate({
    where: { horaInicio: { gte: periodo.de, lte: periodo.ate } },
    _sum: {
      gastoCentavos: true,
      vendasCentavos: true,
      impressoes: true,
      cliques: true,
      pedidos: true,
      unidades: true,
    },
  });
  return {
    gastoCentavos: agg._sum.gastoCentavos ?? 0,
    vendasAtribuidasCentavos: agg._sum.vendasCentavos ?? 0,
    impressoes: agg._sum.impressoes ?? 0,
    cliques: agg._sum.cliques ?? 0,
    pedidos: agg._sum.pedidos ?? 0,
    unidades: agg._sum.unidades ?? 0,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Probe de fonte: olha se ha gasto sincronizado no periodo
// ────────────────────────────────────────────────────────────────────────────

async function temGastoSync(periodo: IntervaloPeriodo): Promise<boolean> {
  const div = dividirPorFronteiraHoje(periodo);
  const promises: Promise<number>[] = [];
  if (div.historico) {
    promises.push(
      db.amazonAdsMetricaDiaria
        .aggregate({
          where: { data: rangeDataDiario(div.historico) },
          _sum: { gastoCentavos: true },
        })
        .then((a) => a._sum.gastoCentavos ?? 0),
    );
  }
  if (div.intraday) {
    promises.push(
      db.amazonAdsMetricaHoraria
        .aggregate({
          where: { horaInicio: { gte: div.intraday.de, lte: div.intraday.ate } },
          _sum: { gastoCentavos: true },
        })
        .then((a) => a._sum.gastoCentavos ?? 0),
    );
  }
  const totals = await Promise.all(promises);
  return totals.some((t) => t > 0);
}

function classificarFonteSync(
  historicoTemDado: boolean,
  intradayTemDado: boolean,
): FonteAds {
  if (historicoTemDado && intradayTemDado) return "MIXED_STREAM_SYNC";
  if (intradayTemDado) return "STREAM";
  return "SYNC";
}

// ────────────────────────────────────────────────────────────────────────────
// getAdsResumo — totais agregados do periodo
// ────────────────────────────────────────────────────────────────────────────

export async function getAdsResumo(
  periodo: IntervaloPeriodo,
): Promise<AdsResumo> {
  const div = dividirPorFronteiraHoje(periodo);
  const [historicoBase, intradayBase] = await Promise.all([
    div.historico ? aggregarHistorico(div.historico) : METRICAS_BASE_VAZIA,
    div.intraday ? aggregarStream(div.intraday) : METRICAS_BASE_VAZIA,
  ]);

  const historicoTemDado = historicoBase.gastoCentavos > 0;
  const intradayTemDado = intradayBase.gastoCentavos > 0;

  if (historicoTemDado || intradayTemDado) {
    const base = acumular(historicoBase, intradayBase);
    return {
      ...base,
      ...calcularDerivadas(base),
      fonte: classificarFonteSync(historicoTemDado, intradayTemDado),
    };
  }

  // Fallback legacy + manual
  const [legacyAgg, manualGastos] = await Promise.all([
    db.adsCampanha.aggregate({
      where: {
        periodoInicio: { lte: periodo.ate },
        periodoFim: { gte: periodo.de },
      },
      _sum: {
        gastoCentavos: true,
        vendasAtribuidasCentavos: true,
        impressoes: true,
        cliques: true,
        pedidos: true,
        unidades: true,
      },
    }),
    db.adsGastoManual.findMany({
      where: {
        periodoInicio: { lte: periodo.ate },
        periodoFim: { gte: periodo.de },
      },
      select: {
        periodoInicio: true,
        periodoFim: true,
        valorCentavos: true,
      },
    }),
  ]);

  const legacyBase: AdsMetricasBase = {
    gastoCentavos: legacyAgg._sum.gastoCentavos ?? 0,
    vendasAtribuidasCentavos: legacyAgg._sum.vendasAtribuidasCentavos ?? 0,
    impressoes: legacyAgg._sum.impressoes ?? 0,
    cliques: legacyAgg._sum.cliques ?? 0,
    pedidos: legacyAgg._sum.pedidos ?? 0,
    unidades: legacyAgg._sum.unidades ?? 0,
  };
  const manualGasto = manualGastos.reduce(
    (acc, g) =>
      acc + valorSobreposto(g.periodoInicio, g.periodoFim, periodo, g.valorCentavos),
    0,
  );

  const base: AdsMetricasBase = {
    ...legacyBase,
    gastoCentavos: legacyBase.gastoCentavos + manualGasto,
  };
  const fonte = classificarFonte(legacyBase.gastoCentavos > 0, manualGasto > 0);
  return { ...base, ...calcularDerivadas(base), fonte };
}

// ────────────────────────────────────────────────────────────────────────────
// getAdsCampanhas — uma linha por (campaignId × sku × asin) quando SYNC,
// ou por AdsCampanha quando LEGACY.
// ────────────────────────────────────────────────────────────────────────────

export async function getAdsCampanhas(
  periodo: IntervaloPeriodo,
): Promise<{ itens: AdsCampanhaItem[]; resumo: AdsResumo }> {
  const usaSync = await temGastoSync(periodo);

  if (usaSync) {
    const div = dividirPorFronteiraHoje(periodo);
    const [historicoGrupos, intradayGrupos] = await Promise.all([
      div.historico
        ? db.amazonAdsMetricaDiaria.groupBy({
            by: ["campaignId", "sku", "asin"],
            where: { data: rangeDataDiario(div.historico) },
            _sum: {
              gastoCentavos: true,
              vendasCentavos: true,
              impressoes: true,
              cliques: true,
              pedidos: true,
              unidades: true,
            },
          })
        : Promise.resolve([] as never[]),
      div.intraday
        ? db.amazonAdsMetricaHoraria.groupBy({
            by: ["campaignId", "sku", "asin"],
            where: {
              horaInicio: { gte: div.intraday.de, lte: div.intraday.ate },
            },
            _sum: {
              gastoCentavos: true,
              vendasCentavos: true,
              impressoes: true,
              cliques: true,
              pedidos: true,
              unidades: true,
            },
          })
        : Promise.resolve([] as never[]),
    ]);

    type CampanhaKey = { campaignId: string; sku: string | null; asin: string | null };
    const mapaCamp = new Map<string, CampanhaKey & AdsMetricasBase>();
    const acumularEm = (
      campaignId: string,
      sku: string | null,
      asin: string | null,
      base: AdsMetricasBase,
    ) => {
      const k = `${campaignId}|${sku ?? ""}|${asin ?? ""}`;
      const atual = mapaCamp.get(k) ?? {
        campaignId,
        sku: sku ?? null,
        asin: asin ?? null,
        ...METRICAS_BASE_VAZIA,
      };
      mapaCamp.set(k, { ...atual, ...acumular(atual, base) });
    };
    for (const g of historicoGrupos) {
      acumularEm(g.campaignId, g.sku ?? null, g.asin ?? null, {
        gastoCentavos: g._sum.gastoCentavos ?? 0,
        vendasAtribuidasCentavos: g._sum.vendasCentavos ?? 0,
        impressoes: g._sum.impressoes ?? 0,
        cliques: g._sum.cliques ?? 0,
        pedidos: g._sum.pedidos ?? 0,
        unidades: g._sum.unidades ?? 0,
      });
    }
    for (const g of intradayGrupos) {
      acumularEm(g.campaignId, g.sku ?? null, g.asin ?? null, {
        gastoCentavos: g._sum.gastoCentavos ?? 0,
        vendasAtribuidasCentavos: g._sum.vendasCentavos ?? 0,
        impressoes: g._sum.impressoes ?? 0,
        cliques: g._sum.cliques ?? 0,
        pedidos: g._sum.pedidos ?? 0,
        unidades: g._sum.unidades ?? 0,
      });
    }
    const grupos = Array.from(mapaCamp.values()).map((g) => ({
      campaignId: g.campaignId,
      sku: g.sku,
      asin: g.asin,
      _sum: {
        gastoCentavos: g.gastoCentavos,
        vendasCentavos: g.vendasAtribuidasCentavos,
        impressoes: g.impressoes,
        cliques: g.cliques,
        pedidos: g.pedidos,
        unidades: g.unidades,
      },
    }));

    const campaignIds = Array.from(new Set(grupos.map((g) => g.campaignId)));
    const campanhas = campaignIds.length
      ? await db.amazonAdsCampanha.findMany({
          where: { campaignId: { in: campaignIds } },
          select: { campaignId: true, nome: true },
        })
      : [];
    const nomePorCampaign = new Map(
      campanhas.map((c) => [c.campaignId, c.nome] as const),
    );

    const itens: AdsCampanhaItem[] = grupos
      .map((g) => {
        const base: AdsMetricasBase = {
          gastoCentavos: g._sum.gastoCentavos ?? 0,
          vendasAtribuidasCentavos: g._sum.vendasCentavos ?? 0,
          impressoes: g._sum.impressoes ?? 0,
          cliques: g._sum.cliques ?? 0,
          pedidos: g._sum.pedidos ?? 0,
          unidades: g._sum.unidades ?? 0,
        };
        return {
          id: `${g.campaignId}|${g.sku ?? ""}|${g.asin ?? ""}`,
          nomeCampanha: nomePorCampaign.get(g.campaignId) ?? g.campaignId,
          sku: g.sku ?? null,
          asin: g.asin ?? null,
          periodoInicio: periodo.de,
          periodoFim: periodo.ate,
          ...base,
          ...calcularDerivadas(base),
        };
      })
      .sort((a, b) => b.gastoCentavos - a.gastoCentavos);

    const resumoBase = itens.reduce<AdsMetricasBase>(
      (acc, i) =>
        acumular(acc, {
          gastoCentavos: i.gastoCentavos,
          vendasAtribuidasCentavos: i.vendasAtribuidasCentavos,
          impressoes: i.impressoes,
          cliques: i.cliques,
          pedidos: i.pedidos,
          unidades: i.unidades,
        }),
      METRICAS_BASE_VAZIA,
    );
    const historicoTemGasto = historicoGrupos.some(
      (g) => (g._sum.gastoCentavos ?? 0) > 0,
    );
    const intradayTemGasto = intradayGrupos.some(
      (g) => (g._sum.gastoCentavos ?? 0) > 0,
    );
    return {
      itens,
      resumo: {
        ...resumoBase,
        ...calcularDerivadas(resumoBase),
        fonte: classificarFonteSync(historicoTemGasto, intradayTemGasto),
      },
    };
  }

  // Fallback LEGACY (AdsCampanha) — manual nao gera "campanha" individual.
  const campanhas = await db.adsCampanha.findMany({
    where: {
      periodoInicio: { lte: periodo.ate },
      periodoFim: { gte: periodo.de },
    },
    orderBy: [{ acosPercentual: "desc" }, { gastoCentavos: "desc" }],
  });

  const itens: AdsCampanhaItem[] = campanhas.map((c) => {
    const base: AdsMetricasBase = {
      gastoCentavos: c.gastoCentavos,
      vendasAtribuidasCentavos: c.vendasAtribuidasCentavos,
      impressoes: c.impressoes,
      cliques: c.cliques,
      pedidos: c.pedidos,
      unidades: c.unidades,
    };
    return {
      id: c.id,
      nomeCampanha: c.nomeCampanha,
      sku: c.sku,
      asin: c.asin,
      periodoInicio: c.periodoInicio,
      periodoFim: c.periodoFim,
      ...base,
      ...calcularDerivadas(base),
    };
  });

  // Resumo do fallback: legacy + manual (mesma regra da DRE)
  const resumo = await getAdsResumo(periodo);
  return { itens, resumo };
}

// ────────────────────────────────────────────────────────────────────────────
// getAdsTimeline — pontos diarios/semanais
// ────────────────────────────────────────────────────────────────────────────

export async function getAdsTimeline(
  periodo: IntervaloPeriodo,
  granularidade: "day" | "week" = "day",
): Promise<AdsTimelinePonto[]> {
  const usaSync = await temGastoSync(periodo);

  const buckets = new Map<string, AdsMetricasBase>();

  if (usaSync) {
    const div = dividirPorFronteiraHoje(periodo);
    const [historicoGrupos, intradayGrupos] = await Promise.all([
      div.historico
        ? db.amazonAdsMetricaDiaria.groupBy({
            by: ["data"],
            where: { data: rangeDataDiario(div.historico) },
            _sum: {
              gastoCentavos: true,
              vendasCentavos: true,
              impressoes: true,
              cliques: true,
              pedidos: true,
              unidades: true,
            },
          })
        : Promise.resolve([] as never[]),
      div.intraday
        ? db.amazonAdsMetricaHoraria.groupBy({
            by: ["horaInicio"],
            where: {
              horaInicio: { gte: div.intraday.de, lte: div.intraday.ate },
            },
            _sum: {
              gastoCentavos: true,
              vendasCentavos: true,
              impressoes: true,
              cliques: true,
              pedidos: true,
              unidades: true,
            },
          })
        : Promise.resolve([] as never[]),
    ]);

    for (const g of historicoGrupos) {
      const chave =
        granularidade === "week"
          ? diaIso(inicioSemanaUtc(g.data))
          : diaIso(g.data);
      const base: AdsMetricasBase = {
        gastoCentavos: g._sum.gastoCentavos ?? 0,
        vendasAtribuidasCentavos: g._sum.vendasCentavos ?? 0,
        impressoes: g._sum.impressoes ?? 0,
        cliques: g._sum.cliques ?? 0,
        pedidos: g._sum.pedidos ?? 0,
        unidades: g._sum.unidades ?? 0,
      };
      buckets.set(chave, acumular(buckets.get(chave) ?? METRICAS_BASE_VAZIA, base));
    }
    for (const g of intradayGrupos) {
      const chave =
        granularidade === "week"
          ? diaIso(inicioSemanaUtc(g.horaInicio))
          : diaIso(g.horaInicio);
      const base: AdsMetricasBase = {
        gastoCentavos: g._sum.gastoCentavos ?? 0,
        vendasAtribuidasCentavos: g._sum.vendasCentavos ?? 0,
        impressoes: g._sum.impressoes ?? 0,
        cliques: g._sum.cliques ?? 0,
        pedidos: g._sum.pedidos ?? 0,
        unidades: g._sum.unidades ?? 0,
      };
      buckets.set(chave, acumular(buckets.get(chave) ?? METRICAS_BASE_VAZIA, base));
    }
  } else {
    // LEGACY: agrupa AdsCampanha pelo dia/semana de periodoInicio
    const campanhas = await db.adsCampanha.findMany({
      where: {
        periodoInicio: { lte: periodo.ate },
        periodoFim: { gte: periodo.de },
      },
      select: {
        periodoInicio: true,
        gastoCentavos: true,
        vendasAtribuidasCentavos: true,
        cliques: true,
        impressoes: true,
        pedidos: true,
        unidades: true,
      },
      orderBy: { periodoInicio: "asc" },
    });

    for (const c of campanhas) {
      const chave =
        granularidade === "week"
          ? diaIso(inicioSemanaUtc(c.periodoInicio))
          : diaIso(c.periodoInicio);
      const base: AdsMetricasBase = {
        gastoCentavos: c.gastoCentavos,
        vendasAtribuidasCentavos: c.vendasAtribuidasCentavos,
        impressoes: c.impressoes,
        cliques: c.cliques,
        pedidos: c.pedidos,
        unidades: c.unidades,
      };
      buckets.set(chave, acumular(buckets.get(chave) ?? METRICAS_BASE_VAZIA, base));
    }
  }

  return Array.from(buckets.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([data, base]) => ({
      data,
      ...base,
      ...calcularDerivadas(base),
    }));
}

// ────────────────────────────────────────────────────────────────────────────
// getAdsPorSku — agregado por SKU
// ────────────────────────────────────────────────────────────────────────────

export async function getAdsPorSku(
  periodo: IntervaloPeriodo,
): Promise<AdsPorSkuItem[]> {
  const usaSync = await temGastoSync(periodo);

  const mapa = new Map<string, AdsMetricasBase & { asin: string | null }>();

  if (usaSync) {
    const div = dividirPorFronteiraHoje(periodo);
    const [historicoGrupos, intradayGrupos] = await Promise.all([
      div.historico
        ? db.amazonAdsMetricaDiaria.groupBy({
            by: ["sku", "asin"],
            where: {
              data: rangeDataDiario(div.historico),
              sku: { not: null },
            },
            _sum: {
              gastoCentavos: true,
              vendasCentavos: true,
              impressoes: true,
              cliques: true,
              pedidos: true,
              unidades: true,
            },
          })
        : Promise.resolve([] as never[]),
      div.intraday
        ? db.amazonAdsMetricaHoraria.groupBy({
            by: ["sku", "asin"],
            where: {
              horaInicio: { gte: div.intraday.de, lte: div.intraday.ate },
              sku: { not: null },
            },
            _sum: {
              gastoCentavos: true,
              vendasCentavos: true,
              impressoes: true,
              cliques: true,
              pedidos: true,
              unidades: true,
            },
          })
        : Promise.resolve([] as never[]),
    ]);

    const acumularEm = (
      sku: string | null,
      asin: string | null,
      base: AdsMetricasBase,
    ) => {
      if (!sku) return;
      const atual =
        mapa.get(sku) ?? { ...METRICAS_BASE_VAZIA, asin: asin ?? null };
      const somado = acumular(atual, base);
      mapa.set(sku, {
        ...somado,
        asin: atual.asin ?? asin ?? null,
      });
    };
    for (const g of historicoGrupos) {
      acumularEm(g.sku ?? null, g.asin ?? null, {
        gastoCentavos: g._sum.gastoCentavos ?? 0,
        vendasAtribuidasCentavos: g._sum.vendasCentavos ?? 0,
        impressoes: g._sum.impressoes ?? 0,
        cliques: g._sum.cliques ?? 0,
        pedidos: g._sum.pedidos ?? 0,
        unidades: g._sum.unidades ?? 0,
      });
    }
    for (const g of intradayGrupos) {
      acumularEm(g.sku ?? null, g.asin ?? null, {
        gastoCentavos: g._sum.gastoCentavos ?? 0,
        vendasAtribuidasCentavos: g._sum.vendasCentavos ?? 0,
        impressoes: g._sum.impressoes ?? 0,
        cliques: g._sum.cliques ?? 0,
        pedidos: g._sum.pedidos ?? 0,
        unidades: g._sum.unidades ?? 0,
      });
    }
  } else {
    const campanhas = await db.adsCampanha.findMany({
      where: {
        periodoInicio: { lte: periodo.ate },
        periodoFim: { gte: periodo.de },
        sku: { not: null },
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

    for (const c of campanhas) {
      const sku = c.sku?.trim();
      if (!sku) continue;
      const atual =
        mapa.get(sku) ?? { ...METRICAS_BASE_VAZIA, asin: c.asin ?? null };
      const base: AdsMetricasBase = {
        gastoCentavos: c.gastoCentavos,
        vendasAtribuidasCentavos: c.vendasAtribuidasCentavos,
        impressoes: c.impressoes,
        cliques: c.cliques,
        pedidos: c.pedidos,
        unidades: c.unidades,
      };
      const somado = acumular(atual, base);
      mapa.set(sku, {
        ...somado,
        asin: atual.asin ?? c.asin ?? null,
      });
    }
  }

  return Array.from(mapa.entries())
    .map(([sku, dados]) => {
      const base: AdsMetricasBase = {
        gastoCentavos: dados.gastoCentavos,
        vendasAtribuidasCentavos: dados.vendasAtribuidasCentavos,
        impressoes: dados.impressoes,
        cliques: dados.cliques,
        pedidos: dados.pedidos,
        unidades: dados.unidades,
      };
      return {
        sku,
        asin: dados.asin,
        ...base,
        ...calcularDerivadas(base),
      };
    })
    .sort((a, b) => b.gastoCentavos - a.gastoCentavos);
}

// ────────────────────────────────────────────────────────────────────────────
// getAdsGastoPorProduto — usado pelo dashboard-ecommerce::obterTopProdutos
// Retorna mapa produtoId -> centavos + bucket "sem produto" para rateio.
// ────────────────────────────────────────────────────────────────────────────

export async function getAdsGastoPorProduto(
  periodo: IntervaloPeriodo,
): Promise<{
  porProdutoId: Map<string, number>;
  gastoSemProduto: number;
  fonte: FonteAds;
}> {
  const usaSync = await temGastoSync(periodo);
  const porProdutoId = new Map<string, number>();
  let gastoSemProduto = 0;

  if (usaSync) {
    const div = dividirPorFronteiraHoje(periodo);

    // 1) Linhas com produtoId direto (historico + intraday)
    const [comProdutoHist, comProdutoIntra] = await Promise.all([
      div.historico
        ? db.amazonAdsMetricaDiaria.groupBy({
            by: ["produtoId"],
            where: {
              data: rangeDataDiario(div.historico),
              produtoId: { not: null },
            },
            _sum: { gastoCentavos: true },
          })
        : Promise.resolve([] as never[]),
      div.intraday
        ? db.amazonAdsMetricaHoraria.groupBy({
            by: ["produtoId"],
            where: {
              horaInicio: { gte: div.intraday.de, lte: div.intraday.ate },
              produtoId: { not: null },
            },
            _sum: { gastoCentavos: true },
          })
        : Promise.resolve([] as never[]),
    ]);
    for (const g of [...comProdutoHist, ...comProdutoIntra]) {
      if (!g.produtoId) continue;
      porProdutoId.set(
        g.produtoId,
        (porProdutoId.get(g.produtoId) ?? 0) + (g._sum.gastoCentavos ?? 0),
      );
    }

    // 2) Linhas sem produtoId mas com SKU -> resolve via Produto
    const [semProdutoComSkuHist, semProdutoComSkuIntra] = await Promise.all([
      div.historico
        ? db.amazonAdsMetricaDiaria.groupBy({
            by: ["sku"],
            where: {
              data: rangeDataDiario(div.historico),
              produtoId: null,
              sku: { not: null },
            },
            _sum: { gastoCentavos: true },
          })
        : Promise.resolve([] as never[]),
      div.intraday
        ? db.amazonAdsMetricaHoraria.groupBy({
            by: ["sku"],
            where: {
              horaInicio: { gte: div.intraday.de, lte: div.intraday.ate },
              produtoId: null,
              sku: { not: null },
            },
            _sum: { gastoCentavos: true },
          })
        : Promise.resolve([] as never[]),
    ]);
    const todosOrfaos = [...semProdutoComSkuHist, ...semProdutoComSkuIntra];
    const skusOrfaos = Array.from(
      new Set(
        todosOrfaos
          .map((g) => g.sku)
          .filter((s): s is string => !!s),
      ),
    );
    const produtosResolvidos = skusOrfaos.length
      ? await db.produto.findMany({
          where: { sku: { in: skusOrfaos } },
          select: { id: true, sku: true },
        })
      : [];
    const produtoIdPorSku = new Map(
      produtosResolvidos.map((p) => [p.sku, p.id] as const),
    );
    for (const g of todosOrfaos) {
      const gasto = g._sum.gastoCentavos ?? 0;
      if (!gasto) continue;
      const pid = g.sku ? produtoIdPorSku.get(g.sku) : undefined;
      if (pid) {
        porProdutoId.set(pid, (porProdutoId.get(pid) ?? 0) + gasto);
      } else {
        gastoSemProduto += gasto;
      }
    }

    // 3) Linhas totalmente orfas -> sem produto
    const [orfasHist, orfasIntra] = await Promise.all([
      div.historico
        ? db.amazonAdsMetricaDiaria.aggregate({
            where: {
              data: rangeDataDiario(div.historico),
              produtoId: null,
              sku: null,
            },
            _sum: { gastoCentavos: true },
          })
        : Promise.resolve({ _sum: { gastoCentavos: 0 } }),
      div.intraday
        ? db.amazonAdsMetricaHoraria.aggregate({
            where: {
              horaInicio: { gte: div.intraday.de, lte: div.intraday.ate },
              produtoId: null,
              sku: null,
            },
            _sum: { gastoCentavos: true },
          })
        : Promise.resolve({ _sum: { gastoCentavos: 0 } }),
    ]);
    gastoSemProduto += (orfasHist._sum.gastoCentavos ?? 0) + (orfasIntra._sum.gastoCentavos ?? 0);

    const historicoTemDado =
      comProdutoHist.length > 0 ||
      semProdutoComSkuHist.length > 0 ||
      (orfasHist._sum.gastoCentavos ?? 0) > 0;
    const intradayTemDado =
      comProdutoIntra.length > 0 ||
      semProdutoComSkuIntra.length > 0 ||
      (orfasIntra._sum.gastoCentavos ?? 0) > 0;
    return {
      porProdutoId,
      gastoSemProduto,
      fonte: classificarFonteSync(historicoTemDado, intradayTemDado),
    };
  }

  // Fallback: legacy (AdsCampanha por SKU -> Produto) + manual (AdsGastoManual.produtoId)
  const [campanhasLegacy, gastosManuais] = await Promise.all([
    db.adsCampanha.findMany({
      where: {
        periodoInicio: { lte: periodo.ate },
        periodoFim: { gte: periodo.de },
      },
      select: {
        sku: true,
        gastoCentavos: true,
        periodoInicio: true,
        periodoFim: true,
      },
    }),
    db.adsGastoManual.findMany({
      where: {
        periodoInicio: { lte: periodo.ate },
        periodoFim: { gte: periodo.de },
      },
      select: {
        produtoId: true,
        valorCentavos: true,
        periodoInicio: true,
        periodoFim: true,
      },
    }),
  ]);

  // Resolve produtoId dos SKUs do legacy
  const skusLegacy = Array.from(
    new Set(
      campanhasLegacy
        .map((c) => c.sku)
        .filter((s): s is string => !!s),
    ),
  );
  const produtosLegacy = skusLegacy.length
    ? await db.produto.findMany({
        where: { sku: { in: skusLegacy } },
        select: { id: true, sku: true },
      })
    : [];
  const pidPorSku = new Map(produtosLegacy.map((p) => [p.sku, p.id] as const));

  for (const c of campanhasLegacy) {
    const valor = valorSobreposto(
      c.periodoInicio,
      c.periodoFim,
      periodo,
      c.gastoCentavos,
    );
    if (!valor) continue;
    const pid = c.sku ? pidPorSku.get(c.sku) : undefined;
    if (pid) {
      porProdutoId.set(pid, (porProdutoId.get(pid) ?? 0) + valor);
    } else {
      gastoSemProduto += valor;
    }
  }

  let manualTemDado = false;
  for (const g of gastosManuais) {
    const valor = valorSobreposto(
      g.periodoInicio,
      g.periodoFim,
      periodo,
      g.valorCentavos,
    );
    if (!valor) continue;
    manualTemDado = true;
    if (g.produtoId) {
      porProdutoId.set(
        g.produtoId,
        (porProdutoId.get(g.produtoId) ?? 0) + valor,
      );
    } else {
      gastoSemProduto += valor;
    }
  }

  const legacyTemDado = campanhasLegacy.some((c) => c.gastoCentavos > 0);
  return {
    porProdutoId,
    gastoSemProduto,
    fonte: classificarFonte(legacyTemDado, manualTemDado),
  };
}
