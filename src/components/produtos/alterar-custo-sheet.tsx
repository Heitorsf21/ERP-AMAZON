"use client";

import * as React from "react";
import { ArrowRight } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/components/ui/sheet";
import { MarginBadge } from "@/components/ui/margin-badge";
import { fetchJSON } from "@/lib/fetcher";
import { formatBRL } from "@/lib/money";
import { cn } from "@/lib/utils";
import {
  calcularUnidadeEstimada,
  parseValorBRL,
  type ResumoMobileProduto,
} from "@/modules/produtos/resumo-mobile";

type Modo = "A_PARTIR_DE_HOJE" | "PERIODO" | "HISTORICO_COMPLETO";

const MODOS: Array<{ valor: Modo; rotulo: string; ajuda: string }> = [
  { valor: "A_PARTIR_DE_HOJE", rotulo: "A partir de hoje", ajuda: "Vendas antigas mantêm o custo da época. Use para uma compra nova." },
  { valor: "PERIODO", rotulo: "Período", ajuda: "O custo vale só entre as duas datas." },
  { valor: "HISTORICO_COMPLETO", rotulo: "Todo histórico", ajuda: "Recalcula o lucro de todas as vendas deste produto." },
];

function hojeSP() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
}

function centavosParaTexto(c: number | null) {
  return c == null ? "" : (c / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2 });
}

export function AlterarCustoSheet({
  aberto,
  onAbertoChange,
  resumo,
}: {
  aberto: boolean;
  onAbertoChange: (aberto: boolean) => void;
  resumo: ResumoMobileProduto;
}) {
  const qc = useQueryClient();
  const [texto, setTexto] = React.useState(centavosParaTexto(resumo.custo.centavos));
  const [modo, setModo] = React.useState<Modo>("A_PARTIR_DE_HOJE");
  const [de, setDe] = React.useState(hojeSP());
  const [ate, setAte] = React.useState(hojeSP());

  React.useEffect(() => {
    if (aberto) setTexto(centavosParaTexto(resumo.custo.centavos));
  }, [aberto, resumo.custo.centavos]);

  const novoCusto = parseValorBRL(texto);
  const u = resumo.unidade;
  const depois =
    u && novoCusto
      ? calcularUnidadeEstimada({
          precoCentavos: u.precoCentavos,
          custoCentavos: novoCusto,
          comissaoCentavos: u.comissaoCentavos,
          fbaCentavos: u.fbaCentavos,
          impostoBps: resumo.impostoBps,
        })
      : null;

  const salvar = useMutation({
    mutationFn: () =>
      fetchJSON<{ ok: true; vendasAtualizadas: number }>(
        `/api/produtos/${resumo.produto.id}/custo-historico`,
        {
          method: "POST",
          body: JSON.stringify({
            modo,
            custoCentavos: novoCusto,
            ...(modo === "PERIODO" ? { de, ate } : {}),
          }),
        },
      ),
    onSuccess: (r) => {
      toast.success(
        `Custo ${formatBRL(novoCusto ?? 0)} salvo. ${r.vendasAtualizadas} venda(s) recalculada(s).`,
      );
      void qc.invalidateQueries({ queryKey: ["produto-resumo-mobile", resumo.produto.id] });
      void qc.invalidateQueries({ queryKey: ["estoque-produto", resumo.produto.id] });
      // Mesmo conjunto que o DialogCustoHistorico invalida: lista, totais e dashboard.
      for (const chave of [
        ["custo-historico", resumo.produto.id],
        ["estoque-produtos"],
        ["estoque-totais"],
        ["produtos-resumo-tabela"],
        ["dashboard-ecommerce-kpis"],
        ["dashboard-ecommerce-top-produtos"],
      ]) {
        void qc.invalidateQueries({ queryKey: chave });
      }
      onAbertoChange(false);
    },
    onError: (e: Error) => toast.error(e.message || "Não foi possível salvar o custo."),
  });

  const ajuda = MODOS.find((m) => m.valor === modo)?.ajuda;
  const podeSalvar = !!novoCusto && (modo !== "PERIODO" || (!!de && !!ate && de <= ate));

  return (
    <Sheet open={aberto} onOpenChange={onAbertoChange}>
      <SheetContent
        side="bottom"
        className="max-h-[92dvh] overflow-y-auto rounded-t-2xl px-4 pb-[calc(1.5rem+env(safe-area-inset-bottom))]"
      >
        <SheetTitle className="text-lg">Alterar custo</SheetTitle>
        <SheetDescription className="line-clamp-1">
          {resumo.produto.sku} · {resumo.produto.nome}
        </SheetDescription>

        <div className="mt-4 space-y-1.5">
          <Label htmlFor="novo-custo">Novo custo unitário</Label>
          <div className="flex h-12 items-center gap-2 rounded-xl border-2 border-primary px-3">
            <span className="text-lg font-semibold text-muted-foreground">R$</span>
            <Input
              id="novo-custo"
              inputMode="decimal"
              autoComplete="off"
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              className="h-auto border-0 p-0 text-xl font-bold shadow-none focus-visible:ring-0"
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Atual: {resumo.custo.centavos == null ? "sem custo" : formatBRL(resumo.custo.centavos)}
          </p>
        </div>

        <div className="mt-4 space-y-1.5">
          <p className="text-sm font-medium">Vale para</p>
          <div role="radiogroup" aria-label="Vale para" className="grid grid-cols-3 gap-1 rounded-lg bg-muted p-1">
            {MODOS.map((m) => (
              <button
                key={m.valor}
                type="button"
                role="radio"
                aria-checked={modo === m.valor}
                onClick={() => setModo(m.valor)}
                className={cn(
                  "h-10 rounded-md text-[13px] font-medium",
                  modo === m.valor ? "bg-background shadow-sm" : "text-muted-foreground",
                )}
              >
                {m.rotulo}
              </button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">{ajuda}</p>
          {modo === "PERIODO" && (
            <div className="grid grid-cols-2 gap-2 pt-1">
              <div className="space-y-1">
                <Label htmlFor="custo-de">De</Label>
                <Input id="custo-de" type="date" value={de} onChange={(e) => setDe(e.target.value)} className="h-11" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="custo-ate">Até</Label>
                <Input id="custo-ate" type="date" value={ate} onChange={(e) => setAte(e.target.value)} className="h-11" />
              </div>
            </div>
          )}
        </div>

        {u && depois && (
          <div className="mt-4 flex items-center justify-between gap-2 rounded-xl border bg-muted/40 px-3 py-3 text-sm">
            <span className="text-muted-foreground">Lucro por unidade</span>
            <span className="flex items-center gap-2">
              <span className="text-muted-foreground">
                {u.lucroCentavos == null ? "—" : formatBRL(u.lucroCentavos)}
              </span>
              <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
              <strong className={cn((depois.lucroCentavos ?? 0) < 0 && "text-red-600")}>
                {formatBRL(depois.lucroCentavos ?? 0)}
              </strong>
              <MarginBadge value={depois.margemPercentual} />
            </span>
          </div>
        )}

        <div className="mt-4 grid grid-cols-2 gap-2">
          <Button variant="outline" className="h-12" onClick={() => onAbertoChange(false)}>
            Cancelar
          </Button>
          <Button className="h-12" disabled={!podeSalvar || salvar.isPending} onClick={() => salvar.mutate()}>
            {salvar.isPending ? "Salvando…" : "Salvar custo"}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
