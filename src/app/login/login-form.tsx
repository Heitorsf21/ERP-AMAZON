"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Eye,
  EyeOff,
  Loader2,
  Lock,
  Mail,
  ShieldCheck,
  Sparkles,
  Building2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Verificacao2FA } from "@/components/auth/verificacao-2fa";

type LoginResponse =
  | { usuario: { id: string; email: string; nome: string; role: string } }
  | { requires2FA: true; challengeId: string; lembrar: boolean };

export function LoginForm({ nextPath }: { nextPath?: string }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [lembrar, setLembrar] = useState(false);
  const [mostrarSenha, setMostrarSenha] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [, startTransition] = useTransition();

  // Estado 2FA
  const [challenge, setChallenge] = useState<{
    challengeId: string;
    lembrar: boolean;
  } | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (enviando) return;
    setErro(null);
    setEnviando(true);

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, senha, lembrar }),
      });

      if (!res.ok) {
        if (res.status === 401) {
          setErro("E-mail ou senha incorretos.");
        } else if (res.status === 400) {
          setErro("Preencha e-mail e senha corretamente.");
        } else {
          setErro("Não foi possível entrar agora. Tente novamente.");
        }
        setEnviando(false);
        return;
      }

      const data = (await res.json()) as LoginResponse;

      if ("requires2FA" in data) {
        // Entra no fluxo de 2FA
        setChallenge({ challengeId: data.challengeId, lembrar: data.lembrar });
        setEnviando(false);
        return;
      }

      // Login direto
      const destino = nextPath && nextPath.startsWith("/") ? nextPath : "/home";
      startTransition(() => {
        router.replace(destino);
        router.refresh();
      });
    } catch {
      setErro("Falha de conexão. Verifique sua internet.");
      setEnviando(false);
    }
  }

  function onVerificado() {
    const destino = nextPath && nextPath.startsWith("/") ? nextPath : "/home";
    startTransition(() => {
      router.replace(destino);
      router.refresh();
    });
  }

  return (
    <div className="relative grid min-h-screen w-full lg:grid-cols-2">
      {/* Coluna lateral — branding Mundo F&S */}
      <aside className="relative hidden overflow-hidden bg-[#0b1220] text-white lg:flex lg:flex-col lg:justify-between lg:p-10">
        <div className="pointer-events-none absolute -left-24 -top-24 h-72 w-72 rounded-full bg-indigo-500/30 blur-3xl" />
        <div className="pointer-events-none absolute -right-20 top-1/3 h-80 w-80 rounded-full bg-cyan-400/20 blur-3xl" />
        <div className="pointer-events-none absolute bottom-0 left-1/4 h-64 w-64 rounded-full bg-fuchsia-500/15 blur-3xl" />
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.08]"
          style={{
            backgroundImage:
              "linear-gradient(rgba(255,255,255,0.35) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.35) 1px, transparent 1px)",
            backgroundSize: "32px 32px",
          }}
        />

        <div className="relative flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-white/10 backdrop-blur ring-1 ring-white/15">
            <Building2 className="h-5 w-5 text-cyan-300" />
          </div>
          <div>
            <p className="text-base font-semibold tracking-wide">MUNDO F&amp;S</p>
            <p className="text-xs text-white/60">Centro de operações Amazon</p>
          </div>
        </div>

        <div className="relative space-y-6">
          <div>
            <h2 className="text-3xl font-semibold leading-tight tracking-tight">
              Sua operação Amazon, do estoque ao caixa, em um só lugar.
            </h2>
            <p className="mt-3 max-w-md text-sm leading-relaxed text-white/70">
              Vendas, reembolsos, buybox, contas a pagar e a receber — tudo
              sincronizado em tempo real com a SP-API.
            </p>
          </div>
          <div className="grid gap-3 text-sm">
            <Feature text="Sincronização automática Amazon (orders, FBA, settlement)" />
            <Feature text="Conciliação financeira de boletos, NFs e extratos" />
            <Feature text="Indicadores em tempo real: vendas, ACoS, margem" />
          </div>
        </div>

        <div className="relative flex items-center gap-2 text-xs text-white/50">
          <ShieldCheck className="h-3.5 w-3.5" />
          Sessão criptografada · cookie httpOnly · ERP v1.0
        </div>
      </aside>

      {/* Coluna do formulário */}
      <section className="relative flex items-center justify-center bg-background p-6 sm:p-10">
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-transparent" />
        <div className="relative w-full max-w-sm">
          {/* Marca no mobile */}
          <div className="mb-8 flex items-center gap-2 lg:hidden">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Sparkles className="h-4 w-4" />
            </div>
            <div>
              <p className="text-sm font-semibold">MUNDO F&amp;S — ERP</p>
              <p className="text-xs text-muted-foreground">Centro de operações</p>
            </div>
          </div>

          {challenge ? (
            <Verificacao2FA
              challengeId={challenge.challengeId}
              lembrar={challenge.lembrar}
              email={email}
              onVerificado={onVerificado}
              onCancelar={() => setChallenge(null)}
            />
          ) : (
            <>
              <div className="space-y-1.5">
                <h1 className="text-2xl font-semibold tracking-tight">
                  Bem-vindo de volta
                </h1>
                <p className="text-sm text-muted-foreground">
                  Entre com seu e-mail e senha para acessar o sistema.
                </p>
              </div>

              <form onSubmit={onSubmit} className="mt-7 space-y-4" noValidate>
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

                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="senha">Senha</Label>
                    <Link
                      href="/esqueci-senha"
                      className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                    >
                      Esqueci minha senha
                    </Link>
                  </div>
                  <div className="relative">
                    <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      id="senha"
                      type={mostrarSenha ? "text" : "password"}
                      autoComplete="current-password"
                      placeholder="••••••••"
                      className="pl-9 pr-10"
                      value={senha}
                      onChange={(e) => setSenha(e.target.value)}
                      required
                      minLength={1}
                      disabled={enviando}
                    />
                    <button
                      type="button"
                      onClick={() => setMostrarSenha((v) => !v)}
                      tabIndex={-1}
                      className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground transition hover:text-foreground"
                      aria-label={mostrarSenha ? "Ocultar senha" : "Mostrar senha"}
                    >
                      {mostrarSenha ? (
                        <EyeOff className="h-4 w-4" />
                      ) : (
                        <Eye className="h-4 w-4" />
                      )}
                    </button>
                  </div>
                </div>

                <label className="flex items-center gap-2 text-sm text-muted-foreground select-none">
                  <input
                    type="checkbox"
                    checked={lembrar}
                    onChange={(e) => setLembrar(e.target.checked)}
                    className="h-4 w-4 rounded border-input text-primary focus:ring-2 focus:ring-ring"
                    disabled={enviando}
                  />
                  Lembrar este dispositivo (30 dias)
                </label>

                {erro && (
                  <div
                    role="alert"
                    className="animate-in fade-in slide-in-from-top-1 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
                  >
                    {erro}
                  </div>
                )}

                <Button type="submit" className="w-full" disabled={enviando}>
                  {enviando ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Entrando…
                    </>
                  ) : (
                    "Entrar"
                  )}
                </Button>
              </form>

              <p className="mt-6 text-center text-xs text-muted-foreground">
                Acesso restrito · Para novos usuários, fale com o administrador.
              </p>
            </>
          )}
        </div>
      </section>
    </div>
  );
}

function Feature({ text }: { text: string }) {
  return (
    <div className="flex items-start gap-2.5">
      <div className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-white/10 ring-1 ring-white/20">
        <div className="h-1.5 w-1.5 rounded-full bg-cyan-300" />
      </div>
      <p className="text-white/80">{text}</p>
    </div>
  );
}
