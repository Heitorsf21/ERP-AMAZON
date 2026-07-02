import { beforeEach, describe, expect, it, vi } from "vitest";

const { dbMock, stripeMock } = vi.hoisted(() => ({
  dbMock: {
    empresa: { findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn(), findFirst: vi.fn() },
  },
  stripeMock: {
    checkout: { sessions: { create: vi.fn(), retrieve: vi.fn() } },
    subscriptions: { retrieve: vi.fn(), create: vi.fn() },
    customers: { create: vi.fn(), retrieve: vi.fn() },
    billingPortal: { sessions: { create: vi.fn() } },
  },
}));

vi.mock("@/lib/db", () => ({ db: dbMock }));
vi.mock("@/lib/stripe", () => ({ requireStripe: () => stripeMock, stripe: stripeMock }));
vi.mock("@/modules/billing/provisionamento", () => ({
  provisionarEmpresaDoCheckout: vi.fn().mockResolvedValue({ status: "criada", empresaId: "e1" }),
  provisionarEmpresaDoCustomer: vi.fn().mockResolvedValue({ status: "criada", empresaId: "e1" }),
}));

import {
  provisionarEmpresaDoCheckout,
  provisionarEmpresaDoCustomer,
} from "@/modules/billing/provisionamento";
import {
  criarAssinaturaPublicaLanding,
  criarCheckoutPublicoLanding,
  processarEventoStripe,
} from "./service";
import type Stripe from "stripe";

describe("criarCheckoutPublicoLanding", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("STRIPE_PRICE_PRO_ANUAL", "price_pro_anual_test");
    vi.stubEnv("APP_URL", "https://erp.exemplo.com");
    stripeMock.checkout.sessions.create.mockResolvedValue({
      id: "cs_1",
      client_secret: "cs_secret_1",
    });
  });

  it("cria sessão embedded com metadata origem=landing e devolve client_secret", async () => {
    const secret = await criarCheckoutPublicoLanding({ planId: "pro", period: "anual" });

    expect(secret).toBe("cs_secret_1");
    const params = stripeMock.checkout.sessions.create.mock.calls[0]?.[0];
    expect(params.ui_mode).toBe("embedded_page");
    expect(params.mode).toBe("subscription");
    expect(params.line_items).toEqual([{ price: "price_pro_anual_test", quantity: 1 }]);
    expect(params.return_url).toBe(
      "https://erp.exemplo.com/ativar?session_id={CHECKOUT_SESSION_ID}",
    );
    expect(params.metadata).toEqual({ origem: "landing", plano: "pro", ciclo: "anual" });
    expect(params.subscription_data.metadata).toEqual({
      origem: "landing",
      plano: "pro",
      ciclo: "anual",
    });
    expect(params.custom_fields[0].key).toBe("nome_empresa");
    expect(params.customer).toBeUndefined();
  });

  it("falha claramente quando a sessão vem sem client_secret", async () => {
    stripeMock.checkout.sessions.create.mockResolvedValue({ id: "cs_1", client_secret: null });
    await expect(
      criarCheckoutPublicoLanding({ planId: "pro", period: "anual" }),
    ).rejects.toThrow("checkout sem client_secret");
  });
});

describe("criarAssinaturaPublicaLanding", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("STRIPE_PRICE_PRO_MENSAL", "price_pro_mensal_test");
    stripeMock.customers.create.mockResolvedValue({ id: "cus_9" });
    stripeMock.subscriptions.create.mockResolvedValue({
      id: "sub_9",
      latest_invoice: { confirmation_secret: { client_secret: "pi_secret_9", type: "payment_intent" } },
    });
  });

  it("cria customer BR + subscription incomplete e devolve o client_secret", async () => {
    const secret = await criarAssinaturaPublicaLanding({
      planId: "pro", period: "mensal",
      nome: "Maria Silva", email: "Maria@Exemplo.com",
      cpfCnpj: "12345678901", celular: "11999998888",
      nomeEmpresa: "Açaí do João",
    });

    expect(secret).toBe("pi_secret_9");
    const cust = stripeMock.customers.create.mock.calls[0]?.[0];
    expect(cust.email).toBe("maria@exemplo.com");
    expect(cust.phone).toBe("+5511999998888");
    expect(cust.tax_id_data).toEqual([{ type: "br_cpf", value: "12345678901" }]);
    expect(cust.metadata.nome_empresa).toBe("Açaí do João");
    expect(cust.metadata.origem).toBe("landing");

    const sub = stripeMock.subscriptions.create.mock.calls[0]?.[0];
    expect(sub.customer).toBe("cus_9");
    expect(sub.items).toEqual([{ price: "price_pro_mensal_test" }]);
    expect(sub.payment_behavior).toBe("default_incomplete");
    expect(sub.payment_settings).toEqual({ save_default_payment_method: "on_subscription" });
    expect(sub.expand).toEqual(["latest_invoice.confirmation_secret"]);
    expect(sub.metadata).toMatchObject({ origem: "landing", plano: "pro", ciclo: "mensal" });
  });

  it("usa br_cnpj para 14 dígitos e nome como fallback de nome_empresa", async () => {
    await criarAssinaturaPublicaLanding({
      planId: "pro", period: "mensal",
      nome: "Loja XPTO LTDA", email: "x@y.com",
      cpfCnpj: "12345678000199", celular: "1133334444",
    });
    const cust = stripeMock.customers.create.mock.calls[0]?.[0];
    expect(cust.tax_id_data).toEqual([{ type: "br_cnpj", value: "12345678000199" }]);
    expect(cust.metadata.nome_empresa).toBe("Loja XPTO LTDA");
  });

  it("falha claramente sem client_secret", async () => {
    stripeMock.subscriptions.create.mockResolvedValue({ id: "sub_9", latest_invoice: { confirmation_secret: null } });
    await expect(
      criarAssinaturaPublicaLanding({ planId: "pro", period: "mensal", nome: "A B", email: "a@b.com", cpfCnpj: "12345678901", celular: "11999998888" }),
    ).rejects.toThrow("assinatura sem client_secret");
  });

  it("remove o código do país duplicado quando o celular já vem com 55", async () => {
    await criarAssinaturaPublicaLanding({
      planId: "pro", period: "mensal",
      nome: "A B", email: "a@b.com",
      cpfCnpj: "12345678901", celular: "5511999998888",
    });
    const cust = stripeMock.customers.create.mock.calls[0]?.[0];
    expect(cust.phone).toBe("+5511999998888");
  });

  it("NÃO remove o 55 quando é DDD legítimo (11 dígitos ou menos)", async () => {
    await criarAssinaturaPublicaLanding({
      planId: "pro", period: "mensal",
      nome: "A B", email: "a@b.com",
      cpfCnpj: "12345678901", celular: "55999998888",
    });
    const cust = stripeMock.customers.create.mock.calls[0]?.[0];
    expect(cust.phone).toBe("+5555999998888");
  });
});

describe("processarEventoStripe / checkout.session.completed", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stripeMock.subscriptions.retrieve.mockResolvedValue({
      id: "sub_1",
      customer: "cus_1",
      status: "active",
      items: { data: [{ price: { id: "price_1" } }] },
      metadata: { plano: "pro", ciclo: "anual", empresaId: "" },
    });
    dbMock.empresa.updateMany.mockResolvedValue({ count: 1 });
  });

  function evento(metadata: Record<string, string>): Stripe.Event {
    return {
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_1",
          customer: "cus_1",
          subscription: "sub_1",
          metadata,
          customer_details: { email: "a@b.com", name: "A" },
          custom_fields: [],
        },
      },
    } as unknown as Stripe.Event;
  }

  it("provisiona empresa quando a sessão veio da landing", async () => {
    await processarEventoStripe(evento({ origem: "landing", plano: "pro", ciclo: "anual" }));
    expect(provisionarEmpresaDoCheckout).toHaveBeenCalledTimes(1);
    expect(dbMock.empresa.updateMany).toHaveBeenCalled(); // aplicarAssinaturaStripe rodou depois
  });

  it("NÃO provisiona para checkout do fluxo logado (sem origem landing)", async () => {
    await processarEventoStripe(evento({ empresaId: "emp_1", plano: "pro", ciclo: "anual" }));
    expect(provisionarEmpresaDoCheckout).not.toHaveBeenCalled();
    expect(dbMock.empresa.updateMany).toHaveBeenCalled();
  });
});

describe("processarEventoStripe / invoice.paid", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbMock.empresa.updateMany.mockResolvedValue({ count: 1 });
  });

  function eventoInvoicePaid(subscriptionId: string | null = "sub_1"): Stripe.Event {
    return {
      type: "invoice.paid",
      data: {
        object: {
          id: "in_1",
          parent: {
            subscription_details: {
              subscription: subscriptionId,
            },
          },
        },
      },
    } as unknown as Stripe.Event;
  }

  it("provisiona empresa via customer ANTES de aplicar a assinatura quando veio da landing (fluxo Elements)", async () => {
    stripeMock.subscriptions.retrieve.mockResolvedValue({
      id: "sub_1",
      customer: "cus_1",
      status: "active",
      items: { data: [{ price: { id: "price_1" } }] },
      metadata: { origem: "landing", plano: "pro", ciclo: "mensal" },
    });
    stripeMock.customers.retrieve.mockResolvedValue({ id: "cus_1", email: "a@b.com" });

    await processarEventoStripe(eventoInvoicePaid());

    expect(stripeMock.customers.retrieve).toHaveBeenCalledWith("cus_1");
    expect(provisionarEmpresaDoCustomer).toHaveBeenCalledWith({ id: "cus_1", email: "a@b.com" });

    const ordemProvisionar = (provisionarEmpresaDoCustomer as any).mock.invocationCallOrder[0] as number;
    const ordemUpdateMany = dbMock.empresa.updateMany.mock.invocationCallOrder[0] as number;
    expect(ordemProvisionar).toBeLessThan(ordemUpdateMany);
  });

  it("NÃO provisiona quando a assinatura não veio da landing", async () => {
    stripeMock.subscriptions.retrieve.mockResolvedValue({
      id: "sub_1",
      customer: "cus_1",
      status: "active",
      items: { data: [{ price: { id: "price_1" } }] },
      metadata: { empresaId: "emp_1", plano: "pro", ciclo: "mensal" },
    });

    await processarEventoStripe(eventoInvoicePaid());

    expect(provisionarEmpresaDoCustomer).not.toHaveBeenCalled();
    expect(stripeMock.customers.retrieve).not.toHaveBeenCalled();
    expect(dbMock.empresa.updateMany).toHaveBeenCalled();
  });

  it("aplica a assinatura via fallback legado quando a invoice não tem parent.subscription_details (evento antigo re-entregue)", async () => {
    stripeMock.subscriptions.retrieve.mockResolvedValue({
      id: "sub_1",
      customer: "cus_1",
      status: "active",
      items: { data: [{ price: { id: "price_1" } }] },
      metadata: { empresaId: "emp_1", plano: "pro", ciclo: "mensal" },
    });

    const eventoLegado = {
      type: "invoice.paid",
      data: {
        object: {
          id: "in_1",
          subscription: "sub_1",
        },
      },
    } as unknown as Stripe.Event;

    await processarEventoStripe(eventoLegado);

    expect(stripeMock.subscriptions.retrieve).toHaveBeenCalledWith("sub_1");
    expect(dbMock.empresa.updateMany).toHaveBeenCalled();
  });
});
