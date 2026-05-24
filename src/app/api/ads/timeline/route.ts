import { handleAuth, ok } from "@/lib/api";
import { UsuarioRole } from "@/lib/auth";
import { PeriodoPreset, resolverPeriodo } from "@/lib/periodo";
import { getAdsTimeline } from "@/modules/amazon/ads-aggregation";

export const dynamic = "force-dynamic";

// Granularidade aceita: day | week. Se houver dados em AmazonAdsMetricaDiaria
// no periodo, agrupa pelo dia real. Caso contrario, cai no fallback legacy
// (AdsCampanha agrupada pelo dia/semana de periodoInicio).
export const GET = handleAuth([UsuarioRole.ADMIN], async (req: Request) => {
  const { searchParams } = new URL(req.url);
  const de = searchParams.get("de");
  const ate = searchParams.get("ate");
  const granularidade =
    (searchParams.get("granularidade") ?? "day") === "week" ? "week" : "day";

  // Sem periodo, devolve serie vazia — chamadas anteriores caiam no
  // comportamento "todas as campanhas" via AdsCampanha; com sync ativo isso
  // pode ser custoso. Front sempre passa de/ate.
  if (!de || !ate) return ok([]);

  // Interpretar de/ate como dia BRT (timezone America/Sao_Paulo) — NAO UTC
  // midnight. resolverPeriodo PERSONALIZADO faz fromZonedTime com TIMEZONE.
  const periodo = resolverPeriodo(PeriodoPreset.PERSONALIZADO, de, ate);

  const serie = await getAdsTimeline(periodo, granularidade);

  // Mantem o shape historico do endpoint: { data, gastoCentavos,
  // vendasCentavos, cliques, impressoes, pedidos, acos, roas }.
  return ok(
    serie.map((p) => ({
      data: p.data,
      gastoCentavos: p.gastoCentavos,
      vendasCentavos: p.vendasAtribuidasCentavos,
      cliques: p.cliques,
      impressoes: p.impressoes,
      pedidos: p.pedidos,
      acos: p.acosPercentual,
      roas: p.roas,
    })),
  );
});
