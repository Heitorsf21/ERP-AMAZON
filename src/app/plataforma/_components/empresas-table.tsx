"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Loader2,
  MailPlus,
  Power,
  PowerOff,
  Store,
  Users,
  Copy,
  Check,
  MessageCircle,
  X,
  Trash2,
  AlertTriangle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export type EmpresaRow = {
  id: string;
  nome: string;
  slug: string;
  ativa: boolean;
  createdAt: string | Date;
  _count: { usuarios: number; amazonAccounts: number };
};

type Feedback = { tipo: "ok" | "erro"; texto: string } | null;
type Convite = { url: string; empresaNome: string; adminEmail: string; slug: string };

function mensagemWhatsApp(c: Convite): string {
  return (
    `Olá! Você foi cadastrado(a) como administrador da empresa *${c.empresaNome}* no Atlas Seller.\n\n` +
    `Para acessar, defina sua senha neste link:\n${c.url}\n\n` +
    `Seu login depois: e-mail ${c.adminEmail} (empresa: ${c.slug}). O link expira em 7 dias.`
  );
}

export function EmpresasTable({ empresas }: { empresas: EmpresaRow[] }) {
  const router = useRouter();
  const [pendente, setPendente] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [convite, setConvite] = useState<Convite | null>(null);
  const [copiado, setCopiado] = useState<"link" | "whatsapp" | null>(null);
  const [confirmExcluir, setConfirmExcluir] = useState<{ id: string; nome: string } | null>(null);

  async function acao(id: string, rota: string, ok: string) {
    setPendente(`${id}:${rota}`);
    setFeedback(null);
    try {
      const res = await fetch(`/api/plataforma/empresas/${id}/${rota}`, { method: "POST" });
      if (!res.ok) throw new Error();
      setFeedback({ tipo: "ok", texto: ok });
      router.refresh();
    } catch {
      setFeedback({ tipo: "erro", texto: "Não foi possível concluir a ação." });
    } finally {
      setPendente(null);
    }
  }

  async function excluir(id: string) {
    setPendente(`${id}:excluir`);
    setFeedback(null);
    try {
      const res = await fetch(`/api/plataforma/empresas/${id}/excluir`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(String(data?.erro ?? ""));
      setConfirmExcluir(null);
      setFeedback({
        tipo: "ok",
        texto: `Empresa excluída definitivamente (${data.total ?? 0} registro(s) removido(s)).`,
      });
      router.refresh();
    } catch (e) {
      const msg = (e as Error).message;
      setFeedback({
        tipo: "erro",
        texto: msg.startsWith("EMPRESA_ATIVA")
          ? "Desative a empresa antes de excluir."
          : "Não foi possível excluir a empresa.",
      });
    } finally {
      setPendente(null);
    }
  }

  async function reenviar(id: string) {
    setPendente(`${id}:reenviar-convite`);
    setFeedback(null);
    setConvite(null);
    try {
      const res = await fetch(`/api/plataforma/empresas/${id}/reenviar-convite`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.conviteUrl) throw new Error();
      setConvite({
        url: data.conviteUrl,
        empresaNome: data.empresaNome ?? "",
        adminEmail: data.admin?.email ?? "",
        slug: data.slug ?? "",
      });
    } catch {
      setFeedback({ tipo: "erro", texto: "Não foi possível gerar o convite." });
    } finally {
      setPendente(null);
    }
  }

  async function copiar(texto: string, qual: "link" | "whatsapp") {
    try {
      await navigator.clipboard.writeText(texto);
      setCopiado(qual);
      setTimeout(() => setCopiado(null), 1800);
    } catch {
      setFeedback({ tipo: "erro", texto: "Não foi possível copiar — copie manualmente." });
    }
  }

  return (
    <div className="space-y-3">
      {feedback && (
        <div
          role="status"
          className={
            feedback.tipo === "ok"
              ? "rounded-md border border-emerald-600/30 bg-emerald-600/10 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-400"
              : "rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          }
        >
          {feedback.texto}
        </div>
      )}

      {convite && (
        <div className="space-y-3 rounded-lg border border-primary/30 bg-primary/5 p-4">
          <div className="flex items-start justify-between gap-3">
            <p className="text-sm font-medium">
              Link de convite gerado{convite.empresaNome ? ` — ${convite.empresaNome}` : ""}
            </p>
            <button
              type="button"
              onClick={() => setConvite(null)}
              className="text-muted-foreground transition-colors hover:text-foreground"
              aria-label="Fechar"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Link (definir senha)</Label>
            <div className="flex gap-2">
              <Input readOnly value={convite.url} className="font-mono text-xs" />
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="shrink-0"
                onClick={() => copiar(convite.url, "link")}
              >
                {copiado === "link" ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              </Button>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => copiar(mensagemWhatsApp(convite), "whatsapp")}
            >
              {copiado === "whatsapp" ? (
                <Check className="mr-2 h-4 w-4" />
              ) : (
                <MessageCircle className="mr-2 h-4 w-4" />
              )}
              Copiar mensagem WhatsApp
            </Button>
            <Button type="button" variant="ghost" size="sm" asChild>
              <a
                href={`https://wa.me/?text=${encodeURIComponent(mensagemWhatsApp(convite))}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                <MessageCircle className="mr-2 h-4 w-4" />
                Abrir no WhatsApp
              </a>
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Envie este link para o admin. Ao abrir, ele define a senha e já acessa. Expira em 7 dias.
          </p>
        </div>
      )}

      {confirmExcluir && (
        <div className="space-y-3 rounded-lg border border-destructive/40 bg-destructive/5 p-4">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
            <div className="space-y-1">
              <p className="text-sm font-medium text-destructive">
                Excluir definitivamente “{confirmExcluir.nome}”?
              </p>
              <p className="text-xs text-muted-foreground">
                Ação <strong>IRREVERSÍVEL</strong>: remove a empresa e TODOS os seus dados
                (vendas, produtos, financeiro, usuários e integrações). Não há como desfazer.
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="destructive"
              size="sm"
              disabled={pendente === `${confirmExcluir.id}:excluir`}
              onClick={() => excluir(confirmExcluir.id)}
            >
              {pendente === `${confirmExcluir.id}:excluir` ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Trash2 className="mr-1.5 h-3.5 w-3.5" />
              )}
              Excluir definitivamente
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setConfirmExcluir(null)}
            >
              Cancelar
            </Button>
          </div>
        </div>
      )}

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Empresa</TableHead>
            <TableHead>Slug</TableHead>
            <TableHead className="text-center">Usuários</TableHead>
            <TableHead className="text-center">Amazon</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Ações</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {empresas.map((e) => {
            const reenviando = pendente === `${e.id}:reenviar-convite`;
            const alternando =
              pendente === `${e.id}:desativar` || pendente === `${e.id}:reativar`;
            return (
              <TableRow key={e.id}>
                <TableCell className="font-medium">{e.nome}</TableCell>
                <TableCell>
                  <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{e.slug}</code>
                </TableCell>
                <TableCell className="text-center">
                  <span className="inline-flex items-center gap-1 text-muted-foreground">
                    <Users className="h-3.5 w-3.5" />
                    {e._count.usuarios}
                  </span>
                </TableCell>
                <TableCell className="text-center">
                  <span className="inline-flex items-center gap-1 text-muted-foreground">
                    <Store className="h-3.5 w-3.5" />
                    {e._count.amazonAccounts}
                  </span>
                </TableCell>
                <TableCell>
                  {e.ativa ? (
                    <Badge variant="success">Ativa</Badge>
                  ) : (
                    <Badge variant="secondary">Inativa</Badge>
                  )}
                </TableCell>
                <TableCell>
                  <div className="flex items-center justify-end gap-1.5">
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={reenviando}
                      onClick={() => reenviar(e.id)}
                    >
                      {reenviando ? (
                        <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <MailPlus className="mr-1.5 h-3.5 w-3.5" />
                      )}
                      Gerar convite
                    </Button>
                    {e.ativa ? (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={alternando}
                        onClick={() => acao(e.id, "desativar", "Empresa desativada.")}
                      >
                        {alternando ? (
                          <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <PowerOff className="mr-1.5 h-3.5 w-3.5" />
                        )}
                        Desativar
                      </Button>
                    ) : (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={alternando}
                        onClick={() => acao(e.id, "reativar", "Empresa reativada.")}
                      >
                        {alternando ? (
                          <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Power className="mr-1.5 h-3.5 w-3.5" />
                        )}
                        Reativar
                      </Button>
                    )}
                    {!e.ativa && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                        onClick={() => {
                          setFeedback(null);
                          setConvite(null);
                          setConfirmExcluir({ id: e.id, nome: e.nome });
                        }}
                      >
                        <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                        Excluir
                      </Button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
