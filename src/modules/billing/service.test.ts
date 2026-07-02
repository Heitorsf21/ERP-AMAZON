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

import { criarCheckoutPublicoLanding } from "./service";

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
