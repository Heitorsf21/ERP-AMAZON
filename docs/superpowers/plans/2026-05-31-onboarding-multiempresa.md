# Onboarding de empresa & Login multiempresa (A+B) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir que um superadmin crie uma empresa (tenant) + seu admin inicial, e que esse admin faça login numa base onde o mesmo e-mail pode existir em mais de uma empresa — operando isolado pela extensão Prisma já ativa em produção (`TENANT_ISOLATION=enforce`).

**Architecture:** Camada de plataforma isolada (`src/modules/plataforma/`, `src/lib/plataforma-session.ts`, rotas `/plataforma`) com cookie e auth próprios, fail-closed em dados de tenant. `criarEmpresa()` transacional cria Empresa (GLOBAL) → `runWithTenant` → seed + admin + convite. Login ganha resolução por slug + dummy bcrypt anti-timing. Convite = token SHA-256 single-use/expira via novo model `ConviteUsuario`.

**Tech Stack:** Next.js 16 App Router, Prisma 5.22 (schema duplo SQLite/Postgres, migrations manuais), bcryptjs, nodemailer, HMAC Web Crypto, vitest.

---

## Contexto crítico para quem implementa (LEIA antes da Task 1)

- **Schema duplo:** TODA mudança de modelo entra em **dois** arquivos: `prisma/schema.prisma` (SQLite, dev) e `prisma/schema.postgresql.prisma` (Postgres, prod). Mantenha sincronizados.
- **Migrations Postgres são manuais** (sem shadow DB): criar `prisma/migrations/<timestamp>_<nome>/migration.sql` à mão; aplicar em prod com `npm run prisma:migrate:deploy:pg`. NUNCA `prisma migrate dev` no Postgres prod.
- **Dev local SQLite:** após editar `schema.prisma`, rode `npm run prisma:generate && npm run prisma:push`. Encerre o Next antes (cheque `.dev-server.pid`).
- **Isolamento fail-closed:** com `TENANT_ISOLATION=enforce`, QUALQUER operação num modelo de `TENANT_MODELS` (ex: `Categoria`, `Fornecedor`) **lança** se não houver contexto resolvido (ALS via `runWithTenant`, ou cookie de tenant da request). Modelos em `GLOBAL_MODELS` (`Empresa`, `Usuario`, `PlataformaUsuario`, tokens, throttle) NUNCA são auto-filtrados. Ver `src/lib/db.ts`.
- **Testes:** `npx vitest run --no-file-parallelism <arquivo>` (paralelo quebra nesta máquina). Testes que tocam DB precisam de `DATABASE_URL="file:C:/Projects/ERP-AMAZON/prisma/dev.db"` (ou um db de teste dedicado — ver Task 7). Testes puros (sem DB) não precisam.
- **git add SEMPRE explícito** (NUNCA `git add .`/`-A`) — o Codex edita arquivos em paralelo nesta árvore.
- **Sem `console.log`** — use `logger` de `src/lib/logger.ts`.
- **Next.js 16 params assíncrono:** `const { id } = await params;` em rotas `[id]`.

---

## File Structure (decomposição)

**Schema & migração**
- Modify: `prisma/schema.postgresql.prisma` — `Usuario` unique composta + NOT NULL; novos models `ConviteUsuario`, `AuditPlataforma`.
- Modify: `prisma/schema.prisma` — espelho SQLite das mesmas mudanças.
- Create: `prisma/migrations/20260601000000_multiempresa_onboarding/migration.sql` — DDL Postgres manual.
- Modify: `src/lib/db.ts` — adicionar `ConviteUsuario` e `AuditPlataforma` a `GLOBAL_MODELS`.

**Plataforma (camada nova, isolada)**
- Create: `src/modules/plataforma/seed-empresa.ts` — `CATEGORIAS_PADRAO` + sentinelas + `semearEmpresa(client, empresaId)`. Fonte única (consumido por `seed.ts` e `empresas.ts`).
- Create: `src/modules/plataforma/slug.ts` — validação + blocklist de slug.
- Create: `src/modules/plataforma/convite.ts` — `gerarTokenConvite()`, `hashTokenConvite()`, TTL.
- Create: `src/modules/plataforma/empresas.ts` — `criarEmpresa()`, `desativarEmpresa()`, `reativarEmpresa()`, `reenviarConvite()`, `listarEmpresas()`.
- Create: `src/modules/plataforma/audit.ts` — `auditPlataforma()`.
- Create: `src/lib/plataforma-session.ts` — cookie/payload/sign/verify da sessão de plataforma (self-contained).
- Create: `src/lib/plataforma-auth.ts` — `getPlataformaSession()`, `requireSuperAdmin()`.
- Modify: `prisma/seed.ts` — passar a usar `semearEmpresa`; corrigir `findUnique` por email.

**Convite / definir senha**
- Create: `src/app/api/definir-senha/route.ts` — consome token de convite, define senha.
- Create: `src/app/definir-senha/page.tsx` + `form.tsx` — UI pública (espelha `redefinir-senha`).
- Create: `src/lib/email-convite.ts` — template + envio do e-mail de convite.

**Login multiempresa + ripple do email composto**
- Modify: `src/app/api/auth/login/route.ts` — slug + dummy bcrypt + throttle por slug.
- Modify: `src/app/login/login-form.tsx` — campo "Empresa" (prefill por `?empresa=`).
- Modify: `src/app/api/auth/2fa/verificar/route.ts` — carimbar `empresaId` na sessão emitida.
- Modify: `src/app/api/auth/recuperar-senha/route.ts` — tenant-aware (slug + composta).
- Modify: `src/app/api/perfil/route.ts` — checagem de email único escopada à empresa.

**Plataforma UI/API**
- Create: `src/app/plataforma/layout.tsx` — guard server-side (redirect se sem sessão de plataforma).
- Create: `src/app/plataforma/login/page.tsx` + `form.tsx`.
- Create: `src/app/plataforma/page.tsx` — lista de empresas.
- Create: `src/app/plataforma/empresas/nova/page.tsx` + `form.tsx` — wizard.
- Create: `src/app/api/plataforma/login/route.ts`, `logout/route.ts`.
- Create: `src/app/api/plataforma/empresas/route.ts` (POST criar, GET listar).
- Create: `src/app/api/plataforma/empresas/[id]/desativar/route.ts`, `reativar/route.ts`, `reenviar-convite/route.ts`.
- Create: `scripts/criar-superadmin.ts` — bootstrap CLI do 1º superadmin.

**Testes**
- Create: `src/modules/plataforma/slug.test.ts`, `convite.test.ts`, `seed-empresa.test.ts`.
- Create: `src/modules/plataforma/empresas.integration.test.ts`.
- Modify: `scripts/test-isolamento-2-empresas.ts` — estender p/ login multiempresa + isolamento da empresa nova.

---

## ÁREA 1 — Schema foundation & migração

### Task 1: Models `ConviteUsuario` + `AuditPlataforma` e `Usuario` composta (schema duplo)

**Files:**
- Modify: `prisma/schema.postgresql.prisma:75-104` (model `Usuario`)
- Modify: `prisma/schema.prisma` (mesmo model `Usuario` + novos models)

- [ ] **Step 1: Editar `Usuario` no schema Postgres** (`prisma/schema.postgresql.prisma`)

Trocar `email String @unique` por `email String` (sem `@unique`), `empresaId String?` por `empresaId String`, a relação `empresa Empresa?` por `empresa Empresa`, e os índices. Resultado do bloco relevante:

```prisma
model Usuario {
  id               String    @id @default(cuid())
  email            String
  senhaHash        String
  nome             String
  role             String    @default("ADMIN")
  ativo            Boolean   @default(true)
  avatarUrl        String?
  ultimoAcesso     DateTime?
  twoFactorEnabled Boolean   @default(false)
  twoFactorMethod  String?
  sessionVersion   Int       @default(0)
  empresaId        String
  createdAt        DateTime  @default(now())
  updatedAt        DateTime  @updatedAt

  empresa           Empresa                 @relation(fields: [empresaId], references: [id])
  tokensRecuperacao TokenRecuperacaoSenha[]
  codigos2fa        CodigoVerificacao2FA[]
  convites          ConviteUsuario[]
  auditLogs         AuditLog[]
  tarefas           Tarefa[]

  @@unique([empresaId, email])
  @@index([email])
  @@index([ativo])
  @@index([empresaId])
}
```

- [ ] **Step 2: Adicionar `ConviteUsuario` e `AuditPlataforma`** (logo após `TokenRecuperacaoSenha`, `prisma/schema.postgresql.prisma`)

```prisma
model ConviteUsuario {
  id        String    @id @default(cuid())
  usuarioId String
  tokenHash String    @unique
  expiresAt DateTime
  usadoEm   DateTime?
  createdAt DateTime  @default(now())

  usuario Usuario @relation(fields: [usuarioId], references: [id], onDelete: Cascade)

  @@index([usuarioId])
  @@index([expiresAt])
}

model AuditPlataforma {
  id                  String   @id @default(cuid())
  plataformaUsuarioId String?
  acao                String
  empresaIdAlvo       String?
  metadata            String?  // JSON serializado (String em AMBOS os schemas — sem divergencia SQLite/PG)
  ip                  String?
  createdAt           DateTime @default(now())

  @@index([plataformaUsuarioId])
  @@index([empresaIdAlvo])
  @@index([createdAt])
}
```

- [ ] **Step 3: Espelhar tudo em `prisma/schema.prisma` (SQLite)**

Mesmas mudanças. `metadata String?` é idêntico nos dois schemas (decisão: serializar JSON como string, sem usar o tipo `Json` nativo, para evitar divergência SQLite/Postgres). O resto é idêntico.

- [ ] **Step 4: Regenerar client SQLite e empurrar schema local**

Encerre o Next se estiver rodando (cheque `.dev-server.pid`). Rode:
```bash
npm run prisma:generate && npm run prisma:push
```
Expected: push aplica as colunas/models no `prisma/dev.db` sem erro. (Se o dev.db tiver dados conflitantes com NOT NULL, aceite o reset do db local — é descartável.)

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.postgresql.prisma prisma/schema.prisma
git commit -m "feat(multitenant): Usuario email composto + models ConviteUsuario/AuditPlataforma"
```

---

### Task 2: Migration SQL manual (Postgres)

**Files:**
- Create: `prisma/migrations/20260601000000_multiempresa_onboarding/migration.sql`

- [ ] **Step 1: Escrever o `migration.sql`**

```sql
-- Usuario: email global -> composto por empresa + empresaId NOT NULL.
-- Seguro: backfill ja concluido (todos os Usuario tem empresaId='mundofs').
DROP INDEX IF EXISTS "Usuario_email_key";
ALTER TABLE "Usuario" ALTER COLUMN "empresaId" SET NOT NULL;
CREATE UNIQUE INDEX "Usuario_empresaId_email_key" ON "Usuario"("empresaId", "email");
CREATE INDEX IF NOT EXISTS "Usuario_email_idx" ON "Usuario"("email");

-- Convite de admin (set-password): token hasheado, single-use, expira.
CREATE TABLE "ConviteUsuario" (
  "id"        TEXT NOT NULL,
  "usuarioId" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "usadoEm"   TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ConviteUsuario_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ConviteUsuario_tokenHash_key" ON "ConviteUsuario"("tokenHash");
CREATE INDEX "ConviteUsuario_usuarioId_idx" ON "ConviteUsuario"("usuarioId");
CREATE INDEX "ConviteUsuario_expiresAt_idx" ON "ConviteUsuario"("expiresAt");
ALTER TABLE "ConviteUsuario" ADD CONSTRAINT "ConviteUsuario_usuarioId_fkey"
  FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Trilha de auditoria da camada plataforma (superadmin).
CREATE TABLE "AuditPlataforma" (
  "id"                  TEXT NOT NULL,
  "plataformaUsuarioId" TEXT,
  "acao"                TEXT NOT NULL,
  "empresaIdAlvo"       TEXT,
  "metadata"            TEXT,
  "ip"                  TEXT,
  "createdAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AuditPlataforma_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AuditPlataforma_plataformaUsuarioId_idx" ON "AuditPlataforma"("plataformaUsuarioId");
CREATE INDEX "AuditPlataforma_empresaIdAlvo_idx" ON "AuditPlataforma"("empresaIdAlvo");
CREATE INDEX "AuditPlataforma_createdAt_idx" ON "AuditPlataforma"("createdAt");
```

- [ ] **Step 2: Validar o SQL localmente (dry sanity)**

Não há shadow DB. Valide visualmente que os nomes de constraint/índice seguem o padrão Prisma (`<Model>_<col>_key`, `<Model>_<col>_idx`, `<Model>_pkey`, `<Model>_<col>_fkey`). NÃO aplicar em prod nesta fase (aplicação é no deploy, Task 22).

- [ ] **Step 3: Commit**

```bash
git add prisma/migrations/20260601000000_multiempresa_onboarding/migration.sql
git commit -m "feat(multitenant): migration manual onboarding (Usuario composto + ConviteUsuario + AuditPlataforma)"
```

---

### Task 3: Classificar novos models em `GLOBAL_MODELS`

**Files:**
- Modify: `src/lib/db.ts:123-140` (set `GLOBAL_MODELS`)
- Test: `src/lib/tenant-isolation.test.ts` (adicionar asserção de classificação)

- [ ] **Step 1: Escrever o teste falhando** (adicionar em `src/lib/tenant-isolation.test.ts`)

```ts
import { GLOBAL_MODEL_NAMES, TENANT_MODEL_NAMES } from "./db";

describe("classificacao dos models novos (A+B)", () => {
  it("ConviteUsuario e AuditPlataforma sao GLOBAIS (nunca auto-filtrados)", () => {
    expect(GLOBAL_MODEL_NAMES.has("ConviteUsuario")).toBe(true);
    expect(GLOBAL_MODEL_NAMES.has("AuditPlataforma")).toBe(true);
    expect(TENANT_MODEL_NAMES.has("ConviteUsuario")).toBe(false);
    expect(TENANT_MODEL_NAMES.has("AuditPlataforma")).toBe(false);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run --no-file-parallelism src/lib/tenant-isolation.test.ts`
Expected: FAIL (os models ainda não estão em `GLOBAL_MODELS`).

- [ ] **Step 3: Adicionar os models ao set** (`src/lib/db.ts`, dentro de `GLOBAL_MODELS`, após `"AuditLog",`)

```ts
  "AuditLog",
  // Convite de admin e auditoria de plataforma: gravados em fluxos PRE-contexto
  // (criacao de empresa pelo superadmin, set-password publico). Sem empresaId de
  // negocio; escopo resolvido explicitamente pela aplicacao.
  "ConviteUsuario",
  "AuditPlataforma",
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run --no-file-parallelism src/lib/tenant-isolation.test.ts`
Expected: PASS (todos os testes do arquivo).

- [ ] **Step 5: Commit**

```bash
git add src/lib/db.ts src/lib/tenant-isolation.test.ts
git commit -m "feat(multitenant): classifica ConviteUsuario/AuditPlataforma como GLOBAL na extensao Prisma"
```

---

## ÁREA 2 — Seed compartilhado, slug, criarEmpresa, CLI superadmin

### Task 4: `slug.ts` — validação + blocklist

**Files:**
- Create: `src/modules/plataforma/slug.ts`
- Test: `src/modules/plataforma/slug.test.ts`

- [ ] **Step 1: Teste falhando** (`src/modules/plataforma/slug.test.ts`)

```ts
import { describe, it, expect } from "vitest";
import { validarSlug, SLUGS_RESERVADOS } from "./slug";

describe("validarSlug", () => {
  it("aceita slug valido", () => {
    expect(validarSlug("lojax")).toEqual({ ok: true });
    expect(validarSlug("loja-2026")).toEqual({ ok: true });
  });
  it("rejeita formato invalido", () => {
    expect(validarSlug("Lo").ok).toBe(false);        // curto + maiuscula
    expect(validarSlug("loja_x").ok).toBe(false);    // underscore
    expect(validarSlug("LOJA").ok).toBe(false);      // maiuscula
    expect(validarSlug("a".repeat(31)).ok).toBe(false); // > 30
  });
  it("rejeita reservados", () => {
    for (const r of SLUGS_RESERVADOS) {
      expect(validarSlug(r).ok).toBe(false);
    }
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run --no-file-parallelism src/modules/plataforma/slug.test.ts`
Expected: FAIL ("Cannot find module './slug'").

- [ ] **Step 3: Implementar** (`src/modules/plataforma/slug.ts`)

```ts
export const SLUGS_RESERVADOS = [
  "api", "app", "plataforma", "admin", "www", "static", "_next",
  "login", "logout", "dashboard-ecommerce", "definir-senha",
  "redefinir-senha", "recuperar-senha", "configuracoes",
] as const;

const FORMATO = /^[a-z0-9-]{3,30}$/;

export type SlugCheck = { ok: true } | { ok: false; motivo: string };

export function validarSlug(slug: string): SlugCheck {
  if (!FORMATO.test(slug)) {
    return { ok: false, motivo: "Use 3 a 30 caracteres: letras minusculas, numeros e hifen." };
  }
  if ((SLUGS_RESERVADOS as readonly string[]).includes(slug)) {
    return { ok: false, motivo: "Este identificador e reservado." };
  }
  return { ok: true };
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run --no-file-parallelism src/modules/plataforma/slug.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/plataforma/slug.ts src/modules/plataforma/slug.test.ts
git commit -m "feat(plataforma): validacao e blocklist de slug de empresa"
```

---

### Task 5: `convite.ts` — geração/hash de token

**Files:**
- Create: `src/modules/plataforma/convite.ts`
- Test: `src/modules/plataforma/convite.test.ts`

- [ ] **Step 1: Teste falhando** (`src/modules/plataforma/convite.test.ts`)

```ts
import { describe, it, expect } from "vitest";
import { gerarTokenConvite, hashTokenConvite, CONVITE_TTL_MS } from "./convite";

describe("convite token", () => {
  it("gera token cru + hash SHA-256 consistente", () => {
    const { rawToken, tokenHash } = gerarTokenConvite();
    expect(rawToken).toMatch(/^[A-Za-z0-9_-]{40,}$/); // base64url, >=32 bytes
    expect(tokenHash).toHaveLength(64);               // sha256 hex
    expect(hashTokenConvite(rawToken)).toBe(tokenHash);
  });
  it("tokens sao unicos", () => {
    expect(gerarTokenConvite().rawToken).not.toBe(gerarTokenConvite().rawToken);
  });
  it("TTL de 7 dias", () => {
    expect(CONVITE_TTL_MS).toBe(7 * 24 * 60 * 60 * 1000);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run --no-file-parallelism src/modules/plataforma/convite.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implementar** (`src/modules/plataforma/convite.ts`)

```ts
import crypto from "node:crypto";

export const CONVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export function gerarTokenConvite(): { rawToken: string; tokenHash: string } {
  const rawToken = crypto.randomBytes(32).toString("base64url");
  return { rawToken, tokenHash: hashTokenConvite(rawToken) };
}

export function hashTokenConvite(rawToken: string): string {
  return crypto.createHash("sha256").update(rawToken).digest("hex");
}

export function expiracaoConvite(now = Date.now()): Date {
  return new Date(now + CONVITE_TTL_MS);
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run --no-file-parallelism src/modules/plataforma/convite.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/plataforma/convite.ts src/modules/plataforma/convite.test.ts
git commit -m "feat(plataforma): geracao de token de convite (SHA-256, TTL 7d)"
```

---

### Task 6: `seed-empresa.ts` — fonte única do seed por empresa

**Files:**
- Create: `src/modules/plataforma/seed-empresa.ts`
- Test: `src/modules/plataforma/seed-empresa.test.ts`

Tipo do client: aceitamos qualquer cliente Prisma com os delegates `categoria`/`fornecedor` (o cliente cru do `seed.ts` e o `tx` estendido têm assinaturas idênticas — não há extensions de delegate, só de query).

- [ ] **Step 1: Teste falhando** (DB local SQLite) (`src/modules/plataforma/seed-empresa.test.ts`)

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { semearEmpresa, CATEGORIAS_PADRAO } from "./seed-empresa";

const prisma = new PrismaClient();
const EMP = "test-seed-emp";

beforeAll(async () => {
  await prisma.empresa.upsert({
    where: { id: EMP },
    update: {},
    create: { id: EMP, nome: "Seed Test", slug: "seed-test-emp" },
  });
});
afterAll(async () => {
  await prisma.categoria.deleteMany({ where: { empresaId: EMP } });
  await prisma.fornecedor.deleteMany({ where: { empresaId: EMP } });
  await prisma.empresa.delete({ where: { id: EMP } }).catch(() => {});
  await prisma.$disconnect();
});

describe("semearEmpresa", () => {
  it("cria 18 categorias + sentinelas Contas Fixas (categoria e fornecedor)", async () => {
    await semearEmpresa(prisma, EMP);
    const cats = await prisma.categoria.count({ where: { empresaId: EMP } });
    expect(cats).toBe(CATEGORIAS_PADRAO.length + 1); // +1 sentinela "Contas Fixas"
    const sentinelaCat = await prisma.categoria.findFirst({
      where: { empresaId: EMP, nome: "Contas Fixas" },
    });
    const sentinelaForn = await prisma.fornecedor.findFirst({
      where: { empresaId: EMP, nome: "Contas Fixas" },
    });
    expect(sentinelaCat).not.toBeNull();
    expect(sentinelaForn).not.toBeNull();
  });
  it("é idempotente (rodar 2x não duplica)", async () => {
    await semearEmpresa(prisma, EMP);
    const cats = await prisma.categoria.count({ where: { empresaId: EMP } });
    expect(cats).toBe(CATEGORIAS_PADRAO.length + 1);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `DATABASE_URL="file:C:/Projects/ERP-AMAZON/prisma/dev.db" npx vitest run --no-file-parallelism src/modules/plataforma/seed-empresa.test.ts`
Expected: FAIL ("Cannot find module './seed-empresa'").

- [ ] **Step 3: Implementar** (`src/modules/plataforma/seed-empresa.ts`)

```ts
import type { PrismaClient } from "@prisma/client";

type TipoCategoria = "RECEITA" | "DESPESA" | "AMBAS";

export const CATEGORIAS_PADRAO: Array<{ nome: string; tipo: TipoCategoria; cor: string }> = [
  { nome: "Pagamento Amazon", tipo: "RECEITA", cor: "#16a34a" },
  { nome: "Outras receitas", tipo: "RECEITA", cor: "#0ea5e9" },
  { nome: "Aportes dos sócios", tipo: "RECEITA", cor: "#22c55e" },
  { nome: "Resgates de aplicações", tipo: "RECEITA", cor: "#14b8a6" },
  { nome: "Compra de mercadorias / produtos", tipo: "DESPESA", cor: "#ea580c" },
  { nome: "Fretes e entregas", tipo: "DESPESA", cor: "#f97316" },
  { nome: "Impostos", tipo: "DESPESA", cor: "#dc2626" },
  { nome: "Despesas operacionais", tipo: "DESPESA", cor: "#6366f1" },
  { nome: "Contabilidade", tipo: "DESPESA", cor: "#0891b2" },
  { nome: "Pagamento de fatura", tipo: "DESPESA", cor: "#7c3aed" },
  { nome: "Marketing", tipo: "DESPESA", cor: "#ec4899" },
  { nome: "Serviços terceirizados", tipo: "DESPESA", cor: "#0f766e" },
  { nome: "Tecnologia e sistemas", tipo: "DESPESA", cor: "#2563eb" },
  { nome: "Taxas de plataformas / pagamentos", tipo: "DESPESA", cor: "#9333ea" },
  { nome: "Aplicações financeiras", tipo: "DESPESA", cor: "#64748b" },
  { nome: "Reserva", tipo: "DESPESA", cor: "#64748b" },
  { nome: "Pró-labore / Lucro", tipo: "DESPESA", cor: "#a16207" },
  { nome: "Ajuste de saldo", tipo: "AMBAS", cor: "#475569" },
];

// Nome da sentinela usada pelo módulo contas-fixas quando categoria/fornecedor
// não são informados. NÃO renomear sem alinhar com contas-fixas/repository.
export const SENTINELA_CONTAS_FIXAS = "Contas Fixas";

/** Cliente mínimo aceito: o cru (seed.ts) ou o tx estendido (criarEmpresa). */
type SeedClient = Pick<PrismaClient, "categoria" | "fornecedor">;

/**
 * Semeia catálogo inicial de uma empresa: 18 categorias padrão + sentinelas
 * "Contas Fixas" (categoria DESPESA + fornecedor). Idempotente (upsert por
 * @@unique([empresaId, nome])). empresaId é passado EXPLÍCITO em todo create —
 * funciona com o client cru (sem extensão) e com o estendido.
 */
export async function semearEmpresa(client: SeedClient, empresaId: string): Promise<void> {
  for (const cat of CATEGORIAS_PADRAO) {
    await client.categoria.upsert({
      where: { empresaId_nome: { empresaId, nome: cat.nome } },
      update: { tipo: cat.tipo, cor: cat.cor },
      create: { ...cat, empresaId },
    });
  }
  await client.categoria.upsert({
    where: { empresaId_nome: { empresaId, nome: SENTINELA_CONTAS_FIXAS } },
    update: {},
    create: { nome: SENTINELA_CONTAS_FIXAS, tipo: "DESPESA", cor: "#7c3aed", empresaId },
  });
  await client.fornecedor.upsert({
    where: { empresaId_nome: { empresaId, nome: SENTINELA_CONTAS_FIXAS } },
    update: {},
    create: { nome: SENTINELA_CONTAS_FIXAS, empresaId },
  });
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `DATABASE_URL="file:C:/Projects/ERP-AMAZON/prisma/dev.db" npx vitest run --no-file-parallelism src/modules/plataforma/seed-empresa.test.ts`
Expected: PASS.

- [ ] **Step 5: Refatorar `prisma/seed.ts` para consumir `semearEmpresa`**

Em `prisma/seed.ts`: remover o array local `CATEGORIAS_PADRAO` e o upsert do fornecedor exemplo manual; importar e chamar `await semearEmpresa(db, SEED_EMPRESA_ID)`. Manter a lógica de `RENOMEACOES` (que é específica do mundofs). Manter `seedUsuarioInicial()`.

```ts
import { semearEmpresa } from "../src/modules/plataforma/seed-empresa";
// ... em main():
await semearEmpresa(db, SEED_EMPRESA_ID);
// (RENOMEACOES continua logo após, inalterado)
```

- [ ] **Step 6: Corrigir o `findUnique` por email em `seed.ts:122`** (email agora é composto)

```ts
const existente = await db.usuario.findUnique({
  where: { empresaId_email: { empresaId: SEED_EMPRESA_ID, email } },
});
```

- [ ] **Step 7: Verificar seed e typecheck**

Run: `DATABASE_URL="file:C:/Projects/ERP-AMAZON/prisma/dev.db" npm run db:seed`
Expected: roda sem erro; log "seed" das categorias.
Run: `npx tsc --noEmit`
Expected: sem erros novos em `seed.ts`/`seed-empresa.ts`.

- [ ] **Step 8: Commit**

```bash
git add src/modules/plataforma/seed-empresa.ts src/modules/plataforma/seed-empresa.test.ts prisma/seed.ts
git commit -m "feat(plataforma): seed por empresa compartilhado (fonte unica seed.ts + criarEmpresa)"
```

---

### Task 7: `audit.ts` + `empresas.ts` — `criarEmpresa()` transacional

**Files:**
- Create: `src/modules/plataforma/audit.ts`
- Create: `src/modules/plataforma/empresas.ts`
- Test: `src/modules/plataforma/empresas.integration.test.ts`

- [ ] **Step 1: Implementar `audit.ts`** (sem TDD — wrapper fino, validado na integração)

```ts
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";

export type AcaoPlataforma =
  | "EMPRESA_CRIADA" | "ADMIN_CONVIDADO" | "CONVITE_REENVIADO"
  | "EMPRESA_DESATIVADA" | "EMPRESA_REATIVADA" | "LOGIN_PLATAFORMA";

export async function auditPlataforma(input: {
  plataformaUsuarioId?: string | null;
  acao: AcaoPlataforma;
  empresaIdAlvo?: string | null;
  metadata?: Record<string, unknown>;
  ip?: string | null;
}): Promise<void> {
  try {
    await db.auditPlataforma.create({
      data: {
        plataformaUsuarioId: input.plataformaUsuarioId ?? null,
        acao: input.acao,
        empresaIdAlvo: input.empresaIdAlvo ?? null,
        metadata: input.metadata ? JSON.stringify(input.metadata) : undefined,
        ip: input.ip ?? null,
      },
    });
  } catch (err) {
    logger.error({ err, acao: input.acao }, "[plataforma] falha ao gravar auditoria");
  }
}
```
(`metadata` é `String?` em ambos os schemas — serializamos com `JSON.stringify`. Coerente com Tasks 1/2.)

- [ ] **Step 2: Teste de integração falhando** (`src/modules/plataforma/empresas.integration.test.ts`)

```ts
import { describe, it, expect, afterEach } from "vitest";
import { PrismaClient } from "@prisma/client";
import { criarEmpresa } from "./empresas";
import { CATEGORIAS_PADRAO } from "./seed-empresa";

const prisma = new PrismaClient();

async function limpar(slug: string) {
  const emp = await prisma.empresa.findUnique({ where: { slug } });
  if (!emp) return;
  await prisma.conviteUsuario.deleteMany({ where: { usuario: { empresaId: emp.id } } });
  await prisma.usuario.deleteMany({ where: { empresaId: emp.id } });
  await prisma.categoria.deleteMany({ where: { empresaId: emp.id } });
  await prisma.fornecedor.deleteMany({ where: { empresaId: emp.id } });
  await prisma.empresa.delete({ where: { id: emp.id } });
}

afterEach(async () => { await limpar("loja-itest"); });

describe("criarEmpresa", () => {
  it("cria empresa + seed + admin + convite atomicamente", async () => {
    const r = await criarEmpresa({
      nome: "Loja Itest", slug: "loja-itest",
      admin: { nome: "Admin Itest", email: "admin@itest.com" },
    });
    expect(r.empresaId).toBeTruthy();
    expect(r.rawToken).toMatch(/^[A-Za-z0-9_-]{40,}$/);

    const cats = await prisma.categoria.count({ where: { empresaId: r.empresaId } });
    expect(cats).toBe(CATEGORIAS_PADRAO.length + 1);
    const admin = await prisma.usuario.findUnique({ where: { id: r.adminId } });
    expect(admin?.role).toBe("ADMIN");
    expect(admin?.ativo).toBe(true);
    expect(admin?.empresaId).toBe(r.empresaId);
    const convite = await prisma.conviteUsuario.findFirst({ where: { usuarioId: r.adminId } });
    expect(convite).not.toBeNull();
  });

  it("rejeita slug duplicado", async () => {
    await criarEmpresa({ nome: "L1", slug: "loja-itest", admin: { nome: "A", email: "a@x.com" } });
    await expect(
      criarEmpresa({ nome: "L2", slug: "loja-itest", admin: { nome: "B", email: "b@x.com" } }),
    ).rejects.toThrow();
  });

  it("rejeita slug invalido", async () => {
    await expect(
      criarEmpresa({ nome: "L", slug: "X", admin: { nome: "A", email: "a@x.com" } }),
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `DATABASE_URL="file:C:/Projects/ERP-AMAZON/prisma/dev.db" TENANT_ISOLATION=enforce npx vitest run --no-file-parallelism src/modules/plataforma/empresas.integration.test.ts`
Expected: FAIL ("Cannot find module './empresas'").

- [ ] **Step 4: Implementar `empresas.ts`** (`src/modules/plataforma/empresas.ts`)

```ts
import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import { db } from "@/lib/db";
import { runWithTenant } from "@/lib/tenant-context";
import { validarSlug } from "./slug";
import { semearEmpresa } from "./seed-empresa";
import { gerarTokenConvite, expiracaoConvite } from "./convite";

export type CriarEmpresaInput = {
  nome: string;
  slug: string;
  admin: { nome: string; email: string };
};

export type CriarEmpresaResult = {
  empresaId: string;
  adminId: string;
  rawToken: string;
};

/** Hash bcrypt de bytes aleatórios — senha inutilizável até o admin definir a real. */
async function hashAleatorio(): Promise<string> {
  return bcrypt.hash(crypto.randomBytes(24).toString("base64"), 10);
}

export async function criarEmpresa(input: CriarEmpresaInput): Promise<CriarEmpresaResult> {
  const slugCheck = validarSlug(input.slug);
  if (!slugCheck.ok) throw new Error(`SLUG_INVALIDO: ${slugCheck.motivo}`);

  const email = input.admin.email.toLowerCase().trim();
  const { rawToken, tokenHash } = gerarTokenConvite();
  const senhaHash = await hashAleatorio();

  return db.$transaction(async (tx) => {
    // Empresa: model GLOBAL — nao precisa de contexto de tenant.
    const empresa = await tx.empresa.create({
      data: { nome: input.nome.trim(), slug: input.slug },
    });

    // Demais writes precisam de contexto (Categoria/Fornecedor sao TENANT).
    return runWithTenant(
      { empresaId: empresa.id, isSuperAdmin: false, source: "system" },
      async () => {
        await semearEmpresa(tx, empresa.id);

        const admin = await tx.usuario.create({
          data: {
            nome: input.admin.nome.trim(),
            email,
            role: "ADMIN",
            ativo: true,
            senhaHash,
            empresaId: empresa.id,
          },
        });

        await tx.conviteUsuario.create({
          data: { usuarioId: admin.id, tokenHash, expiresAt: expiracaoConvite() },
        });

        return { empresaId: empresa.id, adminId: admin.id, rawToken };
      },
    );
  });
}
```

> NOTA: `db.$transaction(async (tx) => ...)` no cliente estendido entrega um `tx` que também passa pela extensão; o `runWithTenant` em volta dos writes de tenant garante o contexto. `Empresa`/`Usuario`/`ConviteUsuario` são GLOBAIS (sem auto-filtro), mas `Usuario` recebe `empresaId` explícito.

- [ ] **Step 5: Rodar e ver passar**

Run: `DATABASE_URL="file:C:/Projects/ERP-AMAZON/prisma/dev.db" TENANT_ISOLATION=enforce npx vitest run --no-file-parallelism src/modules/plataforma/empresas.integration.test.ts`
Expected: PASS (3 testes). Se "fail-closed" aparecer, o `runWithTenant` não está envolvendo os writes — revise.

- [ ] **Step 6: Adicionar funções de gestão** (mesmo arquivo `empresas.ts`)

```ts
export async function listarEmpresas() {
  return db.empresa.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      id: true, nome: true, slug: true, ativa: true, createdAt: true,
      _count: { select: { usuarios: true, amazonAccounts: true } },
    },
  });
}

export async function desativarEmpresa(empresaId: string) {
  return db.empresa.update({ where: { id: empresaId }, data: { ativa: false } });
}

export async function reativarEmpresa(empresaId: string) {
  return db.empresa.update({ where: { id: empresaId }, data: { ativa: true } });
}
```

- [ ] **Step 7: Commit**

```bash
git add src/modules/plataforma/audit.ts src/modules/plataforma/empresas.ts src/modules/plataforma/empresas.integration.test.ts
git commit -m "feat(plataforma): criarEmpresa transacional + gestao (listar/ativar/desativar)"
```

---

### Task 8: CLI bootstrap do 1º superadmin

**Files:**
- Create: `scripts/criar-superadmin.ts`

- [ ] **Step 1: Implementar o script** (`scripts/criar-superadmin.ts`)

```ts
/**
 * Bootstrap do 1o superadmin (PlataformaUsuario). Uso:
 *   npx tsx scripts/criar-superadmin.ts --email a@b.com --nome "Fulano" --senha "..."
 * Idempotente: se o email ja existe, atualiza nome/senha.
 */
import bcrypt from "bcryptjs";
import { db } from "../src/lib/db";
import { logger } from "../src/lib/logger";

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const email = arg("--email")?.toLowerCase().trim();
  const nome = arg("--nome")?.trim();
  const senha = arg("--senha");
  if (!email || !nome || !senha) {
    logger.error("Uso: --email <e> --nome <n> --senha <s>");
    process.exit(1);
  }
  if (senha.length < 10) {
    logger.error("Senha do superadmin deve ter >= 10 caracteres.");
    process.exit(1);
  }
  const senhaHash = await bcrypt.hash(senha, 12);
  const u = await db.plataformaUsuario.upsert({
    where: { email },
    update: { nome, senhaHash, ativo: true },
    create: { email, nome, senhaHash, ativo: true },
  });
  logger.info({ id: u.id, email: u.email }, "superadmin pronto");
  await db.$disconnect();
}

main().catch((e) => { logger.error({ err: e }, "falha"); process.exit(1); });
```

- [ ] **Step 2: Testar localmente**

Run: `DATABASE_URL="file:C:/Projects/ERP-AMAZON/prisma/dev.db" npx tsx scripts/criar-superadmin.ts --email super@local.test --nome "Super Local" --senha "trocar-isto-1234"`
Expected: log "superadmin pronto" com id.

- [ ] **Step 3: Commit**

```bash
git add scripts/criar-superadmin.ts
git commit -m "feat(plataforma): CLI de bootstrap do 1o superadmin"
```

---

## ÁREA 3 — Convite por e-mail + definir senha

### Task 9: E-mail de convite

**Files:**
- Create: `src/lib/email-convite.ts`

- [ ] **Step 1: Implementar** (`src/lib/email-convite.ts`)

```ts
import { enviarEmail, escapeHtml } from "@/lib/email";

/**
 * Envia o convite com link de definir senha. O link leva slug+email pra
 * pre-preencher o login depois. NUNCA envia senha em texto puro.
 */
export async function enviarConviteAdmin(input: {
  to: string;
  nome: string;
  empresaNome: string;
  slug: string;
  rawToken: string;
}): Promise<{ ok: boolean; viaConsole: boolean }> {
  const base = process.env.APP_URL?.replace(/\/$/, "") || "http://localhost:3000";
  const link = `${base}/definir-senha?token=${encodeURIComponent(input.rawToken)}` +
    `&empresa=${encodeURIComponent(input.slug)}&email=${encodeURIComponent(input.to)}`;
  return enviarEmail({
    to: input.to,
    subject: `Acesso ao Atlas Seller — ${input.empresaNome}`,
    html: `
      <div style="font-family:-apple-system,sans-serif;max-width:480px;margin:0 auto">
        <h2 style="color:#0b1220">Bem-vindo(a) ao Atlas Seller</h2>
        <p>Olá ${escapeHtml(input.nome)},</p>
        <p>Você foi cadastrado(a) como administrador da empresa
           <strong>${escapeHtml(input.empresaNome)}</strong>.</p>
        <p>Defina sua senha para acessar:</p>
        <p style="text-align:center;margin:24px 0">
          <a href="${link}" style="background:#6366f1;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600">Definir minha senha</a>
        </p>
        <p style="color:#6b7280;font-size:13px">O link expira em 7 dias. Se você não esperava este convite, ignore este e-mail.</p>
      </div>`,
  });
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: sem erros novos.

- [ ] **Step 3: Commit**

```bash
git add src/lib/email-convite.ts
git commit -m "feat(plataforma): e-mail de convite com link de definir senha"
```

---

### Task 10: Endpoint + página de definir senha (público)

**Files:**
- Create: `src/app/api/definir-senha/route.ts`
- Create: `src/app/definir-senha/page.tsx`
- Create: `src/app/definir-senha/form.tsx`

- [ ] **Step 1: Implementar o endpoint** (`src/app/api/definir-senha/route.ts`)

```ts
import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { db } from "@/lib/db";
import { hashTokenConvite } from "@/modules/plataforma/convite";
import { originViolationResponse } from "@/lib/origin-check";
import { consumeRateLimit } from "@/lib/auth-rate-limit";
import { getClientIp } from "@/lib/auth-rate-limit";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  token: z.string().min(20).max(200),
  novaSenha: z.string().min(8).max(200),
});

export async function POST(req: Request) {
  const bloqueio = originViolationResponse(req);
  if (bloqueio) return bloqueio;

  // Rate-limit por IP (namespaced p/ nao colidir com login).
  const ip = getClientIp(req.headers);
  const rl = await consumeRateLimit(`definir-senha:${ip}`, 15 * 60_000, 10);
  if (rl.limited) {
    return NextResponse.json(
      { erro: "MUITAS_TENTATIVAS" },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSeconds) } },
    );
  }

  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ erro: "JSON_INVALIDO" }, { status: 400 }); }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ erro: "DADOS_INVALIDOS" }, { status: 400 });

  const tokenHash = hashTokenConvite(parsed.data.token);
  const convite = await db.conviteUsuario.findUnique({ where: { tokenHash } });

  // Resposta UNIFORME para inexistente/expirado/usado (anti-enumeracao).
  const invalido =
    !convite || convite.usadoEm != null || convite.expiresAt.getTime() < Date.now();
  if (invalido) {
    return NextResponse.json({ erro: "LINK_INVALIDO" }, { status: 400 });
  }

  const senhaHash = await bcrypt.hash(parsed.data.novaSenha, 12);
  await db.$transaction([
    db.usuario.update({
      where: { id: convite!.usuarioId },
      data: { senhaHash, sessionVersion: { increment: 1 } },
    }),
    db.conviteUsuario.update({
      where: { id: convite!.id },
      data: { usadoEm: new Date() },
    }),
  ]);

  logger.info({ usuarioId: convite!.usuarioId }, "[convite] senha definida");
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 2: Implementar a página** (`src/app/definir-senha/page.tsx`)

```tsx
import { DefinirSenhaForm } from "./form";

export const dynamic = "force-dynamic";

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; empresa?: string; email?: string }>;
}) {
  const sp = await searchParams;
  return (
    <div style={{ display: "flex", minHeight: "100vh", alignItems: "center", justifyContent: "center" }}>
      <DefinirSenhaForm
        token={sp.token ?? ""}
        empresa={sp.empresa ?? ""}
        email={sp.email ?? ""}
      />
    </div>
  );
}
```

- [ ] **Step 3: Implementar o form** (`src/app/definir-senha/form.tsx`)

```tsx
"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export function DefinirSenhaForm({ token, empresa, email }: { token: string; empresa: string; email: string }) {
  const router = useRouter();
  const [senha, setSenha] = useState("");
  const [confirma, setConfirma] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    if (senha.length < 8) return setErro("Mínimo 8 caracteres.");
    if (senha !== confirma) return setErro("As senhas não coincidem.");
    setLoading(true);
    const res = await fetch("/api/definir-senha", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token, novaSenha: senha }),
    });
    setLoading(false);
    if (!res.ok) { setErro("Link inválido ou expirado. Solicite um novo convite."); return; }
    const qs = new URLSearchParams();
    if (empresa) qs.set("empresa", empresa);
    if (email) qs.set("email", email);
    router.push(`/login?${qs.toString()}`);
  }

  return (
    <form onSubmit={submit} style={{ width: 320, display: "flex", flexDirection: "column", gap: 10 }}>
      <h2>Definir senha</h2>
      <input type="password" placeholder="Nova senha" value={senha} onChange={(e) => setSenha(e.target.value)} />
      <input type="password" placeholder="Confirmar senha" value={confirma} onChange={(e) => setConfirma(e.target.value)} />
      {erro && <p style={{ color: "#dc2626", fontSize: 13 }}>{erro}</p>}
      <button disabled={loading} type="submit">{loading ? "Salvando..." : "Salvar e entrar"}</button>
    </form>
  );
}
```

- [ ] **Step 4: Smoke manual (opcional, recomendado)**

Suba o dev (`npm run dev:web`), crie uma empresa via teste/CLI, pegue o `rawToken` logado, acesse `/definir-senha?token=<raw>`, defina senha, confirme redirect a `/login?empresa=...`.

- [ ] **Step 5: Lint + typecheck**

Run: `npx eslint src/app/definir-senha/form.tsx src/app/definir-senha/page.tsx src/app/api/definir-senha/route.ts && npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 6: Commit**

```bash
git add src/app/api/definir-senha/route.ts src/app/definir-senha/page.tsx src/app/definir-senha/form.tsx
git commit -m "feat(plataforma): definir senha por convite (endpoint publico + pagina)"
```

---

## ÁREA 4 — Login multiempresa + ripple do email composto

> ⚠️ ÁREA DE MAIOR RISCO (auth de produção). Não pule os testes. O login é o caminho crítico.

### Task 11: Login por slug + dummy bcrypt + throttle por empresa

**Files:**
- Modify: `src/app/api/auth/login/route.ts`
- Modify: `src/lib/auth-rate-limit.ts:27-30` (chave de throttle aceita slug)

- [ ] **Step 1: Estender a chave de throttle** (`src/lib/auth-rate-limit.ts`)

Adicionar uma função que inclui o slug (não remover a existente, usada por outros fluxos):

```ts
export function getLoginFailureKeyComEmpresa(headers: Headers, slug: string, email: string): string {
  const e = email.toLowerCase().trim() || "unknown";
  const s = slug.toLowerCase().trim() || "unknown";
  return `${getClientIp(headers)}:${s}:${e}`;
}
```

- [ ] **Step 2: Reescrever o handler de login** (`src/app/api/auth/login/route.ts`)

Mudanças: schema ganha `empresa` (slug); resolve empresa; lookup composto; dummy bcrypt; throttle por slug. Substituir do schema até o bloco de credenciais:

```ts
const schema = z.object({
  empresa: z.string().min(1).max(40),
  email: z.string().email().max(200),
  senha: z.string().min(1).max(200),
  lembrar: z.boolean().optional(),
});

// Hash constante p/ dummy compare (uniformiza tempo quando empresa/usuario nao existem).
// bcrypt de uma string fixa; valor nunca confere com senha real.
const DUMMY_HASH = "$2a$10$CwTycUXWue0Thq9StjUM0uJ8e7Xe7m6Q3p3l2n5kAaBbCcDdEeFfG";

export async function POST(req: Request) {
  const origemBloqueada = originViolationResponse(req);
  if (origemBloqueada) return origemBloqueada;

  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ erro: "JSON_INVALIDO" }, { status: 400 }); }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ erro: "DADOS_INVALIDOS" }, { status: 400 });

  const slug = parsed.data.empresa.toLowerCase().trim();
  const email = parsed.data.email.toLowerCase().trim();
  const lembrar = parsed.data.lembrar === true;

  const empresa = await db.empresa.findUnique({ where: { slug }, select: { id: true, ativa: true } });
  const user = empresa
    ? await db.usuario.findUnique({
        where: { empresaId_email: { empresaId: empresa.id, email } },
      })
    : null;

  // Dummy bcrypt SEMPRE: tempo uniforme exista o usuario ou nao (anti-enumeracao).
  const senhaOk = user
    ? await bcrypt.compare(parsed.data.senha, user.senhaHash)
    : (await bcrypt.compare(parsed.data.senha, DUMMY_HASH), false);

  const empresaInativa = empresa != null && empresa.ativa === false;

  if (!empresa || !user || !user.ativo || empresaInativa || !senhaOk) {
    const failureLimit = await recordLoginFailureByKey(
      getLoginFailureKeyComEmpresa(req.headers, slug, email),
    );
    await auditLog({
      req, acao: TipoAuditLog.LOGIN_FALHA, entidade: "Usuario",
      entidadeId: user?.id ?? null, metadata: { email, slug },
    });
    if (failureLimit.limited) {
      return NextResponse.json(
        { erro: "MUITAS_TENTATIVAS_LOGIN", retryAfterSeconds: failureLimit.retryAfterSeconds },
        { status: 429, headers: { "Retry-After": String(failureLimit.retryAfterSeconds) } },
      );
    }
    return NextResponse.json({ erro: "CREDENCIAIS_INVALIDAS" }, { status: 401 });
  }

  await resetLoginFailuresByKey(getLoginFailureKeyComEmpresa(req.headers, slug, email));
  // ... (segue IGUAL: bloco 2FA + criacao de sessao). O signSession ja inclui
  //     empresaId: user.empresaId — manter.
```

Atualizar os imports: trocar `recordLoginFailure, resetLoginFailures` por `recordLoginFailureByKey, resetLoginFailuresByKey, getLoginFailureKeyComEmpresa`. No bloco 2FA (que segue), o challenge não muda; o `signSession` no final já carrega `empresaId: user.empresaId ?? undefined` — manter (agora `empresaId` é sempre presente).

- [ ] **Step 3: Verificar o caminho 2FA carrega empresaId**

No mesmo arquivo, o ramo `if (user.twoFactorEnabled ...)` retorna `{ requires2FA, challengeId, lembrar }`. O `empresaId` será carimbado na sessão emitida pelo endpoint `2fa/verificar` (Task 13). Aqui, garanta apenas que nada do dummy/slug quebrou esse ramo.

- [ ] **Step 4: Lint + typecheck**

Run: `npx eslint src/app/api/auth/login/route.ts src/lib/auth-rate-limit.ts && npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/auth/login/route.ts src/lib/auth-rate-limit.ts
git commit -m "feat(auth): login multiempresa por slug + dummy bcrypt + throttle por empresa"
```

---

### Task 12: Campo "Empresa" no formulário de login

**Files:**
- Modify: `src/app/login/login-form.tsx`

- [ ] **Step 1: Inspecionar o form atual**

Leia `src/app/login/login-form.tsx`. Identifique: estado dos campos, leitura de `searchParams`, e o `fetch("/api/auth/login")`.

- [ ] **Step 2: Adicionar o campo empresa (prefill via `?empresa=`)**

- Adicionar estado `const [empresa, setEmpresa] = useState(searchParams.get("empresa") ?? "")` (use `useSearchParams` se o componente for client).
- Adicionar input "Empresa" ANTES do e-mail, com `value={empresa}`.
- Se houver `?email=` na URL, pré-preencher o e-mail também.
- Incluir `empresa` no corpo do `fetch`: `body: JSON.stringify({ empresa, email, senha, lembrar })`.

Padrão do input (seguir o estilo dos demais campos do arquivo):
```tsx
<label>Empresa</label>
<input value={empresa} onChange={(e) => setEmpresa(e.target.value)} placeholder="ex: lojax" autoComplete="organization" />
```

- [ ] **Step 3: Lint + typecheck**

Run: `npx eslint src/app/login/login-form.tsx && npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 4: Commit**

```bash
git add src/app/login/login-form.tsx
git commit -m "feat(auth): campo Empresa no login (prefill por query do convite)"
```

---

### Task 13: 2FA carimba empresaId na sessão

**Files:**
- Modify: `src/app/api/auth/2fa/verificar/route.ts`

- [ ] **Step 1: Inspecionar e localizar o `signSession`**

Leia `src/app/api/auth/2fa/verificar/route.ts`. Localize o `signSession({...})` que cria a sessão após validar o código. Verifique se já inclui `empresaId`.

- [ ] **Step 2: Garantir `empresaId` no payload**

O endpoint busca o usuário (por `usuarioId` do challenge). No `signSession`, incluir:
```ts
empresaId: user.empresaId ?? undefined,
```
(O `user` carregado já tem `empresaId` — confirme o `select`/objeto. Se o `select` omitir `empresaId`, adicione-o.)

- [ ] **Step 3: Lint + typecheck**

Run: `npx eslint src/app/api/auth/2fa/verificar/route.ts && npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/auth/2fa/verificar/route.ts
git commit -m "fix(auth): 2FA carimba empresaId na sessao emitida"
```

---

### Task 14: Ripple do email composto — recuperar-senha + perfil

**Files:**
- Modify: `src/app/api/auth/recuperar-senha/route.ts:55`
- Modify: `src/app/api/perfil/route.ts:47-48`

- [ ] **Step 1: `recuperar-senha` tenant-aware**

Ler o arquivo. O schema atual aceita `{ email }`. Adicionar `empresa` (slug) ao schema; resolver empresa por slug; trocar o lookup:
```ts
const empresa = await db.empresa.findUnique({ where: { slug }, select: { id: true } });
const user = empresa
  ? await db.usuario.findUnique({ where: { empresaId_email: { empresaId: empresa.id, email } } })
  : null;
```
Manter a resposta UNIFORME (o endpoint já responde igual exista ou não o usuário — preservar). O token de recuperação continua escopado a `usuarioId`.

- [ ] **Step 2: Localizar a UI de "esqueci a senha"**

`grep -rn "recuperar-senha" src/app` para achar o form que chama o endpoint; adicionar o campo "Empresa" (slug) nele, igual ao login. (Se não existir página dedicada, o link parte do login — adicionar o campo no fluxo correspondente.)

- [ ] **Step 3: `perfil` — unicidade de email escopada à empresa**

Em `src/app/api/perfil/route.ts`, a checagem de conflito ao trocar o email usa `findUnique({ where: { email: novoEmail } })` — quebra com email composto. Trocar por escopo da empresa da sessão:
```ts
const conflito = await db.usuario.findUnique({
  where: { empresaId_email: { empresaId: session.empresaId!, email: novoEmail } },
  select: { id: true },
});
```
(Confirme que `session` aqui é o `SessionPayload` com `empresaId`. Em enforce sempre presente.)

- [ ] **Step 4: Typecheck (pega qualquer outro findUnique-por-email remanescente)**

Run: `npx tsc --noEmit`
Expected: sem erros. Se o compilador apontar outro `where: { email }` em `usuario.findUnique`, corrija para a composta (o sweep da Task de planejamento achou login/recuperar/perfil/seed; o tsc confirma que não sobrou nenhum).

- [ ] **Step 5: Commit**

```bash
git add src/app/api/auth/recuperar-senha/route.ts src/app/api/perfil/route.ts
git commit -m "fix(auth): recuperar-senha e perfil usam email composto por empresa"
```

---

## ÁREA 5 — Sessão de plataforma + UI /plataforma

### Task 15: Sessão de plataforma (cookie próprio, self-contained)

**Files:**
- Create: `src/lib/plataforma-session.ts`
- Test: `src/lib/plataforma-session.test.ts`

> Decisão de risco: NÃO reutilizar `session.ts` (evita tocar a auth de produção e mudar formato de cookie). `plataforma-session.ts` é self-contained, usa `PLATAFORMA_SESSION_SECRET` (secret separado) e cookie `erp_plat_session`. Duplicação mínima e isolada das primitivas HMAC.

- [ ] **Step 1: Teste falhando** (`src/lib/plataforma-session.test.ts`)

```ts
import { describe, it, expect, beforeAll } from "vitest";
import { signPlataformaSession, verifyPlataformaSession } from "./plataforma-session";

beforeAll(() => { process.env.PLATAFORMA_SESSION_SECRET = "x".repeat(48); });

describe("plataforma-session", () => {
  it("assina e verifica round-trip", async () => {
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const token = await signPlataformaSession({ puid: "p1", email: "a@b.com", nome: "A", v: 0, exp });
    const payload = await verifyPlataformaSession(token);
    expect(payload?.puid).toBe("p1");
  });
  it("rejeita assinatura adulterada", async () => {
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const token = await signPlataformaSession({ puid: "p1", email: "a@b.com", nome: "A", v: 0, exp });
    expect(await verifyPlataformaSession(token + "x")).toBeNull();
  });
  it("rejeita expirado", async () => {
    const token = await signPlataformaSession({ puid: "p1", email: "a@b.com", nome: "A", v: 0, exp: 1 });
    expect(await verifyPlataformaSession(token)).toBeNull();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run --no-file-parallelism src/lib/plataforma-session.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implementar** (`src/lib/plataforma-session.ts`) — espelha as primitivas de `session.ts`

```ts
export const PLATAFORMA_COOKIE_NAME = "erp_plat_session";
const TWELVE_HOURS = 60 * 60 * 12;

export type PlataformaSessionPayload = {
  puid: string;
  email: string;
  nome: string;
  v: number;
  exp: number;
};

function getSecret(): string {
  const s = process.env.PLATAFORMA_SESSION_SECRET;
  if (!s || s.length < 32) {
    throw new Error("PLATAFORMA_SESSION_SECRET ausente ou < 32 chars.");
  }
  return s;
}

function b64urlEncode(bytes: Uint8Array): string {
  let s = ""; for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]!);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlDecode(str: string): Uint8Array {
  const pad = (4 - (str.length % 4)) % 4;
  const bin = atob(str.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat(pad));
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr;
}
async function hmacKey(): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", new TextEncoder().encode(getSecret()),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}
function asBuf(a: Uint8Array): ArrayBuffer {
  return a.buffer.slice(a.byteOffset, a.byteOffset + a.byteLength) as ArrayBuffer;
}

export async function signPlataformaSession(p: PlataformaSessionPayload): Promise<string> {
  const key = await hmacKey();
  const bytes = new TextEncoder().encode(JSON.stringify(p));
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, asBuf(bytes)));
  return `${b64urlEncode(bytes)}.${b64urlEncode(sig)}`;
}

export async function verifyPlataformaSession(token: string | null | undefined): Promise<PlataformaSessionPayload | null> {
  if (!token) return null;
  try {
    const [pp, sp] = token.split(".");
    if (!pp || !sp) return null;
    const key = await hmacKey();
    const ok = await crypto.subtle.verify("HMAC", key, asBuf(b64urlDecode(sp)), asBuf(b64urlDecode(pp)));
    if (!ok) return null;
    const payload = JSON.parse(new TextDecoder().decode(b64urlDecode(pp))) as PlataformaSessionPayload;
    if (typeof payload.exp !== "number" || payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch { return null; }
}

export function buildPlataformaCookieOptions() {
  return {
    httpOnly: true, sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production" || process.env.COOKIE_SECURE === "true",
    path: "/", maxAge: TWELVE_HOURS, priority: "high" as const,
  };
}
export function buildPlataformaExpiry(): number {
  return Math.floor(Date.now() / 1000) + TWELVE_HOURS;
}
export function buildPlataformaClearCookie() {
  return { httpOnly: true, sameSite: "lax" as const, secure: process.env.NODE_ENV === "production", path: "/", maxAge: 0 };
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run --no-file-parallelism src/lib/plataforma-session.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/plataforma-session.ts src/lib/plataforma-session.test.ts
git commit -m "feat(plataforma): sessao de plataforma (cookie erp_plat_session, HMAC)"
```

---

### Task 16: Guard `requireSuperAdmin` + `getPlataformaSession`

**Files:**
- Create: `src/lib/plataforma-auth.ts`

- [ ] **Step 1: Implementar** (`src/lib/plataforma-auth.ts`)

```ts
import { cookies } from "next/headers";
import { db } from "./db";
import {
  PLATAFORMA_COOKIE_NAME, verifyPlataformaSession,
  type PlataformaSessionPayload,
} from "./plataforma-session";

export async function getPlataformaSession(): Promise<PlataformaSessionPayload | null> {
  const jar = await cookies();
  const payload = await verifyPlataformaSession(jar.get(PLATAFORMA_COOKIE_NAME)?.value);
  if (!payload) return null;
  const u = await db.plataformaUsuario.findUnique({
    where: { id: payload.puid },
    select: { ativo: true, sessionVersion: true },
  });
  if (!u || !u.ativo) return null;
  if (payload.v !== u.sessionVersion) return null;
  return payload;
}

/** Para route handlers /api/plataforma/*. Lanca 401 se nao houver superadmin. */
export async function requireSuperAdmin(): Promise<PlataformaSessionPayload> {
  const s = await getPlataformaSession();
  if (!s) {
    throw new Response(JSON.stringify({ erro: "NAO_AUTENTICADO" }), {
      status: 401, headers: { "content-type": "application/json" },
    });
  }
  return s;
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 3: Commit**

```bash
git add src/lib/plataforma-auth.ts
git commit -m "feat(plataforma): requireSuperAdmin + getPlataformaSession"
```

---

### Task 17: API de login/logout da plataforma

**Files:**
- Create: `src/app/api/plataforma/login/route.ts`
- Create: `src/app/api/plataforma/logout/route.ts`

- [ ] **Step 1: Implementar login** (`src/app/api/plataforma/login/route.ts`)

```ts
import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { db } from "@/lib/db";
import {
  PLATAFORMA_COOKIE_NAME, signPlataformaSession,
  buildPlataformaCookieOptions, buildPlataformaExpiry,
} from "@/lib/plataforma-session";
import { originViolationResponse } from "@/lib/origin-check";
import { recordLoginFailureByKey, resetLoginFailuresByKey, getClientIp } from "@/lib/auth-rate-limit";
import { auditPlataforma } from "@/modules/plataforma/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({ email: z.string().email().max(200), senha: z.string().min(1).max(200) });
const DUMMY_HASH = "$2a$10$CwTycUXWue0Thq9StjUM0uJ8e7Xe7m6Q3p3l2n5kAaBbCcDdEeFfG";

export async function POST(req: Request) {
  const bloqueio = originViolationResponse(req);
  if (bloqueio) return bloqueio;

  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ erro: "JSON_INVALIDO" }, { status: 400 }); }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ erro: "DADOS_INVALIDOS" }, { status: 400 });

  const email = parsed.data.email.toLowerCase().trim();
  const key = `plataforma:${getClientIp(req.headers)}:${email}`;
  const u = await db.plataformaUsuario.findUnique({ where: { email } });
  const senhaOk = u
    ? await bcrypt.compare(parsed.data.senha, u.senhaHash)
    : (await bcrypt.compare(parsed.data.senha, DUMMY_HASH), false);

  if (!u || !u.ativo || !senhaOk) {
    const lim = await recordLoginFailureByKey(key);
    if (lim.limited) {
      return NextResponse.json({ erro: "MUITAS_TENTATIVAS_LOGIN", retryAfterSeconds: lim.retryAfterSeconds },
        { status: 429, headers: { "Retry-After": String(lim.retryAfterSeconds) } });
    }
    return NextResponse.json({ erro: "CREDENCIAIS_INVALIDAS" }, { status: 401 });
  }

  await resetLoginFailuresByKey(key);
  await db.plataformaUsuario.update({ where: { id: u.id }, data: { ultimoAcesso: new Date() } });
  const token = await signPlataformaSession({
    puid: u.id, email: u.email, nome: u.nome, v: u.sessionVersion, exp: buildPlataformaExpiry(),
  });
  await auditPlataforma({ plataformaUsuarioId: u.id, acao: "LOGIN_PLATAFORMA", ip: getClientIp(req.headers) });

  const res = NextResponse.json({ ok: true });
  res.cookies.set(PLATAFORMA_COOKIE_NAME, token, buildPlataformaCookieOptions());
  return res;
}
```

- [ ] **Step 2: Implementar logout** (`src/app/api/plataforma/logout/route.ts`)

```ts
import { NextResponse } from "next/server";
import { PLATAFORMA_COOKIE_NAME, buildPlataformaClearCookie } from "@/lib/plataforma-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(PLATAFORMA_COOKIE_NAME, "", buildPlataformaClearCookie());
  return res;
}
```

- [ ] **Step 3: Lint + typecheck**

Run: `npx eslint src/app/api/plataforma/login/route.ts src/app/api/plataforma/logout/route.ts && npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/plataforma/login/route.ts src/app/api/plataforma/logout/route.ts
git commit -m "feat(plataforma): login/logout do superadmin (cookie separado + dummy bcrypt)"
```

---

### Task 18: API de empresas (criar/listar/gerir)

**Files:**
- Create: `src/app/api/plataforma/empresas/route.ts`
- Create: `src/app/api/plataforma/empresas/[id]/desativar/route.ts`
- Create: `src/app/api/plataforma/empresas/[id]/reativar/route.ts`
- Create: `src/app/api/plataforma/empresas/[id]/reenviar-convite/route.ts`

- [ ] **Step 1: Criar/listar** (`src/app/api/plataforma/empresas/route.ts`)

```ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSuperAdmin } from "@/lib/plataforma-auth";
import { originViolationResponse } from "@/lib/origin-check";
import { criarEmpresa, listarEmpresas } from "@/modules/plataforma/empresas";
import { enviarConviteAdmin } from "@/lib/email-convite";
import { auditPlataforma } from "@/modules/plataforma/audit";
import { getClientIp } from "@/lib/auth-rate-limit";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  nome: z.string().min(2).max(120),
  slug: z.string().min(3).max(30),
  admin: z.object({ nome: z.string().min(2).max(120), email: z.string().email().max(200) }),
});

export async function GET() {
  await requireSuperAdmin();
  return NextResponse.json({ empresas: await listarEmpresas() });
}

export async function POST(req: Request) {
  const bloqueio = originViolationResponse(req);
  if (bloqueio) return bloqueio;
  const su = await requireSuperAdmin();

  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ erro: "JSON_INVALIDO" }, { status: 400 }); }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ erro: "DADOS_INVALIDOS" }, { status: 400 });

  let result;
  try {
    result = await criarEmpresa(parsed.data);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "ERRO";
    if (msg.startsWith("SLUG_INVALIDO")) return NextResponse.json({ erro: "SLUG_INVALIDO", detalhe: msg }, { status: 400 });
    // P2002 = slug/email duplicado
    if (msg.includes("Unique constraint") || (err as { code?: string })?.code === "P2002") {
      return NextResponse.json({ erro: "SLUG_OU_EMAIL_DUPLICADO" }, { status: 409 });
    }
    logger.error({ err }, "[plataforma] falha criarEmpresa");
    return NextResponse.json({ erro: "ERRO_INTERNO" }, { status: 500 });
  }

  await auditPlataforma({ plataformaUsuarioId: su.puid, acao: "EMPRESA_CRIADA", empresaIdAlvo: result.empresaId, metadata: { slug: parsed.data.slug }, ip: getClientIp(req.headers) });
  const envio = await enviarConviteAdmin({
    to: parsed.data.admin.email, nome: parsed.data.admin.nome,
    empresaNome: parsed.data.nome, slug: parsed.data.slug, rawToken: result.rawToken,
  });
  await auditPlataforma({ plataformaUsuarioId: su.puid, acao: "ADMIN_CONVIDADO", empresaIdAlvo: result.empresaId, metadata: { email: parsed.data.admin.email, viaConsole: envio.viaConsole }, ip: getClientIp(req.headers) });

  return NextResponse.json({ ok: true, empresaId: result.empresaId, conviteViaConsole: envio.viaConsole });
}
```

- [ ] **Step 2: Desativar** (`src/app/api/plataforma/empresas/[id]/desativar/route.ts`)

```ts
import { NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/plataforma-auth";
import { originViolationResponse } from "@/lib/origin-check";
import { desativarEmpresa } from "@/modules/plataforma/empresas";
import { auditPlataforma } from "@/modules/plataforma/audit";
import { getClientIp } from "@/lib/auth-rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function POST(req: Request, { params }: Params) {
  const bloqueio = originViolationResponse(req);
  if (bloqueio) return bloqueio;
  const su = await requireSuperAdmin();
  const { id } = await params;
  await desativarEmpresa(id);
  await auditPlataforma({ plataformaUsuarioId: su.puid, acao: "EMPRESA_DESATIVADA", empresaIdAlvo: id, ip: getClientIp(req.headers) });
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 3: Reativar** (`src/app/api/plataforma/empresas/[id]/reativar/route.ts`)

Idêntico ao desativar, trocando `desativarEmpresa`→`reativarEmpresa` e `acao`→`"EMPRESA_REATIVADA"`.

```ts
import { NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/plataforma-auth";
import { originViolationResponse } from "@/lib/origin-check";
import { reativarEmpresa } from "@/modules/plataforma/empresas";
import { auditPlataforma } from "@/modules/plataforma/audit";
import { getClientIp } from "@/lib/auth-rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Params = { params: Promise<{ id: string }> };

export async function POST(req: Request, { params }: Params) {
  const bloqueio = originViolationResponse(req);
  if (bloqueio) return bloqueio;
  const su = await requireSuperAdmin();
  const { id } = await params;
  await reativarEmpresa(id);
  await auditPlataforma({ plataformaUsuarioId: su.puid, acao: "EMPRESA_REATIVADA", empresaIdAlvo: id, ip: getClientIp(req.headers) });
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 4: Reenviar convite** (`src/app/api/plataforma/empresas/[id]/reenviar-convite/route.ts`)

Adicionar antes a função em `empresas.ts`:
```ts
import { gerarTokenConvite, expiracaoConvite } from "./convite";
// ...
export async function reenviarConvite(empresaId: string): Promise<{
  ok: boolean; rawToken?: string; admin?: { nome: string; email: string }; empresaNome?: string; slug?: string;
}> {
  const empresa = await db.empresa.findUnique({ where: { id: empresaId }, select: { nome: true, slug: true } });
  if (!empresa) return { ok: false };
  // admin = usuario ADMIN mais antigo da empresa que ainda nao usou o convite
  const admin = await db.usuario.findFirst({
    where: { empresaId, role: "ADMIN" }, orderBy: { createdAt: "asc" },
    select: { id: true, nome: true, email: true },
  });
  if (!admin) return { ok: false };
  const { rawToken, tokenHash } = gerarTokenConvite();
  await db.$transaction([
    db.conviteUsuario.updateMany({ where: { usuarioId: admin.id, usadoEm: null }, data: { usadoEm: new Date() } }),
    db.conviteUsuario.create({ data: { usuarioId: admin.id, tokenHash, expiresAt: expiracaoConvite() } }),
  ]);
  return { ok: true, rawToken, admin: { nome: admin.nome, email: admin.email }, empresaNome: empresa.nome, slug: empresa.slug };
}
```
Rota:
```ts
import { NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/plataforma-auth";
import { originViolationResponse } from "@/lib/origin-check";
import { reenviarConvite } from "@/modules/plataforma/empresas";
import { enviarConviteAdmin } from "@/lib/email-convite";
import { auditPlataforma } from "@/modules/plataforma/audit";
import { getClientIp } from "@/lib/auth-rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Params = { params: Promise<{ id: string }> };

export async function POST(req: Request, { params }: Params) {
  const bloqueio = originViolationResponse(req);
  if (bloqueio) return bloqueio;
  const su = await requireSuperAdmin();
  const { id } = await params;
  const r = await reenviarConvite(id);
  if (!r.ok || !r.rawToken || !r.admin) return NextResponse.json({ erro: "NAO_ENCONTRADO" }, { status: 404 });
  const envio = await enviarConviteAdmin({ to: r.admin.email, nome: r.admin.nome, empresaNome: r.empresaNome!, slug: r.slug!, rawToken: r.rawToken });
  await auditPlataforma({ plataformaUsuarioId: su.puid, acao: "CONVITE_REENVIADO", empresaIdAlvo: id, ip: getClientIp(req.headers) });
  return NextResponse.json({ ok: true, conviteViaConsole: envio.viaConsole });
}
```

- [ ] **Step 5: Lint + typecheck**

Run: `npx eslint src/app/api/plataforma/empresas/route.ts "src/app/api/plataforma/empresas/[id]/desativar/route.ts" "src/app/api/plataforma/empresas/[id]/reativar/route.ts" "src/app/api/plataforma/empresas/[id]/reenviar-convite/route.ts" src/modules/plataforma/empresas.ts && npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 6: Commit**

```bash
git add src/app/api/plataforma/empresas/route.ts "src/app/api/plataforma/empresas/[id]" src/modules/plataforma/empresas.ts
git commit -m "feat(plataforma): API de empresas (criar/listar/desativar/reativar/reenviar convite)"
```

---

### Task 19: UI da plataforma (layout guard + login + lista + wizard)

**Files:**
- Create: `src/app/plataforma/layout.tsx`
- Create: `src/app/plataforma/login/page.tsx` + `form.tsx`
- Create: `src/app/plataforma/page.tsx`
- Create: `src/app/plataforma/empresas/nova/page.tsx` + `form.tsx`

- [ ] **Step 1: Layout com guard server-side** (`src/app/plataforma/layout.tsx`)

```tsx
import { redirect } from "next/navigation";
import { getPlataformaSession } from "@/lib/plataforma-auth";

export const dynamic = "force-dynamic";

export default async function PlataformaLayout({ children }: { children: React.ReactNode }) {
  // O login da plataforma NAO passa pelo guard (senao loop). Ele vive em
  // /plataforma/login e checa sessao por conta propria (redireciona se ja logado).
  return <div style={{ minHeight: "100vh" }}>{children}</div>;
}
```

> NOTA: como `/plataforma/login` é filha de `/plataforma`, o guard NÃO pode ir no layout raiz (causaria loop). Em vez disso, cada PÁGINA protegida (`page.tsx`, `empresas/nova/page.tsx`) chama `getPlataformaSession()` e redireciona se `null`. O layout fica neutro. (Alternativa: subrota `/plataforma/(protegido)/...` com layout próprio — opcional.)

- [ ] **Step 2: Página de login da plataforma** (`src/app/plataforma/login/page.tsx`)

```tsx
import { redirect } from "next/navigation";
import { getPlataformaSession } from "@/lib/plataforma-auth";
import { PlataformaLoginForm } from "./form";

export const dynamic = "force-dynamic";

export default async function Page() {
  if (await getPlataformaSession()) redirect("/plataforma");
  return (
    <div style={{ display: "flex", minHeight: "100vh", alignItems: "center", justifyContent: "center" }}>
      <PlataformaLoginForm />
    </div>
  );
}
```

- [ ] **Step 3: Form de login** (`src/app/plataforma/login/form.tsx`)

```tsx
"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export function PlataformaLoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setErro(null); setLoading(true);
    const res = await fetch("/api/plataforma/login", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, senha }),
    });
    setLoading(false);
    if (!res.ok) { setErro("Credenciais inválidas."); return; }
    router.push("/plataforma");
  }

  return (
    <form onSubmit={submit} style={{ width: 320, display: "flex", flexDirection: "column", gap: 10 }}>
      <h2>Plataforma · Atlas Seller</h2>
      <input type="email" placeholder="E-mail" value={email} onChange={(e) => setEmail(e.target.value)} />
      <input type="password" placeholder="Senha" value={senha} onChange={(e) => setSenha(e.target.value)} />
      {erro && <p style={{ color: "#dc2626", fontSize: 13 }}>{erro}</p>}
      <button disabled={loading} type="submit">{loading ? "Entrando..." : "Entrar"}</button>
    </form>
  );
}
```

- [ ] **Step 4: Dashboard de empresas** (`src/app/plataforma/page.tsx`)

```tsx
import { redirect } from "next/navigation";
import Link from "next/link";
import { getPlataformaSession } from "@/lib/plataforma-auth";
import { listarEmpresas } from "@/modules/plataforma/empresas";

export const dynamic = "force-dynamic";

export default async function Page() {
  if (!(await getPlataformaSession())) redirect("/plataforma/login");
  const empresas = await listarEmpresas();
  return (
    <div style={{ maxWidth: 880, margin: "40px auto", padding: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h1>Empresas</h1>
        <Link href="/plataforma/empresas/nova">+ Nova empresa</Link>
      </div>
      <table style={{ width: "100%", marginTop: 16, borderCollapse: "collapse" }}>
        <thead><tr><th>Nome</th><th>Slug</th><th>Usuários</th><th>Amazon</th><th>Status</th></tr></thead>
        <tbody>
          {empresas.map((e) => (
            <tr key={e.id} style={{ borderTop: "1px solid #e5e7eb" }}>
              <td>{e.nome}</td><td><code>{e.slug}</code></td>
              <td>{e._count.usuarios}</td><td>{e._count.amazonAccounts}</td>
              <td>{e.ativa ? "Ativa" : "Inativa"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 5: Wizard de nova empresa** (`src/app/plataforma/empresas/nova/page.tsx`)

```tsx
import { redirect } from "next/navigation";
import { getPlataformaSession } from "@/lib/plataforma-auth";
import { NovaEmpresaForm } from "./form";

export const dynamic = "force-dynamic";

export default async function Page() {
  if (!(await getPlataformaSession())) redirect("/plataforma/login");
  return (
    <div style={{ maxWidth: 480, margin: "40px auto", padding: 16 }}>
      <h1>Nova empresa</h1>
      <NovaEmpresaForm />
    </div>
  );
}
```

- [ ] **Step 6: Form do wizard** (`src/app/plataforma/empresas/nova/form.tsx`)

```tsx
"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export function NovaEmpresaForm() {
  const router = useRouter();
  const [nome, setNome] = useState("");
  const [slug, setSlug] = useState("");
  const [adminNome, setAdminNome] = useState("");
  const [adminEmail, setAdminEmail] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setErro(null); setMsg(null); setLoading(true);
    const res = await fetch("/api/plataforma/empresas", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ nome, slug, admin: { nome: adminNome, email: adminEmail } }),
    });
    setLoading(false);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { setErro(data.erro === "SLUG_OU_EMAIL_DUPLICADO" ? "Slug já existe." : data.detalhe || "Erro ao criar."); return; }
    setMsg(data.conviteViaConsole ? "Empresa criada. Convite logado no console (SMTP não configurado)." : "Empresa criada. Convite enviado por e-mail.");
    setTimeout(() => router.push("/plataforma"), 1500);
  }

  return (
    <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 16 }}>
      <input placeholder="Nome da empresa" value={nome} onChange={(e) => setNome(e.target.value)} />
      <input placeholder="Slug (ex: lojax)" value={slug} onChange={(e) => setSlug(e.target.value.toLowerCase())} />
      <input placeholder="Nome do admin" value={adminNome} onChange={(e) => setAdminNome(e.target.value)} />
      <input type="email" placeholder="E-mail do admin" value={adminEmail} onChange={(e) => setAdminEmail(e.target.value)} />
      {erro && <p style={{ color: "#dc2626", fontSize: 13 }}>{erro}</p>}
      {msg && <p style={{ color: "#16a34a", fontSize: 13 }}>{msg}</p>}
      <button disabled={loading} type="submit">{loading ? "Criando..." : "Criar empresa + convidar admin"}</button>
    </form>
  );
}
```

- [ ] **Step 7: Lint + typecheck + smoke**

Run: `npx eslint "src/app/plataforma/**/*.tsx" && npx tsc --noEmit`
Expected: sem erros.
Smoke (opcional): `npm run dev:web`, logar em `/plataforma/login` com o superadmin da Task 8, criar uma empresa, ver o convite logado, abrir o link, definir senha, logar em `/login?empresa=<slug>`.

- [ ] **Step 8: Commit**

```bash
git add src/app/plataforma
git commit -m "feat(plataforma): UI (login, lista de empresas, wizard de criacao)"
```

---

## ÁREA 6 — Regressão de isolamento + verificação final

### Task 20: Estender o teste de isolamento 2-empresas

**Files:**
- Modify: `scripts/test-isolamento-2-empresas.ts`

- [ ] **Step 1: Adicionar asserções de onboarding + login multiempresa**

No final do script (antes do summary de asserções), adicionar um bloco que:
1. Cria 2 empresas via `criarEmpresa` (slugs `iso-a`, `iso-b`) com o MESMO e-mail de admin (`dup@x.com`).
2. Asserção: `usuario.findUnique({where:{empresaId_email:{empresaId: A, email}}})` e o de B retornam usuários DIFERENTES (mesmo e-mail coexiste).
3. Asserção: cada empresa tem `CATEGORIAS_PADRAO.length + 1` categorias e 1 sentinela fornecedor.
4. Asserção (isolamento): sob `runWithTenant({empresaId:A})`, `db.categoria.findMany()` só traz as de A (count == seed de A), e nenhuma de B.
5. Limpeza no fim (deletar as 2 empresas + cascatas).

Seguir o padrão existente do arquivo (callbacks `async () =>` dentro de `runWithTenant`, contagem de asserções). Reusar `criarEmpresa` de `@/modules/plataforma/empresas` e `CATEGORIAS_PADRAO` de `@/modules/plataforma/seed-empresa`.

- [ ] **Step 2: Rodar o script**

Run:
```bash
DATABASE_URL="file:C:/Projects/ERP-AMAZON/prisma/test-iso.db" npx prisma db push --schema prisma/schema.prisma --skip-generate
DATABASE_URL="file:C:/Projects/ERP-AMAZON/prisma/test-iso.db" TENANT_ISOLATION=enforce npx tsx scripts/test-isolamento-2-empresas.ts
```
Expected: todas as asserções passam (as 11 originais + as novas). Saída final "OK".

- [ ] **Step 3: Commit**

```bash
git add scripts/test-isolamento-2-empresas.ts
git commit -m "test(multitenant): isolamento 2-empresas cobre onboarding + login por slug"
```

---

### Task 21: Verificação final (suite + lint + typecheck)

**Files:** nenhum (gate de qualidade)

- [ ] **Step 1: Typecheck completo**

Run: `npx tsc --noEmit`
Expected: zero erros.

- [ ] **Step 2: Lint dos arquivos tocados**

Run: `npx eslint src/modules/plataforma src/lib/plataforma-session.ts src/lib/plataforma-auth.ts src/lib/email-convite.ts "src/app/plataforma/**/*.tsx" "src/app/api/plataforma/**/*.ts" src/app/api/definir-senha/route.ts "src/app/definir-senha/*.tsx" src/app/api/auth/login/route.ts`
Expected: zero erros.

- [ ] **Step 3: Suite de testes do módulo**

Run: `DATABASE_URL="file:C:/Projects/ERP-AMAZON/prisma/dev.db" TENANT_ISOLATION=enforce npx vitest run --no-file-parallelism src/modules/plataforma src/lib/plataforma-session.test.ts src/lib/tenant-isolation.test.ts`
Expected: todos PASS.

- [ ] **Step 4: Suite completa (sanity, sem quebrar o que já existia)**

Run: `DATABASE_URL="file:C:/Projects/ERP-AMAZON/prisma/dev.db" npx vitest run --no-file-parallelism`
Expected: verde (≥ os 291 testes anteriores + os novos). Investigar qualquer regressão antes de prosseguir.

- [ ] **Step 5: Commit (se houver ajustes da verificação)**

```bash
git add -- <arquivos ajustados explicitos>
git commit -m "chore(multitenant): ajustes de verificacao final A+B"
```

---

### Task 22: Deploy (somente quando o usuário autorizar)

> NÃO executar sem o usuário pedir. Resumo da sequência (detalhe no CLAUDE.md):

- [ ] `pg_dump -Fc` na VPS + cópia offsite.
- [ ] `git pull --ff-only` (com o stash dos tracked do Codex, conforme CLAUDE.md).
- [ ] `npm install` (caso deps mudem — aqui não muda).
- [ ] `npm run prisma:migrate:deploy:pg` (aplica `20260601000000_multiempresa_onboarding`).
- [ ] `npm run prisma:generate:pg` (OBRIGATÓRIO — senão o client fica sem `conviteUsuario`/`auditPlataforma`).
- [ ] Setar `PLATAFORMA_SESSION_SECRET` (>=48 hex) no `.env` da VPS.
- [ ] `rm -rf .next && npm run build`.
- [ ] `pm2 reload erp-web` · `pm2 reload erp-worker` · `pm2 reload erp-sqs-consumer` (3 chamadas).
- [ ] `npx tsx scripts/criar-superadmin.ts --email ... --nome ... --senha ...` na VPS.
- [ ] Validar: login `/plataforma/login` → criar empresa de teste → fluxo convite/definir-senha → login multiempresa → isolamento. Conferir `mundofs` continua logando normalmente.

---

## Self-Review (preenchido pelo autor do plano)

**Cobertura da spec:**
- Seção 1 (modelo) → Tasks 1-3. ✓
- Seção 2 (criarEmpresa/seed) → Tasks 4-7. ✓
- Seção 3 (convite/e-mail/definir-senha) → Tasks 5, 9, 10. ✓
- Seção 4 (login multiempresa + ripple) → Tasks 11-14. ✓
- Seção 5 (plataforma/auth/UI) → Tasks 8, 15-19. ✓
- Seção 6 (segurança) → distribuída: dummy bcrypt (11,17), throttle por slug (11), cookie separado (15), token hash/single-use/expira (5,10), origin em mutações (10,11,17,18), blocklist slug (4), auditoria (7,17,18), política de senha (8,10). ✓
- Seção 7 (testes) → Tasks 4,5,6,7,15,20,21. ✓

**Consistência de tipos:** `criarEmpresa` retorna `{empresaId, adminId, rawToken}` (usado igual em testes e rota). `semearEmpresa(client, empresaId)` assinatura única. `gerarTokenConvite()`→`{rawToken, tokenHash}`, `hashTokenConvite(raw)`→hex. `PlataformaSessionPayload {puid,email,nome,v,exp}` consistente entre sign/verify/auth/rota. `auditPlataforma` assinatura única.

**Pendência consciente registrada no plano:** Recuperação de senha — localizar a UI exata na Task 14 Step 2 (o endpoint é certo; a página de "esqueci a senha" pode estar inline no login). `metadata` resolvido: `String?`+`JSON.stringify` em schema (ambos), migration.sql (`TEXT`) e `audit.ts`.
