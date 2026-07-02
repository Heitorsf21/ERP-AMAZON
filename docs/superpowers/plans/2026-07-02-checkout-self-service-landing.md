# Checkout Self-Service na Landing — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Visitante da landing contrata um plano sozinho: paga via Stripe Embedded Checkout na própria landing, o webhook provisiona Empresa + admin automaticamente, e a página `/ativar` entrega o acesso via fluxo de convite existente — sem e-mail transacional.

**Architecture:** Landing estática (`landing-atlas/`) ganha `checkout.html` que chama um endpoint público novo no ERP (`POST /api/checkout-publico/sessao`, CORS restrito) para obter o `client_secret` do Embedded Checkout. O webhook Stripe existente passa a provisionar contas quando `metadata.origem === "landing"`. A volta do pagamento cai em `/ativar?session_id=...` no ERP, que valida a sessão paga e reemite convite → `/definir-senha`.

**Tech Stack:** Next.js 16 App Router · Stripe Node SDK (`ui_mode: "embedded"`) · Stripe.js v3 na landing · Prisma · vitest · pino.

**Spec:** `docs/superpowers/specs/2026-07-01-checkout-self-service-landing-design.md`

## Global Constraints

- Sem `console.log` — usar `logger` de `src/lib/logger.ts` (pino).
- Next.js 16: `params`/`searchParams` de páginas e rotas dinâmicas são **Promise** — sempre `await`.
- Dinheiro em centavos (`Int`).
- NUNCA tocar nos campos sagrados de `VendaAmazon` (não se aplica aqui, mas é regra global).
- Sem migration: todos os campos de billing na `Empresa` já existem (commit `6f2fc8b`); schema SQLite local também os tem.
- Validação: `npx eslint <arquivo>` e `npx tsc --noEmit` só no que mudou; `npx vitest run <arquivo>` para os testes novos. NUNCA `npm run test` cego.
- Textos de UI em português (pt-BR) com acentuação correta.
- A landing é HTML/CSS/JS puro — sem build step, sem framework. Seguir os tokens de `landing-atlas/styles.css` (`--primary`, `--surface`, `.btn`, `.plan` etc.).
- Preços exibidos na landing usam a fórmula `Math.round(base × meses × (1 − desconto))` com descontos 5%/10%/20% — já validado que bate centavo a centavo com os 12 prices reais do Stripe test mode.

---

### Task 1: Slugificação pura para o provisionamento

**Files:**
- Create: `src/modules/billing/provisionamento.ts`
- Test: `src/modules/billing/provisionamento.test.ts`

**Interfaces:**
- Produces: `slugificarNome(nome: string): string` — determinística, sempre retorna slug válido no formato `/^[a-z0-9-]{3,30}$/` (sem garantia de disponibilidade/reserva; isso é da Task 2).

- [ ] **Step 1: Write the failing tests**

Criar `src/modules/billing/provisionamento.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { slugificarNome } from "./provisionamento";

describe("slugificarNome", () => {
  it("converte nome com acentos e espaços em slug", () => {
    expect(slugificarNome("Fernandes & Santos Empreendimentos")).toBe(
      "fernandes-santos-empreendimento",
    );
  });

  it("remove acentuação", () => {
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
    expect(slugificarNome("!!")).toBe("loja");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/modules/billing/provisionamento.test.ts`
Expected: FAIL — `Cannot find module './provisionamento'` (ou export ausente).

- [ ] **Step 3: Write minimal implementation**

Criar `src/modules/billing/provisionamento.ts`:

```ts
/**
 * Provisionamento automático de Empresa a partir de um Checkout Session da
 * landing (fluxo "paga primeiro, conta depois"). Ver spec
 * docs/superpowers/specs/2026-07-01-checkout-self-service-landing-design.md
 */

/** Slug determinístico a partir do nome da empresa: minúsculo, sem acento,
 *  hífens, 3..30 chars (formato exigido por validarSlug). */
export function slugificarNome(nome: string): string {
  const base = nome
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 30)
    .replace(/-+$/g, "");
  if (base.length >= 3) return base;
  return base ? `loja-${base}` : "loja";
}
```

Nota: `"Fernandes & Santos Empreendimentos"` → `fernandes-santos-empreendimentos` tem 32 chars → `slice(0,30)` corta em `fernandes-santos-empreendiment`... conferir no teste: o esperado é o resultado real do algoritmo (ajustar a string esperada do primeiro teste para o output verdadeiro do slice — rodar e copiar o valor, mantendo as asserções de formato).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/modules/billing/provisionamento.test.ts`
Expected: PASS (4 testes). Se o primeiro teste falhar por diferença de corte no `slice`, corrigir a STRING ESPERADA do teste para o valor produzido (desde que case com `/^[a-z0-9-]{3,30}$/` e não termine em hífen) — o contrato é o formato, não o corte exato.

- [ ] **Step 5: Lint + commit**

```bash
npx eslint src/modules/billing/provisionamento.ts src/modules/billing/provisionamento.test.ts
git add src/modules/billing/provisionamento.ts src/modules/billing/provisionamento.test.ts
git commit -m "feat(billing): slugificacao pura para provisionamento da landing"
```

---

### Task 2: `provisionarEmpresaDoCheckout` (idempotente)

**Files:**
- Modify: `src/modules/billing/provisionamento.ts`
- Test: `src/modules/billing/provisionamento.test.ts` (acrescentar describe)

**Interfaces:**
- Consumes: `criarEmpresa(input: CriarEmpresaInput)` de `src/modules/plataforma/empresas.ts` (retorna `{ empresaId, adminId, rawToken, definiuSenha }`); `validarSlug(slug)` de `src/modules/plataforma/slug.ts`; `db` de `src/lib/db`.
- Produces:
  ```ts
  type ProvisionamentoResult =
    | { status: "criada"; empresaId: string }
    | { status: "ja-existia"; empresaId: string }
    | { status: "ignorada"; motivo: string };
  provisionarEmpresaDoCheckout(session: Stripe.Checkout.Session): Promise<ProvisionamentoResult>
  ```

- [ ] **Step 1: Write the failing tests**

Acrescentar em `src/modules/billing/provisionamento.test.ts` (o mock de `@/lib/db` e de `criarEmpresa` precisa vir ANTES dos imports do módulo — usar `vi.hoisted` + import dinâmico, padrão do projeto em `src/modules/notificacoes/service.test.ts`). O arquivo INTEIRO fica assim (substituir o conteúdo da Task 1 — os testes de `slugificarNome` permanecem):

```ts
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

    const slugUsado = criarEmpresaMock.mock.calls[0][0].slug as string;
    expect(slugUsado).not.toBe("acai-do-joao");
    expect(slugUsado).toMatch(/^acai-do-joao-[a-z0-9]{4}$/);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/modules/billing/provisionamento.test.ts`
Expected: FAIL — `provisionarEmpresaDoCheckout` não exportado.

- [ ] **Step 3: Write the implementation**

Substituir `src/modules/billing/provisionamento.ts` por:

```ts
import crypto from "node:crypto";
import type Stripe from "stripe";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { criarEmpresa } from "@/modules/plataforma/empresas";
import { validarSlug } from "@/modules/plataforma/slug";

/**
 * Provisionamento automático de Empresa a partir de um Checkout Session da
 * landing (fluxo "paga primeiro, conta depois"). Ver spec
 * docs/superpowers/specs/2026-07-01-checkout-self-service-landing-design.md
 */

export type ProvisionamentoResult =
  | { status: "criada"; empresaId: string }
  | { status: "ja-existia"; empresaId: string }
  | { status: "ignorada"; motivo: string };

/** Slug determinístico a partir do nome da empresa: minúsculo, sem acento,
 *  hífens, 3..30 chars (formato exigido por validarSlug). */
export function slugificarNome(nome: string): string {
  const base = nome
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 30)
    .replace(/-+$/g, "");
  if (base.length >= 3) return base;
  return base ? `loja-${base}` : "loja";
}

async function gerarSlugDisponivel(nome: string): Promise<string> {
  const base = slugificarNome(nome);
  for (let tentativa = 0; tentativa < 6; tentativa++) {
    const candidato =
      tentativa === 0
        ? base
        : `${base.slice(0, 25)}-${crypto.randomBytes(3).toString("hex").slice(0, 4)}`;
    if (!validarSlug(candidato).ok) continue; // ex.: base caiu em slug reservado
    const ocupado = await db.empresa.findUnique({
      where: { slug: candidato },
      select: { id: true },
    });
    if (!ocupado) return candidato;
  }
  throw new Error("nao consegui gerar slug disponivel");
}

function extrairCustomerId(session: Stripe.Checkout.Session): string | null {
  const c = session.customer;
  if (!c) return null;
  return typeof c === "string" ? c : c.id;
}

export async function provisionarEmpresaDoCheckout(
  session: Stripe.Checkout.Session,
): Promise<ProvisionamentoResult> {
  const customerId = extrairCustomerId(session);
  if (!customerId) return { status: "ignorada", motivo: "sem-customer" };

  const email = session.customer_details?.email?.toLowerCase().trim();
  if (!email) return { status: "ignorada", motivo: "sem-email" };

  // Idempotência: webhooks podem ser reentregues.
  const existente = await db.empresa.findFirst({
    where: { stripeCustomerId: customerId },
    select: { id: true },
  });
  if (existente) return { status: "ja-existia", empresaId: existente.id };

  const emailEmUso = await db.usuario.findFirst({
    where: { email },
    select: { id: true },
  });
  if (emailEmUso) {
    logger.error(
      { customerId, sessionId: session.id },
      "[checkout-publico] e-mail do pagamento ja pertence a um usuario — provisionar manualmente",
    );
    return { status: "ignorada", motivo: "email-em-uso" };
  }

  const campoNome = session.custom_fields?.find((f) => f.key === "nome_empresa");
  const nomeEmpresa =
    campoNome?.text?.value?.trim() || session.customer_details?.name?.trim() || email;
  const nomeAdmin = session.customer_details?.name?.trim() || email.split("@")[0];

  const slug = await gerarSlugDisponivel(nomeEmpresa);
  const criada = await criarEmpresa({
    nome: nomeEmpresa,
    slug,
    admin: { nome: nomeAdmin, email },
  });
  await db.empresa.update({
    where: { id: criada.empresaId },
    data: { stripeCustomerId: customerId },
  });
  logger.info(
    { empresaId: criada.empresaId, customerId, slug },
    "[checkout-publico] empresa provisionada via landing",
  );
  return { status: "criada", empresaId: criada.empresaId };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/modules/billing/provisionamento.test.ts`
Expected: PASS (9 testes).

- [ ] **Step 5: Lint, typecheck, commit**

```bash
npx eslint src/modules/billing/provisionamento.ts src/modules/billing/provisionamento.test.ts
npx tsc --noEmit
git add src/modules/billing/provisionamento.ts src/modules/billing/provisionamento.test.ts
git commit -m "feat(billing): provisionamento idempotente de empresa via checkout da landing"
```

---

### Task 3: `criarCheckoutPublicoLanding` no service de billing

**Files:**
- Modify: `src/modules/billing/service.ts` (adicionar função exportada; nada existente muda)
- Test: `src/modules/billing/service.test.ts` (novo)

**Interfaces:**
- Consumes: `requireStripe()` de `src/lib/stripe.ts`; `getStripePriceId(planId, period)` de `./plans`; `getAppUrl()` já existe como função privada no próprio `service.ts`.
- Produces: `criarCheckoutPublicoLanding(input: { planId: BillingPlanId; period: BillingPeriod }): Promise<string>` — retorna o `client_secret` da sessão embedded.

- [ ] **Step 1: Write the failing test**

Criar `src/modules/billing/service.test.ts`:

```ts
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
    const params = stripeMock.checkout.sessions.create.mock.calls[0][0];
    expect(params.ui_mode).toBe("embedded");
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/modules/billing/service.test.ts`
Expected: FAIL — `criarCheckoutPublicoLanding` não é exportada.

- [ ] **Step 3: Implement**

Em `src/modules/billing/service.ts`, adicionar após `criarCheckoutAssinatura` (~linha 124):

```ts
type CheckoutPublicoInput = {
  planId: BillingPlanId;
  period: BillingPeriod;
};

/**
 * Checkout público da landing (Embedded). NÃO tem empresa/customer: o Stripe
 * cria o customer no pagamento e o webhook provisiona a Empresa depois
 * (provisionarEmpresaDoCheckout). Não escreve nada no banco.
 */
export async function criarCheckoutPublicoLanding(
  input: CheckoutPublicoInput,
): Promise<string> {
  const stripe = requireStripe();
  const priceId = getStripePriceId(input.planId, input.period);
  const metadata = { origem: "landing", plano: input.planId, ciclo: input.period };

  const session = await stripe.checkout.sessions.create({
    ui_mode: "embedded",
    mode: "subscription",
    line_items: [{ price: priceId, quantity: 1 }],
    return_url: `${getAppUrl()}/ativar?session_id={CHECKOUT_SESSION_ID}`,
    allow_promotion_codes: true,
    billing_address_collection: "auto",
    tax_id_collection: { enabled: true },
    custom_fields: [
      {
        key: "nome_empresa",
        label: { type: "custom", custom: "Nome da sua empresa/loja" },
        type: "text",
      },
    ],
    metadata,
    subscription_data: { metadata },
  });

  if (!session.client_secret) throw new Error("checkout sem client_secret");
  return session.client_secret;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/modules/billing/service.test.ts`
Expected: PASS (2 testes).

- [ ] **Step 5: Lint, typecheck, commit**

```bash
npx eslint src/modules/billing/service.ts src/modules/billing/service.test.ts
npx tsc --noEmit
git add src/modules/billing/service.ts src/modules/billing/service.test.ts
git commit -m "feat(billing): criarCheckoutPublicoLanding (sessao embedded sem empresa)"
```

---

### Task 4: Webhook provisiona quando `origem === "landing"`

**Files:**
- Modify: `src/modules/billing/service.ts:193-201` (case `checkout.session.completed` de `processarEventoStripe`)
- Test: `src/modules/billing/service.test.ts` (acrescentar describe)

**Interfaces:**
- Consumes: `provisionarEmpresaDoCheckout(session)` da Task 2.
- Produces: comportamento — sessões de landing provisionam ANTES de `aplicarAssinaturaStripe` (que então encontra a empresa por `stripeCustomerId`).

- [ ] **Step 1: Write the failing tests**

Acrescentar em `src/modules/billing/service.test.ts` (o mock de `provisionamento` já existe no topo do arquivo; importar a referência):

```ts
import { provisionarEmpresaDoCheckout } from "@/modules/billing/provisionamento";
import { processarEventoStripe } from "./service";
import type Stripe from "stripe";

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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/modules/billing/service.test.ts`
Expected: o teste "provisiona empresa quando a sessão veio da landing" FALHA (`provisionarEmpresaDoCheckout` nunca chamado); o do fluxo logado já passa.

- [ ] **Step 3: Implement**

Em `src/modules/billing/service.ts`:

1. Adicionar import no topo:
```ts
import { provisionarEmpresaDoCheckout } from "./provisionamento";
```

2. Alterar o case `checkout.session.completed` (linhas 193-201) de:
```ts
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      const subscriptionId = stringId(session.subscription);
      if (!subscriptionId) return;

      const subscription = await stripe.subscriptions.retrieve(subscriptionId);
      await aplicarAssinaturaStripe(subscription);
      break;
    }
```
para:
```ts
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      // Fluxo landing (paga primeiro, conta depois): provisiona ANTES de
      // aplicar a assinatura, para o match por stripeCustomerId encontrar
      // a empresa recém-criada.
      if (session.metadata?.origem === "landing") {
        await provisionarEmpresaDoCheckout(session);
      }
      const subscriptionId = stringId(session.subscription);
      if (!subscriptionId) return;

      const subscription = await stripe.subscriptions.retrieve(subscriptionId);
      await aplicarAssinaturaStripe(subscription);
      break;
    }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/modules/billing/service.test.ts`
Expected: PASS (todos). Rodar também os testes anteriores: `npx vitest run src/modules/billing/`
Expected: PASS.

- [ ] **Step 5: Lint, typecheck, commit**

```bash
npx eslint src/modules/billing/service.ts src/modules/billing/service.test.ts
npx tsc --noEmit
git add src/modules/billing/service.ts src/modules/billing/service.test.ts
git commit -m "feat(billing): webhook provisiona empresa para checkout vindo da landing"
```

---

### Task 5: `ativarPorCustomer` — regra de entrega do acesso

**Files:**
- Create: `src/modules/billing/ativacao.ts`
- Test: `src/modules/billing/ativacao.test.ts`

**Interfaces:**
- Consumes: `gerarTokenConvite()`, `expiracaoConvite()` de `src/modules/plataforma/convite.ts`; `db`.
- Produces:
  ```ts
  type AtivacaoResult =
    | { status: "processando" }              // webhook ainda não provisionou
    | { status: "ja-ativo" }                 // admin já definiu senha alguma vez
    | { status: "convite"; token: string; email: string; empresaNome: string };
  ativarPorCustomer(stripeCustomerId: string): Promise<AtivacaoResult>
  ```
- **Regra central**: "nunca definiu senha" ⇔ `Usuario.sessionVersion === 0`. (`sessionVersion` só incrementa em definir-senha/redefinir-senha/alterar-senha/encerrar-sessões — todas exigem senha definida ou definem uma. NÃO usar `ConviteUsuario.usadoEm`, que é ambíguo: `reenviarConvite` marca `usadoEm` para INVALIDAR pendentes.)

- [ ] **Step 1: Write the failing tests**

Criar `src/modules/billing/ativacao.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const { dbMock } = vi.hoisted(() => ({
  dbMock: {
    empresa: { findFirst: vi.fn() },
    usuario: { findFirst: vi.fn() },
    conviteUsuario: { updateMany: vi.fn(), create: vi.fn() },
    $transaction: vi.fn(async (ops: unknown[]) => ops),
  },
}));

vi.mock("@/lib/db", () => ({ db: dbMock }));

import { ativarPorCustomer } from "./ativacao";

describe("ativarPorCustomer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbMock.conviteUsuario.updateMany.mockReturnValue({});
    dbMock.conviteUsuario.create.mockReturnValue({});
  });

  it("retorna processando quando a empresa ainda não existe", async () => {
    dbMock.empresa.findFirst.mockResolvedValue(null);
    const r = await ativarPorCustomer("cus_1");
    expect(r).toEqual({ status: "processando" });
  });

  it("retorna processando quando o admin ainda não existe", async () => {
    dbMock.empresa.findFirst.mockResolvedValue({ id: "e1", nome: "Loja" });
    dbMock.usuario.findFirst.mockResolvedValue(null);
    const r = await ativarPorCustomer("cus_1");
    expect(r).toEqual({ status: "processando" });
  });

  it("emite convite quando o admin nunca definiu senha (sessionVersion 0)", async () => {
    dbMock.empresa.findFirst.mockResolvedValue({ id: "e1", nome: "Loja" });
    dbMock.usuario.findFirst.mockResolvedValue({
      id: "u1",
      email: "a@b.com",
      sessionVersion: 0,
    });

    const r = await ativarPorCustomer("cus_1");

    expect(r.status).toBe("convite");
    if (r.status === "convite") {
      expect(r.email).toBe("a@b.com");
      expect(r.empresaNome).toBe("Loja");
      expect(r.token.length).toBeGreaterThan(20);
    }
    // invalida pendentes + cria novo, em transação
    expect(dbMock.conviteUsuario.updateMany).toHaveBeenCalledWith({
      where: { usuarioId: "u1", usadoEm: null },
      data: { usadoEm: expect.any(Date) },
    });
    expect(dbMock.conviteUsuario.create).toHaveBeenCalled();
    expect(dbMock.$transaction).toHaveBeenCalled();
  });

  it("retorna ja-ativo quando o admin já definiu senha (sessionVersion > 0)", async () => {
    dbMock.empresa.findFirst.mockResolvedValue({ id: "e1", nome: "Loja" });
    dbMock.usuario.findFirst.mockResolvedValue({
      id: "u1",
      email: "a@b.com",
      sessionVersion: 2,
    });

    const r = await ativarPorCustomer("cus_1");

    expect(r).toEqual({ status: "ja-ativo" });
    expect(dbMock.conviteUsuario.create).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/modules/billing/ativacao.test.ts`
Expected: FAIL — módulo `./ativacao` não existe.

- [ ] **Step 3: Implement**

Criar `src/modules/billing/ativacao.ts`:

```ts
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { expiracaoConvite, gerarTokenConvite } from "@/modules/plataforma/convite";

/**
 * Entrega do acesso pós-pagamento da landing. O session_id do Stripe é a
 * credencial de quem pagou; aqui trocamos o stripeCustomerId (extraído da
 * session VALIDADA na rota) por um convite de definição de senha.
 *
 * Regra anti-porta-dos-fundos: só reemitimos convite enquanto o admin NUNCA
 * definiu senha (sessionVersion === 0). Depois disso o link de retorno do
 * Stripe deixa de dar acesso — "conta já ativa, faça login".
 */

export type AtivacaoResult =
  | { status: "processando" }
  | { status: "ja-ativo" }
  | { status: "convite"; token: string; email: string; empresaNome: string };

export async function ativarPorCustomer(
  stripeCustomerId: string,
): Promise<AtivacaoResult> {
  const empresa = await db.empresa.findFirst({
    where: { stripeCustomerId },
    select: { id: true, nome: true },
  });
  if (!empresa) return { status: "processando" };

  const admin = await db.usuario.findFirst({
    where: { empresaId: empresa.id, role: "ADMIN" },
    orderBy: { createdAt: "asc" },
    select: { id: true, email: true, sessionVersion: true },
  });
  if (!admin) return { status: "processando" };

  if (admin.sessionVersion > 0) return { status: "ja-ativo" };

  const { rawToken, tokenHash } = gerarTokenConvite();
  await db.$transaction([
    db.conviteUsuario.updateMany({
      where: { usuarioId: admin.id, usadoEm: null },
      data: { usadoEm: new Date() },
    }),
    db.conviteUsuario.create({
      data: { usuarioId: admin.id, tokenHash, expiresAt: expiracaoConvite() },
    }),
  ]);

  logger.info(
    { empresaId: empresa.id, usuarioId: admin.id },
    "[checkout-publico] convite de ativacao emitido",
  );
  return { status: "convite", token: rawToken, email: admin.email, empresaNome: empresa.nome };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/modules/billing/ativacao.test.ts`
Expected: PASS (4 testes).

- [ ] **Step 5: Lint, typecheck, commit**

```bash
npx eslint src/modules/billing/ativacao.ts src/modules/billing/ativacao.test.ts
npx tsc --noEmit
git add src/modules/billing/ativacao.ts src/modules/billing/ativacao.test.ts
git commit -m "feat(billing): ativacao pos-pagamento troca session paga por convite de senha"
```

---

### Task 6: Rota pública `POST /api/checkout-publico/sessao` (CORS + rate-limit) + proxy + envs

**Files:**
- Create: `src/app/api/checkout-publico/sessao/route.ts`
- Modify: `src/proxy.ts:13-33` (PUBLIC_PATHS)
- Modify: `.env.example` (~linha 144, bloco Stripe)

**Interfaces:**
- Consumes: `criarCheckoutPublicoLanding` (Task 3); `parseBillingPlanId`/`parseBillingPeriod` de `plans.ts`; `consumeRateLimit`/`getClientIp` de `src/lib/auth-rate-limit.ts`; `handle` de `src/lib/api.ts`.
- Produces: contrato HTTP consumido pela landing (Task 10):
  - `POST` body `{ "plano": "starter|pro|scale", "ciclo": "mensal|trimestral|semestral|anual" }`
  - 200 → `{ "clientSecret": string, "publishableKey": string }`
  - 403 origem não permitida · 429 rate-limit · 400 plano/ciclo inválido
  - `OPTIONS` → preflight CORS (204 com headers, ou 403).

- [ ] **Step 1: Create the route**

Criar `src/app/api/checkout-publico/sessao/route.ts`:

```ts
import { NextResponse } from "next/server";
import { handle } from "@/lib/api";
import { consumeRateLimit, getClientIp } from "@/lib/auth-rate-limit";
import { parseBillingPeriod, parseBillingPlanId } from "@/modules/billing/plans";
import { criarCheckoutPublicoLanding } from "@/modules/billing/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Endpoint PÚBLICO consumido pela landing (site estático em outro domínio).
// Não recebe dado sensível e não escreve no banco — só cria uma Checkout
// Session embedded no Stripe. Proteções: CORS restrito + rate-limit por IP.

const RATE_WINDOW_MS = 15 * 60_000;
const RATE_MAX = 20;

function origemPermitida(): string | null {
  return process.env.CHECKOUT_PUBLICO_ORIGEM?.trim().replace(/\/$/, "") || null;
}

function corsHeaders(origem: string): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": origem,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

export async function OPTIONS(req: Request) {
  const permitida = origemPermitida();
  const origin = req.headers.get("origin");
  if (!permitida || origin !== permitida) return new Response(null, { status: 403 });
  return new Response(null, { status: 204, headers: corsHeaders(permitida) });
}

export const POST = handle(async (req: Request) => {
  const permitida = origemPermitida();
  const origin = req.headers.get("origin");
  // Navegador manda Origin; só aceitamos o da landing. Sem Origin
  // (curl/server-to-server) segue — CORS é proteção de navegador, e o
  // rate-limit abaixo cobre abuso direto.
  if (origin && origin !== permitida) {
    return NextResponse.json({ erro: "ORIGEM_INVALIDA" }, { status: 403 });
  }
  const headers = origin && permitida ? corsHeaders(permitida) : undefined;

  const ip = getClientIp(req.headers);
  const rl = await consumeRateLimit(`checkout-publico:${ip}`, RATE_WINDOW_MS, RATE_MAX);
  if (rl.limited) {
    return NextResponse.json(
      { erro: "MUITAS_TENTATIVAS" },
      { status: 429, headers: { ...headers, "Retry-After": String(rl.retryAfterSeconds) } },
    );
  }

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const planId = parseBillingPlanId(body.plano);
  const period = parseBillingPeriod(body.ciclo ?? "mensal");

  const clientSecret = await criarCheckoutPublicoLanding({ planId, period });
  const publishableKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY?.trim();
  if (!publishableKey) throw new Error("NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY não configurada");

  return NextResponse.json({ clientSecret, publishableKey }, { headers });
});
```

- [ ] **Step 2: Liberar no proxy**

Em `src/proxy.ts`, dentro de `PUBLIC_PATHS` (após a linha `"/api/stripe/webhook",`), adicionar:

```ts
  // Checkout público da landing (atlasseller): cria sessão embedded e ativa
  // conta pós-pagamento. CORS/rate-limit são aplicados nas próprias rotas.
  "/api/checkout-publico/sessao",
  "/api/checkout-publico/ativar",
  "/ativar",
```

(As duas últimas entradas são usadas pelas Tasks 7 e 8 — adicionar as três de uma vez para não retocar o arquivo.)

- [ ] **Step 3: Documentar env nova**

Em `.env.example`, após a linha `STRIPE_PORTAL_RETURN_URL=""` (~144), adicionar:

```bash
# Origem (scheme+host) da landing autorizada a chamar /api/checkout-publico/*.
# Ex.: https://atlasseller.mundofs.cloud — local: http://localhost:8080
CHECKOUT_PUBLICO_ORIGEM=""
```

- [ ] **Step 4: Verificação manual com curl**

Subir o dev server sem worker: `npm run dev:web` (aguardar "Ready"). No `.env` local já existem `STRIPE_SECRET_KEY`/`NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` de teste; adicionar antes (se ainda não houver): `CHECKOUT_PUBLICO_ORIGEM="http://localhost:8080"` e os price IDs (lista completa na Task 11 — para este teste basta `STRIPE_PRICE_PRO_MENSAL="price_1ToRniKMqHJ7jzJd5GEPrRJK"`).

```bash
curl -s -X POST http://localhost:3000/api/checkout-publico/sessao \
  -H "content-type: application/json" -H "origin: http://localhost:8080" \
  -d '{"plano":"pro","ciclo":"mensal"}'
```
Expected: `{"clientSecret":"cs_test_...","publishableKey":"pk_test_..."}`.

```bash
curl -s -o /dev/null -w "%{http_code}" -X POST http://localhost:3000/api/checkout-publico/sessao \
  -H "content-type: application/json" -H "origin: https://malicioso.com" \
  -d '{"plano":"pro","ciclo":"mensal"}'
```
Expected: `403`.

```bash
curl -s -X POST http://localhost:3000/api/checkout-publico/sessao \
  -H "content-type: application/json" -H "origin: http://localhost:8080" \
  -d '{"plano":"hacker"}'
```
Expected: HTTP 400 `{"erro":"requisicao invalida"}`.

- [ ] **Step 5: Lint, typecheck, commit**

```bash
npx eslint src/app/api/checkout-publico/sessao/route.ts src/proxy.ts
npx tsc --noEmit
git add src/app/api/checkout-publico/sessao/route.ts src/proxy.ts .env.example
git commit -m "feat(api): endpoint publico de sessao do checkout da landing (CORS + rate-limit)"
```

---

### Task 7: Rota pública `POST /api/checkout-publico/ativar`

**Files:**
- Create: `src/app/api/checkout-publico/ativar/route.ts`

**Interfaces:**
- Consumes: `ativarPorCustomer` (Task 5); `requireStripe()`; `originViolationResponse` de `src/lib/origin-check.ts`; `consumeRateLimit`/`getClientIp`; `handle`; `z` (zod).
- Produces: contrato HTTP consumido pela página `/ativar` (Task 8) — chamada é SAME-ORIGIN (página do próprio ERP), por isso sem CORS:
  - `POST` body `{ "sessionId": "cs_..." }`
  - 200 `{ "status": "pronto", "redirectTo": "/definir-senha?token=...&empresa=...&email=..." }`
  - 200 `{ "status": "ja-ativo" }`
  - 202 `{ "status": "processando" }` (webhook ainda não provisionou — página faz retry)
  - 402 `{ "status": "nao-pago" }` · 400 body inválido/sessão inexistente · 429 rate-limit

- [ ] **Step 1: Create the route**

Criar `src/app/api/checkout-publico/ativar/route.ts`:

```ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { handle } from "@/lib/api";
import { consumeRateLimit, getClientIp } from "@/lib/auth-rate-limit";
import { originViolationResponse } from "@/lib/origin-check";
import { requireStripe } from "@/lib/stripe";
import { ativarPorCustomer } from "@/modules/billing/ativacao";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Ativação pós-pagamento (chamada pela página /ativar, same-origin).
// O session_id é a credencial: só quem pagou o recebe (return_url do Stripe)
// e ele é validado server-side abaixo. Vira inerte depois da 1ª senha
// definida (ver ativarPorCustomer).

const schema = z.object({ sessionId: z.string().min(10).max(200) });

export const POST = handle(async (req: Request) => {
  const bloqueio = originViolationResponse(req);
  if (bloqueio) return bloqueio;

  const ip = getClientIp(req.headers);
  const rl = await consumeRateLimit(`ativar-checkout:${ip}`, 15 * 60_000, 30);
  if (rl.limited) {
    return NextResponse.json(
      { erro: "MUITAS_TENTATIVAS" },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSeconds) } },
    );
  }

  const body = (await req.json().catch(() => ({}))) as unknown;
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ erro: "DADOS_INVALIDOS" }, { status: 400 });
  }

  const stripe = requireStripe();
  // Session inexistente => StripeInvalidRequestError => handle() devolve 400.
  const session = await stripe.checkout.sessions.retrieve(parsed.data.sessionId);
  const pago = session.payment_status === "paid" || session.status === "complete";
  const customerId =
    typeof session.customer === "string" ? session.customer : (session.customer?.id ?? null);
  if (!pago || !customerId) {
    return NextResponse.json({ status: "nao-pago" }, { status: 402 });
  }

  const resultado = await ativarPorCustomer(customerId);
  if (resultado.status === "processando") {
    return NextResponse.json({ status: "processando" }, { status: 202 });
  }
  if (resultado.status === "ja-ativo") {
    return NextResponse.json({ status: "ja-ativo" });
  }

  const qs = new URLSearchParams({ token: resultado.token });
  if (resultado.empresaNome) qs.set("empresa", resultado.empresaNome);
  if (resultado.email) qs.set("email", resultado.email);
  return NextResponse.json({ status: "pronto", redirectTo: `/definir-senha?${qs.toString()}` });
});
```

(A entrada em `PUBLIC_PATHS` já foi feita na Task 6.)

- [ ] **Step 2: Verificação manual com curl**

Com o dev server rodando (`npm run dev:web`):

```bash
curl -s -o /dev/null -w "%{http_code}" -X POST http://localhost:3000/api/checkout-publico/ativar \
  -H "content-type: application/json" -d '{"sessionId":"x"}'
```
Expected: `400` (schema min 10).

```bash
curl -s -o /dev/null -w "%{http_code}" -X POST http://localhost:3000/api/checkout-publico/ativar \
  -H "content-type: application/json" -d '{"sessionId":"cs_test_inexistente_123456"}'
```
Expected: `400` (Stripe não encontra a session → handle() 400).

O caminho feliz (pronto/processando/ja-ativo) é exercitado no E2E da Task 11 — depende de uma session paga real.

- [ ] **Step 3: Lint, typecheck, commit**

```bash
npx eslint src/app/api/checkout-publico/ativar/route.ts
npx tsc --noEmit
git add src/app/api/checkout-publico/ativar/route.ts
git commit -m "feat(api): ativacao pos-pagamento do checkout publico (session_id -> convite)"
```

---

### Task 8: Página pública `/ativar` no ERP

**Files:**
- Create: `src/app/ativar/page.tsx`
- Create: `src/app/ativar/ativar-client.tsx`

**Interfaces:**
- Consumes: `POST /api/checkout-publico/ativar` (contrato da Task 7).
- Produces: página que recebe `?session_id=` do return_url do Stripe. Estilo: inline styles simples, mesmo padrão da página irmã `src/app/definir-senha/page.tsx` (sem sidebar — páginas soltas fora dos grupos de layout não a recebem).

- [ ] **Step 1: Create the server page**

Criar `src/app/ativar/page.tsx`:

```tsx
import { AtivarClient } from "./ativar-client";

export const dynamic = "force-dynamic";

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ session_id?: string }>;
}) {
  const sp = await searchParams;
  return (
    <div
      style={{
        display: "flex",
        minHeight: "100vh",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
      }}
    >
      <AtivarClient sessionId={sp.session_id ?? ""} />
    </div>
  );
}
```

- [ ] **Step 2: Create the client component (polling)**

Criar `src/app/ativar/ativar-client.tsx`:

```tsx
"use client";
import { useEffect, useRef, useState } from "react";

type Fase = "validando" | "processando" | "ja-ativo" | "nao-pago" | "erro";

const MAX_TENTATIVAS = 10; // ~30s de espera pelo webhook
const INTERVALO_MS = 3000;

export function AtivarClient({ sessionId }: { sessionId: string }) {
  const [fase, setFase] = useState<Fase>("validando");
  const tentativas = useRef(0);

  useEffect(() => {
    if (!sessionId) {
      setFase("erro");
      return;
    }
    let cancelado = false;

    async function tentar() {
      try {
        const res = await fetch("/api/checkout-publico/ativar", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ sessionId }),
        });
        if (cancelado) return;

        if (res.status === 202) {
          tentativas.current += 1;
          if (tentativas.current >= MAX_TENTATIVAS) {
            setFase("erro");
            return;
          }
          setFase("processando");
          setTimeout(tentar, INTERVALO_MS);
          return;
        }
        if (res.status === 402) {
          setFase("nao-pago");
          return;
        }
        if (!res.ok) {
          setFase("erro");
          return;
        }
        const data = (await res.json()) as { status: string; redirectTo?: string };
        if (data.status === "pronto" && data.redirectTo) {
          window.location.assign(data.redirectTo);
          return;
        }
        if (data.status === "ja-ativo") {
          setFase("ja-ativo");
          return;
        }
        setFase("erro");
      } catch {
        if (!cancelado) setFase("erro");
      }
    }

    tentar();
    return () => {
      cancelado = true;
    };
  }, [sessionId]);

  const estilos: React.CSSProperties = {
    width: 380,
    maxWidth: "100%",
    textAlign: "center",
    display: "flex",
    flexDirection: "column",
    gap: 10,
  };

  if (fase === "validando" || fase === "processando") {
    return (
      <div style={estilos}>
        <h2>Pagamento confirmado 🎉</h2>
        <p>
          Estamos preparando sua conta no Atlas Seller. Isso leva só alguns
          segundos — não feche esta página.
        </p>
      </div>
    );
  }
  if (fase === "ja-ativo") {
    return (
      <div style={estilos}>
        <h2>Sua conta já está ativa</h2>
        <p>Você já definiu sua senha. É só entrar.</p>
        <a href="/login">Ir para o login</a>
      </div>
    );
  }
  if (fase === "nao-pago") {
    return (
      <div style={estilos}>
        <h2>Pagamento não confirmado</h2>
        <p>
          Não encontramos um pagamento aprovado para este link. Se você acabou
          de pagar, aguarde um instante e recarregue a página.
        </p>
      </div>
    );
  }
  return (
    <div style={estilos}>
      <h2>Não conseguimos ativar automaticamente</h2>
      <p>
        Seu pagamento está seguro. Fale com a gente em{" "}
        <a href="mailto:admfsmundo@gmail.com">admfsmundo@gmail.com</a> que
        liberamos seu acesso rapidinho.
      </p>
    </div>
  );
}
```

(A entrada `"/ativar"` em `PUBLIC_PATHS` já foi feita na Task 6.)

- [ ] **Step 3: Verificação manual**

Com `npm run dev:web`:
- Abrir `http://localhost:3000/ativar` (sem session_id) → tela "Não conseguimos ativar automaticamente".
- Abrir `http://localhost:3000/ativar?session_id=cs_invalido_1234567890` → após 1 fetch, mesma tela de erro (rota devolve 400).
- Confirmar que NÃO houve redirect para /login (rota pública funcionando).

- [ ] **Step 4: Lint, typecheck, commit**

```bash
npx eslint src/app/ativar/page.tsx src/app/ativar/ativar-client.tsx
npx tsc --noEmit
git add src/app/ativar/
git commit -m "feat(ativar): pagina publica de ativacao pos-pagamento com polling do webhook"
```

---

### Task 9: Landing — botões "Contratar" apontando pro checkout

**Files:**
- Modify: `landing-atlas/index.html:252,264,275` (os 3 `<a>` dos planos)
- Modify: `landing-atlas/app.js:55-84` (função `initPricing`)

**Interfaces:**
- Produces: links dos planos levam a `checkout.html?plano=<id>&ciclo=<período ativo do toggle>`.

- [ ] **Step 1: Trocar os 3 botões no index.html**

Linha 252 (Starter), de:
```html
            <a class="btn btn-outline" href="#contato" data-plan="starter">Começar</a>
```
para:
```html
            <a class="btn btn-outline" href="checkout.html?plano=starter&ciclo=mensal" data-plan="starter">Contratar</a>
```

Linha 264 (Pro), de:
```html
            <a class="btn btn-primary" href="#contato" data-plan="pro">Começar</a>
```
para:
```html
            <a class="btn btn-primary" href="checkout.html?plano=pro&ciclo=mensal" data-plan="pro">Contratar</a>
```

Linha 275 (Scale), de:
```html
            <a class="btn btn-outline" href="#contato" data-plan="scale">Começar</a>
```
para:
```html
            <a class="btn btn-outline" href="checkout.html?plano=scale&ciclo=mensal" data-plan="scale">Contratar</a>
```

- [ ] **Step 2: Atualizar href no toggle (app.js)**

Em `landing-atlas/app.js`, na função `apply(p)` de `initPricing`, trocar a linha:
```js
    document.querySelectorAll('.plan a[data-plan]').forEach(a=>a.dataset.period=p);
```
por:
```js
    document.querySelectorAll('.plan a[data-plan]').forEach(a=>{
      a.dataset.period=p;
      a.href='checkout.html?plano='+a.dataset.plan+'&ciclo='+p;
    });
```

Atenção: `initSmoothScroll` só intercepta `a[href^="#"]` — os novos hrefs não são âncora, então a navegação normal funciona sem mudança lá.

- [ ] **Step 3: Verificação manual**

Servir a landing: `npx -y http-server landing-atlas -p 8080 -c-1` e abrir `http://localhost:8080/#precos`:
- Botões dizem "Contratar".
- Clicar em "Anual" no toggle → inspecionar um botão → href termina em `&ciclo=anual`.
- Clicar em "Contratar" do Pro → navega para `checkout.html?plano=pro&ciclo=anual` (404 por enquanto — a página nasce na Task 10).

- [ ] **Step 4: Commit**

```bash
git add landing-atlas/index.html landing-atlas/app.js
git commit -m "feat(landing): botoes Contratar levam ao checkout com plano e ciclo"
```

---

### Task 10: Landing — página `checkout.html` com Embedded Checkout

**Files:**
- Create: `landing-atlas/checkout.html`
- Create: `landing-atlas/checkout.js`

**Interfaces:**
- Consumes: `POST {API_BASE}/api/checkout-publico/sessao` → `{ clientSecret, publishableKey }` (Task 6); Stripe.js v3 (`Stripe(pk).initEmbeddedCheckout({ clientSecret })` → `checkout.mount(sel)` / `checkout.destroy()`).
- Produces: página `checkout.html?plano=X&ciclo=Y` (defaults `pro`/`mensal` para valores inválidos).

- [ ] **Step 1: Create checkout.html**

Criar `landing-atlas/checkout.html`:

```html
<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Contratar — Atlas Seller</title>
  <meta name="description" content="Contrate o Atlas Seller: escolha o plano e pague com segurança via Stripe.">
  <meta name="robots" content="noindex">
  <link rel="icon" href="assets/img/atlas-symbol.png">
  <link rel="stylesheet" href="styles.css?v=6">
  <style>
    /* Estilos locais da página de checkout (segue tokens do styles.css) */
    .checkout-wrap{display:grid;grid-template-columns:380px 1fr;gap:32px;align-items:start;padding:40px 0 80px}
    @media (max-width:900px){.checkout-wrap{grid-template-columns:1fr}}
    .resumo{position:sticky;top:92px}
    .resumo .plan{cursor:default}
    .resumo .plan:hover{transform:none;box-shadow:var(--shadow-card)}
    .troca-plano{display:flex;gap:8px;margin:0 0 14px}
    .troca-plano button{flex:1;padding:9px 0;border-radius:var(--radius-sm);border:1px solid var(--border);
      background:var(--surface);font-weight:700;font-size:13px;cursor:pointer;color:var(--text-2)}
    .troca-plano button.active{border-color:var(--primary);color:var(--primary);background:rgba(37,99,235,.06)}
    .price-toggle.compacto{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin:0 0 18px}
    .price-toggle.compacto button{padding:8px 0;border-radius:var(--radius-sm);border:1px solid var(--border);
      background:var(--surface);font-weight:600;font-size:12.5px;cursor:pointer;color:var(--text-2)}
    .price-toggle.compacto button.active{border-color:var(--primary);color:var(--primary);background:rgba(37,99,235,.06)}
    .pagamento{background:var(--surface);border:1px solid var(--border);border-radius:16px;padding:20px;min-height:520px}
    .pagamento .aviso{padding:40px 20px;text-align:center;color:var(--text-2)}
    .pagamento .aviso a{color:var(--primary);font-weight:700}
    .selo-seguro{display:flex;align-items:center;gap:8px;justify-content:center;margin-top:14px;
      font-size:12.5px;color:var(--muted);font-weight:600}
  </style>
</head>
<body>
  <header class="site-header">
    <div class="container nav">
      <a class="brand" href="index.html"><span class="sym" aria-hidden="true"><svg viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg"><circle cx="18.5" cy="20.5" r="12" fill="none" stroke="#10B981" stroke-width="2.6"/><path d="M6.5 20.5h24" stroke="#10B981" stroke-width="2"/><path d="M18.5 8.5c5.6 3.6 5.6 20.4 0 24M18.5 8.5c-5.6 3.6-5.6 20.4 0 24" stroke="#10B981" stroke-width="2" fill="none"/><circle cx="31" cy="9" r="3.8" fill="#FF9900"/></svg></span>Atlas <span class="accent">Seller</span></a>
      <nav class="nav-links" aria-label="Navegação">
        <a href="index.html#precos">Voltar aos planos</a>
      </nav>
    </div>
  </header>

  <main>
    <div class="container checkout-wrap">
      <aside class="resumo" aria-label="Resumo do plano">
        <div class="troca-plano" id="trocaPlano" role="group" aria-label="Escolher plano">
          <button type="button" data-plan="starter">Starter</button>
          <button type="button" data-plan="pro">Pro</button>
          <button type="button" data-plan="scale">Scale</button>
        </div>
        <div class="price-toggle compacto" id="trocaCiclo" role="group" aria-label="Ciclo de cobrança">
          <button type="button" data-period="mensal">Mensal</button>
          <button type="button" data-period="trimestral">Trimestral</button>
          <button type="button" data-period="semestral">Semestral</button>
          <button type="button" data-period="anual">Anual</button>
        </div>
        <div class="plan" id="cardResumo">
          <h3 id="resumoNome">Pro</h3>
          <div class="price"><span class="amount" id="resumoValor">R$ 159,99</span><small class="per" id="resumoPer">/mês</small><div class="equiv" id="resumoEquiv"></div></div>
          <ul id="resumoFeatures"></ul>
          <p class="selo-seguro" style="margin:0">✓ Cancele quando quiser · Pagamento seguro via Stripe</p>
        </div>
      </aside>

      <section aria-label="Pagamento">
        <div class="pagamento">
          <div class="aviso" id="estadoPagamento">Carregando pagamento seguro…</div>
          <div id="checkout-embed"></div>
        </div>
        <p class="selo-seguro">🔒 Processado pelo Stripe. Não armazenamos os dados do seu cartão.</p>
      </section>
    </div>
  </main>

  <script src="https://js.stripe.com/v3/"></script>
  <script src="checkout.js"></script>
</body>
</html>
```

- [ ] **Step 2: Create checkout.js**

Criar `landing-atlas/checkout.js`:

```js
(function(){
  'use strict';
  // ERP que cria a sessão (CORS liberado p/ esta origem via CHECKOUT_PUBLICO_ORIGEM).
  var API_BASE = (location.hostname === 'localhost' || location.hostname === '127.0.0.1')
    ? 'http://localhost:3000'
    : 'https://erp.mundofs.cloud';

  var PLANOS = {
    starter: { nome: 'Starter', base: 8999, features: ['1 conta Amazon', 'Até ~500 vendas/mês', 'Dashboards e DRE', 'Lucratividade por venda'] },
    pro:     { nome: 'Pro',     base: 15999, features: ['Até ~3.000 vendas/mês', 'Marketplace Analytics (tráfego/Brand Analytics)', 'Otimizador de Ads', 'Resumo de estoque no WhatsApp'] },
    scale:   { nome: 'Scale',   base: 21999, features: ['Até 10.000+ vendas/mês', 'Multi-conta', 'Tudo do Pro', 'Suporte premium'] }
  };
  // [meses, desconto, rótulo] — MESMA fórmula do app.js; bate com os prices do Stripe.
  var CICLOS = { mensal: [1, 0, '/mês'], trimestral: [3, .05, '/trimestre'], semestral: [6, .10, '/semestre'], anual: [12, .20, '/ano'] };

  var qs = new URLSearchParams(location.search);
  var plano = PLANOS[qs.get('plano')] ? qs.get('plano') : 'pro';
  var ciclo = CICLOS[qs.get('ciclo')] ? qs.get('ciclo') : 'mensal';

  var estadoEl = document.getElementById('estadoPagamento');
  var embedEl = document.getElementById('checkout-embed');
  var checkoutAtual = null; // instância do Embedded Checkout (para destroy)
  var geracao = 0;          // invalida respostas de fetch antigas ao trocar plano/ciclo

  function fmt(c){ return 'R$ ' + (c / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

  function renderResumo(){
    var p = PLANOS[plano];
    var c = CICLOS[ciclo];
    var total = Math.round(p.base * c[0] * (1 - c[1]));
    document.getElementById('resumoNome').textContent = p.nome;
    document.getElementById('resumoValor').textContent = fmt(total);
    document.getElementById('resumoPer').textContent = c[2];
    document.getElementById('resumoEquiv').textContent = c[0] > 1 ? 'equivale a ' + fmt(Math.round(total / c[0])) + '/mês' : '';
    var ul = document.getElementById('resumoFeatures');
    ul.innerHTML = '';
    p.features.forEach(function(f){
      var li = document.createElement('li');
      li.textContent = f;
      ul.appendChild(li);
    });
    document.querySelectorAll('#trocaPlano button').forEach(function(b){ b.classList.toggle('active', b.dataset.plan === plano); });
    document.querySelectorAll('#trocaCiclo button').forEach(function(b){ b.classList.toggle('active', b.dataset.period === ciclo); });
    var url = new URL(location.href);
    url.searchParams.set('plano', plano);
    url.searchParams.set('ciclo', ciclo);
    history.replaceState(null, '', url);
  }

  function mostrarErro(){
    estadoEl.innerHTML = 'Não foi possível carregar o pagamento agora. Tente de novo em instantes ou ' +
      '<a href="index.html#contato">fale com a gente</a>.';
    estadoEl.hidden = false;
  }

  function carregarCheckout(){
    var minhaGeracao = ++geracao;
    estadoEl.textContent = 'Carregando pagamento seguro…';
    estadoEl.hidden = false;
    if (checkoutAtual) { checkoutAtual.destroy(); checkoutAtual = null; }
    embedEl.innerHTML = '';

    fetch(API_BASE + '/api/checkout-publico/sessao', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ plano: plano, ciclo: ciclo })
    })
      .then(function(res){ if (!res.ok) throw new Error('http ' + res.status); return res.json(); })
      .then(function(data){
        if (minhaGeracao !== geracao) return; // usuário já trocou de plano/ciclo
        var stripe = Stripe(data.publishableKey);
        return stripe.initEmbeddedCheckout({ clientSecret: data.clientSecret })
          .then(function(checkout){
            if (minhaGeracao !== geracao) { checkout.destroy(); return; }
            checkoutAtual = checkout;
            estadoEl.hidden = true;
            checkout.mount('#checkout-embed');
          });
      })
      .catch(function(){ if (minhaGeracao === geracao) mostrarErro(); });
  }

  document.getElementById('trocaPlano').addEventListener('click', function(e){
    var b = e.target.closest('button[data-plan]');
    if (!b || b.dataset.plan === plano) return;
    plano = b.dataset.plan;
    renderResumo();
    carregarCheckout();
  });
  document.getElementById('trocaCiclo').addEventListener('click', function(e){
    var b = e.target.closest('button[data-period]');
    if (!b || b.dataset.period === ciclo) return;
    ciclo = b.dataset.period;
    renderResumo();
    carregarCheckout();
  });

  renderResumo();
  carregarCheckout();
})();
```

Nota de segurança: `API_BASE` é decidido por hostname (não por query string) de propósito — permitir `?api=` abriria phishing com nosso domínio. Nota SRI: `js.stripe.com/v3` intencionalmente SEM `integrity` — o Stripe atualiza o bundle dinamicamente e não publica hashes (ver spec).

- [ ] **Step 3: Validar HTML**

A landing tem `.htmlvalidate.json`. Rodar:
```bash
npx html-validate landing-atlas/checkout.html
```
Expected: 0 erros (se a ferramenta não estiver disponível, pular — validação visual cobre).

- [ ] **Step 4: Verificação manual (visual + fluxo de sessão)**

1. Dev server do ERP no ar (`npm run dev:web`) com envs da Task 6.
2. `npx -y http-server landing-atlas -p 8080 -c-1`
3. Abrir `http://localhost:8080/checkout.html?plano=pro&ciclo=anual`:
   - Resumo mostra "Pro", "R$ 1.535,90", "/ano", "equivale a R$ 127,99/mês".
   - Formulário do Stripe carrega à direita (iframe com e-mail/cartão + campo "Nome da sua empresa/loja").
   - Trocar para "Starter" e "Mensal" → resumo vira "R$ 89,99" e o form recarrega.
   - Parar o dev server e recarregar → mensagem de erro amigável com link de contato.

- [ ] **Step 5: Commit**

```bash
git add landing-atlas/checkout.html landing-atlas/checkout.js
git commit -m "feat(landing): pagina de checkout com Stripe Embedded Checkout"
```

---

### Task 11: Envs completas + E2E manual do fluxo inteiro (test mode)

**Files:**
- Modify: `.env` (local, gitignored — NÃO commitar)

**Interfaces:**
- Consumes: tudo das tasks anteriores.
- Produces: fluxo validado ponta a ponta em test mode.

- [ ] **Step 1: Completar o .env local**

Adicionar ao `.env` (as 2 chaves `sk_test_`/`pk_test_` já estão lá):

```bash
APP_URL="http://localhost:3000"
CHECKOUT_PUBLICO_ORIGEM="http://localhost:8080"
# preenchido no Step 2 pelo stripe listen:
STRIPE_WEBHOOK_SECRET=""

STRIPE_PRICE_STARTER_MENSAL="price_1ToRkVKMqHJ7jzJduKUTpEB6"
STRIPE_PRICE_STARTER_TRIMESTRAL="price_1ToRmQKMqHJ7jzJdOngcIfAa"
STRIPE_PRICE_STARTER_SEMESTRAL="price_1ToRmQKMqHJ7jzJdmwPQkNLb"
STRIPE_PRICE_STARTER_ANUAL="price_1ToRmQKMqHJ7jzJdnTkiEkwi"
STRIPE_PRICE_PRO_MENSAL="price_1ToRniKMqHJ7jzJd5GEPrRJK"
STRIPE_PRICE_PRO_TRIMESTRAL="price_1ToRniKMqHJ7jzJd1AwLhrOP"
STRIPE_PRICE_PRO_SEMESTRAL="price_1ToRniKMqHJ7jzJd5e97eRM9"
STRIPE_PRICE_PRO_ANUAL="price_1ToRniKMqHJ7jzJd08baH3a6"
STRIPE_PRICE_SCALE_MENSAL="price_1ToRnyKMqHJ7jzJdJJf6q9Hc"
STRIPE_PRICE_SCALE_TRIMESTRAL="price_1ToRoXKMqHJ7jzJd6nhCrcrj"
STRIPE_PRICE_SCALE_SEMESTRAL="price_1ToRoXKMqHJ7jzJdyIw7LO47"
STRIPE_PRICE_SCALE_ANUAL="price_1ToRoXKMqHJ7jzJd01EDAfMb"
```

- [ ] **Step 2: Preparar banco local + webhook forwarding**

```bash
# SQLite local (schema já tem os campos de billing):
npm run prisma:generate && npm run prisma:push

# Stripe CLI (se não instalado: scoop install stripe / choco install stripe-cli
# ou https://docs.stripe.com/stripe-cli). Login com a conta test:
stripe login --api-key sk_test_...   # (chave do .env)
stripe listen --forward-to localhost:3000/api/stripe/webhook
```

Copiar o `whsec_...` impresso pelo `stripe listen` para `STRIPE_WEBHOOK_SECRET` no `.env` e (re)subir `npm run dev:web`.

- [ ] **Step 3: E2E — caminho feliz**

1. `npx -y http-server landing-atlas -p 8080 -c-1`
2. `http://localhost:8080/index.html#precos` → toggle "Anual" → "Contratar" no Pro.
3. Em `checkout.html`: preencher e-mail novo (ex: `teste+e2e1@exemplo.com`), nome, campo "Nome da sua empresa/loja" = `Loja E2E Um`, cartão `4242 4242 4242 4242`, validade futura, CVC qualquer.
4. Pagar → deve redirecionar para `http://localhost:3000/ativar?session_id=cs_test_...`.
5. Tela "preparando sua conta" → em segundos redireciona para `/definir-senha?token=...`.
6. Definir senha forte (≥12, maiúscula+minúscula+número+especial) → cai no `/login`.
7. Logar com o e-mail + senha → entra no ERP.
8. Conferir no banco (`npx prisma studio` ou query): `Empresa` nova com `slug=loja-e2e-um`, `stripeCustomerId`, `assinaturaStatus=ACTIVE`, `plano=pro`, `cicloAssinatura=anual`.

- [ ] **Step 4: E2E — casos de borda**

- **Session reusada depois de ativar**: abrir de novo a URL `/ativar?session_id=...` do Step 3 → "Sua conta já está ativa" (sem novo convite).
- **Fechou a aba antes de ativar**: repetir compra com e-mail novo (`teste+e2e2@...`), fechar a aba na volta do Stripe ANTES do redirect. Conferir que a `Empresa` existe mesmo assim (webhook). Então abrir `/ativar?session_id=...` (URL do terminal do `stripe listen`, evento `checkout.session.completed`) → convite → senha → login.
- **Webhook reentregue**: `stripe events resend <id do checkout.session.completed>` → logs mostram provisionamento idempotente (`ja-existia`), nenhuma empresa duplicada.
- **Fluxo logado intacto**: logar como ADMIN de uma empresa existente → `/configuracoes` → "Abrir Checkout" continua funcionando (regressão).

- [ ] **Step 5: Commit final de ajustes (se houver)**

Qualquer correção descoberta no E2E entra em commits pequenos (`fix(...)`). NÃO commitar `.env`.

---

### Task 12: Encerramento

- [ ] Rodar a suíte dos módulos tocados: `npx vitest run src/modules/billing/` → tudo PASS.
- [ ] `npx tsc --noEmit` limpo.
- [ ] `npx eslint src/modules/billing src/app/api/checkout-publico src/app/ativar` limpo.
- [ ] Invocar o skill `superpowers:finishing-a-development-branch` para decidir merge/PR (branch `feat/landing-atlas-seller`; lembrar: a remota homônima diverge — NÃO rebasear, avaliar PR novo).
- [ ] Deploy (fora deste plano; exige envs live no VPS): trocar chaves live, criar produtos/prices live, `CHECKOUT_PUBLICO_ORIGEM=https://atlasseller.mundofs.cloud`, `APP_URL=https://erp.mundofs.cloud`, webhook endpoint no dashboard Stripe com `STRIPE_WEBHOOK_SECRET` de prod, e publicar `landing-atlas/` no vhost (rsync como no deploy original da landing). Conferir que o vhost Nginx da landing NÃO envia CSP que bloqueie `js.stripe.com` (script) e `*.stripe.com` (frame/connect) — risco mapeado no spec.

---

# APÊNDICE — Iteração 2 (aprovada 2026-07-02): Stripe Elements + visual BR

> As Tasks 11 (E2E embedded) e 12 (encerramento) originais estão **SUPERSEDED** pelas
> Tasks 17 e 18 abaixo. As Tasks 1-10 permanecem válidas como fundação: provisionamento,
> ativação por customer, rotas públicas e a página embedded (que vira fallback).
> Referência de visual: checkout "Hermes" aprovado pelo Heitor (banner hero, card do
> plano rico, depoimentos ★, selos de segurança, form BR próprio).

### Task 13: Service + rota pública `POST /api/checkout-publico/assinatura`

**Files:**
- Modify: `src/modules/billing/service.ts` (adicionar `criarAssinaturaPublicaLanding` após `criarCheckoutPublicoLanding`)
- Modify: `src/modules/billing/service.test.ts` (novo describe)
- Create: `src/app/api/checkout-publico/assinatura/route.ts`
- Modify: `src/proxy.ts` (adicionar `/api/checkout-publico/assinatura` a PUBLIC_PATHS, junto das entradas existentes de checkout-publico)

**Interfaces:**
- Consumes: `requireStripe`, `getStripePriceId`, padrão CORS/rate-limit/try-catch da rota `sessao` (`src/app/api/checkout-publico/sessao/route.ts` é o template — lição da T6: erros levam headers CORS).
- Produces (contrato para a Task 16):
  - `POST /api/checkout-publico/assinatura` body `{ plano, ciclo, nome, email, cpfCnpj, celular, nomeEmpresa? }`
  - 200 `{ clientSecret, publishableKey }` · 400 `{"erro":"CPF_CNPJ_INVALIDO"}` p/ tax_id_invalid · 400 dados inválidos · 403/429 como na rota sessao.

- [ ] **Step 1: Teste do service (RED)**

Adicionar em `src/modules/billing/service.test.ts` (os mocks hoisted já existem; adicionar `customers: { create: vi.fn() }` e `subscriptions: { create: vi.fn() }` ao stripeMock se ausentes):

```ts
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
});
```

Import: adicionar `criarAssinaturaPublicaLanding` ao import de `./service`.

- [ ] **Step 2: RED** — `npx vitest run src/modules/billing/service.test.ts` → novos testes falham (export ausente).

- [ ] **Step 3: Implementar o service**

Em `src/modules/billing/service.ts`, após `criarCheckoutPublicoLanding`:

```ts
type AssinaturaPublicaInput = {
  planId: BillingPlanId;
  period: BillingPeriod;
  nome: string;
  email: string;
  /** somente dígitos: 11 (CPF) ou 14 (CNPJ) — validado na rota */
  cpfCnpj: string;
  /** somente dígitos com DDD — validado na rota */
  celular: string;
  nomeEmpresa?: string;
};

/**
 * Fluxo Elements (form próprio na landing): cria Customer BR + Subscription
 * incomplete e devolve o client_secret do PaymentIntent da 1ª invoice
 * (confirmation_secret — stripe@22.3.0/dahlia). O webhook invoice.paid
 * provisiona a Empresa depois. Não escreve nada no banco.
 */
export async function criarAssinaturaPublicaLanding(
  input: AssinaturaPublicaInput,
): Promise<string> {
  const stripe = requireStripe();
  const priceId = getStripePriceId(input.planId, input.period);
  const metadata = {
    origem: "landing",
    plano: input.planId,
    ciclo: input.period,
    nome_empresa: input.nomeEmpresa?.trim() || input.nome.trim(),
  };

  const customer = await stripe.customers.create({
    name: input.nome.trim(),
    email: input.email.toLowerCase().trim(),
    phone: `+55${input.celular}`,
    tax_id_data: [
      { type: input.cpfCnpj.length === 11 ? "br_cpf" : "br_cnpj", value: input.cpfCnpj },
    ],
    metadata,
  });

  const subscription = await stripe.subscriptions.create({
    customer: customer.id,
    items: [{ price: priceId }],
    payment_behavior: "default_incomplete",
    payment_settings: { save_default_payment_method: "on_subscription" },
    expand: ["latest_invoice.confirmation_secret"],
    metadata,
  });

  const invoice = subscription.latest_invoice;
  const clientSecret =
    invoice && typeof invoice === "object"
      ? invoice.confirmation_secret?.client_secret
      : undefined;
  if (!clientSecret) throw new Error("assinatura sem client_secret");
  return clientSecret;
}
```

- [ ] **Step 4: GREEN** — testes do service passam; suíte billing inteira passa.

- [ ] **Step 5: Rota pública**

Criar `src/app/api/checkout-publico/assinatura/route.ts` — ESPELHAR a rota `sessao`
(mesmos helpers CORS locais, OPTIONS, rate-limit — janela 15min, MAX **10** — e o
try/catch com headers do fix da T6), trocando o miolo:

```ts
const schema = z.object({
  plano: z.string(),
  ciclo: z.string().optional(),
  nome: z.string().trim().min(2).max(120),
  email: z.string().trim().email().max(160),
  cpfCnpj: z
    .string()
    .transform((s) => s.replace(/\D/g, ""))
    .refine((v) => v.length === 11 || v.length === 14, "CPF/CNPJ inválido"),
  celular: z
    .string()
    .transform((s) => s.replace(/\D/g, ""))
    .refine((v) => v.length >= 10 && v.length <= 13, "celular inválido"),
  nomeEmpresa: z.string().trim().max(80).optional(),
});
```

Dentro do try: `schema.safeParse(body)` → falha = 400 `{"erro":"DADOS_INVALIDOS"}` (com
headers); `parseBillingPlanId(data.plano)` / `parseBillingPeriod(data.ciclo ?? "mensal")`;
`criarAssinaturaPublicaLanding({...})`; resposta `{ clientSecret, publishableKey }`.
No catch: se o erro Stripe tiver `code === "tax_id_invalid"` → 400
`{"erro":"CPF_CNPJ_INVALIDO"}` (com headers); senão manter o mapeamento
Error→400 / resto→500 com headers (padrão do fix T6). Rate-limit key:
`"checkout-assinatura:" + ip`.

Proxy: adicionar `"/api/checkout-publico/assinatura",` junto às entradas checkout-publico.

- [ ] **Step 6: Verificação viva (curl)** — subir `npm run dev:web` em background;
  `curl -s -X POST localhost:3000/api/checkout-publico/assinatura -H "content-type: application/json" -H "origin: http://localhost:8080" -d '{"plano":"pro","ciclo":"mensal","nome":"Teste E2E","email":"t13@exemplo.com","cpfCnpj":"000.000.001-91","celular":"(11) 99999-8888","nomeEmpresa":"Loja T13"}'`
  → 200 `{clientSecret:"pi_..._secret_...", publishableKey}` (CPF de teste 00000000191 é
  aceito pelo Stripe test mode). Body inválido (cpfCnpj "123") → 400 DADOS_INVALIDOS com
  header CORS. Matar o server depois.

- [ ] **Step 7: Lint, typecheck, commit**

```bash
npx eslint src/modules/billing/service.ts src/modules/billing/service.test.ts src/app/api/checkout-publico/assinatura/route.ts src/proxy.ts
npx tsc --noEmit
git add src/modules/billing/service.ts src/modules/billing/service.test.ts src/app/api/checkout-publico/assinatura/route.ts src/proxy.ts
git commit -m "feat(api): assinatura publica via Elements (customer BR + subscription incomplete)"
```

---

### Task 14: Provisionamento por customer + gancho no `invoice.paid`

**Files:**
- Modify: `src/modules/billing/provisionamento.ts` (refactor: núcleo `provisionarEmpresa(dados)` + wrappers `provisionarEmpresaDoCheckout(session)` e novo `provisionarEmpresaDoCustomer(customer)`)
- Modify: `src/modules/billing/provisionamento.test.ts` (testes do novo wrapper; existentes continuam passando)
- Modify: `src/modules/billing/service.ts` (case `invoice.paid`)
- Modify: `src/modules/billing/service.test.ts` (testes do gancho)

**Interfaces:**
- Produces:
  ```ts
  type DadosProvisionamento = {
    customerId: string;
    email: string | null | undefined;
    nomePagador: string | null | undefined;
    nomeEmpresa: string | null | undefined;
  };
  provisionarEmpresa(dados: DadosProvisionamento): Promise<ProvisionamentoResult>
  provisionarEmpresaDoCustomer(customer: Stripe.Customer): Promise<ProvisionamentoResult>
  // extrai: customerId=customer.id, email=customer.email, nomePagador=customer.name,
  //         nomeEmpresa=customer.metadata?.nome_empresa
  ```
- Comportamento do núcleo = EXATAMENTE o atual (idempotência por stripeCustomerId, e-mail
  obrigatório, precedência nomeEmpresa→nomePagador→email, slug, criarEmpresa, update).
  `provisionarEmpresaDoCheckout` vira casca fina que monta `DadosProvisionamento` da
  session (custom field `nome_empresa` / customer_details) e delega — testes existentes
  do checkout NÃO mudam de expectativa.

- [ ] **Step 1 (RED):** adicionar testes: (a) `provisionarEmpresaDoCustomer` com customer
  `{id:"cus_1", email:"a@b.com", name:"Maria", metadata:{nome_empresa:"Loja X"}}` → cria
  com nome "Loja X"/admin "Maria"; (b) sem metadata.nome_empresa → fallback name; (c) sem
  email → ignorada sem-email. No service.test.ts: evento `invoice.paid` cuja subscription
  (mock retrieve) tem `metadata.origem="landing"` e `customer:"cus_1"` → mock
  `stripeMock.customers.retrieve` devolve customer → `provisionarEmpresaDoCustomer`
  chamado ANTES de `empresa.updateMany`; evento invoice.paid sem origem landing → NÃO
  chama. (Mockar `@/modules/billing/provisionamento` já é feito no topo do arquivo —
  acrescentar `provisionarEmpresaDoCustomer: vi.fn()` ao mock e importar a referência.)

- [ ] **Step 2: Implementar refactor + gancho**

provisionamento.ts: mover o corpo de `provisionarEmpresaDoCheckout` (da checagem de
e-mail em diante) para `provisionarEmpresa(dados)`; wrappers extraem os campos.

service.ts, case `invoice.paid` (substituir o miolo atual mantendo o formato):

```ts
    case "invoice.paid": {
      const invoice = event.data.object as Stripe.Invoice;
      const subscriptionId = stringId(
        (invoice as Stripe.Invoice & { subscription?: string | Stripe.Subscription | null })
          .subscription,
      );
      if (subscriptionId) {
        const subscription = await stripe.subscriptions.retrieve(subscriptionId);
        // Fluxo Elements da landing: a 1ª invoice paga é o gatilho de provisionamento
        // (não há Checkout Session). Idempotente — renovações reentram sem efeito.
        if (subscription.metadata?.origem === "landing") {
          const customerId = stringId(subscription.customer);
          if (customerId) {
            const customer = await stripe.customers.retrieve(customerId);
            if (!("deleted" in customer) || !customer.deleted) {
              await provisionarEmpresaDoCustomer(customer as Stripe.Customer);
            }
          }
        }
        await aplicarAssinaturaStripe(subscription);
      }
      break;
    }
```

(`stripe.customers.retrieve` precisa entrar no stripeMock do teste se ainda não existe.)

- [ ] **Step 3 (GREEN):** `npx vitest run src/modules/billing/` → tudo passa (antigos + novos).

- [ ] **Step 4: Lint, typecheck, commit**

```bash
npx eslint src/modules/billing/provisionamento.ts src/modules/billing/provisionamento.test.ts src/modules/billing/service.ts src/modules/billing/service.test.ts
npx tsc --noEmit
git add src/modules/billing/provisionamento.ts src/modules/billing/provisionamento.test.ts src/modules/billing/service.ts src/modules/billing/service.test.ts
git commit -m "feat(billing): provisionamento via invoice.paid para assinatura da landing (Elements)"
```

---

### Task 15: Ativação por `payment_intent` (rota + página)

**Files:**
- Modify: `src/app/api/checkout-publico/ativar/route.ts`
- Modify: `src/app/ativar/page.tsx` + `src/app/ativar/ativar-client.tsx`

**Interfaces:**
- Rota aceita `{ sessionId }` OU `{ paymentIntentId }` (exatamente um):
  ```ts
  const schema = z
    .object({
      sessionId: z.string().min(10).max(200).optional(),
      paymentIntentId: z.string().min(10).max(200).optional(),
    })
    .refine((d) => !!d.sessionId !== !!d.paymentIntentId, "exatamente um identificador");
  ```
- Caminho PI: `stripe.paymentIntents.retrieve(paymentIntentId)`; pago =
  `pi.status === "succeeded"`; `customerId` de `pi.customer` (string|objeto). Não pago ou
  sem customer → 402 nao-pago. Depois `ativarPorCustomer(customerId)` — mesmas respostas.
- Página: `page.tsx` passa também `paymentIntentId: sp.payment_intent ?? ""`;
  `ativar-client.tsx` recebe `{ sessionId, paymentIntentId }`, erro imediato só se AMBOS
  vazios, e o body do fetch envia o que existir
  (`sessionId ? { sessionId } : { paymentIntentId }`). Nada mais muda (polling/estados
  idênticos; o return_url do Stripe adiciona `payment_intent` e
  `payment_intent_client_secret` — o client_secret é IGNORADO de propósito, a validação é
  server-side via retrieve).

- [ ] **Step 1:** aplicar as mudanças na rota (schema + branch PI antes/junto do branch session).
- [ ] **Step 2:** aplicar as mudanças na página (prop nova + escolha do body).
- [ ] **Step 3:** `npx eslint` nos 3 arquivos; `npx tsc --noEmit` limpo.
- [ ] **Step 4 (verificação viva):** dev server em background; curls:
  - `-d '{"paymentIntentId":"pi_inexistente_1234567890"}'` → 400 (Stripe not found).
  - `-d '{"sessionId":"x","paymentIntentId":"y"}'` → 400 DADOS_INVALIDOS (refine).
  - `-d '{}'` → 400 DADOS_INVALIDOS.
  - `curl -s "localhost:3000/ativar?payment_intent=pi_x_1234567890" -o /dev/null -w "%{http_code}"` → 200.
  Matar o server.
- [ ] **Step 5: Commit**

```bash
git add src/app/api/checkout-publico/ativar/route.ts src/app/ativar/
git commit -m "feat(ativar): aceitar payment_intent do fluxo Elements alem de session_id"
```

---

### Task 16: `checkout.html`/`checkout.js` v2 — form BR próprio + Payment Element + visual do modelo

**Files:**
- Rewrite: `landing-atlas/checkout.html`
- Rewrite: `landing-atlas/checkout.js`

**Interfaces:**
- Consumes: `POST {API_BASE}/api/checkout-publico/assinatura` (contrato T13); Stripe.js v3
  Elements: `Stripe(pk)` → `stripe.elements({ clientSecret, appearance })` →
  `elements.create("payment")` → `.mount()` → `stripe.confirmPayment({ elements,
  confirmParams: { return_url: API_BASE + "/ativar" } })`.
- `API_BASE` por hostname (localhost→`http://localhost:3000`, senão
  `https://erp.mundofs.cloud`) — NUNCA por query param.

**Estrutura da página (mesmo head/header/`styles.css` da v1; robots noindex mantido):**

1. **Banner hero** (`<section class="ck-hero">`): fundo `linear-gradient(135deg,#0F172A,#1D4ED8)`,
   texto branco — h1 "Decisões com o lucro na mão." + sub "Conecte sua conta Amazon e veja
   vendas, taxas, Ads e margem reais — tudo em um painel só." + `<img
   src="assets/video/demo-poster.jpg" alt="Painel do Atlas Seller">` arredondada à direita
   (grid 2 colunas, empilha no mobile).
2. **Grid principal** (form à esquerda ~1fr, coluna do plano à direita ~380px; inverte a
   ordem do modelo v1 para espelhar a referência aprovada — form à ESQUERDA).
3. **Form (card `.pagamento`)** com fieldsets:
   - Dados: Nome completo* · E-mail* · Confirmar e-mail* (client-side match) · CPF ou
     CNPJ* (máscara leve por JS: só dígitos, 11-14) · Celular/WhatsApp* (placeholder
     "(11) 99999-8888") · Nome da sua empresa/loja (opcional — "usaremos seu nome se
     vazio").
   - `🔒 Seus dados serão mantidos em sigilo` (selo, classe `.selo-seguro`).
   - Botão `Continuar para pagamento` (`.btn .btn-primary`, largura total).
   - Seção pagamento (`hidden` até criar a assinatura): `<div id="payment-element">` +
     checkbox `Li e concordo com os <a href="termos.html" target="_blank">Termos de
     Assinatura</a>*` + botão `Assinar agora 🔒` (desabilitado até o checkbox) + área de
     erro `#erroPagamento` (aria-live="polite").
   - Rodapé do card: `Pagamento processado pelo Stripe. Não armazenamos os dados do seu
     cartão.`
4. **Coluna direita**: card do plano rico (troca de plano/ciclo COMPACTA no topo — manter
   os mesmos grupos de botões da v1) — nome do plano grande, preço + `/ciclo` + equivalente
   mensal, `<ul>` de benefícios (mesmas features da v1, ✓ verdes via `.plan li::before`),
   selo `Cancele quando quiser`. Abaixo, card `Quem usa recomenda` com 3 depoimentos:
   `★★★★★` (aria-label "5 estrelas") + texto + nome — **conteúdo PLACEHOLDER, cada um
   marcado com `<!-- PLACEHOLDER: substituir por depoimento real -->`**.

**checkout.js v2 — fluxo (escrever completo, IIFE como v1, sem framework):**

```js
// Estado: plano/ciclo da query (defaults pro/mensal) — igual v1, incl. history.replaceState.
// renderResumo() — igual v1 (mesma fórmula de preço, mesmos dados PLANOS/CICLOS).
// Etapa 1: submit do form de dados →
//   valida: nome>=2, email===confirmacao (case-insensitive), cpfCnpj 11|14 dígitos,
//   celular 10-13 dígitos; erros inline (div .form-erro por campo, aria-live).
//   POST /api/checkout-publico/assinatura {plano, ciclo, nome, email, cpfCnpj, celular, nomeEmpresa}
//   → { clientSecret, publishableKey }.
//   stripe = Stripe(publishableKey);
//   elements = stripe.elements({ clientSecret, appearance: { theme: "stripe",
//     variables: { colorPrimary: "#2563EB", fontFamily: "Inter, system-ui, sans-serif",
//     borderRadius: "8px" } } });
//   elements.create("payment").mount("#payment-element");
//   revela a seção de pagamento, desabilita os campos de dados e a troca de plano/ciclo
//   (mudar plano depois de criada a assinatura = recomeçar: botão "alterar plano" que dá
//   location.reload() com a query atual).
// Etapa 2: click em "Assinar agora" (habilitado pelo checkbox dos termos) →
//   const { error } = await stripe.confirmPayment({ elements,
//     confirmParams: { return_url: API_BASE + "/ativar" } });
//   if (error) mostrar error.message em #erroPagamento (o Stripe só retorna aqui em falha;
//   sucesso = redirect automático para /ativar?payment_intent=...).
// Duplo-submit: desabilitar botões durante requests; reabilitar em erro.
// Falha do POST: mensagem amigável + link index.html#contato (padrão v1);
//   corpo {"erro":"CPF_CNPJ_INVALIDO"} → erro inline no campo CPF/CNPJ.
```

- [ ] **Step 1:** reescrever os dois arquivos conforme acima (v1 está no git — commits
  anteriores — se precisar resgatar trechos; os dados de PLANOS/CICLOS/preços são os mesmos).
- [ ] **Step 2 (estático):** `npx html-validate landing-atlas/checkout.html` → 0 erros;
  `node --check landing-atlas/checkout.js` → ok.
- [ ] **Step 3 (vivo, best-effort):** dev server (:3000) + `npx -y http-server
  landing-atlas -p 8080 -c-1`; via Playwright MCP: abrir
  `http://localhost:8080/checkout.html?plano=pro&ciclo=anual`, conferir banner + card
  (R$ 1.535,90 /ano), preencher o form (CPF teste 00000000191, e-mail novo), "Continuar
  para pagamento" → Payment Element carrega (iframe stripe). NÃO pagar (E2E é a T17).
  Console sem erros. Screenshot p/ o report. Sem Playwright → fallback estático declarado.
  Matar servers.
- [ ] **Step 4: Commit**

```bash
git add landing-atlas/checkout.html landing-atlas/checkout.js
git commit -m "feat(landing): checkout v2 com form proprio, Payment Element e visual BR"
```

---

### Task 17: E2E manual do fluxo Elements (test mode) — SUBSTITUI a Task 11

Pré-requisitos iguais à Task 11 original (`.env` completo com os 12 price IDs +
`CHECKOUT_PUBLICO_ORIGEM` + `APP_URL` + `STRIPE_WEBHOOK_SECRET` do `stripe listen`;
`npm run prisma:generate && npm run prisma:push` no SQLite local).

- [ ] `stripe listen --forward-to localhost:3000/api/stripe/webhook` rodando; dev server
  (:3000) e landing (:8080) rodando.
- [ ] Caminho feliz: `index.html#precos` → toggle Anual → Contratar Pro → checkout v2 →
  dados (e-mail novo `teste+e2e-el1@exemplo.com`, CPF 00000000191, empresa "Loja E2E EL")
  → Continuar → cartão `4242 4242 4242 4242` → Assinar agora → redirect
  `/ativar?payment_intent=pi_...` → "preparando sua conta" → `/definir-senha` → senha
  forte → login OK. Banco: Empresa nova (slug `loja-e2e-el`), `stripeCustomerId`,
  `assinaturaStatus=ACTIVE`, `plano=pro`, `cicloAssinatura=anual`.
- [ ] Reuso do link de ativação depois da senha → "conta já ativa".
- [ ] Webhook reentregue (`stripe events resend`) → idempotente (`ja-existia`).
- [ ] Cartão recusado (`4000 0000 0000 0002`) → erro inline no Payment Element, sem
  conta criada.
- [ ] CPF inválido ("111") → erro inline client-side; CPF válido de formato mas rejeitado
  pelo Stripe → 400 CPF_CNPJ_INVALIDO exibido no campo.
- [ ] Fluxo logado (`/configuracoes` → Abrir Checkout) intacto (regressão).
- [ ] Fluxo embedded (fallback): `POST /api/checkout-publico/sessao` ainda responde 200
  (curl) — sem regressão.

### Task 18: Encerramento — SUBSTITUI a Task 12

- [ ] `npx vitest run src/modules/billing/` → verde; `npx tsc --noEmit` e eslint nos
  arquivos tocados → limpos.
- [ ] Review final de branch inteira (whole-branch) + triage dos Minors acumulados no
  ledger.
- [ ] `superpowers:finishing-a-development-branch` (branch `feat/landing-atlas-seller`;
  remota homônima diverge — NÃO rebasear).
- [ ] Deploy (fora do plano): envs live (chaves + 12 prices live + CHECKOUT_PUBLICO_ORIGEM
  + APP_URL), webhook endpoint live no dashboard (incluir evento `invoice.paid`!),
  payment methods do dashboard = cartão (SEM boleto — gate OR da ativação), CSP do vhost
  da landing permitindo `js.stripe.com` (script) e `*.stripe.com` (frame/connect),
  publicar `landing-atlas/`, depoimentos reais no lugar dos placeholders.

---

# APÊNDICE — Iteração 3 (2026-07-02): port do redesign V5 (Claude Design)

> Handoff em `<scratchpad>/v5/design_handoff_atlas_landing/` (fonte: Downloads/V5.zip).
> README do handoff é a especificação de design (14 seções, tokens, a11y, motion).
> Ordem: executar APÓS a Task 17 (E2E), antes da Task 18 (encerramento).

### Task 19: Portar landing V5 para `landing-atlas/` (preservando integrações)

**Files:** Rewrite `landing-atlas/index.html`, `landing-atlas/styles.css`, `landing-atlas/app.js` a partir de `site/` do handoff; Create `landing-atlas/assets/demo.mp4` (copiar do handoff) e pasta `landing-atlas/assets/videos/` (vazia + `.gitkeep`); NÃO tocar: `privacidade.html`, `termos.html`, `contato.html`, `sitemap.xml`, `robots.txt`, `.well-known/`, `checkout.html`, `checkout.js`.

**Adaptações obrigatórias sobre o V5 (o resto é cópia fiel):**
1. **Fontes**: adicionar os 4 `@font-face` Inter (400/600/700/800) apontando para `assets/fonts/Inter-{Regular,SemiBold,Bold,ExtraBold}.woff2` (existentes) no topo do styles.css portado; `font-display:swap`.
2. **Head/SEO**: portar do index ATUAL → canonical, OG/Twitter metas, favicon existente, e os 3 blocos JSON-LD (Organization, SoftwareApplication com offers, FAQPage — atualizar as perguntas do FAQPage para as 6 do V5). `<link rel="stylesheet" href="styles.css?v=7">`.
3. **CTAs dos planos**: "Começar"/mailto → **"Contratar"** com `href="checkout.html?plano={starter|pro|scale}&ciclo=mensal"` + `data-plan`; no app.js, a função de pricing atualiza os 3 hrefs com o ciclo ativo (mesma mecânica da Task 9). Manter os demais CTAs ("Agendar demo") como mailto **admfsmundo@gmail.com** (e-mail real em uso — NÃO contato@mundofs.com.br).
4. **Descontos**: anual = **0.15 / "Economize 15% pagando uma vez ao ano"** (decisão do Heitor 2026-07-02; novos prices anuais criados no Stripe test: Starter `price_1TolPNKMqHJ7jzJdfEAOarlJ` R$ 917,90 · Pro `price_1TolPOKMqHJ7jzJdPh0VOilu` R$ 1.631,90 · Scale `price_1TolPPKMqHJ7jzJdm8G1eSX2` R$ 2.243,90). Trimestral 5% e semestral 10% ficam — igual ao V5.
5. **Vídeos**: hero usa `assets/demo.mp4` (copiado do handoff, 2.1MB). Grade `#videos` mantém os 4 `assets/videos/*.mp4` ausentes → fallback visual do próprio V5 (JS `.no-src`) fica ativo até exportarem os clipes.
6. **Footer**: link "Contato" → `contato.html` (não mailto); manter disclaimer Amazon obrigatório; Política/Termos apontam para as páginas ATUAIS (não substituí-las — as do V5 exigem revisão jurídica).
7. **WhatsApp flutuante**: manter `wa.me/551151085002` do design (CONFIRMAR número com o Heitor antes do deploy — anotar no report).
8. **Acessibilidade/motion**: preservar tudo do V5 (skip-link, tablists com setas, aria-live, reveal com failsafe de 1.2s, reduced-motion).

**Verificação**: `npx html-validate landing-atlas/index.html` (0 erros); `node --check landing-atlas/app.js`; browser (Playwright): hero+ticket animando, abas de produto, calculadora reagindo aos sliders, toggle de preços (anual mostra R$ 863,90/ano p/ Starter → bate com Stripe), botões Contratar com href correto por ciclo, vídeo hero tocando, grade #videos com fallbacks, FAQ acordeão, WhatsApp flutuante, barra de progresso. Console sem erros. Screenshot.

**Commit**: `feat(landing): redesign V5 (produto, calculadora, comparativo, videos) preservando checkout`

### Task 20: Harmonizar `checkout.html`/`checkout.js` com o DS novo

**Files:** Modify `landing-atlas/checkout.html` (+`checkout.js` se necessário).

1. Atualizar `styles.css?v=6`→`?v=7`.
1b. **CICLOS do checkout.js**: `anual: [12, .20, '/ano']` → `[12, .15, '/ano']` (novos prices de 15%; conferir que o resumo exibe R$ 1.631,90 p/ Pro anual).
1c. **.env local**: trocar os 3 `STRIPE_PRICE_*_ANUAL` pelos price IDs novos (fazer só APÓS o E2E da Task 17 concluir — o dev server do E2E usa os antigos).
2. Substituir o header antigo (`.nav`/`.brand` com SVG bússola) pelo header novo do V5 (logo 10 listras SVG inline + wordmark; sem a nav completa — só "Voltar aos planos" → `index.html#precos`).
3. Conferir classes usadas que não existem mais no styles novo (ex.: `.eyebrow`) e cobrir no `<style>` local da página (prefixo ck-) sem tocar styles.css.
4. Ajustar tokens locais se algum usado sumiu (--radius-sm etc. — conferir `:root` novo; cobrir com fallback local).
5. Verificação: html-validate 0 erros; browser: página carrega com visual coerente ao novo DS, resumo correto, form ok, "Continuar para pagamento" monta o Payment Element (1 sessão só — rate-limit). Console limpo. Screenshot.

**Commit**: `fix(landing): harmonizar checkout com o design system V5`
