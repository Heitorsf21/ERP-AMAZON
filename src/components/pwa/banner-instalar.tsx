"use client";

import * as React from "react";
import { Smartphone, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { usePwa } from "@/components/pwa/pwa-provider";
import { InstalarSheet } from "@/components/pwa/instalar-sheet";

const CHAVE_DISPENSADO = "atlas-banner-instalar-dispensado";

export function BannerInstalar() {
  const { plataforma } = usePwa();
  const [dispensado, setDispensado] = React.useState(true);
  const [instalarAberto, setInstalarAberto] = React.useState(false);

  React.useEffect(() => {
    try {
      setDispensado(localStorage.getItem(CHAVE_DISPENSADO) === "1");
    } catch {
      setDispensado(false);
    }
  }, []);

  const celular = !!plataforma && (plataforma.ios || plataforma.android);
  if (!plataforma || plataforma.standalone || dispensado || !celular) return null;

  function dispensar() {
    setDispensado(true);
    try {
      localStorage.setItem(CHAVE_DISPENSADO, "1");
    } catch {
      // modo privado: o banner volta na próxima visita, sem problema
    }
  }

  return (
    <>
      <section
        aria-label="Instalar o app"
        className="flex items-center gap-3 rounded-xl border border-blue-200 bg-blue-50 py-3 pl-3 pr-1 dark:border-blue-900 dark:bg-blue-950/40"
      >
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <Smartphone className="h-5 w-5" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-blue-900 dark:text-blue-100">
            Use o Atlas como app
          </p>
          <p className="text-[13px] leading-snug text-blue-800 dark:text-blue-200">
            Instale na tela inicial e receba um aviso a cada venda.
          </p>
        </div>
        <Button size="sm" className="h-11" onClick={() => setInstalarAberto(true)}>
          Instalar
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className="h-11 w-10 text-blue-800 dark:text-blue-200"
          onClick={dispensar}
          aria-label="Dispensar"
        >
          <X className="h-4 w-4" />
        </Button>
      </section>
      <InstalarSheet aberto={instalarAberto} onAbertoChange={setInstalarAberto} />
    </>
  );
}
