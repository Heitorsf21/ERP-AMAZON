"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Plus, TrendingDown, TrendingUp, Wallet, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { KpiCard } from "@/components/ui/kpi-card";
import { CardSaldo } from "@/components/caixa/card-saldo";
import { FormMovimentacao } from "@/components/caixa/form-movimentacao";
import { ListaMovimentacoes } from "@/components/caixa/lista-movimentacoes";
import { DialogImportar } from "@/components/caixa/dialog-importar";
import { formatBRL } from "@/lib/money";

type TotaisMes = {
  entradasCentavos: number;
  saidasCentavos: number;
  variacaoCentavos: number;
};

async function fetchTotaisMes(): Promise<TotaisMes> {
  const r = await fetch("/api/caixa/totais");
  if (!r.ok) throw new Error("falha ao carregar totais do mês");
  return r.json();
}

export default function CaixaPage() {
  const [modalNovo, setModalNovo] = React.useState(false);
  const [modalImportar, setModalImportar] = React.useState(false);

  const { data, isLoading } = useQuery<TotaisMes>({
    queryKey: ["caixa-totais-mes"],
    queryFn: fetchTotaisMes,
  });

  const entradas = data?.entradasCentavos ?? 0;
  const saidas = data?.saidasCentavos ?? 0;
  const variacao = data?.variacaoCentavos ?? 0;
  const variacaoPositiva = variacao >= 0;

  return (
    <div className="space-y-6">
      <PageHeader title="Caixa" description="Movimentações de entrada e saída.">
        <Button variant="outline" onClick={() => setModalImportar(true)}>
          <Upload className="mr-2 h-4 w-4" /> Importar
        </Button>
        <Button onClick={() => setModalNovo(true)}>
          <Plus className="mr-2 h-4 w-4" /> Nova movimentação
        </Button>
      </PageHeader>

      <CardSaldo />

      <div className="grid gap-4 sm:grid-cols-3">
        <KpiCard
          label="Entradas no mês"
          value={isLoading ? "—" : formatBRL(entradas)}
          icon={TrendingUp}
          color="green"
        />
        <KpiCard
          label="Saídas no mês"
          value={isLoading ? "—" : formatBRL(saidas)}
          icon={TrendingDown}
          color="red"
        />
        <KpiCard
          label="Variação líquida"
          value={
            isLoading
              ? "—"
              : `${variacaoPositiva ? "+" : "−"}${formatBRL(Math.abs(variacao))}`
          }
          icon={Wallet}
          color={variacaoPositiva ? "green" : "red"}
          valueClassName={
            variacaoPositiva ? "text-emerald-600 dark:text-emerald-400" : "text-destructive"
          }
        />
      </div>

      <ListaMovimentacoes />

      <FormMovimentacao aberto={modalNovo} onOpenChange={setModalNovo} />
      <DialogImportar aberto={modalImportar} onOpenChange={setModalImportar} />
    </div>
  );
}
