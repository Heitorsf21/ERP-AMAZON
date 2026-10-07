import { beforeEach, describe, expect, it, vi } from "vitest";

// ── Mocks ───────────────────────────────────────────────────────────────

const dbMock = vi.hoisted(() => ({
  whatsAppEstoqueEnvio: {
    create: vi.fn(),
    update: vi.fn(),
    findFirst: vi.fn(),
  },
}));
vi.mock("@/lib/db", () => ({ db: dbMock }));

const configMock = vi.hoisted(() => ({ getWhatsappEstoqueConfig: vi.fn() }));
vi.mock("./config", () => configMock);

const serviceMock = vi.hoisted(() => ({ obterResumoEstoqueWhatsApp: vi.fn() }));
vi.mock("./service", () => serviceMock);

const messageMock = vi.hoisted(() => ({ montarPartesMensagem: vi.fn() }));
vi.mock("./message", () => messageMock);

const wahaMock = vi.hoisted(() => ({
  enviarTextoWaha: vi.fn(),
  obterStatusSessaoWaha: vi.fn(),
  reiniciarSessaoWaha: vi.fn(),
}));
vi.mock("./waha-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./waha-client")>()),
  ...wahaMock,
}));

const notifMock = vi.hoisted(() => ({
  emitirNotificacao: vi.fn(),
  resolverNotificacoes: vi.fn(),
}));
vi.mock("@/lib/notificacoes", () => notifMock);

import { runWhatsappEstoqueResumo } from "./jobs";

// ── Helpers ─────────────────────────────────────────────────────────────

const MSG_RECONECTAR =
  "WhatsApp desconectado: reconecte em Configurações → Integrações (escaneie o QR com o celular da conta)";

const enviouOk = { ok: true, status: 201, idMensagem: "m" };
const falhou422 = { ok: false, status: 422, erro: "WAHA respondeu 422" };

function textosEnviados(): string[] {
  return wahaMock.enviarTextoWaha.mock.calls.map(
    (c) => (c[0] as { texto: string }).texto,
  );
}

function statusSequencia(...status: string[]) {
  for (const s of status) {
    wahaMock.obterStatusSessaoWaha.mockResolvedValueOnce({ ok: true, status: s });
  }
}

const dormir = vi.fn(async (_ms: number) => {});

beforeEach(() => {
  vi.resetAllMocks();
  dormir.mockImplementation(async () => {});
  serviceMock.obterResumoEstoqueWhatsApp.mockResolvedValue({
    totais: { CRITICO: 1, ATENCAO: 1, ESTAVEL: 0, SEGURO: 1 },
    totalProdutos: 3,
    itens: [],
  });
  configMock.getWhatsappEstoqueConfig.mockResolvedValue({
    ativo: true,
    horario: "10:00",
    destinatario: "5511999998888",
    wahaUrl: "http://127.0.0.1:3002",
    wahaSession: "default",
    wahaApiKey: "chave",
  });
  messageMock.montarPartesMensagem.mockReturnValue(["p1", "p2", "p3"]);
  dbMock.whatsAppEstoqueEnvio.create.mockResolvedValue({ id: "envio-1" });
  dbMock.whatsAppEstoqueEnvio.update.mockResolvedValue({});
  notifMock.emitirNotificacao.mockResolvedValue({});
  notifMock.resolverNotificacoes.mockResolvedValue(undefined);
  wahaMock.reiniciarSessaoWaha.mockResolvedValue({ ok: true });
});

function ultimoUpdate() {
  const calls = dbMock.whatsAppEstoqueEnvio.update.mock.calls;
  return calls.at(-1)?.[0] as {
    where: { id: string };
    data: { status: string; erro?: string };
  };
}

// ── Testes ──────────────────────────────────────────────────────────────

describe("runWhatsappEstoqueResumo — sucesso direto", () => {
  it("envia todas as partes, grava SUCESSO e resolve o aviso do incidente", async () => {
    wahaMock.enviarTextoWaha.mockResolvedValue(enviouOk);

    const r = await runWhatsappEstoqueResumo({ tipo: "DIARIO", dormir });

    expect(r.status).toBe("SUCESSO");
    expect(textosEnviados()).toEqual(["p1", "p2", "p3"]);
    expect(wahaMock.obterStatusSessaoWaha).not.toHaveBeenCalled();
    expect(ultimoUpdate().data.status).toBe("SUCESSO");
    expect(notifMock.resolverNotificacoes).toHaveBeenCalledWith([
      "whatsapp_estoque_falha",
    ]);
    expect(notifMock.emitirNotificacao).not.toHaveBeenCalled();
  });

  it("no TESTE com sucesso também resolve o aviso", async () => {
    wahaMock.enviarTextoWaha.mockResolvedValue(enviouOk);

    const r = await runWhatsappEstoqueResumo({ tipo: "TESTE", dormir });

    expect(r.status).toBe("SUCESSO");
    expect(notifMock.resolverNotificacoes).toHaveBeenCalledWith([
      "whatsapp_estoque_falha",
    ]);
  });

  it("falha ao limpar o aviso não quebra o envio", async () => {
    wahaMock.enviarTextoWaha.mockResolvedValue(enviouOk);
    notifMock.resolverNotificacoes.mockRejectedValue(new Error("db fora"));

    const r = await runWhatsappEstoqueResumo({ tipo: "DIARIO", dormir });

    expect(r.status).toBe("SUCESSO");
  });
});

describe("runWhatsappEstoqueResumo — sessão FAILED se recupera", () => {
  it("reinicia, espera WORKING e reenvia a partir da parte que falhou", async () => {
    wahaMock.enviarTextoWaha
      .mockResolvedValueOnce(enviouOk) // p1
      .mockResolvedValueOnce(falhou422) // p2 falha
      .mockResolvedValue(enviouOk); // reenvio p2, p3
    statusSequencia("FAILED", "STARTING", "WORKING");

    const r = await runWhatsappEstoqueResumo({ tipo: "DIARIO", dormir });

    expect(r.status).toBe("SUCESSO");
    expect(r.erro).toBeUndefined();
    expect(wahaMock.reiniciarSessaoWaha).toHaveBeenCalledTimes(1);
    expect(textosEnviados()).toEqual(["p1", "p2", "p2", "p3"]);
    expect(dormir).toHaveBeenCalledWith(3000);
    expect(ultimoUpdate().data.status).toBe("SUCESSO");
    expect(notifMock.resolverNotificacoes).toHaveBeenCalledWith([
      "whatsapp_estoque_falha",
    ]);
    expect(notifMock.emitirNotificacao).not.toHaveBeenCalled();
  });

  it("STOPPED também dispara o reinício", async () => {
    wahaMock.enviarTextoWaha
      .mockResolvedValueOnce(falhou422)
      .mockResolvedValue(enviouOk);
    statusSequencia("STOPPED", "WORKING");

    const r = await runWhatsappEstoqueResumo({ tipo: "DIARIO", dormir });

    expect(r.status).toBe("SUCESSO");
    expect(wahaMock.reiniciarSessaoWaha).toHaveBeenCalledTimes(1);
    expect(textosEnviados()).toEqual(["p1", "p1", "p2", "p3"]);
  });

  it("reenvia só UMA vez: se o reenvio falhar, grava ERRO", async () => {
    wahaMock.enviarTextoWaha
      .mockResolvedValueOnce(falhou422)
      .mockResolvedValueOnce(enviouOk) // reenvio p1
      .mockResolvedValueOnce(falhou422); // reenvio p2 falha
    statusSequencia("FAILED", "WORKING");

    const r = await runWhatsappEstoqueResumo({ tipo: "DIARIO", dormir });

    expect(r.status).toBe("ERRO");
    expect(r.erro).toBe("Falha na parte 2/3: WAHA respondeu 422");
    expect(wahaMock.enviarTextoWaha).toHaveBeenCalledTimes(3);
    expect(wahaMock.reiniciarSessaoWaha).toHaveBeenCalledTimes(1);
  });

  it("desiste após 30 s consultando a cada 3 s se não voltar a WORKING", async () => {
    wahaMock.enviarTextoWaha.mockResolvedValue(falhou422);
    wahaMock.obterStatusSessaoWaha
      .mockResolvedValueOnce({ ok: true, status: "FAILED" })
      .mockResolvedValue({ ok: true, status: "STARTING" });

    const r = await runWhatsappEstoqueResumo({ tipo: "DIARIO", dormir });

    expect(r.status).toBe("ERRO");
    expect(r.erro).toContain("WAHA respondeu 422");
    expect(wahaMock.enviarTextoWaha).toHaveBeenCalledTimes(1);
    const esperas = dormir.mock.calls.map((c) => c[0]);
    expect(esperas.every((ms) => ms === 3000)).toBe(true);
    expect(esperas.reduce((a, b) => a + b, 0)).toBe(30_000);
  });

  it("consultas lentas não esticam a janela de 30 s (teto pelo relógio)", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      const avancar = (ms: number) => {
        vi.setSystemTime(Date.now() + ms);
      };
      dormir.mockImplementation(async (ms: number) => avancar(ms));
      wahaMock.enviarTextoWaha.mockResolvedValue(falhou422);
      wahaMock.obterStatusSessaoWaha
        .mockResolvedValueOnce({ ok: true, status: "FAILED" })
        .mockImplementation(async () => {
          avancar(10_000); // cada consulta estoura o timeout de 10 s
          return { ok: false, erro: "Timeout apos 10000ms ao chamar WAHA" };
        });

      const r = await runWhatsappEstoqueResumo({ tipo: "DIARIO", dormir });

      expect(r.status).toBe("ERRO");
      // 3 s + 10 s por volta → para na 3ª volta (39 s), não na 10ª (130 s).
      expect(dormir).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it("sessão WORKING com falha no envio: não reinicia nem reenvia", async () => {
    wahaMock.enviarTextoWaha.mockResolvedValue(falhou422);
    statusSequencia("WORKING");

    const r = await runWhatsappEstoqueResumo({ tipo: "DIARIO", dormir });

    expect(r.status).toBe("ERRO");
    expect(r.erro).toBe("Falha na parte 1/3: WAHA respondeu 422");
    expect(wahaMock.reiniciarSessaoWaha).not.toHaveBeenCalled();
    expect(wahaMock.enviarTextoWaha).toHaveBeenCalledTimes(1);
    expect(dormir).not.toHaveBeenCalled();
  });
});

describe("runWhatsappEstoqueResumo — sessão pede QR (SCAN_QR_CODE)", () => {
  it("DIARIO: grava ERRO com a instrução de reconectar e avisa com chave estável sem reabrir", async () => {
    wahaMock.enviarTextoWaha.mockResolvedValue(falhou422);
    statusSequencia("SCAN_QR_CODE");

    const r = await runWhatsappEstoqueResumo({ tipo: "DIARIO", dormir });

    expect(r.status).toBe("ERRO");
    expect(r.erro).toBe(MSG_RECONECTAR);
    expect(ultimoUpdate().data).toMatchObject({ status: "ERRO", erro: MSG_RECONECTAR });
    expect(wahaMock.reiniciarSessaoWaha).not.toHaveBeenCalled();
    expect(wahaMock.enviarTextoWaha).toHaveBeenCalledTimes(1);
    expect(notifMock.emitirNotificacao).toHaveBeenCalledTimes(1);
    expect(notifMock.emitirNotificacao).toHaveBeenCalledWith(
      expect.objectContaining({
        dedupeKey: "whatsapp_estoque_falha",
        reabrirSeLida: false,
        descricao: MSG_RECONECTAR,
        linkRef: "/configuracoes?tab=integracoes",
      }),
    );
    expect(notifMock.resolverNotificacoes).not.toHaveBeenCalled();
  });

  it("TESTE: grava ERRO com a instrução mas não gera aviso", async () => {
    wahaMock.enviarTextoWaha.mockResolvedValue(falhou422);
    statusSequencia("SCAN_QR_CODE");

    const r = await runWhatsappEstoqueResumo({ tipo: "TESTE", dormir });

    expect(r.status).toBe("ERRO");
    expect(r.erro).toBe(MSG_RECONECTAR);
    expect(notifMock.emitirNotificacao).not.toHaveBeenCalled();
  });

  it("FAILED que termina em SCAN_QR_CODE após reiniciar também pede reconexão", async () => {
    wahaMock.enviarTextoWaha.mockResolvedValue(falhou422);
    statusSequencia("FAILED", "STARTING", "SCAN_QR_CODE");

    const r = await runWhatsappEstoqueResumo({ tipo: "DIARIO", dormir });

    expect(r.status).toBe("ERRO");
    expect(r.erro).toBe(MSG_RECONECTAR);
    expect(wahaMock.reiniciarSessaoWaha).toHaveBeenCalledTimes(1);
    expect(wahaMock.enviarTextoWaha).toHaveBeenCalledTimes(1);
  });

  it("falha ao emitir o aviso não faz o job lançar", async () => {
    wahaMock.enviarTextoWaha.mockResolvedValue(falhou422);
    statusSequencia("SCAN_QR_CODE");
    notifMock.emitirNotificacao.mockRejectedValue(new Error("db fora"));

    const r = await runWhatsappEstoqueResumo({ tipo: "DIARIO", dormir });

    expect(r.status).toBe("ERRO");
  });
});

describe("runWhatsappEstoqueResumo — configuração incompleta", () => {
  it("DIARIO sem URL grava SKIPPED e avisa com a chave estável", async () => {
    configMock.getWhatsappEstoqueConfig.mockResolvedValue({
      ativo: true,
      horario: "10:00",
      destinatario: "",
      wahaUrl: "",
      wahaSession: "default",
      wahaApiKey: "",
    });

    const r = await runWhatsappEstoqueResumo({ tipo: "DIARIO", dormir });

    expect(r.status).toBe("SKIPPED");
    expect(wahaMock.enviarTextoWaha).not.toHaveBeenCalled();
    expect(notifMock.emitirNotificacao).toHaveBeenCalledWith(
      expect.objectContaining({
        dedupeKey: "whatsapp_estoque_falha",
        reabrirSeLida: false,
      }),
    );
  });
});
