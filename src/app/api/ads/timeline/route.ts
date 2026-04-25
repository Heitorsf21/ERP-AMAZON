import { handle, ok } from "@/lib/api";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

// Granularidade aceita: day | week
// Estratégia: agrupa pelo dia/semana de `periodoInicio`. Se uma campanha
// abranger mais de um dia, ainda assim é creditada à data inicial — é a
// regra mais simples e estável dado que cada relatório CSV importado é
// usualmente diário ou semanal. (Quando os relatórios diários são
// importados, esta agregação é exata.)
function inicioSemana(d: Date): Date {
  const data = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
  );
  const diaSemana = data.getUTCDay(); // 0=domingo
  data.setUTCDate(data.getUTCDate() - diaSemana);
  return data;
}

function diaIso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export const GET = handle(async (req: Request) => {
  const { searchParams } = new URL(req.url);
  const de = searchParams.get("de");
  const ate = searchParams.get("ate");
  const granularidade =
    (searchParams.get("granularidade") ?? "day") === "week" ? "week" : "day";

  const where =
    de && ate
      ? {
          periodoInicio: { lte: new Date(`${ate}T23:59:59.999Z`) },
          periodoFim: { gte: new Date(`${de}T00:00:00.000Z`) },
        }
      : {};

  const campanhas = await db.adsCampanha.findMany({
    where,
    select: {
      periodoInicio: true,
      gastoCentavos: true,
      vendasAtribuidasCentavos: true,
      cliques: true,
      impressoes: true,
      pedidos: true,
    },
    orderBy: { periodoInicio: "asc" },
  });

  const buckets = new Map<
    string,
    {
      data: string;
      gastoCentavos: number;
      vendasCentavos: number;
      cliques: number;
      impressoes: number;
      pedidos: number;
    }
  >();

  for (const c of campanhas) {
    const chaveData =
      granularidade === "week"
        ? diaIso(inicioSemana(c.periodoInicio))
        : diaIso(c.periodoInicio);
    const atual = buckets.get(chaveData) ?? {
      data: chaveData,
      gastoCentavos: 0,
      vendasCentavos: 0,
      cliques: 0,
      impressoes: 0,
      pedidos: 0,
    };
    atual.gastoCentavos += c.gastoCentavos;
    atual.vendasCentavos += c.vendasAtribuidasCentavos;
    atual.cliques += c.cliques;
    atual.impressoes += c.impressoes;
    atual.pedidos += c.pedidos;
    buckets.set(chaveData, atual);
  }

  const serie = Array.from(buckets.values())
    .sort((a, b) => a.data.localeCompare(b.data))
    .map((b) => ({
      ...b,
      acos:
        b.vendasCentavos > 0 ? (b.gastoCentavos / b.vendasCentavos) * 100 : null,
      roas: b.gastoCentavos > 0 ? b.vendasCentavos / b.gastoCentavos : null,
    }));

  return ok(serie);
});
