import { subDays } from "date-fns";
import { handle, ok } from "@/lib/api";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export const GET = handle(async () => {
  const desde = subDays(new Date(), 30);

  const [produtos, vendas] = await Promise.all([
    db.produto.findMany({
      where: { ativo: true },
      select: { id: true, sku: true, estoqueAtual: true },
    }),
    db.vendaAmazon.groupBy({
      by: ["sku"],
      where: {
        dataVenda: { gte: desde },
        statusPedido: { notIn: ["Canceled", "REEMBOLSADO"] },
      },
      _sum: { quantidade: true },
    }),
  ]);

  const vendasPorSku = new Map(
    vendas.map((v) => [v.sku, v._sum.quantidade ?? 0]),
  );

  const resultado = produtos.map((p) => {
    const vendido30d = vendasPorSku.get(p.sku) ?? 0;
    const unidadesPorDia = vendido30d / 30;
    const diasEstoque =
      unidadesPorDia > 0 ? Math.floor(p.estoqueAtual / unidadesPorDia) : null;
    const criticidade =
      diasEstoque == null
        ? "SEM_VENDAS"
        : diasEstoque < 15
          ? "CRITICO"
          : diasEstoque < 30
            ? "ATENCAO"
            : "OK";

    return {
      produtoId: p.id,
      sku: p.sku,
      vendido30d,
      unidadesPorDia: Math.round(unidadesPorDia * 10) / 10,
      diasEstoque,
      criticidade,
    };
  });

  return ok(resultado);
});
