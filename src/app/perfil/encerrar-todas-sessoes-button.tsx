"use client";

import * as React from "react";
import { Loader2, ShieldOff } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

/**
 * Invalida sessoes em outros devices (atual permanece). Util quando o
 * usuario suspeita de cookie vazado em outro lugar.
 */
export function EncerrarTodasSessoesButton() {
  const [enviando, setEnviando] = React.useState(false);

  async function encerrarTodas() {
    if (enviando) return;
    const ok = window.confirm(
      "Encerrar todas as sessões em outros dispositivos? Você continuará logado aqui.",
    );
    if (!ok) return;

    setEnviando(true);
    try {
      const res = await fetch("/api/auth/encerrar-sessoes", { method: "POST" });
      if (!res.ok) {
        toast.error("Não foi possível encerrar as sessões agora.");
        return;
      }
      toast.success("Outras sessões encerradas. Você segue logado aqui.");
    } catch {
      toast.error("Falha de conexão.");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Button variant="outline" onClick={encerrarTodas} disabled={enviando}>
      {enviando ? (
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
      ) : (
        <ShieldOff className="mr-2 h-4 w-4" />
      )}
      {enviando ? "Encerrando…" : "Encerrar outras sessões"}
    </Button>
  );
}
