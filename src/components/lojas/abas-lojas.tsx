"use client";

import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useLojas, useTrocarLoja } from "./use-lojas";
import { useVisaoInicio } from "./visao-inicio";

// Mesmas classes do TabsList/TabsTrigger (src/components/ui/tabs.tsx).
const TRIGGER =
  "inline-flex min-w-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-sm px-3 py-1.5 text-sm font-medium ring-offset-background transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50";
const ATIVO = "bg-background text-foreground shadow-sm";

/**
 * Início no celular: Todas · Loja 1 · Loja 2. "Todas" soma as lojas; a loja
 * aberta volta para a visão dela; a outra troca de loja (sem login).
 * Só aparece com loja vinculada.
 */
export function AbasLojas({ className }: { className?: string }) {
  const { lojas, temVinculo } = useLojas();
  const { trocar, trocandoPara } = useTrocarLoja();
  const [visao, definirVisao] = useVisaoInicio();

  if (!temVinculo) return null;

  return (
    <div
      role="tablist"
      aria-label="Loja do Início"
      className={cn("grid h-10 rounded-md bg-muted p-1 text-muted-foreground", className)}
      style={{ gridTemplateColumns: `repeat(${lojas.length + 1}, minmax(0, 1fr))` }}
    >
      <button
        type="button"
        role="tab"
        aria-selected={visao === "todas"}
        className={cn(TRIGGER, visao === "todas" && ATIVO)}
        onClick={() => definirVisao("todas")}
      >
        Todas
      </button>
      {lojas.map((loja) => {
        const ativa = visao === "loja" && loja.atual;
        return (
          <button
            key={loja.empresaId}
            type="button"
            role="tab"
            aria-selected={ativa}
            disabled={trocandoPara != null}
            className={cn(TRIGGER, ativa && ATIVO)}
            onClick={() =>
              loja.atual
                ? definirVisao("loja")
                : void trocar(loja.empresaId, { destino: "/dashboard-ecommerce", visao: "loja" })
            }
          >
            {trocandoPara === loja.empresaId && (
              <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden />
            )}
            <span className="truncate">{loja.nome}</span>
          </button>
        );
      })}
    </div>
  );
}
