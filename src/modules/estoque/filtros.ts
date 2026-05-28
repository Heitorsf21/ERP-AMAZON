import type { StatusReposicao } from "@/modules/shared/domain";

export const EstoqueFiltroOperacional = {
  COM_ESTOQUE: "COM_ESTOQUE",
  SEM_ESTOQUE: "SEM_ESTOQUE",
} as const;

export const estoqueFiltroOperacionalValues = [
  EstoqueFiltroOperacional.COM_ESTOQUE,
  EstoqueFiltroOperacional.SEM_ESTOQUE,
] as const;

export type EstoqueFiltroOperacional =
  (typeof EstoqueFiltroOperacional)[keyof typeof EstoqueFiltroOperacional];

export type ProdutoFiltrosQuery = {
  busca?: string;
  ativo?: boolean;
  estoque?: EstoqueFiltroOperacional;
  semCusto?: boolean;
  semSyncAmazon?: boolean;
  incluirNaoMfs?: boolean;
  temCusto?: boolean;
  statusReposicao?: StatusReposicao;
};

export const DEFAULT_PRODUTO_FILTROS: ProdutoFiltrosQuery = {
  ativo: true,
  estoque: EstoqueFiltroOperacional.COM_ESTOQUE,
};

export function produtoFiltrosToSearchParams(
  filtros: ProdutoFiltrosQuery = DEFAULT_PRODUTO_FILTROS,
) {
  const params = new URLSearchParams();
  const busca = filtros.busca?.trim();

  if (busca) params.set("busca", busca);
  if (filtros.ativo !== undefined) params.set("ativo", String(filtros.ativo));
  if (filtros.estoque) params.set("estoque", filtros.estoque);
  if (filtros.semCusto) params.set("semCusto", "true");
  if (filtros.semSyncAmazon) params.set("semSyncAmazon", "true");
  if (filtros.incluirNaoMfs) params.set("incluirNaoMfs", "true");
  if (filtros.temCusto !== undefined) params.set("temCusto", String(filtros.temCusto));
  if (filtros.statusReposicao) params.set("statusReposicao", filtros.statusReposicao);

  return params;
}
