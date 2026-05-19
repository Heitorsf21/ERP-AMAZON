import { cn } from "@/lib/utils";
import type { VendaListagem } from "./types";
import { statusToVisual } from "@/lib/vendas-status";

/**
 * Painel esquerdo do card expandido. Contém:
 *   - Dois blocos lado a lado: "Data de criação" e "Data de aprovação"
 *   - Bloco unificado: ID do pedido, ASIN, SKU interno, Conta · MKT, Logística
 *
 * "Data de aprovação" hoje não é distinguida do `dataVenda` no schema —
 * exibimos "—" como placeholder quando a venda ainda está pendente.
 */
export function OrderCardDetails({
  venda,
  logisticaLabel,
}: {
  venda: VendaListagem;
  logisticaLabel: string;
}) {
  const visual = statusToVisual(venda.statusPedido, venda.statusFinanceiro);
  const dataVenda = new Date(venda.dataVenda);

  const dataCriacao = dataVenda.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZone: "America/Sao_Paulo",
  });

  const dataAprovacao = visual === "done" || visual === "refund"
    ? venda.ultimaSyncEm
      ? new Date(venda.ultimaSyncEm).toLocaleString("pt-BR", {
          day: "2-digit",
          month: "2-digit",
          year: "numeric",
          hour: "2-digit",
          minute: "2-digit",
          timeZone: "America/Sao_Paulo",
        })
      : "Aprovado"
    : visual === "cancel"
      ? "Cancelado"
      : "—";

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <DetailBlock label="Data de criação" value={dataCriacao} />
        <DetailBlock
          label={visual === "cancel" ? "Data de cancelamento" : "Data de aprovação"}
          value={dataAprovacao}
          muted={dataAprovacao === "—"}
        />
      </div>

      <div className="rounded-lg border bg-card p-4">
        <Row k="ID do pedido" v={venda.amazonOrderId} mono />
        {venda.produtoAsin && <Row k="ASIN" v={venda.produtoAsin} mono />}
        <Row k="SKU interno" v={venda.sku} mono />
        <Row
          k="Conta · MKT"
          v={`Amazon BR · ${venda.marketplace ?? venda.fulfillmentChannel ?? "—"}`}
        />
        <Row k="Logística" v={logisticaLabel} />
      </div>
    </div>
  );
}

function DetailBlock({
  label,
  value,
  muted,
}: {
  label: string;
  value: string;
  muted?: boolean;
}) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p
        className={cn(
          "mt-1 text-sm font-medium",
          muted ? "text-muted-foreground" : "text-foreground",
        )}
      >
        {value}
      </p>
    </div>
  );
}

function Row({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-dashed py-1.5 last:border-b-0">
      <span className="text-xs font-medium text-muted-foreground">{k}</span>
      <span
        className={cn(
          "truncate text-right text-sm font-semibold text-foreground",
          mono && "font-mono text-[12.5px]",
        )}
        title={v}
      >
        {v}
      </span>
    </div>
  );
}
