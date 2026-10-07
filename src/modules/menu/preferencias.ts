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

const METODOS_LEITURA_PAGINA = new Set(["GET", "HEAD"]);

/** Rotas de push que só tocam os aparelhos do próprio `session.uid`. */
const ROTAS_PUSH_PESSOAIS: Record<string, ReadonlySet<string>> = {
  "/api/push/config": new Set(["GET"]),
  "/api/push/dispositivos": new Set(["GET", "POST", "PATCH", "DELETE"]),
  "/api/push/teste": new Set(["POST"]),
};

/**
 * Lojas da própria conta (duas lojas juntas): o vínculo prova a posse da outra
 * conta por senha/2FA e a troca só reemite o cookie — não é dado de negócio.
 */
const ROTAS_LOJAS_PESSOAIS: Record<string, ReadonlySet<string>> = {
  "/api/lojas": new Set(["GET"]),
  "/api/lojas/vincular": new Set(["POST"]),
  "/api/lojas/vincular/2fa": new Set(["POST"]),
  "/api/auth/trocar-loja": new Set(["POST"]),
};
const ROTA_DESVINCULAR = /^\/api\/lojas\/vinculos\/[^/]+$/;

/**
 * Rotas que QUALQUER usuário logado acessa, seja qual for o papel (inclusive
 * LEITURA), porque são preferência pessoal e não dado de negócio
 * (spec §3.1: "cada pessoa da empresa tem o seu menu"). Feito para o
 * `canAccessPath` do proxy consultar antes das regras por papel:
 * - `/api/menu/preferencias` (GET/PUT): a rota só lê/grava a chave do próprio
 *   `session.uid`;
 * - a página `/configuracoes` (só GET/HEAD, caminho exato), onde vivem as abas
 *   Menu e Neste celular; o cliente esconde as abas de admin e
 *   `/api/configuracoes/*` continua restrita a ADMIN;
 * - as rotas de push do próprio aparelho (ativar/desativar avisos, teste);
 * - as lojas da própria conta (listar, vincular, desvincular, trocar).
 */
export function liberadoParaQualquerPapel(pathname: string, method: string): boolean {
  if (pathname === "/api/menu/preferencias") return method === "GET" || method === "PUT";
  if (pathname === "/configuracoes") return METODOS_LEITURA_PAGINA.has(method);
  if (ROTA_DESVINCULAR.test(pathname)) return method === "DELETE";
  return (
    ROTAS_PUSH_PESSOAIS[pathname]?.has(method) ??
    ROTAS_LOJAS_PESSOAIS[pathname]?.has(method) ??
    false
  );
}
