import { beforeEach, describe, expect, it, vi } from "vitest";

const { dbMock, envioMock } = vi.hoisted(() => ({
  dbMock: {
    vendaAmazon: { findMany: vi.fn() },
    produto: { findMany: vi.fn() },
  },
  envioMock: {
    enviarPush: vi.fn(),
    reservarEnvio: vi.fn(),
    entregar: vi.fn(),
    concluirEnvio: vi.fn(),
  },
}));
vi.mock("@/lib/db", () => ({ db: dbMock }));
vi.mock("./envio", () => ({ ...envioMock, TipoPushEnvio: { VENDA_NOVA: "VENDA_NOVA", VENDAS_AGRUPADAS: "VENDAS_AGRUPADAS", TESTE: "TESTE" } }));
vi.mock("./loja", () => ({ nomeDaLoja: vi.fn(async () => "MundoFS") }));
vi.mock("@/lib/tenant-context", () => ({
  getEmpresaId: () => "mundofs",
  currentEmpresaIdOrDefault: () => "mundofs",
}));

import { notificarVendaDeOrderChange, notificarVendasCriadasNoSync, vendaCriadaGeraAviso } from "./vendas";

const AGORA = new Date("2026-10-06T22:35:00Z");
const RECENTE = new Date("2026-10-06T22:33:10Z");

function orderChange(
  status: string,
  data: string,
  itens = [{ SellerSKU: "MFS-0036", Quantity: 1 }],
  amazonOrderId = "702-4417820-3391045",
) {
  return {
    OrderChangeNotification: {
      AmazonOrderId: amazonOrderId,
      Summary: { OrderStatus: status, PurchaseDate: data, OrderItems: itens },
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  dbMock.vendaAmazon.findMany.mockResolvedValue([]);
  dbMock.produto.findMany.mockResolvedValue([{ sku: "MFS-0036", amazonPrecoListagemCentavos: 7700 }]);
  envioMock.enviarPush.mockResolvedValue({ destinos: 1, ok: 1, falhas: 0, duplicado: false });
  envioMock.entregar.mockResolvedValue({ destinos: 1, ok: 1, falhas: 0 });
  envioMock.concluirEnvio.mockResolvedValue(undefined);
});

describe("gatilho SQS (ORDER_CHANGE)", () => {
  it("pedido novo avisa na hora, com loja e valor estimado, dedupe por pedido", async () => {
    await notificarVendaDeOrderChange(orderChange("Pending", "2026-10-06T22:33:10Z"), AGORA);
    expect(envioMock.enviarPush).toHaveBeenCalledTimes(1);
    const arg = envioMock.enviarPush.mock.calls[0]?.[0];
    expect(arg.dedupeKey).toBe("venda:702-4417820-3391045");
    expect(arg.empresaId).toBe("mundofs");
    expect(arg.payload.title).toBe("Nova venda na MundoFS");
    expect(arg.payload.body.startsWith("Você realizou uma nova venda de R$")).toBe(true);
    expect(arg.payload.body).not.toContain("~");
    expect(JSON.stringify(arg.payload)).not.toContain("MFS-0036");
  });

  it("preço real recente do SKU tem prioridade sobre o listing", async () => {
    dbMock.vendaAmazon.findMany.mockResolvedValue([{ sku: "MFS-0036", precoUnitarioCentavos: 6990 }]);
    await notificarVendaDeOrderChange(orderChange("Pending", "2026-10-06T22:33:10Z", [{ SellerSKU: "MFS-0036", Quantity: 2 }]), AGORA);
    expect(envioMock.enviarPush.mock.calls[0]?.[0].payload.body).toMatch(/139,80/);
  });

  it("pedido antigo ou cancelado não avisa", async () => {
    await notificarVendaDeOrderChange(orderChange("Pending", "2026-10-06T18:00:00Z"), AGORA);
    await notificarVendaDeOrderChange(orderChange("Canceled", "2026-10-06T22:33:10Z"), AGORA);
    expect(envioMock.enviarPush).not.toHaveBeenCalled();
  });

  it("pedido MCF (S01-) não é venda do marketplace: não avisa", async () => {
    await notificarVendaDeOrderChange(
      orderChange("Pending", "2026-10-06T22:33:10Z", undefined, "S01-1234567-7654321"),
      AGORA,
    );
    expect(envioMock.enviarPush).not.toHaveBeenCalled();
  });

  it("erro no envio nunca derruba o processamento da mensagem", async () => {
    envioMock.enviarPush.mockRejectedValue(new Error("rede caiu"));
    await expect(notificarVendaDeOrderChange(orderChange("Pending", "2026-10-06T22:33:10Z"), AGORA)).resolves.toBeUndefined();
  });
});

describe("gatilho de reserva (ORDERS_SYNC)", () => {
  const venda = (id: string, valor = 7700) => ({
    amazonOrderId: id,
    purchaseDate: RECENTE,
    status: "Pending",
    valorBrutoCentavos: valor,
    estimado: true,
  });

  it("pedido que o SQS já avisou é ignorado (reserva devolve null)", async () => {
    envioMock.reservarEnvio.mockResolvedValueOnce(null).mockResolvedValueOnce("env2");
    await notificarVendasCriadasNoSync([venda("A"), venda("B")], AGORA);
    expect(envioMock.entregar).toHaveBeenCalledTimes(1);
    expect(envioMock.concluirEnvio).toHaveBeenCalledWith("env2", expect.anything());
  });

  it("mais de 3 pedidos novos de uma vez viram 1 aviso agrupado", async () => {
    envioMock.reservarEnvio.mockImplementation(async ({ dedupeKey }: { dedupeKey: string }) => `env-${dedupeKey}`);
    await notificarVendasCriadasNoSync(["A", "B", "C", "D", "E"].map((id) => venda(id)), AGORA);
    expect(envioMock.entregar).toHaveBeenCalledTimes(1);
    expect(envioMock.entregar.mock.calls[0]?.[0].payload.title).toBe("5 novas vendas na MundoFS");
    expect(envioMock.concluirEnvio).toHaveBeenCalledTimes(5);
  });

  it("pedido MCF (S01-) que escapou do filtro do sync não avisa", async () => {
    envioMock.reservarEnvio.mockResolvedValue("env1");
    await notificarVendasCriadasNoSync([venda("S01-1234567-7654321")], AGORA);
    expect(envioMock.reservarEnvio).not.toHaveBeenCalled();
    expect(envioMock.entregar).not.toHaveBeenCalled();
  });

  it("vendas antigas do backfill/primeira conexão não avisam", async () => {
    await notificarVendasCriadasNoSync([{ ...venda("A"), purchaseDate: new Date("2026-10-03T10:00:00Z") }], AGORA);
    expect(envioMock.reservarEnvio).not.toHaveBeenCalled();
  });
});

describe("quais linhas criadas pelo ORDERS_SYNC viram aviso", () => {
  it("venda normal do marketplace avisa", () => {
    expect(
      vendaCriadaGeraAviso({ amazonOrderId: "702-4417820-3391045", marketplace: "Amazon.com.br", precoOrigem: "sp-api" }),
    ).toBe(true);
    expect(
      vendaCriadaGeraAviso({ amazonOrderId: "702-4417820-3391045", marketplace: "Amazon.com.br", precoOrigem: "listing" }),
    ).toBe(true);
  });

  it("MCF não avisa (prefixo S01- ou canal Non-Amazon): a tela de Vendas nem mostra o pedido", () => {
    expect(
      vendaCriadaGeraAviso({ amazonOrderId: "S01-1234567-7654321", marketplace: "Amazon.com.br", precoOrigem: "listing" }),
    ).toBe(false);
    expect(
      vendaCriadaGeraAviso({ amazonOrderId: "702-0000000-0000000", marketplace: "Non-Amazon", precoOrigem: "listing" }),
    ).toBe(false);
  });

  it("reposição (R$ 0, fora do Faturamento) não avisa", () => {
    expect(
      vendaCriadaGeraAviso({ amazonOrderId: "702-4417820-3391045", marketplace: "Amazon.com.br", precoOrigem: "replacement" }),
    ).toBe(false);
  });
});
