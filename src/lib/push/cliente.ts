// Helpers de navegador para o aviso de venda (rodam só no cliente).

export type EstadoPush =
  | "nao-suportado"
  | "instalar-primeiro"
  | "negado"
  | "desligado"
  | "pausado"
  | "ativo";

export function urlBase64ParaUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const bruto = atob(b64);
  return Uint8Array.from(bruto, (c) => c.charCodeAt(0));
}

export function calcularEstadoPush(input: {
  suportado: boolean;
  precisaInstalar: boolean;
  permissao: NotificationPermission | "indisponivel";
  inscritoNestaLoja: boolean;
  /** "Vendas novas" deste aparelho nesta loja. Desligado = inscrito, mas sem aviso. */
  recebeVendas?: boolean;
}): EstadoPush {
  if (input.precisaInstalar) return "instalar-primeiro";
  if (!input.suportado) return "nao-suportado";
  if (input.permissao === "denied") return "negado";
  if (input.permissao === "granted" && input.inscritoNestaLoja) {
    // Inscrito com vendas desligadas não pode parecer "Ativo": foi assim que a
    // UDN ficou sem aviso enquanto o card mostrava o selo verde.
    return input.recebeVendas === false ? "pausado" : "ativo";
  }
  return "desligado";
}

export type PerguntaAvisosAoSair = { endpoint: string; loja: string; padraoContinuar: boolean };

export type DecisaoSaida =
  | { acao: "encerrar" }
  | { acao: "perguntar"; pergunta: PerguntaAvisosAoSair };

/**
 * O "Sair" só pergunta sobre os avisos quando quem chamou renderiza o
 * `<DialogAvisosAoSair>` (`perguntarAvisos`). Sem o diálogo, perguntar
 * travaria o botão em "Saindo…"; nesse caso (ex.: "Trocar de conta") sai
 * direto e mantém os avisos, que é o padrão de quem alterna entre lojas.
 * No app instalado o padrão é continuar; numa aba comum, parar (spec §5.3).
 */
export function decidirSaida(input: {
  perguntarAvisos: boolean;
  inscricao: { endpoint: string; loja: string } | null;
  appInstalado: boolean;
}): DecisaoSaida {
  if (!input.perguntarAvisos || !input.inscricao) return { acao: "encerrar" };
  return {
    acao: "perguntar",
    pergunta: { ...input.inscricao, padraoContinuar: input.appInstalado },
  };
}

export function ehAppInstalado(): boolean {
  if (typeof window === "undefined") return false;
  const nav = navigator as Navigator & { standalone?: boolean };
  return window.matchMedia("(display-mode: standalone)").matches || nav.standalone === true;
}

/** Inscrição do navegador, sem travar quando não há service worker. */
export async function obterInscricaoAtual(): Promise<PushSubscription | null> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return null;
  const reg = await navigator.serviceWorker.getRegistration();
  return reg ? reg.pushManager.getSubscription() : null;
}

/** Este aparelho recebe avisos da loja da sessão? (usado ao sair) */
export async function inscricaoDestaLojaNesteAparelho(): Promise<{ endpoint: string; loja: string } | null> {
  try {
    const sub = await obterInscricaoAtual();
    if (!sub) return null;
    const [lista, config] = await Promise.all([
      fetch("/api/push/dispositivos").then((r) => (r.ok ? r.json() : null)),
      fetch("/api/push/config").then((r) => (r.ok ? r.json() : null)),
    ]);
    const inscrito = (lista?.dispositivos ?? []).some(
      (d: { endpoint: string }) => d.endpoint === sub.endpoint,
    );
    return inscrito ? { endpoint: sub.endpoint, loja: config?.loja ?? "sua loja" } : null;
  } catch {
    return null;
  }
}
