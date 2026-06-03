"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { Lock, Mail, Loader2, ShieldCheck, Building2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function PlataformaLoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    setLoading(true);
    const res = await fetch("/api/plataforma/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, senha }),
    });
    setLoading(false);
    if (!res.ok) {
      setErro(
        res.status === 429
          ? "Muitas tentativas. Aguarde alguns minutos."
          : "Credenciais inválidas.",
      );
      return;
    }
    router.push("/plataforma");
    router.refresh();
  }

  return (
    <div className="grid min-h-screen w-full lg:grid-cols-2">
      {/* Branding — coluna navy (identidade Atlas Seller) */}
      <aside className="relative hidden overflow-hidden bg-[#0b1220] text-white lg:flex lg:flex-col lg:justify-between lg:p-10">
        <div className="pointer-events-none absolute -left-24 -top-24 h-72 w-72 rounded-full bg-indigo-500/30 blur-3xl" />
        <div className="pointer-events-none absolute -right-20 top-1/3 h-80 w-80 rounded-full bg-cyan-400/20 blur-3xl" />
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.07]"
          style={{
            backgroundImage:
              "linear-gradient(rgba(255,255,255,0.35) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.35) 1px, transparent 1px)",
            backgroundSize: "32px 32px",
          }}
        />

        <div className="relative flex items-center gap-3">
          <Image
            src="/atlas-symbol.png"
            alt="Atlas Seller"
            width={36}
            height={36}
            priority
            className="shrink-0 object-contain"
            style={{ height: 36, width: 36 }}
          />
          <div>
            <p className="text-base font-semibold tracking-tight">Atlas Seller</p>
            <p className="text-xs text-white/60">Console da plataforma</p>
          </div>
        </div>

        <div className="relative space-y-4">
          <h2 className="text-3xl font-semibold leading-tight tracking-tight">
            Gestão multi-empresa, em um só lugar.
          </h2>
          <p className="max-w-md text-sm leading-relaxed text-white/70">
            Crie e administre as empresas que usam o Atlas Seller, convide os
            administradores e acompanhe as conexões Amazon de cada seller.
          </p>
        </div>

        <div className="relative flex items-center gap-2 text-xs text-white/50">
          <ShieldCheck className="h-3.5 w-3.5" />
          Área restrita · acesso de superadministrador
        </div>
      </aside>

      {/* Formulário */}
      <section className="relative flex items-center justify-center bg-background p-6 sm:p-10">
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-transparent" />
        <div className="relative w-full max-w-sm">
          {/* Marca no mobile */}
          <div className="mb-8 flex items-center gap-2.5 lg:hidden">
            <Image
              src="/atlas-symbol.png"
              alt="Atlas Seller"
              width={32}
              height={32}
              priority
              className="shrink-0 object-contain"
              style={{ height: 32, width: 32 }}
            />
            <div>
              <p className="text-sm font-semibold leading-none">Atlas Seller</p>
              <p className="text-xs text-muted-foreground">Console da plataforma</p>
            </div>
          </div>

          <div className="mb-7 inline-flex items-center gap-1.5 rounded-full border border-border bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">
            <Building2 className="h-3.5 w-3.5" />
            Superadministrador
          </div>

          <div className="space-y-1.5">
            <h1 className="text-2xl font-semibold tracking-tight">
              Acessar o console
            </h1>
            <p className="text-sm text-muted-foreground">
              Entre com sua conta de plataforma para gerenciar as empresas.
            </p>
          </div>

          <form onSubmit={submit} className="mt-7 space-y-4" noValidate>
            <div className="space-y-1.5">
              <Label htmlFor="email">E-mail</Label>
              <div className="relative">
                <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  placeholder="voce@plataforma.com"
                  className="pl-9"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  disabled={loading}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="senha">Senha</Label>
              <div className="relative">
                <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="senha"
                  type="password"
                  autoComplete="current-password"
                  placeholder="••••••••"
                  className="pl-9"
                  value={senha}
                  onChange={(e) => setSenha(e.target.value)}
                  required
                  disabled={loading}
                />
              </div>
            </div>

            {erro && (
              <div
                role="alert"
                className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
              >
                {erro}
              </div>
            )}

            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? (
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
            Console separado do login das empresas.
          </p>
        </div>
      </section>
    </div>
  );
}
