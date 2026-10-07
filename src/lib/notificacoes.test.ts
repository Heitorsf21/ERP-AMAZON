import { beforeEach, describe, expect, it, vi } from "vitest";

const { dbMock } = vi.hoisted(() => ({
  dbMock: {
    notificacao: { create: vi.fn(), upsert: vi.fn(), deleteMany: vi.fn() },
  },
}));
vi.mock("@/lib/db", () => ({ db: dbMock }));
vi.mock("@/lib/tenant-context", () => ({ currentEmpresaIdOrDefault: () => "mundofs" }));

import { emitirNotificacao, resolverNotificacoes } from "./notificacoes";

beforeEach(() => {
  vi.clearAllMocks();
  dbMock.notificacao.upsert.mockResolvedValue({ id: "n1" });
  dbMock.notificacao.deleteMany.mockResolvedValue({ count: 1 });
});

describe("emitirNotificacao", () => {
  const base = { tipo: "JOB_FALHANDO" as const, titulo: "t", descricao: "d", dedupeKey: "k" };

  it("alerta comum volta a ficar não lido quando se repete (comportamento de sempre)", async () => {
    await emitirNotificacao(base);
    expect(dbMock.notificacao.upsert.mock.calls[0][0].update.lida).toBe(false);
  });

  it("incidente que continua igual NÃO reabre o aviso que a pessoa já leu", async () => {
    await emitirNotificacao({ ...base, reabrirSeLida: false });
    const update = dbMock.notificacao.upsert.mock.calls[0][0].update;
    expect(update).not.toHaveProperty("lida");
    expect(update.descricao).toBe("d");
  });
});

describe("resolverNotificacoes", () => {
  it("apaga os avisos do incidente só da empresa atual", async () => {
    await resolverNotificacoes(["job_falhando:TRAFFIC_SYNC", "permissao_amazon:TRAFFIC_SYNC"]);
    expect(dbMock.notificacao.deleteMany).toHaveBeenCalledWith({
      where: {
        empresaId: "mundofs",
        dedupeKey: { in: ["job_falhando:TRAFFIC_SYNC", "permissao_amazon:TRAFFIC_SYNC"] },
      },
    });
  });

  it("sem chaves não consulta o banco", async () => {
    await resolverNotificacoes([]);
    expect(dbMock.notificacao.deleteMany).not.toHaveBeenCalled();
  });
});
