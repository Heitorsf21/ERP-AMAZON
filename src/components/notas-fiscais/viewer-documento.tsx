"use client";

import * as React from "react";
import Link from "next/link";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Download,
  ExternalLink,
  FileText,
  Image as ImageIcon,
  Link2,
  Loader2,
} from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatBRL } from "@/lib/money";
import { fetchJSON } from "@/lib/fetcher";
import type { DossieFinanceiro, DocumentoFinanceiro } from "./lista-notas-fiscais";

export function ViewerDocumento({
  dossie,
  aberto,
  onOpenChange,
}: {
  dossie: DossieFinanceiro | null;
  aberto: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const [docAtivoId, setDocAtivoId] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (dossie && dossie.documentos.length > 0) {
      setDocAtivoId(dossie.documentos[0]!.id);
    } else {
      setDocAtivoId(null);
    }
  }, [dossie]);

  if (!dossie) return null;

  const docAtivo =
    dossie.documentos.find((d) => d.id === docAtivoId) ??
    dossie.documentos[0] ??
    null;

  return (
    <Sheet open={aberto} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full overflow-y-auto sm:max-w-3xl"
      >
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            {dossie.fornecedorNome ?? "Fornecedor não identificado"}
          </SheetTitle>
          <SheetDescription>
            {dossie.descricao ?? "Dossiê de documentos do fornecedor."}
          </SheetDescription>
        </SheetHeader>

        <div className="mt-4 space-y-5">
          <MetadadosDossie dossie={dossie} />

          {dossie.documentos.length > 1 && (
            <SeletorDocumentos
              documentos={dossie.documentos}
              ativoId={docAtivo?.id ?? null}
              onSelect={setDocAtivoId}
            />
          )}

          {docAtivo && <ViewerArquivo documento={docAtivo} />}

          <VincularContaForm dossie={dossie} />
        </div>
      </SheetContent>
    </Sheet>
  );
}

function MetadadosDossie({ dossie }: { dossie: DossieFinanceiro }) {
  const conta = dossie.contaPagar;
  const contaPaga = conta?.status === "PAGA";

  return (
    <div className="rounded-lg border bg-muted/20 p-4 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={dossie.contaPagarId ? "success" : "warning"}>
          {contaPaga
            ? "já paga"
            : dossie.contaPagarId
              ? "vinculado"
              : "pendente"}
        </Badge>
        {dossie.numeroDocumento && (
          <Badge variant="outline">nº {dossie.numeroDocumento}</Badge>
        )}
      </div>

      <dl className="mt-3 grid gap-3 sm:grid-cols-2">
        <Item label="Fornecedor" value={dossie.fornecedorNome ?? "—"} />
        <Item label="CNPJ/CPF" value={dossie.fornecedorDocumento ?? "—"} />
        <Item
          label="Valor"
          value={
            typeof dossie.valor === "number"
              ? formatBRL(dossie.valor)
              : "não identificado"
          }
        />
        <Item
          label="Vencimento"
          value={dossie.vencimento ? formatarData(dossie.vencimento) : "—"}
        />
        {conta && (
          <Item
            label="Conta vinculada"
            value={
              <Link
                href={"/contas-a-pagar"}
                className="inline-flex items-center gap-1 text-primary hover:underline"
              >
                {conta.descricao}
                <ExternalLink className="h-3 w-3" />
              </Link>
            }
          />
        )}
        {contaPaga && conta?.pagoEm && (
          <Item label="Paga em" value={formatarData(conta.pagoEm)} />
        )}
      </dl>
    </div>
  );
}

function Item({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd className="mt-0.5 break-words">{value}</dd>
    </div>
  );
}

function SeletorDocumentos({
  documentos,
  ativoId,
  onSelect,
}: {
  documentos: DocumentoFinanceiro[];
  ativoId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {documentos.map((doc) => {
        const ativo = doc.id === ativoId;
        const Icon = doc.mimeType?.startsWith("image/") ? ImageIcon : FileText;
        return (
          <button
            key={doc.id}
            type="button"
            onClick={() => onSelect(doc.id)}
            className={
              "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition " +
              (ativo
                ? "border-primary bg-primary/10 text-foreground"
                : "border-input bg-background text-muted-foreground hover:bg-muted")
            }
          >
            <Icon className="h-3.5 w-3.5" />
            <span className="max-w-[180px] truncate">{doc.nomeArquivo}</span>
          </button>
        );
      })}
    </div>
  );
}

function ViewerArquivo({ documento }: { documento: DocumentoFinanceiro }) {
  const isImagem = documento.mimeType?.startsWith("image/");
  const isPdf = documento.mimeType === "application/pdf";
  const srcInline = `/api/documentos-financeiros/${documento.id}/arquivo`;
  const srcDownload = `${srcInline}?download=1`;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm">
          <Badge variant="outline">{documento.tipo}</Badge>
          <span className="truncate font-medium">{documento.nomeArquivo}</span>
        </div>
        <div className="flex items-center gap-2">
          <Button asChild size="sm" variant="outline">
            <a href={srcInline} target="_blank" rel="noreferrer">
              <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
              Abrir
            </a>
          </Button>
          <Button asChild size="sm">
            <a href={srcDownload}>
              <Download className="mr-1.5 h-3.5 w-3.5" />
              Baixar
            </a>
          </Button>
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border bg-muted/20">
        {isImagem && (
          // Arquivo interno servido por endpoint autenticado, sem dimensões
          // conhecidas em build — `next/image` não cabe aqui.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={srcInline}
            alt={documento.nomeArquivo}
            className="mx-auto max-h-[600px] w-auto"
          />
        )}
        {isPdf && (
          <iframe
            src={srcInline}
            title={documento.nomeArquivo}
            className="h-[600px] w-full"
          />
        )}
        {!isImagem && !isPdf && (
          <div className="p-6 text-center text-sm text-muted-foreground">
            Pré-visualização não disponível para este tipo de arquivo.
            <br />
            Use o botão Baixar para visualizar.
          </div>
        )}
      </div>
    </div>
  );
}

function VincularContaForm({ dossie }: { dossie: DossieFinanceiro }) {
  const qc = useQueryClient();
  const [contaId, setContaId] = React.useState("");
  const [erro, setErro] = React.useState<string | null>(null);

  const mut = useMutation({
    mutationFn: async () => {
      if (!contaId.trim()) throw new Error("informe o id da conta");
      return fetchJSON(
        `/api/documentos-financeiros/${dossie.id}/vincular-conta`,
        {
          method: "POST",
          body: JSON.stringify({ contaId: contaId.trim() }),
        },
      );
    },
    onSuccess: () => {
      setErro(null);
      setContaId("");
      qc.invalidateQueries({ queryKey: ["documentos-financeiros"] });
      qc.invalidateQueries({ queryKey: ["contas"] });
    },
    onError: (e) => {
      setErro(e instanceof Error ? e.message : "falha ao vincular");
    },
  });

  if (dossie.contaPagarId) {
    return (
      <div className="flex items-center gap-2 rounded-md border bg-muted/20 p-3 text-sm text-muted-foreground">
        <Link2 className="h-4 w-4" />
        Este dossiê já está vinculado a uma conta a pagar.
      </div>
    );
  }

  return (
    <form
      className="space-y-2 rounded-md border p-3"
      onSubmit={(e) => {
        e.preventDefault();
        mut.mutate();
      }}
    >
      <Label htmlFor={`vincular-${dossie.id}`} className="text-sm">
        Vincular a uma conta a pagar existente
      </Label>
      <div className="flex gap-2">
        <Input
          id={`vincular-${dossie.id}`}
          placeholder="ID da conta"
          value={contaId}
          onChange={(e) => setContaId(e.target.value)}
        />
        <Button type="submit" size="sm" disabled={mut.isPending || !contaId}>
          {mut.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <>
              <Link2 className="mr-1.5 h-3.5 w-3.5" />
              Vincular
            </>
          )}
        </Button>
      </div>
      {erro && <div className="text-xs text-destructive">{erro}</div>}
      <p className="text-xs text-muted-foreground">
        Para criar uma nova conta a partir deste dossiê, vá em Contas a Pagar e
        use o botão &quot;Documentos&quot;.
      </p>
    </form>
  );
}

function formatarData(iso: string) {
  return new Date(iso).toLocaleDateString("pt-BR", {
    timeZone: "America/Sao_Paulo",
  });
}
