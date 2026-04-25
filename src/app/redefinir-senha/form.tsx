"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  CheckCircle2,
  Eye,
  EyeOff,
  Loader2,
  Lock,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function RedefinirSenhaForm({ token }: { token: string }) {
  const router = useRouter();
  const [novaSenha, setNovaSenha] = useState("");
  const [confirmar, setConfirmar] = useState("");
  const [mostrar, setMostrar] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [sucesso, setSucesso] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErro(null);

    if (novaSenha.length < 8) {
      setErro("Senha precisa ter ao menos 8 caracteres.");
      return;
    }
    if (novaSenha !== confirmar) {
      setErro("As senhas não coincidem.");
      return;
    }

    setEnviando(true);
    try {
      const r = await fetch("/api/auth/redefinir-senha", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token, novaSenha }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        setErro(
          j.erro === "TOKEN_INVALIDO_OU_EXPIRADO"
            ? "Link inválido ou expirado. Solicite um novo."
            : (j.erro ?? "Não foi possível redefinir agora."),
        );
        setEnviando(false);
        return;
      }
      setSucesso(true);
      setTimeout(() => router.replace("/login"), 2000);
    } catch {
      setErro("Falha de conexão.");
      setEnviando(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="w-full max-w-sm">
        <Link
          href="/login"
          className="mb-6 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Voltar para o login
        </Link>

        {sucesso ? (
          <div className="rounded-xl border bg-card p-6 text-center">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-600">
              <CheckCircle2 className="h-6 w-6" />
            </div>
            <h1 className="text-xl font-semibold">Senha redefinida</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Redirecionando para o login…
            </p>
          </div>
        ) : (
          <>
            <h1 className="text-2xl font-semibold tracking-tight">Nova senha</h1>
            <p className="mt-1.5 text-sm text-muted-foreground">
              Mínimo de 8 caracteres. Use uma combinação forte.
            </p>

            <form onSubmit={onSubmit} className="mt-6 space-y-4" noValidate>
              <div className="space-y-1.5">
                <Label htmlFor="nova">Nova senha</Label>
                <div className="relative">
                  <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="nova"
                    type={mostrar ? "text" : "password"}
                    autoComplete="new-password"
                    className="pl-9 pr-10"
                    value={novaSenha}
                    onChange={(e) => setNovaSenha(e.target.value)}
                    minLength={8}
                    required
                    disabled={enviando}
                  />
                  <button
                    type="button"
                    onClick={() => setMostrar((v) => !v)}
                    tabIndex={-1}
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground transition hover:text-foreground"
                    aria-label={mostrar ? "Ocultar senha" : "Mostrar senha"}
                  >
                    {mostrar ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </button>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="confirmar">Confirmar nova senha</Label>
                <div className="relative">
                  <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="confirmar"
                    type={mostrar ? "text" : "password"}
                    autoComplete="new-password"
                    className="pl-9"
                    value={confirmar}
                    onChange={(e) => setConfirmar(e.target.value)}
                    minLength={8}
                    required
                    disabled={enviando}
                  />
                </div>
              </div>

              {erro && (
                <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  {erro}
                </div>
              )}

              <Button type="submit" className="w-full" disabled={enviando}>
                {enviando ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Salvando…
                  </>
                ) : (
                  "Definir nova senha"
                )}
              </Button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
