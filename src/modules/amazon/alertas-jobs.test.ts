import { beforeEach, describe, expect, it, vi } from "vitest";

const { dbMock, emitirMock, resolverMock } = vi.hoisted(() => ({
  dbMock: { amazonSyncJob: { findFirst: vi.fn() } },
  emitirMock: vi.fn(),
  resolverMock: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ db: dbMock }));
vi.mock("@/lib/tenant-context", () => ({ currentEmpresaIdOrDefault: () => "udn" }));
vi.mock("@/lib/notificacoes", () => ({
  emitirNotificacao: emitirMock,
  resolverNotificacoes: resolverMock,
}));

import {
  alertarFalhaDeJob,
  chavesAlertaJob,
  classificarFalhaJob,
  deveAlertarFalhaJob,
  montarAlertaJob,
  resolverAlertasDoJob,
} from "./alertas-jobs";

const ERRO_403 = `SP-API POST /reports/2021-06-30/reports -> 403: {
  "errors": [ { "code": "Unauthorized", "message": "Access to the resource is forbidden" } ] }`;
const AGORA = new Date("2026-10-07T12:00:00Z");
const MIN = 60_000;

beforeEach(() => {
  vi.clearAllMocks();
  emitirMock.mockResolvedValue({ id: "n1" });
  resolverMock.mockResolvedValue(undefined);
  dbMock.amazonSyncJob.findFirst.mockResolvedValue(null);
});

describe("classificarFalhaJob", () => {
  it("403 Unauthorized da SP-API é falta de permissão (não adianta tentar de novo)", () => {
    expect(classificarFalhaJob(ERRO_403)).toBe("PERMISSAO");
  });
  it("erro de rede, 500 e 429 são falhas comuns", () => {
    expect(classificarFalhaJob("fetch failed")).toBe("COMUM");
    expect(classificarFalhaJob("LWA token error 500: We're sorry!")).toBe("COMUM");
    expect(classificarFalhaJob("SP-API GET /orders -> 429: QuotaExceeded")).toBe("COMUM");
  });
});

describe("deveAlertarFalhaJob (pula tropeço passageiro)", () => {
  it("job de 15 min que concluiu há 20 min: falha passageira, sem aviso", () => {
    const ultimoSucessoEm = new Date(AGORA.getTime() - 20 * MIN);
    expect(deveAlertarFalhaJob({ ultimoSucessoEm, agora: AGORA, intervaloMs: 15 * MIN })).toBe(false);
  });
  it("sem concluir há mais de 1 h (ou 2 ciclos), avisa", () => {
    const ultimoSucessoEm = new Date(AGORA.getTime() - 61 * MIN);
    expect(deveAlertarFalhaJob({ ultimoSucessoEm, agora: AGORA, intervaloMs: 15 * MIN })).toBe(true);
  });
  it("job diário só avisa depois de perder 2 ciclos", () => {
    const dia = 24 * 60 * MIN;
    expect(
      deveAlertarFalhaJob({ ultimoSucessoEm: new Date(AGORA.getTime() - dia), agora: AGORA, intervaloMs: dia }),
    ).toBe(false);
    expect(
      deveAlertarFalhaJob({ ultimoSucessoEm: new Date(AGORA.getTime() - 2 * dia), agora: AGORA, intervaloMs: dia }),
    ).toBe(true);
  });
  it("nunca concluiu: avisa", () => {
    expect(deveAlertarFalhaJob({ ultimoSucessoEm: null, agora: AGORA, intervaloMs: null })).toBe(true);
  });
});

describe("montarAlertaJob", () => {
  it("permissão: um aviso estável por job, explicando o que falta, sem jargão de job", () => {
    const a = montarAlertaJob("TRAFFIC_SYNC", "PERMISSAO", ERRO_403);
    expect(a.tipo).toBe("CONFIG_REVIEW");
    expect(a.dedupeKey).toBe("permissao_amazon:TRAFFIC_SYNC");
    expect(a.titulo).toBe("Amazon sem permissão: tráfego (sessões e conversão)");
    expect(a.descricao).toContain("Brand Analytics");
    expect(a.titulo).not.toContain("TRAFFIC_SYNC");
  });
  it("falha comum: chave estável (sem data) e nome amigável", () => {
    const a = montarAlertaJob("INVENTORY_SYNC", "COMUM", "fetch failed");
    expect(a.tipo).toBe("JOB_FALHANDO");
    expect(a.dedupeKey).toBe("job_falhando:INVENTORY_SYNC");
    expect(a.titulo).toBe("Sincronização com falha: estoque FBA");
    expect(a.descricao).toContain("fetch failed");
  });
  it("tipo sem nome amigável usa o próprio tipo", () => {
    expect(montarAlertaJob("NOVO_JOB", "COMUM", "x").titulo).toBe("Sincronização com falha: NOVO_JOB");
  });
});

describe("alertarFalhaDeJob", () => {
  it("permissão avisa na hora, sem reabrir o aviso já lido", async () => {
    await alertarFalhaDeJob({ tipo: "TRAFFIC_SYNC", erro: ERRO_403, intervaloMs: 24 * 60 * MIN, agora: AGORA });
    expect(dbMock.amazonSyncJob.findFirst).not.toHaveBeenCalled();
    expect(emitirMock).toHaveBeenCalledWith(
      expect.objectContaining({ dedupeKey: "permissao_amazon:TRAFFIC_SYNC", reabrirSeLida: false }),
    );
  });

  it("falha comum passageira (concluiu há pouco) não vai para o sino", async () => {
    dbMock.amazonSyncJob.findFirst.mockResolvedValue({ finishedAt: new Date(AGORA.getTime() - 10 * MIN) });
    const r = await alertarFalhaDeJob({ tipo: "INVENTORY_SYNC", erro: "fetch failed", intervaloMs: 15 * MIN, agora: AGORA });
    expect(dbMock.amazonSyncJob.findFirst).toHaveBeenCalledWith({
      where: { empresaId: "udn", tipo: "INVENTORY_SYNC", status: "SUCCESS" },
      orderBy: { finishedAt: "desc" },
      select: { finishedAt: true },
    });
    expect(emitirMock).not.toHaveBeenCalled();
    expect(r).toBe(false);
  });

  it("falha comum persistente avisa uma vez por incidente", async () => {
    dbMock.amazonSyncJob.findFirst.mockResolvedValue({ finishedAt: new Date(AGORA.getTime() - 3 * 60 * MIN) });
    const r = await alertarFalhaDeJob({ tipo: "INVENTORY_SYNC", erro: "fetch failed", intervaloMs: 15 * MIN, agora: AGORA });
    expect(emitirMock).toHaveBeenCalledWith(
      expect.objectContaining({ dedupeKey: "job_falhando:INVENTORY_SYNC", reabrirSeLida: false }),
    );
    expect(r).toBe(true);
  });
});

describe("resolverAlertasDoJob", () => {
  it("job concluiu: some o aviso de falha e o de permissão daquele job", async () => {
    await resolverAlertasDoJob("TRAFFIC_SYNC");
    expect(resolverMock).toHaveBeenCalledWith(["job_falhando:TRAFFIC_SYNC", "permissao_amazon:TRAFFIC_SYNC"]);
  });
  it("FINANCES_SYNC também encerra o alerta de sincronização financeira parada", () => {
    expect(chavesAlertaJob("FINANCES_SYNC")).toContain("finances-sync-parado");
  });
});
