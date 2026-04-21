"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function AlterarSenhaForm() {
  const [senhaAtual, setSenhaAtual] = useState("");
  const [senhaNova, setSenhaNova] = useState("");
  const [confirmacao, setConfirmacao] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (enviando) return;
    setErro(null);

    if (senhaNova.length < 8) {
      setErro("A senha nova deve ter ao menos 8 caracteres.");
      return;
    }
    if (senhaNova !== confirmacao) {
      setErro("As senhas novas não conferem.");
      return;
    }

    setEnviando(true);
    try {
      const res = await fetch("/api/auth/alterar-senha", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ senhaAtual, senhaNova }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { erro?: string } | null;
        const msg = body?.erro;
        if (msg === "SENHA_ATUAL_INCORRETA") {
          setErro("Senha atual incorreta.");
        } else if (msg) {
          setErro(msg);
        } else {
          setErro("Não foi possível trocar a senha agora.");
        }
        return;
      }
      toast.success("Senha atualizada.");
      setSenhaAtual("");
      setSenhaNova("");
      setConfirmacao("");
    } catch {
      setErro("Falha de conexão.");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor="senhaAtual">Senha atual</Label>
        <Input
          id="senhaAtual"
          type="password"
          autoComplete="current-password"
          value={senhaAtual}
          onChange={(e) => setSenhaAtual(e.target.value)}
          required
          disabled={enviando}
        />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="senhaNova">Nova senha</Label>
          <Input
            id="senhaNova"
            type="password"
            autoComplete="new-password"
            value={senhaNova}
            onChange={(e) => setSenhaNova(e.target.value)}
            required
            minLength={8}
            disabled={enviando}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="confirmacao">Confirmar nova senha</Label>
          <Input
            id="confirmacao"
            type="password"
            autoComplete="new-password"
            value={confirmacao}
            onChange={(e) => setConfirmacao(e.target.value)}
            required
            minLength={8}
            disabled={enviando}
          />
        </div>
      </div>
      {erro && (
        <p className="text-sm text-destructive" role="alert">
          {erro}
        </p>
      )}
      <Button type="submit" disabled={enviando}>
        {enviando ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Salvando…
          </>
        ) : (
          "Atualizar senha"
        )}
      </Button>
    </form>
  );
}
