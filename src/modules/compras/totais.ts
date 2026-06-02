import { StatusPedidoCompra } from "@/modules/shared/domain";

export type PedidoTotais = {
  totalCentavos: number;
  status: string;
  dataEmissao: Date;
  dataRecebimento: Date | null;
};

export type TotaisCompras = {
  compradoNoPeriodoCentavos: number;
  aReceberCentavos: number;
  rascunho: number;
  ticketMedioCentavos: number | null;
  pedidosNoPeriodo: number;
};

/**
 * KPIs da aba Compras a partir da lista de pedidos (funcao pura, testavel).
 *
 * - compradoNoPeriodo: soma de totalCentavos dos pedidos NAO cancelados com
 *   dataEmissao dentro de [de, ate].
 * - aReceber: soma de totalCentavos dos CONFIRMADO ainda sem dataRecebimento
 *   (independe do periodo — sao compromissos em aberto).
 * - rascunho: contagem de pedidos em RASCUNHO (independe do periodo).
 * - ticketMedio: comprado / nº de pedidos do periodo (null se nenhum).
 */
export function calcularTotaisCompras(
  pedidos: PedidoTotais[],
  de: Date,
  ate: Date,
): TotaisCompras {
  const noPeriodo = pedidos.filter(
    (p) =>
      p.status !== StatusPedidoCompra.CANCELADO &&
      p.dataEmissao >= de &&
      p.dataEmissao <= ate,
  );
  const compradoNoPeriodoCentavos = noPeriodo.reduce(
    (soma, p) => soma + p.totalCentavos,
    0,
  );
  const aReceberCentavos = pedidos
    .filter(
      (p) =>
        p.status === StatusPedidoCompra.CONFIRMADO && p.dataRecebimento == null,
    )
    .reduce((soma, p) => soma + p.totalCentavos, 0);
  const rascunho = pedidos.filter(
    (p) => p.status === StatusPedidoCompra.RASCUNHO,
  ).length;
  const ticketMedioCentavos = noPeriodo.length
    ? Math.round(compradoNoPeriodoCentavos / noPeriodo.length)
    : null;
  return {
    compradoNoPeriodoCentavos,
    aReceberCentavos,
    rascunho,
    ticketMedioCentavos,
    pedidosNoPeriodo: noPeriodo.length,
  };
}
