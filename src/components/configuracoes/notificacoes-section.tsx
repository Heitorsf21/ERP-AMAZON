"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { fetchJSON } from "@/lib/fetcher";
import { TipoNotificacao } from "@/modules/shared/domain";

type Preferencias = Partial<Record<keyof typeof TipoNotificacao, boolean>>;
type StatusResponse = { preferencias: Preferencias };

const LABELS: Record<keyof typeof TipoNotificacao, { titulo: string; descricao: string }> = {
  ESTOQUE_CRITICO: {
    titulo: "Estoque critico",
    descricao: "SKUs cujo estoque caiu abaixo do minimo.",
  },
  BUYBOX_PERDIDO: {
    titulo: "Buybox perdido",
    descricao: "Outro vendedor passou a vencer o buybox.",
  },
  BUYBOX_RECUPERADO: {
    titulo: "Buybox recuperado",
    descricao: "Voltamos a vencer o buybox de um SKU.",
  },
  REEMBOLSO_ALTO: {
    titulo: "Reembolso alto",
    descricao: "Reembolsos acima do valor habitual para o SKU.",
  },
  ACOS_ALTO: {
    titulo: "ACOS alto",
    descricao: "Campanha com ACOS acima do esperado.",
  },
  LIQUIDACAO_ATRASADA: {
    titulo: "Liquidacao atrasada",
    descricao: "Liquidacao Amazon nao chegou na data prevista.",
  },
  CUSTO_AUSENTE: {
    titulo: "Custo ausente",
    descricao: "SKU sem custo cadastrado em compras recentes.",
  },
  JOB_FALHANDO: {
    titulo: "Job falhando",
    descricao: "Job de sincronizacao falhou repetidamente.",
  },
  QUOTA_BLOQUEADA: {
    titulo: "Quota Amazon bloqueada",
    descricao: "Operacao SP-API bloqueada por rate limit.",
  },
  SETTLEMENT_NOVO: {
    titulo: "Settlement novo",
    descricao: "Novo relatorio de settlement importado.",
  },
  RECEBIMENTO_RECONCILIADO: {
    titulo: "Recebimento reconciliado",
    descricao: "Conta a receber liquidada com movimentacao bancaria.",
  },
  WORKER_REINICIADO: {
    titulo: "Worker reiniciado",
    descricao: "Worker de jobs precisou ser reiniciado.",
  },
};

export function NotificacoesSection() {
  const qc = useQueryClient();

  const { data, isLoading } = useQuery<StatusResponse>({
    queryKey: ["notif-preferencias"],
    queryFn: () => fetchJSON<StatusResponse>("/api/configuracoes/notificacoes"),
  });

  const salvar = useMutation({
    mutationFn: (preferencias: Preferencias) =>
      fetchJSON("/api/configuracoes/notificacoes", {
        method: "POST",
        body: JSON.stringify({ preferencias }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["notif-preferencias"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Erro ao salvar"),
  });

  const preferencias = data?.preferencias ?? {};
  const tipos = Object.keys(LABELS) as Array<keyof typeof LABELS>;

  function toggle(key: keyof typeof TipoNotificacao, value: boolean) {
    const next = { ...preferencias, [key]: value };
    qc.setQueryData<StatusResponse>(["notif-preferencias"], { preferencias: next });
    salvar.mutate(next);
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Bell className="h-5 w-5" />
            </div>
            <div>
              <CardTitle className="text-base">Tipos de notificacao</CardTitle>
              <CardDescription>
                Escolha quais alertas devem aparecer no sino do ERP.
              </CardDescription>
            </div>
          </div>
          {salvar.isPending && (
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" /> salvando
            </span>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : (
          <div className="divide-y">
            {tipos.map((key) => {
              const meta = LABELS[key];
              const checked = preferencias[key] ?? true;
              return (
                <div
                  key={key}
                  className="flex items-start justify-between gap-4 py-3"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{meta.titulo}</p>
                    <p className="text-xs text-muted-foreground">{meta.descricao}</p>
                  </div>
                  <Switch
                    checked={checked}
                    onCheckedChange={(v) => toggle(key, v)}
                    aria-label={`Ativar ${meta.titulo}`}
                  />
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
