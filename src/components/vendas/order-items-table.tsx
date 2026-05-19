import { MarginBadge } from "@/components/ui/margin-badge";
import { ProductThumb } from "@/components/ui/product-thumb";
import { formatBRL } from "@/lib/money";
import { cn } from "@/lib/utils";
import type { BreakdownVendaPayload, VendaListagem } from "./types";

/**
 * Tabela horizontal de 1 linha que reproduz o layout do print do Gestor
 * Seller dentro de cada card de pedido.
 *
 * Colunas: Item · Qtd · Total · Preço unit. · Líq. marketplace · Imposto
 *          · Custo produto · Custo extra · Lucro · Margem
 *
 * Quando `breakdown` é `no_data` (pedido cancelado sem movimentação),
 * exibe traços nas colunas financeiras.
 */
export function OrderItemsTable({
  venda,
  breakdown,
}: {
  venda: VendaListagem;
  breakdown: BreakdownVendaPayload | null;
}) {
  const semDados = breakdown == null || breakdown.origem === "no_data";

  const liquidoMarketplace = breakdown
    ? breakdown.totalItensCentavos
      + breakdown.freteRecebidoCentavos
      - breakdown.fretePagoCentavos
      - breakdown.comissaoCentavos
      - breakdown.taxaFbaCentavos
      - breakdown.taxaParcelamentoCentavos
      - breakdown.closingFeeCentavos
      - breakdown.promoRebatesCentavos
    : 0;

  const precoUnitario = venda.precoUnitarioCentavos > 0
    ? venda.precoUnitarioCentavos
    : Math.round(venda.totalCentavos / Math.max(1, venda.quantidade));

  const margemPercent = breakdown && breakdown.margemBps !== 0
    ? breakdown.margemBps / 100
    : null;

  return (
    <div className="w-full overflow-x-auto">
      <table className="w-full min-w-[1100px] border-collapse text-sm">
        <thead>
          <tr className="border-b bg-muted/30 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            <th className="px-3 py-2 text-left">Item</th>
            <th className="px-3 py-2 text-right">Qtd</th>
            <th className="px-3 py-2 text-right">Total</th>
            <th className="px-3 py-2 text-right">Preço unit.</th>
            <th className="px-3 py-2 text-right">Líq. marketplace</th>
            <th className="px-3 py-2 text-right">Imposto</th>
            <th className="px-3 py-2 text-right">Custo produto</th>
            <th className="px-3 py-2 text-right">Custo extra</th>
            <th className="px-3 py-2 text-right">Lucro</th>
            <th className="px-3 py-2 text-right">Margem</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td className="px-3 py-3">
              <div className="flex items-center gap-3">
                <ProductThumb
                  src={venda.produtoImagemUrl ?? null}
                  alt={venda.titulo ?? venda.sku}
                  size={40}
                  title={venda.titulo ?? venda.sku}
                />
                <div className="min-w-0">
                  <p
                    className="line-clamp-1 text-sm font-medium text-foreground"
                    title={venda.titulo ?? ""}
                  >
                    {venda.titulo ?? venda.sku}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    SKU Externo: <span className="font-mono">{venda.sku}</span>
                  </p>
                </div>
              </div>
            </td>
            <Cell numeric>{venda.quantidade}</Cell>
            <Cell numeric>{semDados ? "—" : formatBRL(venda.totalCentavos)}</Cell>
            <Cell numeric>{semDados ? "—" : formatBRL(precoUnitario)}</Cell>
            <Cell numeric>{semDados ? "—" : formatBRL(liquidoMarketplace)}</Cell>
            <Cell numeric muted>
              {semDados ? "—" : formatBRL(breakdown.impostoCentavos)}
            </Cell>
            <Cell numeric muted>
              {semDados ? "—" : formatBRL(breakdown.custoProdutoCentavos)}
            </Cell>
            <Cell numeric muted>
              {semDados || breakdown.custoExtraCentavos === 0
                ? "—"
                : formatBRL(breakdown.custoExtraCentavos)}
            </Cell>
            <Cell
              numeric
              className={
                semDados
                  ? "text-muted-foreground"
                  : breakdown.lucroCentavos >= 0
                    ? "font-semibold text-emerald-600 dark:text-emerald-400"
                    : "font-semibold text-red-600 dark:text-red-400"
              }
            >
              {semDados ? "—" : formatBRL(breakdown.lucroCentavos)}
            </Cell>
            <td className="px-3 py-3 text-right">
              <MarginBadge value={margemPercent} />
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function Cell({
  children,
  numeric,
  muted,
  className,
}: {
  children: React.ReactNode;
  numeric?: boolean;
  muted?: boolean;
  className?: string;
}) {
  return (
    <td
      className={cn(
        "px-3 py-3 align-middle",
        numeric && "text-right tabular-nums",
        muted && "text-muted-foreground",
        className,
      )}
    >
      {children}
    </td>
  );
}
