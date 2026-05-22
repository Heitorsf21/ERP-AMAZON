/**
 * Debug read-only: retorna o resultado de getAdsResumo para multiplos presets,
 * sem passar por React Query nem cache do client. Util para confirmar que o
 * backend esta retornando os valores corretos quando o dashboard mostra
 * numeros estranhos.
 *
 * GET /api/_debug/ads-resumo
 *
 * Requer ADMIN.
 */

import { handle, ok } from "@/lib/api";
import { requireRole, UsuarioRole } from "@/lib/auth";
import {
  dividirPorFronteiraHoje,
  PeriodoPreset,
  resolverPeriodo,
} from "@/lib/periodo";
import {
  getAdsResumo,
  getAdsTimeline,
} from "@/modules/amazon/ads-aggregation";

export const dynamic = "force-dynamic";

export const GET = handle(async () => {
  await requireRole(UsuarioRole.ADMIN);

  const now = new Date();
  const presets = [
    PeriodoPreset.HOJE,
    PeriodoPreset.ONTEM,
    PeriodoPreset.SETE_DIAS,
    PeriodoPreset.TRINTA_DIAS,
  ];

  const resultados = [];
  for (const preset of presets) {
    const periodo = resolverPeriodo(preset, undefined, undefined, now);
    const div = dividirPorFronteiraHoje(periodo, now);
    const resumo = await getAdsResumo(periodo);
    const timeline = await getAdsTimeline(periodo, "day");

    resultados.push({
      preset,
      periodo: {
        de: periodo.de.toISOString(),
        ate: periodo.ate.toISOString(),
      },
      divisao: {
        fronteira: div.fronteira.toISOString(),
        historico: div.historico
          ? {
              de: div.historico.de.toISOString(),
              ate: div.historico.ate.toISOString(),
            }
          : null,
        intraday: div.intraday
          ? {
              de: div.intraday.de.toISOString(),
              ate: div.intraday.ate.toISOString(),
            }
          : null,
      },
      resumo: {
        gastoBrl: resumo.gastoCentavos / 100,
        vendasBrl: resumo.vendasAtribuidasCentavos / 100,
        impressoes: resumo.impressoes,
        cliques: resumo.cliques,
        fonte: resumo.fonte,
      },
      timeline: timeline.map((p) => ({
        data: p.data,
        gastoBrl: p.gastoCentavos / 100,
        vendasBrl: p.vendasAtribuidasCentavos / 100,
      })),
    });
  }

  return ok({
    nowIso: now.toISOString(),
    nowBrt: new Date(now.getTime() - 3 * 3600 * 1000)
      .toISOString()
      .replace("Z", " BRT"),
    presets: resultados,
  });
});
