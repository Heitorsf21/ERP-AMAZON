"use client";

import * as React from "react";
import { CANAL_SESSAO, deveRecarregarPorMensagem, ID_DESTA_ABA } from "./sessao-canal";

/**
 * Quando outra aba troca de loja, o cookie desta aba já é da nova loja: a tela
 * recarrega para não misturar o cabeçalho de uma loja com o cache da outra.
 */
export function SessaoSync() {
  React.useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;
    const canal = new BroadcastChannel(CANAL_SESSAO);
    canal.onmessage = (evento: MessageEvent<unknown>) => {
      if (deveRecarregarPorMensagem(evento.data, ID_DESTA_ABA)) window.location.reload();
    };
    return () => canal.close();
  }, []);
  return null;
}
