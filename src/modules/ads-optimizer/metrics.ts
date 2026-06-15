export type AdsOptimizerMetrics = {
  impressoes: number;
  cliques: number;
  gastoCentavos: number;
  vendasCentavos: number;
  pedidos: number;
  unidades: number;
  acos: number | null;
  roas: number | null;
  ctr: number | null;
  cpcCentavos: number | null;
  conversao: number | null;
};

export function emptyMetrics(): AdsOptimizerMetrics {
  return {
    impressoes: 0,
    cliques: 0,
    gastoCentavos: 0,
    vendasCentavos: 0,
    pedidos: 0,
    unidades: 0,
    acos: null,
    roas: null,
    ctr: null,
    cpcCentavos: null,
    conversao: null,
  };
}

export function deriveMetrics(base: {
  impressoes: number;
  cliques: number;
  gastoCentavos: number;
  vendasCentavos: number;
  pedidos: number;
  unidades: number;
}): AdsOptimizerMetrics {
  return {
    ...base,
    acos:
      base.vendasCentavos > 0 ? base.gastoCentavos / base.vendasCentavos : null,
    roas:
      base.gastoCentavos > 0 ? base.vendasCentavos / base.gastoCentavos : null,
    ctr: base.impressoes > 0 ? base.cliques / base.impressoes : null,
    cpcCentavos:
      base.cliques > 0 ? Math.round(base.gastoCentavos / base.cliques) : null,
    conversao: base.cliques > 0 ? base.pedidos / base.cliques : null,
  };
}
