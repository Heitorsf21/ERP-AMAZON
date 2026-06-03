# Rascunho — Questionário de Segurança Amazon SP-API (DPP)

> **Como usar:** respostas-base para o questionário de segurança da Amazon (Data
> Protection Policy). Revise cada item, ajuste ao que estiver de fato provisionado
> na infra (Trilho C) e **não afirme controle que ainda não existe**. Itens marcados
> ⚠️ dependem de você concluir (infra/org) antes de submeter.
> Fonte técnica: `SECURITY-AUDIT-2026-06.md` (scorecard dos 12 controles).

## Visão geral do tratamento de dados
- **Quais dados PII da Amazon o app armazena?** Minimização forte: os modelos de
  venda/pedido **não persistem** nome/endereço/telefone do comprador. Dados brutos
  de pedido (quando recebidos) são minimizados/cifrados e **purgados em ≤30 dias**.
- **Finalidade:** operar o ERP para o próprio seller (vendas, finanças, estoque, ads).
- **Compartilhamento:** nenhum entre sellers; sub-processadores: Amazon, hospedagem,
  serviço de IA para extração de documentos enviados pelo usuário.

## 1. Criptografia em repouso
Credenciais OAuth (SP-API e Ads) e segredos são cifrados com **AES-256-GCM** (auth
tag) antes de persistir; chave-mestra fora do banco (`CONFIG_ENCRYPTION_KEY`, hex
32 bytes, validada no boot). Payload bruto de pedido é minimizado/cifrado e purgado
≤30d. ⚠️ Cifragem de disco/volume e backups cifrados no nível de infra: **confirmar
no provedor** (Trilho C7).

## 2. Criptografia em trânsito
TLS 1.2/1.3 via Nginx + Let's Encrypt no domínio `erp.mundofs.cloud`. ⚠️ Confirmar
`ssl_protocols TLSv1.2 TLSv1.3` e `sslmode=require` na conexão com o Postgres (C4).

## 3. Gestão de chaves / rotação
Chave de cifragem em variável de ambiente, separada do banco. ⚠️ Provisionar **KMS**
(ou cofre de segredos) + **rotação anual** documentada (C1).

## 4. Controle de acesso (least privilege)
- **Isolamento multi-tenant fail-closed** (`TENANT_ISOLATION=enforce`, ATIVO em prod)
  via extensão Prisma + AsyncLocalStorage + cookie assinado; boot guard aborta o
  processo se houver >1 empresa sem enforce.
- **RBAC** por papel e por path (ADMIN/FINANCEIRO/OPERADOR/LEITURA).
- Credenciais de seller **isoladas por empresa** e cifradas; o worker resolve por
  tenant e **não** faz fallback de credencial entre tenants.

## 5. Autenticação forte (MFA)
Sessão HMAC com revogação por `sessionVersion`; política de senha forte (≥12 +
complexidade) em todos os fluxos de definição de senha; rate-limit/lockout no login.
**MFA TOTP (RFC 6238) implementado** — operadores ativam em `/perfil` → Segurança
→ "App autenticador" (QR; segredo cifrado AES-256; código exigido no login). 2FA por
e-mail também disponível. ⚠️ Ação: habilitar TOTP nas contas dos operadores (C5).

## 6. Segurança de rede
⚠️ Documentar **firewall** do VPS (portas mínimas expostas: 443), **IDS/IPS** e
segmentação (banco não exposto à internet). (C3)

## 7. Logging e monitoração
- Logger estruturado (pino) com **redaction** de segredos.
- Trilha de auditoria de mutações; **auditoria de acesso/leitura a PII** em
  implementação (A2).
- ⚠️ **Retenção de logs ≥12 meses + coleta centralizada + alerta de anomalia** a
  provisionar (C2).

## 8. Resposta a incidente
Plano de IR documentado (`docs/dpp/plano-resposta-incidente.md`) com fluxo de
detecção→contenção→notificação. **Compromisso de notificar a Amazon em ≤24h** de um
incidente envolvendo dados protegidos. ⚠️ Definir o **contato de segurança**.

## 9. Gestão de vulnerabilidade
Pentest interno white-box realizado em 2026-06 (`SECURITY-AUDIT-2026-06.md`).
`npm audit` no fluxo de desenvolvimento. ⚠️ Formalizar **scan a cada 30 dias** +
**pentest anual** (C6).

## 10. Política de senha
≥12 caracteres + complexidade (maiúscula/minúscula/número/especial), hash bcrypt.
Aplicada em convite, definição, reset e alteração de senha.

## 11. Account lockout
Rate-limit no login (tentativas por janela) + revogação de sessão. ⚠️ Avaliar
lockout de conta persistente (não só por IP/processo) conforme exigência.

## 12. Retenção e deleção de PII
PII de pedido purgada em **≤30 dias** (job automático, A1). Desconexão da conta
Amazon revoga o acesso e remove credenciais. Exclusão sob solicitação. ⚠️ Confirmar
método de deleção segura (NIST 800-88) para mídia/backup com o provedor.

## Acesso de funcionários / operadores
Acesso administrativo restrito ao(s) operador(es) da MundoFS, sob RBAC, com senha
forte e (após A5) MFA TOTP. ⚠️ Listar quem tem acesso e revisar periodicamente.

---
**Legenda:** itens sem ⚠️ já estão implementados no código/produção. Itens ⚠️ exigem
ação de infra/org sua (Trilho C) antes de afirmar conformidade plena na submissão.
