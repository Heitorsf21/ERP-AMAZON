# DRE por Competência — Design

**Data:** 2026-06-17 · **Branch:** `feat/dre-competencia` · **Status:** implementado, em verificação

## Problema

O DRE atual (`/dre`) é **100% regime de caixa**: a linha "Receita Amazon" só soma
`ContaReceber` com status `RECEBIDA`, o que exige o usuário importar CSV da Amazon
e/ou o extrato bancário manualmente. Resultado: o DRE fica vazio sem trabalho manual
diário — exatamente a dor relatada.

Em paralelo, o **Dashboard E-commerce** já calcula automaticamente, por competência
(data da venda), tudo que o sistema sincroniza da Amazon: faturamento → taxas → frete
→ custo (CMV) → imposto → Ads → lucro. Os dois módulos estão **desconectados** (fontes
e filtros diferentes).

## Decisão

1. **Toggle de regime** no DRE: **Competência** (NOVO, padrão) + **Caixa** (o atual,
   preservado para conferência com o banco).
2. **Profundidade até o Lucro Líquido completo** (inclui Ads + despesas fixas/operacionais).
3. **Filtro `espelho`** (o mesmo do Dashboard) na competência — assim a *Receita Bruta*
   do DRE bate com o *Faturamento* do Dashboard, e os reembolsos viram contra-receita
   correta (o bruto inclui a venda reembolsada; o refund subtrai). O regime de caixa
   mantém o filtro estrito original.

## Estrutura (competência)

```
(+) Receita bruta de vendas       espelho, por dataVenda  (= Faturamento do Dashboard)
(−) Devoluções / Reembolsos       amazonReembolso por dataReembolso (contra-receita)
(=) Receita Líquida
(−) Taxas Amazon                  real quando liquidou; estimado (fee-estimator) senão  [selo Real/Estimado/Misto]
(−) Fretes
(−) Impostos (Simples)            calcularImpostoSimplesCentavos
(=) Receita Operacional Líquida
(−) CMV                           custo histórico do que foi vendido  [aviso se incompleto]
(=) Lucro Bruto                   + margem bruta %
(−) Publicidade (Ads)             ads-aggregation
(−) Despesas Operacionais/Fixas   ContaPagar por vencimento, por categoria (exclui CMV/Taxas/Frete)
(=) Lucro Operacional
(±) Outras (lançamentos manuais)  Movimentacao MANUAL por dataCompetencia
(=) Lucro Líquido                 + margem líquida %
```

## Arquitetura

- `src/modules/dre/service.ts` (NOVO):
  - `agregarDreCompetencia(linhas, extras)` — **agregador puro** (toda a aritmética; testável sem banco).
  - `calcularDreCompetencia(de, ate, opts)` — I/O; reusa helpers públicos (filtros, valores,
    fee-estimator, imposto-simples, ads-aggregation, contas-fixas). Sem importar nada privado
    do Dashboard; sem escrever em `VendaAmazon`.
  - `calcularDreCaixa(de, ate)` — lógica histórica extraída **verbatim** da rota.
- `src/app/api/dre/resumo/route.ts` — fino; `?regime=competencia|caixa` (default competência),
  válido também no modo `mensal` (anual). Anual usa `materializarFixas:false`.
- `src/app/dre/page.tsx` — toggle de regime + `DreCompetenciaView`/`DreCaixaView`. A tabela
  anual funciona para ambos via chaves de compatibilidade expostas pelo agregado.
- `src/modules/dre/service.test.ts` — 7 testes do agregador puro.

## Garantias (regras invioláveis do dono)

- **Dashboard E-commerce intocado** (`dashboard-ecommerce/service.ts` não alterado — confirmado por git).
- **Campos sagrados de `VendaAmazon`** nunca escritos (DRE só lê vendas).
- Estimativas vivem em memória (fee-estimator), nunca persistidas.

## Verificação adversarial (multi-agente, 2026-06-17)

6 dimensões × verificação de cada achado → 20 confirmados / 2 refutados. **Corrigidos antes do deploy:**

- **[ALTA] Efeito colateral de escrita em GET:** removido `garantirOcorrencias` do DRE — agora
  é **100% read-only**. Contas fixas não materializadas entram como linha "Contas fixas
  (previstas)", calculada de forma pura (`totalDoPeriodo`). Não há mais caixa retroativo ao
  visualizar período antigo.
- **[ALTA] Vendas DEFERRED/PENDENTE sem produto cadastrado:** antes ficavam com taxa 0 e fora
  da classificação; agora recebem **estimativa fallback** (`calcularFeesLocal`, comissão default)
  e são marcadas como "estimado".
- **[MÉDIA] Dupla contagem de imposto:** categoria "Impostos" é excluída das despesas quando o
  Simples é calculado por venda (`cfgImposto.ativo`).
- **[MÉDIA] Contagem de vendas:** `quantidadeVendas` agora conta **pedidos únicos** (amazonOrderId),
  alinhado ao Dashboard.
- **[MÉDIA] Rótulo do KPI:** "Receita Líquida" → "Receita Op. Líquida" (evita conflito com a linha da tabela).
- **[BAIXA] Taxas de reembolso:** `taxasReembolsadasCentavos` agora creditado de volta nas Taxas Amazon (clamp ≥ 0).
- **[BAIXA] Cores dos KPIs:** todos os cards de competência com `valueClassName` (prejuízo em vermelho).

## Limitações conhecidas (v1 — "base, mesmo que não 100% real")

- **CMV de venda reembolsada** não é revertido (entra no bruto via espelho; o refund só abate receita). Pequena superestimativa de CMV.
- **Ads × categoria "Marketing"**: linha Ads (PPC) e categoria "Marketing" (marketing externo) somadas separadamente. Só dupla-conta se o usuário lançar PPC como conta "Marketing".
- **Reembolso por dataReembolso** (não pela competência da venda original): meses de pico de devolução podem mostrar contra-receita sem o bruto correspondente. Escolha deliberada (paridade com o caixa).
- **Receita Bruta ≈ Faturamento do Dashboard** (não idêntica): o DRE usa gross + contra-receita; o Dashboard remove fisicamente as vendas reembolsadas na janela (net).

## Pendências para Onda 2/3 (verificação confirmou, baixa prioridade)

- Pré-buscar `AmazonFeeEstimate` em lote (evitar N+1 de `findUnique` em períodos grandes — hoje protegido pelo pool cap).
- Imposto sobre **reembolso parcial** (base líquida do refund).
- Alinhar normalização de status no `dashboard-ecommerce` (DRE já normaliza; tocar no dashboard exige aprovação).
- **Bug pré-existente do regime CAIXA** (não introduzido por esta feature): `calcularDreCaixa` faz lookup de categoria sem normalizar (ex.: `"Taxas de plataformas/pagamentos"` sem espaços) — não casa com o seed (com espaços), zerando deduções/CMV no caixa. Mantido verbatim a pedido do dono; corrigir requer decisão consciente (muda números da aba Caixa).
