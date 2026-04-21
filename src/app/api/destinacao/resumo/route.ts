import { handle, ok } from "@/lib/api";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export const GET = handle(async () => {
  const [entradas, saidas, contasAbertas, pedidosConfirmados, contasReceber] =
    await Promise.all([
      db.movimentacao.aggregate({
        where: { tipo: "ENTRADA" },
        _sum: { valor: true },
      }),
      db.movimentacao.aggregate({
        where: { tipo: "SAIDA" },
        _sum: { valor: true },
      }),
      db.contaPagar.aggregate({
        where: { status: { in: ["ABERTA", "VENCIDA"] } },
        _sum: { valor: true },
        _count: true,
      }),
      db.pedidoCompra.aggregate({
        where: { status: "CONFIRMADO" },
        _sum: { totalCentavos: true },
        _count: true,
      }),
      db.contaReceber.aggregate({
        where: { status: "PENDENTE" },
        _sum: { valor: true },
        _count: true,
      }),
    ]);

  const saldoAtual =
    (entradas._sum.valor ?? 0) - (saidas._sum.valor ?? 0);

  const comprometidoContas = contasAbertas._sum.valor ?? 0;
  const comprometidoCompras = pedidosConfirmados._sum.totalCentavos ?? 0;
  const totalComprometido = comprometidoContas + comprometidoCompras;

  const aReceber = contasReceber._sum.valor ?? 0;

  const saldoLivre = saldoAtual - totalComprometido;
  const saldoProjetado = saldoLivre + aReceber;

  return ok({
    saldoAtual,
    comprometidoContas,
    comprometidoComprasCount: pedidosConfirmados._count,
    comprometidoCompras,
    totalComprometido,
    contasAbertasCount: contasAbertas._count,
    aReceber,
    aReceberCount: contasReceber._count,
    saldoLivre,
    saldoProjetado,
  });
});
