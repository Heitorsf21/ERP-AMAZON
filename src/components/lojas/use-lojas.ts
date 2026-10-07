"use client";

import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { fetchJSON } from "@/lib/fetcher";
import { lojasComCor, type LojaComCor } from "@/modules/lojas/regras";
import type { Loja, LojaVinculada } from "@/modules/lojas/vinculos";
import { avisarOutrasAbas } from "./sessao-canal";
import { definirVisaoInicio, type VisaoInicio } from "./visao-inicio";

export type LojasResposta = { atual: Loja; vinculadas: LojaVinculada[] };
export type { LojaComCor };

export const CHAVE_LOJAS = ["lojas"] as const;

/** Lojas da conta (a aberta + as vinculadas), na ordem e cor fixas. */
export function useLojas() {
  const query = useQuery<LojasResposta>({
    queryKey: CHAVE_LOJAS,
    queryFn: () => fetchJSON<LojasResposta>("/api/lojas"),
    staleTime: 5 * 60_000,
    retry: false,
  });
  const lojas = React.useMemo<LojaComCor[]>(
    () => (query.data ? lojasComCor(query.data.atual, query.data.vinculadas) : []),
    [query.data],
  );
  const atual = lojas.find((l) => l.atual) ?? null;
  return {
    ...query,
    lojas,
    atual,
    temVinculo: lojas.length > 1,
  };
}

/**
 * Troca para a loja vinculada `empresaId` e abre `destino`. Navegação dura
 * (window.location) depois de limpar o cache: nada da loja anterior sobra.
 */
export function useTrocarLoja() {
  const qc = useQueryClient();
  const [trocandoPara, setTrocandoPara] = React.useState<string | null>(null);
  const emAndamento = React.useRef(false);

  const trocar = React.useCallback(
    async (empresaId: string, opcoes: { destino?: string; visao?: VisaoInicio } = {}) => {
      if (emAndamento.current) return;
      emAndamento.current = true;
      setTrocandoPara(empresaId);
      try {
        await fetchJSON("/api/auth/trocar-loja", {
          method: "POST",
          body: JSON.stringify({ empresaId }),
        });
      } catch {
        emAndamento.current = false;
        setTrocandoPara(null);
        toast.error("Não deu para trocar de loja. Tente de novo.");
        return;
      }
      if (opcoes.visao) definirVisaoInicio(opcoes.visao);
      avisarOutrasAbas(empresaId);
      qc.clear();
      window.location.href = opcoes.destino ?? "/dashboard-ecommerce";
    },
    [qc],
  );

  return { trocar, trocandoPara };
}
