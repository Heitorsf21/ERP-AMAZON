# Checklist de submissão — publicar o app SP-API (Developer Console)

> Passo a passo para sair de DRAFT → app publicado (OAuth público). Você executa no
> Seller Central da conta MundoFS (dona do app **Atlas Seller**, App ID
> `amzn1.sp.solution.c50f6c3c-8f68-46f2-a122-d79ff2ce3179`). Eu já preparei o que é
> código/doc; aqui é a parte de console.

## Pré-requisitos (antes de submeter)
- [ ] `/privacidade` no ar — ✅ https://erp.mundofs.cloud/privacidade
- [ ] Controles de código DPP concluídos (A1 purga PII, A2 audit PII, A3 payload) — *(em andamento, eu te aviso)*
- [ ] Questionário DPP revisado (`docs/dpp/questionario-seguranca-dpp.md`)
- [ ] Plano de IR aprovado + contato de segurança definido (`docs/dpp/plano-resposta-incidente.md`)
- [ ] Infra/org provisionada/documentada (KMS, logs 12m, IDS/IPS, MFA operadores, scan) — Trilho C

## Passos no Developer Console
1. **Seller Central (conta MundoFS)** → **Apps e Serviços → Desenvolver Apps**.
2. Linha do app **Atlas Seller** → **Editar app**.
3. **Roles**: confirme apenas as que você usa (Inventory & Order Tracking, Finance and Accounting, Product Listing/Pricing se aplicável). **PII (Direct-to-Consumer / dados de comprador)**: só marque se realmente precisar — pedir roles de PII aumenta o rigor da revisão. Hoje o sistema **minimiza PII**, então evite roles de PII se não forem essenciais.
4. **Bloco OAuth** (aparece ao preparar publicação):
   - **OAuth Login URI**: `https://erp.mundofs.cloud/amazon`
   - **OAuth Redirect URI**: `https://erp.mundofs.cloud/api/amazon/oauth/callback`
5. **Política de privacidade (URL)**: `https://erp.mundofs.cloud/privacidade`
6. **Metadados**: nome (Atlas Seller), descrição curta, logo, categoria.
7. **Questionário de segurança / DPP**: responda usando o rascunho (`questionario-seguranca-dpp.md`). Anexe o que for pedido (política de retenção, plano de IR).
8. **Tipo de listagem**:
   - **Unlisted** (recomendado p/ começar): até 25 sellers, sem vitrine pública, revisão mais leve.
   - **Listed/Appstore**: ilimitado + vitrine, revisão mais rigorosa.
9. **Submeter** e acompanhar o status. A Amazon costuma voltar com pendências — responda rápido.

## Depois de aprovado
- [ ] Trocar `AMAZON_OAUTH_DRAFT` para `false` no `.env` da VPS (remove `version=beta` do consent) + `pm2 reload --update-env`. *(eu faço quando você aprovar)*
- [ ] Testar o botão **Conectar (SP-API)** logado como admin de uma empresa nova → consentimento → callback OK.
- [ ] Repetir para o **Ads** (app/Return URL próprios).

## Notas
- Enquanto **DRAFT**, dá pra usar **self-authorization** (10 contas) sem revisão — é o plano B se a revisão demorar e você precisar do piloto já.
- Submeter **incompleto** tende a reprovar e atrasar. Melhor mandar o pacote inteiro de uma vez.
