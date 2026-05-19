import { db } from "@/lib/db";
import {
  findCommissionRule,
  formatCommissionRule,
} from "@/modules/produtos/commission-table";
import {
  estimarFeesVenda,
  loadFeeEstimatorConfig,
} from "@/modules/produtos/fee-estimator";
import { isVendaAmazonPrincipal } from "@/modules/vendas/filtros";
import { normalizarCentavos, valorBrutoDaVenda } from "@/modules/vendas/valores";

export type CategoriaTaxaEstimada = {
  slug: string | null;
  label: string;
  regra: string;
};

export type VendaParaEstimarTaxa = {
  sku: string;
  amazonOrderId?: string | null;
  marketplace?: string | null;
  statusPedido?: string | null;
  statusFinanceiro?: string | null;
  quantidade?: number | null;
  precoUnitarioCentavos?: number | null;
  valorBrutoCentavos?: number | null;
  taxasCentavos?: number | null;
  fretesCentavos?: number | null;
  liquidoMarketplaceCentavos?: number | null;
};

export type VendaComTaxaEstimada<T extends VendaParaEstimarTaxa> = T & {
  taxasEstimadas?: boolean;
  categoriaTaxaEstimada?: CategoriaTaxaEstimada;
};

export function deveExibirTaxaEstimadaVenda(
  venda: VendaParaEstimarTaxa,
): boolean {
  return (
    normalizarCentavos(venda.taxasCentavos) <= 0 &&
    valorBrutoDaVenda(venda) > 0 &&
    isVendaAmazonPrincipal(venda)
  );
}

export function buildCategoriaTaxaEstimada(
  categoriaSlug: string | null | undefined,
  defaultBps: number,
): CategoriaTaxaEstimada {
  const rule = findCommissionRule(categoriaSlug);
  if (rule) {
    return {
      slug: rule.slug,
      label: rule.label,
      regra: formatCommissionRule(rule),
    };
  }

  return {
    slug: null,
    label: "Default global",
    regra: `${formatBps(defaultBps)}`,
  };
}

export async function enriquecerVendasComTaxasEstimadas<
  T extends VendaParaEstimarTaxa,
>(vendas: T[]): Promise<Array<VendaComTaxaEstimada<T>>> {
  const candidatas = vendas.filter(deveExibirTaxaEstimadaVenda);
  if (candidatas.length === 0) return vendas;

  const skus = [...new Set(candidatas.map((venda) => venda.sku))];
  const produtos = await db.produto.findMany({
    where: { sku: { in: skus } },
    select: { id: true, sku: true, amazonCategoriaFee: true },
  });
  const produtoBySku = new Map(
    produtos.map((produto) => [
      produto.sku,
      {
        id: produto.id,
        categoriaSlug: produto.amazonCategoriaFee,
      },
    ]),
  );
  if (produtoBySku.size === 0) return vendas;

  const cfg = await loadFeeEstimatorConfig();

  return Promise.all(
    vendas.map(async (venda) => {
      if (!deveExibirTaxaEstimadaVenda(venda)) return venda;

      const produto = produtoBySku.get(venda.sku);
      if (!produto) return venda;

      const bruto = valorBrutoDaVenda(venda);
      const est = await estimarFeesVenda({
        produtoId: produto.id,
        valorBrutoCentavos: bruto,
        quantidade: venda.quantidade ?? 1,
        taxasReaisCentavos: normalizarCentavos(venda.taxasCentavos),
        categoriaSlug: produto.categoriaSlug,
        cfg,
      });

      return {
        ...venda,
        taxasCentavos: est.taxasCentavos,
        liquidoMarketplaceCentavos:
          bruto - est.taxasCentavos - normalizarCentavos(venda.fretesCentavos),
        taxasEstimadas: true,
        categoriaTaxaEstimada: buildCategoriaTaxaEstimada(
          produto.categoriaSlug,
          cfg.referralDefaultBps,
        ),
      };
    }),
  );
}

function formatBps(bps: number): string {
  return `${(bps / 100).toLocaleString("pt-BR", {
    maximumFractionDigits: 2,
  })}%`;
}
