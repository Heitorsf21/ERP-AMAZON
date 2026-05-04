import { valorBrutoDaVenda } from "@/modules/vendas/valores";

export type VendaResumoReembolsoInput = {
  amazonOrderId: string;
  sku: string;
  titulo: string | null;
  quantidade: number;
  precoUnitarioCentavos: number;
  valorBrutoCentavos: number | null;
};

export type ReembolsoResumoInput = {
  amazonOrderId: string;
  sku: string;
  titulo: string | null;
  quantidade: number;
  valorReembolsadoCentavos: number;
};

export type ProdutoResumoReembolso = {
  sku: string;
  nome: string;
  pedidosVendidos: number;
  pedidosReembolsados: number;
  taxaReembolso: number;
  unidadesVendidas: number;
  unidadesReembolsadas: number;
  valorVendidoCentavos: number;
  valorReembolsadoCentavos: number;
};

export function calcularResumoReembolsos(
  vendas: VendaResumoReembolsoInput[],
  reembolsos: ReembolsoResumoInput[],
): ProdutoResumoReembolso[] {
  const grupos = new Map<
    string,
    {
      sku: string;
      nome: string;
      pedidosVendidos: Set<string>;
      pedidosReembolsados: Set<string>;
      unidadesVendidas: number;
      unidadesReembolsadas: number;
      valorVendidoCentavos: number;
      valorReembolsadoCentavos: number;
    }
  >();

  for (const venda of vendas) {
    const grupo = ensureGrupo(grupos, venda.sku, venda.titulo);
    grupo.pedidosVendidos.add(venda.amazonOrderId);
    grupo.unidadesVendidas += venda.quantidade;
    grupo.valorVendidoCentavos += valorBrutoDaVenda(venda);
  }

  for (const reembolso of reembolsos) {
    const grupo = ensureGrupo(grupos, reembolso.sku, reembolso.titulo);
    grupo.pedidosReembolsados.add(reembolso.amazonOrderId);
    grupo.unidadesReembolsadas += reembolso.quantidade;
    grupo.valorReembolsadoCentavos += reembolso.valorReembolsadoCentavos;
  }

  return [...grupos.values()]
    .filter(
      (grupo) =>
        grupo.pedidosVendidos.size > 0 || grupo.pedidosReembolsados.size > 0,
    )
    .map((grupo) => ({
      sku: grupo.sku,
      nome: grupo.nome,
      pedidosVendidos: grupo.pedidosVendidos.size,
      pedidosReembolsados: grupo.pedidosReembolsados.size,
      taxaReembolso:
        grupo.pedidosVendidos.size > 0
          ? (grupo.pedidosReembolsados.size / grupo.pedidosVendidos.size) * 100
          : 0,
      unidadesVendidas: grupo.unidadesVendidas,
      unidadesReembolsadas: grupo.unidadesReembolsadas,
      valorVendidoCentavos: grupo.valorVendidoCentavos,
      valorReembolsadoCentavos: grupo.valorReembolsadoCentavos,
    }))
    .sort((a, b) => b.taxaReembolso - a.taxaReembolso);
}

function ensureGrupo(
  grupos: Map<
    string,
    {
      sku: string;
      nome: string;
      pedidosVendidos: Set<string>;
      pedidosReembolsados: Set<string>;
      unidadesVendidas: number;
      unidadesReembolsadas: number;
      valorVendidoCentavos: number;
      valorReembolsadoCentavos: number;
    }
  >,
  sku: string,
  titulo?: string | null,
) {
  const chave = sku || "(sem sku)";
  const existente = grupos.get(chave);
  if (existente) {
    if (!existente.nome || existente.nome === chave) {
      existente.nome = titulo || chave;
    }
    return existente;
  }

  const grupo = {
    sku: chave,
    nome: titulo || chave,
    pedidosVendidos: new Set<string>(),
    pedidosReembolsados: new Set<string>(),
    unidadesVendidas: 0,
    unidadesReembolsadas: 0,
    valorVendidoCentavos: 0,
    valorReembolsadoCentavos: 0,
  };
  grupos.set(chave, grupo);
  return grupo;
}
