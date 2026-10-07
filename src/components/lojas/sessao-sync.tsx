"use client";

import * as React from "react";
import { CANAL_SESSAO, type MensagemSessao } from "./use-lojas";

/**
 * Quando outra aba troca de loja, o cookie desta aba já é da nova loja: a tela
 * recarrega para não misturar o cabeçalho de uma loja com o cache da outra.
 */
export function SessaoSync() {
  React.useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;
    const canal = new BroadcastChannel(CANAL_SESSAO);
    canal.onmessage = (evento: MessageEvent<MensagemSessao>) => {
      if (evento.data?.tipo === "loja-trocada") window.location.reload();
    };
    return () => canal.close();
  }, []);
  return null;
}
