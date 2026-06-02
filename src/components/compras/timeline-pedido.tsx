import * as React from "react";
import { CheckCircle2, Circle, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatData } from "@/lib/date";
import { StatusPedidoCompra } from "@/modules/shared/domain";

type Props = {
  status: string;
  dataEmissao: string;
  dataPrevisao: string | null;
  dataRecebimento: string | null;
};

/**
 * Linha do tempo do pedido de compra: Emitido → Confirmado → Recebido.
 * Pedidos cancelados mostram um aviso dedicado. Não há data de confirmação
 * persistida no modelo, então o marco "Confirmado" exibe apenas o check.
 */
export function TimelinePedido({
  status,
  dataEmissao,
  dataPrevisao,
  dataRecebimento,
}: Props) {
  if (status === StatusPedidoCompra.CANCELADO) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm">
        <XCircle className="h-5 w-5 text-destructive" />
        <span className="font-medium text-destructive">Pedido cancelado</span>
        <span className="text-muted-foreground">
          · emitido em {formatData(new Date(dataEmissao))}
        </span>
      </div>
    );
  }

  const confirmado =
    status === StatusPedidoCompra.CONFIRMADO ||
    status === StatusPedidoCompra.RECEBIDO;
  const recebido = status === StatusPedidoCompra.RECEBIDO;

  const marcos: Array<{ label: string; done: boolean; data: string | null; hint?: string }> = [
    { label: "Emitido", done: true, data: dataEmissao },
    { label: "Confirmado", done: confirmado, data: null },
    {
      label: "Recebido",
      done: recebido,
      data: recebido ? dataRecebimento : dataPrevisao,
      hint: recebido ? undefined : dataPrevisao ? "previsão" : undefined,
    },
  ];

  return (
    <div className="rounded-xl border bg-card p-5">
      <div className="flex items-center">
        {marcos.map((m, i) => (
          <React.Fragment key={m.label}>
            <div className="flex flex-col items-center gap-1 text-center">
              <span
                className={cn(
                  "flex h-8 w-8 items-center justify-center rounded-full border-2",
                  m.done
                    ? "border-emerald-500 bg-emerald-500 text-white"
                    : "border-muted-foreground/30 text-muted-foreground",
                )}
              >
                {m.done ? <CheckCircle2 className="h-4 w-4" /> : <Circle className="h-3 w-3" />}
              </span>
              <span
                className={cn(
                  "text-xs font-medium",
                  m.done ? "text-foreground" : "text-muted-foreground",
                )}
              >
                {m.label}
              </span>
              {m.data && (
                <span className="text-[10px] text-muted-foreground">
                  {m.hint ? `${m.hint} ` : ""}
                  {formatData(new Date(m.data))}
                </span>
              )}
            </div>
            {i < marcos.length - 1 && (
              <div
                className={cn(
                  "mx-2 h-0.5 flex-1",
                  marcos[i + 1]!.done ? "bg-emerald-500" : "bg-muted",
                )}
              />
            )}
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}
