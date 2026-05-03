import { subDays } from "date-fns";
import { handle, ok, erro } from "@/lib/api";
import { db } from "@/lib/db";
import { whereVendaAmazonContabilizavel } from "@/modules/vendas/filtros";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

type PorDiaItem = { data: string; quantidade: number; receitaCentavos: number };

export const GET = handle(async (req: Request, { params }: Params) => {
  const { id } = await params;
  const { searchParams } = new URL(req.url);
  const diasParam = Number(searchParams.get("dias") ?? "30");
  const dias = Number.isFinite(diasParam) && diasParam > 0 ? Math.min(diasParam, 365) : 30;

  const produto = await db.produto.findUnique({
    where: { id },
    select: { sku: true },
  });
  if (!produto) return erro(404, "produto não encontrado");

  const desde = subDays(new Date(), dias);

  const vendas = await db.vendaAmazon.findMany({
    where: whereVendaAmazonContabilizavel({
      sku: produto.sku,
      dataVenda: { gte: desde },
    }),
    select: {
      quantidade: true,
      precoUnitarioCentavos: true,
      valorBrutoCentavos: true,
      liquidoMarketplaceCentavos: true,
      dataVenda: true,
    },
    orderBy: { dataVenda: "asc" },
  });

  let totalUnidades = 0;
  let totalLiquidoCentavos = 0;
  const porDiaMap = new Map<string, { quantidade: number; receitaCentavos: number }>();

  for (const v of vendas) {
    totalUnidades += v.quantidade;
    const liquido =
      v.liquidoMarketplaceCentavos ??
      v.valorBrutoCentavos ??
      v.precoUnitarioCentavos * v.quantidade;
    totalLiquidoCentavos += liquido;

    const chave = v.dataVenda.toISOString().slice(0, 10);
    const atual = porDiaMap.get(chave) ?? { quantidade: 0, receitaCentavos: 0 };
    atual.quantidade += v.quantidade;
    atual.receitaCentavos += liquido;
    porDiaMap.set(chave, atual);
  }

  const transacoes = vendas.length;
  const ticketMedioCentavos =
    transacoes > 0 ? Math.round(totalLiquidoCentavos / transacoes) : 0;

  const porDia: PorDiaItem[] = [...porDiaMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([data, v]) => ({ data, ...v }));

  return ok({
    totalUnidades,
    totalLiquidoCentavos,
    ticketMedioCentavos,
    transacoes,
    porDia,
  });
});
