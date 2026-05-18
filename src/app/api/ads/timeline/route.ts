import { handle, ok } from "@/lib/api";
import { getAdsTimeline } from "@/modules/amazon/ads-aggregation";

export const dynamic = "force-dynamic";

// Granularidade aceita: day | week. Se houver dados em AmazonAdsMetricaDiaria
// no periodo, agrupa pelo dia real. Caso contrario, cai no fallback legacy
// (AdsCampanha agrupada pelo dia/semana de periodoInicio).
export const GET = handle(async (req: Request) => {
  const { searchParams } = new URL(req.url);
  const de = searchParams.get("de");
  const ate = searchParams.get("ate");
  const granularidade =
    (searchParams.get("granularidade") ?? "day") === "week" ? "week" : "day";

  // Sem periodo, devolve serie vazia — chamadas anteriores caiam no
  // comportamento "todas as campanhas" via AdsCampanha; com sync ativo isso
  // pode ser custoso. Front sempre passa de/ate.
  if (!de || !ate) return ok([]);

  const periodo = {
    de: new Date(`${de}T00:00:00.000Z`),
    ate: new Date(`${ate}T23:59:59.999Z`),
  };

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
