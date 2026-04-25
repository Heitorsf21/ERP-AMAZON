"use client";

import * as React from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, Save } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { fetchJSON } from "@/lib/fetcher";

type Props = {
  nomeInicial: string;
  emailInicial: string;
};

export function DadosForm({ nomeInicial, emailInicial }: Props) {
  const qc = useQueryClient();
  const [nome, setNome] = React.useState(nomeInicial);
  const [email, setEmail] = React.useState(emailInicial);

  const mudou = nome.trim() !== nomeInicial || email.trim() !== emailInicial;

  const salvar = useMutation({
    mutationFn: (data: { nome: string; email: string }) =>
      fetchJSON("/api/perfil", {
        method: "PATCH",
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["auth-me"] });
      toast.success("Dados atualizados");
    },
    onError: (err) => toast.error((err as Error).message ?? "Erro ao salvar"),
  });

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!mudou || salvar.isPending) return;
    salvar.mutate({ nome: nome.trim(), email: email.trim() });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="nome">Nome</Label>
        <Input
          id="nome"
          value={nome}
          onChange={(e) => setNome(e.target.value)}
          minLength={2}
          required
          disabled={salvar.isPending}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="email">E-mail</Label>
        <Input
          id="email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          disabled={salvar.isPending}
        />
        <p className="text-[11px] text-muted-foreground">
          Mudar o e-mail também muda o login.
        </p>
      </div>
      <div className="flex justify-end pt-2">
        <Button type="submit" disabled={!mudou || salvar.isPending}>
          {salvar.isPending ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Salvando…
            </>
          ) : (
            <>
              <Save className="mr-2 h-4 w-4" />
              Salvar alterações
            </>
          )}
        </Button>
      </div>
    </form>
  );
}
