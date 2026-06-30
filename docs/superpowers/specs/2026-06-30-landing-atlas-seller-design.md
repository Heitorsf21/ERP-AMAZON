# Landing page Atlas Seller — aprovação SP-API (role Brand Analytics)

**Data:** 2026-06-30
**Branch alvo:** a definir (sugestão: `feat/landing-atlas-seller`)
**Status:** design aprovado, pendente revisão do spec

## 1. Contexto e problema

A Amazon reprovou a solicitação de **public solution provider** com o role **Brand Analytics** (caso `20883425301`). O motivo **não** é o app nem segurança (DPP) — é o **site público** que foi anexado (`mundofs.cloud`), que não tem nada do produto.

Citação da Amazon (resumo dos pontos exigidos):
- O site deve ter **descrição detalhada das features/serviços** que casem com os roles pedidos no Solution Provider Profile.
- O site deve exibir **pricing claro e transparente** (ou modelo sob consulta com calculadora/exemplos/formulário).
- O conteúdo deve estar **acessível sem autenticação**.

Prazo: remoção do acesso ao role Brand Analytics em **2026-07-13** se não respondermos. Precisamos publicar uma landing que cumpra as Website Guidelines e responder ao caso com a nova URL.

**Detalhe técnico crítico:** o dashboard de tráfego do ERP usa o relatório `GET_SALES_AND_TRAFFIC_REPORT` (`salesAndTrafficByDate`), que **exige o role Brand Analytics**. Portanto não dá para dropar o role — temos que aprovar o site.

## 2. Objetivos e não-objetivos

**Objetivos**
- Publicar uma landing page pública do **Atlas Seller** que satisfaça as 6 exigências das Website Guidelines da Amazon.
- Descrever explicitamente os **serviços analíticos** (Marketplace Analytics) para justificar o role Brand Analytics.
- Exibir **pricing transparente** em 3 planos.
- Entregar **Política de Privacidade** (LGPD + Amazon DPP) e **Termos de Uso**.
- Entregar config de deploy (Nginx subdomínio + Let's Encrypt) e o **texto de resposta ao caso** da Amazon.

**Não-objetivos**
- Não construir fluxo de signup/billing real (o produto é interno hoje; CTAs apontam para demo/contato).
- Não acoplar a landing ao app Next do ERP.
- Não migrar o produto para SaaS nesta entrega (é só o site de vitrine).

## 3. Checklist de conformidade Amazon (Website Guidelines)

Fonte: https://developer-docs.amazon.com/sp-api/docs/website-guidelines

| # | Requisito | Como a landing cumpre |
|---|---|---|
| 1 | Acessível sempre, sem login, sem "under construction"/placeholder, sem aviso de segurança | Estática, sem auth, sem CDN externo crítico, HTTPS válido |
| 2 | Nome com marca (não genérico) | "Atlas Seller" + razão social MundoFS no footer |
| 3 | Sem claims não verificáveis ("#1", "melhor", "único") | Copy revisada; depoimentos (se houver) marcados como opinião |
| 4 | Features abrangentes casando com os roles pedidos | Seção Recursos + bloco dedicado "Marketplace Analytics (Brand Analytics)" |
| 5 | Pricing claro e transparente | Seção Preços com 3 planos e valores |
| 6 | Política de Privacidade abrangente (coleta/uso/armazenamento/proteção/compartilhamento/exclusão) | Página `privacidade.html` LGPD + Amazon DPP |

## 4. Arquitetura e entregáveis

Conjunto **estático autocontido**, sem build, sem dependência de CDN externo crítico (CSS próprio embutido), servido pelo Nginx num subdomínio dedicado.

```
landing-atlas/
├── index.html          # landing principal
├── privacidade.html    # Política de Privacidade (LGPD + Amazon DPP) — OBRIGATÓRIA
├── termos.html         # Termos de Uso
├── styles.css          # CSS próprio (design system Modelo 1)
├── app.js              # menu mobile + smooth scroll (mínimo, progressive enhancement)
└── assets/
    ├── atlas-symbol.png, logo-mundofs.png   # já existem em public/
    ├── favicon
    └── screenshots/    # prints reais do dashboard (de design-previews/current-ui-capture/)
```

**Hospedagem:** subdomínio (provisório `atlasseller.mundofs.cloud` — nome exato a confirmar) na VPS Hostinger, Nginx servindo estático + Let's Encrypt. Entregar trecho de config Nginx pronto.

**Decisão de fonte de screenshots:** usar capturas reais do dashboard em `design-previews/current-ui-capture/`. Se não houver imagens utilizáveis, gerar novas a partir do ambiente. Prints reais reforçam a credibilidade exigida no requisito 4.

## 5. Estrutura da página (index.html)

| # | Seção | Conteúdo | Requisito Amazon |
|---|---|---|---|
| Nav | Header fixo | Logo Atlas Seller + Recursos/Analytics/Preços/Segurança + CTA "Agendar demo" | 2 |
| Hero | Headline + 2 CTAs | "Decisões com o lucro na mão." + badge "Feito para sellers Amazon"; CTAs "Começar agora" / "Ver dashboard"; mini-dashboard à direita | 3 |
| 01 Problema | 3 dores | Lucro real obscuro; taxas/FBA confusas; ruptura/estoque parado; Ads no escuro | — |
| 02 Como funciona | Fluxo em 3-4 passos | Conecta conta via SP-API OAuth → sincroniza pedidos/finanças/tráfego → decide com dados. Screenshot do dashboard | — |
| 03 Recursos | Grid de features + bloco Analytics destacado | Ver §6 | **4** |
| 04 Segurança & Privacidade | Bullets de confiança | OAuth (não guarda senha Amazon), AES-256, LGPD, Amazon AUP/DPP, uso/retenção/exclusão; link p/ Política | 6 |
| 05 Preços | 3 planos | Ver §7 | **5** |
| FAQ | 5-6 perguntas | Brand Registry? como conecta? meus dados? cancelamento? marketplaces suportados? | — |
| CTA final | Faixa de conversão | "Agendar demo" / "Falar com a gente" | — |
| Footer | Institucional + legal | Razão social MundoFS, contato (email), links Política de Privacidade / Termos, copyright | 2, 6 |

## 6. Seção Recursos — o ponto que aprova o Brand Analytics

A seção 03 terá um **bloco dedicado e explícito** de **Marketplace Analytics (Brand Analytics)**, descrevendo os serviços analíticos entregues ao Seller — exatamente a linguagem que faltou no `mundofs.cloud`:

**Bloco "Marketplace Analytics" (destaque):**
- Métricas de **tráfego e conversão** por SKU/dia: sessões, page views, **taxa de conversão por sessão (unit session %)**, **% de Buy Box**.
- Insights de **como os clientes descobrem e compram** os produtos (comportamento de busca/compra).
- Desempenho de vendas e tráfego ao longo do tempo (séries diárias).

> Esse bloco precisa citar nominalmente "analytics de marketplace / tráfego e conversão / Brand Analytics" para casar com o role pedido. Sem ele, reprova de novo.

**Demais features (grid):**
- **Lucratividade real por venda** — comissão, FBA, parcelamento, frete, imposto, custo e margem reais, conciliados via SP-API Finance.
- **Otimizador de Ads** — ACOS/ROAS/CTR/CPC, recomendações de lance/negativação.
- **Monitor de Buy Box** — acompanhamento de posse e perda da Buy Box.
- **Gestão financeira** — DRE, contas a pagar/receber, conciliação bancária.
- **Controle de estoque** — cobertura por dias de venda, alertas de ruptura (resumo diário no WhatsApp).
- **Custo por nota fiscal** — custo real por peça com rateio de frete/impostos e CMP ponderado.

Copy sem termos proibidos ("#1", "melhor", "único"). Tom: profissional, orientado a resultado, direto (referência Eluria/Stripe).

## 7. Pricing (seção 05)

3 planos, valores aprovados pelo usuário (calibrados pela média de Gestor Seller / Bling / UpSeller):

| Plano | Preço | Inclui |
|---|---|---|
| **Starter** | **R$ 89,99/mês** | 1 conta Amazon, até ~500 vendas/mês, dashboards e DRE |
| **Pro** | **R$ 159,99/mês** | Até ~3.000 vendas/mês, **Marketplace Analytics (tráfego/Brand Analytics)**, otimizador de Ads, WhatsApp de estoque |
| **Scale** | **R$ 219,99/mês** | Até 10.000+ vendas/mês, multi-conta, suporte premium |

Exibir claramente que valores são mensais, em R$. Sem pegadinhas/asteriscos escondidos. (Valores ajustáveis pelo usuário antes do publish.)

## 8. Política de Privacidade (privacidade.html) — OBRIGATÓRIA

Cobrir, em linguagem clara, conforme Amazon DPP + LGPD:
- **Quais dados são coletados** — dados da conta Amazon via SP-API: pedidos, finanças/settlements, inventário, métricas de tráfego/Brand Analytics; dados de cadastro do usuário.
- **Finalidade** — servir o próprio Seller dono dos dados (gestão e analytics da sua operação). Não há venda/compartilhamento de dados com terceiros.
- **Armazenamento e proteção** — Postgres em VPS própria; segredos/tokens criptografados (AES-256-GCM); acesso restrito.
- **Compartilhamento** — não compartilhado com terceiros; isolamento por conta.
- **Retenção e exclusão** — dados retidos enquanto a conta estiver ativa; **exclusão sob solicitação** (canal de contato).
- **Base legal LGPD** e **contato do encarregado/DPO** (email).
- Aderência explícita à **Amazon Acceptable Use Policy** e **Data Protection Policy**.

## 9. Termos de Uso (termos.html)

Enxuto: objeto do serviço, conta/responsabilidades do usuário, planos e pagamento, cancelamento, limitação de responsabilidade, foro, contato. (Não precisa ser jurídico-pesado; é requisito de completude/credibilidade, não exigência literal da Amazon.)

## 10. Design system (Modelo 1 — "Sutil", aprovado)

Base **clean light profissional** (referência Stripe/Bling) com **laranja Amazon como acento** (afinidade marketplace).

**Cores**
- Fundo: `#F8FAFC` (slate-50) / superfícies `#FFFFFF`
- Texto: `#0F172A` (slate-900), secundário `#475569` (slate-600), mudo `#94A3B8`
- **Primária (CTA/links/logo): azul `#2563EB`** (hover `#1D4ED8`)
- Sucesso/receita: esmeralda `#10B981` / `#059669`
- **Acento Amazon: `#FF9900`** (badge, traço do destaque, detalhe pontual) + `#EA580C` para texto laranja sobre claro
- Bordas: `#E2E8F0`

**Tipografia**
- UI/corpo: **Inter** (com fallback `system-ui`), pesos 400/600/700/800. Servir via `@font-face` self-hosted (sem depender de Google Fonts online — robustez/"sempre no ar").
- Numerais tabulares nos KPIs.

**Componentes/assinaturas visuais**
- Badge pill com ponto colorido ("Feito para sellers Amazon").
- Traço SVG laranja sublinhando a palavra-chave do headline.
- Cards de dashboard com sombra suave (`0 10px 30px -12px rgba(15,23,42,.18)`), raio 12px.
- Botão primário azul sólido; secundário outline.

**Responsividade:** mobile-first; hero vira coluna única no mobile; nav colapsa em menu hambúrguer (app.js).

## 11. Resposta ao caso Amazon (entregável de texto)

Após publicar, responder ao caso `20883425301` (em inglês) com:
- A nova URL pública da landing.
- Mapeamento curto: onde no site estão (a) descrição das features analíticas alinhadas ao Brand Analytics, (b) pricing, (c) política de privacidade.
- Confirmação de aderência à AUP seções 4.4/4.5.

Rascunho do texto entregue junto com o código.

## 12. Critérios de sucesso

- Landing publicada em HTTPS no subdomínio, acessível sem login, sem placeholder.
- As 6 exigências do §3 verificáveis na página.
- Bloco Marketplace Analytics nomeia explicitamente tráfego/conversão/Brand Analytics.
- Pricing visível com 3 planos e valores.
- Política de Privacidade publicada e linkada.
- Resposta ao caso enviada com a URL.

## 13. Itens em aberto

- Nome exato do subdomínio (`atlasseller.mundofs.cloud` vs `atlas.mundofs.cloud`).
- Email de contato/DPO a exibir (sugestão: `admfsmundo@gmail.com` ou um `contato@`/`privacidade@` do domínio).
- Confirmar se há screenshots utilizáveis em `design-previews/current-ui-capture/` ou se geramos novos.
- Validar os valores finais de pricing antes do publish.
