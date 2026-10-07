const FORMATO_PEDIDO_AMAZON = /^\d{3}-\d{7}-\d{7}$/;

/** `?pedido=` vindo do aviso no celular: só o formato de pedido Amazon passa. */
export function normalizarPedidoParam(valor: string | null | undefined): string | null {
  const v = (valor ?? "").trim();
  return FORMATO_PEDIDO_AMAZON.test(v) ? v : null;
}

/** Id de empresa no `?loja=` do aviso (cuid/slug). Qualquer outra coisa é ignorada. */
const FORMATO_LOJA = /^[A-Za-z0-9_-]{1,64}$/;

export function normalizarLojaParam(valor: string | null | undefined): string | null {
  const v = (valor ?? "").trim();
  return FORMATO_LOJA.test(v) ? v : null;
}

/**
 * O link do aviso diz de qual loja é o pedido; a sessão diz em qual conta o
 * app está. Só compara as duas — nada é consultado na outra empresa.
 */
export function pedidoEhDeOutraLoja(
  lojaDoLink: string | null,
  empresaDaSessao: string | null | undefined,
): boolean {
  return !!lojaDoLink && !!empresaDaSessao && lojaDoLink !== empresaDaSessao;
}

/** "Trocar de conta": depois de entrar na loja do aviso, o login volta para o pedido. */
export function loginParaAbrirPedido(pedido: string, loja: string): string {
  const destino = `/vendas?pedido=${encodeURIComponent(pedido)}&loja=${encodeURIComponent(loja)}`;
  return `/login?next=${encodeURIComponent(destino)}`;
}

/**
 * O aviso sai do SQS ~15–30 s após a compra; a venda só é gravada pelo
 * ORDERS_SYNC (mediana 137 s, p90 534 s). Por isso, lista vazia logo após o
 * toque é "ainda sincronizando", não "pedido de outra loja".
 */
export const ESPERA_PEDIDO_MS = 10 * 60_000;
export const INTERVALO_CONSULTA_PEDIDO_MS = 15_000;

export type EstadoPedidoDestaque = "encontrado" | "aguardando" | "outra_loja" | "nao_encontrado";

export function estadoPedidoDestaque(input: {
  encontrados: number;
  outraLoja: boolean;
  esperaEsgotada: boolean;
}): EstadoPedidoDestaque {
  if (input.encontrados > 0) return "encontrado";
  if (input.outraLoja) return "outra_loja";
  return input.esperaEsgotada ? "nao_encontrado" : "aguardando";
}

export function intervaloConsultaPedido(estado: EstadoPedidoDestaque): number | false {
  return estado === "aguardando" ? INTERVALO_CONSULTA_PEDIDO_MS : false;
}

/**
 * Aviso de venda de uma loja VINCULADA (duas lojas juntas): em vez de pedir
 * "Trocar de conta" com login, o app troca sozinho para a loja do pedido —
 * uma vez só (se a troca falhar, sobra o botão).
 */
export function deveTrocarParaLojaDoPedido(input: {
  estado: EstadoPedidoDestaque;
  lojaDoLink: string | null;
  lojasVinculadas: readonly string[];
  jaTentou: boolean;
}): boolean {
  return (
    input.estado === "outra_loja" &&
    !!input.lojaDoLink &&
    input.lojasVinculadas.includes(input.lojaDoLink) &&
    !input.jaTentou
  );
}
