"use client";

import * as React from "react";
import { detectarPlataforma, type Plataforma } from "@/lib/pwa/plataforma";

type EventoInstalacao = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

type ContextoPwa = {
  plataforma: Plataforma | null;
  /** Android/Chrome com `beforeinstallprompt`: dá para instalar com um toque. */
  podeInstalarDireto: boolean;
  instalar: () => Promise<boolean>;
  registro: ServiceWorkerRegistration | null;
};

const PwaContext = React.createContext<ContextoPwa>({
  plataforma: null,
  podeInstalarDireto: false,
  instalar: async () => false,
  registro: null,
});

export function PwaProvider({ children }: { children: React.ReactNode }) {
  const [plataforma, setPlataforma] = React.useState<Plataforma | null>(null);
  const [evento, setEvento] = React.useState<EventoInstalacao | null>(null);
  const [registro, setRegistro] = React.useState<ServiceWorkerRegistration | null>(null);

  React.useEffect(() => {
    const nav = navigator as Navigator & { standalone?: boolean };
    const standalone =
      window.matchMedia("(display-mode: standalone)").matches || nav.standalone === true;
    setPlataforma(detectarPlataforma(nav.userAgent, standalone, nav.maxTouchPoints ?? 0));

    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker
      .register("/sw.js", { scope: "/", updateViaCache: "none" })
      .then(setRegistro)
      .catch(() => setRegistro(null));
  }, []);

  React.useEffect(() => {
    function capturar(e: Event) {
      e.preventDefault();
      setEvento(e as EventoInstalacao);
    }
    window.addEventListener("beforeinstallprompt", capturar);
    return () => window.removeEventListener("beforeinstallprompt", capturar);
  }, []);

  const instalar = React.useCallback(async () => {
    if (!evento) return false;
    await evento.prompt();
    const escolha = await evento.userChoice;
    setEvento(null);
    return escolha.outcome === "accepted";
  }, [evento]);

  const valor = React.useMemo<ContextoPwa>(
    () => ({ plataforma, podeInstalarDireto: !!evento, instalar, registro }),
    [plataforma, evento, instalar, registro],
  );

  return <PwaContext.Provider value={valor}>{children}</PwaContext.Provider>;
}

export function usePwa(): ContextoPwa {
  return React.useContext(PwaContext);
}
