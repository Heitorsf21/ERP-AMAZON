"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, MailPlus, Power, PowerOff, Store, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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

export function EmpresasTable({ empresas }: { empresas: EmpresaRow[] }) {
  const router = useRouter();
  const [pendente, setPendente] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);

  async function acao(id: string, rota: string, ok: string) {
    setPendente(`${id}:${rota}`);
    setFeedback(null);
    try {
      const res = await fetch(`/api/plataforma/empresas/${id}/${rota}`, {
        method: "POST",
      });
      if (!res.ok) throw new Error();
      setFeedback({ tipo: "ok", texto: ok });
      router.refresh();
    } catch {
      setFeedback({ tipo: "erro", texto: "Não foi possível concluir a ação." });
    } finally {
      setPendente(null);
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
                  <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
                    {e.slug}
                  </code>
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
                      onClick={() =>
                        acao(e.id, "reenviar-convite", "Convite reenviado.")
                      }
                    >
                      {reenviando ? (
                        <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <MailPlus className="mr-1.5 h-3.5 w-3.5" />
                      )}
                      Reenviar convite
                    </Button>
                    {e.ativa ? (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={alternando}
                        onClick={() =>
                          acao(e.id, "desativar", "Empresa desativada.")
                        }
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
                        onClick={() =>
                          acao(e.id, "reativar", "Empresa reativada.")
                        }
                      >
                        {alternando ? (
                          <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Power className="mr-1.5 h-3.5 w-3.5" />
                        )}
                        Reativar
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
