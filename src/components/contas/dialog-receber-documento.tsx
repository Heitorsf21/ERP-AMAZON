"use client";

import * as React from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { FileUp, Loader2, LockKeyhole, Sparkles } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatBRL } from "@/lib/money";

type DocumentoProcessado = {
  id: string;
  tipo: string;
  nomeArquivo: string;
  protegidoPorSenha: boolean;
};

type DossieProcessado = {
  id: string;
  fornecedorNome: string | null;
  fornecedorDocumento: string | null;
  descricao: string | null;
  valor: number | null;
  vencimento: string | null;
  status: string;
  contaPagarId: string | null;
  documentos: DocumentoProcessado[];
  contaPagar: {
    id: string;
    descricao: string;
    valor: number;
    vencimento: string;
    status: string;
    pagoEm: string | null;
    movimentacao: {
      id: string;
      valor: number;
      dataCaixa: string;
      descricao: string;
      origem: string;
    } | null;
  } | null;
};

type ResultadoUpload = {
  acao: string;
  duplicado: boolean;
  documento: DocumentoProcessado;
  dossie: DossieProcessado;
  match?: { score: number; motivos: string[] } | null;
};

const acaoLabel: Record<string, string> = {
  NOVO_DOSSIE: "Novo dossie criado",
  ANEXADO_A_DOSSIE: "Documento anexado ao dossie existente",
  ANEXADO_A_CONTA: "Documento anexado a uma conta existente",
  ANEXADO_A_CONTA_PAGA: "Documento reconhecido como conta ja paga",
  DUPLICADO: "Documento ja recebido",
};

export function DialogReceberDocumento({
  aberto,
  onOpenChange,
}: {
  aberto: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const qc = useQueryClient();
  const [arquivo, setArquivo] = React.useState<File | null>(null);
  const [senhaPdf, setSenhaPdf] = React.useState("");
  const [erro, setErro] = React.useState<string | null>(null);
  const [resultado, setResultado] = React.useState<ResultadoUpload | null>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);

  const upload = useMutation({
    mutationFn: async () => {
      if (!arquivo) throw new Error("selecione um arquivo");

      const fd = new FormData();
      fd.append("arquivo", arquivo);
      if (senhaPdf.trim()) fd.append("senhaPdf", senhaPdf.trim());

      const resp = await fetch("/api/documentos-financeiros", {
        method: "POST",
        body: fd,
      });
      const body = await resp.json();
      if (!resp.ok) {
        throw new Error(body?.error ?? "falha ao processar documento");
      }
      return body as ResultadoUpload;
    },
    onSuccess: (dados) => {
      setResultado(dados);
      setErro(null);
      qc.invalidateQueries({ queryKey: ["documentos-financeiros"] });
      qc.invalidateQueries({ queryKey: ["contas"] });
    },
    onError: (e) => {
      setResultado(null);
      setErro(e instanceof Error ? e.message : "falha ao processar documento");
    },
  });

  function resetar() {
    setArquivo(null);
    setSenhaPdf("");
    setErro(null);
    setResultado(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  function fechar(v: boolean) {
    if (!v) resetar();
    onOpenChange(v);
  }

  return (
    <Dialog open={aberto} onOpenChange={fechar}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileUp className="h-5 w-5" />
            Receber documento do fornecedor
          </DialogTitle>
        </DialogHeader>

        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            upload.mutate();
          }}
        >
          <div className="rounded-md border bg-muted/30 p-3 text-sm text-muted-foreground">
            Envie boleto, nota fiscal ou imagem. A IA extrai os dados e o ERP
            procura automaticamente outro documento ou conta compativel para evitar
            duplicidade.
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="documento-financeiro">Arquivo</Label>
            <Input
              ref={inputRef}
              id="documento-financeiro"
              type="file"
              accept=".pdf,.jpg,.jpeg,.png,.webp"
              onChange={(e) => {
                setResultado(null);
                setErro(null);
                setArquivo(e.target.files?.[0] ?? null);
              }}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="senha-pdf" className="flex items-center gap-1.5">
              <LockKeyhole className="h-3.5 w-3.5" />
              Senha do PDF
              <span className="text-xs font-normal text-muted-foreground">
                opcional
              </span>
            </Label>
            <Input
              id="senha-pdf"
              value={senhaPdf}
              onChange={(e) => setSenhaPdf(e.target.value)}
              placeholder="ex: 10338212"
              autoComplete="off"
            />
          </div>

          {erro && (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
              {erro}
            </div>
          )}

          {resultado && <ResultadoUploadCard resultado={resultado} />}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => fechar(false)}>
              Fechar
            </Button>
            <Button type="submit" disabled={upload.isPending || !arquivo}>
              {upload.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Analisando...
                </>
              ) : (
                <>
                  <Sparkles className="mr-2 h-4 w-4" />
                  Processar documento
                </>
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ResultadoUploadCard({ resultado }: { resultado: ResultadoUpload }) {
  const dossie = resultado.dossie;
  const contaJaPaga = dossie.contaPagar?.status === "PAGA";
  return (
    <div className="rounded-md border border-emerald-600/30 bg-emerald-600/10 p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium text-emerald-800">
          {acaoLabel[resultado.acao] ?? resultado.acao}
        </span>
        <Badge variant={dossie.contaPagarId ? "success" : "warning"}>
          {contaJaPaga ? "ja paga" : dossie.contaPagarId ? "vinculado" : "pendente"}
        </Badge>
        {resultado.match && (
          <Badge variant="outline">{Math.round(resultado.match.score)} pts</Badge>
        )}
      </div>

      <div className="mt-2 space-y-1 text-emerald-900/85">
        <div>{dossie.fornecedorNome ?? "Fornecedor nao identificado"}</div>
        <div className="font-mono text-base font-semibold">
          {typeof dossie.valor === "number" ? formatBRL(dossie.valor) : "Valor nao identificado"}
        </div>
        {dossie.vencimento && (
          <div className="text-xs">Vence em {formatarData(dossie.vencimento)}</div>
        )}
        {contaJaPaga && (
          <div className="rounded-md border border-emerald-700/20 bg-white/50 p-2 text-xs">
            Esta nota parece pertencer a uma conta que ja estava paga
            {dossie.contaPagar?.pagoEm
              ? ` em ${formatarData(dossie.contaPagar.pagoEm)}`
              : ""}
            . Nao foi criada uma nova conta em aberto.
            {dossie.contaPagar?.movimentacao ? (
              <div className="mt-1 font-mono">
                Pagamento no caixa:{" "}
                {formatBRL(dossie.contaPagar.movimentacao.valor)}
              </div>
            ) : null}
          </div>
        )}
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {dossie.documentos.map((doc) => (
          <Badge key={doc.id} variant="secondary">
            {doc.tipo.toLowerCase()} - {doc.nomeArquivo}
          </Badge>
        ))}
      </div>

      {resultado.match?.motivos?.length ? (
        <div className="mt-2 text-xs text-emerald-900/75">
          Match: {resultado.match.motivos.join(", ")}
        </div>
      ) : null}
    </div>
  );
}

function formatarData(iso: string) {
  return new Date(iso).toLocaleDateString("pt-BR", {
    timeZone: "America/Sao_Paulo",
  });
}
