import { describe, expect, it } from "vitest";
import {
  dataVendaPeriodoSP,
  isVendaAmazonContabilizavel,
  isVendaAmazonContabilizavelEstrito,
  isVendaAmazonPrincipal,
  isVendaAmazonRemovalOrder,
  STATUS_REEMBOLSO_NAO_LIBERADO,
  whereAmazonReembolsoContabilizavel,
  whereExcluiPrecoOrigem,
  whereVendaAmazonContabilizavel,
  whereVendaAmazonContabilizavelEstrito,
  whereVendaAmazonEspelhoGestorSeller,
  whereVendaAmazonPrincipal,
} from "./filtros";

// Procura recursivamente por uma chave `precoOrigem` aninhada DENTRO de qualquer
// array `NOT`. Em SQL, `NOT ("precoOrigem" = X)` descarta linhas com
// precoOrigem NULL (logica de tres valores) — foi o bug que sumiu com todo o
// historico legado. Nenhum filtro pode ter precoOrigem sob um NOT.
function temPrecoOrigemSobNot(where: unknown): boolean {
  let achou = false;
  const visit = (node: unknown, sobNot: boolean): void => {
    if (Array.isArray(node)) {
      node.forEach((n) => visit(n, sobNot));
      return;
    }
    if (node && typeof node === "object") {
      for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
        if (k === "precoOrigem" && sobNot) achou = true;
        visit(v, k === "NOT" ? true : sobNot);
      }
    }
  };
  visit(where, false);
  return achou;
}

describe("reposicao (replacement order) nunca conta como venda", () => {
  const reposicao = {
    statusPedido: "Pending",
    statusFinanceiro: "PENDENTE",
    valorBrutoCentavos: 4397,
    precoOrigem: "replacement",
  };

  it("nao e contabilizavel (dashboard)", () => {
    expect(isVendaAmazonContabilizavel(reposicao)).toBe(false);
  });

  it("nao e contabilizavel estrito (DRE/Contas a Receber)", () => {
    expect(isVendaAmazonContabilizavelEstrito(reposicao)).toBe(false);
  });

  it("nao aparece na visao principal de vendas", () => {
    expect(
      isVendaAmazonPrincipal({
        statusPedido: "Shipped",
        precoOrigem: "replacement",
      }),
    ).toBe(false);
  });
});

describe("filtros de vendas Amazon", () => {
  it("nao contabiliza pedido pendente sem confirmacao financeira", () => {
    expect(
      isVendaAmazonContabilizavel({
        statusPedido: "Pending",
        statusFinanceiro: "PENDENTE",
      }),
    ).toBe(false);
  });

  it("contabiliza pedido pendente quando ja tem confirmacao financeira", () => {
    expect(
      isVendaAmazonContabilizavel({
        statusPedido: "Pending",
        statusFinanceiro: "DEFERRED",
        valorBrutoCentavos: 4990,
      }),
    ).toBe(true);
  });

  it("nao contabiliza pedido pendente zerado mesmo com status financeiro diferente", () => {
    expect(
      isVendaAmazonContabilizavel({
        statusPedido: "Pending",
        statusFinanceiro: "DEFERRED",
        valorBrutoCentavos: 0,
      }),
    ).toBe(false);
  });

  it("inclui pedidos pendentes na visao principal", () => {
    expect(
      isVendaAmazonPrincipal({
        statusPedido: "Pending",
        statusFinanceiro: "PENDENTE",
      }),
    ).toBe(true);
    expect(
      isVendaAmazonPrincipal({
        statusPedido: "PendingAvailability",
        statusFinanceiro: "PENDENTE",
      }),
    ).toBe(true);
  });

  it("separa apenas cancelados e reembolsados da visao principal", () => {
    expect(
      isVendaAmazonPrincipal({
        statusPedido: "Canceled",
        statusFinanceiro: "PENDENTE",
      }),
    ).toBe(false);
    expect(
      isVendaAmazonPrincipal({
        statusPedido: "Shipped",
        statusFinanceiro: "REFUNDED",
      }),
    ).toBe(false);
  });

  it("contabiliza pedidos enviados", () => {
    expect(
      isVendaAmazonContabilizavel({
        statusPedido: "Shipped",
        statusFinanceiro: "DEFERRED",
      }),
    ).toBe(true);
  });

  it("identifica e remove pedidos S01/Non-Amazon da visao de venda", () => {
    const removal = {
      amazonOrderId: "S01-6716734-6047108",
      marketplace: "Non-Amazon",
      statusPedido: "Shipped",
      statusFinanceiro: "PENDENTE",
      valorBrutoCentavos: 94975,
    };

    expect(isVendaAmazonRemovalOrder(removal)).toBe(true);
    expect(isVendaAmazonContabilizavel(removal)).toBe(false);
    expect(isVendaAmazonPrincipal(removal)).toBe(false);
  });

  it("recorta datas usando o dia civil de Sao Paulo", () => {
    const filtro = dataVendaPeriodoSP("2026-04-27", "2026-04-27");

    expect(filtro?.gte).toEqual(new Date("2026-04-27T03:00:00.000Z"));
    expect(filtro?.lte).toEqual(new Date("2026-04-28T02:59:59.999Z"));
  });
});

describe("regressao: filtros preservam vendas legado (precoOrigem NULL)", () => {
  const filtros = [
    ["contabilizavel", whereVendaAmazonContabilizavel()],
    ["estrito", whereVendaAmazonContabilizavelEstrito()],
    ["espelho", whereVendaAmazonEspelhoGestorSeller()],
    ["principal", whereVendaAmazonPrincipal()],
  ] as const;

  it("whereExcluiPrecoOrigem monta OR null-safe (mantem NULL, exclui valores)", () => {
    expect(whereExcluiPrecoOrigem("replacement")).toEqual({
      OR: [{ precoOrigem: null }, { precoOrigem: { notIn: ["replacement"] } }],
    });
    expect(whereExcluiPrecoOrigem("replacement", "listing")).toEqual({
      OR: [
        { precoOrigem: null },
        { precoOrigem: { notIn: ["replacement", "listing"] } },
      ],
    });
  });

  it.each(filtros)(
    "%s NUNCA coloca precoOrigem dentro de NOT (descartaria os NULL)",
    (_nome, where) => {
      expect(temPrecoOrigemSobNot(where)).toBe(false);
    },
  );

  it.each(filtros)(
    "%s inclui o OR null-safe que preserva precoOrigem NULL",
    (_nome, where) => {
      expect(JSON.stringify(where)).toContain('"precoOrigem":null');
    },
  );
});

describe("whereAmazonReembolsoContabilizavel", () => {
  it("exclui status nao liberados mas mantem os liberados (match exato)", () => {
    expect(STATUS_REEMBOLSO_NAO_LIBERADO).toContain("DEFERRED");
    expect(STATUS_REEMBOLSO_NAO_LIBERADO).toContain("PENDENTE");
    // Critico: estes ja foram liberados — NAO podem ser excluidos do calculo.
    expect(STATUS_REEMBOLSO_NAO_LIBERADO).not.toContain("DEFERRED_RELEASED");
    expect(STATUS_REEMBOLSO_NAO_LIBERADO).not.toContain("RELEASED");
  });

  it("sem where: monta NOT com os status nao liberados", () => {
    expect(whereAmazonReembolsoContabilizavel()).toEqual({
      NOT: [{ statusFinanceiro: { in: [...STATUS_REEMBOLSO_NAO_LIBERADO] } }],
    });
  });

  it("com where extra: combina via AND (ex: liquidacaoId)", () => {
    expect(whereAmazonReembolsoContabilizavel({ liquidacaoId: "liq-1" })).toEqual({
      AND: [
        { NOT: [{ statusFinanceiro: { in: [...STATUS_REEMBOLSO_NAO_LIBERADO] } }] },
        { liquidacaoId: "liq-1" },
      ],
    });
  });
});
