import { describe, expect, it } from "vitest";
import {
  agregarDreCompetencia,
  type ExtrasDreCompetencia,
  type LinhaDreVenda,
} from "./service";

const SEM_EXTRAS: ExtrasDreCompetencia = {
  reembolsos: 0,
  taxasReembolsadas: 0,
  ads: 0,
  adsFonte: "VAZIO",
  despesasOperacionais: [],
  outrasReceitasManuais: 0,
  outrasDespesasManuais: 0,
  pedidosUnicos: 0,
};

function linha(over: Partial<LinhaDreVenda> = {}): LinhaDreVenda {
  return {
    bruto: 10000,
    taxas: 1500,
    taxasEstimada: false,
    frete: 0,
    imposto: 600,
    custo: 4000,
    quantidade: 1,
    ...over,
  };
}

describe("agregarDreCompetencia", () => {
  it("monta a cascata até o lucro líquido com uma venda simples", () => {
    const r = agregarDreCompetencia([linha()], SEM_EXTRAS);

    expect(r.receitaBrutaVendas).toBe(10000);
    expect(r.receitaLiquidaVendas).toBe(10000); // sem reembolso
    // receita operacional líquida = 10000 - 1500 taxas - 0 frete - 600 imposto
    expect(r.receitaOperacionalLiquida).toBe(7900);
    expect(r.cmv).toBe(4000);
    expect(r.lucroBruto).toBe(3900);
    expect(r.lucroOperacional).toBe(3900); // sem ads/despesas
    expect(r.lucroLiquido).toBe(3900);
    expect(r.custoIncompleto).toBe(false);
    expect(r.origemTaxas).toBe("real");
    expect(r.unidades).toBe(1);
  });

  it("credita taxasReembolsadas nas Taxas Amazon e usa pedidosUnicos como contagem", () => {
    const r = agregarDreCompetencia([linha({ taxas: 1500 }), linha({ taxas: 1500 })], {
      ...SEM_EXTRAS,
      taxasReembolsadas: 1000,
      pedidosUnicos: 1, // 2 linhas (multi-SKU), 1 pedido
    });
    expect(r.taxasAmazon).toBe(2000); // 3000 − 1000 creditado
    expect(r.quantidadeVendas).toBe(1);
    // bruto 20000 − reembolsos 0 − taxas 2000 − frete 0 − imposto 1200
    expect(r.receitaOperacionalLiquida).toBe(16800);
  });

  it("nunca deixa as Taxas Amazon líquidas negativas (clamp em 0)", () => {
    const r = agregarDreCompetencia([linha({ taxas: 500 })], {
      ...SEM_EXTRAS,
      taxasReembolsadas: 9999,
      pedidosUnicos: 1,
    });
    expect(r.taxasAmazon).toBe(0);
  });

  it("subtrai reembolsos, ads e despesas operacionais do resultado", () => {
    const r = agregarDreCompetencia([linha(), linha()], {
      ...SEM_EXTRAS,
      reembolsos: 2000,
      ads: 1000,
      despesasOperacionais: [
        { categoria: "Aluguel", valor: 3000 },
        { categoria: "Pró-labore / Lucro", valor: 5000 },
      ],
      outrasReceitasManuais: 500,
      outrasDespesasManuais: 200,
    });

    // 2 vendas: bruto 20000, taxas 3000, imposto 1200, cmv 8000
    expect(r.receitaBrutaVendas).toBe(20000);
    expect(r.reembolsos).toBe(2000);
    expect(r.receitaLiquidaVendas).toBe(18000);
    expect(r.receitaOperacionalLiquida).toBe(18000 - 3000 - 0 - 1200); // 13800
    expect(r.cmv).toBe(8000);
    expect(r.lucroBruto).toBe(13800 - 8000); // 5800
    expect(r.totalDespesasOperacionais).toBe(8000);
    expect(r.lucroOperacional).toBe(5800 - 1000 - 8000); // -3200
    // outras: +500 -200 = +300
    expect(r.lucroLiquido).toBe(-3200 + 300); // -2900
    // o agregador puro preserva a ordem recebida (a ordenação por valor é
    // feita em calcularDreCompetencia, a função de I/O).
    expect(r.despesasOperacionais).toEqual([
      { categoria: "Aluguel", valor: 3000 },
      { categoria: "Pró-labore / Lucro", valor: 5000 },
    ]);
  });

  it("sinaliza custo incompleto e conta vendas sem custo (mas ainda calcula uma base)", () => {
    const r = agregarDreCompetencia(
      [linha({ custo: 4000 }), linha({ custo: null })],
      SEM_EXTRAS,
    );

    expect(r.custoIncompleto).toBe(true);
    expect(r.vendasSemCusto).toBe(1);
    expect(r.cmv).toBe(4000); // só o custo conhecido
    // ainda produz um lucro (base), não null
    expect(typeof r.lucroLiquido).toBe("number");
  });

  it("classifica a origem das taxas (real/estimado/misto/nenhuma)", () => {
    expect(agregarDreCompetencia([], SEM_EXTRAS).origemTaxas).toBe("nenhuma");
    expect(
      agregarDreCompetencia([linha({ taxasEstimada: false })], SEM_EXTRAS)
        .origemTaxas,
    ).toBe("real");
    expect(
      agregarDreCompetencia([linha({ taxasEstimada: true })], SEM_EXTRAS)
        .origemTaxas,
    ).toBe("estimado");
    expect(
      agregarDreCompetencia(
        [linha({ taxasEstimada: false }), linha({ taxasEstimada: true })],
        SEM_EXTRAS,
      ).origemTaxas,
    ).toBe("misto");
  });

  it("zera percentuais quando não há receita (sem divisão por zero)", () => {
    const r = agregarDreCompetencia([], SEM_EXTRAS);
    expect(r.margemBrutaPercentual).toBe(0);
    expect(r.margemLiquidaPercentual).toBe(0);
    expect(r.roi).toBe(0);
    expect(r.lucroLiquido).toBe(0);
  });

  it("expõe chaves compatíveis com a tabela anual", () => {
    const r = agregarDreCompetencia([linha()], SEM_EXTRAS);
    expect(r.totalReceitas).toBe(r.receitaBrutaVendas);
    expect(r.receitaLiquida).toBe(r.receitaOperacionalLiquida);
    expect(r.margemBruta).toBe(r.lucroBruto);
    expect(r.custoMercadorias).toBe(r.cmv);
    expect(r.resultadoFinal).toBe(r.lucroLiquido);
    expect(r.percentualMargemBruta).toBe(r.margemBrutaPercentual);
  });

  it("margem líquida fica negativa quando o resultado é negativo", () => {
    const r = agregarDreCompetencia([linha({ bruto: 10000, taxas: 1500, imposto: 600, custo: 4000 })], {
      ...SEM_EXTRAS,
      ads: 2000,
      despesasOperacionais: [{ categoria: "Aluguel", valor: 5000 }],
    });
    expect(r.lucroLiquido).toBeLessThan(0);
    expect(r.margemLiquidaPercentual).toBeLessThan(0);
  });
});
