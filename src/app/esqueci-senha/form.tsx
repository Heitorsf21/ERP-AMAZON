"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, Loader2, Mail, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function EsqueciSenhaForm() {
  const [email, setEmail] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [enviado, setEnviado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setEnviando(true);
    setErro(null);
    try {
      const r = await fetch("/api/auth/recuperar-senha", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email }),
      });
      if (!r.ok) {
        setErro("Não foi possível processar agora. Tente novamente.");
        setEnviando(false);
        return;
      }
      setEnviado(true);
    } catch {
      setErro("Falha de conexão.");
    } finally {
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

        {enviado ? (
          <div className="rounded-xl border bg-card p-6 text-center">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-600">
              <CheckCircle2 className="h-6 w-6" />
            </div>
            <h1 className="text-xl font-semibold">Verifique seu email</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Se existir uma conta para <strong>{email}</strong>, enviamos um
              link de redefinição. O link expira em 1 hora.
            </p>
            <p className="mt-4 text-xs text-muted-foreground">
              Não chegou? Confira a caixa de spam.
            </p>
          </div>
        ) : (
          <>
            <h1 className="text-2xl font-semibold tracking-tight">
              Esqueci minha senha
            </h1>
            <p className="mt-1.5 text-sm text-muted-foreground">
              Informe o e-mail da sua conta. Enviaremos um link para criar uma
              nova senha.
            </p>

            <form onSubmit={onSubmit} className="mt-6 space-y-4" noValidate>
              <div className="space-y-1.5">
                <Label htmlFor="email">E-mail</Label>
                <div className="relative">
                  <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="email"
                    type="email"
                    autoComplete="email"
                    placeholder="voce@empresa.com"
                    className="pl-9"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
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
                    Enviando…
                  </>
                ) : (
                  "Enviar link de redefinição"
                )}
              </Button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
