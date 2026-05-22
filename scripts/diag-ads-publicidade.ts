/**
 * Diagnostico do fluxo da pagina /publicidade: simula o que o endpoint
 * /api/ads/timeline e /api/ads/campanhas fazem ao receber YYYY-MM-DD do front.
 * Compara o periodo resultante com o que aggregation entrega.
 */

import { PeriodoPreset, resolverPeriodo } from "@/lib/periodo";
import { getAdsResumo, getAdsTimeline } from "@/modules/amazon/ads-aggregation";

async function testar(de: string, ate: string) {
  const periodo = resolverPeriodo(PeriodoPreset.PERSONALIZADO, de, ate);
  const resumo = await getAdsResumo(periodo);
  const timeline = await getAdsTimeline(periodo, "day");

  console.log(`\n=== Front envia: de=${de} ate=${ate} ===`);
  console.log(`Periodo resolvido (UTC): de ${periodo.de.toISOString()}  ate ${periodo.ate.toISOString()}`);
  console.log(`Resumo:  gasto=R$ ${(resumo.gastoCentavos / 100).toFixed(2)}  vendas=R$ ${(resumo.vendasAtribuidasCentavos / 100).toFixed(2)}  fonte=${resumo.fonte}`);
  console.log(`Timeline (${timeline.length} pontos):`);
  for (const p of timeline) {
    console.log(`  ${p.data}  gasto=R$ ${(p.gastoCentavos / 100).toFixed(2)}  vendas=R$ ${(p.vendasAtribuidasCentavos / 100).toFixed(2)}`);
  }
}

async function main() {
  console.log(`Now (UTC): ${new Date().toISOString()}`);
  await testar("2026-05-21", "2026-05-21"); // Ontem
  await testar("2026-05-22", "2026-05-22"); // Hoje
  await testar("2026-05-20", "2026-05-20"); // Anteontem
  await testar("2026-05-15", "2026-05-21"); // 7d
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
