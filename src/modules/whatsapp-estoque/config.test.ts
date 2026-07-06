// Testes do escopo POR EMPRESA das chaves whatsapp_estoque_* e do caminho do
// segredo (waha_api_key cifrada mesmo com a chave escopada "::<empresaId>").
//
// Contexto: o job WHATSAPP_ESTOQUE_RESUMO roda por empresa. Sem escopo, o
// resumo de estoque da UDN seria enviado ao WhatsApp da mundofs. E como a
// detecção de segredo em crypto.ts é por sufixo "_key", a chave escopada
// ("..._key::emp") precisa continuar sendo tratada como segredo — senão a api
// key de tenants secundários iria ao banco em TEXTO PLANO.

import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  runWithTenant,
  type TenantContext,
} from "@/lib/tenant-context";
import {
  encryptConfigValue,
  isSecretConfigKey,
} from "@/lib/crypto";

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
  upsert: vi.fn(),
  deleteMany: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    configuracaoSistema: {
      findMany: mocks.findMany,
      upsert: mocks.upsert,
      deleteMany: mocks.deleteMany,
    },
  },
}));

import {
  getWhatsappEstoqueConfig,
  getWhatsappEstoqueConfigPublic,
  getWhatsappEstoqueScheduleConfig,
  saveWhatsappEstoqueConfig,
  HORARIO_DEFAULT,
  SESSION_DEFAULT,
  WHATSAPP_ESTOQUE_KEYS,
} from "./config";

const PRIMARIA = "mundofs";
const UDN = "emp_udn";

const ctx = (empresaId: string): TenantContext => ({
  empresaId,
  isSuperAdmin: false,
  source: "web",
});

const BASE_KEYS = Object.values(WHATSAPP_ESTOQUE_KEYS);

/** Chaves passadas no `where.chave.in` da última chamada de findMany. */
function chavesConsultadas(): string[] {
  const call = mocks.findMany.mock.calls.at(-1)?.[0];
  return call?.where?.chave?.in ?? [];
}

/** Args do upsert cuja chave gravada é `chave`. */
function upsertDe(chave: string) {
  return mocks.upsert.mock.calls.find((c) => c[0]?.where?.chave === chave)?.[0];
}

beforeAll(() => {
  // 32 bytes hex — obriga encryptConfigValue a cifrar de verdade (sem a env,
  // em NODE_ENV=test ele devolveria texto puro e o teste do segredo passaria
  // em falso).
  process.env.CONFIG_ENCRYPTION_KEY = "a1".repeat(32);
  // Primária default do configKeyParaEmpresa.
  delete process.env.WORKER_EMPRESA_ID;
});

beforeEach(() => {
  mocks.findMany.mockReset().mockResolvedValue([]);
  mocks.upsert.mockReset().mockResolvedValue({});
  mocks.deleteMany.mockReset().mockResolvedValue({ count: 0 });
});

describe("escopo de chave por empresa — leitura", () => {
  it("empresa primária consulta as chaves NUAS (zero mudança p/ mundofs)", async () => {
    await runWithTenant(ctx(PRIMARIA), () => getWhatsappEstoqueConfig());
    expect(chavesConsultadas().sort()).toEqual([...BASE_KEYS].sort());
  });

  it("empresa secundária consulta SOMENTE chaves escopadas ::empresaId", async () => {
    await runWithTenant(ctx(UDN), () => getWhatsappEstoqueConfig());
    const chaves = chavesConsultadas();
    expect(chaves.sort()).toEqual(BASE_KEYS.map((k) => `${k}::${UDN}`).sort());
    // Nenhuma chave nua no where — a config da mundofs é inalcançável.
    for (const k of BASE_KEYS) expect(chaves).not.toContain(k);
  });

  it("UDN sem linhas próprias nasce INATIVA com defaults (não herda mundofs)", async () => {
    // O banco tem a config da mundofs nas chaves nuas, mas o where escopado
    // não as traz — simulado pelo retorno vazio.
    const config = await runWithTenant(ctx(UDN), () =>
      getWhatsappEstoqueConfig(),
    );
    expect(config.ativo).toBe(false);
    expect(config.horario).toBe(HORARIO_DEFAULT);
    expect(config.destinatario).toBe("");
    expect(config.wahaUrl).toBe("");
    expect(config.wahaSession).toBe(SESSION_DEFAULT);
    expect(config.wahaApiKey).toBe("");
  });

  it("valores da linha escopada são mapeados de volta pro nome base", async () => {
    mocks.findMany.mockResolvedValue([
      { chave: `${WHATSAPP_ESTOQUE_KEYS.ATIVO}::${UDN}`, valor: "true" },
      {
        chave: `${WHATSAPP_ESTOQUE_KEYS.DESTINATARIO}::${UDN}`,
        valor: "5511999990000",
      },
    ]);
    const config = await runWithTenant(ctx(UDN), () =>
      getWhatsappEstoqueConfig(),
    );
    expect(config.ativo).toBe(true);
    expect(config.destinatario).toBe("5511999990000");
  });

  it("getWhatsappEstoqueScheduleConfig usa chaves escopadas p/ secundária", async () => {
    await runWithTenant(ctx(UDN), () => getWhatsappEstoqueScheduleConfig());
    expect(chavesConsultadas().sort()).toEqual(
      [
        `${WHATSAPP_ESTOQUE_KEYS.ATIVO}::${UDN}`,
        `${WHATSAPP_ESTOQUE_KEYS.HORARIO}::${UDN}`,
      ].sort(),
    );
  });
});

describe("escopo de chave por empresa — escrita", () => {
  it("primária grava nas chaves nuas", async () => {
    await runWithTenant(ctx(PRIMARIA), () =>
      saveWhatsappEstoqueConfig({ ativo: true, destinatario: "5511988887777" }),
    );
    expect(upsertDe(WHATSAPP_ESTOQUE_KEYS.ATIVO)?.create.valor).toBe("true");
    expect(upsertDe(WHATSAPP_ESTOQUE_KEYS.DESTINATARIO)?.create.valor).toBe(
      "5511988887777",
    );
  });

  it("secundária grava nas chaves escopadas — nunca sobrescreve a primária", async () => {
    await runWithTenant(ctx(UDN), () =>
      saveWhatsappEstoqueConfig({ ativo: true, wahaUrl: "http://waha:3000" }),
    );
    expect(upsertDe(`${WHATSAPP_ESTOQUE_KEYS.ATIVO}::${UDN}`)).toBeDefined();
    expect(upsertDe(`${WHATSAPP_ESTOQUE_KEYS.WAHA_URL}::${UDN}`)).toBeDefined();
    // Nenhum write na chave nua da mundofs.
    expect(upsertDe(WHATSAPP_ESTOQUE_KEYS.ATIVO)).toBeUndefined();
    expect(upsertDe(WHATSAPP_ESTOQUE_KEYS.WAHA_URL)).toBeUndefined();
  });

  it("valor vazio deleta a linha ESCOPADA da própria empresa", async () => {
    await runWithTenant(ctx(UDN), () =>
      saveWhatsappEstoqueConfig({ destinatario: "" }),
    );
    expect(mocks.deleteMany).toHaveBeenCalledWith({
      where: { chave: `${WHATSAPP_ESTOQUE_KEYS.DESTINATARIO}::${UDN}` },
    });
  });
});

describe("caminho do segredo (waha_api_key)", () => {
  it("crypto.isSecretConfigKey reconhece a chave escopada (guarda de regressão)", () => {
    // O sufixo "::<empresaId>" não pode quebrar a heurística por "_key" — o
    // config.ts decide pela chave BASE, e crypto.ts também normaliza pelo
    // nome base antes do "::". Se isto regredir, a key iria em texto plano.
    expect(isSecretConfigKey(WHATSAPP_ESTOQUE_KEYS.WAHA_API_KEY)).toBe(true);
    expect(
      isSecretConfigKey(`${WHATSAPP_ESTOQUE_KEYS.WAHA_API_KEY}::${UDN}`),
    ).toBe(true);
  });

  it("api key da secundária é gravada CIFRADA na chave escopada", async () => {
    const plaintext = "waha-secret-da-udn";
    await runWithTenant(ctx(UDN), () =>
      saveWhatsappEstoqueConfig({ wahaApiKey: plaintext }),
    );
    const args = upsertDe(`${WHATSAPP_ESTOQUE_KEYS.WAHA_API_KEY}::${UDN}`);
    expect(args).toBeDefined();
    expect(args.create.valor).toMatch(/^enc:v1:/);
    expect(args.create.valor).not.toContain(plaintext);
    expect(args.update.valor).toMatch(/^enc:v1:/);
  });

  it("api key da primária segue cifrada na chave nua (comportamento intacto)", async () => {
    const plaintext = "waha-secret-mundofs";
    await runWithTenant(ctx(PRIMARIA), () =>
      saveWhatsappEstoqueConfig({ wahaApiKey: plaintext }),
    );
    const args = upsertDe(WHATSAPP_ESTOQUE_KEYS.WAHA_API_KEY);
    expect(args).toBeDefined();
    expect(args.create.valor).toMatch(/^enc:v1:/);
    expect(args.create.valor).not.toContain(plaintext);
  });

  it("valor mascarado (****) NÃO regrava — preserva o segredo armazenado", async () => {
    await runWithTenant(ctx(UDN), () =>
      saveWhatsappEstoqueConfig({ wahaApiKey: "********" }),
    );
    expect(mocks.upsert).not.toHaveBeenCalled();
    expect(mocks.deleteMany).not.toHaveBeenCalled();
  });

  it("leitura decifra a api key escopada de volta ao texto original", async () => {
    const plaintext = "waha-secret-da-udn";
    mocks.findMany.mockResolvedValue([
      {
        chave: `${WHATSAPP_ESTOQUE_KEYS.WAHA_API_KEY}::${UDN}`,
        valor: encryptConfigValue(plaintext),
      },
    ]);
    const config = await runWithTenant(ctx(UDN), () =>
      getWhatsappEstoqueConfig(),
    );
    expect(config.wahaApiKey).toBe(plaintext);
  });

  it("config pública nunca expõe a api key — só o booleano wahaApiKeyDefinida", async () => {
    mocks.findMany.mockResolvedValue([
      {
        chave: `${WHATSAPP_ESTOQUE_KEYS.WAHA_API_KEY}::${UDN}`,
        valor: encryptConfigValue("segredo"),
      },
    ]);
    const publica = await runWithTenant(ctx(UDN), () =>
      getWhatsappEstoqueConfigPublic(),
    );
    expect(publica.wahaApiKeyDefinida).toBe(true);
    expect("wahaApiKey" in publica).toBe(false);
  });
});
