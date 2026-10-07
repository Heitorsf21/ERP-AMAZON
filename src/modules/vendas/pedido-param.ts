const FORMATO_PEDIDO_AMAZON = /^\d{3}-\d{7}-\d{7}$/;

/** `?pedido=` vindo do aviso no celular: só o formato de pedido Amazon passa. */
export function normalizarPedidoParam(valor: string | null | undefined): string | null {
  const v = (valor ?? "").trim();
  return FORMATO_PEDIDO_AMAZON.test(v) ? v : null;
}
