"use client";

import {
  CreditCard,
  DollarSign,
  FileText,
  Info,
  Package,
  Percent,
  Plus,
  ShoppingCart,
  Truck,
  XCircle,
} from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { formatBRL } from "@/lib/money";
import { cn } from "@/lib/utils";
import type { BreakdownVendaPayload } from "./types";

/**
 * Painel "Breakdown Financeiro" exibido à direita do card expandido,
 * replicando o layout do print do Gestor Seller.
 *
 * Linhas:
 *   - Total dos itens (+, verde)
 *   - Valor recebido frete (+, verde) — apenas quando freteRecebido > 0
 *   - Valor pago frete (−, vermelho) — apenas quando fretePago > 0
 *   - Comissão (−)
 *   - Taxa FBA (−)
 *   - Taxa parcelamento (−) — só visível para vendas settled
 *   - Closing fee (−) — só quando > 0
 *   - Desconto de oferta (PromoRebates, −) — só quando > 0
 *   - Imposto (−)
 *   - Custo dos produtos (−)
 *   - botão placeholder "Adicionar custo eventual"
 *   - Lucro do pedido (destaque verde, ou vermelho quando negativo)
 *
 * Quando `breakdown.origem === "estimated"`, um Info-tooltip explica que os
 * valores são estimativas. Quando `origem === "no_data"`, exibe caixa
 * vermelha com aviso "sem movimentação".
 */
export function OrderCardBreakdown({
  breakdown,
}: {
  breakdown: BreakdownVendaPayload;
}) {
  if (breakdown.origem === "no_data") {
    return (
      <aside className="rounded-lg border bg-muted/30 p-4">
        <Header titulo="Breakdown financeiro" estimated={false} />
        <div className="mt-3 flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-950 dark:bg-red-950/30 dark:text-red-400">
          <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <p>
            Pedido cancelado. Nenhum valor foi cobrado nem repassado pela
            Amazon.
          </p>
        </div>
        <TotalRow
          label="Sem movimentação"
          value={0}
          loss
        />
      </aside>
    );
  }

  const lossy = breakdown.lucroCentavos < 0;

  return (
    <aside className="rounded-lg border bg-muted/30 p-4">
      <Header
        titulo="Breakdown financeiro"
        estimated={breakdown.origem === "estimated"}
        categoria={breakdown.categoriaTaxaLabel}
      />

      <ul className="mt-3 flex flex-col gap-0.5 text-sm">
        <Line
          icon={ShoppingCart}
          label="Total dos itens"
          value={breakdown.totalItensCentavos}
          variant="pos"
        />
        {breakdown.freteRecebidoCentavos > 0 && (
          <Line
            icon={Truck}
            label="Valor recebido frete"
            sub="recebido da plataforma"
            value={breakdown.freteRecebidoCentavos}
            variant="pos"
          />
        )}
        {breakdown.fretePagoCentavos > 0 && (
          <Line
            icon={Truck}
            label="Valor pago frete"
            sub="descontado pela plataforma"
            value={breakdown.fretePagoCentavos}
            variant="neg"
          />
        )}
        <Line
          icon={Percent}
          label="Comissão"
          value={breakdown.comissaoCentavos}
          variant="neg"
        />
        <Line
          icon={CreditCard}
          label="Taxa FBA"
          value={breakdown.taxaFbaCentavos}
          variant="neg"
        />
        {breakdown.taxaParcelamentoCentavos > 0 && (
          <Line
            icon={CreditCard}
            label="Taxa parcelamento"
            value={breakdown.taxaParcelamentoCentavos}
            variant="neg"
          />
        )}
        {breakdown.closingFeeCentavos > 0 && (
          <Line
            icon={FileText}
            label="Closing fee"
            value={breakdown.closingFeeCentavos}
            variant="neg"
          />
        )}
        {breakdown.promoRebatesCentavos > 0 && (
          <Line
            icon={Percent}
            label="Desconto de oferta"
            value={breakdown.promoRebatesCentavos}
            variant="neg"
          />
        )}
        <Line
          icon={FileText}
          label="Imposto"
          value={breakdown.impostoCentavos}
          variant="neg"
        />
        <Line
          icon={Package}
          label="Custo dos produtos"
          value={breakdown.custoProdutoCentavos}
          variant="neg"
        />
      </ul>

      <button
        type="button"
        disabled
        title="Em breve"
        className="mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-md border border-dashed border-emerald-300 px-3 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-emerald-900 dark:text-emerald-400 dark:hover:bg-emerald-950/30"
      >
        <Plus className="h-3 w-3" aria-hidden="true" />
        Adicionar custo eventual
      </button>

      <TotalRow
        label="Lucro do pedido"
        value={breakdown.lucroCentavos}
        loss={lossy}
      />
    </aside>
  );
}

function Header({
  titulo,
  estimated,
  categoria,
}: {
  titulo: string;
  estimated: boolean;
  categoria?: string | null;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <h4 className="text-[10px] font-bold uppercase tracking-[0.08em] text-muted-foreground">
        {titulo}
      </h4>
      {estimated && (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="inline-flex cursor-help items-center gap-1 rounded-md border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-400">
                <Info className="h-3 w-3" />
                Estimativa
              </span>
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-[220px] text-xs leading-snug">
              Venda ainda não liquidada pela Amazon. Comissão, FBA e Closing
              fee vêm da tabela de categorias.
              {categoria && (
                <span className="mt-1 block text-[10px] text-muted-foreground">
                  Categoria: {categoria}
                </span>
              )}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )}
    </div>
  );
}

function Line({
  icon: Icon,
  label,
  sub,
  value,
  variant,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  sub?: string;
  value: number;
  variant: "pos" | "neg";
}) {
  const sign = variant === "pos" ? "+" : "−";
  return (
    <li className="flex items-center gap-2.5 border-b border-dashed border-border/60 py-1.5 last:border-b-0">
      <span
        className={cn(
          "grid h-6 w-6 shrink-0 place-items-center rounded-md text-[12px]",
          variant === "pos"
            ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400"
            : "bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-400",
        )}
      >
        <Icon className="h-3 w-3" />
      </span>
      <span className="min-w-0 flex-1 text-xs">
        <span className="block text-foreground">{label}</span>
        {sub && (
          <span className="block text-[10px] text-muted-foreground">{sub}</span>
        )}
      </span>
      <span
        className={cn(
          "shrink-0 text-sm font-semibold tabular-nums",
          variant === "pos"
            ? "text-emerald-600 dark:text-emerald-400"
            : "text-red-600 dark:text-red-400",
        )}
      >
        {sign}
        {formatBRL(value)}
      </span>
    </li>
  );
}

function TotalRow({
  label,
  value,
  loss,
}: {
  label: string;
  value: number;
  loss: boolean;
}) {
  return (
    <div className="mt-3 flex items-center gap-2.5 border-t border-border pt-3">
      <span
        className={cn(
          "grid h-7 w-7 shrink-0 place-items-center rounded-md",
          loss
            ? "bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-400"
            : "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400",
        )}
      >
        <DollarSign className="h-3.5 w-3.5" />
      </span>
      <span className="flex-1 text-sm font-bold text-foreground">{label}</span>
      <span
        className={cn(
          "text-base font-bold tabular-nums",
          loss
            ? "text-red-600 dark:text-red-400"
            : "text-emerald-600 dark:text-emerald-400",
        )}
      >
        {formatBRL(value)}
      </span>
    </div>
  );
}
