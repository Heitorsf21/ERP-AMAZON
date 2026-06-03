// Testes do núcleo de isolamento (applyTenantIsolation) — sem DB real.
// Mockamos o callback `query` para inspecionar os args reescritos.
//
// Importante: applyTenantIsolation importa o PrismaClient indiretamente (db.ts),
// que não conecta ao banco enquanto nenhuma query real roda. Como exercitamos
// apenas o callback `query` mockado, nenhuma conexão é aberta.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock da recuperação de tenant via cookie (db.ts a chama quando não há contexto
// ALS). Default: null (sem cookie) — preserva o comportamento dos testes de
// fail-closed/fallback. Casos específicos sobrescrevem com mockResolvedValueOnce.
vi.mock("./tenant-request", () => ({
  resolveEmpresaIdFromRequestCookie: vi.fn(async () => null),
}));

import { applyTenantIsolation, GLOBAL_MODEL_NAMES, TENANT_MODEL_NAMES } from "./db";
import { resolveEmpresaIdFromRequestCookie } from "./tenant-request";
import { runWithTenant, type TenantContext } from "./tenant-context";

const ORIGINAL = process.env.TENANT_ISOLATION;

function setMode(mode: "off" | "enforce" | undefined) {
  if (mode === undefined) delete process.env.TENANT_ISOLATION;
  else process.env.TENANT_ISOLATION = mode;
}

afterEach(() => {
  setMode(ORIGINAL as "off" | "enforce" | undefined);
  delete process.env.TENANT_FALLBACK_EMPRESA;
  vi.restoreAllMocks();
});

const ctx = (empresaId: string | null, isSuperAdmin = false): TenantContext => ({
  empresaId,
  isSuperAdmin,
  source: "web",
});

/** Wrapper que captura os args que chegaram ao `query`. */
function makeQuery(result: unknown = { ok: true }) {
  const seen: unknown[] = [];
  const query = vi.fn(async (a: unknown) => {
    seen.push(a);
    return result;
  });
  return { query, seen };
}

describe("applyTenantIsolation — modo OFF (no-op)", () => {
  beforeEach(() => setMode("off"));

  it("flag ausente também é no-op", async () => {
    setMode(undefined);
    const { query, seen } = makeQuery();
    const args = { where: { id: "1" } };
    await applyTenantIsolation({
      model: "VendaAmazon",
      operation: "findMany",
      args,
      query,
    });
    // args passa intacto (mesma referência), sem contexto de tenant.
    expect(seen[0]).toBe(args);
  });

  it("não injeta empresaId mesmo com contexto presente", async () => {
    const { query, seen } = makeQuery();
    const args = { where: { id: "1" } };
    await runWithTenant(ctx("emp_1"), () =>
      applyTenantIsolation({
        model: "VendaAmazon",
        operation: "findMany",
        args,
        query,
      }),
    );
    expect(seen[0]).toBe(args);
    expect(seen[0]).toEqual({ where: { id: "1" } });
  });

  it("não faz fail-closed sem contexto (comportamento idêntico ao atual)", async () => {
    const { query } = makeQuery();
    await expect(
      applyTenantIsolation({
        model: "VendaAmazon",
        operation: "findMany",
        args: {},
        query,
      }),
    ).resolves.toEqual({ ok: true });
  });
});

describe("applyTenantIsolation — modo ENFORCE", () => {
  beforeEach(() => setMode("enforce"));

  it("injeta where.empresaId em findMany de modelo tenant", async () => {
    const { query, seen } = makeQuery();
    await runWithTenant(ctx("emp_1"), () =>
      applyTenantIsolation({
        model: "VendaAmazon",
        operation: "findMany",
        args: { where: { status: "OK" } },
        query,
      }),
    );
    expect(seen[0]).toEqual({ where: { status: "OK", empresaId: "emp_1" } });
  });

  it("injeta empresaId em count/aggregate/groupBy/updateMany/deleteMany", async () => {
    for (const operation of [
      "count",
      "aggregate",
      "groupBy",
      "updateMany",
      "deleteMany",
      "findFirst",
      "update",
      "delete",
    ]) {
      const { query, seen } = makeQuery();
      await runWithTenant(ctx("emp_2"), () =>
        applyTenantIsolation({
          model: "Produto",
          operation,
          args: { where: { sku: "X" } },
          query,
        }),
      );
      expect(seen[0]).toEqual({ where: { sku: "X", empresaId: "emp_2" } });
    }
  });

  it("não sobrescreve empresaId já presente no where", async () => {
    const { query, seen } = makeQuery();
    await runWithTenant(ctx("emp_1"), () =>
      applyTenantIsolation({
        model: "Produto",
        operation: "findMany",
        args: { where: { empresaId: "emp_OUTRA" } },
        query,
      }),
    );
    expect(seen[0]).toEqual({ where: { empresaId: "emp_OUTRA" } });
  });

  it("injeta data.empresaId em create quando ausente", async () => {
    const { query, seen } = makeQuery();
    await runWithTenant(ctx("emp_1"), () =>
      applyTenantIsolation({
        model: "Produto",
        operation: "create",
        args: { data: { sku: "ABC" } },
        query,
      }),
    );
    expect(seen[0]).toEqual({ data: { sku: "ABC", empresaId: "emp_1" } });
  });

  it("não sobrescreve data.empresaId já fornecido no create", async () => {
    const { query, seen } = makeQuery();
    await runWithTenant(ctx("emp_1"), () =>
      applyTenantIsolation({
        model: "Produto",
        operation: "create",
        args: { data: { sku: "ABC", empresaId: "emp_FIXA" } },
        query,
      }),
    );
    expect(seen[0]).toEqual({ data: { sku: "ABC", empresaId: "emp_FIXA" } });
  });

  it("injeta empresaId em cada linha de createMany", async () => {
    const { query, seen } = makeQuery();
    await runWithTenant(ctx("emp_3"), () =>
      applyTenantIsolation({
        model: "Produto",
        operation: "createMany",
        args: { data: [{ sku: "A" }, { sku: "B", empresaId: "emp_X" }] },
        query,
      }),
    );
    expect(seen[0]).toEqual({
      data: [
        { sku: "A", empresaId: "emp_3" },
        { sku: "B", empresaId: "emp_X" },
      ],
    });
  });

  it("FAIL-CLOSED: modelo tenant sem contexto lança erro claro", async () => {
    const { query } = makeQuery();
    await expect(
      applyTenantIsolation({
        model: "VendaAmazon",
        operation: "findMany",
        args: {},
        query,
      }),
    ).rejects.toThrow(/tenant-isolation.*Contexto de empresa ausente/i);
    expect(query).not.toHaveBeenCalled();
  });

  it("recupera empresaId do COOKIE da requisição quando não há contexto ALS (rota web requireRole direto)", async () => {
    // Simula rota que NÃO envolveu runWithTenant; a extensão recupera o tenant
    // do cookie de sessão. Tem prioridade sobre o env fallback.
    vi.mocked(resolveEmpresaIdFromRequestCookie).mockResolvedValueOnce("emp_cookie");
    const { query, seen } = makeQuery();
    await applyTenantIsolation({
      model: "VendaAmazon",
      operation: "findMany",
      args: { where: { status: "OK" } },
      query,
    });
    expect(seen[0]).toEqual({ where: { status: "OK", empresaId: "emp_cookie" } });
  });

  it("cookie tem prioridade sobre o env fallback", async () => {
    process.env.TENANT_FALLBACK_EMPRESA = "mundofs";
    vi.mocked(resolveEmpresaIdFromRequestCookie).mockResolvedValueOnce("emp_cookie");
    const { query, seen } = makeQuery();
    await applyTenantIsolation({
      model: "Produto",
      operation: "findMany",
      args: {},
      query,
    });
    expect(seen[0]).toEqual({ where: { empresaId: "emp_cookie" } });
  });

  it("FALLBACK single-tenant: sem contexto + TENANT_FALLBACK_EMPRESA injeta a empresa padrão", async () => {
    process.env.TENANT_FALLBACK_EMPRESA = "mundofs";
    const { query, seen } = makeQuery();
    // Sem runWithTenant (simula rota cujo contexto não propagou).
    await applyTenantIsolation({
      model: "VendaAmazon",
      operation: "findMany",
      args: { where: { status: "OK" } },
      query,
    });
    expect(seen[0]).toEqual({ where: { status: "OK", empresaId: "mundofs" } });
  });

  it("FALLBACK também injeta empresaId no create sem contexto", async () => {
    process.env.TENANT_FALLBACK_EMPRESA = "mundofs";
    const { query, seen } = makeQuery();
    await applyTenantIsolation({
      model: "Produto",
      operation: "create",
      args: { data: { sku: "X" } },
      query,
    });
    expect(seen[0]).toEqual({ data: { sku: "X", empresaId: "mundofs" } });
  });

  it("FAIL-CLOSED: contexto sem empresaId e sem superadmin lança erro", async () => {
    const { query } = makeQuery();
    await runWithTenant(ctx(null, false), async () => {
      await expect(
        applyTenantIsolation({
          model: "Produto",
          operation: "findMany",
          args: {},
          query,
        }),
      ).rejects.toThrow(/Contexto de empresa ausente/);
    });
    expect(query).not.toHaveBeenCalled();
  });

  it("modelos GLOBAIS não são filtrados (Usuario, ConfiguracaoSistema, Empresa)", async () => {
    for (const model of ["Usuario", "ConfiguracaoSistema", "Empresa", "AmazonAccount"]) {
      const { query, seen } = makeQuery();
      const args = { where: { id: "1" } };
      // Mesmo SEM contexto, modelos globais passam intactos (sem fail-closed).
      await applyTenantIsolation({ model, operation: "findMany", args, query });
      expect(seen[0]).toBe(args);
    }
  });

  it("superadmin amplo (sem empresaId) NÃO injeta filtro", async () => {
    const { query, seen } = makeQuery();
    const args = { where: { status: "OK" } };
    await runWithTenant(ctx(null, true), () =>
      applyTenantIsolation({
        model: "VendaAmazon",
        operation: "findMany",
        args,
        query,
      }),
    );
    expect(seen[0]).toBe(args);
    expect(seen[0]).toEqual({ where: { status: "OK" } });
  });

  it("superadmin COM empresaId concreto ainda filtra por aquela empresa", async () => {
    const { query, seen } = makeQuery();
    await runWithTenant(ctx("emp_super", true), () =>
      applyTenantIsolation({
        model: "VendaAmazon",
        operation: "findMany",
        args: {},
        query,
      }),
    );
    expect(seen[0]).toEqual({ where: { empresaId: "emp_super" } });
  });

  describe("findUnique — validação pós-fetch", () => {
    it("retorna o registro quando empresaId bate", async () => {
      const row = { id: "1", empresaId: "emp_1", sku: "X" };
      const query = vi.fn(async () => row);
      const out = await runWithTenant(ctx("emp_1"), () =>
        applyTenantIsolation({
          model: "Produto",
          operation: "findUnique",
          args: { where: { id: "1" } },
          query,
        }),
      );
      expect(out).toBe(row);
      // findUnique NÃO injeta empresaId no where (Prisma rejeitaria).
      expect(query).toHaveBeenCalledWith({ where: { id: "1" } });
    });

    it("retorna null quando o registro é de outra empresa", async () => {
      const row = { id: "1", empresaId: "emp_OUTRA", sku: "X" };
      const query = vi.fn(async () => row);
      const out = await runWithTenant(ctx("emp_1"), () =>
        applyTenantIsolation({
          model: "Produto",
          operation: "findUnique",
          args: { where: { id: "1" } },
          query,
        }),
      );
      expect(out).toBeNull();
    });

    it("propaga null nativo (registro inexistente)", async () => {
      const query = vi.fn(async () => null);
      const out = await runWithTenant(ctx("emp_1"), () =>
        applyTenantIsolation({
          model: "Produto",
          operation: "findUnique",
          args: { where: { id: "999" } },
          query,
        }),
      );
      expect(out).toBeNull();
    });

    it("AUGMENTA o select com empresaId, valida o tenant e remove o campo do retorno", async () => {
      const seen: unknown[] = [];
      const query = vi.fn(async (a: unknown) => {
        seen.push(a);
        return { id: "1", sku: "X", empresaId: "emp_1" };
      });
      const out = await runWithTenant(ctx("emp_1"), () =>
        applyTenantIsolation({
          model: "Produto",
          operation: "findUnique",
          args: { where: { id: "1" }, select: { id: true, sku: true } },
          query,
        }),
      );
      // O select foi augmentado com empresaId: true para permitir a validação.
      expect(seen[0]).toEqual({
        where: { id: "1" },
        select: { id: true, sku: true, empresaId: true },
      });
      // empresaId é removido do retorno — shape original do caller preservado.
      expect(out).toEqual({ id: "1", sku: "X" });
    });

    it("com select sem empresaId, registro de outra empresa retorna null", async () => {
      const query = vi.fn(async () => ({ id: "1", sku: "X", empresaId: "emp_OUTRA" }));
      const out = await runWithTenant(ctx("emp_1"), () =>
        applyTenantIsolation({
          model: "Produto",
          operation: "findUnique",
          args: { where: { id: "1" }, select: { id: true, sku: true } },
          query,
        }),
      );
      expect(out).toBeNull();
    });

    it("não altera o select quando empresaId já foi pedido (mantém no retorno)", async () => {
      const seen: unknown[] = [];
      const query = vi.fn(async (a: unknown) => {
        seen.push(a);
        return { id: "1", empresaId: "emp_1" };
      });
      const out = await runWithTenant(ctx("emp_1"), () =>
        applyTenantIsolation({
          model: "Produto",
          operation: "findUnique",
          args: { where: { id: "1" }, select: { id: true, empresaId: true } },
          query,
        }),
      );
      expect(seen[0]).toEqual({
        where: { id: "1" },
        select: { id: true, empresaId: true },
      });
      expect(out).toEqual({ id: "1", empresaId: "emp_1" });
    });

    it("FAIL-CLOSED patológico: se mesmo após augment o empresaId não vier, lança", async () => {
      // Banco devolve objeto sem empresaId mesmo tendo sido pedido (caso raro).
      const query = vi.fn(async () => ({ id: "1", sku: "X" }));
      await runWithTenant(ctx("emp_1"), async () => {
        await expect(
          applyTenantIsolation({
            model: "Produto",
            operation: "findUnique",
            args: { where: { id: "1" }, select: { id: true, sku: true } },
            query,
          }),
        ).rejects.toThrow(/não foi possível validar/i);
      });
    });
  });

  describe("upsert — injeta empresaId no create, protege o update, preserva o where", () => {
    it("injeta empresaId em create quando ausente e remove empresaId do update", async () => {
      const { query, seen } = makeQuery();
      await runWithTenant(ctx("emp_1"), () =>
        applyTenantIsolation({
          model: "Produto",
          operation: "upsert",
          args: {
            where: { sku: "ABC" },
            create: { sku: "ABC", nome: "P" },
            update: { nome: "P2", empresaId: "emp_HACK" },
          },
          query,
        }),
      );
      expect(seen[0]).toEqual({
        // where preservado (seletor de unique; com unique simples a linha casada
        // é a do tenant — uniques compostos cobrem multi-tenant na Fase 1c).
        where: { sku: "ABC" },
        create: { sku: "ABC", nome: "P", empresaId: "emp_1" },
        // empresaId removido do update (não permite trocar a empresa da linha).
        update: { nome: "P2" },
      });
    });

    it("não sobrescreve empresaId já presente no create", async () => {
      const { query, seen } = makeQuery();
      await runWithTenant(ctx("emp_1"), () =>
        applyTenantIsolation({
          model: "Produto",
          operation: "upsert",
          args: {
            where: { sku: "ABC" },
            create: { sku: "ABC", empresaId: "emp_FIXA" },
            update: {},
          },
          query,
        }),
      );
      expect(seen[0]).toEqual({
        where: { sku: "ABC" },
        create: { sku: "ABC", empresaId: "emp_FIXA" },
        update: {},
      });
    });

    it("FAIL-CLOSED: upsert em modelo tenant sem contexto lança erro", async () => {
      const { query } = makeQuery();
      await expect(
        applyTenantIsolation({
          model: "Produto",
          operation: "upsert",
          args: { where: { sku: "ABC" }, create: { sku: "ABC" }, update: {} },
          query,
        }),
      ).rejects.toThrow(/Contexto de empresa ausente/);
      expect(query).not.toHaveBeenCalled();
    });

    it("modo OFF: upsert passa inalterado (mesma referência)", async () => {
      setMode("off");
      const { query, seen } = makeQuery();
      const args = { where: { sku: "ABC" }, create: { sku: "ABC" }, update: {} };
      await runWithTenant(ctx("emp_1"), () =>
        applyTenantIsolation({ model: "Produto", operation: "upsert", args, query }),
      );
      expect(seen[0]).toBe(args);
    });
  });

  it("AuditLog é GLOBAL (não filtrado, não fail-closed sem contexto)", async () => {
    const { query, seen } = makeQuery();
    const args = { data: { acao: "LOGIN", entidade: "Usuario" } };
    // Sem contexto (fluxo de login) — não deve lançar nem injetar empresaId.
    await applyTenantIsolation({
      model: "AuditLog",
      operation: "create",
      args,
      query,
    });
    expect(seen[0]).toBe(args);
  });
});

describe("classificacao dos models novos (A+B)", () => {
  it("ConviteUsuario e AuditPlataforma sao GLOBAIS (nunca auto-filtrados)", () => {
    expect(GLOBAL_MODEL_NAMES.has("ConviteUsuario")).toBe(true);
    expect(GLOBAL_MODEL_NAMES.has("AuditPlataforma")).toBe(true);
    expect(TENANT_MODEL_NAMES.has("ConviteUsuario")).toBe(false);
    expect(TENANT_MODEL_NAMES.has("AuditPlataforma")).toBe(false);
  });
});
