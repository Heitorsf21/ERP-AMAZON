import { subDays } from "date-fns";
import { handle, ok } from "@/lib/api";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

// Resumo agregado por produto para enriquecer a tabela principal sem N+1.
// Retorna { id, sku, vendido30d, buyboxPercent, reembolsoPercent } por produto ativo.
export const GET = handle(async () => {
  const desde30d = subDays(new Date(), 30);
  const desde15dBuybox = subDays(new Date(), 15);

  const [produtos, vendas, reembolsos, buybox] = await Promise.all([
    db.produto.findMany({
      where: { ativo: true },
      select: { id: true, sku: true },
    }),
    db.vendaAmazon.groupBy({
      by: ["sku"],
      where: {
        dataVenda: { gte: desde30d },
        statusPedido: { notIn: ["Canceled", "REEMBOLSADO"] },
      },
      _sum: { quantidade: true },
    }),
    db.amazonReembolso.groupBy({
      by: ["sku"],
      where: { dataReembolso: { gte: desde30d } },
      _sum: { quantidade: true },
    }),
    db.buyBoxSnapshot.groupBy({
      by: ["sku"],
      where: { capturadoEm: { gte: desde15dBuybox } },
      _count: { _all: true },
      _sum: { numeroOfertas: true }, // não usado; placeholder p/ contagem
    }),
  ]);

  // Para % do tempo com buybox, precisamos saber quantos snapshots tinham somosBuybox=true.
  // GroupBy não suporta filtro condicional dentro do agregado, então buscamos
  // separadamente os snapshots em que somosBuybox=true.
  const buyboxGanhos = await db.buyBoxSnapshot.groupBy({
    by: ["sku"],
    where: { capturadoEm: { gte: desde15dBuybox }, somosBuybox: true },
    _count: { _all: true },
  });

  const vendidoPorSku = new Map(
    vendas.map((v) => [v.sku, v._sum.quantidade ?? 0]),
  );
  const devolvidoPorSku = new Map(
    reembolsos.map((r) => [r.sku, r._sum.quantidade ?? 0]),
  );
  const totalSnapsPorSku = new Map(
    buybox.map((b) => [b.sku, b._count._all]),
  );
  const ganhosPorSku = new Map(
    buyboxGanhos.map((b) => [b.sku, b._count._all]),
  );

  const resultado = produtos.map((p) => {
    const vendido30d = vendidoPorSku.get(p.sku) ?? 0;
    const devolvido = devolvidoPorSku.get(p.sku) ?? 0;
    const totalSnaps = totalSnapsPorSku.get(p.sku) ?? 0;
    const ganhos = ganhosPorSku.get(p.sku) ?? 0;

    const denominador = vendido30d + devolvido;
    const reembolsoPercent =
      denominador > 0
        ? Math.round((devolvido / denominador) * 1000) / 10
        : 0;
    const buyboxPercent =
      totalSnaps > 0 ? Math.round((ganhos / totalSnaps) * 1000) / 10 : null;

    return {
      id: p.id,
      sku: p.sku,
      vendido30d,
      buyboxPercent,
      reembolsoPercent,
    };
  });

  return ok(resultado);
});
