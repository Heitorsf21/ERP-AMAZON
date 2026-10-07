import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { currentEmpresaIdOrDefault, getEmpresaId } from "@/lib/tenant-context";
import {
  isPedidoMultiChannelFulfillment,
  PRECO_ORIGEM_REPLACEMENT,
  PRECO_ORIGEM_SPAPI,
} from "@/modules/vendas/filtros";
import { concluirEnvio, entregar, enviarPush, reservarEnvio, TipoPushEnvio } from "./envio";
import { nomeDaLoja } from "./loja";
import {
  agruparPorPedido,
  extrairResumoOrderChange,
  LIMITE_AGRUPAMENTO,
  montarPayloadAgrupado,
  montarPayloadVenda,
  pedidoNotificavel,
  type PayloadPush,
  type VendaCriadaNoSync,
} from "./regras";

const JANELA_PRECO_REAL_DIAS = 7;

function erroComoTexto(err: unknown) {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Linha criada pelo ORDERS_SYNC vira aviso de venda? Não para MCF (`S01-` /
 * canal Non-Amazon: usa estoque FBA mas não é venda do marketplace, e a tela de
 * Vendas nem lista o pedido) nem para reposição (R$ 0, fora do Faturamento).
 */
export function vendaCriadaGeraAviso(input: {
  amazonOrderId: string;
  marketplace?: string | null;
  precoOrigem?: string | null;
}): boolean {
  if (input.precoOrigem === PRECO_ORIGEM_REPLACEMENT) return false;
  return !isPedidoMultiChannelFulfillment({
    amazonOrderId: input.amazonOrderId,
    marketplace: input.marketplace ?? null,
  });
}

/**
 * Valor do pedido para o aviso, antes do ItemPrice chegar: preço real recente
 * do SKU (≤ 7 dias, acompanha ofertas) → cache do listing. SÓ EXIBIÇÃO: nada
 * é gravado em VendaAmazon.
 */
export async function estimarValorItens(
  itens: ReadonlyArray<{ sku: string; quantidade: number }>,
  agora = new Date(),
): Promise<number | null> {
  const skus = [...new Set(itens.map((i) => i.sku).filter(Boolean))];
  if (skus.length === 0) return null;
  const [vendas, produtos] = await Promise.all([
    db.vendaAmazon.findMany({
      where: {
        sku: { in: skus },
        precoOrigem: PRECO_ORIGEM_SPAPI,
        precoUnitarioCentavos: { gt: 0 },
        dataVenda: { gte: new Date(agora.getTime() - JANELA_PRECO_REAL_DIAS * 86_400_000) },
      },
      orderBy: { dataVenda: "desc" },
      select: { sku: true, precoUnitarioCentavos: true },
    }),
    db.produto.findMany({
      where: { sku: { in: skus } },
      select: { sku: true, amazonPrecoListagemCentavos: true },
    }),
  ]);
  const real = new Map<string, number>();
  for (const v of vendas) {
    if (!real.has(v.sku) && v.precoUnitarioCentavos) real.set(v.sku, v.precoUnitarioCentavos);
  }
  const listing = new Map(produtos.map((p) => [p.sku, p.amazonPrecoListagemCentavos ?? 0]));
  let total = 0;
  for (const item of itens) {
    const preco = real.get(item.sku) ?? listing.get(item.sku) ?? 0;
    if (preco > 0) total += preco * Math.max(1, item.quantidade);
  }
  return total > 0 ? total : null;
}

/** Gatilho primário: consumidor SQS, assim que o ORDER_CHANGE chega (~13 s após a compra). */
export async function notificarVendaDeOrderChange(
  payload: Record<string, unknown> | null | undefined,
  agora = new Date(),
): Promise<void> {
  try {
    const resumo = extrairResumoOrderChange(payload ?? null);
    if (!resumo || !pedidoNotificavel(resumo, agora)) return;
    // O ORDER_CHANGE não traz canal nem associação de reposição: só o prefixo
    // S01- identifica MCF aqui. Reposição é filtrada no ORDERS_SYNC.
    if (isPedidoMultiChannelFulfillment({ amazonOrderId: resumo.amazonOrderId })) return;
    const empresaId = getEmpresaId() ?? currentEmpresaIdOrDefault();
    const [valorCentavos, loja] = await Promise.all([
      estimarValorItens(resumo.itens, agora),
      nomeDaLoja(empresaId),
    ]);
    await enviarPush({
      empresaId,
      tipo: TipoPushEnvio.VENDA_NOVA,
      dedupeKey: `venda:${resumo.amazonOrderId}`,
      payload: montarPayloadVenda({
        loja,
        valorCentavos,
        estimado: true,
        amazonOrderId: resumo.amazonOrderId,
        empresaId,
      }),
    });
  } catch (err) {
    logger.warn({ err: erroComoTexto(err) }, "push: falha ao avisar venda (SQS)");
  }
}

/** Gatilho de reserva: vendas CRIADAS pelo ORDERS_SYNC (empresas sem SQS, mensagem perdida). */
export async function notificarVendasCriadasNoSync(
  vendas: readonly VendaCriadaNoSync[],
  agora = new Date(),
): Promise<void> {
  try {
    if (vendas.length === 0) return;
    const pedidos = agruparPorPedido(vendas).filter(
      (p) =>
        pedidoNotificavel(p, agora) &&
        !isPedidoMultiChannelFulfillment({ amazonOrderId: p.amazonOrderId }),
    );
    if (pedidos.length === 0) return;
    const empresaId = getEmpresaId() ?? currentEmpresaIdOrDefault();
    const loja = await nomeDaLoja(empresaId);

    const reservados: Array<{
      envioId: string;
      payload: PayloadPush;
      valor: number | null;
      estimado: boolean;
    }> = [];
    for (const p of pedidos) {
      const payload = montarPayloadVenda({
        loja,
        valorCentavos: p.valorCentavos,
        estimado: p.estimado,
        amazonOrderId: p.amazonOrderId,
        empresaId,
      });
      const envioId = await reservarEnvio({
        empresaId,
        tipo: TipoPushEnvio.VENDA_NOVA,
        dedupeKey: `venda:${p.amazonOrderId}`,
        payload,
      });
      if (envioId) reservados.push({ envioId, payload, valor: p.valorCentavos, estimado: p.estimado });
    }
    if (reservados.length === 0) return;

    if (reservados.length > LIMITE_AGRUPAMENTO) {
      const total = reservados.reduce((s, r) => s + (r.valor ?? 0), 0);
      const r = await entregar({
        empresaId,
        payload: montarPayloadAgrupado({
          loja,
          quantidade: reservados.length,
          totalCentavos: total > 0 ? total : null,
          estimado: reservados.some((x) => x.estimado),
          empresaId,
        }),
      });
      for (const x of reservados) await concluirEnvio(x.envioId, r);
      return;
    }

    for (const x of reservados) {
      const r = await entregar({ empresaId, payload: x.payload });
      await concluirEnvio(x.envioId, r);
    }
  } catch (err) {
    logger.warn({ err: erroComoTexto(err) }, "push: falha ao avisar vendas (ORDERS_SYNC)");
  }
}
