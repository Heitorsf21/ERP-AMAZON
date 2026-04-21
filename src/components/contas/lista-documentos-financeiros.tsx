"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { FileText, Link2, PlusCircle } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatBRL } from "@/lib/money";
import { fetchJSON } from "@/lib/fetcher";
import type { PrefillNovaConta } from "@/components/contas/dialog-nova-conta";

type DocumentoFinanceiro = {
  id: string;
  tipo: string;
  nomeArquivo: string;
  fornecedorNome: string | null;
  valor: number | null;
  vencimento: string | null;
  protegidoPorSenha: boolean;
  createdAt: string;
};

type DossieFinanceiro = {
  id: string;
  fornecedorNome: string | null;
  fornecedorDocumento: string | null;
  descricao: string | null;
  valor: number | null;
  vencimento: string | null;
  status: string;
  contaPagarId: string | null;
  documentos: DocumentoFinanceiro[];
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
    fornecedor: { id: string; nome: string; documento: string | null };
    categoria: { id: string; nome: string };
  } | null;
};

type FiltroDocumento = "PENDENTES" | "VINCULADOS";

export function ListaDocumentosFinanceiros({
  onCriarConta,
}: {
  onCriarConta: (prefill: PrefillNovaConta) => void;
}) {
  const { data: dossies = [], isLoading } = useQuery<DossieFinanceiro[]>({
    queryKey: ["documentos-financeiros"],
    queryFn: () => fetchJSON<DossieFinanceiro[]>("/api/documentos-financeiros"),
  });

  const pendentes = dossies.filter((d) => !d.contaPagarId);

  return (
    <Card>
      <CardHeader className="pb-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              Documentos recebidos
            </CardTitle>
            <CardDescription>
              Boletos e notas ficam agrupados antes ou depois da conta a pagar.
            </CardDescription>
          </div>
          <Badge variant={pendentes.length ? "warning" : "secondary"}>
            {pendentes.length} pendente{pendentes.length === 1 ? "" : "s"}
          </Badge>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading && (
          <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
            carregando documentos...
          </div>
        )}

        {!isLoading && dossies.length === 0 && (
          <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
            nenhum documento recebido ainda
          </div>
        )}

        <div className="grid gap-3 lg:grid-cols-2">
          {dossies.map((dossie) => (
            <div key={dossie.id} className="rounded-lg border bg-background p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 space-y-1">
                  <div className="truncate font-medium">
                    {dossie.fornecedorNome ?? "Fornecedor nao identificado"}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {dossie.descricao ?? "Documento recebido do fornecedor"}
                  </div>
                </div>
                <Badge variant={statusDocumentoVariant(dossie)}>
                  {statusDocumentoLabel(dossie)}
                </Badge>
              </div>

              <div className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
                <div>
                  <div className="text-xs text-muted-foreground">Valor</div>
                  <div className="font-mono font-semibold">
                    {typeof dossie.valor === "number"
                      ? formatBRL(dossie.valor)
                      : "nao identificado"}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Vencimento</div>
                  <div>{dossie.vencimento ? formatarData(dossie.vencimento) : "-"}</div>
                </div>
              </div>

              <div className="mt-3 flex flex-wrap gap-1.5">
                {dossie.documentos.map((doc) => (
                  <Badge key={doc.id} variant="outline">
                    {doc.tipo.toLowerCase()} - {doc.nomeArquivo}
                  </Badge>
                ))}
              </div>

              <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                {dossie.contaPagar ? (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Link2 className="h-3.5 w-3.5" />
                    {dossie.contaPagar.status === "PAGA" ? "Conta paga" : "Conta"}:{" "}
                    {dossie.contaPagar.descricao}
                    {dossie.contaPagar.status === "PAGA" && dossie.contaPagar.pagoEm
                      ? ` em ${formatarData(dossie.contaPagar.pagoEm)}`
                      : ""}
                    {dossie.contaPagar.status === "PAGA" &&
                    dossie.contaPagar.movimentacao
                      ? ` (${formatBRL(dossie.contaPagar.movimentacao.valor)})`
                      : ""}
                  </div>
                ) : (
                  <div className="text-xs text-muted-foreground">
                    Revise e crie a conta quando confirmar a compra.
                  </div>
                )}

                {!dossie.contaPagarId && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => onCriarConta(prefillDoDossie(dossie))}
                  >
                    <PlusCircle className="mr-2 h-4 w-4" />
                    Criar conta
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

export function BotaoDocumentosFinanceiros({
  onCriarConta,
}: {
  onCriarConta: (prefill: PrefillNovaConta) => void;
}) {
  const [aberto, setAberto] = React.useState(false);
  const [filtro, setFiltro] = React.useState<FiltroDocumento>("PENDENTES");
  const { data: dossies = [], isLoading } = useQuery<DossieFinanceiro[]>({
    queryKey: ["documentos-financeiros"],
    queryFn: () => fetchJSON<DossieFinanceiro[]>("/api/documentos-financeiros"),
  });

  const pendentes = dossies.filter((d) => !d.contaPagarId);
  const vinculados = dossies.filter((d) => !!d.contaPagarId);
  const lista = filtro === "PENDENTES" ? pendentes : vinculados;

  return (
    <>
      <Button
        type="button"
        variant="outline"
        onClick={() => {
          setFiltro(pendentes.length > 0 ? "PENDENTES" : "VINCULADOS");
          setAberto(true);
        }}
      >
        <FileText className="mr-2 h-4 w-4" />
        Documentos
        {pendentes.length > 0 && (
          <span className="ml-2 rounded-full bg-amber-500 px-2 py-0.5 text-[11px] font-semibold text-white">
            {pendentes.length}
          </span>
        )}
      </Button>

      <Dialog open={aberto} onOpenChange={setAberto}>
        <DialogContent className="sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              Documentos recebidos
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="flex flex-col gap-3 rounded-lg border bg-muted/30 p-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="text-sm text-muted-foreground">
                Consulte documentos pendentes de vínculo e documentos já anexados
                a uma conta.
              </div>
              <div className="flex w-fit gap-1 rounded-lg border bg-background p-1">
                <button
                  type="button"
                  onClick={() => setFiltro("PENDENTES")}
                  className={cn(
                    "rounded-md px-3 py-1.5 text-sm font-medium transition",
                    filtro === "PENDENTES"
                      ? "bg-muted text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  Pendentes ({pendentes.length})
                </button>
                <button
                  type="button"
                  onClick={() => setFiltro("VINCULADOS")}
                  className={cn(
                    "rounded-md px-3 py-1.5 text-sm font-medium transition",
                    filtro === "VINCULADOS"
                      ? "bg-muted text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  Vinculados ({vinculados.length})
                </button>
              </div>
            </div>

            {isLoading && (
              <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
                carregando documentos...
              </div>
            )}

            {!isLoading && lista.length === 0 && (
              <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
                nenhum documento {filtro === "PENDENTES" ? "pendente" : "vinculado"}
              </div>
            )}

            <div className="grid max-h-[58vh] gap-3 overflow-auto pr-1">
              {lista.map((dossie) => (
                <DocumentoFinanceiroItem
                  key={dossie.id}
                  dossie={dossie}
                  onCriarConta={() => {
                    setAberto(false);
                    onCriarConta(prefillDoDossie(dossie));
                  }}
                />
              ))}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function DocumentoFinanceiroItem({
  dossie,
  onCriarConta,
}: {
  dossie: DossieFinanceiro;
  onCriarConta: () => void;
}) {
  return (
    <div className="rounded-lg border bg-background p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">
              {dossie.fornecedorNome ?? "Fornecedor nao identificado"}
            </span>
            <Badge variant={statusDocumentoVariant(dossie)}>
              {statusDocumentoLabel(dossie)}
            </Badge>
          </div>
          <div className="text-xs text-muted-foreground">
            {dossie.descricao ?? "Documento recebido do fornecedor"}
          </div>
        </div>

        <div className="text-left sm:text-right">
          <div className="font-mono text-sm font-semibold">
            {typeof dossie.valor === "number"
              ? formatBRL(dossie.valor)
              : "valor nao identificado"}
          </div>
          <div className="text-xs text-muted-foreground">
            {dossie.contaPagar?.status === "PAGA"
              ? dossie.contaPagar.pagoEm
                ? `paga em ${formatarData(dossie.contaPagar.pagoEm)}`
                : "conta ja paga"
              : dossie.vencimento
                ? `vence em ${formatarData(dossie.vencimento)}`
                : "sem vencimento"}
          </div>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {dossie.documentos.map((doc) => (
          <Badge key={doc.id} variant="outline">
            {doc.tipo.toLowerCase()} - {doc.nomeArquivo}
          </Badge>
        ))}
      </div>

      <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        {dossie.contaPagar ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Link2 className="h-3.5 w-3.5" />
            {dossie.contaPagar.status === "PAGA" ? "Conta paga" : "Conta"}:{" "}
            {dossie.contaPagar.descricao}
            {dossie.contaPagar.status === "PAGA" && dossie.contaPagar.pagoEm
              ? ` em ${formatarData(dossie.contaPagar.pagoEm)}`
              : ""}
            {dossie.contaPagar.status === "PAGA" &&
            dossie.contaPagar.movimentacao
              ? ` (${formatBRL(dossie.contaPagar.movimentacao.valor)})`
              : ""}
          </div>
        ) : (
          <div className="text-xs text-muted-foreground">
            Ainda precisa virar uma conta a pagar.
          </div>
        )}

        {!dossie.contaPagarId && (
          <Button type="button" size="sm" variant="outline" onClick={onCriarConta}>
            <PlusCircle className="mr-2 h-4 w-4" />
            Criar conta
          </Button>
        )}
      </div>
    </div>
  );
}

function statusDocumentoLabel(dossie: DossieFinanceiro) {
  if (dossie.contaPagar?.status === "PAGA") return "ja paga";
  return dossie.contaPagarId ? "vinculado" : "pendente";
}

function statusDocumentoVariant(dossie: DossieFinanceiro) {
  return dossie.contaPagarId ? "success" : "warning";
}

function prefillDoDossie(dossie: DossieFinanceiro): PrefillNovaConta {
  const docBase = dossie.documentos[0];
  return {
    dossieId: dossie.id,
    fornecedorNome: dossie.fornecedorNome ?? docBase?.fornecedorNome ?? "",
    fornecedorDocumento: dossie.fornecedorDocumento ?? "",
    descricao: dossie.descricao ?? "Documento fornecedor",
    valorCentavos: dossie.valor ?? docBase?.valor ?? undefined,
    vencimento: normalizarDateInput(dossie.vencimento ?? docBase?.vencimento),
  };
}

function normalizarDateInput(iso?: string | null) {
  if (!iso) return undefined;
  return new Date(iso).toISOString().slice(0, 10);
}

function formatarData(iso: string) {
  return new Date(iso).toLocaleDateString("pt-BR", {
    timeZone: "America/Sao_Paulo",
  });
}
