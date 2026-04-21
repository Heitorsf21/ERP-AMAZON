import { describe, expect, it } from "vitest";
import {
  parseAmazonCSV,
  resumirImportacao,
  type TransacaoAmazon,
} from "../amazon-parser";

// Cabeçalho mínimo que replica o formato real do Amazon Unified Transaction
const HEADER = [
  '"Inclui transações da Amazon Marketplace, Fulfillment by Amazon (FBA), e Amazon Webstore"',
  '"Todas as quantias em BRL, a menos que especificado"',
  '"Definições:"',
  '"date/hora: data/hora da transação publicada"',
  '"Imposto de vendas coletados: Inclui impostos sobre vendas coletados de compradores para vendas de produtos, envio e embalagem para presente."',
  '"Tarifas de venda: Inclui tarifas de fechamento variável e tarifas de referência."',
  '"Outras taxas de transação: Inclui cobranças retroativas de envio, retenção de envi, taxas por item e taxas de coleta de impostos de vendas."',
  '"Outros: Inclui quantias de transação não relacionadas a pedidos."',
  '"Atenção: relatórios com data de início de 1º de janeiro de 2025..."',
  '"data/hora","id de liquidação","tipo","id do pedido","sku","descrição","quantidade","mercado","tipo de conta","atendimento","cidade do pedido","estado do pedido","postal do pedido","vendas do produto","créditos de remessa","créditos de embalagem de presente","descontos promocionais","imposto de vendas coletados","tarifas de venda","taxas fba","taxas de outras transações","outro","total","Status da transação","Data de liberação da transação"',
].join("\n");

function buildCSV(...linhas: string[]): string {
  return HEADER + "\n" + linhas.join("\n");
}

// Linha de pedido liberado
const PEDIDO_LIBERADO =
  '"1 de mar. de 2026 00:15:19 GMT-8","25926492791","Pedido","701-412","MFS-0017","Almofada Cóccix","1","amazon.com.br","Crédito Mastercard","Amazon","Iguatu","CE","63500","75,97","3,19","0","-3,19","0","-9,12","-5,00","0","0","61,85","Liberado","16 de mar. de 2026 06:14:14 GMT-7"';

// Linha de pedido diferido (sem data de liberação)
const PEDIDO_DIFERIDO =
  '"10 de abr. de 2026 14:00:00 GMT-8","99999999999","Pedido","702-999","MFS-0017","Almofada Cóccix","1","amazon.com.br","Visa Crédito","Amazon","SP","SP","01000","75,97","0","0","0","0","-9,12","-5,00","0","0","61,85","Diferido",""';

// Linha de transferência
const TRANSFERENCIA =
  '"12 de mar. de 2026 15:44:00 GMT-8","25926492791","Transferir","","","Conta bancária com final: 964","","","Crédito Mastercard","","","","","0","0","0","0","0","0","0","0","-1.076,13","-1.076,13","Liberado","12 de mar. de 2026 15:44:00 GMT-8"';

// Linha de reembolso
const REEMBOLSO =
  '"5 de mar. de 2026 10:00:00 GMT-8","25926492791","Reembolso","701-412","MFS-0017","Almofada Cóccix","1","amazon.com.br","Crédito Mastercard","Amazon","Iguatu","CE","63500","-75,97","-3,19","0","3,19","0","7,48","5,00","0","0","-63,49","Liberado","5 de mar. de 2026 10:00:00 GMT-8"';

describe("parseAmazonCSV", () => {
  it("retorna array vazio para CSV vazio", () => {
    expect(parseAmazonCSV("")).toEqual([]);
  });

  it("retorna array vazio para CSV só com cabeçalho", () => {
    expect(parseAmazonCSV(HEADER)).toEqual([]);
  });

  it("faz parse de um pedido liberado", () => {
    const txns = parseAmazonCSV(buildCSV(PEDIDO_LIBERADO));
    expect(txns).toHaveLength(1);
    const t = txns[0]!;
    expect(t.tipo).toBe("Pedido");
    expect(t.liquidacaoId).toBe("25926492791");
    expect(t.pedidoId).toBe("701-412");
    expect(t.sku).toBe("MFS-0017");
    expect(t.totalCentavos).toBe(6185);
    expect(t.vendasProduto).toBe(7597);
    expect(t.tarifasVenda).toBe(-912);
    expect(t.taxasFba).toBe(-500);
    expect(t.status).toBe("Liberado");
    expect(t.dataLiberacao).toBeInstanceOf(Date);
  });

  it("faz parse de um pedido diferido", () => {
    const txns = parseAmazonCSV(buildCSV(PEDIDO_DIFERIDO));
    expect(txns).toHaveLength(1);
    expect(txns[0]!.status).toBe("Diferido");
    expect(txns[0]!.dataLiberacao).toBeNull();
    expect(txns[0]!.totalCentavos).toBe(6185);
  });

  it("faz parse de transferência (valor negativo)", () => {
    const txns = parseAmazonCSV(buildCSV(TRANSFERENCIA));
    expect(txns).toHaveLength(1);
    expect(txns[0]!.tipo).toBe("Transferir");
    expect(txns[0]!.totalCentavos).toBe(-107613);
  });

  it("faz parse de reembolso", () => {
    const txns = parseAmazonCSV(buildCSV(REEMBOLSO));
    expect(txns).toHaveLength(1);
    expect(txns[0]!.tipo).toBe("Reembolso");
    expect(txns[0]!.totalCentavos).toBe(-6349);
  });

  it("faz parse de múltiplas linhas", () => {
    const txns = parseAmazonCSV(
      buildCSV(PEDIDO_LIBERADO, PEDIDO_DIFERIDO, TRANSFERENCIA, REEMBOLSO),
    );
    expect(txns).toHaveLength(4);
  });

  it("converte data Amazon corretamente para Date", () => {
    const txns = parseAmazonCSV(buildCSV(PEDIDO_LIBERADO));
    const d = txns[0]!.dataHora;
    // "1 de mar. de 2026 00:15:19 GMT-8" → 2026-03-01T08:15:19Z
    expect(d.toISOString()).toBe("2026-03-01T08:15:19.000Z");
  });
});

describe("resumirImportacao", () => {
  it("resume corretamente múltiplos tipos de transação", () => {
    const txns = parseAmazonCSV(
      buildCSV(PEDIDO_LIBERADO, PEDIDO_DIFERIDO, TRANSFERENCIA, REEMBOLSO),
    );
    const resumo = resumirImportacao(txns);

    expect(resumo.totalTransacoes).toBe(4);
    expect(resumo.pedidos.quantidade).toBe(2);
    expect(resumo.transferencias.quantidade).toBe(1);
    expect(resumo.transferencias.totalCentavos).toBe(107613);
    expect(resumo.reembolsos.quantidade).toBe(1);
    expect(resumo.diferidos.quantidade).toBe(1);
    expect(resumo.diferidos.totalCentavos).toBe(6185);
  });

  it("agrupa por liquidação e detecta status TRANSFERIDO", () => {
    const txns = parseAmazonCSV(buildCSV(PEDIDO_LIBERADO, TRANSFERENCIA));
    const resumo = resumirImportacao(txns);
    const liq = resumo.liquidacoes.find(
      (l) => l.liquidacaoId === "25926492791",
    );
    expect(liq).toBeDefined();
    expect(liq!.status).toBe("TRANSFERIDO");
    expect(liq!.totalPedidos).toBe(1);
  });

  it("detecta liquidação PENDENTE quando não há transferência", () => {
    const txns = parseAmazonCSV(buildCSV(PEDIDO_DIFERIDO));
    const resumo = resumirImportacao(txns);
    const liq = resumo.liquidacoes.find(
      (l) => l.liquidacaoId === "99999999999",
    );
    expect(liq).toBeDefined();
    expect(liq!.status).toBe("PENDENTE");
    expect(liq!.dataTransferencia).toBeNull();
  });

  it("calcula período correto", () => {
    const txns = parseAmazonCSV(
      buildCSV(PEDIDO_LIBERADO, PEDIDO_DIFERIDO),
    );
    const resumo = resumirImportacao(txns);
    expect(resumo.periodo).toContain("2026");
  });
});
