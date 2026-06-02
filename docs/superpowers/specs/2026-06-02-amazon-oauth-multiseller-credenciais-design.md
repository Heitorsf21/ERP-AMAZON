# Design — Credenciais OAuth Amazon por seller (multi-tenant)

**Data:** 2026-06-02 · **Origem:** achado CRITICAL **F02** do `SECURITY-AUDIT-2026-06.md`
**Objetivo de negócio:** habilitar o modelo SaaS multi-seller — cada cliente conecta a própria conta Amazon via consentimento OAuth — pré-requisito para a autorização da Amazon SP-API com acesso a dados de terceiros.

## Problema

Hoje as credenciais Amazon (`amazon_client_id`, `amazon_client_secret`, `amazon_refresh_token`, `amazon_marketplace_id`, `amazon_endpoint`) vivem em `ConfiguracaoSistema` por **chave global** (uma linha para a plataforma inteira), com fallback de env. `getAmazonConfig()` (em `src/modules/amazon/service.ts`) lê essas chaves globais; o worker usa essa config única. Consequências:

- Não há onde guardar/escopar o `refresh_token` de cada seller → o caso de uso multi-seller **não existe** arquiteturalmente.
- Um 2º seller sobrescreveria o token do 1º (mesma chave global).
- A Amazon DPP exige armazenamento **cifrado e isolado** de credenciais OAuth por seller; token global compartilhado = reprovação.

O modelo `AmazonAccount` já existe (`empresaId`, `nome`, `marketplaceId`, `sellerId`, `endpoint`, `ativa`, `status` PENDENTE/ATIVA/ERRO) **mas sem campos de credencial**.

## Decisões (confirmadas com o dono)

1. **Abordagem A** — `client_id`/`client_secret` permanecem **app-level** (um par, do app no Developer Console; segue em `ConfiguracaoSistema` cifrado/env). O `refresh_token` é **per-seller**, cifrado, no `AmazonAccount`. Um resolver mescla os dois.
2. **Cardinalidade 1:1** — uma conta Amazon por empresa. O resolver assume conta única por `empresaId`. (Schema permanece 1:N fisicamente — `AmazonAccount.empresaId` não-unique — mas a lógica trata como única; evolui para 1:N sem migração destrutiva se necessário.)
3. **Escopo: spec completa** — schema + fluxo OAuth web + resolver + worker + migração.

## Arquitetura

Distinção que guia o design: **app credential** (client_id/secret, identidade do app, compartilhada) vs **seller grant** (refresh_token, autorização de cada seller).

```
[Seller] --clica "Conectar Amazon"--> GET /api/amazon/oauth/iniciar
   -> monta authorization URL (Seller Central) com state assinado (empresaId+nonce)
   -> 302 para a Amazon (consentimento LWA)
[Amazon] --redireciona--> GET /api/amazon/oauth/callback?spapi_oauth_code=...&state=...&selling_partner_id=...
   -> valida state (HMAC + nonce, anti-CSRF) e empresaId da sessão
   -> troca spapi_oauth_code por refresh_token (LWA token endpoint, grant_type=authorization_code)
   -> cifra refresh_token (crypto.ts) -> grava em AmazonAccount{empresaId} -> status=ATIVA, sellerId=selling_partner_id
[Worker] itera AmazonAccount ativa+ATIVA -> runWithTenant({empresaId}) -> resolverCredenciaisDaConta -> SP-API
```

## Componentes

### 1. Schema (`AmazonAccount`)
Novos campos (todos opcionais, retrocompatíveis):
- `refreshTokenEnc String?` — refresh_token cifrado (formato `enc:v1:` do `crypto.ts`).
- `accessTokenEnc String?` — cache do access token cifrado (opcional; pode ficar só em memória).
- `tokenExpiresAt DateTime?` — expiração do access token cacheado.
- `lwaScopes String?` — escopos concedidos (auditoria).
- `conectadoEm DateTime?` — quando o seller autorizou (telemetria/retention).

Migration **manual** Postgres (`prisma/migrations/<ts>_amazon_account_oauth/migration.sql` + `prisma:migrate:deploy:pg`), pois `erp_amazon` não tem shadow DB. Espelhar no `schema.prisma` (SQLite) e `schema.postgresql.prisma`.

### 2. Módulo OAuth (`src/modules/amazon/oauth.ts`) — puro + testável
- `montarAuthorizationUrl({ applicationId, state, redirectUri, marketplaceRegion, beta })` → string (pura).
- `assinarState(empresaId, nonce)` / `verificarState(token)` → reusa HMAC de `session.ts` (ou cria helper análogo); state expira em ~10min. **Puro, TDD.**
- `trocarCodePorRefreshToken(code, { clientId, clientSecret, redirectUri })` → chama LWA `https://api.amazon.com/auth/o2/token` (grant_type=authorization_code). Valida resposta. (I/O isolado.)

### 3. Rotas (Next App Router, `requireRole(ADMIN)` exceto onde notado)
- `GET /api/amazon/oauth/iniciar` — `requireSession` + empresa da sessão; gera state, 302 para a Amazon.
- `GET /api/amazon/oauth/callback` — **requer sessão** (o retorno da Amazon é uma navegação top-level do browser, que envia o cookie de sessão sob `sameSite=lax`); NÃO entra em PUBLIC_PATHS. Valida `state` assinado (empresaId+nonce, single-use) e exige `state.empresaId === session.empresaId`; troca code→token; grava cifrado.
- `POST /api/amazon/oauth/desconectar` — zera `refreshTokenEnc`, `status=PENDENTE`.

### 4. Resolução de credenciais (`service.ts`)
- `resolverCredenciaisDaConta(empresaId)`: lê `AmazonAccount` da empresa + app-creds globais (client_id/secret) → objeto `SPAPICredentials`. Decifra `refreshTokenEnc`. Lança claro se conta PENDENTE/sem token.
- `getAmazonConfig()` legado → **wrapper de compat**: em single-tenant resolve a conta única (ou mantém o caminho global como fallback durante a transição). Não quebra call sites atuais.

### 5. Worker (`src/modules/amazon/worker.ts`)
- Substitui o uso da config global única por: `for (const conta of contasAtivas())` → `runWithTenant({ empresaId: conta.empresaId }, () => processar(conta))`.
- `contasAtivas()` = `AmazonAccount` `ativa && status === "ATIVA" && refreshTokenEnc != null`.
- Hoje: 1 conta (`mundofs`). Pós-migração: N contas iteradas em sequência (respeitando rate-limit por conta).

### 6. Migração (`scripts/migrar-credenciais-amazon-para-conta.ts`)
Idempotente, `--dry-run` por padrão:
- Lê `amazon_refresh_token` global (decifrado). Se houver, faz upsert de um `AmazonAccount{empresaId: mundofs}` com `refreshTokenEnc` (recifrado), `marketplaceId`, `endpoint`, `sellerId`, `status=ATIVA`.
- NÃO apaga a config global no primeiro passo (fallback). Remoção em passo separado após confirmar o worker rodando por conta.

## Segurança & mapeamento DPP
- **#1/#3 (cripto em repouso de credencial):** `refresh_token` sempre cifrado AES-256-GCM (`crypto.ts`); nunca em texto puro; nunca logado.
- **Isolamento (★):** **Decisão** — `AmazonAccount` permanece em `GLOBAL_MODELS` (é acessado em fluxos pré-contexto/plataforma), e TODO acesso por empresa filtra `empresaId` **explicitamente** no resolver e nas rotas (padrão já usado em docs financeiros, Onda 3). Não auto-filtrar pela extensão evita fail-closed nesses fluxos; a checagem explícita garante o isolamento independente da flag.
- **CSRF no callback:** `state` assinado (HMAC) + nonce single-use + binding ao empresaId da sessão.
- **Least privilege:** rota de conexão/desconexão = ADMIN.

## Tratamento de erros
- `state` inválido/expirado → 400 sem detalhe.
- Troca de code falha (LWA 4xx) → `status=ERRO`, mensagem genérica ao usuário, detalhe no log (sem token).
- Worker com conta ERRO/sem token → pula a conta, registra `AmazonSyncLog`, segue as demais.

## Estratégia de testes (TDD)
- **Puro:** `montarAuthorizationUrl`, `assinarState`/`verificarState` (válido, expirado, adulterado), parser da resposta LWA.
- **Resolver:** mescla app-cred + conta; erro quando PENDENTE/sem token.
- **Worker:** itera só contas ATIVA com token; isola por empresa (mock do `runWithTenant`).
- I/O da troca de token: testar via injeção de `fetch`/cliente.

## Rollout (GATED)
1. Migration de schema (deploy:pg) — aditiva, segura.
2. Script de migração `--dry-run` → revisar → `--apply` (cria AmazonAccount mundofs).
3. Worker por conta com fallback global ainda ativo.
4. Validar 1 ciclo do worker por conta em staging.
5. Ligar `TENANT_ISOLATION=enforce` (pré-requisito **F01**, backup+staging antes — já GATED).
6. Habilitar o fluxo OAuth web para o 2º seller (piloto).
7. Remover a config global de refresh_token (cutover final).

## Fora de escopo (YAGNI)
- Múltiplas contas por empresa (1:N de fato) — schema já permite evoluir.
- Múltiplos marketplaces simultâneos por conta.
- Refresh proativo de token em background (basta refresh sob demanda quando o access token expira).
- Modelo `AmazonOAuthApp` separado (Abordagem C).

## Pré-requisitos externos (não-código)
- App registrado no **Developer Console** (Seller Central) com o `redirect_uri` de produção (`https://erp.mundofs.cloud/api/amazon/oauth/callback`).
- A revisão de segurança da Amazon (DPP) — objetivo macro do audit — precisa dos demais controles (infra/org) das Fases 4 do relatório.
