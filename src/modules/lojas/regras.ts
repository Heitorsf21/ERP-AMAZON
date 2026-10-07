// Regras puras das lojas da conta (duas lojas juntas). Sem I/O: o serviço
// (vinculos.ts) carrega as contas e decide com estas funções.

/**
 * Uma conta do chaveiro do aparelho continua valendo enquanto ela e a loja
 * estiverem ativas e ninguém tiver trocado a senha ou encerrado as sessões
 * dela (sessionVersion igual ao do momento do vínculo). Fail-closed.
 */
export function contaValidaNoChaveiro(
  conta: { ativo: boolean; sessionVersion: number; empresaAtiva: boolean },
  versaoNoChaveiro: number | undefined,
): boolean {
  return conta.ativo && conta.empresaAtiva && versaoNoChaveiro === conta.sessionVersion;
}

/**
 * Ordem fixa das lojas (por nome, pt-BR). Não depende de qual loja está
 * aberta — por isso a cor de cada loja não muda ao trocar.
 */
export function ordenarLojas<T extends { nome: string }>(lojas: readonly T[]): T[] {
  return [...lojas].sort((x, y) =>
    x.nome.localeCompare(y.nome, "pt-BR", { sensitivity: "base" }),
  );
}

export type CorLoja = { ponto: string; selo: string; barra: string };

// Classes literais (o Tailwind só gera o que aparece escrito no código).
export const CORES_LOJA: readonly CorLoja[] = [
  {
    ponto: "bg-blue-500",
    barra: "bg-blue-500",
    selo: "bg-blue-100 text-blue-700 dark:bg-blue-900/55 dark:text-blue-300",
  },
  {
    ponto: "bg-violet-500",
    barra: "bg-violet-500",
    selo: "bg-violet-100 text-violet-700 dark:bg-violet-900/55 dark:text-violet-300",
  },
  {
    ponto: "bg-amber-500",
    barra: "bg-amber-500",
    selo: "bg-amber-100 text-amber-800 dark:bg-amber-900/55 dark:text-amber-300",
  },
  {
    ponto: "bg-teal-500",
    barra: "bg-teal-500",
    selo: "bg-teal-100 text-teal-800 dark:bg-teal-900/55 dark:text-teal-300",
  },
];

/** Cor da loja pela posição dela em `ordenarLojas` (cicla com muitas lojas). */
export function corDaLoja(indice: number): CorLoja {
  const n = CORES_LOJA.length;
  return CORES_LOJA[((indice % n) + n) % n]!;
}

type LojaBase = { empresaId: string; nome: string; email: string; papel: string };

export type LojaComCor = LojaBase & {
  /** É a loja aberta nesta sessão. */
  atual: boolean;
  /** Conta desta loja no chaveiro do aparelho (null na própria loja aberta). */
  vinculoId: string | null;
  cor: CorLoja;
};

/** Lista única das lojas da conta, na ordem fixa por nome, com a cor de cada uma. */
export function lojasComCor(
  atual: LojaBase,
  vinculadas: readonly (LojaBase & { vinculoId: string })[],
): LojaComCor[] {
  const todas = [
    { ...atual, atual: true, vinculoId: null },
    ...vinculadas.map((l) => ({
      empresaId: l.empresaId,
      nome: l.nome,
      email: l.email,
      papel: l.papel,
      atual: false,
      vinculoId: l.vinculoId,
    })),
  ];
  return ordenarLojas(todas).map((l, i) => ({ ...l, cor: corDaLoja(i) }));
}

/** Iniciais do selo da loja: "MundoFS" → "MF", "UDN" → "UD", "Loja da Ana" → "LD". */
export function iniciaisLoja(nome: string): string {
  const limpo = nome.trim();
  if (!limpo) return "?";
  const palavras = limpo.split(/\s+/);
  if (palavras.length >= 2) {
    return ((palavras[0]?.[0] ?? "") + (palavras[1]?.[0] ?? "")).toUpperCase();
  }
  const segundaMaiuscula = [...limpo.slice(1)].find((c) => c !== c.toLowerCase());
  return (limpo[0]! + (segundaMaiuscula ?? limpo[1] ?? "")).toUpperCase();
}

/**
 * Para onde ir depois de trocar de loja: a mesma seção (Vendas continua em
 * Vendas), mas sem o item aberto — um produto ou pedido é da loja anterior.
 */
export function destinoAoTrocar(pathname: string): string {
  const secao = pathname.split("/").filter(Boolean)[0];
  return secao ? `/${secao}` : "/dashboard-ecommerce";
}
