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
  custo: { centavos: number | null; vigenteDesde: string | null };
  impostoBps: number;
  unidade: UnidadeEstimada | null;
};

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
