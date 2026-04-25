import { handle, ok } from "@/lib/api";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export const GET = handle(async (req: Request) => {
  const { searchParams } = new URL(req.url);
  const de = searchParams.get("de");
  const ate = searchParams.get("ate");

  const where = de && ate
    ? {
        periodoInicio: { lte: new Date(ate + "T23:59:59") },
        periodoFim: { gte: new Date(de + "T00:00:00") },
      }
    : {};

  const campanhas = await db.adsCampanha.findMany({
    where,
    orderBy: [{ acosPercentual: "desc" }, { gastoCentavos: "desc" }],
  });

  const totalGasto = campanhas.reduce((a, c) => a + c.gastoCentavos, 0);
  const totalVendas = campanhas.reduce((a, c) => a + c.vendasAtribuidasCentavos, 0);
  const acosGeral = totalVendas > 0 ? (totalGasto / totalVendas) * 100 : null;
  const roasGeral = totalGasto > 0 ? totalVendas / totalGasto : null;

  return ok({ campanhas, totalGasto, totalVendas, acosGeral, roasGeral });
});

export const DELETE = handle(async (req: Request) => {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) return ok({ ok: false });
  await db.adsCampanha.delete({ where: { id } });
  return ok({ ok: true });
});
