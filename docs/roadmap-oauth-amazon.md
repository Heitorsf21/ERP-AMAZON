# Roadmap OAuth Amazon — o que falta, o que fazer, como fazer

> **Propósito:** documento de continuidade para retomar a habilitação do OAuth multi-seller da Amazon em outro computador. Companion de `SECURITY-AUDIT-2026-06.md`, `docs/handoff-pentest-deploy.md`, e da spec/plano da F02.
> **Regra deste doc:** separa FATOS verificados do que NÃO se sabe. Nada aqui é presumido — o que não foi confirmado está na seção 2.
> **Data:** 2026-06-02.

---

## 1. Onde estamos — FATOS verificados

**Git (verificado via `git log`):**
- Branch: `feat/multitenant-fase0-seguranca`.
- `0a47250` — segurança ondas 1–3 + `SECURITY-AUDIT-2026-06.md` (no origin).
- `41f83fb` — segurança ondas 4–5 + **spec e plano da F02** (no origin).
- `15db565` — atualização do handoff (no origin).
- `5d0a5b5` — "feat(publicidade): melhorias de UX e insights na aba de Ads" (local, ainda fora do origin — trabalho do dono, não revisado por mim).

**Segurança (corrigido, com testes verdes — verificado):**
- F01/F04 boot guard (`src/lib/startup-checks.ts` + `instrumentation.ts` + worker); F05 senha de convite forte; F11 sem log de segredo no email; F12/F13 SSRF (`src/lib/ssrf-guard.ts`); F07/F08/F09 IDOR docs financeiros (`src/lib/file-serving.ts` + route); F10 invariante de query raw documentado; hardening (CRON constant-time, máscara de segredo, entropia, `poweredByHeader`, health sem leak).

**F02 (credenciais OAuth por-seller) — verificado:**
- Spec: `docs/superpowers/specs/2026-06-02-amazon-oauth-multiseller-credenciais-design.md`.
- Plano (11 tarefas, TDD, código pronto): `docs/superpowers/plans/2026-06-02-amazon-oauth-multiseller-credenciais.md`.
- **Implementação = 0%.** Confirmado: `prisma/schema*.prisma` NÃO tem `refreshTokenEnc`; a pasta `src/app/api/amazon/oauth/` NÃO existe.

**Amazon (verificado na doc oficial — fontes no fim):**
- App **draft/privado** = self-authorization, **limite 10 contas**, **sem** revisão de segurança.
- App **publicado não-listado** = até 25 OAuth; **listado** (Appstore) = ilimitado — ambos exigem revisão DPP.

---

## 2. O que eu NÃO sei (precisa SUA confirmação — não presumido)

> Estes pontos NÃO foram verificados por mim. Confirme antes de tomar decisões baseadas neles.

1. **App registrado no Developer Console?** Não sei se existe `application_id`/`redirect_uri` configurados.
2. **`TENANT_ISOLATION` em PRODUÇÃO.** Só sei o default do código (`off`). Não li o `.env` do servidor — não sei se já está `enforce`.
3. **Quantas empresas/sellers no banco de prod hoje.** O design assume single-tenant (`mundofs`); não contei no banco real.
4. **Estado da infra no VPS** (KMS, IDS/IPS, retenção/centralização de log, MFA dos operadores, backups). Não inspecionei o servidor.
5. **Suíte completa de testes com `DATABASE_URL` real.** Localmente, testes que tocam Prisma falharam por falta de `DATABASE_URL` (ambiental). O `docs/handoff-pentest-deploy.md` afirma que typecheck/lint/build passaram em `0a47250` com env dummy; **eu não revalidei o `build` após as ondas 4–5**.
6. **O que `5d0a5b5` (e outros commits seus recentes) mudaram** além de Ads. Não revisei.
7. **Natureza da credencial atual na sua conta Amazon** (private/self-auth vs outra). O código sugere private app; não confirmei na conta.

---

## 3. O que falta — 3 trilhos paralelos

### Trilho A — Código da F02 (eu implemento)
- **Status:** 0%. Plano detalhado pronto. Não depende da Amazon para a maior parte.
- **Blocos** (detalhe completo no arquivo do plano):
  - Bloco 1 (T1): schema — colunas cifradas em `AmazonAccount` + migration. **Aditivo, não quebra.**
  - Bloco 2 (T2–T4): núcleo OAuth puro (state anti-CSRF, authorization URL, troca code→token). **Testável sem a Amazon.**
  - Bloco 3 (T5–T9): resolver de credenciais, rotas `iniciar`/`callback`/`desconectar`, worker por tenant.
  - Bloco 4 (T10–T11): script de migração (token global → `AmazonAccount`) + docs de env.
- **Risco ao sistema atual:** baixo. Tudo aditivo, exceto a T9 (worker), que mantém fallback à config global até a migração rodar. Cutover é o último passo, gated.

### Trilho B — Infra / DPP (você é dono; eu ajudo no que é código/doc)
| Controle DPP | Eu faço/escrevo | Você é dono (conta/grana/operação) |
|---|---|---|
| KMS / rotação de chave | uso no código + doc de rotação | provisionar, pagar, rotacionar |
| Logs 12 meses + central + alerta | rotation/formato/script | contratar/pagar/operar |
| IDS/IPS + firewall + TLS | regras nginx/firewall/TLS | aplicar no VPS, manter |
| Plano de resposta a incidente | **escrevo o documento + runbook** | aprovar, ser contato, executar |
| Scan vuln (30d) + pentest anual | `npm audit`/scan no CI (este audit = pentest inicial) | agendar/contratar recorrência |
| Cripto PII at-rest + purga ≤30d + audit de acesso (MEDIUM do relatório) | **implemento em código** | revisar/aprovar |
| MFA dos operadores | oriento config | habilitar nas contas |
| Questionário de segurança Amazon | **rascunho as respostas** | revisar e submeter |

### Trilho C — Registro + gating + cutover (você dirige; eu apoio)
1. Registrar app **draft** no Developer Console → pegar `application_id`, setar `redirect_uri` (`https://erp.mundofs.cloud/api/amazon/oauth/callback`).
2. Validar `TENANT_ISOLATION=enforce` em **staging** (backup antes — GATED).
3. Submeter revisão DPP / publicar **só** quando A+B prontos (submeter cedo tende a reprovar).

---

## 4. Como fazer (passo a passo)

**Trilho A — executar o plano F02:**
- Branch nova: `feat/amazon-oauth-multiseller`.
- Executar via `superpowers:subagent-driven-development` ou `superpowers:executing-plans`, TDD tarefa a tarefa, na ordem T1 → T2/T3/T4 → T5 → T6/T7/T8 → T9 → T10 → T11.
- Pré-requisito p/ testar end-to-end (T6–T8): `AMAZON_APP_ID` (do registro draft, Trilho C).
- Validar em dev/staging antes de qualquer deploy. Não fazer cutover (remover config global / enforce) sem backup.

**Trilho B — DPP/infra:**
- Eu posso já: rascunhar o plano de IR, as respostas do questionário, e implementar os MEDIUM de código (purga de PII, audit de acesso a PII, cripto de PII at-rest). Peça e eu abro como tarefas.
- Você: decidir provedor de KMS e serviço de log, custo, e operar.

**Trilho C — registro:**
- Draft primeiro (≤10 self-auth, sem revisão) para testar o fluxo. Revisão só ao escalar.

---

## 5. Ordem recomendada / dependências

```
(você) registrar draft app ─────────────┐
                                          v
A: T1 → T2/T3/T4 → T5 → T6/T7/T8 (e2e precisa AMAZON_APP_ID) → T9 → T10 → T11
                                          │
B: MEDIUM de código + docs IR/questionário (em paralelo, eu)
infra paga/operada (você, em paralelo)
                                          v
        validar enforce em staging (backup) ──> piloto ≤10 sellers
                                          v
        submeter revisão DPP / publicar ──> multi-seller ilimitado
```

---

## 6. Decisões pendentes (suas)
- Começo o Trilho A (código F02) agora? (recomendo sim — destrava e não quebra o atual)
- Registra o app draft já? (recomendo sim — barato, sem revisão, testa o fluxo)
- Quer que eu rascunhe o pacote DPP (plano IR + questionário) e os MEDIUM de código em paralelo?
- Quando agendar o teste de `enforce` em staging?

---

## 7. Para retomar no outro computador
```bash
git pull --ff-only            # puxar este doc + spec + plano
# ler, nesta ordem:
#   docs/roadmap-oauth-amazon.md   (este)
#   SECURITY-AUDIT-2026-06.md
#   docs/superpowers/specs/2026-06-02-amazon-oauth-multiseller-credenciais-design.md
#   docs/superpowers/plans/2026-06-02-amazon-oauth-multiseller-credenciais.md
npm ci && npm run typecheck && npm run lint    # sanity
```
Depois, **confirmar os itens da seção 2** (especialmente `TENANT_ISOLATION` em prod, nº de empresas, e se o app foi registrado) antes de qualquer cutover.

## Critério de "pronto para OAuth multi-seller"
- [ ] Trilho A (código F02) implementado e testado.
- [ ] App registrado (draft → publicado quando escalar).
- [ ] `TENANT_ISOLATION=enforce` validado em staging com backup.
- [ ] MEDIUM de PII (cripto at-rest, purga ≤30d, audit de acesso) feitos.
- [ ] Infra/DPP da Fase 4 provisionada e operando.
- [ ] Questionário de segurança submetido e aprovado pela Amazon.

---

**Fontes Amazon (verificadas):**
- Authorization Limits — https://developer-docs.amazon.com/sp-api/docs/application-authorization-limits
- Self-authorize a private app — https://developer-docs.amazon.com/sp-api/docs/self-authorization
- Security & Compliance Overview — https://developer-docs.amazon.com/sp-api/docs/security-compliance-overview
- Key Security Control Guidance — https://developer-docs.amazon.com/sp-api/docs/guidance-to-address-key-security-controls-in-sp-api-integration
