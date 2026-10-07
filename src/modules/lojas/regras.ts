// Regras puras do vínculo entre lojas (duas lojas juntas). Sem I/O: o serviço
// (vinculos.ts) carrega as contas e decide com estas funções.

/** O que importa de cada conta para o vínculo continuar valendo. */
export type ContaVinculo = {
  id: string;
  ativo: boolean;
  sessionVersion: number;
  empresaId: string;
  empresaAtiva: boolean;
};

/** Par não-ordenado guardado sempre na mesma ordem: A↔B tem uma linha só. */
export function ordenarPar(
  x: string,
  y: string,
): { usuarioAId: string; usuarioBId: string } {
  return x < y ? { usuarioAId: x, usuarioBId: y } : { usuarioAId: y, usuarioBId: x };
}

/**
 * O vínculo vale enquanto as duas contas e empresas estiverem ativas, forem de
 * lojas diferentes e ninguém tiver trocado a senha ou encerrado as sessões
 * (sessionVersion igual ao do momento do vínculo). Fail-closed.
 */
export function vinculoValido(
  vinculo: { versaoA: number; versaoB: number },
  a: ContaVinculo,
  b: ContaVinculo,
): boolean {
  return (
    a.ativo &&
    b.ativo &&
    a.empresaAtiva &&
    b.empresaAtiva &&
    a.empresaId !== b.empresaId &&
    vinculo.versaoA === a.sessionVersion &&
    vinculo.versaoB === b.sessionVersion
  );
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
