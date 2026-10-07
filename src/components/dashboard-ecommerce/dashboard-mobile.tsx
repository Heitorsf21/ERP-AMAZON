"use client";

import Link from "next/link";
import type { Route } from "next";
import { ArrowUpDown, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MarginBadge, MPA_THRESHOLDS } from "@/components/ui/margin-badge";
import { ProductThumb } from "@/components/ui/product-thumb";
import { Skeleton } from "@/components/ui/skeleton";
import { TrendIndicator } from "@/components/ui/trend-indicator";
import { PorLojaMobile, type PorLoja } from "@/components/lojas/por-loja";
import { SeloLoja } from "@/components/lojas/selo-loja";
import { useLojas, useTrocarLoja } from "@/components/lojas/use-lojas";
import { resolverImagemProduto } from "@/lib/amazon-images";
import { formatBRL } from "@/lib/money";
import { cn } from "@/lib/utils";
import {
  formatarPercentual,
  montarKpisMobile,
  type CategoriaKpiMobile,
  type KpisMobileEntrada,
} from "@/modules/dashboard-ecommerce/kpis-mobile";

/** Mesmos campos do TopProduto da página (API /top-produtos). */
export type TopProdutoMobile = {
  sku: string;
  produtoId: string | null;
  nome: string;
  imagemUrl: string | null;
  amazonImagemUrl: string | null;
  asin: string | null;
  precoMedioCentavos: number;
  custoUnitarioCentavos: number | null;
  unidades: number;
  faturadoCentavos: number;
  representatividadePercentual: number | null;
  lucroCentavos: number | null;
  margemPercentual: number | null;
  custoAdsCentavos: number;
  lucroPosAdsCentavos: number | null;
  mpaPercentual: number | null;
  /** Só na visão "Todas": de qual loja é o item. */
  loja?: { empresaId: string; nome: string; atual: boolean };
};

const BORDA: Record<CategoriaKpiMobile, string> = {
  receita: "border-l-emerald-500",
  operacao: "border-l-blue-500",
  ads: "border-l-amber-500",
};

const ROTULO_KPI =
  "text-[11px] font-semibold uppercase tracking-wider text-muted-foreground";

function Metrica({
  rotulo,
  valor,
  children,
}: {
  rotulo: string;
  valor: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="text-[11px] text-muted-foreground">{rotulo}</span>
      <span className="truncate text-[13px] font-semibold tabular-nums">{valor}</span>
      {children}
    </div>
  );
}

function ItemTopProduto({
  produto,
  posicao,
  classeCorLoja,
}: {
  produto: TopProdutoMobile;
  posicao: number;
  /** Visão "Todas": cor do selo da loja do item. */
  classeCorLoja?: string;
}) {
  const { trocar, trocandoPara } = useTrocarLoja();
  const thumb =
    produto.imagemUrl && produto.produtoId
      ? `/api/produtos/${produto.produtoId}/imagem`
      : resolverImagemProduto(produto.amazonImagemUrl, produto.asin, null);

  const conteudo = (
    <>
      <div className="flex items-start gap-3">
        <span className="w-5 shrink-0 pt-3.5 text-right text-xs font-bold text-muted-foreground">
          {posicao}
        </span>
        <ProductThumb src={thumb} alt={produto.nome} size={48} />
        <div className="min-w-0 flex-1">
          <p className="line-clamp-2 text-sm font-medium leading-snug">{produto.nome}</p>
          <p className="mt-0.5 flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
            {produto.loja && <SeloLoja nome={produto.loja.nome} classeCor={classeCorLoja} />}
            <span>
              {produto.sku} · {produto.unidades} un ·{" "}
              {formatarPercentual(produto.representatividadePercentual)} do total
            </span>
          </p>
        </div>
        <span className="shrink-0 text-sm font-bold tabular-nums">
          {formatBRL(produto.faturadoCentavos)}
        </span>
      </div>
      <div className="mt-2.5 grid grid-cols-3 gap-2 pl-8">
        <Metrica
          rotulo="Lucro"
          valor={produto.lucroCentavos == null ? "N/A" : formatBRL(produto.lucroCentavos)}
        >
          <MarginBadge value={produto.margemPercentual} />
        </Metrica>
        <Metrica
          rotulo="Custo Ads"
          valor={produto.custoAdsCentavos > 0 ? formatBRL(produto.custoAdsCentavos) : "—"}
        />
        <Metrica
          rotulo="Pós-Ads"
          valor={
            produto.lucroPosAdsCentavos == null ? "N/A" : formatBRL(produto.lucroPosAdsCentavos)
          }
        >
          <MarginBadge value={produto.mpaPercentual} thresholds={MPA_THRESHOLDS} />
        </Metrica>
      </div>
      <p className="mt-1.5 pl-8 text-xs text-muted-foreground">
        Preço médio {formatBRL(produto.precoMedioCentavos)} · Custo{" "}
        {produto.custoUnitarioCentavos == null
          ? "N/A"
          : formatBRL(produto.custoUnitarioCentavos)}
      </p>
    </>
  );

  // Produto de outra loja (visão "Todas"): abrir troca de loja antes.
  const lojaDoItem = produto.loja && !produto.loja.atual ? produto.loja : null;
  if (lojaDoItem && produto.produtoId) {
    const produtoId = produto.produtoId;
    return (
      <li className="border-t">
        <button
          type="button"
          disabled={trocandoPara != null}
          onClick={() => void trocar(lojaDoItem.empresaId, { destino: `/produtos/${produtoId}` })}
          className="relative block w-full px-4 py-3 text-left active:bg-muted/60 disabled:opacity-60"
        >
          {conteudo}
          {trocandoPara === lojaDoItem.empresaId && (
            <span className="absolute right-4 top-3 rounded-full bg-background p-1 shadow-sm">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-label={`Abrindo ${lojaDoItem.nome}`} />
            </span>
          )}
        </button>
      </li>
    );
  }

  return (
    <li className="border-t">
      {produto.produtoId ? (
        <Link
          href={`/produtos/${produto.produtoId}` as Route}
          className="block px-4 py-3 active:bg-muted/60"
        >
          {conteudo}
        </Link>
      ) : (
        <div className="px-4 py-3">{conteudo}</div>
      )}
    </li>
  );
}

export function DashboardMobile({
  kpis,
  carregandoKpis,
  produtos,
  carregandoTop,
  ordem,
  onAlternarOrdem,
  porLoja,
}: {
  /** Visão "Todas": o bloco "Por loja" (ausente na visão de uma loja). */
  porLoja?: PorLoja[];
  kpis: KpisMobileEntrada | undefined;
  carregandoKpis: boolean;
  produtos: TopProdutoMobile[];
  carregandoTop: boolean;
  ordem: "desc" | "asc";
  onAlternarOrdem: () => void;
}) {
  const resumo = kpis ? montarKpisMobile(kpis) : null;
  const { lojas } = useLojas();
  const corDaLoja = new Map(lojas.map((l) => [l.empresaId, l.cor.selo]));
  const todas = !!porLoja && porLoja.length > 1;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2.5">
        {carregandoKpis || !resumo
          ? Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-[88px] rounded-xl" />
            ))
          : resumo.cards.map((card) => (
              <div
                key={card.chave}
                className={cn(
                  "min-w-0 rounded-xl border border-l-[3px] bg-card p-3",
                  BORDA[card.categoria],
                )}
              >
                <p className={ROTULO_KPI}>{card.rotulo}</p>
                <p className="mt-1 truncate text-lg font-bold tabular-nums">{card.valor}</p>
                <TrendIndicator
                  value={card.delta.valor}
                  unit={card.delta.tipo}
                  inverso={card.delta.inverso}
                  className="mt-0.5"
                />
              </div>
            ))}
      </div>

      {resumo && (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-l-[3px] border-l-amber-500 bg-card px-4 py-3">
          <div className="min-w-0">
            <p className={ROTULO_KPI}>MPA · margem pós-anúncios</p>
            <p className="mt-1 flex flex-wrap items-center gap-x-1.5 text-sm text-muted-foreground">
              Lucro pós-Ads{" "}
              <strong className="text-foreground">{resumo.mpa.lucroPosAds}</strong>
              <TrendIndicator
                value={resumo.mpa.deltaLucroPosAds.valor}
                unit={resumo.mpa.deltaLucroPosAds.tipo}
              />
            </p>
          </div>
          <span className="text-2xl font-bold tabular-nums">{resumo.mpa.valor}</span>
        </div>
      )}

      {todas && porLoja && <PorLojaMobile porLoja={porLoja} />}

      <section className="overflow-hidden rounded-xl border bg-card">
        <div className="flex items-center justify-between gap-2 px-4 pb-2 pt-3">
          <div className="min-w-0">
            <h2 className="text-base font-semibold">Top 15 produtos</h2>
            <p className="text-xs text-muted-foreground">
              por faturamento no período
              {todas && porLoja ? ` · ${porLoja.map((l) => l.nome).join(" + ")}` : ""}
            </p>
          </div>
          <Button type="button" variant="outline" size="sm" className="h-10" onClick={onAlternarOrdem}>
            <ArrowUpDown className="mr-1.5 h-4 w-4" aria-hidden />
            {ordem === "desc" ? "Maior" : "Menor"} faturamento
          </Button>
        </div>
        {carregandoTop ? (
          <div className="space-y-3 p-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-20 w-full" />
            ))}
          </div>
        ) : produtos.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-muted-foreground">
            Sem vendas no período.
          </p>
        ) : (
          <ol>
            {produtos.map((p, idx) => (
              <ItemTopProduto
                key={`${p.loja?.empresaId ?? ""}:${p.sku}`}
                produto={p}
                posicao={idx + 1}
                classeCorLoja={p.loja ? corDaLoja.get(p.loja.empresaId) : undefined}
              />
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
