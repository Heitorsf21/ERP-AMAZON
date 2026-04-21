import { describe, expect, it } from "vitest";
import {
  isFormatoNubank,
  limparDescricaoNubank,
  sugerirCategoriaNubank,
} from "./nubank";

describe("isFormatoNubank", () => {
  it("aceita header oficial", () => {
    expect(
      isFormatoNubank(["Data", "Valor", "Identificador", "Descrição"]),
    ).toBe(true);
  });

  it("rejeita header parcial", () => {
    expect(isFormatoNubank(["Data", "Valor", "Descrição"])).toBe(false);
  });

  it("rejeita header com colunas extras", () => {
    expect(
      isFormatoNubank([
        "Data",
        "Valor",
        "Identificador",
        "Descrição",
        "Saldo",
      ]),
    ).toBe(false);
  });

  it("é case-sensitive (não confunde com outros bancos)", () => {
    expect(
      isFormatoNubank(["data", "valor", "identificador", "descrição"]),
    ).toBe(false);
  });
});

describe("limparDescricaoNubank", () => {
  it("PIX recebido pelo Pix → 'PIX recebido — Nome'", () => {
    const r = limparDescricaoNubank(
      "Transferência recebida pelo Pix - ARTHUR DOS SANTOS FERNANDES - •••.631.536-•• - BCO SANTANDER (BRASIL) S.A. (0033) Agência: 3893 Conta: 1076415-5",
    );
    expect(r).toBe("PIX recebido — ARTHUR DOS SANTOS FERNANDES");
  });

  it("PIX enviado pelo Pix → 'PIX enviado — Fornecedor'", () => {
    const r = limparDescricaoNubank(
      "Transferência enviada pelo Pix - HERMES COMERCIAL E REPRESENTACOES - 57.455.565/0001-80 - WOOVI IP LTDA. (0694) Agência: 1 Conta: 186-4",
    );
    expect(r).toBe("PIX enviado — HERMES COMERCIAL E REPRESENTACOES");
  });

  it("Transferência Recebida (TED/DOC) → 'Transferência recebida — Nome'", () => {
    const r = limparDescricaoNubank(
      "Transferência Recebida - AMAZON SERVICOS DE VAREJO DO BRASIL LTDA - 15.436.940/0001-03 - Bank of America Merrill Lynch Banco Múltiplo S.A. (0755) Agência: 1306 Conta: 1057504-2",
    );
    expect(r).toBe(
      "Transferência recebida — AMAZON SERVICOS DE VAREJO DO BRASIL LTDA",
    );
  });

  it("Pagamento de boleto → 'Boleto pago — Beneficiário'", () => {
    const r = limparDescricaoNubank(
      "Pagamento de boleto efetuado - APS GESTAO CONTABIL LTDA",
    );
    expect(r).toBe("Boleto pago — APS GESTAO CONTABIL LTDA");
  });

  it("padrão desconhecido fica como veio (ex.: 'Pagamento de fatura')", () => {
    expect(limparDescricaoNubank("Pagamento de fatura")).toBe(
      "Pagamento de fatura",
    );
  });

  it("pula segmento que parece data e pega o nome real", () => {
    const r = limparDescricaoNubank(
      "Transferência enviada pelo Pix - 04/08/2025 - JOAO DA SILVA - 123.456.789-00 - BANCO X",
    );
    expect(r).toBe("PIX enviado — JOAO DA SILVA");
  });

  it("pula segmento de data com hora", () => {
    const r = limparDescricaoNubank(
      "Pagamento de boleto efetuado - 15/04/2026 14:32 - APS GESTAO CONTABIL LTDA",
    );
    expect(r).toBe("Boleto pago — APS GESTAO CONTABIL LTDA");
  });

  it("pula segmento que parece CPF/CNPJ", () => {
    const r = limparDescricaoNubank(
      "Transferência Recebida - 15.436.940/0001-03 - AMAZON SERVICOS",
    );
    expect(r).toBe("Transferência recebida — AMAZON SERVICOS");
  });

  it("se só sobra ruído, devolve apenas o rótulo", () => {
    const r = limparDescricaoNubank(
      "Transferência enviada pelo Pix - 04/08/2025 - 123.456.789-00",
    );
    expect(r).toBe("PIX enviado");
  });
});

describe("sugerirCategoriaNubank", () => {
  it("Amazon → Pagamento Amazon", () => {
    expect(
      sugerirCategoriaNubank(
        "Transferência Recebida - AMAZON SERVICOS DE VAREJO DO BRASIL LTDA - 15.436.940/0001-03 - Bank of America...",
      ),
    ).toBe("Pagamento Amazon");
  });

  it("APS Contábil → Contabilidade", () => {
    expect(
      sugerirCategoriaNubank(
        "Pagamento de boleto efetuado - APS GESTAO CONTABIL LTDA",
      ),
    ).toBe("Contabilidade");
  });

  it("Pagamento de fatura → Pagamento de fatura", () => {
    expect(sugerirCategoriaNubank("Pagamento de fatura")).toBe(
      "Pagamento de fatura",
    );
  });

  it("WOOVI/HERMES/ASAAS → Despesas operacionais", () => {
    expect(
      sugerirCategoriaNubank(
        "Transferência enviada pelo Pix - HERMES COMERCIAL E REPRESENTACOES - 57.455.565/0001-80 - WOOVI IP LTDA.",
      ),
    ).toBe("Despesas operacionais");
    expect(
      sugerirCategoriaNubank(
        "Transferência enviada pelo Pix - THA ENVIADO - 50.478.439/0001-00 - ASAAS IP S.A.",
      ),
    ).toBe("Despesas operacionais");
  });

  it("desconhecido → null (cai no fallback)", () => {
    expect(
      sugerirCategoriaNubank(
        "Transferência recebida pelo Pix - JOSE DA SILVA - BANCO XYZ",
      ),
    ).toBe(null);
  });
});
