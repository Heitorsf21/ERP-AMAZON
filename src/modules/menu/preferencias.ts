// Regras puras do menu personalizável por usuário (Atlas mobile, Fase 1).
// Sem React/ícones: recebe e devolve hrefs, para valer igual no servidor
// (validação do PUT) e no cliente (filtro da sidebar, busca e folha "Mais").

/** Abas que nunca saem do menu. Configurações fica para sempre poder reativar o resto. */
export const HREFS_FIXOS: readonly string[] = [
  "/dashboard-ecommerce",
  "/vendas",
  "/produtos",
  "/configuracoes",
];

const FIXOS = new Set<string>(HREFS_FIXOS);

export function chaveMenuUsuario(usuarioId: string): string {
  return `menu_abas_ocultas:u:${usuarioId}`;
}

export function ehFixo(href: string): boolean {
  return FIXOS.has(href);
}

/** Lê o valor salvo (JSON de string[]). Qualquer coisa inválida vira []. */
export function parseOcultas(valor: string | null | undefined): string[] {
  if (!valor) return [];
  try {
    const parsed: unknown = JSON.parse(valor);
    return Array.isArray(parsed)
      ? parsed.filter((h): h is string => typeof h === "string")
      : [];
  } catch {
    return [];
  }
}

/**
 * Normaliza as abas ocultas: só hrefs conhecidos, nunca as fixas, sem repetição
 * e na ordem do menu (estável para comparar e salvar).
 */
export function sanitizarOcultas(
  ocultas: readonly string[],
  hrefsConhecidos: readonly string[],
): string[] {
  const pedidas = new Set(ocultas);
  return hrefsConhecidos.filter((href) => pedidas.has(href) && !FIXOS.has(href));
}

/** O que o atalho "Usar sugestão" esconde: tudo que não é fixo. */
export function ocultasDaSugestao(hrefsConhecidos: readonly string[]): string[] {
  return hrefsConhecidos.filter((href) => !FIXOS.has(href));
}

/** Remove itens ocultos dos grupos (fixos nunca saem) e descarta grupos vazios. */
export function filtrarGruposVisiveis<
  I extends { href: string },
  G extends { items: readonly I[] },
>(grupos: readonly G[], ocultas: readonly string[]): Array<G & { items: I[] }> {
  const set = new Set(ocultas);
  return grupos
    .map((g) => ({
      ...g,
      items: g.items.filter((i) => !set.has(i.href) || FIXOS.has(i.href)),
    }))
    .filter((g) => g.items.length > 0);
}

export function contarVisiveis(
  hrefsConhecidos: readonly string[],
  ocultas: readonly string[],
): number {
  const set = new Set(sanitizarOcultas(ocultas, hrefsConhecidos));
  return hrefsConhecidos.filter((h) => !set.has(h)).length;
}
