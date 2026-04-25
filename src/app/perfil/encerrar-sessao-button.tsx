"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Loader2, LogOut } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

export function EncerrarSessaoButton() {
  const router = useRouter();
  const [enviando, setEnviando] = React.useState(false);

  async function encerrar() {
    if (enviando) return;
    setEnviando(true);
    try {
      const res = await fetch("/api/auth/logout", { method: "POST" });
      if (!res.ok) {
        toast.error("Nao foi possivel encerrar a sessao agora.");
        return;
      }
      toast.success("Sessao encerrada.");
      router.replace("/login");
      router.refresh();
    } catch {
      toast.error("Falha de conexao.");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Button variant="outline" onClick={encerrar} disabled={enviando}>
      {enviando ? (
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
      ) : (
        <LogOut className="mr-2 h-4 w-4" />
      )}
      {enviando ? "Encerrando…" : "Encerrar sessao"}
    </Button>
  );
}
