import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock do Prisma: capturamos os args do create para inspecionar data.empresaId.
const createMock = vi.fn();
const findFirstMock = vi.fn();

vi.mock("@/lib/db", () => ({
  db: {
    amazonSyncJob: {
      create: (args: unknown) => createMock(args),
      findFirst: (args: unknown) => findFirstMock(args),
    },
  },
}));

import {
  claimNextAmazonSyncJob,
  enqueueAmazonSyncJob,
  filtroDeTiposDoWorker,
  intervaloAgendadoDoJob,
  jobCriticoEstaAtrasado,
  resolverEmpresasParaAgendar,
} from "./jobs";
import { runWithTenant } from "@/lib/tenant-context";
import { TipoAmazonSyncJob } from "@/modules/shared/domain";

function createdData() {
  return (createMock.mock.calls[0]?.[0] as { data: { empresaId: string | null } }).data;
}

describe("enqueueAmazonSyncJob — empresaId nunca é null (regressao SQS NOT NULL)", () => {
  beforeEach(() => {
    createMock.mockReset().mockImplementation((args) => ({
      id: "job_1",
      ...(args as { data: object }).data,
    }));
    findFirstMock.mockReset().mockResolvedValue(null);
  });

  it("resolve empresaId do contexto de tenant quando options nao passa (caso SQS)", async () => {
    await runWithTenant(
      { empresaId: "emp_x", isSuperAdmin: false, source: "worker" },
      () => enqueueAmazonSyncJob(TipoAmazonSyncJob.ORDERS_SYNC, {}, {}),
    );
    expect(createMock).toHaveBeenCalledTimes(1);
    expect(createdData().empresaId).toBe("emp_x");
  });

  it("cai no fallback de background (mundofs) sem contexto de tenant", async () => {
    await enqueueAmazonSyncJob(TipoAmazonSyncJob.ORDERS_SYNC, {}, {});
    expect(createdData().empresaId).toBe("mundofs");
  });

  it("respeita empresaId explicito das options (vence o contexto)", async () => {
    await runWithTenant(
      { empresaId: "emp_x", isSuperAdmin: false, source: "worker" },
      () => enqueueAmazonSyncJob(TipoAmazonSyncJob.ORDERS_SYNC, {}, { empresaId: "emp_y" }),
    );
    expect(createdData().empresaId).toBe("emp_y");
  });

  it("nunca emite empresaId null no create", async () => {
    await enqueueAmazonSyncJob(TipoAmazonSyncJob.ORDERS_SYNC, {}, {});
    expect(createdData().empresaId).not.toBeNull();
  });
});

describe("resolverEmpresasParaAgendar — primária legado nunca sai do agendamento", () => {
  const PRIMARIA = "mundofs";

  it("REGRESSAO: agenda a primária (legado) MESMO com um segundo seller conectado", () => {
    // Cenário real (03/07): UDN conecta uma AmazonAccount ATIVA. Antes, a lista
    // deixava de ser vazia e a primária caía fora — FINANCES/TRAFFIC/REFUNDS da
    // mundofs pararam. A primária tem credenciais no legado (ConfiguracaoSistema)
    // e AmazonAccount PENDENTE, então NUNCA aparece em contasAtivas.
    const ids = resolverEmpresasParaAgendar({
      contasAtivas: ["udn"],
      primariaId: PRIMARIA,
      primariaTemCredenciaisLegado: true,
    });
    expect(ids).toContain(PRIMARIA);
    expect(ids).toContain("udn");
    expect(ids).toHaveLength(2);
  });

  it("single-tenant: só a primária, sem contas conectadas", () => {
    const ids = resolverEmpresasParaAgendar({
      contasAtivas: [],
      primariaId: PRIMARIA,
      primariaTemCredenciaisLegado: true,
    });
    expect(ids).toEqual([PRIMARIA]);
  });

  it("não duplica a primária quando ela também tem AmazonAccount ATIVA", () => {
    const ids = resolverEmpresasParaAgendar({
      contasAtivas: [PRIMARIA, "udn"],
      primariaId: PRIMARIA,
      primariaTemCredenciaisLegado: true,
    });
    expect(ids.filter((id) => id === PRIMARIA)).toHaveLength(1);
    expect(ids).toHaveLength(2);
  });

  it("primária sem credenciais legado NÃO é forçada, mas mantém o seller ativo", () => {
    const ids = resolverEmpresasParaAgendar({
      contasAtivas: ["udn"],
      primariaId: PRIMARIA,
      primariaTemCredenciaisLegado: false,
    });
    expect(ids).toEqual(["udn"]);
  });

  it("fallback absoluto: nunca devolve lista vazia", () => {
    const ids = resolverEmpresasParaAgendar({
      contasAtivas: [],
      primariaId: PRIMARIA,
      primariaTemCredenciaisLegado: false,
    });
    expect(ids).toEqual([PRIMARIA]);
  });
});

describe("jobCriticoEstaAtrasado — watchdog do FINANCES_SYNC", () => {
  const agora = new Date("2026-07-08T22:00:00.000Z");

  it("alerta quando nunca houve sucesso", () => {
    expect(
      jobCriticoEstaAtrasado({ ultimoSucessoEm: null, agora, limiteHoras: 6 }),
    ).toBe(true);
  });

  it("alerta quando o último sucesso passou do limite (incidente 03–08/07)", () => {
    // Último FINANCES_SYNC da MundoFS foi 06/07 23:01 — dias atrás.
    expect(
      jobCriticoEstaAtrasado({
        ultimoSucessoEm: new Date("2026-07-06T23:01:00.000Z"),
        agora,
        limiteHoras: 6,
      }),
    ).toBe(true);
  });

  it("NÃO alerta quando rodou dentro do limite", () => {
    expect(
      jobCriticoEstaAtrasado({
        ultimoSucessoEm: new Date("2026-07-08T18:00:00.000Z"), // 4h atrás
        agora,
        limiteHoras: 6,
      }),
    ).toBe(false);
  });

  it("limite é inclusivo (exatamente no limite alerta)", () => {
    expect(
      jobCriticoEstaAtrasado({
        ultimoSucessoEm: new Date("2026-07-08T16:00:00.000Z"), // 6h exatas
        agora,
        limiteHoras: 6,
      }),
    ).toBe(true);
  });
});

describe("claimNextAmazonSyncJob — fila dedicada por tipo (aviso de venda não espera job longo)", () => {
  beforeEach(() => {
    findFirstMock.mockReset().mockResolvedValue(null);
  });

  function whereDoClaim() {
    return (findFirstMock.mock.calls[0]?.[0] as { where: Record<string, unknown> }).where;
  }

  it("sem filtro, mantém o claim global (nenhum filtro de tipo)", async () => {
    await claimNextAmazonSyncJob("w1");
    expect(whereDoClaim().tipo).toBeUndefined();
  });

  it("worker de pedidos só pega ORDERS_SYNC", async () => {
    await claimNextAmazonSyncJob("w-pedidos", { tipos: [TipoAmazonSyncJob.ORDERS_SYNC] });
    expect(whereDoClaim().tipo).toEqual({ in: [TipoAmazonSyncJob.ORDERS_SYNC] });
  });

  it("worker principal pode deixar de pegar ORDERS_SYNC", async () => {
    await claimNextAmazonSyncJob("w1", { excluirTipos: [TipoAmazonSyncJob.ORDERS_SYNC] });
    expect(whereDoClaim().tipo).toEqual({ notIn: [TipoAmazonSyncJob.ORDERS_SYNC] });
  });
});

describe("filtroDeTiposDoWorker — lê AMAZON_WORKER_TIPOS / AMAZON_WORKER_EXCLUIR_TIPOS", () => {
  it("sem env → sem filtro (comportamento atual preservado)", () => {
    expect(filtroDeTiposDoWorker({})).toEqual({});
  });

  it("parseia CSV com espaços e ignora tipos desconhecidos", () => {
    expect(
      filtroDeTiposDoWorker({ AMAZON_WORKER_TIPOS: " ORDERS_SYNC , NAO_EXISTE ," }),
    ).toEqual({ tipos: [TipoAmazonSyncJob.ORDERS_SYNC] });
    expect(
      filtroDeTiposDoWorker({ AMAZON_WORKER_EXCLUIR_TIPOS: "ORDERS_SYNC" }),
    ).toEqual({ excluirTipos: [TipoAmazonSyncJob.ORDERS_SYNC] });
  });
});

describe("intervaloAgendadoDoJob — base do 'só avisa depois de 2 ciclos sem concluir'", () => {
  it("job diário devolve 24 h", () => {
    expect(intervaloAgendadoDoJob(TipoAmazonSyncJob.TRAFFIC_SYNC)).toBe(24 * 60 * 60_000);
  });

  it("job agendado mais de uma vez usa o MAIOR intervalo (mais tolerante)", () => {
    expect(intervaloAgendadoDoJob(TipoAmazonSyncJob.ORDERS_SYNC)).toBeGreaterThanOrEqual(5 * 60_000);
  });

  it("job sem agendamento (manual/SQS) devolve null", () => {
    expect(intervaloAgendadoDoJob("NAO_AGENDADO")).toBeNull();
  });
});
