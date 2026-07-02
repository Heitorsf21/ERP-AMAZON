import { beforeEach, describe, expect, it, vi } from "vitest";

const { dbMock, criarEmpresaMock } = vi.hoisted(() => ({
  dbMock: {
    empresa: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    usuario: {
      findFirst: vi.fn(),
    },
  },
  criarEmpresaMock: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ db: dbMock }));
vi.mock("@/modules/plataforma/empresas", () => ({ criarEmpresa: criarEmpresaMock }));

import { provisionarEmpresaDoCheckout, slugificarNome } from "./provisionamento";
import type Stripe from "stripe";

function sessionFake(overrides: Record<string, unknown> = {}): Stripe.Checkout.Session {
  return {
    id: "cs_test_123",
    customer: "cus_ABC",
    customer_details: { email: "cliente@exemplo.com", name: "Maria Silva" },
    custom_fields: [
      { key: "nome_empresa", text: { value: "Açaí do João" }, type: "text" },
    ],
    metadata: { origem: "landing", plano: "pro", ciclo: "mensal" },
    ...overrides,
  } as unknown as Stripe.Checkout.Session;
}

describe("slugificarNome", () => {
  it("converte nome com acentos e espaços em slug", () => {
    expect(slugificarNome("Açaí do João")).toBe("acai-do-joao");
  });

  it("corta em 30 caracteres sem terminar em hífen", () => {
    const slug = slugificarNome("Loja Muito Grande De Nome Comprido Demais LTDA ME");
    expect(slug.length).toBeLessThanOrEqual(30);
    expect(slug).toMatch(/^[a-z0-9-]{3,30}$/);
    expect(slug.endsWith("-")).toBe(false);
  });

  it("garante mínimo de 3 caracteres com prefixo loja", () => {
    expect(slugificarNome("A")).toBe("loja-a");
    expect(slugificarNome("")).toBe("loja");
  });
});

describe("provisionarEmpresaDoCheckout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbMock.empresa.findFirst.mockResolvedValue(null);
    dbMock.empresa.findUnique.mockResolvedValue(null); // slug livre
    dbMock.usuario.findFirst.mockResolvedValue(null); // e-mail livre
    dbMock.empresa.update.mockResolvedValue({});
    criarEmpresaMock.mockResolvedValue({
      empresaId: "emp_1",
      adminId: "usr_1",
      rawToken: "tok",
      definiuSenha: false,
    });
  });

  it("cria empresa + admin e grava stripeCustomerId", async () => {
    const r = await provisionarEmpresaDoCheckout(sessionFake());

    expect(r).toEqual({ status: "criada", empresaId: "emp_1" });
    expect(criarEmpresaMock).toHaveBeenCalledWith({
      nome: "Açaí do João",
      slug: "acai-do-joao",
      admin: { nome: "Maria Silva", email: "cliente@exemplo.com" },
    });
    expect(dbMock.empresa.update).toHaveBeenCalledWith({
      where: { id: "emp_1" },
      data: { stripeCustomerId: "cus_ABC" },
    });
  });

  it("é idempotente: customer já provisionado não cria de novo", async () => {
    dbMock.empresa.findFirst.mockResolvedValue({ id: "emp_9" });

    const r = await provisionarEmpresaDoCheckout(sessionFake());

    expect(r).toEqual({ status: "ja-existia", empresaId: "emp_9" });
    expect(criarEmpresaMock).not.toHaveBeenCalled();
  });

  it("ignora sessão sem e-mail", async () => {
    const r = await provisionarEmpresaDoCheckout(
      sessionFake({ customer_details: { email: null, name: "X" } }),
    );
    expect(r).toEqual({ status: "ignorada", motivo: "sem-email" });
    expect(criarEmpresaMock).not.toHaveBeenCalled();
  });

  it("ignora quando e-mail já pertence a outro usuário", async () => {
    dbMock.usuario.findFirst.mockResolvedValue({ id: "usr_x" });
    const r = await provisionarEmpresaDoCheckout(sessionFake());
    expect(r).toEqual({ status: "ignorada", motivo: "email-em-uso" });
    expect(criarEmpresaMock).not.toHaveBeenCalled();
  });

  it("usa nome do pagador como fallback quando não há custom field", async () => {
    await provisionarEmpresaDoCheckout(sessionFake({ custom_fields: [] }));
    expect(criarEmpresaMock).toHaveBeenCalledWith(
      expect.objectContaining({ nome: "Maria Silva" }),
    );
  });

  it("resolve colisão de slug com sufixo aleatório", async () => {
    dbMock.empresa.findUnique
      .mockResolvedValueOnce({ id: "outra" }) // "acai-do-joao" ocupado
      .mockResolvedValueOnce(null); // candidato com sufixo livre

    await provisionarEmpresaDoCheckout(sessionFake());

    const slugUsado = (criarEmpresaMock.mock.calls[0]?.[0] as any)?.slug as string;
    expect(slugUsado).not.toBe("acai-do-joao");
    expect(slugUsado).toMatch(/^acai-do-joao-[a-z0-9]{4}$/);
  });
});
