// Parametros do funil de decisao do otimizador de Ads.
// Travados com o usuario em 2026-06-10 — ver docs/superpowers/specs/2026-06-10-otimizador-ads-redesign-design.md §9.
// Mudar qualquer valor daqui exige reabrir a discussao do spec (§11).

/** Passo fixo de ajuste de lance (R$0,05). E a "unidade do experimento" do ciclo de feedback. */
export const FUNNEL_BID_STEP_CENTAVOS = 5;

/** Dias minimos desde a mudanca antes de julgar o efeito (janela de atribuicao SP = 7d). */
export const FUNNEL_OBSERVATION_MIN_DAYS = 7;

/** Dias para confianca alta no julgamento pos-mudanca. */
export const FUNNEL_OBSERVATION_HIGH_CONFIDENCE_DAYS = 14;

/** Cliques minimos acumulados pos-mudanca para julgar (significancia). */
export const FUNNEL_OBSERVATION_MIN_CLICKS = 10;

/** Ultimos N dias descontados do julgamento (conversoes ainda entrando). */
export const FUNNEL_PROVISIONAL_RECENT_DAYS = 2;

/** Dormente = ate este numero de cliques em 7d (0 = nenhum clique). */
export const FUNNEL_DORMANT_MAX_CLICKS_7D = 0;

/** "Caindo materialmente" = cliques 7d abaixo de (ritmo 30d * este fator). */
export const FUNNEL_DECLINE_PACE_RATIO = 0.7;

/** Gatilho de corte: cliques sem nenhuma venda, em qualquer janela. */
export const FUNNEL_ZERO_SALES_CLICKS = 25;

/** "Historico bom" que veta o corte: ACOS de vida abaixo disso (e com vendas). */
export const FUNNEL_GOOD_LIFETIME_ACOS = 0.15;

/** Meta de conforto — ACOS "otimo". */
export const FUNNEL_COMFORT_ACOS = 0.15;

/** Teto de ACOS 30d para corroborar forca recente (subir lance com confianca media). */
export const FUNNEL_ACCEPTABLE_ACOS_30D = 0.25;

/** ACOS 7d "disparado" (palavra boa com lance alto → reduzir). */
export const FUNNEL_SPIKE_ACOS_7D = 0.5;

/** ACOS muito alto na janela longa (65d) — autoriza pausa. */
export const FUNNEL_PAUSE_ACOS_65D = 0.5;

/** Melhora minima de ACOS pos-otimizacao (pontos percentuais, em fracao: 0.10 = 10pp). */
export const FUNNEL_IMPROVEMENT_MIN_PP = 0.1;

/** Janela longa de avaliacao em dias. */
export const FUNNEL_LONG_WINDOW_DAYS = 65;

/** Harvest de termo bom (mantido do motor antigo): pedidos minimos em 30d. */
export const FUNNEL_HARVEST_MIN_ORDERS_30D = 2;
