"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Activity, AlertCircle, CheckCircle2, Database, RefreshCw } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { fetchJSON } from "@/lib/fetcher";

type Health = {
  ok: boolean;
  db: { ok: boolean; error: string | null };
  worker: { lastHeartbeatAt: string | null; ageSec: number | null; ok: boolean };
  queue: Record<string, number>;
  quota: {
    total: number;
    cooldowns: Array<{ operation: string; nextAllowedAt: string }>;
  };
  lastSync: Record<
    string,
    { tipo: string; status: string; registros: number; createdAt: string }
  >;
  version: string;
};

type DbStats = {
  ok: boolean;
  dbSizeBytes: number | null;
  tables: Array<{ table: string; rows: number; sizeBytes: number }>;
  counts: {
    notificacoesTotais: number;
    notificacoesNaoLidas: number;
    settlementsProcessados: number;
    contasReceberPendentes: number;
    buyboxSnapshots: number;
  };
};

type Quota = {
  operation: string;
  nextAllowedAt: string | null;
  rateLimitPerSecond: number | null;
  observedRps: number | null;
  lastStatus: number | null;
  lastError: string | null;
};

type QueueDetails = {
  queued: number;
  running: number;
  failed: number;
  lastJobs: Array<{
    id: string;
    tipo: string;
    status: string;
    attempts: number;
    error: string | null;
    finishedAt: string | null;
    createdAt: string;
  }>;
};

function formatBytes(bytes: number | null) {
  if (!bytes && bytes !== 0) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let v = bytes;
  let i = 0;
  while (v > 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v < 10 ? 1 : 0)} ${units[i]}`;
}

function relTime(iso: string | null) {
  if (!iso) return "—";
  return formatDistanceToNow(new Date(iso), { locale: ptBR, addSuffix: true });
}

export default function SistemaPage() {
  const health = useQuery<Health>({
    queryKey: ["sistema-health"],
    queryFn: () => fetchJSON("/api/health"),
    refetchInterval: 15000,
  });
  const stats = useQuery<DbStats>({
    queryKey: ["sistema-db-stats"],
    queryFn: () => fetchJSON("/api/sistema/db-stats"),
    refetchInterval: 60000,
  });
  const quota = useQuery<Quota[]>({
    queryKey: ["sistema-quota"],
    queryFn: () => fetchJSON("/api/amazon/quota"),
    refetchInterval: 15000,
  });
  const jobs = useQuery<QueueDetails>({
    queryKey: ["sistema-jobs"],
    queryFn: () => fetchJSON("/api/amazon/jobs"),
    refetchInterval: 10000,
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Saúde do Sistema"
        description="Status do worker, quotas SP-API, fila de jobs e banco."
      />

      {/* Linha 1: Status geral */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="p-4">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Database className="size-4" /> Banco
          </div>
          <div className="text-2xl font-semibold mt-1">
            {health.data?.db.ok ? (
              <span className="text-emerald-600">OK</span>
            ) : (
              <span className="text-red-600">ERRO</span>
            )}
          </div>
          {stats.data?.dbSizeBytes !== undefined && (
            <div className="text-xs text-muted-foreground mt-1">
              {formatBytes(stats.data.dbSizeBytes)}
            </div>
          )}
        </Card>

        <Card className="p-4">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Activity className="size-4" /> Worker
          </div>
          <div className="text-2xl font-semibold mt-1">
            {health.data?.worker.ok ? (
              <span className="text-emerald-600">Vivo</span>
            ) : (
              <span className="text-amber-600">Inativo</span>
            )}
          </div>
          <div className="text-xs text-muted-foreground mt-1">
            Heartbeat {relTime(health.data?.worker.lastHeartbeatAt ?? null)}
          </div>
        </Card>

        <Card className="p-4">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <RefreshCw className="size-4" /> Fila
          </div>
          <div className="text-2xl font-semibold mt-1">
            {jobs.data?.queued ?? 0} <span className="text-base text-muted-foreground">na fila</span>
          </div>
          <div className="text-xs text-muted-foreground mt-1">
            {jobs.data?.running ?? 0} rodando · {jobs.data?.failed ?? 0} falhas
          </div>
        </Card>

        <Card className="p-4">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <AlertCircle className="size-4" /> Quotas em cooldown
          </div>
          <div className="text-2xl font-semibold mt-1">
            {health.data?.quota.cooldowns.length ?? 0}
            <span className="text-base text-muted-foreground"> / {health.data?.quota.total ?? 0}</span>
          </div>
          <div className="text-xs text-muted-foreground mt-1">Versão: {health.data?.version ?? "—"}</div>
        </Card>
      </div>

      {/* Última sincronização por tipo */}
      <Card className="p-4">
        <h3 className="text-sm font-semibold mb-3">Última sincronização por tipo</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {Object.values(health.data?.lastSync ?? {}).map((s) => (
            <div key={s.tipo} className="border rounded-md p-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium">{s.tipo}</span>
                <Badge variant={s.status === "SUCESSO" ? "default" : s.status === "ERRO" ? "destructive" : "secondary"}>
                  {s.status}
                </Badge>
              </div>
              <div className="text-xs text-muted-foreground mt-1">
                {s.registros} registros · {relTime(s.createdAt)}
              </div>
            </div>
          ))}
          {!Object.keys(health.data?.lastSync ?? {}).length && (
            <div className="text-xs text-muted-foreground">Sem syncs registrados ainda.</div>
          )}
        </div>
      </Card>

      {/* Quotas SP-API */}
      <Card className="p-4">
        <h3 className="text-sm font-semibold mb-3">Quotas SP-API</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="border-b text-left text-muted-foreground">
              <tr>
                <th className="py-2">Operação</th>
                <th className="py-2">RPS default</th>
                <th className="py-2">RPS observado</th>
                <th className="py-2">Próximo slot</th>
                <th className="py-2">Último status</th>
              </tr>
            </thead>
            <tbody>
              {(quota.data ?? []).map((q) => {
                const cooling = q.nextAllowedAt && new Date(q.nextAllowedAt) > new Date();
                return (
                  <tr key={q.operation} className="border-b last:border-0">
                    <td className="py-2 font-mono">{q.operation}</td>
                    <td className="py-2">{q.rateLimitPerSecond?.toFixed(4) ?? "—"}</td>
                    <td className="py-2">
                      {q.observedRps ? (
                        <span className="text-emerald-600">{q.observedRps.toFixed(4)}</span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="py-2">
                      {cooling ? (
                        <span className="text-amber-600">{relTime(q.nextAllowedAt)}</span>
                      ) : (
                        <span className="text-emerald-600">livre</span>
                      )}
                    </td>
                    <td className="py-2">{q.lastStatus ?? "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Últimos jobs */}
      <Card className="p-4">
        <h3 className="text-sm font-semibold mb-3">Últimos jobs (20 mais recentes)</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="border-b text-left text-muted-foreground">
              <tr>
                <th className="py-2">Tipo</th>
                <th className="py-2">Status</th>
                <th className="py-2">Tentativas</th>
                <th className="py-2">Quando</th>
                <th className="py-2">Erro</th>
              </tr>
            </thead>
            <tbody>
              {(jobs.data?.lastJobs ?? []).map((j) => (
                <tr key={j.id} className="border-b last:border-0">
                  <td className="py-2 font-mono">{j.tipo}</td>
                  <td className="py-2">
                    <Badge
                      variant={
                        j.status === "SUCCESS"
                          ? "default"
                          : j.status === "FAILED"
                          ? "destructive"
                          : j.status === "RUNNING"
                          ? "secondary"
                          : "outline"
                      }
                    >
                      {j.status}
                    </Badge>
                  </td>
                  <td className="py-2">{j.attempts}</td>
                  <td className="py-2">{relTime(j.finishedAt ?? j.createdAt)}</td>
                  <td className="py-2 max-w-[300px] truncate text-red-600">
                    {j.error ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Banco — top tabelas */}
      <Card className="p-4">
        <h3 className="text-sm font-semibold mb-3">Top tabelas do banco</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="border-b text-left text-muted-foreground">
              <tr>
                <th className="py-2">Tabela</th>
                <th className="py-2">Linhas</th>
                <th className="py-2">Tamanho</th>
              </tr>
            </thead>
            <tbody>
              {(stats.data?.tables ?? []).map((t) => (
                <tr key={t.table} className="border-b last:border-0">
                  <td className="py-2 font-mono">{t.table}</td>
                  <td className="py-2">{t.rows.toLocaleString("pt-BR")}</td>
                  <td className="py-2">{formatBytes(t.sizeBytes)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-3 grid grid-cols-2 md:grid-cols-5 gap-2 text-xs text-muted-foreground">
          <div>Notificações: <CheckCircle2 className="inline size-3" /> {stats.data?.counts.notificacoesTotais ?? 0}</div>
          <div>Não lidas: {stats.data?.counts.notificacoesNaoLidas ?? 0}</div>
          <div>Settlements: {stats.data?.counts.settlementsProcessados ?? 0}</div>
          <div>Contas pendentes: {stats.data?.counts.contasReceberPendentes ?? 0}</div>
          <div>BuyBox snapshots: {stats.data?.counts.buyboxSnapshots ?? 0}</div>
        </div>
      </Card>
    </div>
  );
}
