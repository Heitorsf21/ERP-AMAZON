"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchJSON } from "@/lib/fetcher";
import { ALL_NAV_ITEMS, HOME_ITEM, NAV_GROUPS } from "@/components/nav-routes";
import { filtrarGruposVisiveis } from "@/modules/menu/preferencias";

export const MENU_QUERY_KEY = ["menu-preferencias"] as const;

type RespostaMenu = { ocultas: string[] };

export function useMenuOcultas() {
  return useQuery<RespostaMenu>({
    queryKey: MENU_QUERY_KEY,
    queryFn: () => fetchJSON<RespostaMenu>("/api/menu/preferencias"),
    staleTime: Infinity,
  });
}

/** Menu do usuário: grupos/itens já sem as abas que ele escondeu. */
export function useMenuVisivel() {
  const { data } = useMenuOcultas();
  const ocultas = React.useMemo(() => data?.ocultas ?? [], [data]);
  return React.useMemo(() => {
    const set = new Set(ocultas);
    return {
      ocultas,
      homeVisivel: !set.has(HOME_ITEM.href),
      grupos: filtrarGruposVisiveis(NAV_GROUPS, ocultas),
      itens: ALL_NAV_ITEMS.filter((item) => !set.has(item.href)),
    };
  }, [ocultas]);
}

export function useSalvarMenu() {
  const qc = useQueryClient();
  return useMutation<RespostaMenu, Error, string[], { anterior?: RespostaMenu }>({
    mutationFn: (ocultas) =>
      fetchJSON<RespostaMenu>("/api/menu/preferencias", {
        method: "PUT",
        body: JSON.stringify({ ocultas }),
      }),
    // Otimista: o menu muda na hora; se o PUT falhar, volta ao estado anterior.
    onMutate: async (ocultas) => {
      await qc.cancelQueries({ queryKey: MENU_QUERY_KEY });
      const anterior = qc.getQueryData<RespostaMenu>(MENU_QUERY_KEY);
      qc.setQueryData<RespostaMenu>(MENU_QUERY_KEY, { ocultas });
      return { anterior };
    },
    onError: (_erro, _vars, ctx) => {
      if (ctx?.anterior) qc.setQueryData(MENU_QUERY_KEY, ctx.anterior);
    },
    onSuccess: (data) => qc.setQueryData(MENU_QUERY_KEY, data),
  });
}
