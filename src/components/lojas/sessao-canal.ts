// Aviso entre abas quando a loja é trocada. Outras abas abertas da loja antiga
// recarregam (evita cabeçalho de uma loja com o cache da outra). A aba que
// trocou NÃO recarrega: o BroadcastChannel entrega a mensagem também aos
// outros canais da mesma aba, e um reload ali disputaria com a navegação para
// o destino da troca.

export const CANAL_SESSAO = "atlas-sessao";

export type MensagemSessao = { tipo: "loja-trocada"; empresaId: string; origem: string };

function gerarId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
}

/** Identifica esta aba (um por carregamento de página). */
export const ID_DESTA_ABA = gerarId();

export function deveRecarregarPorMensagem(mensagem: unknown, idDestaAba: string): boolean {
  if (!mensagem || typeof mensagem !== "object") return false;
  const m = mensagem as Partial<MensagemSessao>;
  return m.tipo === "loja-trocada" && m.origem !== idDestaAba;
}

export function avisarOutrasAbas(empresaId: string): void {
  try {
    const canal = new BroadcastChannel(CANAL_SESSAO);
    canal.postMessage({ tipo: "loja-trocada", empresaId, origem: ID_DESTA_ABA } satisfies MensagemSessao);
    canal.close();
  } catch {
    // Navegador sem BroadcastChannel: as outras abas se acertam ao recarregar.
  }
}
