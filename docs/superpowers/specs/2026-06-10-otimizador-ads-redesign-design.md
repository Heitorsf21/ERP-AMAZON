# Design — Redesenho do Otimizador de Ads (v2)

- **Data:** 2026-06-10
- **Branch atual:** `feat/amazon-oauth-multiseller`
- **Status:** Spec revisado e aprovado pelo usuário (2026-06-10)
- **Módulos afetados:** `src/modules/ads-optimizer/`, `src/modules/amazon/jobs.ts`, `src/app/publicidade/otimizador/page.tsx`

---

## 1. Problema

O otimizador de Ads tem boa engenharia (sync de entidades, relatórios diários de Targeting/Search Term, fluxo de aprovação humana), mas a **inteligência de decisão não é útil ainda**. Causas concretas:

1. **Motor cego à recência.** A regra `TARGET_25_CLICKS_ZERO_SALES` ([rules.ts:114](../../../src/modules/ads-optimizer/rules.ts)) pausa por 30d sem nunca olhar os 7d — manda pausar palavra que teve **R$ 0 de gasto na última semana** (caso real "almofada ortopédica").
2. **Limiares fixos e globais** (15/30/50%) aplicados de forma binária, sem ler **tendência** nem **histórico**.
3. **Motor sem memória.** `evaluateAdsOptimizerRules` decide do zero toda vez — não sabe "o que já tentei nesta palavra e quando", então não consegue medir se uma otimização funcionou nem escalar pro corte.
4. **Operação manual + poluição visual.** Roda só no clique de "Sincronizar e analisar"; a tela mostra "engrenagem" (cobertura/backfill, contadores de estado) em vez de só as decisões.

## 2. Objetivos

- A tela mostra **só o que importa hoje**: decisões limpas, sempre frescas, sem botões de sync e sem cards de processo.
- O motor decide por um **funil em camadas** que lê **recência + conversão + tendência multi-janela + memória de ações passadas**, não por limiares binários.
- Um **job automático** mantém os dados e as recomendações atualizados várias vezes ao dia, e **remove** o que ficou obsoleto.
- O ciclo de feedback (otimizou → mediu → escalou) respeita a **janela de atribuição da Amazon**, pra não decidir com dado imaturo.

## 3. Não-objetivos (fase futura)

- **Break-even / lucro por SKU** como régua de decisão — *decisão: NÃO entra agora.* O motor roda 100% pelos limiares de ACOS definidos abaixo. Margem por produto fica como evolução futura.
- **Sugerir lance inicial (2% do preço) para palavras novas** — fora do escopo desta entrega.
- **Sponsored Brands / Sponsored Display** — escopo segue Sponsored Products.

---

## 4. O motor de decisão (o funil)

Princípio unificador: **nenhuma ação forte com base numa única janela; volume não é meta, lucro é; só se pausa/corta o que está gastando ou o que provou não ter conserto barato.**

Avaliado por entidade (keyword / target) a cada ciclo:

```
0. EM OBSERVAÇÃO?
   Ação aplicada há < 7 dias, OU < 10 cliques acumulados desde a mudança.
   → NÃO age. Mostra o efeito diário acumulado desde a mudança (provisório).

1. RECÊNCIA — gastou em 7d?
   ├─ Dormente (~0 cliques em 7d):
   │     • ACOS 65d > 50%  → PAUSAR
   │     • senão           → SUBIR LANCE (revive)
   ├─ Cliques caindo vs ritmo 30d (< ritmo) e ainda > 0:
   │     • ACOS 7d melhorando vs 30d → SEGURAR (ficou eficiente; não força volume)
   │     • ACOS 7d piorando vs 30d   → REDUZIR LANCE
   └─ Ativa (no ritmo / subindo) → passo 2

2. CONVERTE? (tem vendas)
   ├─ Não + ≥ 25 cliques (em qualquer janela 7d/30d/histórico):
   │     • histórico bom (ACOS de vida < 15%) → REDUZIR LANCE + observar
   │     • senão                              → CORTAR (pausar)
   └─ Sim → passo 3

3. DESEMPENHO multi-janela (limiares de ACOS):
   • ACOS < 15% em 7d E 30d E 65d              → SUBIR LANCE (vencedora estável)
   • ACOS 7d ótimo  E  ACOS 30d < 25%          → SUBIR LANCE (força recente corroborada)
   • ACOS 7d ótimo  MAS ACOS 30d > 25%         → SEGURAR (só um bom momento)
   • ACOS de vida saudável MAS ACOS 7d disparou → REDUZIR LANCE (lance alto)
   • ACOS 65d > 50% E já otimizada sem melhora ≥ 10pp → CORTAR

4. FEEDBACK (após a janela de observação fechar):
   • ACOS pós-mudança melhorou ≥ 10pp vs baseline → sucesso, segue monitorando
   • não melhorou                                  → ESCALAR (corte)
```

### Notas de semântica
- **"Histórico bom" / "ACOS de vida"** = ACOS sobre o histórico disponível (até ~95d de retenção). A exceção do passo 2 só vale se a palavra **já converteu no passado** (tem ACOS calculável < 15%); palavra com 0 venda na vida não tem histórico bom → corta.
- **"ACOS 7d ótimo"** = abaixo da meta de conforto (< 15%).
- **Pausa preferencialmente após tentativa de otimização.** Pausa direta (sem tentar) só nos casos sem salvação: muitos cliques, 0 venda e sem histórico bom.
- **Detector de eficiência (passo 1):** "ritmo 30d" = `cliques_30d × 7/30`. "Caindo" = 7d materialmente abaixo desse ritmo. Cair clique **com** ACOS melhorando é recompensado com paciência (não se força volume, que poderia trazer de volta o clique ruim).
- **Termos de busca (SEARCH_TERM):** o funil se aplica igualmente, com a ação **CORTAR mapeada para negativar** (negative keyword/target) em vez de pausar — termo de busca não tem lance próprio, então os ramos de subir/reduzir lance não se aplicam a ele. O **harvest** (criar keyword exata a partir de termo com ≥ 2 pedidos e ACOS < 15% em broad/auto) é **mantido como hoje**.

---

## 5. Janela de observação e ciclo de feedback

A Amazon **atribui vendas até 7 dias após o clique** (Sponsored Products, conta Seller Central) e **reescreve os números em 1/7/28 dias** — os dias recentes sempre parecem piores do que são. Julgar uma mudança cedo demais corta palavra que na verdade melhorou (a venda só não foi contabilizada ainda).

Por isso a janela tem **duas funções separadas**:

### 5.1 Monitoramento (visível) — ancorado na data da mudança
Acumula **dia após dia** a partir de `executadoEm`:
> "Faz N dias que reduzi o lance. Desde então: R$ X gasto, Y vendas, ACOS Z% *(provisório — conversões ainda entrando)*."

Cada ciclo soma mais um dia de efeito real. **Não** é uma janela "últimos N dias" rolando cega — é ancorada na ação.

### 5.2 Decisão (julgamento) — só com dado maduro
O gatilho "melhorou ou corta" só dispara quando **todas** as condições valem:
- **≥ 7 dias** desde a mudança (a janela de atribuição do SP fechou para os primeiros cliques). **14 dias = alta confiança.**
- **≥ 10 cliques** acumulados desde a mudança (significância).
- Os **últimos 1–2 dias** são descontados/marcados como provisórios.

Antes disso, a palavra fica **"em observação"** (passo 0 do funil) e não é tocada.

### 5.3 Implementação técnica
- Gravar a data de execução da ação (`executadoEm`) e o **baseline de ACOS** no momento da ação (já temos `metrics30dJson` na recomendação).
- "Janela pós-mudança" = somar as linhas diárias (`amazonAdsTargetingMetricDaily` / `amazonAdsSearchTermMetricDaily`) com `data ≥ executadoEm`. Cresce 1 dia por ciclo.
- **Maturidade** = dias desde `executadoEm`. < 7 → observação; ≥ 7 + ≥ 10 cliques → julga ACOS pós-mudança vs baseline.

---

## 6. Job automático

- **Novo schedule `AMAZON_ADS_OPTIMIZER`** em [jobs.ts](../../../src/modules/amazon/jobs.ts), a cada **~6h (4x/dia)**.
- Cada ciclo:
  1. **Sincroniza relatórios** quando a Amazon tem dado novo (reusa o lifecycle quota-aware já existente; respeita `AmazonQuotaCooldownError`).
  2. **Recalcula** todas as recomendações pelo funil, contra o estado atual das entidades (lances, pausados, negativos).
  3. **Remove o obsoleto:** recomendação que não vale mais — porque a condição mudou **ou** porque o usuário já resolveu na mão (estado da entidade na Amazon mudou) — **some** da tela. Não vira "Obsoleta" visível.
- **Realidade aceita:** relatório da Amazon é diário; a alta frequência serve pra **manter o quadro limpo e verdadeiro**, não pra inventar dado que a Amazon ainda não fechou.
- Mantém o gate **manual** de aprovação/execução (o job propõe e limpa; quem aplica na Amazon continua sendo o humano via "Aprovar"/"Executar aprovadas").

---

## 7. Mudanças de UI ([otimizador/page.tsx](../../../src/app/publicidade/otimizador/page.tsx))

- **Remover** o `CoveragePanel` (os dois cards de "Histórico granular / Backfill" + botões "Buscar histórico"/"Continuar backfill").
- **Remover** a fileira de 4 `SummaryCard` (Pendentes / Aprovadas / Bloqueadas / Obsoletas).
- **Manter** os cards por SKU com as recomendações acionáveis e o histórico por SKU.
- **Sem botão "Sincronizar e analisar"** no fluxo normal (o job cuida). *(Opcional: manter um "Atualizar agora" discreto para forçar um ciclo, a decidir na implementação.)*
- Em cada recomendação que veio de uma ação anterior em observação, mostrar o **efeito diário acumulado** (seção 5.1).

---

## 8. Arquitetura (Opção A — motor stateful novo)

O motor atual `rules.ts` é **sem memória**. A lógica nova é um funil **stateful e multi-janela** — paradigma diferente. Decisão: **criar um motor novo ao lado e aposentar o `rules.ts`.**

- **Novo:** `src/modules/ads-optimizer/funnel.ts` com função pura `evaluateAdsOptimizerFunnel(input)`.
  - **Input:** métricas das janelas **7d / 30d / 65d / histórico**; lance atual; estado da entidade; **histórico da última ação** (tipo, `executadoEm`, baseline de ACOS, métricas acumuladas pós-mudança, dias e cliques desde a mudança).
  - **Output:** ação proposta (subir/baixar lance 5¢, pausar/cortar, negativar, segurar) + motivo + severidade + dados de evidência.
- **`buildOptimizationSnapshot`** ([service.ts](../../../src/modules/ads-optimizer/service.ts)) ganha a **janela de 65d** (hoje calcula 7d/prev7d/30d/lifetime) e passa a injetar o **histórico da última ação por entidade** no input do funil.
- **Parâmetros centralizados** num único módulo de constantes (substitui os espalhados em `rules.ts`), pra ficarem fáceis de auditar/ajustar.
- **Testes unitários** do funil cobrindo cada ramo + os casos-teste da seção 10.

---

## 9. Parâmetros (todos travados)

| Parâmetro | Valor |
|---|---|
| Passo de ajuste de lance | **5 centavos** (fixo) |
| Janela de decisão (mínima) | **7 dias** desde a mudança |
| Janela de alta confiança | **14 dias** |
| Dias recentes descontados | **últimos 1–2 dias** (provisórios) |
| Dormente | **~0 cliques em 7d** |
| Detector de eficiência | cliques < ritmo 30d **+** ACOS↓ → segura; **+** ACOS↑ → reduz |
| Corte por "sem venda" | **≥ 25 cliques** e 0 venda (qualquer janela) → corta |
| Exceção ao corte | **histórico bom = ACOS de vida < 15%** → reduz + observa |
| Cliques mínimos p/ julgar otimização | **≥ 10 cliques** pós-mudança |
| Otimização funcionou | **melhora ≥ 10 pontos percentuais** de ACOS |
| ACOS "muito alto" (65d) p/ pausa | **> 50%** |
| Vencedora estável (sobe lance) | **ACOS < 15% em 7d E 30d E 65d** |
| Aceitável p/ escalar (sobe lance) | **7d ótimo E 30d < 25%** |
| "Só um bom momento" (segura) | **7d ótimo MAS 30d > 25%** |
| Meta de conforto (ACOS "ótimo") | **< 15%** |
| Cadência do job | **~6h (4x/dia)** |

---

## 10. Casos-teste de validação

A nova lógica **tem** que acertar:

1. **"almofada ortopédica" (MFS0017):** 7d = R$ 0 · 30d = R$ 28,90 / 31 cliques / 0 pedidos · vida = 68 cliques / 2 pedidos / ACOS 38%.
   → **SUBIR LANCE** (dormente + ACOS 65d não > 50%). **Nunca pausar.**
2. **Lance alto, palavra boa:** 7d = 20 cliques / 1 venda / ACOS 55% · 30d = 45 cliques / 3 vendas · vida ~10 vendas / ACOS 30%.
   → **REDUZIR LANCE** (converte + vida saudável, mas 7d disparou). **Não pausar.**
3. **Sem salvação:** ≥ 25 cliques, 0 venda na vida, sem histórico bom.
   → **CORTAR** direto.
4. **Eficiência crescente:** 30d = 30 cliques, 7d < 5 cliques, ACOS 7d melhor que 30d.
   → **SEGURAR** (não força volume).
5. **Vencedora estável:** ACOS < 15% em 7d, 30d e 65d.
   → **SUBIR LANCE.**
6. **Bom momento enganoso:** ACOS 7d = 9% mas 30d = 28%.
   → **SEGURAR** (não sobe lance).
7. **Feedback negativo:** palavra reduzida há 8 dias, ≥ 10 cliques, ACOS pós-mudança não melhorou 10pp.
   → **ESCALAR pro corte.**

---

## 11. Riscos / atenção

- **Quota da Amazon Ads.** O job a cada 6h precisa respeitar cooldown; reusar o lifecycle existente (`syncOptimizerReportsWithCooldown`) evita reescrever isso.
- **Atribuição imatura.** O gate de 7 dias + descontar dias recentes é o que protege contra "cortar palavra que melhorou". É o requisito de confiabilidade central — não pode ser afrouxado sem reabrir esta discussão.
- **Migração do `rules.ts`.** Recomendações antigas geradas pelo motor velho devem ser invalidadas/regeneradas no primeiro ciclo do motor novo, pra não misturar paradigmas.
- **Janela de 65d** depende do backfill estar coberto; o job de backfill (já existente) precisa ter rodado.

---

## 12. Fontes (pesquisa de atribuição/timing)

- Amazon Ads — Ad campaign attribution: https://advertising.amazon.com/help/GX7KDKHMWQYMJ385
- Optmyzr — Amazon Ads reporting delays: https://www.optmyzr.com/blog/amazon-ads-reporting-delays/
- AdLabs — How long to wait before adjusting bids: https://adlabs.app/amazon-ppc-bid-optimization-how-long-should-you-wait-before-adjusting-bids-again/
- SellerMetrics — How often to change keyword bids: https://sellermetrics.app/amazon-bid-change/
