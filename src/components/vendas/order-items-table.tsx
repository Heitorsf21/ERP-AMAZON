import { MarginBadge } from "@/components/ui/margin-badge";
import { ProductThumb } from "@/components/ui/product-thumb";
import { formatBRL } from "@/lib/money";
import { cn } from "@/lib/utils";
import type { BreakdownVendaPayload, VendaListagem } from "./types";

/**
 * Linha de venda dentro do card — sempre visível, mesmo colapsado.
 *
 * Layout 2-row responsivo (sem `<table>`, sem scroll horizontal):
 *
 *   Linha 1 (sempre cabe):
 *     [thumb 40px] Nome do produto … [qtd × precoUnit] [MarginBadge]
 *                  SKU Externo: MFS-0033
 *
 *   Linha 2 (grid de mini-KPIs):
 *     [Total] [Líq. mkt] [Imposto] [Custo] [Lucro]
 *
 *   - md (≥768px): grid-cols-5 em linha
 *   - sm (≥640px): grid-cols-3 (2 linhas)
 *   - mobile (<640px): grid-cols-2 (3 linhas)
 *
 * "Custo extra" e "Preço unit." vivem apenas no painel expandido. Quando
 * `breakdown.origem === "no_data"` mostra traços nos KPIs.
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

  const lucroVal = semDados ? "—" : formatBRL(breakdown.lucroCentavos);
  const lucroTone = semDados
    ? "text-muted-foreground"
    : breakdown.lucroCentavos >= 0
      ? "text-emerald-600 dark:text-emerald-400"
      : "text-red-600 dark:text-red-400";

  return (
    <div className="flex flex-col gap-3 px-4 py-3 sm:px-5">
      {/* Linha 1 — produto + qtd + margem */}
      <div className="flex flex-wrap items-center gap-3">
        <ProductThumb
          src={venda.produtoImagemUrl ?? null}
          alt={venda.titulo ?? venda.sku}
          size={40}
          title={venda.titulo ?? venda.sku}
        />
        <div className="min-w-0 flex-1">
          <p
            className="line-clamp-1 text-sm font-medium text-foreground"
            title={venda.titulo ?? ""}
          >
            {venda.titulo ?? venda.sku}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            SKU Externo:{" "}
            <span className="font-mono text-foreground/80">{venda.sku}</span>
            <span className="mx-1.5 text-muted-foreground/50">·</span>
            {venda.quantidade}× {formatBRL(precoUnitario)}
          </p>
        </div>
        <MarginBadge value={margemPercent} className="shrink-0" />
      </div>

      {/* Linha 2 — mini-KPIs */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-5">
        <KpiTile
          label="Total"
          value={semDados ? "—" : formatBRL(venda.totalCentavos)}
        />
        <KpiTile
          label="Líq. mkt"
          value={semDados ? "—" : formatBRL(liquidoMarketplace)}
        />
        <KpiTile
          label="Imposto"
          value={semDados ? "—" : formatBRL(breakdown.impostoCentavos)}
          muted
        />
        <KpiTile
          label="Custo"
          value={semDados ? "—" : formatBRL(breakdown.custoProdutoCentavos)}
          muted
        />
        <KpiTile label="Lucro" value={lucroVal} valueClassName={lucroTone} />
      </div>
    </div>
  );
}

function KpiTile({
  label,
  value,
  muted,
  valueClassName,
}: {
  label: string;
  value: string;
  muted?: boolean;
  valueClassName?: string;
}) {
  return (
    <div className="rounded-md border bg-card/50 px-3 py-2">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p
        className={cn(
          "mt-0.5 text-sm font-semibold tabular-nums",
          muted ? "text-foreground/80" : "text-foreground",
          valueClassName,
        )}
      >
        {value}
      </p>
    </div>
  );
}
