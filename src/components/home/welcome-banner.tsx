"use client";

import * as React from "react";
import { formatInTimeZone } from "date-fns-tz";
import { ptBR } from "date-fns/locale";

const TZ = "America/Sao_Paulo";

function saudacao(hora: number) {
  if (hora < 5) return "Boa madrugada";
  if (hora < 12) return "Bom dia";
  if (hora < 18) return "Boa tarde";
  return "Boa noite";
}

export function WelcomeBanner({ nome = "Heitor" }: { nome?: string }) {
  const [now, setNow] = React.useState<Date | null>(null);

  React.useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

  const hora = now ? Number(formatInTimeZone(now, TZ, "H")) : null;
  const dataExtenso = now
    ? formatInTimeZone(now, TZ, "EEEE, dd 'de' MMMM 'de' yyyy", { locale: ptBR })
    : "";
  const horaExtenso = now ? formatInTimeZone(now, TZ, "HH:mm") : "";

  return (
    <section className="relative overflow-hidden rounded-2xl border bg-gradient-to-br from-primary/10 via-background to-background p-6 shadow-sm lg:p-7">
      {/* Detalhe visual */}
      <div className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full bg-primary/10 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-16 -left-10 h-32 w-32 rounded-full bg-primary/5 blur-3xl" />

      <div className="relative flex flex-col gap-1">
        <p className="text-xs font-medium uppercase tracking-[0.2em] text-primary/80">
          Central ERP
        </p>
        <h1 className="text-2xl font-semibold tracking-tight lg:text-3xl">
          {hora !== null ? (
            <>
              {saudacao(hora)}, {nome} 👋
            </>
          ) : (
            <span className="opacity-0">Olá, {nome}</span>
          )}
        </h1>
        <p className="text-sm text-muted-foreground">
          {dataExtenso ? (
            <>
              <span className="capitalize">{dataExtenso}</span>
              {horaExtenso && <span className="mx-1.5 opacity-50">•</span>}
              {horaExtenso}
            </>
          ) : (
            <span className="opacity-0">—</span>
          )}
        </p>
      </div>
    </section>
  );
}
