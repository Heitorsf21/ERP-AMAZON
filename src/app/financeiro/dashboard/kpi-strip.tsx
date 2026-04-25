"use client";

import { useQuery } from "@tanstack/react-query";
import {
  Wallet,
  TrendingDown,
  ArrowDownToLine,
  TrendingUp,
} from "lucide-react";
import { KpiCard } from "@/components/ui/kpi-card";
import { fetchJSON } from "@/lib/fetcher";
import { formatBRL } from "@/lib/money";

type SaldoResposta = {
  atualCentavos: number;
};

type ContaPagar = {
  id: string;
  valor: number;
  vencimento: string;
  status: string;
};

type ContaReceber = {
  id: string;
  valor: number;
  dataPrevisao: string;
  status: string;
};

type DestinacaoResumo = {
  saldoProjetado: number;
};

function isoYYYYMMDD(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function inNextNDays(dateISO: string, n: number): boolean {
  const target = new Date(dateISO);
  if (Number.isNaN(target.getTime())) return false;
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  const limite = new Date(hoje);
  limite.setDate(limite.getDate() + n);
  // Inclui contas vencidas (passadas) também — relevante para "a pagar próximos 7d".
  return target.getTime() <= limite.getTime();
}

function inNextNDaysFuture(dateISO: string, n: number): boolean {
  const target = new Date(dateISO);
  if (Number.isNaN(target.getTime())) return false;
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  const limite = new Date(hoje);
  limite.setDate(limite.getDate() + n);
  return target.getTime() >= hoje.getTime() && target.getTime() <= limite.getTime();
}

export function KpiStrip() {
  const saldoQ = useQuery<SaldoResposta>({
    queryKey: ["kpi-strip", "saldo"],
    queryFn: () => fetchJSON<SaldoResposta>("/api/movimentacoes/saldo"),
  });

  // Filtra cliente-side por vencimento (próximos 7 dias, inclui já vencidas).
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  const ate = new Date(hoje);
  ate.setDate(ate.getDate() + 7);

  const contasPagarQ = useQuery<ContaPagar[]>({
    queryKey: ["kpi-strip", "contas-pagar-7d", isoYYYYMMDD(ate)],
    queryFn: () =>
      fetchJSON<ContaPagar[]>(
        `/api/contas?status=ABERTA&ate=${isoYYYYMMDD(ate)}`,
      ),
  });
  const contasVencidasQ = useQuery<ContaPagar[]>({
    queryKey: ["kpi-strip", "contas-vencidas"],
    queryFn: () => fetchJSON<ContaPagar[]>(`/api/contas?status=VENCIDA`),
  });

  const contasReceberQ = useQuery<ContaReceber[]>({
    queryKey: ["kpi-strip", "contas-receber"],
    queryFn: () =>
      fetchJSON<ContaReceber[]>(`/api/contas-a-receber?status=PENDENTE`),
  });

  const destinacaoQ = useQuery<DestinacaoResumo>({
    queryKey: ["kpi-strip", "destinacao"],
    queryFn: () => fetchJSON<DestinacaoResumo>("/api/destinacao/resumo"),
  });

  const saldoCaixa = saldoQ.data?.atualCentavos ?? 0;

  // "A pagar próx. 7d" = somatório das contas ABERTAS com vencimento até hoje+7
  // somado às VENCIDAS (já passadas) — todas fluxo de caixa imediato.
  const aPagarAbertas7d = (contasPagarQ.data ?? []).filter((c) =>
    inNextNDays(c.vencimento, 7),
  );
  const aPagarVencidas = contasVencidasQ.data ?? [];
  const aPagarTotalCent =
    aPagarAbertas7d.reduce((s, c) => s + c.valor, 0) +
    aPagarVencidas.reduce((s, c) => s + c.valor, 0);
  const aPagarCount = aPagarAbertas7d.length + aPagarVencidas.length;

  const aReceber7dList = (contasReceberQ.data ?? []).filter((c) =>
    inNextNDaysFuture(c.dataPrevisao, 7),
  );
  const aReceber7dCent = aReceber7dList.reduce((s, c) => s + c.valor, 0);

  const saldoProjetado = destinacaoQ.data?.saldoProjetado ?? 0;

  const carregando =
    saldoQ.isLoading ||
    contasPagarQ.isLoading ||
    contasVencidasQ.isLoading ||
    contasReceberQ.isLoading ||
    destinacaoQ.isLoading;

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <KpiCard
        label="Saldo em caixa"
        value={carregando ? "—" : formatBRL(saldoCaixa)}
        icon={Wallet}
        color="blue"
      />
      <KpiCard
        label="A pagar (próx. 7d)"
        value={carregando ? "—" : formatBRL(aPagarTotalCent)}
        sub={
          carregando
            ? undefined
            : aPagarCount > 0
              ? `${aPagarCount} conta${aPagarCount !== 1 ? "s" : ""}`
              : "nada para pagar"
        }
        icon={TrendingDown}
        color="orange"
      />
      <KpiCard
        label="A receber (próx. 7d)"
        value={carregando ? "—" : formatBRL(aReceber7dCent)}
        sub={
          carregando
            ? undefined
            : aReceber7dList.length > 0
              ? `${aReceber7dList.length} liquidaç${aReceber7dList.length !== 1 ? "ões" : "ão"}`
              : "sem previsões"
        }
        icon={ArrowDownToLine}
        color="green"
      />
      <KpiCard
        label="Saldo projetado 30d"
        value={carregando ? "—" : formatBRL(saldoProjetado)}
        sub="atual − comprometido + a receber"
        icon={TrendingUp}
        color="violet"
      />
    </div>
  );
}
