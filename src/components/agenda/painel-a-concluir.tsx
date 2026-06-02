"use client";

import * as React from "react";
import { CheckCircle2 } from "lucide-react";
import { ItemAgenda, type AgendaItem } from "./item-agenda";

type Bucket = {
  chave: string;
  titulo: string;
  cor: string;
  itens: AgendaItem[];
};

function montarBuckets(
  items: AgendaItem[],
  hoje: string,
  fimSemana: string,
): Bucket[] {
  const atrasadas: AgendaItem[] = [];
  const doDia: AgendaItem[] = [];
  const daSemana: AgendaItem[] = [];
  const semPrazo: AgendaItem[] = [];

  for (const item of items) {
    if (item.statusAgenda === "VENCIDA") {
      atrasadas.push(item);
    } else if (item.statusAgenda === "ABERTA") {
      if (item.dia == null) semPrazo.push(item);
      else if (item.dia === hoje) doDia.push(item);
      else if (item.dia > hoje && item.dia <= fimSemana) daSemana.push(item);
    }
  }

  return [
    { chave: "atrasadas", titulo: "Atrasadas", cor: "bg-red-500", itens: atrasadas },
    { chave: "hoje", titulo: "Hoje", cor: "bg-amber-500", itens: doDia },
    { chave: "semana", titulo: "Esta semana", cor: "bg-blue-500", itens: daSemana },
    { chave: "sem-prazo", titulo: "Sem prazo", cor: "bg-slate-400", itens: semPrazo },
  ];
}

export function PainelAConcluir({
  items,
  hoje,
  fimSemana,
  onConcluir,
  onReabrir,
  onEditar,
  onExcluir,
  onPagar,
}: {
  items: AgendaItem[];
  hoje: string;
  fimSemana: string;
  onConcluir: (item: AgendaItem) => void;
  onReabrir: (item: AgendaItem) => void;
  onEditar: (item: AgendaItem) => void;
  onExcluir: (item: AgendaItem) => void;
  onPagar: (item: AgendaItem) => void;
}) {
  const buckets = React.useMemo(
    () => montarBuckets(items, hoje, fimSemana),
    [items, hoje, fimSemana],
  );
  const total = buckets.reduce((soma, b) => soma + b.itens.length, 0);

  return (
    <div className="rounded-lg border bg-card p-4">
      <h3 className="flex items-center gap-2 text-sm font-semibold">
        <CheckCircle2 className="h-4 w-4 text-emerald-600" />
        A concluir
      </h3>

      {total === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">
          Nada pendente. Tudo em dia! 🎉
        </p>
      ) : (
        <div className="mt-3 space-y-4">
          {buckets
            .filter((b) => b.itens.length > 0)
            .map((bucket) => (
              <div key={bucket.chave}>
                <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  <span className={`inline-block h-2 w-2 rounded-full ${bucket.cor}`} />
                  {bucket.titulo}
                  <span className="rounded-full bg-muted px-1.5 text-[10px] font-semibold">
                    {bucket.itens.length}
                  </span>
                </div>
                <div className="space-y-2">
                  {bucket.itens.map((item) => (
                    <ItemAgenda
                      key={`${item.tipo}-${item.id}`}
                      item={item}
                      onConcluir={() => onConcluir(item)}
                      onReabrir={() => onReabrir(item)}
                      onEditar={() => onEditar(item)}
                      onExcluir={() => onExcluir(item)}
                      onPagar={() => onPagar(item)}
                    />
                  ))}
                </div>
              </div>
            ))}
        </div>
      )}
    </div>
  );
}
