"use client";

import * as React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import { PwaProvider } from "@/components/pwa/pwa-provider";
import { deveRecarregarAoVoltar } from "@/lib/pwa/refetch";

export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = React.useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            refetchOnWindowFocus: false,
            staleTime: 30_000,
            retry: 1,
          },
        },
      }),
  );

  // App instalado não tem "recarregar": ao voltar ao primeiro plano, atualiza
  // os números do dia (dashboard, vendas, produto, sino).
  React.useEffect(() => {
    function aoVoltar() {
      if (document.visibilityState !== "visible") return;
      void client.invalidateQueries({
        predicate: (q) => deveRecarregarAoVoltar(q.queryKey),
      });
    }
    document.addEventListener("visibilitychange", aoVoltar);
    return () => document.removeEventListener("visibilitychange", aoVoltar);
  }, [client]);

  return (
    <ThemeProvider attribute="class" defaultTheme="light" enableSystem>
      <QueryClientProvider client={client}>
        <PwaProvider>{children}</PwaProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}
