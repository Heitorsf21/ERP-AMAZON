import { handle, ok } from "@/lib/api";
import { db } from "@/lib/db";
import {
  getDistribuicaoCompleta,
  getProjecao,
} from "@/modules/destinacao/service";

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
      }),
      db.pedidoCompra.aggregate({
        where: { status: "CONFIRMADO" },
        _sum: { totalCentavos: true },
      }),
      db.contaReceber.aggregate({
        where: { status: "PENDENTE" },
        _sum: { valor: true },
      }),
    ]);

  const saldoAtual = (entradas._sum.valor ?? 0) - (saidas._sum.valor ?? 0);
  const comprometidoContas = contasAbertas._sum.valor ?? 0;
  const comprometidoCompras = pedidosConfirmados._sum.totalCentavos ?? 0;
  const aReceber = contasReceber._sum.valor ?? 0;
  const saldoLivre = saldoAtual - comprometidoContas - comprometidoCompras;
  const saldoProjetado = saldoLivre + aReceber;

  // Distribuição usa o SALDO PROJETADO (livre + a receber) como base.
  const distribuicao = await getDistribuicaoCompleta(Math.max(saldoProjetado, 0));
  const projecao = await getProjecao(Math.max(saldoProjetado, 0));

  return ok({
    saldoLivre,
    saldoProjetado,
    aReceber,
    distribuicao,
    projecao,
  });
});
