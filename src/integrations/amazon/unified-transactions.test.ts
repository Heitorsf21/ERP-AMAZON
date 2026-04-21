import { describe, expect, it } from "vitest";
import {
  AmazonTransactionStatus,
  converterParaVendasAmazon,
  parseAmazonReportDate,
  parseAmazonUnifiedTransactionCsv,
  resumirAmazonUnifiedTransactions,
} from "./unified-transactions";

const CSV_EXEMPLO = `"Inclui transacoes da Amazon"
"data/hora","id de liquidação","tipo","id do pedido","sku","descrição","quantidade","mercado","tipo de conta","atendimento","cidade do pedido","estado do pedido","postal do pedido","vendas do produto","créditos de remessa","créditos de embalagem de presente","descontos promocionais","imposto de vendas coletados","tarifas de venda","taxas fba","taxas de outras transações","outro","total","Status da transação","Data de liberação da transação"
"26 de mar. de 2026 06:46:03 GMT-7","261","Pedido","701-1","MFS-0032","Produto A","1","amazon.com.br","Visa","Amazon","Sao Paulo","SP","01000","59,99","0","0","0","0","-7,20","-5,00","0","0","47,79","Diferido",""
"27 de mar. de 2026 06:46:03 GMT-7","262","Pedido","701-2","MFS-0017","Produto B","2","amazon.com.br","Visa","Amazon","Sao Paulo","SP","01000","100,00","10,00","0","-10,00","0","-12,00","-5,00","0","0","83,00","Liberado","28 de mar. de 2026 06:46:03 GMT-7"
"28 de mar. de 2026 06:46:03 GMT-7","263","Transferir","","","Transferencia para conta bancaria","","Amazon.com.br","Visa","","","","","0","0","0","0","0","0","0","0","-50,00","-50,00","Liberado","28 de mar. de 2026 06:46:03 GMT-7"`;

describe("Amazon unified transactions", () => {
  it("parseia o CSV com preambulo e colunas em portugues", () => {
    const parsed = parseAmazonUnifiedTransactionCsv(CSV_EXEMPLO);

    expect(parsed.headerLine).toBe(2);
    expect(parsed.transactions).toHaveLength(3);
    expect(parsed.transactions[0]).toMatchObject({
      idPedido: "701-1",
      sku: "MFS-0032",
      quantidade: 1,
      totalCentavos: 4779,
      statusNormalizado: AmazonTransactionStatus.DIFERIDO,
      dataLiberacao: null,
    });
  });

  it("resume pedidos, recebiveis e transferencias separadamente", () => {
    const { transactions } = parseAmazonUnifiedTransactionCsv(CSV_EXEMPLO);
    const resumo = resumirAmazonUnifiedTransactions(transactions);

    expect(resumo.totalLinhas).toBe(3);
    expect(resumo.pedidos).toMatchObject({
      linhas: 2,
      pedidosUnicos: 2,
      skusUnicos: 2,
      quantidade: 3,
      brutoCentavos: 16999,
      liquidoCentavos: 13079,
    });
    expect(resumo.recebiveis.diferidoCentavos).toBe(4779);
    expect(resumo.recebiveis.transferidoBancoCentavos).toBe(5000);
    expect(resumo.recebiveis.saldoRelatorioCentavos).toBe(8079);
  });

  it("converte pedidos para o contrato VendaAmazon", () => {
    const { transactions } = parseAmazonUnifiedTransactionCsv(CSV_EXEMPLO);
    const vendas = converterParaVendasAmazon(transactions, {
      somenteLiberadas: true,
    });

    expect(vendas).toHaveLength(1);
    expect(vendas[0]).toMatchObject({
      sku: "MFS-0017",
      quantidade: 2,
      valorBrutoCentavos: 11000,
      taxasCentavos: 2700,
      marketplace: "amazon.com.br",
      referenciaExterna: "701-2",
    });
  });

  it("parseia datas da Amazon com fuso GMT", () => {
    expect(
      parseAmazonReportDate("26 de mar. de 2026 06:46:03 GMT-7")?.toISOString(),
    ).toBe("2026-03-26T13:46:03.000Z");
  });
});
