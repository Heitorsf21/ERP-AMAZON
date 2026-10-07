import { formatBRL } from "@/lib/money";

export type DeltaKpi = { valor: number | null; tipo: "percent" | "pp"; inverso?: boolean };
export type CategoriaKpiMobile = "receita" | "operacao" | "ads";
export type KpiMobile = {
  chave: "faturamento" | "lucro" | "margem" | "vendas" | "roi" | "ads";
  rotulo: string;
  valor: string;
  categoria: CategoriaKpiMobile;
  delta: DeltaKpi;
};

/** Subconjunto do `Kpis` do dashboard (mesmos nomes da API /kpis). */
export type KpisMobileEntrada = {
  faturamentoCentavos: number;
  lucroBrutoCentavos: number | null;
  margemPercentual: number | null;
  numeroVendas: number;
  roiPercentual: number | null;
  valorAdsCentavos: number;
  lucroPosAdsCentavos: number | null;
  mpaPercentual: number | null;
  delta: {
    faturamento: number | null;
    lucroBruto: number | null;
    margem: number | null;
    numeroVendas: number | null;
    roi: number | null;
    valorAds: number | null;
    lucroPosAds: number | null;
  };
};

export function formatarPercentual(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "N/A";
  return `${v.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
}

function dinheiroOuNA(centavos: number | null): string {
  return centavos == null ? "N/A" : formatBRL(centavos);
}

/** Os 6 KPIs + MPA escolhidos para o celular (o desktop continua com todos). */
export function montarKpisMobile(k: KpisMobileEntrada): {
  cards: KpiMobile[];
  mpa: { valor: string; lucroPosAds: string; delta: DeltaKpi };
} {
  const d = k.delta;
  return {
    cards: [
      {
        chave: "faturamento",
        rotulo: "Faturamento",
        valor: formatBRL(k.faturamentoCentavos),
        categoria: "receita",
        delta: { valor: d.faturamento, tipo: "percent" },
      },
      {
        chave: "lucro",
        rotulo: "Lucro",
        valor: dinheiroOuNA(k.lucroBrutoCentavos),
        categoria: "operacao",
        delta: { valor: d.lucroBruto, tipo: "percent" },
      },
      {
        chave: "margem",
        rotulo: "Margem",
        valor: formatarPercentual(k.margemPercentual),
        categoria: "operacao",
        delta: { valor: d.margem, tipo: "pp" },
      },
      {
        chave: "vendas",
        rotulo: "Vendas",
        valor: k.numeroVendas.toLocaleString("pt-BR"),
        categoria: "operacao",
        delta: { valor: d.numeroVendas, tipo: "percent" },
      },
      {
        chave: "roi",
        rotulo: "ROI",
        valor: formatarPercentual(k.roiPercentual),
        categoria: "operacao",
        delta: { valor: d.roi, tipo: "pp" },
      },
      {
        chave: "ads",
        rotulo: "Gasto em anúncios",
        valor: formatBRL(k.valorAdsCentavos),
        categoria: "ads",
        delta: { valor: d.valorAds, tipo: "percent", inverso: true },
      },
    ],
    mpa: {
      valor: formatarPercentual(k.mpaPercentual),
      lucroPosAds: dinheiroOuNA(k.lucroPosAdsCentavos),
      delta: { valor: d.lucroPosAds, tipo: "percent" },
    },
  };
}
