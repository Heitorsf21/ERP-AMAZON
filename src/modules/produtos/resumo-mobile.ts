// Contas do detalhe de produto no celular. PURO (sem db): roda também no
// cliente, para a prévia ao vivo do "Alterar custo/preço".

/** Parcelamento Amazon (AmazonForAllFee): 1,5% em vendas a partir de R$ 40. */
export const PARCELAMENTO_BPS = 150;
export const PARCELAMENTO_MINIMO_CENTAVOS = 4000;

export type UnidadeEstimada = {
  precoCentavos: number;
  comissaoCentavos: number;
  fbaCentavos: number;
  parcelamentoCentavos: number;
  impostoCentavos: number;
  custoCentavos: number | null;
  lucroCentavos: number | null;
  margemPercentual: number | null;
};

export type ResumoMobileProduto = {
  produto: {
    id: string;
    sku: string;
    asin: string | null;
    nome: string;
    imagem: string | null;
    ativo: boolean;
  };
  estoque: {
    disponivel: number;
    chegando: number;
    reservado: number;
    vendas30d: number;
    coberturaDias: number | null;
    faixa: string | null;
    rupturaEm: string | null;
  };
  preco: { centavos: number | null; sincronizadoEm: string | null };
  custo: CustoAtualResumo;
  impostoBps: number;
  unidade: UnidadeEstimada | null;
};

/**
 * Custo exibido no detalhe e a vigência que o define.
 * - `vigenteDesde`: início da vigência que cobre hoje; null quando nenhuma
 *   cobre (custo vem de `Produto.custoUnitario`) ou quando vale para todo o
 *   histórico.
 * - `todoHistorico`: vigência com início na época (modo "Todo histórico").
 */
export type CustoAtualResumo = {
  centavos: number | null;
  vigenteDesde: string | null;
  todoHistorico: boolean;
};

export type VigenciaCustoResumo = {
  custoCentavos: number;
  vigenciaInicio: Date;
  vigenciaFim: Date | null;
};

/**
 * Mesma regra de `resolverCustoUnitario` (custo-historico.ts): vale a vigência
 * com maior início ≤ hoje cujo fim é nulo ou > hoje; sem nenhuma, o custo do
 * cadastro. Assim o rótulo nunca descreve uma vigência que não é a do valor.
 */
export function custoAtualDoResumo(
  vigencias: readonly VigenciaCustoResumo[],
  custoCadastroCentavos: number | null,
  hoje: Date,
): CustoAtualResumo {
  const agora = hoje.getTime();
  let atual: VigenciaCustoResumo | null = null;
  for (const v of vigencias) {
    const inicio = v.vigenciaInicio.getTime();
    if (inicio > agora) continue;
    if (v.vigenciaFim && v.vigenciaFim.getTime() <= agora) continue;
    if (!atual || inicio > atual.vigenciaInicio.getTime()) atual = v;
  }
  if (!atual) {
    // Como resolverCustoUnitario: custo de cadastro 0 (ou nulo) = "sem custo".
    const centavos =
      custoCadastroCentavos != null && custoCadastroCentavos > 0 ? custoCadastroCentavos : null;
    return { centavos, vigenteDesde: null, todoHistorico: false };
  }
  // "Todo histórico" grava o início na época (1970-01-01T00:00Z).
  const todoHistorico = atual.vigenciaInicio.getTime() <= 0;
  return {
    centavos: atual.custoCentavos,
    vigenteDesde: todoHistorico ? null : atual.vigenciaInicio.toISOString(),
    todoHistorico,
  };
}

export function calcularUnidadeEstimada(input: {
  precoCentavos: number;
  custoCentavos: number | null;
  comissaoCentavos: number;
  fbaCentavos: number;
  impostoBps: number;
}): UnidadeEstimada {
  const preco = Math.max(0, Math.round(input.precoCentavos));
  const parcelamento =
    preco >= PARCELAMENTO_MINIMO_CENTAVOS
      ? Math.round((preco * PARCELAMENTO_BPS) / 10_000)
      : 0;
  const imposto = Math.round((preco * input.impostoBps) / 10_000);
  const base = {
    precoCentavos: preco,
    comissaoCentavos: input.comissaoCentavos,
    fbaCentavos: input.fbaCentavos,
    parcelamentoCentavos: parcelamento,
    impostoCentavos: imposto,
    custoCentavos: input.custoCentavos,
  };
  if (input.custoCentavos == null || preco === 0) {
    return { ...base, lucroCentavos: null, margemPercentual: null };
  }
  const lucro =
    preco - input.comissaoCentavos - input.fbaCentavos - parcelamento - imposto - input.custoCentavos;
  return { ...base, lucroCentavos: lucro, margemPercentual: Math.round((lucro / preco) * 1000) / 10 };
}

/** Prévia com outro preço: comissão proporcional ao preço, FBA igual. */
export function reprojetarParaPreco(
  base: UnidadeEstimada,
  novoPrecoCentavos: number,
  impostoBps: number,
): UnidadeEstimada {
  const fator = base.precoCentavos > 0 ? novoPrecoCentavos / base.precoCentavos : 0;
  return calcularUnidadeEstimada({
    precoCentavos: novoPrecoCentavos,
    custoCentavos: base.custoCentavos,
    comissaoCentavos: Math.round(base.comissaoCentavos * fator),
    fbaCentavos: base.fbaCentavos,
    impostoBps,
  });
}

/** "47,58" | "R$ 1.234,56" | "47.58" | "77" → centavos; inválido ou ≤ 0 → null. */
export function parseValorBRL(texto: string): number | null {
  const limpo = texto.replace(/R\$|\s/g, "");
  if (!limpo) return null;
  let normalizado: string;
  if (limpo.includes(",")) normalizado = limpo.replace(/\./g, "").replace(",", ".");
  else if (/^\d+\.\d{1,2}$/.test(limpo)) normalizado = limpo;
  else normalizado = limpo.replace(/\./g, "");
  if (!/^\d+(\.\d+)?$/.test(normalizado)) return null;
  const centavos = Math.round(Number(normalizado) * 100);
  return Number.isFinite(centavos) && centavos > 0 ? centavos : null;
}
