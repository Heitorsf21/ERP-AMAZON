import { describe, expect, it } from "vitest";
import {
  formatarItem,
  formatarMensagemResumoEstoque,
  montarPartesMensagem,
} from "./message";
import { montarResumoDeDados } from "./service";

// 2026-01-15 13:00 UTC = 10:00 America/Sao_Paulo (UTC-3)
const GERADO_EM = new Date("2026-01-15T13:00:00.000Z");

function resumoComItens(n: number) {
  const produtos = Array.from({ length: n }, (_, i) => ({
    id: `id-${i}`,
    sku: `SKU-${String(i).padStart(3, "0")}`,
    nome: `Produto numero ${i} com nome razoavelmente longo`,
    estoqueAtual: 10 + i,
  }));
  const vendasPorSku = new Map(produtos.map((p) => [p.sku, 30]));
  return montarResumoDeDados({
    produtos,
    vendasPorSku,
    excluidosIds: new Set(),
    geradoEm: GERADO_EM,
  });
}

describe("formatarItem", () => {
  it("usa o formato aprovado", () => {
    const resumo = resumoComItens(1);
    expect(formatarItem(resumo.itens[0]!)).toBe(
      "SKU-000 - Produto numero 0 com nome razoavelmente longo | Estoque: 10 | Vendeu 30d: 30 | Cobertura: 10d",
    );
  });
});

describe("formatarMensagemResumoEstoque", () => {
  it("inclui cabecalho com data/hora local e todas as faixas", () => {
    const msg = formatarMensagemResumoEstoque(resumoComItens(2));
    expect(msg).toContain("Resumo de estoque - 15/01/2026 10:00");
    expect(msg).toContain("Critico");
    expect(msg).toContain("Atencao");
    expect(msg).toContain("Estavel");
    expect(msg).toContain("Seguro");
  });

  it("mostra mensagem dedicada quando nao ha produtos elegiveis", () => {
    const resumo = montarResumoDeDados({
      produtos: [],
      vendasPorSku: new Map(),
      excluidosIds: new Set(),
      geradoEm: GERADO_EM,
    });
    const msg = formatarMensagemResumoEstoque(resumo);
    expect(msg).toContain("Nenhum produto elegivel");
  });
});

describe("montarPartesMensagem", () => {
  it("retorna uma unica parte quando cabe no limite", () => {
    const partes = montarPartesMensagem(resumoComItens(2));
    expect(partes).toHaveLength(1);
    expect(partes[0]).not.toContain("Parte 1/");
  });

  it("quebra em partes numeradas preservando todos os itens", () => {
    const resumo = resumoComItens(40);
    const partes = montarPartesMensagem(resumo, 400);
    expect(partes.length).toBeGreaterThan(1);
    partes.forEach((p, i) => {
      expect(p.startsWith(`Parte ${i + 1}/${partes.length}`)).toBe(true);
    });
    const tudo = partes.join("\n");
    for (const item of resumo.itens) {
      expect(tudo).toContain(item.sku);
    }
  });
});
