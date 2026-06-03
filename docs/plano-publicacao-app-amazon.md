# Plano de Publicação do App SP-API (OAuth público + DPP)

> **Objetivo:** sair de **app DRAFT** (só self-authorization, 10 contas) para **app PUBLICADO** (OAuth público — o botão "Conectar" funciona para qualquer seller, ilimitado), passando pela **revisão de segurança da Amazon (Data Protection Policy / DPP)**.
> **Companion de:** `SECURITY-AUDIT-2026-06.md` (fonte dos controles), `docs/roadmap-oauth-amazon.md`, `docs/handoff-pentest-deploy.md`.
> **Data:** 2026-06-03. **Branch de trabalho:** `fix/oauth-tenant-hardening` (em cima de produção).

---

## 0. Por que o app não publica hoje
Provado pelos prints do Developer Console: **"Autorizações: Não é permitida autorização"** (OAuth público desligado) + sem campo de Redirect URI. Isso só abre depois de **publicar** o app, e publicar exige **aprovação na DPP**. Logo este plano = fechar as lacunas da DPP + submeter.

## 1. Onde já estamos (FATOS verificados no código deployado)
- ✅ **F01/F06 isolamento**: `TENANT_ISOLATION=enforce` LIGADO em produção + `startup-checks.ts` (boot guard aborta se houver >1 empresa sem enforce; valida `CONFIG_ENCRYPTION_KEY` hex 32B).
- ✅ **F02/F03 credenciais por seller**: `AmazonAccount` com `refreshTokenEnc`/`adsRefreshTokenEnc` cifrados (AES-256-GCM); worker itera contas ATIVA por tenant; fallback global **gateado** só p/ a empresa primária; cursores/estado de backfill escopados por empresa (sem vazamento cross-tenant).
- ✅ **F05 senha forte**: `definir-senha` usa `strongPasswordSchema` (≥12 + complexidade).
- ✅ **F07–F13 (ondas 1–5)**: IDOR de documentos financeiros, SSRF (WAHA + endpoints), logging de segredos, defaults inseguros — corrigidos (ver handoff).
- ✅ **Minimização de PII** (F48): modelos de venda/pedido **não** persistem nome/endereço/telefone do comprador.
- ✅ **Cifragem de segredos** (F49): OAuth/API keys cifrados + redaction em auditoria.

## 2. Lacunas que faltam para a DPP (o trabalho deste plano)

### Trilho A — CÓDIGO (eu implemento, vai por deploy)
| # | Item | Controle DPP | Origem |
|---|---|---|---|
| A1 | **Purga de PII ≤30d** pós-entrega — job `PII_RETENTION_PURGE` + config | #12 Retenção/deleção | F14 |
| A2 | **Trilha de auditoria de ACESSO/leitura a PII** (quem leu o quê) | #7 Logging | F16 |
| A3 | **`AmazonOrderRaw.payloadJson`**: minimizar (stripar PII de comprador) ou cifrar a coluna | #1 Cripto em repouso | F15/F43 |
| A4 | **`instrumentation.ts`**: rodar `startup-checks` também no processo **web** (hoje só worker) | #4 Acesso/config | F04 |
| A5 | **MFA TOTP** para operadores (2FA atual é por e-mail, não aprovado pela Amazon) | #5 MFA | scorecard #5 |
| A6 | (opcional) **CSP sem `unsafe-inline`** (nonce/hash) | hardening | F21 |

### Trilho B — DOCUMENTAÇÃO (eu escrevo; você revisa/submete)
| # | Item | Para quê |
|---|---|---|
| B1 | **Política de Privacidade** pública (`/privacidade`) | URL obrigatória na submissão |
| B2 | **Rascunho do questionário de segurança DPP** (respostas) | você cola/ajusta no formulário Amazon |
| B3 | **Plano de Resposta a Incidente + runbook** (notificar Amazon ≤24h) | controle #8 |
| B4 | **Checklist de submissão** (passos exatos no Developer Console) | guiar o publish |
| B5 | **Política de retenção/uso de dados** (data handling) | anexo do questionário |

### Trilho C — INFRA / ORG (você é dono; eu oriento/escrevo o que for config)
| # | Item | Controle DPP |
|---|---|---|
| C1 | **KMS + rotação anual** da chave de cifragem | #3 |
| C2 | **Retenção de logs ≥12 meses + coleta central + alerta de anomalia** | #7 |
| C3 | **Firewall + IDS/IPS + segmentação** no VPS (documentar) | #6 |
| C4 | **TLS 1.2/1.3** confirmado no Nginx + `sslmode=require` no Postgres | #2 |
| C5 | **MFA forte** habilitado nas contas dos operadores | #5 |
| C6 | **Cadência de scan (30d) + pentest anual** documentada | #9 |
| C7 | **Backups cifrados + teste de restore** | #1/#12 |

### Trilho D — SUBMISSÃO NA AMAZON (você executa; eu guio passo a passo)
1. Developer Console → app **Atlas Seller** → editar para **publicação** (aparece o bloco OAuth: Login URI + Redirect URI).
2. Preencher metadados + **URL da política de privacidade** (`https://erp.mundofs.cloud/privacidade`).
3. Cadastrar **OAuth Redirect URI** `https://erp.mundofs.cloud/api/amazon/oauth/callback` e **Login URI** `https://erp.mundofs.cloud/amazon`.
4. Responder o **questionário DPP** (usando o rascunho B2).
5. Escolher **unlisted** (até 25 sellers, sem vitrine) ou **listed/Appstore** (ilimitado). Recomendo **unlisted** primeiro.
6. **Submeter** e acompanhar; responder pendências da Amazon.

---

## 3. Sequência recomendada
```
(eu) A4 instrumentation + A1 purga + A2 audit PII + A3 payload  ─┐ deploy
(eu) B1 privacidade (deploy) + B2 questionário + B3 IR + B4 checklist ─┤
                                                                      v
(você) C1..C7 infra/org (em paralelo)  ───────────────────────────────┤
(você) A5 MFA: habilitar nos operadores (eu implemento o TOTP)          │
                                                                      v
        revisar pacote (questionário + privacidade + IR)  ──> SUBMETER (D)
                                                                      v
        responder pendências da Amazon  ──> app publicado ──> OAuth público
```

## 4. Critério de "pronto para submeter"
- [ ] A1–A4 implementados e deployados (A5 MFA e A6 CSP recomendados, não bloqueiam tanto).
- [ ] `/privacidade` no ar (B1).
- [ ] Questionário DPP (B2) revisado por você.
- [ ] Plano de IR (B3) aprovado; contato de segurança definido.
- [ ] Infra C1–C7 provisionada/documentada (a Amazon cobra evidência organizacional, não só código).
- [ ] OAuth Redirect/Login URIs cadastrados no Console.

## 5. O que NÃO consigo fazer por você (limites)
- Submeter/aprovar o app (é sua conta Amazon) — eu preparo tudo e te guio o clique.
- Provisionar/pagar infra (KMS, agregador de log, IDS/IPS) — eu escrevo config/runbook.
- Ser o contato de segurança / assinar atestados — é você.

## 6. Expectativa de prazo
- Código (A1–A4): ~1–2 ciclos de deploy.
- Docs (B1–B4): junto com o código.
- Infra (C): depende de você contratar/configurar.
- Revisão Amazon (D): tipicamente **dias a algumas semanas**, com idas e vindas. Por isso submeter cedo **com o pacote completo** (submeter incompleto tende a reprovar e atrasar).
