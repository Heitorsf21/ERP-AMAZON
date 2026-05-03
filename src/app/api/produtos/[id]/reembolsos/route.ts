import { subDays } from "date-fns";
import { handle, ok, erro } from "@/lib/api";
import { db } from "@/lib/db";
import { whereVendaAmazonContabilizavel } from "@/modules/vendas/filtros";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

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

  const [reembolsos, vendasAgg] = await Promise.all([
    db.amazonReembolso.findMany({
      where: {
        OR: [{ produtoId: id }, { sku: produto.sku }],
        dataReembolso: { gte: desde },
      },
      select: {
        quantidade: true,
        valorReembolsadoCentavos: true,
        motivoCategoria: true,
      },
    }),
    db.vendaAmazon.aggregate({
      where: whereVendaAmazonContabilizavel({
        sku: produto.sku,
        dataVenda: { gte: desde },
      }),
      _sum: { quantidade: true },
    }),
  ]);

  let qtdDevolvida = 0;
  let valorReembolsadoCentavos = 0;
  const motivoMap = new Map<string, { quantidade: number; valor: number }>();

  for (const r of reembolsos) {
    qtdDevolvida += r.quantidade;
    valorReembolsadoCentavos += r.valorReembolsadoCentavos;
    const chave = r.motivoCategoria ?? "Sem categoria";
    const atual = motivoMap.get(chave) ?? { quantidade: 0, valor: 0 };
    atual.quantidade += r.quantidade;
    atual.valor += r.valorReembolsadoCentavos;
    motivoMap.set(chave, atual);
  }

  const vendido = vendasAgg._sum.quantidade ?? 0;
  const denominador = vendido + qtdDevolvida;
  const percentualReembolso =
    denominador > 0
      ? Math.round((qtdDevolvida / denominador) * 1000) / 10
      : 0;

  const porMotivo = [...motivoMap.entries()]
    .sort((a, b) => b[1].quantidade - a[1].quantidade)
    .map(([motivoCategoria, v]) => ({
      motivoCategoria,
      quantidade: v.quantidade,
      valor: v.valor,
    }));

  return ok({
    total: reembolsos.length,
    qtdDevolvida,
    valorReembolsadoCentavos,
    percentualReembolso,
    porMotivo,
  });
});
