# Credenciais OAuth Amazon por seller — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: use `superpowers:subagent-driven-development` (recomendado) ou `superpowers:executing-plans` para implementar tarefa-a-tarefa. Os passos usam checkbox (`- [ ]`).

**Goal:** Mover o `refresh_token` da Amazon de uma chave GLOBAL única para um campo cifrado por `AmazonAccount` (por empresa), com fluxo de consentimento OAuth web, resolver de credenciais e worker iterando contas — destravando o SaaS multi-seller (achado CRITICAL F02).

**Architecture:** Abordagem A — `client_id`/`client_secret` continuam app-level (config global, cifrados); `refresh_token` vira per-seller cifrado no `AmazonAccount`. Um resolver mescla os dois. Rotas OAuth (`iniciar`/`callback`/`desconectar`) fazem o consentimento. Worker itera contas `ATIVA` sob `runWithTenant`. Cardinalidade 1:1 (uma conta Amazon por empresa).

**Tech Stack:** Next.js 16 App Router, Prisma 5 (SQLite dev / Postgres prod), `node:crypto` (AES-256-GCM via `src/lib/crypto.ts`, HMAC para state), Zod, vitest.

**Spec:** `docs/superpowers/specs/2026-06-02-amazon-oauth-multiseller-credenciais-design.md`

---

## Estrutura de arquivos

- **Criar** `src/modules/amazon/oauth.ts` — funções puras/I/O do OAuth: assinar/verificar `state`, montar authorization URL, trocar code por refresh_token.
- **Criar** `src/modules/amazon/oauth.test.ts` — testes das funções puras + parser.
- **Criar** `src/app/api/amazon/oauth/iniciar/route.ts` — inicia consentimento (302).
- **Criar** `src/app/api/amazon/oauth/callback/route.ts` — recebe code, troca, grava cifrado.
- **Criar** `src/app/api/amazon/oauth/desconectar/route.ts` — limpa o grant.
- **Criar** `scripts/migrar-credenciais-amazon-para-conta.ts` — migra refresh_token global → AmazonAccount (idempotente, `--dry-run`).
- **Modificar** `prisma/schema.prisma` e `prisma/schema.postgresql.prisma` — campos novos em `AmazonAccount`.
- **Criar** `prisma/migrations/<TIMESTAMP>_amazon_account_oauth/migration.sql` — DDL manual Postgres.
- **Modificar** `src/modules/amazon/service.ts` — `resolverCredenciaisDaConta(empresaId)` + `getAppCredentials()`.
- **Modificar** `src/modules/amazon/worker.ts` — iterar contas ATIVA por tenant.

---

## Task 1: Schema — campos de credencial no AmazonAccount

**Files:**
- Modify: `prisma/schema.postgresql.prisma` (model `AmazonAccount`)
- Modify: `prisma/schema.prisma` (model `AmazonAccount`)
- Create: `prisma/migrations/<TIMESTAMP>_amazon_account_oauth/migration.sql`

- [ ] **Step 1: Adicionar campos nos dois schemas**

Em AMBOS os arquivos, no model `AmazonAccount`, após `endpoint String?`, adicionar:

```prisma
  refreshTokenEnc String?
  accessTokenEnc  String?
  tokenExpiresAt  DateTime?
  lwaScopes       String?
  conectadoEm     DateTime?
```

- [ ] **Step 2: Criar a migration SQL manual (Postgres — sem shadow DB)**

Gere o timestamp: `node -e "console.log(new Date().toISOString().replace(/[-:TZ.]/g,'').slice(0,14))"`.
Crie `prisma/migrations/<TIMESTAMP>_amazon_account_oauth/migration.sql`:

```sql
ALTER TABLE "AmazonAccount" ADD COLUMN "refreshTokenEnc" TEXT;
ALTER TABLE "AmazonAccount" ADD COLUMN "accessTokenEnc" TEXT;
ALTER TABLE "AmazonAccount" ADD COLUMN "tokenExpiresAt" TIMESTAMP(3);
ALTER TABLE "AmazonAccount" ADD COLUMN "lwaScopes" TEXT;
ALTER TABLE "AmazonAccount" ADD COLUMN "conectadoEm" TIMESTAMP(3);
```

- [ ] **Step 3: Aplicar no dev (SQLite) e gerar client**

Run: `npm run prisma:generate && npm run prisma:push`
Expected: `AmazonAccount` com os novos campos; client regenerado. (Prod usará `prisma:migrate:deploy:pg` + `prisma:generate:pg` no deploy.)

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/schema.postgresql.prisma prisma/migrations
git commit -m "feat(amazon-oauth): campos de credencial cifrada no AmazonAccount"
```

---

## Task 2: OAuth — assinar/verificar `state` (anti-CSRF, puro)

**Files:**
- Create: `src/modules/amazon/oauth.ts`
- Test: `src/modules/amazon/oauth.test.ts`

- [ ] **Step 1: Escrever o teste que falha**

```ts
import { describe, expect, it } from "vitest";
import { assinarState, verificarState } from "./oauth";

const SECRET = "x".repeat(48);

describe("state OAuth (anti-CSRF)", () => {
  it("verifica um state válido recém-assinado", () => {
    const token = assinarState({ empresaId: "e1", nonce: "n1", exp: 2000 }, SECRET);
    expect(verificarState(token, 1000, SECRET)).toEqual({ empresaId: "e1", nonce: "n1", exp: 2000 });
  });
  it("rejeita state expirado", () => {
    const token = assinarState({ empresaId: "e1", nonce: "n1", exp: 500 }, SECRET);
    expect(verificarState(token, 1000, SECRET)).toBeNull();
  });
  it("rejeita state adulterado (assinatura inválida)", () => {
    const token = assinarState({ empresaId: "e1", nonce: "n1", exp: 2000 }, SECRET);
    const adulterado = token.slice(0, -2) + (token.endsWith("a") ? "bb" : "aa");
    expect(verificarState(adulterado, 1000, SECRET)).toBeNull();
  });
  it("rejeita assinatura feita com outro segredo", () => {
    const token = assinarState({ empresaId: "e1", nonce: "n1", exp: 2000 }, SECRET);
    expect(verificarState(token, 1000, "y".repeat(48))).toBeNull();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run src/modules/amazon/oauth.test.ts`
Expected: FAIL — `Cannot find module './oauth'`.

- [ ] **Step 3: Implementar (mínimo)**

Criar `src/modules/amazon/oauth.ts`:

```ts
import { createHmac, timingSafeEqual } from "node:crypto";

export type OAuthState = { empresaId: string; nonce: string; exp: number };

function b64url(s: string): string {
  return Buffer.from(s, "utf8").toString("base64url");
}
function fromB64url(s: string): string {
  return Buffer.from(s, "base64url").toString("utf8");
}
function sign(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export function assinarState(state: OAuthState, secret: string): string {
  const payload = b64url(JSON.stringify(state));
  return `${payload}.${sign(payload, secret)}`;
}

export function verificarState(
  token: string,
  agoraSegundos: number,
  secret: string,
): OAuthState | null {
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  const esperado = sign(payload, secret);
  const a = Buffer.from(sig);
  const b = Buffer.from(esperado);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const state = JSON.parse(fromB64url(payload)) as OAuthState;
    if (typeof state.exp !== "number" || state.exp < agoraSegundos) return null;
    return state;
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run src/modules/amazon/oauth.test.ts`
Expected: PASS (4 testes).

- [ ] **Step 5: Commit**

```bash
git add src/modules/amazon/oauth.ts src/modules/amazon/oauth.test.ts
git commit -m "feat(amazon-oauth): state assinado anti-CSRF"
```

---

## Task 3: OAuth — montar authorization URL (puro)

**Files:**
- Modify: `src/modules/amazon/oauth.ts`
- Test: `src/modules/amazon/oauth.test.ts`

- [ ] **Step 1: Teste que falha**

Adicionar ao `oauth.test.ts`:

```ts
import { montarAuthorizationUrl } from "./oauth";

describe("montarAuthorizationUrl", () => {
  it("inclui application_id e state; version=beta só em draft", () => {
    const url = montarAuthorizationUrl({
      sellerCentralBase: "https://sellercentral.amazon.com.br",
      applicationId: "amzn1.app.123",
      state: "STATE",
      draft: true,
    });
    expect(url).toContain("https://sellercentral.amazon.com.br/apps/authorize/consent");
    expect(url).toContain("application_id=amzn1.app.123");
    expect(url).toContain("state=STATE");
    expect(url).toContain("version=beta");
  });
  it("sem version=beta quando publicado", () => {
    const url = montarAuthorizationUrl({
      sellerCentralBase: "https://sellercentral.amazon.com.br",
      applicationId: "amzn1.app.123",
      state: "STATE",
      draft: false,
    });
    expect(url).not.toContain("version=beta");
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run src/modules/amazon/oauth.test.ts`
Expected: FAIL — `montarAuthorizationUrl is not a function`.

- [ ] **Step 3: Implementar**

Adicionar em `src/modules/amazon/oauth.ts`:

```ts
export function montarAuthorizationUrl(opts: {
  sellerCentralBase: string;
  applicationId: string;
  state: string;
  draft: boolean;
}): string {
  const url = new URL("/apps/authorize/consent", opts.sellerCentralBase);
  url.searchParams.set("application_id", opts.applicationId);
  url.searchParams.set("state", opts.state);
  if (opts.draft) url.searchParams.set("version", "beta");
  return url.toString();
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run src/modules/amazon/oauth.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/amazon/oauth.ts src/modules/amazon/oauth.test.ts
git commit -m "feat(amazon-oauth): montar authorization URL"
```

---

## Task 4: OAuth — trocar code por refresh_token (I/O, fetch injetável)

**Files:**
- Modify: `src/modules/amazon/oauth.ts`
- Test: `src/modules/amazon/oauth.test.ts`

- [ ] **Step 1: Teste que falha (fetch fake)**

```ts
import { trocarCodePorRefreshToken } from "./oauth";

describe("trocarCodePorRefreshToken", () => {
  const creds = { clientId: "cid", clientSecret: "sec", redirectUri: "https://app/cb" };

  it("retorna refresh/access token no sucesso", async () => {
    const fakeFetch = async () =>
      new Response(JSON.stringify({ refresh_token: "RT", access_token: "AT", expires_in: 3600 }), { status: 200 });
    const r = await trocarCodePorRefreshToken("CODE", creds, fakeFetch as typeof fetch);
    expect(r).toEqual({ refreshToken: "RT", accessToken: "AT", expiresIn: 3600 });
  });

  it("lança quando a Amazon responde erro", async () => {
    const fakeFetch = async () =>
      new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 });
    await expect(trocarCodePorRefreshToken("CODE", creds, fakeFetch as typeof fetch)).rejects.toThrow();
  });

  it("lança quando falta refresh_token na resposta", async () => {
    const fakeFetch = async () => new Response(JSON.stringify({ access_token: "AT" }), { status: 200 });
    await expect(trocarCodePorRefreshToken("CODE", creds, fakeFetch as typeof fetch)).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run src/modules/amazon/oauth.test.ts`
Expected: FAIL — `trocarCodePorRefreshToken is not a function`.

- [ ] **Step 3: Implementar**

Adicionar em `src/modules/amazon/oauth.ts`:

```ts
const LWA_TOKEN_URL = "https://api.amazon.com/auth/o2/token";

export async function trocarCodePorRefreshToken(
  code: string,
  creds: { clientId: string; clientSecret: string; redirectUri: string },
  fetchImpl: typeof fetch = fetch,
): Promise<{ refreshToken: string; accessToken: string; expiresIn: number }> {
  const resp = await fetchImpl(LWA_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded;charset=UTF-8" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: creds.redirectUri,
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
    }),
  });
  const payload = (await resp.json().catch(() => ({}))) as Record<string, unknown>;
  if (!resp.ok) {
    throw new Error(`LWA authorization_code error ${resp.status}: ${String(payload.error ?? "")}`);
  }
  if (typeof payload.refresh_token !== "string" || typeof payload.access_token !== "string") {
    throw new Error("LWA: resposta sem refresh_token/access_token");
  }
  return {
    refreshToken: payload.refresh_token,
    accessToken: payload.access_token,
    expiresIn: typeof payload.expires_in === "number" ? payload.expires_in : 3600,
  };
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run src/modules/amazon/oauth.test.ts`
Expected: PASS (todos).

- [ ] **Step 5: Commit**

```bash
git add src/modules/amazon/oauth.ts src/modules/amazon/oauth.test.ts
git commit -m "feat(amazon-oauth): trocar authorization_code por refresh_token"
```

---

## Task 5: Resolver de credenciais por conta

**Files:**
- Modify: `src/modules/amazon/service.ts`
- Test: `src/modules/amazon/credenciais.test.ts` (novo — testa a parte pura de merge)

> Nota: `resolverCredenciaisDaConta` faz I/O (lê `AmazonAccount`). Extraia a lógica de MERGE para uma função pura `montarCredenciais(appCreds, conta)` e teste-a; a função async só busca e delega.

- [ ] **Step 1: Teste que falha (merge puro)**

Criar `src/modules/amazon/credenciais.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { montarCredenciais } from "./service";

describe("montarCredenciais", () => {
  const app = { clientId: "cid", clientSecret: "sec" };

  it("mescla app-cred + conta (refresh_token decifrado)", () => {
    const creds = montarCredenciais(app, {
      refreshToken: "RT",
      marketplaceId: "MKT",
      endpoint: "https://sellingpartnerapi-na.amazon.com",
    });
    expect(creds).toEqual({
      clientId: "cid",
      clientSecret: "sec",
      refreshToken: "RT",
      marketplaceId: "MKT",
      endpoint: "https://sellingpartnerapi-na.amazon.com",
    });
  });

  it("lança quando falta refresh_token", () => {
    expect(() => montarCredenciais(app, { refreshToken: "", marketplaceId: "MKT" })).toThrow();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run src/modules/amazon/credenciais.test.ts`
Expected: FAIL — `montarCredenciais is not a function`.

- [ ] **Step 3: Implementar em `service.ts`**

Adicionar (exportado) — usa `SPAPICredentials` de `@/lib/amazon-sp-api` e `decryptConfigValue` de `@/lib/crypto` (já importado no arquivo):

```ts
import type { SPAPICredentials } from "@/lib/amazon-sp-api";

export function montarCredenciais(
  app: { clientId: string; clientSecret: string },
  conta: { refreshToken: string; marketplaceId?: string | null; endpoint?: string | null },
): SPAPICredentials {
  if (!conta.refreshToken) throw new Error("[amazon] conta sem refresh_token (não conectada)");
  return {
    clientId: app.clientId,
    clientSecret: app.clientSecret,
    refreshToken: conta.refreshToken,
    marketplaceId: conta.marketplaceId || DEFAULT_MARKETPLACE_ID,
    endpoint: conta.endpoint || undefined,
  };
}

/** App-level creds (client_id/secret) — globais, do app no Developer Console. */
export async function getAppCredentials(): Promise<{ clientId: string; clientSecret: string }> {
  const cfg = await getAmazonConfig();
  return { clientId: cfg.amazon_client_id, clientSecret: cfg.amazon_client_secret };
}

/** Resolve as credenciais SP-API da conta ATIVA de uma empresa (filtro explícito de empresaId). */
export async function resolverCredenciaisDaConta(empresaId: string): Promise<SPAPICredentials> {
  const conta = await db.amazonAccount.findFirst({
    where: { empresaId, ativa: true, status: "ATIVA" },
  });
  if (!conta?.refreshTokenEnc) {
    throw new Error(`[amazon] empresa ${empresaId} sem conta Amazon conectada`);
  }
  const app = await getAppCredentials();
  return montarCredenciais(app, {
    refreshToken: decryptConfigValue(conta.refreshTokenEnc) ?? "",
    marketplaceId: conta.marketplaceId,
    endpoint: conta.endpoint,
  });
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run src/modules/amazon/credenciais.test.ts`
Expected: PASS (2 testes).

- [ ] **Step 5: Commit**

```bash
git add src/modules/amazon/service.ts src/modules/amazon/credenciais.test.ts
git commit -m "feat(amazon-oauth): resolver de credenciais por conta (app-cred + grant)"
```

---

## Task 6: Rota — iniciar consentimento

**Files:**
- Create: `src/app/api/amazon/oauth/iniciar/route.ts`

> Pré-requisito de config (env): `AMAZON_APP_ID` (application_id do Developer Console), `AMAZON_SELLERCENTRAL_BASE` (default `https://sellercentral.amazon.com.br`), `AMAZON_OAUTH_DRAFT` ("true" enquanto o app for draft), `APP_URL` (para montar o redirect_uri). Documentar no `.env.example`.

- [ ] **Step 1: Implementar a rota**

```ts
import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { requireRole, UsuarioRole } from "@/lib/auth";
import { assinarState, montarAuthorizationUrl } from "@/modules/amazon/oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const session = await requireRole(UsuarioRole.ADMIN);
  if (!session.empresaId) {
    return NextResponse.json({ erro: "SEM_EMPRESA" }, { status: 400 });
  }
  const secret = process.env.SESSION_SECRET;
  if (!secret) return NextResponse.json({ erro: "CONFIG" }, { status: 500 });

  const nonce = randomBytes(16).toString("hex");
  const exp = Math.floor(Date.now() / 1000) + 600; // 10 min
  const state = assinarState({ empresaId: session.empresaId, nonce, exp }, secret);

  const url = montarAuthorizationUrl({
    sellerCentralBase: process.env.AMAZON_SELLERCENTRAL_BASE ?? "https://sellercentral.amazon.com.br",
    applicationId: process.env.AMAZON_APP_ID ?? "",
    state,
    draft: process.env.AMAZON_OAUTH_DRAFT === "true",
  });
  return NextResponse.redirect(url);
}
```

- [ ] **Step 2: Verificação manual**

Run: `npm run dev:web` e abra `/api/amazon/oauth/iniciar` logado como ADMIN.
Expected: 302 para `sellercentral.amazon.com.br/apps/authorize/consent?...` com `state` e `application_id`.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/amazon/oauth/iniciar/route.ts
git commit -m "feat(amazon-oauth): rota iniciar consentimento"
```

---

## Task 7: Rota — callback (troca + grava cifrado)

**Files:**
- Create: `src/app/api/amazon/oauth/callback/route.ts`
- Modify: `src/lib/crypto.ts` (reusa `encryptConfigValue` — já existe)

- [ ] **Step 1: Implementar a rota**

```ts
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { requireRole, UsuarioRole } from "@/lib/auth";
import { encryptConfigValue } from "@/lib/crypto";
import { trocarCodePorRefreshToken, verificarState } from "@/modules/amazon/oauth";
import { getAppCredentials } from "@/modules/amazon/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const session = await requireRole(UsuarioRole.ADMIN);
  const url = new URL(req.url);
  const code = url.searchParams.get("spapi_oauth_code");
  const stateToken = url.searchParams.get("state");
  const sellerId = url.searchParams.get("selling_partner_id");

  const secret = process.env.SESSION_SECRET;
  if (!code || !stateToken || !secret) {
    return NextResponse.json({ erro: "CALLBACK_INVALIDO" }, { status: 400 });
  }
  const state = verificarState(stateToken, Math.floor(Date.now() / 1000), secret);
  // Binding anti-CSRF: o state TEM que ser da mesma empresa logada.
  if (!state || state.empresaId !== session.empresaId) {
    return NextResponse.json({ erro: "STATE_INVALIDO" }, { status: 400 });
  }

  try {
    const app = await getAppCredentials();
    const redirectUri = `${process.env.APP_URL ?? ""}/api/amazon/oauth/callback`;
    const { refreshToken } = await trocarCodePorRefreshToken(code, {
      clientId: app.clientId,
      clientSecret: app.clientSecret,
      redirectUri,
    });

    await db.amazonAccount.updateMany({
      where: { empresaId: state.empresaId },
      data: {
        refreshTokenEnc: encryptConfigValue(refreshToken),
        sellerId: sellerId ?? undefined,
        status: "ATIVA",
        ativa: true,
        conectadoEm: new Date(),
      },
    });
    // Se nenhuma conta existia, cria uma.
    const existe = await db.amazonAccount.findFirst({ where: { empresaId: state.empresaId } });
    if (!existe) {
      await db.amazonAccount.create({
        data: {
          empresaId: state.empresaId,
          nome: "Conta Amazon",
          sellerId: sellerId ?? undefined,
          refreshTokenEnc: encryptConfigValue(refreshToken),
          status: "ATIVA",
          conectadoEm: new Date(),
        },
      });
    }

    return NextResponse.redirect(new URL("/amazon?conectado=1", req.url));
  } catch (err) {
    logger.error({ err: err instanceof Error ? err.message : String(err) }, "[amazon-oauth] callback falhou");
    await db.amazonAccount
      .updateMany({ where: { empresaId: state.empresaId }, data: { status: "ERRO" } })
      .catch(() => {});
    return NextResponse.redirect(new URL("/amazon?erro=oauth", req.url));
  }
}
```

- [ ] **Step 2: Garantir que o callback NÃO está em PUBLIC_PATHS**

Verifique `src/proxy.ts`: `/api/amazon/oauth/callback` deve passar pela auth normal (o browser carrega o cookie sob `sameSite=lax` na navegação top-level). Não adicione a PUBLIC_PATHS.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/amazon/oauth/callback/route.ts
git commit -m "feat(amazon-oauth): callback troca code e grava refresh_token cifrado"
```

---

## Task 8: Rota — desconectar

**Files:**
- Create: `src/app/api/amazon/oauth/desconectar/route.ts`

- [ ] **Step 1: Implementar**

```ts
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireRole, UsuarioRole } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  const session = await requireRole(UsuarioRole.ADMIN);
  if (!session.empresaId) return NextResponse.json({ erro: "SEM_EMPRESA" }, { status: 400 });
  await db.amazonAccount.updateMany({
    where: { empresaId: session.empresaId },
    data: { refreshTokenEnc: null, accessTokenEnc: null, tokenExpiresAt: null, status: "PENDENTE" },
  });
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/api/amazon/oauth/desconectar/route.ts
git commit -m "feat(amazon-oauth): rota desconectar conta"
```

---

## Task 9: Worker — iterar contas ATIVA por tenant

**Files:**
- Modify: `src/modules/amazon/worker.ts`

> Leia o `worker.ts` atual antes. Hoje ele resolve a config global uma vez. O objetivo é: para cada `AmazonAccount` ativa+ATIVA, rodar o processamento sob `runWithTenant({ empresaId })` usando `resolverCredenciaisDaConta(empresaId)`. Mantenha um fallback para a config global enquanto a migração (Task 10) não rodou.

- [ ] **Step 1: Adicionar helper de contas ativas**

```ts
import { db } from "@/lib/db";
import { runWithTenant } from "@/lib/tenant-context";
import { resolverCredenciaisDaConta } from "./service";

async function contasAtivas() {
  return db.amazonAccount.findMany({
    where: { ativa: true, status: "ATIVA", refreshTokenEnc: { not: null } },
    select: { id: true, empresaId: true },
  });
}
```

- [ ] **Step 2: Envolver o processamento por conta**

No loop principal do worker, substituir o uso da config global por iteração:

```ts
const contas = await contasAtivas();
for (const conta of contas) {
  await runWithTenant({ empresaId: conta.empresaId, isSuperAdmin: false, source: "worker" }, async () => {
    const creds = await resolverCredenciaisDaConta(conta.empresaId);
    // ... chamar o pipeline de sync existente passando `creds` ...
  });
}
```

- [ ] **Step 3: Rodar uma passada**

Run: `npm run amazon:worker:once`
Expected: itera as contas ATIVA; sem contas, não faz sync (log informativo). Sem erro.

- [ ] **Step 4: Commit**

```bash
git add src/modules/amazon/worker.ts
git commit -m "feat(amazon-oauth): worker itera contas ATIVA por tenant"
```

---

## Task 10: Script de migração (global → AmazonAccount)

**Files:**
- Create: `scripts/migrar-credenciais-amazon-para-conta.ts`

- [ ] **Step 1: Implementar (idempotente, --dry-run default)**

```ts
import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());
import { db } from "../src/lib/db";
import { decryptConfigValue, encryptConfigValue } from "../src/lib/crypto";

const apply = process.argv.includes("--apply");
const EMPRESA = process.env.WORKER_EMPRESA_ID || "mundofs";

async function main() {
  const reg = await db.configuracaoSistema.findUnique({ where: { chave: "amazon_refresh_token" } });
  const refresh = decryptConfigValue(reg?.valor) ?? "";
  if (!refresh) { console.log("Sem amazon_refresh_token global — nada a migrar."); return; }

  const existente = await db.amazonAccount.findFirst({ where: { empresaId: EMPRESA } });
  console.log(`[${apply ? "APPLY" : "DRY-RUN"}] empresa=${EMPRESA} contaExistente=${!!existente}`);
  if (!apply) return;

  const data = {
    refreshTokenEnc: encryptConfigValue(refresh),
    marketplaceId: decryptConfigValue((await db.configuracaoSistema.findUnique({ where: { chave: "amazon_marketplace_id" } }))?.valor) ?? null,
    endpoint: decryptConfigValue((await db.configuracaoSistema.findUnique({ where: { chave: "amazon_endpoint" } }))?.valor) ?? null,
    status: "ATIVA",
    ativa: true,
    conectadoEm: new Date(),
  };
  if (existente) {
    await db.amazonAccount.update({ where: { id: existente.id }, data });
  } else {
    await db.amazonAccount.create({ data: { empresaId: EMPRESA, nome: "Conta Amazon (migrada)", ...data } });
  }
  console.log("Migração concluída. NÃO remova a config global ainda (fallback).");
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Rodar dry-run**

Run: `npx tsx scripts/migrar-credenciais-amazon-para-conta.ts`
Expected: imprime DRY-RUN sem escrever.

- [ ] **Step 3: Commit**

```bash
git add scripts/migrar-credenciais-amazon-para-conta.ts
git commit -m "feat(amazon-oauth): script de migração de credencial global para conta"
```

---

## Task 11: Documentar env + fechar

**Files:**
- Modify: `.env.example`

- [ ] **Step 1: Documentar variáveis novas**

Adicionar no `.env.example` (seção Amazon):

```
# OAuth multi-seller (consentimento). application_id do app no Developer Console.
AMAZON_APP_ID=""
AMAZON_SELLERCENTRAL_BASE="https://sellercentral.amazon.com.br"
# "true" enquanto o app for DRAFT (adiciona version=beta no consent). "false" quando publicado.
AMAZON_OAUTH_DRAFT="true"
```

- [ ] **Step 2: Validação final**

Run: `npx vitest run src/modules/amazon/oauth.test.ts src/modules/amazon/credenciais.test.ts && npx eslint src/modules/amazon/oauth.ts src/modules/amazon/service.ts "src/app/api/amazon/oauth/**/route.ts"`
Expected: testes PASS, lint limpo.

- [ ] **Step 3: Commit**

```bash
git add .env.example
git commit -m "docs(amazon-oauth): variáveis de ambiente do consentimento"
```

---

## Rollout (após implementação — GATED)

1. `prisma:migrate:deploy:pg` + `prisma:generate:pg` (Task 1).
2. `npx tsx scripts/migrar-credenciais-amazon-para-conta.ts` → revisar → `--apply`.
3. Validar 1 ciclo do worker por conta em staging.
4. Ligar `TENANT_ISOLATION=enforce` (pré-requisito F01 — backup + staging antes).
5. Registrar o app no Developer Console com `redirect_uri` de prod e testar o consentimento com 1 seller piloto.
6. Remover a config global `amazon_refresh_token` (cutover final).

## Pré-requisitos externos
- App registrado no Developer Console (Seller Central) com `redirect_uri = https://erp.mundofs.cloud/api/amazon/oauth/callback`.
- Revisão de segurança da Amazon (DPP) — depende dos controles infra/org da Fase 4 do `SECURITY-AUDIT-2026-06.md`.
