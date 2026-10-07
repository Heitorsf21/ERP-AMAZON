"use client";

import * as React from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

export type ControleLogout = {
  sair: () => Promise<void>;
  saindo: boolean;
};

export function useLogout(): ControleLogout {
  const qc = useQueryClient();
  const [saindo, setSaindo] = React.useState(false);

  const encerrar = React.useCallback(async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch {
      // Mesmo com erro, seguimos: o cookie é revalidado no próximo load.
    }
    qc.clear();
    toast.success("Sessão encerrada.");
    // Navegação "dura": descarta todo estado de cliente da conta anterior.
    window.location.href = "/login";
  }, [qc]);

  const sair = React.useCallback(async () => {
    if (saindo) return;
    setSaindo(true);
    await encerrar();
  }, [saindo, encerrar]);

  return { sair, saindo };
}
