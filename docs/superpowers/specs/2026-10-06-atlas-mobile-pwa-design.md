# Atlas Seller mobile: menu personalizável, app instalável e push de vendas

**Data:** 2026-10-06 · **Revisão:** 2 (2026-10-06) · **Status:** aprovado com ajustes; visual aguarda aprovação no protótipo (canvas "Atlas Seller Mobile": https://claude.ai/artifact/5wJonxEZqt2bua6JtDNky4) · **Escopo:** Fases 1–3 (Fase 4 opcional)

> **Revisão 2, ajustes pedidos pelo usuário:**
> (a) Nenhuma aba é removida nem escondida por padrão. **Cada usuário escolhe em Configurações → Menu o que aparece** no menu, inclusive pelo celular (§3).
> (b) O aviso de venda deve sair **o mais rápido possível**: o push passa a sair direto do consumidor SQS, em segundos, e não mais no fim do ORDERS_SYNC (§5.4).
> (c) O visual mobile é aprovado num protótipo HTML antes da implementação.
>
> **Revisão 3 (feedback no protótipo):**
> (d) O Dashboard no celular mostra só Faturamento, Lucro, Margem, Vendas, ROI, Gasto em anúncios e MPA. O gráfico sai e entra o Top 15 completo, como no navegador.
> (e) Vendas e Top 15 mostram a foto do produto quando ela existe.
> (f) Produtos ganha uma tela de detalhe com estoque, **alterar custo** e **alterar preço na Amazon**. Esta última vira uma fase própria, por depender de permissão da Amazon (§6).
> (g) O aviso de venda **não mostra o produto**: só "Nova venda na <loja>" e o valor. Um mesmo celular recebe as duas lojas (MundoFS e UDN).

## 1. Objetivo

Usar o Atlas Seller no celular como um app: instalar pelo navegador (sem Apple Store/Google Play), receber notificação quando sair uma venda e navegar em um menu limpo, só com o que é usado de fato.

**O que foi pedido:**
- Versão mobile instalável pelo navegador.
- Notificação de venda.
- Retirar as abas que não são usadas, descobertas por investigação e não por palpite.

**Premissas assumidas (corrigir se estiverem erradas):**
1. Os alvos são iPhone (Safari) e Android (Chrome). O app só funciona online e não há modo offline.
2. Nada é apagado nem escondido por padrão. A escolha das abas é **por usuário** e vale para o menu do desktop e do celular (§3).
3. O push de venda é por aparelho: cada celular ativa o seu. Vendas **não** entram no sino, que continua só para alertas, como manda a regra do projeto.

**Sucesso significa:**
- Instalar o app no iPhone e no Android a partir de `erp.mundofs.cloud`.
- A notificação "Nova venda" chega com o celular bloqueado **em segundos** após a compra na mundofs (meta: mediana ≤ 30 s).
- Tocar na notificação abre o pedido.
- Pelo celular, em Configurações → Menu, você liga e desliga as abas e o menu muda na hora.

## 2. Diagnóstico: o que é usado hoje

### 2.1 Fontes
- **Nginx de produção**: 14 dias, de 22/09 a 06/10/2026, com 14.638 requisições. Para saber qual página estava aberta, usei o `Referer` das chamadas `/api/*`. O sino consulta `/api/notificacoes/contar` a cada 60 s, então cada consulta vale aproximadamente 1 minuto de tela aberta naquela página.
- **Banco de produção**: contagem e último registro manual de cada módulo, por empresa. Só leitura.
- **Limite**: as duas contas (mundofs e UDN) já logaram do mesmo IP. Por isso os números de uso no Nginx são **combinados** das duas empresas.

### 2.2 Uso de tela (Nginx, 14 dias)

| Aba | Tempo de tela aprox. | Dias com uso | Chamadas de API |
|---|---|---|---|
| **Dashboard E-commerce** | **~493 min** | **13 de 14** | 1.403 |
| Configurações | ~7 min | 1 | 5 |
| Vendas | ~6 min | 4 | 16 |
| Produtos | ~5 min | 2 | 29 (inclui 3 lançamentos de custo) |
| As outras 13 abas | **0** | **0** | **0** |

As 13 abas sem acesso são: Agenda, Dashboard Financeiro, Caixa, Contas a Pagar, Contas a Receber, Notas Fiscais, Destinação, DRE, Compras, Avaliações, Publicidade, Home e Notificações (página).

Dois detalhes:
- O sino é usado: "marcar todas como lidas" foi clicado 6 vezes. A página `/notificacoes` em si nunca foi aberta.
- Já existe uso pelo celular hoje: 43 chamadas com user-agent mobile, todas no Dashboard.

### 2.3 Última atividade manual por módulo (banco)

| Módulo | mundofs | UDN | Leitura |
|---|---|---|---|
| Agenda (Tarefa) | 11 tarefas, última em 05/06 | 0 | parada há 4 meses |
| Contas fixas | 4, última em 29/05 | 2, última em 03/06 | cadastro estável; alimenta o KPI "MPA pós contas fixas" |
| Contas a Pagar (manual, fora as fixas) | **0** | 2, em 27/07 | só tem as ocorrências automáticas das fixas |
| Contas a Receber | **0 registros** | **0** | nunca usada |
| Caixa (Movimentacao) | 35, última em 29/05 | 1, em 27/07 | parado; por consequência DRE, Destinação e Dashboard Financeiro ficam sem despesas |
| Notas Fiscais (DocumentoFinanceiro) | **0** | **0** | nunca usada |
| Compras (PedidoCompra) | 1, em 05/06 | 0 | teste único |
| Publicidade / otimizador | 36 recomendações aprovadas, **última aprovação em 19/07** | n/a | sem uso humano há 2,5 meses (o job de 6 h continua rodando) |
| Avaliações (automação) | 2.959 solicitações, última **hoje** | 289, última hoje | **a automação é essencial**, mas a aba não é aberta |
| Custo histórico (Produtos) | último em 27/09 | último em 06/10 | **em uso** |
| Vendas | 15 a 29 por dia (as duas empresas) | | em uso |

### 2.4 Conflito com o produto SaaS

A landing (`landing-atlas/`) vende Caixa, contas a pagar e a receber, DRE, Agenda, avaliações automáticas e o Otimizador de Ads, e o checkout self-service está no ar. Por isso **nenhum módulo é apagado**. Cada usuário decide o que quer ver (§3).

## 3. Fase 1: menu personalizável por usuário

### 3.1 Comportamento
- **Nova aba em Configurações: "Menu"** (ao lado de Geral, Integrações e Notificações). Ela lista todas as abas do sistema, agrupadas como na sidebar (Financeiro / E-commerce), cada uma com um switch "aparecer no menu".
- **Pensada para o celular**: a tela é uma lista vertical com alvos de toque de 48 px. No mobile ela também abre direto pelo item **"Personalizar menu"** do sheet "Mais".
- **Aplicação imediata**: ao mudar um switch, sidebar, CommandPalette e o sheet "Mais" mudam na hora (update otimista + toast "Menu atualizado").
- **Sempre visíveis** (switch travado, com a explicação "sempre no menu"):
  - **Dashboard E-commerce**: é a tela inicial.
  - **Vendas**: é o destino do push.
  - **Produtos**.
  - **Configurações**: é onde se reativa tudo. Sem ela, não haria como desfazer.
- **Padrão**: nada escondido. O usuário que nunca abrir a tela vê o menu de hoje.
- **Atalho "Usar sugestão"**: aplica de uma vez o que os dados de uso mostram (§2): mantém Dashboard, Vendas, Produtos e Configurações e esconde o resto. É reversível pelo "Mostrar tudo".
- **Alcance**: a escolha é **por usuário** e vale no desktop e no celular. Cada pessoa da empresa tem o seu menu.
- **Esconder não desliga nada**: automação de avaliações, contas fixas no KPI "MPA pós contas fixas" e o otimizador de Ads continuam rodando. Acesso por URL e links de notificação continuam funcionando, e roles e dados seguem protegidos no servidor.
- **Grupos**: um grupo da sidebar que fique sem itens some.

### 3.2 Implementação
- **Armazenamento**: `ConfiguracaoSistema` (modelo global, `chave @unique`) com a chave `menu_abas_ocultas:u:<usuarioId>` e o valor em JSON (`string[]` de `href`). **Não precisa de migration.**
- **API**: `GET/PUT /api/menu/preferencias` (`requireSession`; só lê e grava a chave do próprio `session.uid`).
  - O Zod aceita apenas `href` presentes em `NAV_GROUPS` e rejeita as abas travadas.
  - Grava `AuditLog` `MENU_ATUALIZADO`.
- **Fonte única**: `nav-routes.ts` ganha `fixo?: true` nas 4 abas travadas.
  - Novo hook `useMenuVisivel()` (React Query, `staleTime: Infinity`, invalidado no PUT) devolve `NAV_GROUPS` filtrado.
  - Sidebar, CommandPalette e o sheet "Mais" (Fase 2) consomem o hook.
  - A Home sai do CommandPalette/sidebar como aba configurável, como qualquer outra.
- **UI**: `src/components/configuracoes/menu-section.tsx` + aba "Menu" em `configuracoes/page.tsx`, aceitando o deep-link `?tab=menu`.

**Estimativa:** ~1 dia. Pode ir para produção sozinha, antes do resto.

## 4. Fase 2: app instalável (PWA) + shell mobile

### 4.1 Estado atual (auditoria do código)
- **Infra de PWA**: não existe manifest, service worker, ícones 192/maskable, `viewport`/`themeColor` nem `appleWebApp`. Os ícones atuais são `src/app/icon.png` (512) e `apple-icon.png` (180).
- **Proxy**: `src/proxy.ts` mandaria `/sw.js` e `/manifest.webmanifest` para `/login` com 302. O manifest é buscado **sem cookie**, então quebraria mesmo com o usuário logado.
- **Shell**: `app-shell.tsx` usa `h-screen overflow-hidden` (100vh, que dá problema no iOS), sem safe-area. A navegação mobile é um drawer pelo hamburguer, e não existe bottom nav.
- **Controles hover-only**, invisíveis no toque: "marcar como lida" no sino (`notification-bell.tsx:262`).
- **Telas que ficam**:

| Tela | Situação mobile |
|---|---|
| Vendas | já está OK (cards, zero scroll) |
| Produtos | parcialmente OK |
| Produtos/[id] | tem `grid-cols-3` fixo |
| Configurações | OK |
| Dashboard | Top 15 em tabela de 12 colunas e gráfico de 360 px |

### 4.2 Instalação
| Arquivo | O quê |
|---|---|
| `src/app/manifest.ts` (novo) | name "Atlas Seller", short_name "Atlas", `id:"/"`, `start_url:"/dashboard-ecommerce?source=pwa"`, `display:"standalone"`, theme/background a partir dos tokens, ícones 192/512/maskable-512, shortcuts Vendas e Produtos |
| `public/icons/` (novo) | `icon-192.png`, `icon-512.png`, `maskable-512.png` (símbolo dentro da zona segura de 80%) e `badge-96.png` (silhueta monocromática para a barra de status do Android), gerados a partir de `src/app/icon.png` com `sharp` |
| `public/sw.js` (novo, escrito à mão) | `install`/`activate` (skipWaiting + clients.claim), `push`, `notificationclick` (foca uma janela aberta ou abre `data.url`), `pushsubscriptionchange`. **Sem handler de `fetch` e sem cache**: dados financeiros nunca ficam velhos e não há risco de cache cruzado entre empresas (já houve vazamento visual por cache no login). |
| `src/proxy.ts` | `/sw.js` e `/manifest.webmanifest` entram em `PUBLIC_PATHS`. `/icons/*.png` já passa pelo matcher. |
| `next.config.mjs` | `headers()` para `/sw.js`: `Cache-Control: no-cache, no-store, must-revalidate` e CSP `default-src 'self'; script-src 'self'` |
| `src/app/layout.tsx` | `export const viewport` (`viewportFit:"cover"`, `themeColor` claro/escuro) e `appleWebApp` (`capable`, `statusBarStyle`, título "Atlas") no metadata |
| `src/components/pwa/pwa-provider.tsx` (novo) | registra o SW (produção e localhost), captura `beforeinstallprompt` (Android), detecta standalone/iOS e expõe `useInstalacao()` |

Fluxo de instalação:
- **Android**: botão "Instalar app" no menu "Mais", via `beforeinstallprompt`.
- **iPhone**: abre uma folha com o passo a passo: Compartilhar → "Adicionar à Tela de Início". O Safari não tem API de instalação.
- **Banner único** no dashboard mobile ("Instale o Atlas no celular"), que pode ser dispensado (`localStorage` com try/catch).
- **Login dentro do app**: no iPhone o app instalado tem cookies separados do Safari, então é preciso logar uma vez dentro dele. "Lembrar-me" dá 30 dias (`session.ts:122`).

### 4.3 Shell mobile (abaixo de `lg`)
- **Bottom nav fixa** (novo `src/components/bottom-nav.tsx`), com 4 itens: **Início** (Dashboard), **Vendas**, **Produtos**, **Mais**.
  - "Mais" abre um Sheet de baixo com: as demais abas que estão ligadas no seu menu, Configurações, Meu Perfil, **Personalizar menu**, Instalar app, Notificações deste celular e Sair.
  - Ela substitui o hamburguer e o drawer abaixo de `lg`, para não ter dois menus.
  - O sino e o avatar continuam na topbar.
- **Shell**: `h-screen` vira `h-dvh`. `padding` com `env(safe-area-inset-*)` (notch e home indicator). `main` com `p-4` no mobile e `pb` para a bottom nav. Toaster `top-center` no mobile.
- **Volta ao app**: o app instalado não tem botão de recarregar. Ao voltar para o primeiro plano (`visibilitychange`), as queries do dashboard e de vendas são invalidadas. Hoje o default global é `refetchOnWindowFocus:false`.
- **Telas de detalhe** (produtos/[id]): botão "voltar" no header mobile, porque o standalone não tem barra do navegador.
- **Dashboard no celular** (abaixo de `md`; o desktop não muda):
  - **KPIs**: Faturamento · Lucro · Margem · Vendas (pedidos) · ROI · Gasto em anúncios, em grade 2×3. Embaixo, o **MPA** num card largo, com o lucro pós-Ads.
  - **Saem no celular**: os demais KPIs, o "Ver mais 8 métricas" e o gráfico "Resumo de receitas".
  - **Top 15 completo** (os 15, não 5), como lista de cards com as mesmas métricas da tabela do desktop:
    - posição, foto (`ProductThumb`), nome em 2 linhas, SKU, unidades e % do total, faturado;
    - Lucro + `MarginBadge`, Custo Ads, Lucro pós-Ads + badge de MPA;
    - preço médio e custo.
    - Mantém o botão de ordenação por faturamento.
  - O mesmo `obterKpis`/`obterTopProdutos` alimenta as duas versões, sem endpoint novo.
- **Vendas**: foto do produto em cada card (`ProductThumb` + `resolverImagemProduto`, ícone quando não há foto). O lookup já é em lote por `sku`.
- **Produtos no celular**:
  - Na lista, cada card mostra foto, nome, SKU/ASIN, estoque, cobertura (faixa colorida + texto) e preço. Tocar abre o detalhe.
  - **Detalhe** (`/produtos/[id]` com layout mobile):
    - **estoque**: disponível FBA, chegando, reservado, vendas em 30 dias, cobertura e data estimada de ruptura;
    - **preço na Amazon** com "Alterar" (Fase 4);
    - **custo unitário** com a vigência atual e "Alterar";
    - **por unidade (estimado)**: preço − comissão − FBA − parcelamento − imposto − custo = lucro e margem;
    - link para o histórico de custo.
  - **Alterar custo** (folha inferior, nesta fase):
    - campo com `inputmode="decimal"`;
    - "Vale para": **A partir de hoje** (padrão), **Uma data** ou **Todo o histórico**. São os três modos que já existem em `POST /api/produtos/[id]/custo-historico` (`aplicarCustoAPartirDeHoje` / `NoPeriodo` / `HistoricoCompleto`), sem endpoint novo;
    - prévia do lucro por unidade antes → depois.
- **Sino**: ações visíveis no toque, com `[@media(hover:none)]`.
  - **Vendas → aba Reembolsos**: a tabela de 8 colunas vira cards.
  - **Telas opcionais** (só aparecem no celular se o usuário as ligar no menu): ajustes mínimos, sem redesign.
    - **Agenda** abre na visão "Dia" abaixo de `md` (a grade de 7 colunas não cabe).
    - **DRE**: tabelas cruas ganham contêiner `overflow-x-auto`.
    - As demais já rolam a tabela na horizontal sem quebrar o layout.

**Estimativa:** 3 a 4 dias (o dashboard mobile e o detalhe de produto entraram nesta fase).

## 5. Fase 3: push de venda nova

### 5.1 Infra
- **Dependência**: `web-push` (+ `@types/web-push`).
- **Variáveis de ambiente**: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT=mailto:…`.
  - Gerar uma vez na VPS com `npx web-push generate-vapid-keys`.
  - **Nunca rotacionar à toa**: trocar o par invalida todos os aparelhos. Guardar no backup do `.env`.
  - Sem VAPID, o recurso se esconde sozinho (`GET /api/push/config` → `{enabled:false}`).
- **Saída de rede**: a VPS já alcança `fcm.googleapis.com`, `web.push.apple.com` e Mozilla (testado em 06/10).

### 5.2 Dados (migration manual Postgres + `prisma:push` no SQLite)
```prisma
model PushDispositivo {            // GLOBAL_MODELS — filtro explícito por empresa/usuário
  id                 String    @id @default(cuid())
  empresaId          String
  usuarioId          String
  endpoint           String
  p256dh             String
  auth               String
  userAgent          String?
  apelido            String?   // "iPhone", "Android" (derivado do UA, editável)
  receberVendas      Boolean   @default(true)
  receberAlertas     Boolean   @default(false)   // Fase 4
  ativo              Boolean   @default(true)
  falhasConsecutivas Int       @default(0)
  ultimoEnvioEm      DateTime?
  criadoEm           DateTime  @default(now())
  atualizadoEm       DateTime  @updatedAt
  @@unique([empresaId, endpoint])   // o mesmo celular pode receber de várias lojas
  @@index([empresaId, ativo])
  @@index([usuarioId])
  @@index([endpoint])
}

model PushEnvio {                  // TENANT_MODELS — idempotência + histórico
  id          String    @id @default(cuid())
  empresaId   String?
  tipo        String    // VENDA_NOVA | VENDAS_AGRUPADAS | TESTE | ALERTA
  dedupeKey   String    // "venda:<amazonOrderId>"
  payloadJson Json
  status      String    @default("PENDENTE") // ENVIADO | SEM_DESTINO | ERRO
  enviadosOk  Int       @default(0)
  erro        String?
  criadoEm    DateTime  @default(now())
  enviadoEm   DateTime?
  @@unique([empresaId, dedupeKey])
  @@index([criadoEm])
}
```

**Várias lojas no mesmo celular**: você usa a MundoFS e a UDN.
- O `endpoint` identifica o aparelho, e a chave única passa a ser `[empresaId, endpoint]`.
- Ativar na conta da MundoFS e depois na conta da UDN, no mesmo celular, cria **duas inscrições**. Cada venda avisa com o nome da própria loja.
- Ativar de novo na mesma loja só atualiza a inscrição (`upsert` pelo unique composto, re-vinculando ao usuário da sessão).

**Por que `PushDispositivo` é GLOBAL**: ele usa `upsert` explícito por `[empresaId, endpoint]`. Fora do tenant, também dá para limpar um endpoint morto (404/410) em todas as lojas de uma vez. Toda leitura filtra `empresaId` e `usuarioId` explicitamente, no mesmo padrão do `Usuario`.

### 5.3 Endpoints (`requireSession`)
| Rota | Função |
|---|---|
| `GET /api/push/config` | `{ enabled, publicKey }` |
| `POST /api/push/dispositivos` | inscreve ou re-vincula este aparelho (Zod: endpoint https, keys) ao usuário e à empresa da sessão |
| `PATCH /api/push/dispositivos` | preferências deste aparelho (por `endpoint`) |
| `DELETE /api/push/dispositivos` | remove (por `endpoint` deste aparelho, ou por `id` de um aparelho do próprio usuário) |
| `GET /api/push/dispositivos` | lista os aparelhos do usuário |
| `POST /api/push/teste` | envia um teste só para os aparelhos do usuário (limite de 1 a cada 30 s) |

**Logout**: se o aparelho tiver inscrição ativa para a loja da sessão, o "Sair" pergunta: "Continuar recebendo os avisos de venda da MundoFS neste aparelho?"
- **No app instalado** o padrão é "Continuar". É o caso de quem troca entre MundoFS e UDN no mesmo celular.
- **Numa aba comum do navegador** o padrão é "Parar", pensando em computador compartilhado.
- "Parar" chama `DELETE` só daquela loja. O `unsubscribe()` do navegador só acontece se não sobrar nenhuma loja inscrita.

### 5.4 Gatilho: o mais rápido possível

**Medição em produção** (mundofs, 80 pedidos, 01–06/10, medianas):

| Trecho | Mediana | p90 |
|---|---|---|
| Compra → mensagem `ORDER_CHANGE` no SQS | **13 s** | |
| Fila do worker até o job começar | 18 s | **197 s** |
| Job → `VendaAmazon` criada | 4 s | |
| Total compra → venda gravada | 137 s | 534 s |

O gargalo é a fila do worker, que é compartilhada com todos os outros jobs, e não a Amazon. Por isso o push **não espera o ORDERS_SYNC**.

**Gatilho primário: consumidor SQS** (`erp-sqs-consumer`, `src/lib/amazon-sqs.ts`).
- Ao receber `ORDER_CHANGE`, **antes** de enfileirar o ORDERS_SYNC, chama `notificarVendaNova(notification)` (novo `src/modules/push/vendas.ts`), já roteado para a empresa dona via `extrairSellerIdDaNotification` + `runWithTenant`.
- A notificação já traz `AmazonOrderId`, `PurchaseDate`, `OrderStatus`, `FulfillmentType` e `OrderItems[{SellerSKU, Quantity}]`. O nome da loja vem de `Empresa.nome` (hoje "MundoFS" e "UDN"). O produto não aparece no aviso.
- **Valor**: o payload não traz preço. O valor mostrado é a melhor estimativa já existente:
  1. preço real recente do SKU (`buscarPrecoRealRecentePorSku`, ≤ 7 dias, que acompanha ofertas);
  2. senão, o cache do listing.
  
  Em ambos os casos o valor é multiplicado pela quantidade e exibido com `~`. Isso é só exibição: **nada é gravado em `VendaAmazon`** (os campos sagrados ficam intactos).
- **Latência esperada**: ~15–30 s após a compra (13 s da Amazon + long polling do SQS + envio).

**Gatilho de reserva: ORDERS_SYNC** (`syncOrdersInternal`, `service.ts`, ponto em que `criadas++` ~L1132).
- Cobre empresas sem SQS e mensagens SQS perdidas.
- Coleta as vendas **criadas**, agrupa por pedido e chama a mesma `notificarVendaNova`. Aqui o valor pode ser o real (ItemPrice), quando já veio.

**Regras comuns** (funções puras e testadas):
1. **Recência**: só pedidos com `PurchaseDate` (ISO do payload) ≥ agora − 2 h. Usar o ISO e **não** `dataVenda`, que é UTC-naive.
2. **Cancelados**: ignora `OrderStatus = Canceled`.
3. **Fluxos excluídos**: `REPORTS_BACKFILL`, importação CSV e Finance nunca notificam.
4. **Rajada**: com mais de 3 pedidos novos na mesma execução do ORDERS_SYNC sai 1 push agrupado ("4 novas vendas na MundoFS" / "Total de ~R$ 356,20."). No SQS cada mensagem é um pedido, então não há agrupamento.
5. **Idempotência**: `PushEnvio` com a chave única `[empresaId, "venda:<orderId>"]`, gravada antes do envio. **Quem chegar primeiro (SQS ou ORDERS_SYNC) envia**; o outro é no-op. Mudanças de status do mesmo pedido (Pending → Unshipped → Shipped) também viram no-op.

**Envio**:
- Vai para `PushDispositivo` com `empresaId` da venda, `ativo` e `receberVendas`.
- Usa `web-push` em paralelo, com timeout de 5 s por aparelho, `urgency: "high"` e `TTL: 3600`.
- Resposta 404/410 apaga a inscrição. Outros erros incrementam `falhasConsecutivas`; com 5 falhas o aparelho é desativado.
- Nunca lança nem bloqueia o processamento da mensagem SQS: tudo dentro de try/catch com log pino.

**UDN (sem assinatura SQS hoje, ~12 min)**, dentro desta fase:
1. Criar a assinatura `ORDER_CHANGE` para a UDN com o app LWA próprio dela, apontando para a mesma fila. O consumidor já roteia por `sellerId`.
2. Enquanto isso não acontecer, ou se falhar, as empresas **sem** assinatura SQS ativa passam a ter ORDERS_SYNC por `created` a cada 2 min, em vez dos 15 min herdados do `SQS_PRIMARY` global.

Resultado esperado para a UDN: ~2 min no pior caso.

### 5.5 Conteúdo da notificação (sem produto)
- **Título**: `Nova venda na MundoFS` (ou `na UDN`), a partir de `Empresa.nome`.
- **Corpo**: `Você teve uma nova venda de R$ 204,97.`
  - Quando o valor ainda é estimado (Pending sem ItemPrice), vira `~R$ 77,00`.
  - Sem preço nenhum (SKU novo, sem listing): `Você teve uma nova venda.`
- **Agrupado** (só no ORDERS_SYNC): `3 novas vendas na MundoFS` / `Total de R$ 356,20.`
- **Nunca no aviso**: nome do produto, SKU e quantidade. O aviso pode aparecer na tela bloqueada.
- **Formatação**: ícone 192, badge 96, `tag: "venda-<empresaId>-<orderId>"` (sem duplicar na tela).
- **Toque**: abre `data.url = "/vendas?pedido=<amazonOrderId>"`. É preciso adicionar o filtro `pedido` em `/api/vendas` e na página, que abre o card expandido e destacado.
  - Se a sessão do app for de outra loja, o Atlas mostra "Este pedido é da UDN. Trocar de conta?" em vez de uma lista vazia.
- **Sem lucro no push**: em Pending a taxa ainda é estimada, então o lucro não entra.

### 5.6 UI: Configurações → Notificações → card "Neste celular"
- **Estados**:
  - não suportado;
  - no iPhone, "Instale o app primeiro" (no iOS o push só existe com o app instalado, iOS 16.4+);
  - permissão negada (com instruções para reativar nos ajustes);
  - pronto para ativar;
  - ativo.
- **Controles**:
  - botão **"Ativar notificações"**, que pede a permissão dentro do toque, como o iOS exige;
  - switch "Vendas novas";
  - "Enviar teste";
  - lista "Seus aparelhos", com opção de remover.
- **Atalho**: o mesmo card fica acessível pelo menu "Mais" no mobile.

**Estimativa:** 3 a 4 dias (inclui o gatilho via SQS e a assinatura da UDN).

## 6. Fase 4: alterar preço na Amazon pelo celular

Hoje o Atlas só **lê** o anúncio (`getListingsItem`, `LISTINGS_GET_ITEM` sem erro em produção). Mudar o preço exige **escrever** no anúncio via `patchListingsItem` (Listings Items API 2021-08-01, atributo `purchasable_offer.our_price`). Isso depende da permissão **Product Listing** no app da Amazon, que o CLAUDE.md registra como negada (403) para o Catalog.

1. **Passo 0, sem efeito colateral**: chamar `patchListingsItem` com `mode=VALIDATION_PREVIEW` num SKU, mandando o preço atual. A Amazon valida sem aplicar.
   - **200**: segue para o passo 1.
   - **403**: habilitar a permissão "Product Listing" no Developer Central e reautorizar as lojas (MundoFS e UDN) pelo card de Integrações. Só então segue.
2. **Endpoint** `POST /api/produtos/[id]/preco-amazon` (`requireRole(ADMIN)`; Zod com preço em centavos > 0):
   - chama o PATCH real com a credencial do tenant;
   - grava `AuditLog` `PRECO_AMAZON_ALTERADO` (antes/depois);
   - atualiza o cache `Produto.amazonPrecoListagemCentavos` para a tela refletir na hora.
3. **UI**: folha "Alterar preço na Amazon" (protótipo) com prévia do lucro por unidade e aviso de que leva alguns minutos para aparecer na loja.
   - **Trava de segurança**: variação acima de ±30% sobre o preço atual pede uma segunda confirmação ("Você está mudando de R$ 77,00 para R$ 7,70. Confirmar?").
4. **Quota**: o PATCH tem quota própria (5 rps). Usa `tryReserveAmazonOperationSlot` e mostra "tente de novo em instantes" em caso de cooldown.

**Estimativa:** 1 a 2 dias, depois da permissão liberada.

## 6b. Fase 5 (opcional, depois)
- **Alertas do sino por push**, como opt-in por aparelho (`receberAlertas`):
  - O gancho fica em `emitirNotificacao` (`src/lib/notificacoes.ts:27`) e só dispara quando a notificação é **criada** (não no upsert de atualização).
  - Respeita as preferências por tipo que já existem.
  - Exclui os tipos de operação (JOB_FALHANDO, QUOTA_BLOQUEADA).
- **Badge no ícone do app** (`navigator.setAppBadge`) com a contagem de não lidas.

## 7. Testes e validação
- **Unitários (vitest)**:
  - `filtrarPedidosNotificaveis` (recência, cancelado, corte de 2 h, agrupamento de mais de 3);
  - `montarPayloadVenda` (título com o nome da loja, valor com e sem `~`, sem valor, agrupado; **nunca** contém nome do produto, SKU ou quantidade);
  - lucro por unidade e prévia do "alterar custo/preço";
  - menu por usuário (abas travadas, chave ausente = tudo visível, PUT rejeita href desconhecido ou travado, um usuário não lê nem grava a chave de outro);
  - schema Zod de inscrição.
- **Rotas**:
  - o mesmo endpoint inscrito em duas empresas gera duas linhas, e cada venda vai só para a inscrição da própria loja;
  - o `DELETE` não remove aparelho de outro usuário;
  - o teste só envia para os aparelhos do próprio usuário.
- **Playwright**: novo project mobile (iPhone 13 e Pixel 7), cobrindo bottom nav, "Mais", dashboard sem scroll horizontal e `/manifest.webmanifest` e `/sw.js` com 200 sem sessão.
- **Checklist em aparelho real**:
  1. Android: instalar → ativar → teste → venda real com tela bloqueada → toque abre o pedido.
  2. iPhone: Safari → Adicionar à Tela de Início → logar → ativar → mesmos passos.
  3. Ativar na MundoFS e na UDN no mesmo celular → cada venda chega com o nome da loja certa.
  4. Sair escolhendo "Parar" → a próxima venda daquela loja não chega.
- **Deploy**:
  - migration manual (Postgres) + `prisma:migrate:deploy:pg` + `prisma:generate:pg`;
  - VAPID no `.env`;
  - `pm2 restart erp-web` e `pm2 restart erp-worker` (memória: reload deixa chunk velho).

## 8. Riscos
| Risco | Mitigação |
|---|---|
| iOS descarta push se o SW não exibir notificação | o `push` handler **sempre** chama `showNotification` |
| Rajada de pushes no backfill ou na primeira conexão | corte de 2 h por `PurchaseDate` + agrupamento acima de 3 + idempotência |
| Mensagem SQS chega antes do produto estar cadastrado (SKU novo) | o push sai com "~R$" do listing; sem preço nenhum, sai "Você teve uma nova venda." sem valor |
| Preço errado enviado à Amazon (dedo gordo) | prévia do lucro + segunda confirmação acima de ±30% + `AuditLog` com antes/depois |
| Push do SQS e do ORDERS_SYNC duplicados | `PushEnvio` com unique `[empresaId, venda:<orderId>]`: o segundo vira no-op |
| Computador compartilhado continua recebendo avisos depois de sair | o "Sair" pergunta, com padrão "Parar" fora do app instalado; dá para remover qualquer aparelho em "Seus aparelhos" |
| Perda das chaves VAPID | backup do `.env`; sem elas, os aparelhos só precisam reativar |
| Sessão expira no app instalado | o push continua chegando; o toque leva ao login e depois ao pedido |
| Dados velhos no app aberto há horas | sem cache no SW + invalidação ao voltar ao primeiro plano |

## 9. Decisões (resolvidas na revisão 2)
1. **Esconder ou apagar** → nenhum dos dois por padrão: cada usuário configura o próprio menu (§3).
2. **DRE e Publicidade** → ficam disponíveis; quem não usa desliga no próprio menu.
3. **UDN** → não é preciso decidir por ela, porque cada usuário configura o seu.
4. **Ainda em aberto, a confirmar no protótipo**:
   - quais 4 abas ficam travadas (proposta: Dashboard, Vendas, Produtos e Configurações);
   - se o menu personalizado deve valer também no desktop (proposta: sim, um menu só por usuário).

## 10. Ordem de entrega
Fase 1 (~1 d, deploy isolado) → Fase 2 (~3–4 d) → Fase 3 (~3–4 d) → Fase 4 (~1–2 d, depois da permissão de preço). Cada fase vai em uma branch e um PR próprios, saindo da trunk que a produção usa (`feat/multitenant-fase0-seguranca`, conferido na VPS em 06/10). Depois da aprovação do protótipo visual, o próximo passo é o plano de implementação detalhado (tarefas, arquivos e testes), uma fase por vez.
