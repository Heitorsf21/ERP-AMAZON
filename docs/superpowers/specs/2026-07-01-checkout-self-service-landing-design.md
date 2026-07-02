# Checkout self-service na landing Atlas Seller — Design

**Data:** 2026-07-01
**Status:** aprovado pelo Heitor (brainstorm em sessão) · **Iteração 2 aprovada em 2026-07-02** (ver adendo no fim)
**Branch alvo:** `feat/landing-atlas-seller`

## Contexto

O billing Stripe existe desde `6f2fc8b` (checkout/portal/webhook + campos de assinatura na
`Empresa`), mas só é acessível a usuário logado como ADMIN em `/configuracoes`. A landing
(`landing-atlas/`, estática, servida em `atlasseller.mundofs.cloud`) tem a seção `#precos`
com 3 planos × 4 ciclos, porém os botões "Começar" apontam para `#contato` (demo por
e-mail). Não existe signup público: empresas são criadas manualmente pela plataforma.

**Objetivo:** visitante da landing contrata sozinho — paga primeiro, a conta é provisionada
automaticamente depois, sem e-mail transacional.

**Estado do Stripe (test mode):** os 3 produtos (Atlas Seller Starter/Pro/Scale) e os
12 prices recorrentes em BRL (mensal/trimestral/semestral/anual) **já existem** — criados
pelo Heitor no dashboard. Nada a criar via API; só configurar os price IDs nas envs.

## Decisões tomadas (com o usuário)

1. Botão dos planos muda de **"Começar" → "Contratar"** e leva ao checkout.
2. Fluxo **"paga primeiro, conta depois"** — sem signup antes do pagamento.
3. Página de checkout **na própria landing** (`checkout.html`), com o design system dela,
   usando **Stripe Embedded Checkout** (form do Stripe embedado; PCI fica com o Stripe).
4. **Provisionamento automático via webhook** (`checkout.session.completed`).
5. Entrega de acesso **sem e-mail**: `return_url` com `session_id` → página `/ativar` no
   ERP → reemite convite → `/definir-senha` (fluxo de convite já existente).

## Arquitetura

### Jornada

```
landing #precos ──"Contratar"──▶ checkout.html?plano=pro&ciclo=anual
  └─ POST erp.mundofs.cloud/api/checkout-publico/sessao  → { clientSecret, publishableKey }
  └─ Stripe Embedded Checkout (e-mail, cartão, custom field "Nome da empresa/loja")
        │ pagamento aprovado
        ▼
erp.mundofs.cloud/ativar?session_id={CHECKOUT_SESSION_ID}
  └─ valida session paga ─ localiza Empresa (provisionada pelo webhook)
  └─ nunca definiu senha? → reemite convite → /definir-senha?token=...
  └─ já ativou? → "conta já ativa, faça login"

(em paralelo) webhook checkout.session.completed {origem:"landing"}
  └─ criarEmpresa() + stripeCustomerId + aplicarAssinaturaStripe()
```

### Componente 1 — Landing (`landing-atlas/`, estático)

- `index.html`: os 3 botões dos planos viram "Contratar" com
  `href="checkout.html?plano=<id>&ciclo=<ciclo>"`. `app.js` atualiza o parâmetro `ciclo`
  dos 3 links quando o toggle de período muda (hoje o toggle só recalcula preços).
- `checkout.html` (nova): header enxuto com logo + duas colunas —
  esquerda: resumo do plano (nome, features, preço do ciclo com equivalente mensal,
  troca de plano/ciclo); direita: `<div id="checkout">` onde o Stripe monta o form.
  Segue foundations/components de `landing-atlas/design-system/`.
- `checkout.js` (novo): lê `?plano=&ciclo=` (defaults: `pro`/`mensal`; valores inválidos
  caem no default), chama o endpoint público, recebe `{ clientSecret, publishableKey }`,
  monta `stripe.initEmbeddedCheckout`. Trocar plano/ciclo = destruir o embed e recriar a
  sessão. Erros do endpoint → mensagem amigável + fallback "fale conosco" (`#contato`).
- Stripe.js v3 via `<script src="https://js.stripe.com/v3/">`. **Sem SRI de propósito**:
  a Stripe não publica hashes e atualiza o bundle dinamicamente (exigência PCI de servir
  sempre de `js.stripe.com`); `integrity` fixo quebraria o checkout na primeira
  atualização deles. Mitigação: escopo do script limitado à página de checkout.
- **A landing não guarda chave nenhuma** — a publishable key vem do endpoint. Trocar
  test→live é só env no ERP.
- `sitemap.xml`: incluir `checkout.html`? Não — página transacional, `robots noindex`.

### Componente 2 — ERP: endpoint público de sessão

- Rota: `POST /api/checkout-publico/sessao` (Next.js App Router, `runtime nodejs`).
- Body `{ plano, ciclo }` validado com `parseBillingPlanId`/`parseBillingPeriod`
  (já existem em `src/modules/billing/plans.ts`).
- Service: `criarCheckoutPublicoLanding({ planId, period })` em
  `src/modules/billing/service.ts`:
  - `stripe.checkout.sessions.create` com `ui_mode: "embedded"`, `mode: "subscription"`,
    **sem `customer`** (Stripe cria um novo no pagamento),
    `line_items: [{ price: getStripePriceId(planId, period), quantity: 1 }]`,
    `custom_fields: [{ key: "nome_empresa", label: "Nome da sua empresa/loja",
    type: "text", optional: false }]`,
    `metadata: { origem: "landing", plano, ciclo }` (idem em
    `subscription_data.metadata`),
    `return_url: ${APP_URL}/ativar?session_id={CHECKOUT_SESSION_ID}`,
    `allow_promotion_codes`, `billing_address_collection: "auto"`,
    `tax_id_collection` — espelhando o checkout logado.
  - Retorna `{ clientSecret: session.client_secret }`.
- Resposta da rota: `{ clientSecret, publishableKey }` (publishable vem de
  `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`).
- **Não escreve nada no banco** (diferente do fluxo logado, que grava
  `CHECKOUT_ABERTO` na Empresa — aqui não há empresa ainda).
- Proteções:
  - Rota pública no `proxy.ts` (mesmo mecanismo do `/api/stripe/webhook`).
  - **CORS**: `Access-Control-Allow-Origin` restrito a `CHECKOUT_PUBLICO_ORIGEM`
    (env, ex: `https://atlasseller.mundofs.cloud`); handler `OPTIONS` para preflight.
  - **Rate-limit por IP**: `consumeRateLimit("checkout-publico:" + ip, janela 15min,
    ~10 tentativas)` — infra já existe em `src/lib/auth-rate-limit.ts`.
  - Logs via `pino` (`logger`), nunca `console.log`.

### Componente 3 — Webhook: provisionamento automático

Em `processarEventoStripe` (`src/modules/billing/service.ts`), no case
`checkout.session.completed`:

1. Se `session.metadata?.origem === "landing"` → `provisionarEmpresaDoCheckout(session)`
   ANTES do `aplicarAssinaturaStripe` atual (para o match por `stripeCustomerId` achar a
   empresa recém-criada).
2. `provisionarEmpresaDoCheckout`:
   - **Idempotência**: `db.empresa.findFirst({ where: { stripeCustomerId } })` — se já
     existe, retorna sem criar (webhook pode reentregar o evento).
   - Nome da empresa: custom field `nome_empresa` → fallback
     `session.customer_details?.name` → fallback e-mail.
   - Slug: slugify do nome (minúsculo, sem acento, hífens) validado por `validarSlug`;
     colisão → sufixo aleatório curto (ex: `-x7k2`). Loop com limite de tentativas.
   - Admin: `nome = customer_details.name ?? prefixo do e-mail`,
     `email = customer_details.email` (obrigatório — sem e-mail, loga erro e aborta),
     **sem senha** → `criarEmpresa()` existente já cria o hash aleatório inutilizável +
     `ConviteUsuario` (o rawToken desse convite é descartado; a ativação reemite).
   - Pós-criação: `db.empresa.update` gravando `stripeCustomerId`.
   - E-mail já usado por outro usuário (`email @unique`)? Loga erro estruturado e
     **não cria** — caso vira manual (Notificação futura fica fora de escopo).
3. `aplicarAssinaturaStripe` continua igual — agora encontra a empresa por
   `stripeCustomerId` e preenche plano/ciclo/status/period end.

### Componente 4 — ERP: página de ativação `/ativar`

- Página pública Next.js (`src/app/ativar/page.tsx`), layout standalone (sem sidebar),
  visual da marca (`brand-mark`). Liberada no `proxy.ts`.
- Server-side (`searchParams` é **Promise** no Next 16 — `await`):
  1. `stripe.checkout.sessions.retrieve(session_id)`; exige
     `payment_status === "paid"` (ou `status === "complete"`). Inválida/não paga →
     tela de erro com link para a landing.
  2. Localiza `Empresa` por `stripeCustomerId` da session.
  3. Não achou (webhook ainda processando) → tela "estamos preparando sua conta" com
     auto-refresh (~3s, máx ~30s; depois orienta contato).
  4. Achou → regra do convite (abaixo) → redirect `/definir-senha?token=...` ou tela
     "conta já ativa" com link de login.
- **Regra de reemissão do convite (segurança):** só reemite se o admin **nunca definiu
  senha** — critério: nenhum `ConviteUsuario` do admin com `usadoEm != null`. Reemissão
  usa a mesma mecânica de `reenviarConvite` (invalida pendentes, cria novo, retorna
  rawToken). Depois da primeira senha definida, o `session_id` deixa de dar acesso —
  não vira porta dos fundos eterna.
- Rate-limit por IP na ação de reemissão (mesma infra).

### Componente 5 — Configuração / envs

- Novas envs (adicionar ao `.env.example` com comentário):
  - `CHECKOUT_PUBLICO_ORIGEM` — origem CORS da landing.
- Envs existentes a preencher no ambiente: `STRIPE_SECRET_KEY`,
  `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET` e os 12
  `STRIPE_PRICE_*` (test mode local; live na VPS quando for ao ar).
- Price IDs test mode (já criados no dashboard):
  - Starter: mensal `price_1ToRkVKMqHJ7jzJduKUTpEB6` · trimestral
    `price_1ToRmQKMqHJ7jzJdOngcIfAa` · semestral `price_1ToRmQKMqHJ7jzJdmwPQkNLb` ·
    anual `price_1TolPNKMqHJ7jzJdfEAOarlJ` (15% — R$ 917,90; antigo 20% price_1ToRmQKMqHJ7jzJdnTkiEkwi descontinuado)
  - Pro: mensal `price_1ToRniKMqHJ7jzJd5GEPrRJK` · trimestral
    `price_1ToRniKMqHJ7jzJd1AwLhrOP` · semestral `price_1ToRniKMqHJ7jzJd5e97eRM9` ·
    anual `price_1TolPOKMqHJ7jzJdPh0VOilu` (15% — R$ 1.631,90; antigo price_1ToRniKMqHJ7jzJd08baH3a6 descontinuado)
  - Scale: mensal `price_1ToRnyKMqHJ7jzJdJJf6q9Hc` · trimestral
    `price_1ToRoXKMqHJ7jzJd6nhCrcrj` · semestral `price_1ToRoXKMqHJ7jzJdyIw7LO47` ·
    anual `price_1TolPPKMqHJ7jzJdm8G1eSX2` (15% — R$ 2.243,90; antigo price_1ToRoXKMqHJ7jzJd01EDAfMb descontinuado)
- Webhook local para teste: `stripe listen --forward-to localhost:3000/api/stripe/webhook`.
- **Sem migration**: nenhum campo novo no schema (tudo já existe de `6f2fc8b`).

## Segurança (resumo)

- Endpoint público não recebe dado sensível e não escreve no banco; rate-limit + CORS.
- `session_id` como credencial de ativação: verificável server-side no Stripe, só o
  pagador o recebe, e expira funcionalmente após a primeira definição de senha.
- Convite reusa política existente: token 32 bytes, hash SHA-256 no banco, TTL 7d,
  senha forte (`strongPasswordSchema`), resposta anti-enumeração.
- Webhook já valida assinatura (`STRIPE_WEBHOOK_SECRET`) — inalterado.

## Fora de escopo

E-mail transacional · gating de features por plano · trial · mudanças no fluxo logado de
`/configuracoes` · Pix/boleto (payment methods ficam no padrão do dashboard = cartão) ·
Notificação interna de provisionamento falho (caso manual via logs por enquanto).

## Testes

- **Vitest** (padrão dos módulos):
  - `provisionarEmpresaDoCheckout`: cria empresa+admin; idempotente por
    `stripeCustomerId`; fallbacks de nome; slug com colisão; e-mail duplicado aborta.
  - Regra de reemissão de convite: nunca-definiu-senha reemite; já-definiu não reemite.
  - Validação do body do endpoint público (plano/ciclo inválidos → 400).
- **Manual (test mode)**: fluxo completo com cartão `4242 4242 4242 4242` nos 3 planos;
  troca de ciclo na página; "fechou a aba antes de ativar" + reenviar convite pela
  plataforma; evento de webhook reentregue (idempotência).

## Riscos e mitigação

- **Webhook atrasado na ativação** → tela de espera com retry; conta nunca se perde
  (provisionamento é do webhook, não da página).
- **Abuso do endpoint público** (criação de sessões em massa) → rate-limit por IP;
  sessões Stripe não pagas expiram sozinhas em ~24h, sem lixo no nosso banco.
- **CSP/headers da landing** — verificar no deploy que o vhost permite scripts/frames de
  `js.stripe.com` (hoje a landing não define CSP restritiva; conferir antes de subir).

---

## Adendo — Iteração 2 (2026-07-02): form próprio (Stripe Elements) + visual de checkout BR

Heitor aprovou uma referência visual (checkout "Hermes/Checkout Sun") e decidiu, ciente do
trade-off de escopo: **formulário de pagamento próprio via Stripe Elements** (Payment
Element), não mais o Embedded Checkout, mais os elementos visuais do modelo:

1. **Banner hero** no topo da página de checkout (mensagem do produto + screenshot).
2. **Card do plano rico**: nome em destaque, preço grande, benefícios com ✓, selo.
3. **Depoimentos com estrelas** (social proof) — TEXTOS PLACEHOLDER até o Heitor mandar
   os reais; marcar claramente no código.
4. **Selos de segurança/sigilo** (🔒 dados em sigilo · processado pelo Stripe).

### Fluxo técnico v2 (substitui o miolo de pagamento; provisão/ativação permanecem)

- **Form próprio** na landing coleta: nome completo, e-mail (+confirmação client-side),
  CPF/CNPJ (11 ou 14 dígitos → `tax_id_data` `br_cpf`/`br_cnpj`), celular, nome da
  empresa/loja (opcional, fallback = nome completo), aceite dos Termos (checkbox
  obrigatório, link `termos.html`). Pagamento: **cartão** via Payment Element (assinatura
  recorrente exige cartão; Pix segue fora de escopo).
- **Novo endpoint** `POST /api/checkout-publico/assinatura` (CORS restrito + rate-limit
  10/15min + try/catch com headers CORS — lição da rota `sessao`): cria
  `customers.create({name, email, phone, tax_id_data, metadata:{origem:"landing",
  nome_empresa}})` + `subscriptions.create({customer, items:[{price}],
  payment_behavior:"default_incomplete",
  payment_settings:{save_default_payment_method:"on_subscription"},
  expand:["latest_invoice.confirmation_secret"], metadata:{origem:"landing", plano,
  ciclo}})` e devolve `{clientSecret: latest_invoice.confirmation_secret.client_secret,
  publishableKey}`. (Confirmado no stripe@22.3.0: `Invoice.confirmation_secret =
  {client_secret, type:"payment_intent"}`.)
- **UI em 2 etapas na mesma página**: dados → "Continuar para pagamento" (cria a
  assinatura) → Payment Element → `stripe.confirmPayment({elements, confirmParams:
  {return_url: ERP/ativar}})`.
- **Retorno**: Stripe redireciona para `/ativar?payment_intent=pi_...&
  payment_intent_client_secret=...&redirect_status=...`. Rota de ativação passa a
  aceitar `paymentIntentId` (exige `status === "succeeded"`, customer do PI) ALÉM do
  `sessionId` legado. `ativarPorCustomer` inalterado.
- **Webhook**: provisionamento também dispara em `invoice.paid` com
  `billing_reason === "subscription_create"` e `subscription.metadata.origem ===
  "landing"` — extrai email/nome do **customer** (retrieve) e `nome_empresa` do metadata.
  O caminho `checkout.session.completed` (embedded) permanece como retrocompat; o
  endpoint `sessao` e a página embedded ficam como fallback (código testado, sem churn).
- **Customers órfãos** (criados sem pagamento concluído) e subscriptions
  `incomplete_expired` são aceitos como lixo benigno no Stripe (expiram/limpáveis via
  dashboard); nada persiste no nosso banco antes do `invoice.paid`.

### Riscos novos

- Payment Element + confirmation_secret é o fluxo recomendado da API atual, mas o E2E
  (cartão 4242) é obrigatório antes de qualquer deploy.
- CPF/CNPJ inválido → `tax_id_invalid` do Stripe: validar formato no client E tratar o
  erro no server devolvendo 400 legível (`{"erro":"CPF_CNPJ_INVALIDO"}`).
