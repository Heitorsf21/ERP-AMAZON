# Design — 6 frentes de melhoria do Atlas Seller

**Data:** 2026-06-01
**Branch atual:** `feat/multitenant-fase0-seguranca`
**Autor:** brainstorming Heitor + Claude

## Contexto e objetivo

O ERP tem abas pouco usadas e funções sem finalidade clara. Este trabalho cobre 6 frentes
independentes, validadas visualmente uma a uma com o usuário:

1. **Sino de notificações** (bug) — mostra a contagem mas o popover abre vazio.
2. **Genius Pro** (remoção) — aba de "sugestões" que ficou complexa demais.
3. **Expedição** (remoção) — picking FBM, não utilizada.
4. **Otimizador de Ads** (melhoria) — histórico de ações por produto + imagem do produto.
5. **Agenda / Tarefas** (melhoria) — visor funcional com calendário central + painel "A concluir" + tarefas recorrentes.
6. **Compras** (melhoria) — reorientar para histórico; tirar o mural de sugestões e levar a inteligência de reposição para o fluxo de "Novo pedido".

## Princípios gerais

- **Zero perda de dados.** Nenhum `DROP TABLE`. Remoções apagam código/menu/rotas, mas mantêm tabelas (decisão do usuário, alinhada ao gate multi-tenant).
- **Incremental, sem redesign radical.** Reaproveitar componentes e padrões existentes (`FiltroPeriodo`, `ProductThumb`, `MarginBadge`, padrão de recorrência de contas fixas, etc.).
- **Alertas só no sino.** Nada de e-mail/Slack. (Reforça a frente de Compras: o mural some, o WhatsApp continua sendo o canal de reposição.)
- **Dinheiro em centavos (`Int`). Fuso `America/Sao_Paulo`. Logger `pino`** (sem `console.log`).
- **Schema duplo** (SQLite local + Postgres prod): toda mudança Prisma vai em `prisma/schema.prisma` **e** `prisma/schema.postgresql.prisma`, com migration manual no Postgres (`prisma/migrations/<ts>_<nome>/migration.sql`, aplicada via `prisma:migrate:deploy:pg`). Só a Frente 5 (Agenda) mexe em schema.
- **Next.js 16:** `params` é `Promise` — sempre `await params`.

## Sequenciamento recomendado

Da menor à maior superfície de risco, permitindo entregas incrementais:

1. **Sino** (3 arquivos, bug). 2. **Remoções** Genius + Expedição (edição + delete de pastas, sem schema).
3. **Otimizador de Ads** (1 endpoint novo + UI). 4. **Compras** (UI + repo, sem schema).
5. **Agenda** (schema novo + recorrência + reescrita da view) — a maior, por último.

Cada frente é independente e pode virar um commit/PR próprio.

---

## Frente 1 — Sino de notificações (bug)

### Diagnóstico (causa-raiz)

- `notification-bell.tsx:53-58` faz `GET /api/notificacoes?naoLidas=true&limit=10` e tipa a resposta como `{ notificacoes: Notificacao[] }`.
- `src/app/api/notificacoes/route.ts:7-13` devolve **o array cru** (`ok(notificacoes)`), não `{ notificacoes }`. Logo `lista?.notificacoes` é sempre `undefined` → popover renderiza vazio.
- A **contagem** funciona porque vem de `/api/notificacoes/contar`, que devolve `{ total }` (shape que o sino espera) — por isso o número aparece.
- Bônus: `route.ts:11` lê `naoLidas` mas **nunca extrai `limit`**; `service.listar()` (`service.ts:193-198`) tem `take: 200` hardcoded.
- A página `/notificacoes` (`page.tsx:62-65`) consome o **array cru** — qualquer mudança no contrato do endpoint precisa atualizar a página junto.

### Isolamento multi-tenant (importante)

`Notificacao` está em `TENANT_MODELS` (`src/lib/db.ts:81`). A extensão de tenant injeta `where.empresaId` automaticamente quando `TENANT_ISOLATION=enforce`. **A correção NÃO deve adicionar filtro manual de `empresaId`** (seria redundante e pode conflitar). Deve apenas garantir que as queries continuem passando pela extensão (não usar client "raw" que burle o isolamento). Em produção, `TENANT_ISOLATION=enforce` deve estar ativo — fora do escopo de código desta frente, mas registrado como pré-condição.

### Mudança proposta

1. **`src/app/api/notificacoes/route.ts`** — extrair `limit` dos searchParams (parse seguro, default 50, clamp 1..200), passar para o service, e **padronizar a resposta para `{ notificacoes }`**.
2. **`src/modules/notificacoes/service.ts`** — `listar(soNaoLidas?: boolean, limit?: number)` usa `take: limit ?? 50` em vez do `200` fixo.
3. **`src/app/notificacoes/page.tsx`** — ajustar o `queryFn` para ler `.notificacoes` do novo shape (alinha página + sino no mesmo contrato).

Tudo numa única mudança (página + endpoint juntos, senão o sino quebra). Sem novos arquivos.

### Validação

- Popover abre com até 10 não-lidas. Contagem bate com a lista. Página `/notificacoes` continua listando. `npx tsc --noEmit` limpo nos 3 arquivos.

---

## Frente 2 — Remoção do Genius Pro

Feature isolada (~700 linhas), sem modelos Prisma exclusivos, sem referências cruzadas.

### Mudança proposta

- **Editar `src/components/nav-routes.ts`** — remover o item `Genius Pro` (`/genius`) do grupo `ecommerce` (linhas ~165-169). `CommandPalette` deriva de `NAV_GROUPS` → some automaticamente.
- **Deletar `src/app/genius/`** (página) e **`src/app/api/genius/`** (rota `sugestoes`).
- Modelos consultados pela rota (`Produto`, `AmazonReimbursement`, `AmazonReturn`, `BuyBoxSnapshot`, `AmazonAdsMetricaDiaria`) são compartilhados → **permanecem**.

### Validação

- Sidebar e Ctrl+K sem "Genius Pro". `/genius` retorna 404. `npm run build` compila (sem typedRoutes apontando para a rota removida — verificado: não há links).

---

## Frente 3 — Remoção da Expedição (mantendo dados)

### Mudança proposta

- **Editar `src/components/nav-routes.ts`** — remover item `Expedicao` (`/expedicao`) do grupo `ecommerce` (linhas ~147-150).
- **Editar `src/proxy.ts`** — remover os prefixos `/expedicao` e `/api/expedicao` de `OPERATOR_PATH_PREFIXES` (linhas ~60 e ~66).
- **Deletar** `src/app/expedicao/`, `src/app/api/expedicao/` (todas as rotas FBM picking) e `src/modules/expedicao/fbm-picking.ts`.
- **MANTER** os modelos `FbmPickingBatch` e `FbmPickingItem` em ambos os schemas (`prisma/schema.prisma` ~1085-1127 e o `.postgresql.prisma`) — ficam órfãos, sem FK quebrado, dados preservados. **Sem migration.**
- **MANTER** `StatusFbmPicking`, `StatusFbmPickingItem` e `TipoAuditLog.FBM_PICKING_*` em `src/modules/shared/domain.ts` (mantém histórico de auditoria íntegro).

### Notas

- Role `OPERADOR` continua existindo e válido em outras rotas; só perde o acesso à Expedição (que não existe mais).
- Reversível 100% via git (código) — tabelas nunca foram tocadas.

### Validação

- Sidebar e Ctrl+K sem "Expedição". `/expedicao` retorna 404. `npm run build` compila. `npx prisma validate` ok (modelos órfãos são válidos).

---

## Frente 4 — Otimizador de Ads: histórico por SKU + imagem do produto

### O que já existe

- UI em `src/app/publicidade/otimizador/page.tsx`: cards por SKU (`SkuGroupCard`) com abas **"Ajustes existentes"** / **"Oportunidades de termos"**.
- O histórico **já é gravado**: `AdsOptimizationRecommendation` guarda `status`, `aprovadoEm/aprovadoPorEmail`, `rejeitadoEm/rejeitadoPorEmail`, `executadoEm`, `proposedBidCentavos/approvedBidCentavos`, `motivo`, `risco`, `confianca`, `metrics{7d,30d,lifetime}Json`, `staleReason`, `errorMessage`; `AdsOptimizationExecutionLog` (1-N) guarda tentativas de aplicar na Amazon.
- `getSnapshot()` (`service.ts:290-422`) retorna **apenas** `status ∈ {PROPOSED, APPROVED, FAILED}` (ativas). REJECTED/APPLIED/STALE ficam de fora → é exatamente o material do histórico.
- Imagem: `resolverImagemProduto(amazonImagemUrl, asin, imagemUrlManual?)` (`amazon-images.ts`) + `ProductThumb` (`product-thumb.tsx`, sizes 32/40/48/56). `Produto` tem `imagemUrl/amazonImagemUrl/asin`, lookup por `sku`.

### Decisões (validadas com o usuário)

- **Opção A:** o histórico é uma **3ª aba "Histórico" dentro do `SkuGroupCard`** (não gaveta, não página global).
- **Imagem do produto** no cabeçalho do card (à esquerda do SKU), `ProductThumb` size 56.
- **Faixa "Última ação neste SKU"** logo abaixo do cabeçalho (ex: "você aprovou um aumento de lance há 3 dias — aplicada").
- **Histórico por produto apenas** (sem visão global).
- Cada entrada do histórico é uma **linha recolhida**; ao expandir mostra a cadeia completa:
  **Proposta do sistema** (ação + `currentBid→proposedBid` + severidade + confiança) → **Por quê** (`motivo`) → **Risco** (`risco`) → **Métricas no momento** (7d/30d) → **Sua decisão** (aprovou/rejeitou + lance final, indicando se ajustou, + quem + quando) → **Resultado** (aplicada/falhou + `errorMessage` do `ExecutionLog`).

### Mudança proposta

**Backend — novo endpoint** `GET /api/ads/optimizer/history?sku=<sku>&limit=50&offset=0`:
- Retorna `AdsOptimizationRecommendation` com `status ≠ PROPOSED` do SKU, ordenado por `criadoEm desc`, paginado (default 50), incluindo as `execucoes` (`AdsOptimizationExecutionLog`).
- Shape: `{ sku, total, history: [{ id, status, displayLabel, entityType, actionType, severity, confianca, motivo, risco, currentBidCentavos, proposedBidCentavos, approvedBidCentavos, metrics7d, metrics30d, criadoEm, aprovadoEm, aprovadoPorEmail, rejeitadoEm, rejeitadoPorEmail, executadoEm, staleReason, errorMessage, execucoes: [{ status, errorMessage, executadoEm, executadoPorEmail }] }] }`.
- Implementar a query em `ads-optimizer/service.ts` (ex: `getHistoryBySku(sku, {limit, offset})`), reaproveitando os parsers de métricas já existentes.
- **Faixa "última ação"**: derivável do 1º item do histórico — pode vir no mesmo payload (`ultimaAcao`) ou ser o `history[0]`.

**Frontend — `page.tsx`:**
- `SkuGroupCard`: adicionar `ProductThumb` (size 56) no cabeçalho. Resolver imagem via lookup `Produto` por `sku` **em batch** no nível da página (`db.produto.findMany({ where: { sku: { in: skus } } })` exposto por um endpoint/loader, ou incluir `imagemUrl/amazonImagemUrl` no payload do snapshot — preferir **incluir no snapshot** para evitar request extra).
- `SkuGroupCard`: 3ª aba **"Histórico"** que dispara o fetch `/history?sku=` (lazy, só quando a aba abre) e renderiza a timeline com entradas expansíveis (componente novo `HistoricoSku` / `HistoricoEntry`).
- Faixa "última ação" entre o cabeçalho e as abas.

**Decisão de eficiência:** incluir `imagemUrl`/`amazonImagemUrl`/`asin` no payload do `getSnapshot()` (lookup batch por SKU lá no service) evita N requests no front e é o caminho mais simples. O `/history` continua sob demanda por aba.

### Riscos / cuidados

- Histórico pode crescer (otimização roda várias vezes/dia) → paginação obrigatória (default 50).
- `ExecutionLog` é 1-N: o erro real fica em `execucoes[].errorMessage`.
- `ProductThumb` já trata placeholder (`naturalWidth < 50`) e fallback `ImageOff`.

### Validação

- Aba "Histórico" lista ações passadas do SKU com detalhe expandido correto. Imagem aparece (ou fallback). Faixa "última ação" reflete a entrada mais recente. `npx tsc --noEmit` + `npx eslint` nos arquivos tocados.

---

## Frente 5 — Agenda: calendário central + painel "A concluir" + tarefas recorrentes

A maior frente. Mexe em schema (Tarefa + novo `TarefaRecorrente`), no agregador da agenda e reescreve a view.

### Decisões (validadas com o usuário)

- **Layout:** calendário **grande à esquerda** (peça principal) com toggle **Dia · Semana · Mês** nele mesmo; **painel "A concluir" fixo à direita** (sempre visível, não é aba).
- **Visão padrão ao abrir:** calendário em **Semana**.
- **Painel "A concluir":** buckets por urgência — **Atrasadas → Hoje → Esta semana → Sem prazo** — independentes do modo do calendário. Concluir com 1 clique. Filtros Empresa/Pessoais/Minhas continuam.
- **Tarefas recorrentes entram agora.** Tipos: **Diária · Semanal** (escolhe os dias) **· Mensal** (dia do mês) **· Personalizada** (a cada N dias/semanas). **Término:** Nunca · Em uma data · Após N ocorrências.
- Cada ocorrência é uma **tarefa real e independente** (concluir uma não conclui as outras). **Editar o molde com "aplicar às futuras"** atualiza as ocorrências futuras ainda em aberto — **espelhando o padrão de contas fixas** (`sincronizarOcorrenciasFuturas`), nunca tocando em CONCLUÍDA.

### Schema (ambos os schemas + migration Postgres manual)

**Novo modelo `TarefaRecorrente`** (molde):
- `id, empresaId?, titulo, descricao?, visibilidade (EMPRESA|PESSOAL, default EMPRESA), responsavelId?`
- `tipoRecorrencia (DIARIA|SEMANAL|MENSAL|PERSONALIZADA)`
- `diasSemana` (JSON `[0..6]`, usado em SEMANAL), `diaMes` (1..31, MENSAL), `intervalo` (default 1, PERSONALIZADA / "a cada N")
- `unidadeIntervalo (DIAS|SEMANAS, para PERSONALIZADA)`
- `tipoTermino (NUNCA|DATA|N_VEZES, default NUNCA)`, `terminoAte (DateTime?)`, `terminoMaxVezes (Int?)`
- `inicioEm (DateTime)` — data-base da série
- `ativa (Boolean default true)`, `deletedAt?`, `createdAt`, `updatedAt`
- Relações: `responsavel Usuario?`, `ocorrencias Tarefa[]`

**Estender `Tarefa`:**
- `tarefaRecorrenteId (String?)`, `indiceOcorrencia (Int?)` (sequencial, só p/ idempotência), `dataPlanejada (DateTime?)`
- Relação `tarefaRecorrente TarefaRecorrente?` + `@@unique([tarefaRecorrenteId, indiceOcorrencia])`

### Backend

- **Novo módulo puro `src/modules/tarefas/recorrencia.ts`** (espelha `contas-fixas/recorrencia.ts`): `planejarOcorrenciasTarefas(molde, de, ate, jaExistentes)` → `OcorrenciaPlanejadaTarefa[]` (`{ tarefaRecorrenteId, indiceOcorrencia, dataPlanejada }`). Itera datas conforme o tipo, respeita `termino`, usa `America/Sao_Paulo`. **Função pura, testável.**
- **`tarefas/service.ts`**: `garantirOcorrenciasTarefas({ de, ate })` idempotente — **clamp 400 dias** (anti-DoS, roda em GET), set de existentes + tratamento de `P2002` (unique). Cria `Tarefa` com `prazo = dataPlanejada`, `status = ABERTA`, `tarefaRecorrenteId`/`indiceOcorrencia` preenchidos, **forçando `responsavelId` e `visibilidade` do molde** (anti-IDOR para PESSOAL). Também `sincronizarOcorrenciasFuturasTarefas()` (espelha contas fixas): ao editar o molde com `aplicarFuturas`, atualiza ocorrências futuras **em aberto** (título/descrição/datas), soft-delete das que saíram do plano, **nunca toca CONCLUÍDA**.
- **`tarefas/repository.ts`**: `listarRecorrentesAtivasParaMaterializar()`, `ocorrenciasMaterializadas(...)`, CRUD de `TarefaRecorrente`.
- **`agenda/service.ts`** (`listarPorPeriodo`): chamar `garantirOcorrenciasTarefas({de,ate})` **junto** com o `garantirOcorrencias()` das contas fixas, antes de agregar em `AgendaItem[]`. As ocorrências já viram `Tarefa` normal → entram na agregação existente sem novo tipo.
- **Painel "A concluir":** precisa de itens **independentes do período do calendário** (atrasadas podem ser de antes da semana; backlog é sem prazo). Estratégia: o front faz uma 2ª query a `/api/agenda` com `status=ABERTA,VENCIDA` numa janela ampla (ex: `[hoje-90d, hoje+30d]`) + backlog, e agrupa no client nos buckets (Atrasadas/Hoje/Esta semana/Sem prazo). Sem novo endpoint — reusa `/api/agenda` com filtros.
- **Endpoints novos** `src/app/api/tarefas-recorrentes/route.ts` (GET/POST) e `/[id]/route.ts` (PATCH/DELETE=desativar) — `requireSession`; PESSOAL força `responsavelId = session.uid` (mesma regra de `tarefas`).

### Frontend

- Reescrever `src/components/agenda/agenda-view.tsx` para o layout de 2 colunas:
  - **Esquerda (calendário):** segmented `Dia · Semana · Mês` (default Semana) + navegação. Sub-views: `dia` (lista/timeline do dia), `semana` (grid 7 colunas Seg–Dom com itens empilhados, hoje destacado), `mes` (o grid atual). Extrair em `src/components/agenda/visoes/{dia,semana,mes}-view.tsx` para manter arquivos focados.
  - **Direita (painel fixo):** `src/components/agenda/painel-a-concluir.tsx` — buckets por urgência, concluir/abrir, criar tarefa rápida.
- **Recorrência na criação:** estender `dialog-tarefa.tsx` (ou novo `dialog-tarefa-recorrente.tsx`) com o bloco **"Repetir"** (Não repete / Diária / Semanal+dias / Mensal+dia / Personalizada+intervalo) e **"Termina"** (Nunca / Em uma data / Após N). Salvar molde via `/api/tarefas-recorrentes`. Editar molde oferece "aplicar às futuras".

### Riscos / cuidados

- **Visibilidade PESSOAL:** materialização e `listarParaAgenda` devem manter `orVisibilidadeTarefa` (PESSOAL só do dono). Testar.
- **Clamp 400 dias** compartilhado com o conceito de contas fixas — suficiente para o caso de uso.
- **Hora do prazo:** usar meio-dia local/UTC consistente com o agrupamento `yyyy-MM-dd` em SP já usado.
- **Migração Postgres manual** (usuário `erp_amazon` sem shadow DB): criar `migration.sql` à mão.

### Validação

- Testes unitários de `recorrencia.ts` (datas por tipo + término) e de `garantirOcorrenciasTarefas` (idempotência). Visões Dia/Semana/Mês renderizam; painel "A concluir" agrupa correto; criar tarefa recorrente gera ocorrências; editar molde propaga às futuras em aberto e preserva concluídas. `npx vitest run` nos novos testes, `tsc`, `eslint`.

---

## Frente 6 — Compras: histórico funcional + reposição no "Novo pedido"

### O que já existe

- `src/app/compras/page.tsx`: `<SugestoesReposicao />` (mural, o ruído) + `<ListaPedidos />` (tabela com abas de status). Sem KPIs nem filtros.
- `compras/service.ts`: `sugestoes()` (`:137-226`) calcula `qtdSugerida/diasEstoque/statusReposicao` (OK/ATENCAO/REPOR) a partir de vendas 30d, cobertura 60d, `estoqueMinimo`; `totais()` (`:228-230`) → `{ rascunho, confirmado, totalComprometidoCentavos }`; `confirmar`/`receber`.
- Ciclo do pedido funciona: RASCUNHO → CONFIRMADO (cria `ContaPagar`) → RECEBIDO (cria `MovimentacaoEstoque`). Detalhe em `compras/[id]/page.tsx` (sem timeline visual).
- Reusáveis: `FiltroPeriodo` + `src/lib/periodo.ts`; `ProductThumb`; `BadgeStatusPedido`.

### Decisões (validadas com o usuário)

- **Opção B:** **remover o mural diário** e levar a inteligência de reposição para o fluxo **"Novo pedido"** (cobertura + quantidade sugerida por produto, com botão discreto "Sugerir reposição"). O alerta diário continua **só no WhatsApp**.
- Aba Compras vira **histórico funcional**: KPIs + filtro de período + fornecedor + busca + abas de status + lista enriquecida.
- **Miniaturas dos produtos** em cada pedido.
- **Detalhe do pedido com timeline** (emitido → confirmado → recebido).

### Regras de negócio dos KPIs (locked)

- **Comprado no período** = soma `totalCentavos` dos pedidos com `dataEmissao` no período.
- **A receber** = soma dos `CONFIRMADO` com `dataRecebimento` nula (e não CANCELADO).
- **Rascunhos** = contagem de `RASCUNHO`.
- **Ticket médio** = comprado no período ÷ nº de pedidos do período (guarda contra divisão por zero → "—").

### Mudança proposta

**Backend:**
- `comprasRepository.totais(periodo?: {de, ate})` → `{ compradoNoPeriodoCentavos, aReceberCentavos, rascunho, ticketMedioCentavos }` (agrupando por `dataEmissao` / `dataRecebimento`). `comprasService.totais` repassa o período.
- `comprasRepository.listar(filtros)` aceita `{ status?, de?, ate?, fornecedorId? }` (filtra `dataEmissao` entre de/ate).
- `GET /api/compras/totais?de=&ate=` e `GET /api/compras?de=&ate=&fornecedor=&status=` passam a aceitar os filtros (validar via `resolverPeriodo`).
- A lógica de `sugestoes()` **permanece** no service (não é apagada) — passa a alimentar o "Novo pedido".

**Frontend:**
- `src/app/compras/page.tsx`: **remover `<SugestoesReposicao />`**; adicionar `<ComprasKpiCards />` (4 cards, bordas coloridas no padrão do app), `FiltroPeriodo` + select de fornecedor + busca; passar `{periodo, fornecedorId, busca}` para `<ListaPedidos />`.
- `lista-pedidos.tsx`: receber filtros (queryKey inclui período/fornecedor), adicionar `ProductThumb` das miniaturas dos itens + coluna "Previsão".
- `src/app/compras/novo/page.tsx`: seção colapsável **"Sugerir reposição"** que chama a lógica de `sugestoes()` (produtos em REPOR/ATENCAO), com seleção → auto-preenche linhas da tabela de itens com `qtdSugerida`.
- `src/app/compras/[id]/page.tsx`: **timeline** (emitido → confirmado → recebido) com datas reais (`timeline-pedido.tsx`).
- O componente `sugestoes-reposicao.tsx` antigo é descontinuado da page; sua lógica de apresentação é reaproveitada no novo `sugestor-reposicao.tsx` (dentro do fluxo Novo pedido). O endpoint `/api/compras/sugestoes` pode ser mantido (consumido pelo novo sugestor).

### Riscos / cuidados

- Não perder a visão de itens críticos: a inteligência migra para o Novo pedido (e o WhatsApp segue ativo).
- `queryKey` da lista deve incluir período + fornecedor + status (cache correto).
- Índices em `dataEmissao`/`dataRecebimento` se o período custom ficar lento (avaliar; provavelmente desnecessário no volume atual).

### Validação

- Page sem mural; KPIs corretos por período; filtros funcionam; miniaturas aparecem; "Novo pedido" sugere reposição e preenche itens; timeline do detalhe correta. `tsc` + `eslint` nos arquivos tocados.

---

## Fora de escopo (YAGNI)

- Histórico **global** do Otimizador de Ads (só por produto).
- Drop das tabelas `FbmPicking*` (mantidas por decisão).
- Sincronização de ocorrências **passadas** de tarefas recorrentes (só futuras em aberto, como contas fixas).
- Múltiplos responsáveis por tarefa (segue 1:1).
- Reescrita visual de áreas não citadas.

## Testes e validação (resumo)

- **Só no que mudou:** `npx eslint <arquivo>`, `npx tsc --noEmit`, `npx vitest run <arquivo>`.
- `npm run build` apenas antes de deploy.
- Frente 5 exige `prisma:generate` + `prisma:push` (dev SQLite) e migration manual no Postgres.
- Validação manual no app rodando (`npm run dev`) por frente.
