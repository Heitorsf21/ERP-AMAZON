"use client";

import * as React from "react";
import { AlertTriangle, ArrowRight } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MarginBadge } from "@/components/ui/margin-badge";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/components/ui/sheet";
import { fetchJSON } from "@/lib/fetcher";
import { formatBRL } from "@/lib/money";
import { cn } from "@/lib/utils";
import {
  parseValorBRL,
  reprojetarParaPreco,
  type ResumoMobileProduto,
} from "@/modules/produtos/resumo-mobile";

type Me = { usuario: { role: string } };

function centavosParaTexto(c: number | null) {
  return c == null ? "" : (c / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2 });
}

export function AlterarPrecoSheet({
  aberto,
  onAbertoChange,
  resumo,
}: {
  aberto: boolean;
  onAbertoChange: (aberto: boolean) => void;
  resumo: ResumoMobileProduto;
}) {
  const qc = useQueryClient();
  const [texto, setTexto] = React.useState(centavosParaTexto(resumo.preco.centavos));
  const [confirmando, setConfirmando] = React.useState(false);

  React.useEffect(() => {
    if (aberto) {
      setTexto(centavosParaTexto(resumo.preco.centavos));
      setConfirmando(false);
    }
  }, [aberto, resumo.preco.centavos]);

  const novo = parseValorBRL(texto);
  const depois = resumo.unidade && novo ? reprojetarParaPreco(resumo.unidade, novo, resumo.impostoBps) : null;

  const enviar = useMutation({
    mutationFn: (confirmarVariacao: boolean) =>
      fetchJSON<{ ok: true }>(`/api/produtos/${resumo.produto.id}/preco-amazon`, {
        method: "POST",
        body: JSON.stringify({ precoCentavos: novo, confirmarVariacao }),
      }),
    onSuccess: () => {
      toast.success(`Preço ${formatBRL(novo ?? 0)} enviado para a Amazon. Aparece na loja em alguns minutos.`);
      void qc.invalidateQueries({ queryKey: ["produto-resumo-mobile", resumo.produto.id] });
      onAbertoChange(false);
    },
    onError: (e: Error) => {
      if (e.message === "CONFIRMAR_VARIACAO") {
        setConfirmando(true);
        return;
      }
      toast.error(e.message || "Não foi possível alterar o preço.");
    },
  });

  return (
    <Sheet open={aberto} onOpenChange={onAbertoChange}>
      <SheetContent
        side="bottom"
        className="max-h-[92dvh] overflow-y-auto rounded-t-2xl px-4 pb-[calc(1.5rem+env(safe-area-inset-bottom))]"
      >
        <SheetTitle className="text-lg">Alterar preço na Amazon</SheetTitle>
        <SheetDescription className="line-clamp-1">
          {resumo.produto.sku} · {resumo.produto.nome}
        </SheetDescription>

        <div className="mt-4 space-y-1.5">
          <Label htmlFor="novo-preco">Novo preço de venda</Label>
          <div className="flex h-12 items-center gap-2 rounded-xl border-2 border-primary px-3">
            <span className="text-lg font-semibold text-muted-foreground">R$</span>
            <Input
              id="novo-preco"
              inputMode="decimal"
              autoComplete="off"
              value={texto}
              onChange={(e) => {
                setTexto(e.target.value);
                setConfirmando(false);
              }}
              className="h-auto border-0 p-0 text-xl font-bold shadow-none focus-visible:ring-0"
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Atual: {resumo.preco.centavos == null ? "—" : formatBRL(resumo.preco.centavos)}
          </p>
        </div>

        <p className="mt-4 flex gap-2.5 rounded-xl border border-amber-300 bg-amber-50 p-3 text-[13px] leading-relaxed text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          O preço muda no anúncio da Amazon. Pode levar alguns minutos para aparecer na loja.
        </p>

        {resumo.unidade && depois && (
          <div className="mt-4 flex items-center justify-between gap-2 rounded-xl border bg-muted/40 px-3 py-3 text-sm">
            <span className="text-muted-foreground">Lucro por unidade</span>
            <span className="flex items-center gap-2">
              <span className="text-muted-foreground">
                {resumo.unidade.lucroCentavos == null ? "—" : formatBRL(resumo.unidade.lucroCentavos)}
              </span>
              <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
              <strong className={cn((depois.lucroCentavos ?? 0) < 0 && "text-red-600")}>
                {depois.lucroCentavos == null ? "—" : formatBRL(depois.lucroCentavos)}
              </strong>
              <MarginBadge value={depois.margemPercentual} />
            </span>
          </div>
        )}

        {confirmando && novo && (
          <p role="alert" className="mt-4 rounded-xl border border-red-300 bg-red-50 p-3 text-sm text-red-900 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200">
            Você está mudando de {formatBRL(resumo.preco.centavos ?? 0)} para{" "}
            <strong>{formatBRL(novo)}</strong>, uma diferença grande. Confirma?
          </p>
        )}

        <div className="mt-4 grid grid-cols-2 gap-2">
          <Button variant="outline" className="h-12" onClick={() => onAbertoChange(false)}>
            Cancelar
          </Button>
          <Button
            className={cn("h-12", confirmando && "bg-red-600 hover:bg-red-700")}
            disabled={!novo || novo === resumo.preco.centavos || enviar.isPending}
            onClick={() => enviar.mutate(confirmando)}
          >
            {enviar.isPending ? "Enviando…" : confirmando ? "Confirmar mudança" : "Enviar para a Amazon"}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

/** Botão do card de preço: só ADMIN altera preço na Amazon. */
export function BotaoAlterarPreco({ resumo }: { resumo: ResumoMobileProduto }) {
  const [aberto, setAberto] = React.useState(false);
  const { data } = useQuery<Me>({
    queryKey: ["auth-me"],
    queryFn: () => fetchJSON<Me>("/api/auth/me"),
    staleTime: 60_000,
  });
  if (data?.usuario.role !== "ADMIN" || resumo.preco.centavos == null) return null;
  return (
    <>
      <Button
        variant="outline"
        className="h-11 border-primary/40 text-primary"
        onClick={() => setAberto(true)}
      >
        Alterar
      </Button>
      <AlterarPrecoSheet aberto={aberto} onAbertoChange={setAberto} resumo={resumo} />
    </>
  );
}
