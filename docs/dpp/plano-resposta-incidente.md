# Plano de Resposta a Incidente (IR) — Atlas Seller

> Exigido pela Amazon DPP (controle #8): notificar a Amazon em **≤24h** de um
> incidente de segurança envolvendo dados protegidos. Documento + runbook.
> **Aprovar e definir o contato de segurança antes de submeter o app.**

## Papéis
- **Contato de segurança (líder de IR):** ⚠️ definir — nome + e-mail + telefone.
  (sugestão: o dono da operação, e-mail `admfsmundo@gmail.com`).
- **Suplente:** ⚠️ definir.

## Definição de incidente
Qualquer acesso, divulgação, alteração ou perda **não autorizada** de dados
protegidos (credenciais OAuth de seller, dados de pedido/PII, dados financeiros),
incluindo: vazamento cross-tenant, comprometimento de credencial, acesso indevido,
exfiltração, ou indisponibilidade por ataque.

## Fluxo (detecção → notificação)
1. **Detecção** — alertas (anomalia/log), relato de usuário, ou achado em revisão.
2. **Triagem (≤1h)** — confirmar se é incidente real e classificar severidade
   (afeta dados protegidos? quantos sellers? PII envolvida?).
3. **Contenção (imediata)** — isolar: revogar credenciais/sessões afetadas
   (`sessionVersion++`, desconectar AmazonAccount), bloquear IP/origem, desligar a
   função afetada. Preservar evidência (logs, snapshots).
4. **Erradicação** — corrigir a causa-raiz (patch, rotação de chave/segredo).
5. **Notificação (≤24h)** — notificar a **Amazon** pelo canal do Developer Console /
   contato DPP, e os **sellers afetados**. Registrar o quê, quando, quem, impacto e
   ações.
6. **Recuperação** — restaurar serviço a partir de backup íntegro; monitorar
   reincidência.
7. **Pós-morte (≤5 dias úteis)** — relatório de lições aprendidas + ações preventivas.

## Runbook técnico (comandos)
- **Revogar todas as sessões de um usuário:** incrementar `sessionVersion` (força
  re-login). 
- **Desconectar a conta Amazon de uma empresa:** `POST /api/amazon/oauth/desconectar`
  (zera tokens, status PENDENTE) — ou via banco na conta afetada.
- **Rotacionar a chave de cifragem (`CONFIG_ENCRYPTION_KEY`):** ver
  `docs/secrets-rotation.md` (re-cifrar segredos).
- **Rotacionar segredo OAuth do app:** gerar novo no Developer Console / Login with
  Amazon, atualizar `.env` (AMAZON_OAUTH_LWA_CLIENT_SECRET / AMAZON_ADS_OAUTH_*),
  `pm2 reload --update-env`.
- **Pausar o worker (conter sync):** `pm2 stop erp-worker`.
- **Snapshot de evidência:** dump do Postgres + cópia dos logs do período.

## Contatos e canais
- Amazon: canal de contato do Developer Console / e-mail DPP do app.
- Sellers afetados: e-mail/WhatsApp cadastrado.
- ⚠️ Provedor de hospedagem (suporte), em caso de incidente de infra.

## Teste do plano
⚠️ Rodar um **tabletop** (simulação) ao menos 1×/ano e após mudanças relevantes.

---
**Pendências antes de submeter:** preencher os ⚠️ (contato de segurança, suplente,
contato do provedor) e aprovar este documento.
