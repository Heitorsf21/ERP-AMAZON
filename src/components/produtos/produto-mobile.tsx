"use client";

import * as React from "react";
import Link from "next/link";
import type { Route } from "next";
import { ArrowLeft, ChevronRight } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { MarginBadge } from "@/components/ui/margin-badge";
import { Skeleton } from "@/components/ui/skeleton";
import { DialogCustoHistorico } from "@/components/produtos/dialog-custo-historico";
import { AlterarCustoSheet } from "@/components/produtos/alterar-custo-sheet";
import { fetchJSON } from "@/lib/fetcher";
import { formatBRL } from "@/lib/money";
import { cn } from "@/lib/utils";
import type { ResumoMobileProduto } from "@/modules/produtos/resumo-mobile";

const FAIXA_UI: Record<string, { rotulo: string; classe: string }> = {
  CRITICO: { rotulo: "Crítico", classe: "bg-red-100 text-red-800 dark:bg-red-950/60 dark:text-red-200" },
  ATENCAO: { rotulo: "Atenção", classe: "bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-200" },
  ESTAVEL: { rotulo: "Estável", classe: "bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-200" },
  SEGURO: { rotulo: "Seguro", classe: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-200" },
};

const ROTULO =
  "text-[11px] font-semibold uppercase tracking-wider text-muted-foreground";

function diaMes(iso: string | null): string {
  if (!iso) return "—";
  const [, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}`;
}

function dataCurta(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
}

function Linha({ rotulo, valor, negativo }: { rotulo: string; valor: number; negativo?: boolean }) {
  return (
    <div className="flex justify-between text-sm">
      <span className="text-muted-foreground">{rotulo}</span>
      <span className={cn("tabular-nums", negativo && "text-red-700 dark:text-red-400")}>
        {negativo ? `−${formatBRL(valor)}` : formatBRL(valor)}
      </span>
    </div>
  );
}

export function ProdutoMobile({
  produtoId,
  acaoPreco,
}: {
  produtoId: string;
  /** Botão "Alterar" do preço (Fase 4). */
  acaoPreco?: (resumo: ResumoMobileProduto) => React.ReactNode;
}) {
  const { data, isLoading, isError } = useQuery<ResumoMobileProduto>({
    queryKey: ["produto-resumo-mobile", produtoId],
    queryFn: () => fetchJSON<ResumoMobileProduto>(`/api/produtos/${produtoId}/resumo-mobile`),
  });
  const qc = useQueryClient();
  const [custoAberto, setCustoAberto] = React.useState(false);
  const [historicoAberto, setHistoricoAberto] = React.useState(false);

  const voltar = (
    <Link
      href={"/produtos" as Route}
      className="-ml-2 flex h-11 w-fit items-center gap-1 rounded-lg px-2 text-[15px] font-medium text-muted-foreground"
    >
      <ArrowLeft className="h-5 w-5" aria-hidden />
      Produtos
    </Link>
  );

  if (isLoading) {
    return (
      <div className="space-y-3">
        {voltar}
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }
  if (isError || !data) {
    return (
      <div className="space-y-3">
        {voltar}
        <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
          Não foi possível carregar este produto.
        </p>
      </div>
    );
  }

  const { produto, estoque, preco, custo, unidade } = data;
  const faixa = estoque.faixa ? FAIXA_UI[estoque.faixa] : null;

  return (
    <div className="space-y-3.5">
      {voltar}

      <div className="flex items-start gap-3.5">
        {produto.imagem ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={produto.imagem}
            alt={produto.nome}
            className="h-[88px] w-[88px] shrink-0 rounded-xl border bg-white object-contain"
          />
        ) : (
          <div className="h-[88px] w-[88px] shrink-0 rounded-xl border bg-muted" />
        )}
        <div className="min-w-0 space-y-1.5">
          <h1 className="text-[17px] font-bold leading-snug">{produto.nome}</h1>
          <p className="text-xs text-muted-foreground">
            {produto.sku}
            {produto.asin ? ` · ${produto.asin}` : ""}
          </p>
          <span
            className={cn(
              "inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold",
              produto.ativo
                ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-200"
                : "bg-muted text-muted-foreground",
            )}
          >
            {produto.ativo ? "Ativo" : "Inativo"}
          </span>
        </div>
      </div>

      <section className="space-y-3 rounded-xl border bg-card p-4">
        <div className="flex items-end justify-between gap-2">
          <div>
            <p className={ROTULO}>Estoque</p>
            <p className="text-[26px] font-bold leading-tight tabular-nums">{estoque.disponivel} un</p>
            <p className="text-xs text-muted-foreground">disponíveis na Amazon (FBA)</p>
          </div>
          {faixa && estoque.coberturaDias != null && (
            <span className={cn("whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold", faixa.classe)}>
              {estoque.coberturaDias} dias · {faixa.rotulo}
            </span>
          )}
        </div>
        <div className="grid grid-cols-3 gap-2 border-t pt-3">
          <div>
            <p className="text-[11px] text-muted-foreground">Chegando</p>
            <p className="text-[15px] font-semibold tabular-nums">{estoque.chegando} un</p>
          </div>
          <div>
            <p className="text-[11px] text-muted-foreground">Reservado</p>
            <p className="text-[15px] font-semibold tabular-nums">{estoque.reservado} un</p>
          </div>
          <div>
            <p className="text-[11px] text-muted-foreground">Vendas 30 dias</p>
            <p className="text-[15px] font-semibold tabular-nums">{estoque.vendas30d} un</p>
          </div>
        </div>
        {estoque.rupturaEm && (
          <p className="text-xs text-muted-foreground">
            No ritmo atual, o estoque dura até ~{diaMes(estoque.rupturaEm)}.
          </p>
        )}
      </section>

      <section className="overflow-hidden rounded-xl border bg-card">
        <div className="flex items-center gap-3 px-4 py-3.5">
          <div className="min-w-0 flex-1">
            <p className="text-xs text-muted-foreground">Preço na Amazon</p>
            <p className="text-xl font-bold tabular-nums">
              {preco.centavos == null ? "—" : formatBRL(preco.centavos)}
            </p>
            <p className="text-xs text-muted-foreground">
              Lido da Amazon em {dataCurta(preco.sincronizadoEm)}
            </p>
          </div>
          {acaoPreco?.(data)}
        </div>
        <div className="flex items-center gap-3 border-t px-4 py-3.5">
          <div className="min-w-0 flex-1">
            <p className="text-xs text-muted-foreground">Custo unitário</p>
            <p className="text-xl font-bold tabular-nums">
              {custo.centavos == null ? "Sem custo" : formatBRL(custo.centavos)}
            </p>
            <p className="text-xs text-muted-foreground">
              {custo.todoHistorico
                ? "Vale para todo o histórico"
                : custo.vigenteDesde
                  ? `Vigente desde ${dataCurta(custo.vigenteDesde)}`
                  : custo.centavos != null
                    ? "Custo do cadastro (sem vigência para hoje)"
                    : "Sem vigência cadastrada"}
            </p>
          </div>
          <Button variant="outline" className="h-11 border-primary/40 text-primary" onClick={() => setCustoAberto(true)}>
            Alterar
          </Button>
        </div>
      </section>

      {unidade && (
        <section className="space-y-2 rounded-xl border bg-card p-4">
          <p className={ROTULO}>Por unidade vendida (estimado)</p>
          <Linha rotulo="Preço" valor={unidade.precoCentavos} />
          <Linha rotulo="Comissão Amazon" valor={unidade.comissaoCentavos} negativo />
          <Linha rotulo="Tarifa FBA" valor={unidade.fbaCentavos} negativo />
          {unidade.parcelamentoCentavos > 0 && (
            <Linha rotulo="Parcelamento" valor={unidade.parcelamentoCentavos} negativo />
          )}
          {unidade.impostoCentavos > 0 && (
            <Linha rotulo="Imposto Simples" valor={unidade.impostoCentavos} negativo />
          )}
          {unidade.custoCentavos != null && (
            <Linha rotulo="Custo do produto" valor={unidade.custoCentavos} negativo />
          )}
          <div className="flex items-center justify-between border-t border-dashed pt-2 text-[15px] font-bold">
            <span>Lucro por unidade</span>
            <span className="flex items-center gap-2">
              <span className={cn((unidade.lucroCentavos ?? 0) < 0 ? "text-red-600" : "text-emerald-700 dark:text-emerald-400")}>
                {unidade.lucroCentavos == null ? "—" : formatBRL(unidade.lucroCentavos)}
              </span>
              <MarginBadge value={unidade.margemPercentual} />
            </span>
          </div>
        </section>
      )}

      <button
        type="button"
        onClick={() => setHistoricoAberto(true)}
        className="flex min-h-[52px] w-full items-center gap-3 rounded-xl border bg-card px-4 text-left"
      >
        <span className="flex-1 text-[15px] font-medium">Histórico de custo</span>
        <ChevronRight className="h-4 w-4 text-muted-foreground" aria-hidden />
      </button>

      <AlterarCustoSheet aberto={custoAberto} onAbertoChange={setCustoAberto} resumo={data} />
      <DialogCustoHistorico
        produtoId={produto.id}
        aberto={historicoAberto}
        onOpenChange={setHistoricoAberto}
        valorInicialCentavos={custo.centavos}
        onAplicado={() => {
          setHistoricoAberto(false);
          void qc.invalidateQueries({ queryKey: ["produto-resumo-mobile", produto.id] });
        }}
      />
    </div>
  );
}
