import { formatBRL } from "@/lib/money";

// Regras puras do aviso de venda no celular. O aviso pode aparecer na tela
// bloqueada: NUNCA leva nome de produto, SKU ou quantidade — só loja e valor.

/** Pedido mais velho que isso não avisa (primeira conexão, worker voltando de queda). */
export const JANELA_RECENCIA_MS = 2 * 60 * 60 * 1000;
/** Relógio da Amazon pode vir alguns minutos à frente do nosso. */
export const TOLERANCIA_RELOGIO_MS = 10 * 60 * 1000;
/** Acima disso, numa mesma execução do ORDERS_SYNC, sai um aviso agrupado. */
export const LIMITE_AGRUPAMENTO = 3;

export const ICONE_PUSH = "/icons/icon-192.png";
export const BADGE_PUSH = "/icons/badge-96.png";

export type PayloadPush = {
  title: string;
  body: string;
  tag: string;
  url: string;
  icon: string;
  badge: string;
};

export type ResumoPedido = {
  amazonOrderId: string;
  purchaseDate: Date | null;
  status: string | null;
  itens: Array<{ sku: string; quantidade: number }>;
};

export type VendaCriadaNoSync = {
  amazonOrderId: string;
  purchaseDate: Date;
  status: string;
  valorBrutoCentavos: number;
  estimado: boolean;
};

export type PedidoAgrupado = {
  amazonOrderId: string;
  purchaseDate: Date;
  status: string;
  valorCentavos: number | null;
  estimado: boolean;
};

export function pedidoNotificavel(
  p: { purchaseDate: Date | null; status: string | null },
  agora: Date,
): boolean {
  if (!p.purchaseDate || Number.isNaN(p.purchaseDate.getTime())) return false;
  const status = (p.status ?? "").toLowerCase();
  if (status === "canceled" || status === "cancelled") return false;
  const idade = agora.getTime() - p.purchaseDate.getTime();
  return idade <= JANELA_RECENCIA_MS && idade >= -TOLERANCIA_RELOGIO_MS;
}

export function formatarValorPush(centavos: number | null, estimado: boolean): string | null {
  if (centavos == null || centavos <= 0) return null;
  return `${estimado ? "~" : ""}${formatBRL(centavos)}`;
}

export function montarPayloadVenda(input: {
  loja: string;
  valorCentavos: number | null;
  estimado: boolean;
  amazonOrderId: string;
  empresaId: string;
}): PayloadPush {
  const valor = formatarValorPush(input.valorCentavos, input.estimado);
  return {
    title: `Nova venda na ${input.loja}`,
    body: valor ? `Você teve uma nova venda de ${valor}.` : "Você teve uma nova venda.",
    tag: `venda-${input.empresaId}-${input.amazonOrderId}`,
    url: `/vendas?pedido=${encodeURIComponent(input.amazonOrderId)}`,
    icon: ICONE_PUSH,
    badge: BADGE_PUSH,
  };
}

export function montarPayloadAgrupado(input: {
  loja: string;
  quantidade: number;
  totalCentavos: number | null;
  estimado: boolean;
  empresaId: string;
}): PayloadPush {
  const total = formatarValorPush(input.totalCentavos, input.estimado);
  return {
    title: `${input.quantidade} novas vendas na ${input.loja}`,
    body: total ? `Total de ${total}.` : "Abra o Atlas para ver os pedidos.",
    tag: `vendas-${input.empresaId}`,
    url: "/vendas",
    icon: ICONE_PUSH,
    badge: BADGE_PUSH,
  };
}

export function montarPayloadTeste(loja: string): PayloadPush {
  return {
    title: "Teste do Atlas",
    body: `Os avisos de venda da ${loja} vão chegar assim.`,
    tag: "teste-atlas",
    url: "/configuracoes?tab=notificacoes",
    icon: ICONE_PUSH,
    badge: BADGE_PUSH,
  };
}

function texto(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

function registro(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

/** Lê o payload de ORDER_CHANGE (Notifications API v1, payloadVersion 1.0). */
export function extrairResumoOrderChange(
  payload: Record<string, unknown> | null,
): ResumoPedido | null {
  const raiz = registro(payload);
  if (!raiz) return null;
  const notif = "OrderChangeNotification" in raiz ? registro(raiz.OrderChangeNotification) : raiz;
  if (!notif) return null;
  const amazonOrderId = texto(notif.AmazonOrderId);
  if (!amazonOrderId) return null;
  const summary = registro(notif.Summary) ?? {};
  const dataTexto = texto(summary.PurchaseDate);
  const data = dataTexto ? new Date(dataTexto) : null;
  const itensBrutos = Array.isArray(summary.OrderItems) ? summary.OrderItems : [];
  const itens = itensBrutos
    .map(registro)
    .filter((i): i is Record<string, unknown> => i !== null)
    .map((i) => ({
      sku: texto(i.SellerSKU) ?? "",
      quantidade: typeof i.Quantity === "number" && i.Quantity > 0 ? i.Quantity : 1,
    }))
    .filter((i) => i.sku);
  return {
    amazonOrderId,
    purchaseDate: data && !Number.isNaN(data.getTime()) ? data : null,
    status: texto(summary.OrderStatus),
    itens,
  };
}

/** ORDERS_SYNC grava uma linha por SKU; o aviso é por pedido. */
export function agruparPorPedido(vendas: readonly VendaCriadaNoSync[]): PedidoAgrupado[] {
  const mapa = new Map<string, PedidoAgrupado>();
  for (const v of vendas) {
    const valor = v.valorBrutoCentavos > 0 ? v.valorBrutoCentavos : 0;
    const atual = mapa.get(v.amazonOrderId);
    if (!atual) {
      mapa.set(v.amazonOrderId, {
        amazonOrderId: v.amazonOrderId,
        purchaseDate: v.purchaseDate,
        status: v.status,
        valorCentavos: valor > 0 ? valor : null,
        estimado: v.estimado,
      });
      continue;
    }
    atual.valorCentavos = (atual.valorCentavos ?? 0) + valor || null;
    atual.estimado = atual.estimado || v.estimado;
    if (v.purchaseDate < atual.purchaseDate) atual.purchaseDate = v.purchaseDate;
  }
  return [...mapa.values()];
}
