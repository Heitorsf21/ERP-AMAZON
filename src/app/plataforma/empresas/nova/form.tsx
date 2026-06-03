"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Building2,
  Mail,
  User,
  Tag,
  KeyRound,
  Loader2,
  CheckCircle2,
  Copy,
  Check,
  MessageCircle,
  ArrowLeft,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Resultado =
  | { tipo: "senha"; adminEmail: string; slug: string }
  | { tipo: "convite"; url: string; empresaNome: string; adminEmail: string; slug: string };

function mensagemWhatsApp(r: Extract<Resultado, { tipo: "convite" }>): string {
  return (
    `Olá! Você foi cadastrado(a) como administrador da empresa *${r.empresaNome}* no Atlas Seller.\n\n` +
    `Para acessar, defina sua senha neste link:\n${r.url}\n\n` +
    `Seu login depois: e-mail ${r.adminEmail} (empresa: ${r.slug}). O link expira em 7 dias.`
  );
}

export function NovaEmpresaForm() {
  const router = useRouter();
  const [nome, setNome] = useState("");
  const [slug, setSlug] = useState("");
  const [adminNome, setAdminNome] = useState("");
  const [adminEmail, setAdminEmail] = useState("");
  const [adminSenha, setAdminSenha] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const [copiado, setCopiado] = useState<"link" | "whatsapp" | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    setLoading(true);
    const res = await fetch("/api/plataforma/empresas", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        nome,
        slug,
        admin: { nome: adminNome, email: adminEmail, senha: adminSenha || undefined },
      }),
    });
    const data = await res.json().catch(() => ({}));
    setLoading(false);
    if (!res.ok) {
      setErro(
        data.erro === "SLUG_OU_EMAIL_DUPLICADO"
          ? "Slug ou e-mail já existe."
          : data.erro === "DADOS_INVALIDOS"
            ? "Dados inválidos (a senha precisa de no mínimo 8 caracteres)."
            : data.detalhe || "Erro ao criar a empresa.",
      );
      return;
    }
    if (data.senhaDefinida) {
      setResultado({ tipo: "senha", adminEmail, slug });
    } else if (data.conviteUrl) {
      setResultado({ tipo: "convite", url: data.conviteUrl, empresaNome: nome, adminEmail, slug });
    } else {
      router.push("/plataforma");
      router.refresh();
    }
  }

  async function copiar(texto: string, qual: "link" | "whatsapp") {
    try {
      await navigator.clipboard.writeText(texto);
      setCopiado(qual);
      setTimeout(() => setCopiado(null), 1800);
    } catch {
      setErro("Não foi possível copiar — selecione e copie manualmente.");
    }
  }

  // ── Tela de resultado ────────────────────────────────────────────────
  if (resultado) {
    return (
      <div className="space-y-5">
        <div className="flex items-center gap-2 rounded-md border border-emerald-600/30 bg-emerald-600/10 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-400">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          Empresa criada com sucesso.
        </div>

        {resultado.tipo === "senha" ? (
          <div className="space-y-2 rounded-lg border border-border bg-muted/40 p-4 text-sm">
            <p className="font-medium">O admin já pode entrar.</p>
            <p className="text-muted-foreground">
              Login em <code className="rounded bg-muted px-1">/login</code> com o e-mail{" "}
              <strong>{resultado.adminEmail}</strong>, a senha definida e a empresa{" "}
              <code className="rounded bg-muted px-1">{resultado.slug}</code>.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Link de convite (definir senha)</Label>
              <div className="flex gap-2">
                <Input readOnly value={resultado.url} className="font-mono text-xs" />
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => copiar(resultado.url, "link")}
                  className="shrink-0"
                >
                  {copiado === "link" ? (
                    <Check className="h-4 w-4" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Envie este link para o admin. Ao abrir, ele define a senha e já acessa.
                Expira em 7 dias.
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="secondary"
                onClick={() => copiar(mensagemWhatsApp(resultado), "whatsapp")}
              >
                {copiado === "whatsapp" ? (
                  <Check className="mr-2 h-4 w-4" />
                ) : (
                  <MessageCircle className="mr-2 h-4 w-4" />
                )}
                Copiar mensagem WhatsApp
              </Button>
              <Button type="button" variant="ghost" asChild>
                <a
                  href={`https://wa.me/?text=${encodeURIComponent(mensagemWhatsApp(resultado))}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <MessageCircle className="mr-2 h-4 w-4" />
                  Abrir no WhatsApp
                </a>
              </Button>
            </div>
          </div>
        )}

        {erro && (
          <div role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {erro}
          </div>
        )}

        <Button
          type="button"
          variant="outline"
          className="w-full"
          onClick={() => {
            router.push("/plataforma");
            router.refresh();
          }}
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          Voltar para empresas
        </Button>
      </div>
    );
  }

  // ── Formulário ───────────────────────────────────────────────────────
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

        <div className="space-y-1.5">
          <Label htmlFor="adminSenha">Senha do admin (opcional)</Label>
          <div className="relative">
            <KeyRound className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="adminSenha"
              type="text"
              placeholder="mín. 8 caracteres"
              className="pl-9"
              value={adminSenha}
              onChange={(e) => setAdminSenha(e.target.value)}
              minLength={8}
              disabled={loading}
              autoComplete="off"
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Preencha para o admin entrar <strong>direto</strong> com essa senha.
            Deixe em branco para gerar um <strong>link de convite</strong> (copiar /
            WhatsApp) e o admin define a própria senha.
          </p>
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
            Criando…
          </>
        ) : (
          "Criar empresa"
        )}
      </Button>
    </form>
  );
}
