"use client";

import * as React from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  CreditCard,
  DollarSign,
  FileText,
  Info,
  Loader2,
  Megaphone,
  Package,
  Percent,
  ShoppingCart,
  Truck,
  X,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { MarginBadge, MPA_THRESHOLDS } from "@/components/ui/margin-badge";
import { formatBRL } from "@/lib/money";
import { cn } from "@/lib/utils";
import { DialogCustoEventual } from "./dialog-custo-eventual";
import type { BreakdownVendaPayload, CustoEventualPayload } from "./types";

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
 *   - Desconto de frete (PromoRebates > ShippingDiscount, −) — só quando > 0
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
  vendaId,
}: {
  breakdown: BreakdownVendaPayload;
  vendaId: string;
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
  const mpaPercent = breakdown.totalItensCentavos > 0
    ? breakdown.mpaBps / 100
    : null;

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
        {breakdown.descontoFreteCentavos > 0 && (
          <Line
            icon={Truck}
            label="Desconto de frete"
            sub="promoção aplicada no frete"
            value={breakdown.descontoFreteCentavos}
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
        {breakdown.taxasAmazonNaoDetalhadasCentavos > 0 && (
          <Line
            icon={FileText}
            label="Taxas Amazon não detalhadas"
            sub="AmazonFees sem sub-breakdown"
            value={breakdown.taxasAmazonNaoDetalhadasCentavos}
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
        {breakdown.custoAdsCentavos > 0 && (
          <Line
            icon={Megaphone}
            label="Custo Ads"
            sub="rateio Amazon Ads do SKU no dia"
            value={breakdown.custoAdsCentavos}
            variant="neg"
          />
        )}
      </ul>

      <CustosEventuaisLista
        vendaId={vendaId}
        custos={breakdown.custosEventuais}
      />

      <div className="mt-3">
        <DialogCustoEventual vendaId={vendaId} />
      </div>

      <TotalRow
        label="Lucro do pedido"
        value={breakdown.lucroCentavos}
        loss={lossy}
      />

      {breakdown.custoAdsCentavos > 0 && (
        <div className="mt-2 flex items-center gap-2.5 rounded-md border border-dashed border-border/60 bg-background/40 px-2.5 py-2">
          <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400">
            <Megaphone className="h-3 w-3" />
          </span>
          <span className="flex-1 text-xs">
            <span className="block font-medium text-foreground">
              Lucro pós Ads
            </span>
            <span className="block text-[10px] text-muted-foreground">
              após rateio de publicidade
            </span>
          </span>
          <span
            className={cn(
              "shrink-0 text-sm font-bold tabular-nums",
              breakdown.lucroPosAdsCentavos >= 0
                ? "text-emerald-600 dark:text-emerald-400"
                : "text-red-600 dark:text-red-400",
            )}
          >
            {formatBRL(breakdown.lucroPosAdsCentavos)}
          </span>
          <MarginBadge
            value={mpaPercent}
            thresholds={MPA_THRESHOLDS}
            prefix="MPA"
            className="shrink-0"
          />
        </div>
      )}
    </aside>
  );
}

function CustosEventuaisLista({
  vendaId,
  custos,
}: {
  vendaId: string;
  custos: CustoEventualPayload[];
}) {
  const queryClient = useQueryClient();
  const [removendoId, setRemovendoId] = React.useState<string | null>(null);

  const remover = useMutation({
    mutationFn: async (custoId: string) => {
      const res = await fetch(
        `/api/vendas/${vendaId}/custos-eventuais/${custoId}`,
        { method: "DELETE" },
      );
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.erro ?? "Erro ao remover custo");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["vendas"] });
      toast.success("Custo removido");
    },
    onError: (err) => toast.error(err.message),
    onSettled: () => setRemovendoId(null),
  });

  if (custos.length === 0) return null;

  return (
    <ul className="mt-3 space-y-1 border-t border-dashed border-border/60 pt-2 text-xs">
      {custos.map((c) => (
        <li
          key={c.id}
          className="flex items-center gap-2 rounded-md bg-background/60 px-2 py-1.5"
        >
          <span className="grid h-5 w-5 shrink-0 place-items-center rounded bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-400">
            <Package className="h-2.5 w-2.5" />
          </span>
          <span
            className="flex-1 truncate text-foreground"
            title={c.descricao}
          >
            {c.descricao}
          </span>
          <span className="shrink-0 tabular-nums font-semibold text-red-600 dark:text-red-400">
            −{formatBRL(c.valorCentavos)}
          </span>
          <button
            type="button"
            onClick={() => {
              setRemovendoId(c.id);
              remover.mutate(c.id);
            }}
            disabled={remover.isPending}
            className="grid h-5 w-5 shrink-0 place-items-center rounded text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
            aria-label="Remover custo"
            title="Remover"
          >
            {remover.isPending && removendoId === c.id ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <X className="h-3 w-3" />
            )}
          </button>
        </li>
      ))}
    </ul>
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
