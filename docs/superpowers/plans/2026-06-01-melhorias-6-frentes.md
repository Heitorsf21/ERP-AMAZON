# Melhorias 6 frentes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Corrigir o sino de notificações, remover Genius Pro e Expedição, e melhorar Otimizador de Ads, Agenda e Compras — conforme `docs/superpowers/specs/2026-06-01-melhorias-6-frentes-design.md`.

**Architecture:** 5 fases independentes e commitáveis, em ordem de risco crescente. Reusa padrões existentes (FiltroPeriodo, ProductThumb, recorrência das contas fixas, isolamento de tenant do Prisma). Só a Fase 5 (Agenda) mexe em schema.

**Tech Stack:** Next.js 16 App Router · TypeScript · Prisma 5 (schema duplo SQLite/Postgres) · React 18 · @tanstack/react-query · vitest · pino · lucide-react · Radix.

**Branch:** `feat/melhorias-ux-6-frentes` (já criada; spec já commitado).

**Convenções de validação por tarefa:** `npx tsc --noEmit` + `npx eslint <arquivos>`; testes de lógica pura com `npx vitest run <arquivo>`. `npm run build` só ao final de tudo.

---

## Fase 1 — Sino de notificações (bug do popover)

**Causa-raiz:** `/api/notificacoes` devolve array cru; o sino espera `{ notificacoes: [...] }` → popover vazio. Também ignora `limit`. Isolamento por empresa já é feito pela extensão de tenant (`Notificacao` ∈ `TENANT_MODELS` em `src/lib/db.ts`) — **não adicionar filtro manual**.

**Files:**
- Modify: `src/modules/notificacoes/service.ts` (método `listar`)
- Modify: `src/app/api/notificacoes/route.ts` (GET)
- Modify: `src/app/notificacoes/page.tsx` (queryFn)

### Task 1.1: Aceitar `limit` no service

- [ ] **Step 1: Ler o método atual.** Abrir `src/modules/notificacoes/service.ts` em volta da linha 193 (`listar`). Confirmar assinatura atual `listar(soNaoLidas?: boolean)` com `take: 200` fixo.

- [ ] **Step 2: Editar a assinatura para aceitar `limit`.**

```ts
async listar(soNaoLidas?: boolean, limit?: number) {
  const take = Math.min(Math.max(limit ?? 50, 1), 200);
  return db.notificacao.findMany({
    where: soNaoLidas ? { lida: false } : undefined,
    orderBy: { criadaEm: "desc" },
    take,
  });
}
```
(Manter o restante do método igual; não adicionar `where.empresaId` — a extensão de tenant injeta.)

- [ ] **Step 3: Typecheck.** Run: `npx tsc --noEmit`. Expected: sem erros novos.

### Task 1.2: Endpoint devolve `{ notificacoes }` e respeita `limit`

- [ ] **Step 1: Editar `src/app/api/notificacoes/route.ts`.** No GET, extrair `naoLidas` e `limit`, repassar ao service, e empacotar a resposta:

```ts
const { searchParams } = new URL(req.url);
const soNaoLidas = searchParams.get("naoLidas") === "true";
const limitRaw = Number(searchParams.get("limit"));
const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? limitRaw : undefined;
const notificacoes = await notificacaoService.listar(soNaoLidas, limit);
return ok({ notificacoes });
```
(Ajustar os nomes `req`/helper `ok` ao que o arquivo já usa.)

- [ ] **Step 2: Typecheck.** Run: `npx tsc --noEmit`. Expected: sem erros.

### Task 1.3: Página `/notificacoes` lê o novo shape

- [ ] **Step 1: Editar `src/app/notificacoes/page.tsx`** (linha ~62-65). Ajustar o `queryFn` para extrair `.notificacoes`:

```ts
queryFn: () =>
  fetchJSON<{ notificacoes: Notificacao[] }>("/api/notificacoes").then((r) => r.notificacoes),
```
(Manter o tipo do `useQuery` como `Notificacao[]`.)

- [ ] **Step 2: Typecheck + lint.** Run: `npx tsc --noEmit` e `npx eslint src/app/notificacoes/page.tsx src/app/api/notificacoes/route.ts src/modules/notificacoes/service.ts`. Expected: limpo.

- [ ] **Step 3: Validação manual.** Com `npm run dev`, abrir o sino: popover lista até 10 não-lidas e o número bate. Página `/notificacoes` continua listando.

- [ ] **Step 4: Commit.**

```bash
git add src/app/api/notificacoes/route.ts src/modules/notificacoes/service.ts src/app/notificacoes/page.tsx
git commit -m "fix(notificacoes): popover do sino lista notificacoes (contrato { notificacoes } + limit)"
```

---

## Fase 2 — Remoção de Genius Pro e Expedição (mantendo tabelas)

**Files:**
- Modify: `src/components/nav-routes.ts` (remover 2 itens de menu)
- Modify: `src/proxy.ts` (remover 2 prefixos)
- Delete: `src/app/genius/`, `src/app/api/genius/`, `src/app/expedicao/`, `src/app/api/expedicao/`, `src/modules/expedicao/`
- Keep (NÃO tocar): modelos `FbmPickingBatch`/`FbmPickingItem` nos schemas; `Status*Fbm*`/`TipoAuditLog.FBM_*` em `src/modules/shared/domain.ts`

### Task 2.1: Remover itens de menu

- [ ] **Step 1:** Abrir `src/components/nav-routes.ts`. Localizar e **remover** o objeto do item `Expedicao` (href `/expedicao`) e o do item `Genius Pro` (href `/genius`) dentro do grupo `ecommerce`. Remover também os imports de ícones que ficarem órfãos (ex: `Sparkles` se só o Genius usava; conferir antes de remover o import).

- [ ] **Step 2: Typecheck.** Run: `npx tsc --noEmit`. Expected: sem erro de import não usado/usado.

### Task 2.2: Remover prefixos de autorização

- [ ] **Step 1:** Abrir `src/proxy.ts`. Em `OPERATOR_PATH_PREFIXES`, remover as entradas `"/expedicao"` e `"/api/expedicao"`.

- [ ] **Step 2: Typecheck.** Run: `npx tsc --noEmit`. Expected: limpo.

### Task 2.3: Deletar pastas de código

- [ ] **Step 1: Deletar as pastas.** (PowerShell)

```powershell
Remove-Item -Recurse -Force src/app/genius, src/app/api/genius, src/app/expedicao, src/app/api/expedicao, src/modules/expedicao
```

- [ ] **Step 2: Buscar referências órfãs.** Run (Grep): procurar `"/genius"`, `"/expedicao"`, `expedicao/fbm-picking`, `genius/sugestoes` em `src/`. Expected: nenhuma referência fora das pastas removidas (command palette deriva de NAV_GROUPS).

- [ ] **Step 3: Validar Prisma intacto.** Run: `npx prisma validate`. Expected: válido (modelos FbmPicking* órfãos continuam válidos).

- [ ] **Step 4: Build de fumaça.** Run: `npm run build`. Expected: compila sem rota `/genius` nem `/expedicao` (typedRoutes não quebra — não há Links).

- [ ] **Step 5: Commit.**

```bash
git add -A
git commit -m "chore: remove abas Genius Pro e Expedicao (mantem tabelas FbmPicking)"
```

---

## Fase 3 — Otimizador de Ads: histórico por SKU + imagem do produto

**Files:**
- Modify: `src/modules/ads-optimizer/service.ts` (incluir imagem no snapshot + novo `getHistoryBySku`)
- Create: `src/app/api/ads/optimizer/history/route.ts`
- Modify: `src/app/publicidade/otimizador/page.tsx` (imagem no card, faixa "última ação", aba "Histórico")

**Decisões:** Opção A (aba "Histórico" no card), imagem (ProductThumb 56) no cabeçalho, faixa "última ação", entradas expansíveis, só por produto.

### Task 3.1: Incluir imagem do produto no snapshot

- [ ] **Step 1: Ler `getSnapshot` em `src/modules/ads-optimizer/service.ts`** (~290-422). Identificar onde monta os `recommendations` e de onde sai `sku`/`asin`.

- [ ] **Step 2: Carregar produtos por SKU (batch) e anexar imagem.** Após coletar os SKUs distintos das recomendações, antes de retornar:

```ts
const skus = [...new Set(recomendacoes.map((r) => r.sku).filter(Boolean))] as string[];
const produtos = skus.length
  ? await db.produto.findMany({
      where: { sku: { in: skus } },
      select: { sku: true, imagemUrl: true, amazonImagemUrl: true, asin: true },
    })
  : [];
const imagemPorSku = new Map(produtos.map((p) => [p.sku, p]));
```
Incluir no objeto de cada recomendação (ou no grupo) `imagemUrl`, `amazonImagemUrl`, `asin` resolvidos por `sku`. Exportar esses campos no shape do snapshot.

- [ ] **Step 3: Refletir no tipo do front.** Em `page.tsx`, adicionar ao tipo `Recommendation` (ou ao grupo) os campos `imagemUrl?: string | null; amazonImagemUrl?: string | null` (asin já existe).

- [ ] **Step 4: Typecheck.** Run: `npx tsc --noEmit`. Expected: limpo.

### Task 3.2: Mostrar imagem no cabeçalho do `SkuGroupCard`

- [ ] **Step 1:** Em `page.tsx`, importar `ProductThumb` (`@/components/ui/product-thumb`) e `resolverImagemProduto` (`@/lib/amazon-images`). No cabeçalho do `SkuGroupCard` (à esquerda do bloco do SKU), renderizar:

```tsx
<ProductThumb
  src={resolverImagemProduto(group.amazonImagemUrl ?? null, group.asin ?? null, group.imagemUrl ?? null)}
  alt={group.sku}
  size={56}
/>
```
(O `group` precisa carregar `imagemUrl/amazonImagemUrl/asin` — pegar do 1º item do grupo em `groupRecommendations`.)

- [ ] **Step 2:** Em `groupRecommendations`, propagar `imagemUrl`/`amazonImagemUrl` para o objeto de grupo (como já faz com `asin`).

- [ ] **Step 3: Typecheck + lint.** Run: `npx tsc --noEmit` e `npx eslint src/app/publicidade/otimizador/page.tsx`. Expected: limpo.

### Task 3.3: Endpoint de histórico por SKU

- [ ] **Step 1: Adicionar `getHistoryBySku` em `src/modules/ads-optimizer/service.ts`.**

```ts
async getHistoryBySku(sku: string, opts?: { limit?: number; offset?: number }) {
  const take = Math.min(Math.max(opts?.limit ?? 50, 1), 100);
  const skip = Math.max(opts?.offset ?? 0, 0);
  const where = { sku, status: { not: "PROPOSED" } };
  const [total, rows] = await Promise.all([
    db.adsOptimizationRecommendation.count({ where }),
    db.adsOptimizationRecommendation.findMany({
      where,
      orderBy: { criadoEm: "desc" },
      take,
      skip,
      include: { execucoes: { orderBy: { executadoEm: "desc" } } },
    }),
  ]);
  return {
    sku,
    total,
    history: rows.map((r) => ({
      id: r.id,
      status: r.status,
      displayLabel: r.searchTerm ?? r.keywordId ?? r.targetId ?? r.entityId,
      entityType: r.entityType,
      actionType: r.actionType,
      severity: r.severity,
      confianca: r.confianca,
      motivo: r.motivo,
      risco: r.risco,
      currentBidCentavos: r.currentBidCentavos,
      proposedBidCentavos: r.proposedBidCentavos,
      approvedBidCentavos: (r as { approvedBidCentavos?: number | null }).approvedBidCentavos ?? null,
      metrics7d: parseMetrics(r.metrics7dJson),
      metrics30d: parseMetrics(r.metrics30dJson),
      criadoEm: r.criadoEm,
      aprovadoEm: r.aprovadoEm,
      aprovadoPorEmail: r.aprovadoPorEmail,
      rejeitadoEm: r.rejeitadoEm,
      rejeitadoPorEmail: r.rejeitadoPorEmail,
      executadoEm: r.executadoEm,
      staleReason: r.staleReason,
      errorMessage: r.errorMessage,
      execucoes: r.execucoes.map((e) => ({
        status: e.status,
        errorMessage: e.errorMessage,
        executadoEm: e.executadoEm,
        executadoPorEmail: e.executadoPorEmail,
      })),
    })),
  };
}
```
(Reusar o helper de parse de métricas já existente no service — confirmar o nome; se for privado, replicar a desserialização usada em `getSnapshot`.)

- [ ] **Step 2: Criar `src/app/api/ads/optimizer/history/route.ts`.**

```ts
import { NextRequest } from "next/server";
import { requireSession } from "@/lib/auth"; // usar o helper de auth já usado nos outros endpoints de ads
import { ok, badRequest } from "@/lib/http"; // ajustar aos helpers reais do projeto
import { adsOptimizerService } from "@/modules/ads-optimizer/service";

export async function GET(req: NextRequest) {
  await requireSession();
  const { searchParams } = new URL(req.url);
  const sku = searchParams.get("sku");
  if (!sku) return badRequest("sku obrigatorio");
  const limit = Number(searchParams.get("limit")) || undefined;
  const offset = Number(searchParams.get("offset")) || undefined;
  const data = await adsOptimizerService.getHistoryBySku(sku, { limit, offset });
  return ok(data);
}
```
(Confirmar como os outros endpoints em `src/app/api/ads/optimizer/*` importam auth/helpers e espelhar.)

- [ ] **Step 3: Typecheck.** Run: `npx tsc --noEmit`. Expected: limpo.

### Task 3.4: Aba "Histórico" + faixa "última ação" no card

- [ ] **Step 1: Adicionar a 3ª aba.** No `SkuGroupCard` (`page.tsx`), adicionar `<TabsTrigger value="history">Histórico</TabsTrigger>` e um `<TabsContent value="history">` que renderiza `<HistoricoSku sku={group.sku} />`.

- [ ] **Step 2: Componente `HistoricoSku`** (no mesmo arquivo ou `src/components/ads/historico-sku.tsx`). Faz `useQuery` lazy (`enabled` quando a aba abre) em `/api/ads/optimizer/history?sku=`. Renderiza timeline de entradas recolhidas; cada uma expande (estado local) mostrando: Proposta (`ACTION_LABEL[actionType]` + `currentBid→proposedBid` via `formatBRL` + severidade + `confianca%`), Por quê (`motivo`), Risco (`risco`), Métricas no momento (`metrics7d`/`metrics30d`), Sua decisão (aprovado/rejeitado + lance final `approvedBidCentavos ?? proposedBidCentavos` + email + data), Resultado (status + `execucoes[0]?.errorMessage`). Reusar `STATUS_LABEL`, `formatBRL`, `formatDateTime`, `formatPct` já no arquivo.

- [ ] **Step 3: Faixa "última ação".** Entre o cabeçalho e as `Tabs`, renderizar uma faixa quando houver histórico: usar o 1º item retornado pelo `/history` (ou um campo `ultimaAcao` adicionado ao snapshot). Texto: `"Última ação neste SKU: {acao} {humanizar(data)} — {statusLabel}"`. Para evitar request duplo, aceitável a faixa só aparecer após abrir a aba na 1ª versão; **preferível**: adicionar `ultimaAcaoPorSku` ao snapshot (1 query agregada por SKU do registro mais recente status≠PROPOSED). Implementar a faixa lendo esse campo do snapshot.

- [ ] **Step 4: Typecheck + lint.** Run: `npx tsc --noEmit` e `npx eslint` nos arquivos tocados. Expected: limpo.

- [ ] **Step 5: Validação manual.** Abrir um SKU com histórico: imagem no topo, faixa "última ação", aba "Histórico" lista e expande com os campos certos.

- [ ] **Step 6: Commit.**

```bash
git add src/modules/ads-optimizer/service.ts src/app/api/ads/optimizer/history src/app/publicidade/otimizador/page.tsx src/components/ads 2>$null
git commit -m "feat(ads-optimizer): historico por SKU + imagem do produto + faixa ultima acao"
```

---

## Fase 4 — Compras: histórico funcional + reposição no "Novo pedido"

**Files:**
- Modify: `src/modules/compras/repository.ts` (`totais(periodo?)`, `listar(filtros)`)
- Modify: `src/modules/compras/service.ts` (repassar período/filtros)
- Modify: `src/app/api/compras/totais/route.ts` e `src/app/api/compras/route.ts` (aceitar filtros)
- Modify: `src/app/compras/page.tsx` (remover mural, KPIs, filtros)
- Modify: `src/components/compras/lista-pedidos.tsx` (filtros + miniaturas)
- Create: `src/components/compras/kpi-cards.tsx`, `src/components/compras/timeline-pedido.tsx`, `src/components/compras/sugestor-reposicao.tsx`
- Modify: `src/app/compras/novo/page.tsx` (sugestor de reposição)
- Modify: `src/app/compras/[id]/page.tsx` (timeline)

**Regras KPI (locked):** Comprado = Σ `totalCentavos` por `dataEmissao` no período · A receber = Σ CONFIRMADO sem `dataRecebimento` · Rascunhos = count RASCUNHO · Ticket médio = comprado ÷ nº pedidos do período (guard /0 → "—").

### Task 4.1: Repository — totais por período + filtros na listagem

- [ ] **Step 1: Escrever teste de lógica de `totais`.** Criar `src/modules/compras/__tests__/totais.test.ts` (ou vizinho) cobrindo o cálculo dos 4 KPIs a partir de pedidos mock — se a função for testável de forma pura, extrair o cálculo para um helper puro `calcularTotaisCompras(pedidos, periodo)`; senão, marcar como teste de integração (skip se exigir DB). Preferir extrair helper puro:

```ts
// src/modules/compras/totais.ts (puro)
export type PedidoTotais = { totalCentavos: number; status: string; dataEmissao: Date; dataRecebimento: Date | null };
export function calcularTotaisCompras(pedidos: PedidoTotais[], de: Date, ate: Date) {
  const noPeriodo = pedidos.filter((p) => p.dataEmissao >= de && p.dataEmissao <= ate);
  const compradoNoPeriodoCentavos = noPeriodo.reduce((s, p) => s + p.totalCentavos, 0);
  const aReceberCentavos = pedidos
    .filter((p) => p.status === "CONFIRMADO" && p.dataRecebimento == null)
    .reduce((s, p) => s + p.totalCentavos, 0);
  const rascunho = pedidos.filter((p) => p.status === "RASCUNHO").length;
  const ticketMedioCentavos = noPeriodo.length ? Math.round(compradoNoPeriodoCentavos / noPeriodo.length) : null;
  return { compradoNoPeriodoCentavos, aReceberCentavos, rascunho, ticketMedioCentavos };
}
```

- [ ] **Step 2: Teste falhando.** Run: `npx vitest run src/modules/compras/totais.test.ts`. Expected: FAIL (função/arquivo ausente) → criar `totais.ts` → PASS.

- [ ] **Step 3: Repository usa o helper.** Em `repository.ts`, `totais(periodo?: {de: Date; ate: Date})` carrega os pedidos relevantes e chama `calcularTotaisCompras`. `listar(filtros: { status?; de?; ate?; fornecedorId? })` adiciona `where` por `dataEmissao` (range) e `fornecedorId`.

- [ ] **Step 4: Typecheck.** Run: `npx tsc --noEmit`. Expected: limpo.

### Task 4.2: Endpoints aceitam filtros

- [ ] **Step 1:** `src/app/api/compras/totais/route.ts`: ler `de`/`ate` (via `resolverPeriodo`), passar a `service.totais(periodo)`. `src/app/api/compras/route.ts` (GET): ler `status`, `de`, `ate`, `fornecedor` e repassar a `service.listar(filtros)`.

- [ ] **Step 2: Typecheck.** Run: `npx tsc --noEmit`. Expected: limpo.

### Task 4.3: KPIs + filtros na página, remover mural

- [ ] **Step 1: Criar `src/components/compras/kpi-cards.tsx`.** 4 cards (padrão de borda colorida do app): Comprado no período (azul), A receber (âmbar), Rascunhos (slate), Ticket médio (emerald). `useQuery(["compras-totais", periodoKey])` em `/api/compras/totais?de=&ate=`.

- [ ] **Step 2: Editar `src/app/compras/page.tsx`.** Remover `<SugestoesReposicao />` e sua `<section>`/import. Adicionar estado de período (default `TRINTA_DIAS`) + fornecedor; renderizar `<FiltroPeriodo>` + select de fornecedor + `<ComprasKpiCards periodo={...} />`; passar `periodo`/`fornecedorId` para `<ListaPedidos>`.

- [ ] **Step 3: Editar `src/components/compras/lista-pedidos.tsx`.** Receber props `{ periodo, fornecedorId }`; incluir no `queryKey` e na query string. Adicionar coluna "Previsão" (`dataPrevisao`) e miniaturas: para cada pedido, `<ProductThumb size={32}>` dos primeiros itens (já vem `itens` no payload; se faltar imagem, incluir `produto.imagemUrl/amazonImagemUrl/asin` no `select` do endpoint de listagem).

- [ ] **Step 4: Typecheck + lint.** Run: `npx tsc --noEmit` e `npx eslint` nos arquivos. Expected: limpo.

### Task 4.4: Timeline no detalhe do pedido

- [ ] **Step 1: Criar `src/components/compras/timeline-pedido.tsx`.** Recebe `{ status, dataEmissao, dataPrevisao, dataRecebimento, canceladoEm? }`. Renderiza 3 marcos (Emitido → Confirmado → Recebido) com check + data real; estado CANCELADO mostra marco vermelho.

- [ ] **Step 2: Inserir em `src/app/compras/[id]/page.tsx`** acima/junto dos info-cards. Lembrar Next 16: `const { id } = await params`.

- [ ] **Step 3: Typecheck + lint.** Expected: limpo.

### Task 4.5: Sugestor de reposição no "Novo pedido"

- [ ] **Step 1: Criar `src/components/compras/sugestor-reposicao.tsx`.** Seção colapsável que faz `useQuery` em `/api/compras/sugestoes` (filtra `statusReposicao ∈ {REPOR, ATENCAO}`), lista produtos com cobertura/`qtdSugerida`/data de ruptura, checkbox de seleção e botão "Adicionar selecionados" que chama um callback `onAdicionar(itens)` preenchendo a tabela do pedido com `qtdSugerida`.

- [ ] **Step 2: Integrar em `src/app/compras/novo/page.tsx`.** Renderizar `<SugestorReposicao onAdicionar={...} />` (colapsado por padrão); o callback insere linhas na tabela de itens reusando o caminho de adição já existente.

- [ ] **Step 3: Typecheck + lint.** Expected: limpo.

- [ ] **Step 4: Validação manual.** Página Compras sem mural; KPIs corretos ao trocar período; filtros funcionam; miniaturas aparecem; detalhe com timeline; "Novo pedido" sugere e preenche itens.

- [ ] **Step 5: Commit.**

```bash
git add src/modules/compras src/app/api/compras src/app/compras src/components/compras
git commit -m "feat(compras): aba orientada a historico (KPIs+filtros+timeline) e reposicao no Novo pedido"
```

---

## Fase 5 — Agenda: calendário central + painel "A concluir" + tarefas recorrentes

A maior. Mexe em schema (ambos), lógica de recorrência, agregador e UI.

**Files:**
- Modify: `prisma/schema.prisma` e `prisma/schema.postgresql.prisma` (novo `TarefaRecorrente` + campos em `Tarefa`)
- Create: `prisma/migrations/<ts>_tarefas_recorrentes/migration.sql` (Postgres)
- Create: `src/modules/tarefas/recorrencia.ts` (puro) + testes
- Modify: `src/modules/tarefas/service.ts`, `src/modules/tarefas/repository.ts`
- Modify: `src/modules/agenda/service.ts`
- Create: `src/app/api/tarefas-recorrentes/route.ts` e `/[id]/route.ts`
- Modify: `src/components/agenda/agenda-view.tsx`; Create `src/components/agenda/visoes/{dia,semana,mes}-view.tsx`, `src/components/agenda/painel-a-concluir.tsx`, `src/components/agenda/dialog-tarefa-recorrente.tsx`

### Task 5.1: Recorrência pura (TDD)

- [ ] **Step 1: Escrever testes** `src/modules/tarefas/__tests__/recorrencia.test.ts` cobrindo:
  - DIARIA gera 1/dia no intervalo;
  - SEMANAL com `diasSemana=[1,2]` (seg/ter) só nesses dias;
  - MENSAL com `diaMes=31` clampa ao último dia (fev);
  - PERSONALIZADA `intervalo=3, unidade=DIAS` a cada 3 dias;
  - término `N_VEZES` para na N-ésima; `DATA` para em `terminoAte`;
  - idempotência: dado `jaExistentes` (set de `indiceOcorrencia`), não duplica.

```ts
import { planejarOcorrenciasTarefas } from "../recorrencia";
// exemplo de uma asserção
it("semanal seg/ter", () => {
  const occ = planejarOcorrenciasTarefas(
    { id: "r1", tipoRecorrencia: "SEMANAL", diasSemana: [1, 2], intervalo: 1, tipoTermino: "NUNCA", inicioEm: new Date("2026-06-01T12:00:00Z") },
    new Date("2026-06-01"), new Date("2026-06-09"), new Set(),
  );
  // 01(seg),02(ter),08(seg),09(ter)
  expect(occ.map((o) => o.dataPlanejada.toISOString().slice(0, 10))).toEqual(["2026-06-01","2026-06-02","2026-06-08","2026-06-09"]);
});
```

- [ ] **Step 2: Rodar — deve falhar.** Run: `npx vitest run src/modules/tarefas/__tests__/recorrencia.test.ts`. Expected: FAIL (módulo ausente).

- [ ] **Step 3: Implementar `src/modules/tarefas/recorrencia.ts`** espelhando `src/modules/contas-fixas/recorrencia.ts` (ler antes). Tipos `TarefaRecorrenteParaPlanejar` e `OcorrenciaPlanejadaTarefa { tarefaRecorrenteId; indiceOcorrencia; dataPlanejada }`. Iterar datas em `America/Sao_Paulo` ao meio-dia, gerar `indiceOcorrencia` sequencial, respeitar término, pular `jaExistentes`.

- [ ] **Step 4: Rodar — deve passar.** Run: `npx vitest run src/modules/tarefas/__tests__/recorrencia.test.ts`. Expected: PASS.

- [ ] **Step 5: Commit.** `git add src/modules/tarefas/recorrencia.ts src/modules/tarefas/__tests__ && git commit -m "feat(tarefas): motor puro de recorrencia (+ testes)"`

### Task 5.2: Schema — `TarefaRecorrente` + campos em `Tarefa`

- [ ] **Step 1: Encerrar o Next** (checar `.dev-server.pid`).

- [ ] **Step 2: Editar `prisma/schema.prisma`** — adicionar modelo `TarefaRecorrente` (campos do spec: `tipoRecorrencia, diasSemana(String? JSON), diaMes Int?, intervalo Int @default(1), unidadeIntervalo String?, tipoTermino String @default("NUNCA"), terminoAte DateTime?, terminoMaxVezes Int?, inicioEm DateTime, ativa Boolean @default(true), visibilidade, responsavelId?, empresaId?, deletedAt?, timestamps`, relação `ocorrencias Tarefa[]`). Em `Tarefa` adicionar `tarefaRecorrenteId String?`, `indiceOcorrencia Int?`, `dataPlanejada DateTime?`, relação + `@@unique([tarefaRecorrenteId, indiceOcorrencia])`.

- [ ] **Step 3: Espelhar em `prisma/schema.postgresql.prisma`** (mesmos campos; tipos JSON conforme padrão do arquivo — usar `String` se o resto usa String para JSON).

- [ ] **Step 4: Dev SQLite.** Run: `npm run prisma:generate && npm run prisma:push`. Expected: aplica sem perda.

- [ ] **Step 5: Migration Postgres manual.** Criar `prisma/migrations/<YYYYMMDDhhmmss>_tarefas_recorrentes/migration.sql` com `CREATE TABLE "TarefaRecorrente" (...)` + `ALTER TABLE "Tarefa" ADD COLUMN ...` + índice unique. (Aplicada em prod com `npm run prisma:migrate:deploy:pg`.)

- [ ] **Step 6: Commit.** `git add prisma && git commit -m "feat(agenda): schema TarefaRecorrente + campos de ocorrencia em Tarefa"`

### Task 5.3: Materialização idempotente

- [ ] **Step 1: Repository.** Em `src/modules/tarefas/repository.ts` adicionar `listarRecorrentesAtivasParaMaterializar()` e `ocorrenciasMaterializadas(recorrenteIds, de, ate)` + CRUD de `TarefaRecorrente`.

- [ ] **Step 2: Service `garantirOcorrenciasTarefas({de, ate})`** em `src/modules/tarefas/service.ts`, espelhando `contas-fixas/service.ts#garantirOcorrencias`: clamp 400 dias; buscar moldes ativos; para cada, `planejarOcorrenciasTarefas` com `jaExistentes`; criar `Tarefa` (`prazo=dataPlanejada`, `status=ABERTA`, `tarefaRecorrenteId/indiceOcorrencia`, **forçando `responsavelId`/`visibilidade` do molde**); tratar `P2002` silencioso. Adicionar `sincronizarOcorrenciasFuturasTarefas(recorrenteId)` (atualiza futuras em aberto, soft-delete das fora do plano, **nunca toca CONCLUIDA**).

- [ ] **Step 3: Agregador.** Em `src/modules/agenda/service.ts#listarPorPeriodo`, chamar `garantirOcorrenciasTarefas({de, ate})` junto do `garantirOcorrencias()` das contas, antes de agregar.

- [ ] **Step 4: Teste de idempotência** (`service` ou helper) — rodar materialização 2x não duplica (mockando repo se necessário). Run: `npx vitest run`. Expected: PASS.

- [ ] **Step 5: Typecheck.** Run: `npx tsc --noEmit`. Expected: limpo.

- [ ] **Step 6: Commit.** `git commit -am "feat(agenda): materializacao idempotente de tarefas recorrentes"`

### Task 5.4: Endpoints de tarefas recorrentes

- [ ] **Step 1: Criar `src/app/api/tarefas-recorrentes/route.ts`** (GET listar, POST criar — `requireSession`; PESSOAL força `responsavelId = session.uid`) e **`/[id]/route.ts`** (PATCH editar com flag `aplicarFuturas`, DELETE = desativar). Next 16: `await params`.

- [ ] **Step 2: Typecheck.** Run: `npx tsc --noEmit`. Expected: limpo.

- [ ] **Step 3: Commit.** `git commit -am "feat(agenda): API de tarefas recorrentes"`

### Task 5.5: UI — calendário central + visões + painel "A concluir"

- [ ] **Step 1: Extrair visões.** Criar `src/components/agenda/visoes/dia-view.tsx` (lista/timeline do dia), `semana-view.tsx` (grid 7 colunas Seg–Dom, itens empilhados, hoje destacado), `mes-view.tsx` (mover o grid mensal atual de `agenda-view.tsx`). Todas recebem `itens: AgendaItem[]` + callbacks de concluir/editar.

- [ ] **Step 2: Painel.** Criar `src/components/agenda/painel-a-concluir.tsx` — recebe itens ABERTA/VENCIDA + backlog; agrupa em buckets **Atrasadas / Hoje / Esta semana / Sem prazo**; concluir 1 clique; criar tarefa rápida.

- [ ] **Step 3: Reescrever `agenda-view.tsx`** para layout 2 colunas: esquerda = segmented `Dia·Semana·Mês` (default **Semana**) renderizando a visão correspondente; direita = `<PainelAConcluir>`. A query do calendário usa `de/ate` do modo selecionado; o painel faz query separada a `/api/agenda?status=ABERTA,VENCIDA` numa janela ampla (`[hoje-90d, hoje+30d]`) + backlog, agrupando no client. Manter chips Empresa/Pessoais/Minhas.

- [ ] **Step 4: Dialog de recorrência.** Criar `src/components/agenda/dialog-tarefa-recorrente.tsx` com bloco "Repetir" (Não repete/Diária/Semanal+dias/Mensal+dia/Personalizada+intervalo) e "Termina" (Nunca/Data/Após N), salvando via `/api/tarefas-recorrentes`. Integrar ao fluxo de "Nova tarefa" (toggle "repetir").

- [ ] **Step 5: Typecheck + lint.** Run: `npx tsc --noEmit` e `npx eslint src/components/agenda`. Expected: limpo.

- [ ] **Step 6: Validação manual.** Abre em Semana; toggle Dia/Mês; painel "A concluir" agrupa por urgência; criar tarefa recorrente gera ocorrências; editar molde "aplicar às futuras" propaga só às abertas; PESSOAL só visível ao dono.

- [ ] **Step 7: Commit.** `git add src/components/agenda && git commit -m "feat(agenda): calendario central (Dia/Semana/Mes) + painel A concluir + recorrencia na UI"`

---

## Self-review (preenchido)

- **Cobertura do spec:** Sino (Fase 1) ✓ · Genius+Expedição (Fase 2) ✓ · Ads histórico+imagem+última ação (Fase 3) ✓ · Compras histórico+KPIs+timeline+reposição no Novo pedido (Fase 4) ✓ · Agenda visões+recorrência (Fase 5) ✓.
- **Placeholders:** nenhum "TODO/depois"; pontos que dependem de nomes reais do projeto (helpers `ok`/auth, parser de métricas) estão marcados como "confirmar e espelhar o padrão existente", não como lacuna de design.
- **Consistência de tipos:** `garantirOcorrenciasTarefas`, `planejarOcorrenciasTarefas`, `OcorrenciaPlanejadaTarefa`, `calcularTotaisCompras`, `getHistoryBySku` usados com a mesma assinatura entre tarefas.
- **YAGNI:** sem histórico global de ads, sem drop de tabelas, sem sync de ocorrências passadas, sem múltiplos responsáveis.
