"use client";

import * as React from "react";
import Link from "next/link";
import type { Route } from "next";
import { usePathname, useRouter } from "next/navigation";
import { Check, ChevronRight, Layers, Link2, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { destinoAoTrocar, iniciaisLoja } from "@/modules/lojas/regras";
import { useLojas, useTrocarLoja, type LojaComCor } from "./use-lojas";
import { useVisaoInicio } from "./visao-inicio";

// Mesmo padrão da folha "Mais" (src/components/mobile/mais-sheet.tsx).
const CLASSE_LINHA =
  "flex min-h-[52px] w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left active:bg-muted disabled:opacity-60";
const ROTULO_SECAO =
  "px-2 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground";

export function SeloLojaQuadrado({ loja }: { loja: LojaComCor }) {
  return (
    <span
      aria-hidden
      className={cn(
        "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-xs font-bold",
        loja.cor.selo,
      )}
    >
      {iniciaisLoja(loja.nome)}
    </span>
  );
}

/** "MundoFS + UDN" (ou "3 lojas" quando são muitas). */
export function nomesJuntos(lojas: { nome: string }[]): string {
  return lojas.length <= 3 ? lojas.map((l) => l.nome).join(" + ") : `${lojas.length} lojas`;
}

export function TrocarLojaSheet({
  aberto,
  onAbertoChange,
}: {
  aberto: boolean;
  onAbertoChange: (aberto: boolean) => void;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const { lojas, temVinculo } = useLojas();
  const { trocar, trocandoPara } = useTrocarLoja();
  const [visao, definirVisao] = useVisaoInicio();
  const fechar = () => onAbertoChange(false);
  const noInicio = pathname === "/dashboard-ecommerce";

  return (
    <Sheet open={aberto} onOpenChange={onAbertoChange}>
      <SheetContent
        side="bottom"
        className="max-h-[88dvh] overflow-y-auto rounded-t-2xl px-3 pb-[calc(1.5rem+env(safe-area-inset-bottom))] pt-4"
      >
        <SheetTitle className="px-2 text-lg">Trocar de loja</SheetTitle>
        <SheetDescription className="px-2 text-[13px]">
          Troca na hora, sem digitar senha.
        </SheetDescription>

        <p className={ROTULO_SECAO}>Suas lojas</p>
        {lojas.map((loja) =>
          loja.atual ? (
            <button
              key={loja.empresaId}
              type="button"
              aria-current="true"
              className={cn(CLASSE_LINHA, "bg-muted")}
              onClick={() => {
                definirVisao("loja");
                fechar();
              }}
            >
              <SeloLojaQuadrado loja={loja} />
              <span className="min-w-0 flex-1">
                <span className="block text-[15px] font-medium">{loja.nome}</span>
                <span className="block text-xs text-muted-foreground">Aberta agora</span>
              </span>
              <Check className="h-[18px] w-[18px] text-primary" aria-label="Loja aberta" />
            </button>
          ) : (
            <button
              key={loja.empresaId}
              type="button"
              className={CLASSE_LINHA}
              disabled={trocandoPara != null}
              onClick={() =>
                void trocar(loja.empresaId, { destino: destinoAoTrocar(pathname), visao: "loja" })
              }
            >
              <SeloLojaQuadrado loja={loja} />
              <span className="min-w-0 flex-1">
                <span className="block text-[15px] font-medium">{loja.nome}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  {trocandoPara === loja.empresaId ? "Abrindo…" : loja.email}
                </span>
              </span>
              {trocandoPara === loja.empresaId ? (
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-hidden />
              ) : (
                <ChevronRight className="h-4 w-4 text-muted-foreground" aria-hidden />
              )}
            </button>
          ),
        )}

        {temVinculo && (
          <>
            <p className={ROTULO_SECAO}>Visão</p>
            <button
              type="button"
              className={cn(CLASSE_LINHA, noInicio && visao === "todas" && "bg-muted")}
              aria-current={noInicio && visao === "todas" ? "true" : undefined}
              onClick={() => {
                definirVisao("todas");
                fechar();
                if (!noInicio) router.push("/dashboard-ecommerce" as Route);
              }}
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Layers className="h-[18px] w-[18px]" aria-hidden />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[15px] font-medium">
                  {lojas.length > 2 ? "Ver todas juntas" : "Ver as duas juntas"}
                </span>
                <span className="block text-xs text-muted-foreground">
                  Início com {nomesJuntos(lojas)} somadas
                </span>
              </span>
              <ChevronRight className="h-4 w-4 text-muted-foreground" aria-hidden />
            </button>
          </>
        )}

        <div className="mx-2 my-2 h-px bg-border" />
        <Link href={"/configuracoes?tab=lojas" as Route} onClick={fechar} className={CLASSE_LINHA}>
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted text-foreground/80">
            <Link2 className="h-[18px] w-[18px]" aria-hidden />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[15px] font-medium">Vincular outra loja</span>
            <span className="block text-xs text-muted-foreground">Entre uma vez com a conta dela</span>
          </span>
          <ChevronRight className="h-4 w-4 text-muted-foreground" aria-hidden />
        </Link>
      </SheetContent>
    </Sheet>
  );
}
