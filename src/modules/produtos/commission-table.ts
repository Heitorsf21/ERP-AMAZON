export type CommissionTier = {
  thresholdCentavos: number;
  baseRateBps: number;
  excessRateBps: number;
};

export type CommissionRule = {
  label: string;
  slug: string;
  rateBps: number;
  minCentavos: number;
  tier?: CommissionTier;
  isMedia?: boolean;
};

// Tabela de comissao por categoria (BR 2026, 36 entradas).
// Fonte: extensao de analise Amazon (packages/core/src/amazon-fees.ts).
// `rateBps` = basis points (1200 = 12.00%). `minCentavos` = piso da comissao.
export const COMMISSION_TABLE: CommissionRule[] = [
  { label: "Comidas e bebidas", slug: "comidas-bebidas", rateBps: 1000, minCentavos: 100 },
  { label: "Eletrodomesticos linha branca", slug: "eletro-linha-branca", rateBps: 1100, minCentavos: 100 },
  { label: "Saude e cuidados pessoais", slug: "saude-cuidados-pessoais", rateBps: 1200, minCentavos: 100 },
  { label: "Bebidas alcoolicas", slug: "bebidas-alcoolicas", rateBps: 1100, minCentavos: 100 },
  { label: "Pneus e rodas", slug: "pneus-rodas", rateBps: 1000, minCentavos: 100 },
  { label: "Industria e Ciencia", slug: "industria-ciencia", rateBps: 1200, minCentavos: 100 },
  { label: "Produtos para bebes", slug: "bebes", rateBps: 1200, minCentavos: 200 },
  { label: "Pet Shop", slug: "pet-shop", rateBps: 1200, minCentavos: 200 },
  { label: "Eletroportateis cuidado pessoal", slug: "eletroportateis", rateBps: 1200, minCentavos: 200 },
  { label: "Cozinha", slug: "cozinha", rateBps: 1200, minCentavos: 200 },
  { label: "Jardim e Piscina", slug: "jardim-piscina", rateBps: 1200, minCentavos: 200 },
  { label: "Brinquedos e jogos", slug: "brinquedos-jogos", rateBps: 1200, minCentavos: 200 },
  { label: "TV, audio e cinema", slug: "tv-audio-cinema", rateBps: 1000, minCentavos: 200 },
  { label: "PC", slug: "pc", rateBps: 1200, minCentavos: 200 },
  { label: "Celulares", slug: "celulares", rateBps: 1100, minCentavos: 200 },
  { label: "Camera e fotografia", slug: "camera-fotografia", rateBps: 1100, minCentavos: 200 },
  { label: "Videogames e consoles", slug: "videogames-consoles", rateBps: 1100, minCentavos: 200, isMedia: true },
  { label: "Eletronicos portateis", slug: "eletronicos-portateis", rateBps: 1300, minCentavos: 200 },
  { label: "Automotivos", slug: "automotivos", rateBps: 1200, minCentavos: 200 },
  { label: "Casa", slug: "casa", rateBps: 1200, minCentavos: 200 },
  { label: "Beleza de luxo", slug: "beleza-luxo", rateBps: 1400, minCentavos: 200 },
  { label: "Beleza", slug: "beleza", rateBps: 1300, minCentavos: 200 },
  { label: "Esportes, aventura e lazer", slug: "esportes-aventura-lazer", rateBps: 1200, minCentavos: 200 },
  { label: "Ferramentas e Construcao", slug: "ferramentas-construcao", rateBps: 1100, minCentavos: 200 },
  { label: "Papelaria e Escritorio", slug: "papelaria-escritorio", rateBps: 1300, minCentavos: 200 },
  { label: "Bagagem", slug: "bagagem", rateBps: 1400, minCentavos: 200 },
  { label: "Roupas e acessorios", slug: "roupas-acessorios", rateBps: 1400, minCentavos: 200 },
  { label: "Calcados, bolsas e oculos", slug: "calcados-bolsas-oculos", rateBps: 1400, minCentavos: 200 },
  { label: "Relogios", slug: "relogios", rateBps: 1300, minCentavos: 200 },
  { label: "Joias", slug: "joias", rateBps: 1400, minCentavos: 200 },
  { label: "Livros", slug: "livros", rateBps: 1500, minCentavos: 200, isMedia: true },
  {
    label: "Acessorios para eletronicos e PC",
    slug: "acessorios-eletronicos-pc",
    rateBps: 1500,
    minCentavos: 200,
    tier: { thresholdCentavos: 10000, baseRateBps: 1500, excessRateBps: 1000 },
  },
  {
    label: "Moveis",
    slug: "moveis",
    rateBps: 1500,
    minCentavos: 200,
    tier: { thresholdCentavos: 20000, baseRateBps: 1500, excessRateBps: 1000 },
  },
  { label: "Video e DVD", slug: "video-dvd", rateBps: 1500, minCentavos: 200, isMedia: true },
  { label: "Musica", slug: "musica", rateBps: 1500, minCentavos: 200, isMedia: true },
  { label: "Instrumentos musicais", slug: "instrumentos-musicais", rateBps: 1200, minCentavos: 200 },
];

const COMMISSION_TABLE_BY_SLUG: Map<string, CommissionRule> = new Map(
  COMMISSION_TABLE.map((rule) => [rule.slug, rule]),
);

export function listCommissionCategories(): CommissionRule[] {
  return COMMISSION_TABLE.map((rule) => ({ ...rule }));
}

export function findCommissionRule(slug?: string | null): CommissionRule | undefined {
  if (!slug) return undefined;
  return COMMISSION_TABLE_BY_SLUG.get(slug);
}

export function calcularComissaoCentavos(
  brutoCentavos: number,
  rule: Pick<CommissionRule, "rateBps" | "minCentavos" | "tier">,
): number {
  const bruto = Math.max(0, Math.round(brutoCentavos));
  let calc: number;
  if (rule.tier && bruto > rule.tier.thresholdCentavos) {
    const baseParte = Math.round((rule.tier.thresholdCentavos * rule.tier.baseRateBps) / 10000);
    const excedenteParte = Math.round(
      ((bruto - rule.tier.thresholdCentavos) * rule.tier.excessRateBps) / 10000,
    );
    calc = baseParte + excedenteParte;
  } else if (rule.tier) {
    calc = Math.round((bruto * rule.tier.baseRateBps) / 10000);
  } else {
    calc = Math.round((bruto * rule.rateBps) / 10000);
  }
  return Math.max(calc, rule.minCentavos);
}

function bpsLabel(bps: number): string {
  const value = bps / 100;
  return Number.isInteger(value) ? `${value}%` : `${value.toFixed(2)}%`;
}

function brlLabel(centavos: number): string {
  return `R$${(centavos / 100).toFixed(0)}`;
}

export function formatCommissionRule(rule: CommissionRule): string {
  if (rule.tier) {
    return `${bpsLabel(rule.tier.baseRateBps)} ate ${brlLabel(rule.tier.thresholdCentavos)} + ${bpsLabel(rule.tier.excessRateBps)} acima`;
  }
  return bpsLabel(rule.rateBps);
}

