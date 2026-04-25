"use client";

import * as React from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, ShieldCheck, ShieldOff } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

type Props = {
  inicialAtivo: boolean;
};

export function Toggle2FA({ inicialAtivo }: Props) {
  const qc = useQueryClient();
  const [ativo, setAtivo] = React.useState(inicialAtivo);

  React.useEffect(() => {
    setAtivo(inicialAtivo);
  }, [inicialAtivo]);

  const mutar = useMutation({
    mutationFn: async (enabled: boolean) => {
      const r = await fetch("/api/perfil/2fa", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.erro ?? "Erro");
      }
      return r.json() as Promise<{ twoFactorEnabled: boolean }>;
    },
    onSuccess: (data) => {
      setAtivo(data.twoFactorEnabled);
      qc.invalidateQueries({ queryKey: ["auth-me"] });
      toast.success(
        data.twoFactorEnabled
          ? "2FA ativado. Próximo login pedirá código."
          : "2FA desativado.",
      );
    },
    onError: (err) => toast.error((err as Error).message),
  });

  return (
    <div className="flex items-start gap-3 rounded-lg border bg-muted/20 p-4">
      <div
        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
          ativo
            ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
            : "bg-muted text-muted-foreground"
        }`}
      >
        {ativo ? <ShieldCheck className="h-4 w-4" /> : <ShieldOff className="h-4 w-4" />}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium">Verificação em duas etapas</p>
        <p className="text-xs text-muted-foreground">
          {ativo
            ? "Ativo · método: Email. A cada login, enviaremos um código de 6 dígitos."
            : "Desativado. Recomendado ativar para mais segurança da sua conta."}
        </p>
      </div>
      <Button
        type="button"
        size="sm"
        variant={ativo ? "outline" : "default"}
        disabled={mutar.isPending}
        onClick={() => mutar.mutate(!ativo)}
      >
        {mutar.isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
        {ativo ? "Desativar" : "Ativar"}
      </Button>
    </div>
  );
}
