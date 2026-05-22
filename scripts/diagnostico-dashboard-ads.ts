/**
 * Diagnostico server-side: chama exatamente os mesmos helpers que o dashboard
 * usa, pra cada preset. Mostra o que a API DEVERIA estar retornando agora.
 *
 * Compare com o que o usuario ve no dashboard pra isolar:
 *  - bug do lado servidor (numeros aqui ja batem com o problema)
 *  - cache de browser/CDN (numeros aqui corretos, dashboard mostra outros)
 */

import { resolverPeriodo, PeriodoPreset } from "@/lib/periodo";
import {
  getAdsResumo,
  getAdsTimeline,
} from "@/modules/amazon/ads-aggregation";
import { dividirPorFronteiraHoje } from "@/lib/periodo";

const NOW = new Date();

async function diagnosticarPreset(preset: string, base: Date) {
  const periodo = resolverPeriodo(preset, undefined, undefined, base);
  const div = dividirPorFronteiraHoje(periodo, base);
  const resumo = await getAdsResumo(periodo);
  const timeline = await getAdsTimeline(periodo, "day");

  console.log(`\n=== Preset: ${preset} ===`);
  console.log(`Periodo (UTC):     de ${periodo.de.toISOString()}  ate ${periodo.ate.toISOString()}`);
  console.log(`Fronteira hoje:    ${div.fronteira.toISOString()}`);
  console.log(`Historico (daily): ${div.historico ? `${div.historico.de.toISOString()} → ${div.historico.ate.toISOString()}` : "null"}`);
  console.log(`Intraday (stream): ${div.intraday ? `${div.intraday.de.toISOString()} → ${div.intraday.ate.toISOString()}` : "null"}`);
  console.log(`Resumo:`);
  console.log(`  gasto:    R$ ${(resumo.gastoCentavos / 100).toFixed(2)}`);
  console.log(`  vendas:   R$ ${(resumo.vendasAtribuidasCentavos / 100).toFixed(2)}`);
  console.log(`  impressoes: ${resumo.impressoes}`);
  console.log(`  cliques:  ${resumo.cliques}`);
  console.log(`  fonte:    ${resumo.fonte}`);
  console.log(`Timeline (${timeline.length} pontos):`);
  for (const p of timeline) {
    console.log(`  ${p.data}  gasto=R$ ${(p.gastoCentavos / 100).toFixed(2)}  vendas=R$ ${(p.vendasAtribuidasCentavos / 100).toFixed(2)}`);
  }
}

async function main() {
  console.log(`Now (UTC):  ${NOW.toISOString()}`);
  console.log(`Now (BRT):  ${new Date(NOW.getTime() - 3 * 3600 * 1000).toISOString().replace("Z", " (BRT)")}`);
  await diagnosticarPreset(PeriodoPreset.HOJE, NOW);
  await diagnosticarPreset(PeriodoPreset.ONTEM, NOW);
  await diagnosticarPreset(PeriodoPreset.SETE_DIAS, NOW);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
