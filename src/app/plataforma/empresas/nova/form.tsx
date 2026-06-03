"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Building2, Mail, User, Tag, Loader2, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function NovaEmpresaForm() {
  const router = useRouter();
  const [nome, setNome] = useState("");
  const [slug, setSlug] = useState("");
  const [adminNome, setAdminNome] = useState("");
  const [adminEmail, setAdminEmail] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    setMsg(null);
    setLoading(true);
    const res = await fetch("/api/plataforma/empresas", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ nome, slug, admin: { nome: adminNome, email: adminEmail } }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setLoading(false);
      setErro(
        data.erro === "SLUG_OU_EMAIL_DUPLICADO"
          ? "Slug ou e-mail já existe."
          : data.detalhe || "Erro ao criar a empresa.",
      );
      return;
    }
    if (data.conviteViaConsole) {
      setMsg("Empresa criada. Convite registrado no console (SMTP não configurado).");
    } else if (data.conviteEmailOk === false) {
      setMsg("Empresa criada, mas o e-mail de convite falhou. Use 'Reenviar convite'.");
    } else {
      setMsg("Empresa criada. Convite enviado por e-mail.");
    }
    setTimeout(() => {
      router.push("/plataforma");
      router.refresh();
    }, 1400);
  }

  return (
    <form onSubmit={submit} className="space-y-5">
      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="nome">Nome da empresa</Label>
          <div className="relative">
            <Building2 className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="nome"
              placeholder="Ex: Loja X Comércio"
              className="pl-9"
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              required
              disabled={loading}
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="slug">Slug</Label>
          <div className="relative">
            <Tag className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="slug"
              placeholder="ex: lojax"
              className="pl-9"
              value={slug}
              onChange={(e) => setSlug(e.target.value.toLowerCase())}
              required
              disabled={loading}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Identificador usado no login dos usuários da empresa. Apenas
            minúsculas, números e hífen.
          </p>
        </div>
      </div>

      <div className="space-y-4 border-t border-border pt-5">
        <p className="text-sm font-medium">Administrador da empresa</p>

        <div className="space-y-1.5">
          <Label htmlFor="adminNome">Nome do admin</Label>
          <div className="relative">
            <User className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="adminNome"
              placeholder="Nome completo"
              className="pl-9"
              value={adminNome}
              onChange={(e) => setAdminNome(e.target.value)}
              required
              disabled={loading}
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="adminEmail">E-mail do admin</Label>
          <div className="relative">
            <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="adminEmail"
              type="email"
              placeholder="admin@empresa.com"
              className="pl-9"
              value={adminEmail}
              onChange={(e) => setAdminEmail(e.target.value)}
              required
              disabled={loading}
            />
          </div>
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
      {msg && (
        <div
          role="status"
          className="flex items-center gap-2 rounded-md border border-emerald-600/30 bg-emerald-600/10 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-400"
        >
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          {msg}
        </div>
      )}

      <Button type="submit" className="w-full" disabled={loading}>
        {loading ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Criando…
          </>
        ) : (
          "Criar empresa e convidar admin"
        )}
      </Button>
    </form>
  );
}
