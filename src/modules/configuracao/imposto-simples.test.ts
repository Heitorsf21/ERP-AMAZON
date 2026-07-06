import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runWithTenant, type TenantContext } from "@/lib/tenant-context";
import {
  getConfigImpostoSimples,
  invalidateConfigImpostoSimplesCache,
  saveConfigImpostoSimples,
} from "./imposto-simples";

const { dbMock } = vi.hoisted(() => ({
  dbMock: {
    configuracaoSistema: {
      findMany: vi.fn(),
      upsert: vi.fn(),
    },
  },
}));

vi.mock("@/lib/db", () => ({ db: dbMock }));

const KEY_ALIQUOTA = "imposto_simples_aliquota_bps";
const KEY_ATIVO = "imposto_simples_ativo";

function ctx(empresaId: string): TenantContext {
  return { empresaId, isSuperAdmin: false, source: "worker" };
}

// Responde conforme as chaves pedidas: linha escopada da UDN devolve 10%,
// linha nua (primária) devolve 6% — simula as duas empresas no mesmo banco.
function mockBancoDuasEmpresas() {
  dbMock.configuracaoSistema.findMany.mockImplementation(
    async ({ where }: { where: { chave: { in: string[] } } }) => {
      const chaves = where.chave.in;
      if (chaves.includes(`${KEY_ALIQUOTA}::udn`)) {
        return [
          { chave: `${KEY_ALIQUOTA}::udn`, valor: "1000" },
          { chave: `${KEY_ATIVO}::udn`, valor: "true" },
        ];
      }
      return [
        { chave: KEY_ALIQUOTA, valor: "600" },
        { chave: KEY_ATIVO, valor: "true" },
      ];
    },
  );
}

describe("imposto simples por empresa", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("WORKER_EMPRESA_ID", "mundofs");
    // Cache é estado de módulo — zera entre testes.
    invalidateConfigImpostoSimplesCache();
    dbMock.configuracaoSistema.upsert.mockResolvedValue({});
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("empresa primária lê com chave NUA (zero mudança p/ mundofs)", async () => {
    mockBancoDuasEmpresas();

    const config = await runWithTenant(ctx("mundofs"), () =>
      getConfigImpostoSimples(),
    );

    expect(config).toEqual({ aliquotaBps: 600, ativo: true });
    expect(dbMock.configuracaoSistema.findMany).toHaveBeenCalledWith({
      where: { chave: { in: [KEY_ALIQUOTA, KEY_ATIVO] } },
      select: { chave: true, valor: true },
    });
  });

  it("empresa primária grava com chave NUA", async () => {
    mockBancoDuasEmpresas();

    await runWithTenant(ctx("mundofs"), () =>
      saveConfigImpostoSimples({ aliquotaBps: 700, ativo: false }),
    );

    const chavesUpsert = dbMock.configuracaoSistema.upsert.mock.calls.map(
      (call: unknown[]) =>
        (call[0] as { where: { chave: string } }).where.chave,
    );
    expect(chavesUpsert).toEqual([KEY_ALIQUOTA, KEY_ATIVO]);
  });

  it("segunda empresa lê com chave ESCOPADA (chave::empresaId)", async () => {
    mockBancoDuasEmpresas();

    const config = await runWithTenant(ctx("udn"), () =>
      getConfigImpostoSimples(),
    );

    expect(config).toEqual({ aliquotaBps: 1000, ativo: true });
    expect(dbMock.configuracaoSistema.findMany).toHaveBeenCalledWith({
      where: {
        chave: { in: [`${KEY_ALIQUOTA}::udn`, `${KEY_ATIVO}::udn`] },
      },
      select: { chave: true, valor: true },
    });
  });

  it("segunda empresa grava com chave ESCOPADA", async () => {
    mockBancoDuasEmpresas();

    await runWithTenant(ctx("udn"), () =>
      saveConfigImpostoSimples({ aliquotaBps: 1200 }),
    );

    expect(dbMock.configuracaoSistema.upsert).toHaveBeenCalledWith({
      where: { chave: `${KEY_ALIQUOTA}::udn` },
      create: { chave: `${KEY_ALIQUOTA}::udn`, valor: "1200" },
      update: { valor: "1200" },
    });
  });

  it("caches independentes: alíquota da mundofs NÃO contamina a UDN no mesmo processo", async () => {
    mockBancoDuasEmpresas();

    // Worker roda as duas empresas no MESMO processo, intercaladas.
    const primeira = await runWithTenant(ctx("mundofs"), () =>
      getConfigImpostoSimples(),
    );
    const segunda = await runWithTenant(ctx("udn"), () =>
      getConfigImpostoSimples(),
    );
    expect(primeira.aliquotaBps).toBe(600);
    expect(segunda.aliquotaBps).toBe(1000);
    expect(dbMock.configuracaoSistema.findMany).toHaveBeenCalledTimes(2);

    // Segunda rodada dentro do TTL: cada empresa serve do PRÓPRIO cache,
    // sem novas idas ao banco e sem trocar valores entre si.
    const primeiraCache = await runWithTenant(ctx("mundofs"), () =>
      getConfigImpostoSimples(),
    );
    const segundaCache = await runWithTenant(ctx("udn"), () =>
      getConfigImpostoSimples(),
    );
    expect(primeiraCache.aliquotaBps).toBe(600);
    expect(segundaCache.aliquotaBps).toBe(1000);
    expect(dbMock.configuracaoSistema.findMany).toHaveBeenCalledTimes(2);
  });

  it("invalidate limpa o cache de TODAS as empresas", async () => {
    mockBancoDuasEmpresas();

    await runWithTenant(ctx("mundofs"), () => getConfigImpostoSimples());
    await runWithTenant(ctx("udn"), () => getConfigImpostoSimples());
    expect(dbMock.configuracaoSistema.findMany).toHaveBeenCalledTimes(2);

    invalidateConfigImpostoSimplesCache();

    await runWithTenant(ctx("mundofs"), () => getConfigImpostoSimples());
    await runWithTenant(ctx("udn"), () => getConfigImpostoSimples());
    expect(dbMock.configuracaoSistema.findMany).toHaveBeenCalledTimes(4);
  });

  it("sem contexto de tenant compartilha a entrada da primária (mesma linha do banco)", async () => {
    mockBancoDuasEmpresas();

    const semContexto = await getConfigImpostoSimples();
    expect(semContexto.aliquotaBps).toBe(600);
    expect(dbMock.configuracaoSistema.findMany).toHaveBeenCalledTimes(1);

    // Primária dentro do TTL: mesma chave escopada (nua) → cache hit.
    const primaria = await runWithTenant(ctx("mundofs"), () =>
      getConfigImpostoSimples(),
    );
    expect(primaria.aliquotaBps).toBe(600);
    expect(dbMock.configuracaoSistema.findMany).toHaveBeenCalledTimes(1);
  });
});
