import { beforeEach, describe, expect, it, vi } from "vitest";

const { dbMock, stripeMock } = vi.hoisted(() => ({
  dbMock: {
    empresa: { findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn(), findFirst: vi.fn() },
  },
  stripeMock: {
    checkout: { sessions: { create: vi.fn(), retrieve: vi.fn() } },
    subscriptions: { retrieve: vi.fn() },
    customers: { create: vi.fn() },
    billingPortal: { sessions: { create: vi.fn() } },
  },
}));

vi.mock("@/lib/db", () => ({ db: dbMock }));
vi.mock("@/lib/stripe", () => ({ requireStripe: () => stripeMock, stripe: stripeMock }));
vi.mock("@/modules/billing/provisionamento", () => ({
  provisionarEmpresaDoCheckout: vi.fn().mockResolvedValue({ status: "criada", empresaId: "e1" }),
}));

import { provisionarEmpresaDoCheckout } from "@/modules/billing/provisionamento";
import { criarCheckoutPublicoLanding, processarEventoStripe } from "./service";
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
