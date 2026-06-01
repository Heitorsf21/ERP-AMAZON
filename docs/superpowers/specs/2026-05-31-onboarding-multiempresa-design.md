# Design — Onboarding de empresa & Login multiempresa (Sub-projeto A+B)

> Data: 2026-05-31 · Branch: `feat/multitenant-fase0-seguranca`
> Pré-requisito já em produção: isolamento multi-tenant fail-closed (extensão Prisma + ALS + cookie-resolution), `TENANT_ISOLATION=enforce`, uniques compostos. Ver `C:\Users\heito\.claude\plans\voc-um-engenheiro-adaptive-scott.md` (revisão sênior) e a memória `project-multitenant`.

## Objetivo
Permitir que um **superadmin** crie uma nova **empresa** (tenant) e seu **admin inicial**, e que esse admin **faça login** numa base onde o mesmo e-mail pode existir em mais de uma empresa — operando isolado pela extensão Prisma já ativa.

A+B é a **fundação**. Uma empresa nova fica *plenamente* funcional apenas após o Sub-projeto C (credenciais/worker Amazon por conta) e a Fase 4 (configs por empresa — hoje alíquota de imposto, WhatsApp e fee defaults ainda são globais). Até lá, A+B entrega: empresa existe, admin loga, opera isolado nos módulos que não dependem de config global.

## Não-objetivos (v1)
- Self-service signup / billing.
- Impersonação de superadmin (fail-closed total; revisitar pós-v1 se houver necessidade real e auditada).
- UI de gestão de **outros superadmins** (1º e demais via CLI no v1).
- Subdomínio por empresa (`lojax.erp.mundofs.cloud`) — exige DNS curinga + cert; pós-v1.
- Credenciais Amazon por conta (Sub-projeto C).

---

## Seção 1 — Modelo de dados & migração de schema

O scaffold já existe: `Empresa` (com `slug @unique`, `ativa`), `AmazonAccount` (sem campos de credencial — intocado aqui), `PlataformaUsuario` (global: `email @unique`, `senhaHash`, `ativo`, `sessionVersion`). A+B faz **3 mudanças**.

### A. `Usuario` → login multiempresa (única migração que toca dados de prod)
- `email @unique` (global) → **`@@unique([empresaId, email])`**.
- `empresaId String?` → **`String` NOT NULL**, relação obrigatória. Justificativa: superadmin **não** usa `Usuario` (vive em `PlataformaUsuario`), logo todo `Usuario` pertence a uma empresa.
- Migração manual (sem shadow DB), aplicada com `prisma:migrate:deploy:pg`:
  1. `DROP INDEX "Usuario_email_key";`
  2. `ALTER TABLE "Usuario" ALTER COLUMN "empresaId" SET NOT NULL;`
  3. `CREATE UNIQUE INDEX "Usuario_empresaId_email_key" ON "Usuario"("empresaId","email");`
  - **Seguro**: backfill já concluído — os 2 usuários têm `empresaId='mundofs'`. `pg_dump -Fc` antes.
- Mantém `@@index([email])` (lookup de recuperação) e `@@index([empresaId])`.

### B. `ConviteUsuario` (NOVO) — token de convite do admin
Espelha `TokenRecuperacaoSenha`, com semântica de convite (TTL maior).
```prisma
model ConviteUsuario {
  id        String    @id @default(cuid())
  usuarioId String
  tokenHash String    @unique   // SHA-256 do token cru; o cru só viaja no link do e-mail
  expiresAt DateTime              // +7 dias
  usadoEm   DateTime?             // single-use
  createdAt DateTime  @default(now())

  usuario Usuario @relation(fields: [usuarioId], references: [id], onDelete: Cascade)

  @@index([usuarioId])
  @@index([expiresAt])
}
```
Adiciona `convites ConviteUsuario[]` em `Usuario`.

### C. `AuditPlataforma` (NOVO) — trilha de auditoria da camada plataforma
Ações do superadmin não cabem em `AuditLog` (cujo `usuarioId` referencia `Usuario`).
```prisma
model AuditPlataforma {
  id                  String   @id @default(cuid())
  plataformaUsuarioId String?
  acao                String   // EMPRESA_CRIADA | ADMIN_CONVIDADO | CONVITE_REENVIADO | EMPRESA_DESATIVADA | EMPRESA_REATIVADA | LOGIN_PLATAFORMA
  empresaIdAlvo       String?
  metadata            Json?
  ip                  String?
  createdAt           DateTime @default(now())

  @@index([plataformaUsuarioId])
  @@index([empresaIdAlvo])
  @@index([createdAt])
}
```
Sem FK para `PlataformaUsuario` (mantém o registro mesmo se o superadmin for removido). É um model **GLOBAL** (não entra na lista de TENANT_MODELS da extensão).

### Sem mudança
`Empresa`, `PlataformaUsuario` ficam como estão. `AmazonAccount` **não é tocado** (Sub-projeto C). Empresa nova nasce **sem** `AmazonAccount` → worker inerte pra ela (comportamento correto).

### Mecânica
Dois schemas em sincronia (`prisma/schema.prisma` SQLite + `prisma/schema.postgresql.prisma`), migration.sql manual, `prisma:generate:pg` obrigatório, `pg_dump` antes do deploy.

---

## Seção 2 — `criarEmpresa()` transacional & seed

Módulo novo `src/modules/plataforma/`, isolado do tenant. Service `empresas.ts` com `criarEmpresa(input)`.

**Input:** `{ nome, slug, admin: { nome, email } }`.

**Interação com o isolamento (ovo-galinha):** a extensão fail-closed exige contexto de tenant pra escrever em models tenant; preciso do `empresaId` antes de criar a `Empresa`. Solução: pré-gerar o cuid.
```ts
const empresaId = createId();
await runWithTenant({ empresaId, source: "system" }, () =>
  db.$transaction(async (tx) => {
    await tx.empresa.create({ data: { id: empresaId, nome, slug } }); // GLOBAL model
    await semearEmpresa(tx, empresaId);                                // catálogo (tenant → empresaId injetado)
    const admin = await tx.usuario.create({
      data: { email, nome, role: "ADMIN", senhaHash: hashAleatorio(), ativo: true },
    });
    const { rawToken, tokenHash } = gerarTokenConvite();
    await tx.conviteUsuario.create({ data: { usuarioId: admin.id, tokenHash, expiresAt } });
    return { empresaId, adminId: admin.id, rawToken };
  })
);
```
A extensão aplica-se ao `tx` dentro do `$transaction`; o `runWithTenant` envolvendo a chamada faz toda query ler o contexto. **Atômico**: falha em qualquer passo desfaz tudo.

**`semearEmpresa()` cria (opção b):**
- as **18 categorias padrão** (mesma lista do `seed.ts`);
- as **sentinelas "Contas Fixas"**: `Categoria` (DESPESA) + `Fornecedor` — exigidas pelo módulo contas-fixas.

(O admin e o convite ficam no `criarEmpresa`, fora do `semearEmpresa`, que é só catálogo.)

**Fonte única:** extrair `CATEGORIAS_PADRAO` + sentinelas para `src/modules/plataforma/seed-empresa.ts`, exportando `semearEmpresa(client, empresaId)` que recebe um client Prisma + empresaId explícitos. `prisma/seed.ts` (mundofs, client cru) **e** `criarEmpresa` (client estendido) consomem o mesmo módulo — nunca divergem.

**Admin:** nasce `ativo` com **senha aleatória** (satisfaz `senhaHash` NOT NULL, mas inutilizável); o admin **redefine** a senha real pelo link do convite. Nenhuma senha em texto puro por e-mail.

**Validação de slug:** `^[a-z0-9-]{3,30}$`, unicidade (`Empresa.slug @unique`), **blocklist** de reservados (`api`, `app`, `plataforma`, `admin`, `www`, `static`, `_next`, `login`, `dashboard-ecommerce`).

**Saída:** `criarEmpresa` devolve `rawToken` (consumido pelo passo de e-mail).

---

## Seção 3 — Convite, token & e-mail (definir senha)

- `gerarTokenConvite()`: 32 bytes aleatórios → token cru base64url; armazena **SHA-256** (`tokenHash`). TTL **7 dias**.
- **E-mail** (via `enviarEmail` de `src/lib/email.ts`; cai pro console se SMTP não configurado): link `${APP_URL}/definir-senha?token=<raw>`. Sem expor slug no token; a página resolve `usuarioId → empresaId` pelo token.
- **Página** `/definir-senha` (pública): form de nova senha + confirmação.
- **Endpoint** `POST /api/definir-senha` (público, `nodejs`, `force-dynamic`): body `{ token, novaSenha }`.
  - Origin-check (`originViolationResponse`) + throttle (padrão `LoginThrottle`, chave por IP).
  - Lookup por `tokenHash = sha256(token)`; valida não-expirado e não-usado.
  - Define `senhaHash` (bcrypt), marca `usadoEm = now()`, incrementa `Usuario.sessionVersion`.
  - Resposta **uniforme** em falha (`LINK_INVALIDO`) — não distingue inexistente/expirado/usado.
  - Sucesso → instrui redirecionar pra `/login?empresa=<slug>&email=<email>`.
- **Reenviar convite** (ação de plataforma): invalida o token anterior (marca `usadoEm` ou deleta) + gera novo + reenvia. Auditado.
- **Política de senha:** mínimo 8 caracteres (alinhar com a regra existente em recuperação/troca, se houver).

---

## Seção 4 — Login multiempresa (Opção A)

- **Form** `/login` ganha campo **"Empresa"** (slug). Pré-preenchido via query (`?empresa=<slug>`) vindo do convite/redirect.
- **`POST /api/auth/login`** passa a aceitar `{ empresa (slug), email, senha, lembrar }`:
  - Resolve `Empresa` por `slug` (findUnique). Se ausente **ou** `!ativa` → segue o fluxo (não retorna cedo).
  - Lookup `Usuario` por `@@unique([empresaId, email])` (`findUnique({ where: { empresaId_email: ... } })`) quando a empresa existe.
  - **Dummy bcrypt** (corrige o timing oracle atual): quando empresa/usuário não existem, executa `bcrypt.compare` contra um hash constante para uniformizar o tempo de resposta.
  - **Throttle** keyed por `${ip}:${slug}:${email}` (hoje é `ip+email`).
  - Erro **uniforme** `CREDENCIAIS_INVALIDAS` (não revela se o slug existe nem se está inativo).
  - Sessão carimba `empresaId` (campo já existe em `SessionPayload`; cookie `erp_session`).
  - **2FA**: challenge segue por `usuarioId`; a sessão emitida após o 2FA carrega `empresaId`.
- **Recuperação de senha** vira tenant-aware: o form de "esqueci a senha" pede slug + e-mail; lookup por composta; token escopado a `usuarioId` (já é). Resposta uniforme.

---

## Seção 5 — Plataforma (`/plataforma`) & auth do superadmin

- **Sessão separada:** módulo `src/lib/plataforma-session.ts` reusando as primitivas HMAC de `session.ts` (refatorar `session.ts` para exportar `signWithSecret`/`verifyWithSecret` genéricos, ou duplicar mínimo). Cookie **`erp_plat_session`** (distinto de `erp_session`), payload `PlataformaSessionPayload { puid, email, nome, exp, v }`, validado contra `PlataformaUsuario.ativo` + `sessionVersion`.
- **Guard** `requireSuperAdmin()` em todo `/api/plataforma/*`: exige `erp_plat_session` válido; rejeita cookie de tenant. **Nunca** popula contexto de tenant.
- **Rotas:**
  - Página `/plataforma/login` + `POST /api/plataforma/login` (origin-check + throttle + dummy bcrypt + erro uniforme, igual ao login de tenant).
  - Página `/plataforma` (dashboard): lista de empresas + status (ativa, qtd usuários, tem AmazonAccount).
  - Página `/plataforma/empresas/nova` (wizard) + `POST /api/plataforma/empresas` → `criarEmpresa()` + envia convite.
  - `POST /api/plataforma/empresas/[id]/desativar` | `/reativar` (`Empresa.ativa`).
  - `POST /api/plataforma/empresas/[id]/reenviar-convite`.
- **Middleware:** protege `/plataforma/*` (redireciona a `/plataforma/login` sem sessão de plataforma). Garante que `/plataforma` e `/api/plataforma` **não** sejam alcançáveis com cookie de tenant.
- **Fronteira fail-closed:** superadmin não recebe contexto tenant. Onde a plataforma precisa tocar dados de tenant (seed do `criarEmpresa`), usa `runWithTenant({ empresaId })` mirando **explicitamente** a empresa-alvo. Query a model tenant sem alvo explícito → extensão fail-closes (correto).
- **Bootstrap:** `scripts/criar-superadmin.ts` (CLI) cria o 1º `PlataformaUsuario`. Demais superadmins via CLI no v1.
- **Branding/UI:** layout próprio mínimo (não reusa a sidebar do ERP), reaproveitando componentes `ui/*`. Protótipo HTML antes de polir (preferência do usuário).

---

## Seção 6 — Segurança (consolidação dos 🔧)

| Item | Defesa |
|---|---|
| Enumeração por timing no login | Dummy bcrypt sempre + erro uniforme `CREDENCIAIS_INVALIDAS` (tenant **e** plataforma) |
| Enumeração de slugs | Empresa inexistente/inativa → mesmo erro uniforme; nunca "empresa inválida" |
| Brute-force | Throttle persistente (`LoginThrottle`) por `ip:slug:email` (login) e por IP (definir-senha/recuperação) |
| Sessões cruzadas plataforma↔tenant | Cookies distintos (`erp_plat_session` vs `erp_session`), payloads distintos, `requireSuperAdmin` rejeita cookie de tenant e vice-versa |
| Token de convite vazado/replay | 32 bytes, **SHA-256 em repouso**, single-use (`usadoEm`), expira 7d, resposta uniforme |
| CSRF | `originViolationResponse` em **todas** as mutações de auth/plataforma/definir-senha (`CSRF_ENFORCE_ORIGIN`) |
| Superadmin vê dados de empresa | Fail-closed total; metadados apenas; **sem impersonação** no v1 |
| Colisão de rota por slug | Blocklist + regex de formato |
| Senha fraca | Política mínima na definição/troca |
| Falta de trilha | `AuditPlataforma` em toda ação de plataforma (criar/desativar/reativar empresa, convite, login) |

Todos validáveis no pentest de staging (Fase 6): IDOR, auth bypass, CSRF, enumeração, replay de token, reset, 2FA.

---

## Seção 7 — Testes & verificação

**Unit (vitest):**
- `gerarTokenConvite` / verificação por hash; expiração e single-use.
- Validação + blocklist de slug.
- `semearEmpresa`: cria 18 categorias + 2 sentinelas; idempotência sob re-execução.

**Integração (SQLite de teste + `runWithTenant`, padrão de `scripts/test-isolamento-2-empresas.ts`):**
- `criarEmpresa` cria, **atomicamente**, empresa + 18 categorias + 2 sentinelas + admin (ADMIN, ativo) + 1 convite; rollback total em falha.
- Login multiempresa: mesmo e-mail em 2 empresas resolve pela slug; slug errada → erro uniforme; dummy bcrypt mantém tempo uniforme.
- Definir-senha: token válido define senha + marca usado + bump sessionVersion; token usado/expirado → uniforme.

**Isolamento (estende o script existente):**
- Admin da empresa nova enxerga só os dados dela (produtos, contas, vendas, notificações).

**Auth de plataforma:**
- `requireSuperAdmin` rejeita `erp_session`; `/api/plataforma/*` inacessível com cookie de tenant.
- Superadmin consultando model tenant sem alvo explícito → fail-closed.

**Verificação (só no que mudou):** `npx tsc --noEmit` · `npx eslint <arquivos>` · `npx vitest run --no-file-parallelism <testes>` (com `DATABASE_URL` apontando pro SQLite de teste). `npm run build` só antes do deploy.

---

## Sequência de deploy (resumo)
1. `pg_dump -Fc` (VPS + offsite).
2. Migration manual (Usuario unique composto + `ConviteUsuario` + `AuditPlataforma`) via `prisma:migrate:deploy:pg`.
3. `prisma:generate:pg` (obrigatório) → build → reload `erp-web`/`erp-worker`/`erp-sqs-consumer` (3 chamadas separadas).
4. CLI `criar-superadmin.ts` cria o 1º superadmin.
5. Validar: login de plataforma, criar empresa de teste, fluxo de convite → definir senha → login multiempresa, isolamento.

## Dependências para frente
- **Sub-projeto C:** credenciais Amazon por `AmazonAccount` + worker per-account (cursores/quota por conta).
- **Fase 4:** split de `ConfiguracaoSistema` (global / por empresa / por conta) — sem isso uma 2ª empresa compartilharia configs globais.
- **Fase 6:** staging + pentest + compliance SP-API DPP (app público multi-seller) antes de onboarding externo real.
