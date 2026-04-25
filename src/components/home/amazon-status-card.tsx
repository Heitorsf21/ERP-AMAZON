"use client";

import Link from "next/link";
import type { Route } from "next";
import { useQuery } from "@tanstack/react-query";
import { Globe, CheckCircle2, XCircle, Clock, ArrowRight } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { fetchJSON } from "@/lib/fetcher";
import { formatInTimeZone } from "date-fns-tz";
import { cn } from "@/lib/utils";

const TZ = "America/Sao_Paulo";

type SyncLog = {
  id: string;
  tipo: string;
  status: "SUCESSO" | "ERRO" | "EM_ANDAMENTO" | string;
  iniciadoEm?: string | null;
  finalizadoEm?: string | null;
  createdAt?: string | null;
  registrosProcessados?: number | null;
  registros?: number | null;
  erro?: string | null;
  mensagem?: string | null;
};

export function AmazonStatusCard() {
  const { data, isLoading, isError } = useQuery<SyncLog[]>({
    queryKey: ["amazon-status"],
    queryFn: () => fetchJSON<SyncLog[]>("/api/amazon/status"),
    refetchInterval: 60_000,
  });

  const ultima = data?.[0];

  return (
    <Card className="overflow-hidden">
      <CardContent className="p-5">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Globe className="h-[18px] w-[18px]" />
            </div>
            <div>
              <h3 className="text-sm font-semibold">Integração Amazon</h3>
              <p className="text-xs text-muted-foreground">SP-API · Gestor Seller</p>
            </div>
          </div>
          <Link
            href={"/amazon" as Route}
            className="flex items-center gap-1 text-xs text-primary transition-colors hover:underline"
          >
            Abrir <ArrowRight className="h-3 w-3" />
          </Link>
        </div>

        <div className="mt-4 border-t pt-4">
          {isLoading && <Skeleton className="h-10 w-full" />}
          {isError && (
            <div className="flex items-center gap-2 text-xs text-destructive">
              <XCircle className="h-4 w-4" />
              Não foi possível carregar o status.
            </div>
          )}
          {!isLoading && !isError && !ultima && (
            <div className="rounded-md border border-dashed bg-muted/20 p-3 text-center text-xs text-muted-foreground">
              Nenhuma sincronização registrada ainda.
            </div>
          )}
          {!isLoading && !isError && ultima && <UltimaSync log={ultima} />}
        </div>
      </CardContent>
    </Card>
  );
}

function UltimaSync({ log }: { log: SyncLog }) {
  const iconeStatus =
    log.status === "SUCESSO" ? (
      <CheckCircle2 className="h-4 w-4 text-success" />
    ) : log.status === "ERRO" ? (
      <XCircle className="h-4 w-4 text-destructive" />
    ) : (
      <Clock className="h-4 w-4 text-warning" />
    );

  const rotuloStatus =
    log.status === "SUCESSO"
      ? "Sucesso"
      : log.status === "ERRO"
        ? "Falha"
        : "Em andamento";

  const quando = formatarDataSync(log.iniciadoEm ?? log.createdAt);
  const registros = log.registrosProcessados ?? log.registros;
  const erro = log.erro ?? log.mensagem;

  return (
    <div className="space-y-2 text-xs">
      <div className="flex items-center justify-between">
        <span className="text-muted-foreground">Última sync ({log.tipo})</span>
        <span className="inline-flex items-center gap-1.5 font-medium">
          {iconeStatus}
          <span
            className={cn(
              log.status === "SUCESSO" && "text-success",
              log.status === "ERRO" && "text-destructive",
              log.status === "EM_ANDAMENTO" && "text-warning",
            )}
          >
            {rotuloStatus}
          </span>
        </span>
      </div>
      <div className="flex items-center justify-between text-muted-foreground">
        <span>{quando}</span>
        {registros != null && (
          <span>{registros} registros</span>
        )}
      </div>
      {log.status === "ERRO" && erro && (
        <p className="rounded border border-destructive/30 bg-destructive/5 p-2 text-[11px] text-destructive">
          {erro}
        </p>
      )}
    </div>
  );
}

function formatarDataSync(value?: string | null): string {
  if (!value) return "Data indisponivel";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Data indisponivel";

  return formatInTimeZone(date, TZ, "dd/MM 'as' HH:mm");
}
