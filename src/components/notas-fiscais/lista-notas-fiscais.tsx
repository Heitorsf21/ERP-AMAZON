"use client";

import * as React from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import {
  Download,
  Eye,
  FileText,
  Inbox,
  Link2,
  Loader2,
} from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatBRL } from "@/lib/money";
import { fetchJSON } from "@/lib/fetcher";
import {
  FiltrosNotasFiscaisToolbar,
  FILTROS_INICIAIS,
  type FiltrosNotasFiscais,
} from "./filtros-notas-fiscais";
import { ViewerDocumento } from "./viewer-documento";

export type DocumentoFinanceiro = {
  id: string;
  tipo: "BOLETO" | "NOTA_FISCAL" | "OUTRO" | string;
  nomeArquivo: string;
  mimeType: string;
  fornecedorNome: string | null;
  fornecedorDocumento: string | null;
  numeroDocumento: string | null;
  valor: number | null;
  vencimento: string | null;
  protegidoPorSenha: boolean;
  createdAt: string;
};

export type DossieFinanceiro = {
  id: string;
  fornecedorNome: string | null;
  fornecedorDocumento: string | null;
  descricao: string | null;
  valor: number | null;
  vencimento: string | null;
  numeroDocumento: string | null;
  status: string;
  contaPagarId: string | null;
  updatedAt: string;
  documentos: DocumentoFinanceiro[];
  contaPagar: {
    id: string;
    descricao: string;
    valor: number;
    vencimento: string;
    status: string;
    pagoEm: string | null;
  } | null;
};

function useDebounced<T>(value: T, delayMs = 300): T {
  const [v, setV] = React.useState(value);
  React.useEffect(() => {
    const t = setTimeout(() => setV(value), delayMs);
    return () => clearTimeout(t);
  }, [value, delayMs]);
  return v;
}

function buildQuery(filtros: FiltrosNotasFiscais) {
  const sp = new URLSearchParams();
  if (filtros.busca) sp.set("busca", filtros.busca);
  if (filtros.tipo) sp.set("tipo", filtros.tipo);
  if (filtros.status) sp.set("statusDossie", filtros.status);
  if (filtros.de) sp.set("de", filtros.de);
  if (filtros.ate) sp.set("ate", filtros.ate);
  const qs = sp.toString();
  return qs ? `?${qs}` : "";
}

export function ListaNotasFiscais() {
  const [filtros, setFiltros] = React.useState<FiltrosNotasFiscais>(
    FILTROS_INICIAIS,
  );
  const filtrosDebounced = useDebounced(filtros, 300);

  const [dossieAberto, setDossieAberto] = React.useState<DossieFinanceiro | null>(
    null,
  );

  const queryString = buildQuery(filtrosDebounced);
  const { data: dossies = [], isLoading, isFetching } = useQuery<
    DossieFinanceiro[]
  >({
    queryKey: ["documentos-financeiros", queryString],
    queryFn: () =>
      fetchJSON<DossieFinanceiro[]>(
        `/api/documentos-financeiros${queryString}`,
      ),
  });

  return (
    <div className="space-y-4">
      <FiltrosNotasFiscaisToolbar filtros={filtros} onChange={setFiltros} />

      <div className="rounded-lg border bg-background">
        {isLoading ? (
          <div className="flex items-center justify-center gap-2 p-10 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Carregando documentos...
          </div>
        ) : dossies.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[110px]">Tipo</TableHead>
                  <TableHead>Fornecedor</TableHead>
                  <TableHead className="w-[140px]">Nº Doc</TableHead>
                  <TableHead className="w-[120px] text-right">Valor</TableHead>
                  <TableHead className="w-[120px]">Vencimento</TableHead>
                  <TableHead className="w-[120px]">Status</TableHead>
                  <TableHead>Conta vinculada</TableHead>
                  <TableHead className="w-[160px] text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {dossies.map((dossie) => (
                  <LinhaDossie
                    key={dossie.id}
                    dossie={dossie}
                    onVer={() => setDossieAberto(dossie)}
                  />
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        {isFetching && !isLoading && (
          <div className="border-t p-2 text-center text-xs text-muted-foreground">
            atualizando...
          </div>
        )}
      </div>

      <ViewerDocumento
        dossie={dossieAberto}
        aberto={!!dossieAberto}
        onOpenChange={(v) => {
          if (!v) setDossieAberto(null);
        }}
      />
    </div>
  );
}

function LinhaDossie({
  dossie,
  onVer,
}: {
  dossie: DossieFinanceiro;
  onVer: () => void;
}) {
  const tipoPrincipal = inferirTipoPrincipal(dossie);
  const docPrincipal = dossie.documentos[0];
  const numero = dossie.numeroDocumento ?? docPrincipal?.numeroDocumento ?? null;
  const conta = dossie.contaPagar;
  const contaPaga = conta?.status === "PAGA";

  return (
    <TableRow
      className="cursor-pointer hover:bg-muted/50"
      onClick={onVer}
    >
      <TableCell>
        <Badge variant={badgeTipoVariant(tipoPrincipal)}>
          {labelTipo(tipoPrincipal)}
        </Badge>
      </TableCell>
      <TableCell>
        <div className="font-medium">
          {dossie.fornecedorNome ?? "Fornecedor não identificado"}
        </div>
        {dossie.fornecedorDocumento && (
          <div className="text-xs text-muted-foreground">
            {dossie.fornecedorDocumento}
          </div>
        )}
      </TableCell>
      <TableCell className="font-mono text-xs">{numero ?? "—"}</TableCell>
      <TableCell className="text-right font-mono">
        {typeof dossie.valor === "number" ? formatBRL(dossie.valor) : "—"}
      </TableCell>
      <TableCell>
        {dossie.vencimento ? formatarData(dossie.vencimento) : "—"}
      </TableCell>
      <TableCell>
        <Badge variant={dossie.contaPagarId ? "success" : "warning"}>
          {contaPaga
            ? "paga"
            : dossie.contaPagarId
              ? "vinculado"
              : "pendente"}
        </Badge>
      </TableCell>
      <TableCell className="max-w-[220px]">
        {conta ? (
          <Link
            href={"/contas-a-pagar"}
            onClick={(e) => e.stopPropagation()}
            className="inline-flex items-center gap-1 truncate text-sm text-primary hover:underline"
          >
            <Link2 className="h-3 w-3 shrink-0" />
            <span className="truncate">{conta.descricao}</span>
          </Link>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        )}
      </TableCell>
      <TableCell
        className="text-right"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-end gap-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onVer}
            title="Visualizar"
          >
            <Eye className="h-4 w-4" />
          </Button>
          {docPrincipal && (
            <Button
              asChild
              type="button"
              variant="ghost"
              size="sm"
              title="Baixar"
            >
              <a
                href={`/api/documentos-financeiros/${docPrincipal.id}/arquivo?download=1`}
              >
                <Download className="h-4 w-4" />
              </a>
            </Button>
          )}
        </div>
      </TableCell>
    </TableRow>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center gap-2 p-10 text-center text-sm text-muted-foreground">
      <Inbox className="h-8 w-8 opacity-60" />
      <div className="font-medium text-foreground">
        Nenhum documento encontrado
      </div>
      <div>
        Tente ajustar os filtros ou suba um novo boleto/NF pelo botão acima.
      </div>
    </div>
  );
}

function inferirTipoPrincipal(dossie: DossieFinanceiro): string {
  // Prioriza BOLETO > NOTA_FISCAL > OUTRO; se mistura, usa o do primeiro doc.
  const tipos = new Set(dossie.documentos.map((d) => d.tipo));
  if (tipos.has("BOLETO")) return "BOLETO";
  if (tipos.has("NOTA_FISCAL")) return "NOTA_FISCAL";
  return dossie.documentos[0]?.tipo ?? "OUTRO";
}

function labelTipo(tipo: string) {
  if (tipo === "BOLETO") return "Boleto";
  if (tipo === "NOTA_FISCAL") return "NF";
  return "Outro";
}

function badgeTipoVariant(tipo: string) {
  if (tipo === "BOLETO") return "warning" as const;
  if (tipo === "NOTA_FISCAL") return "default" as const;
  return "secondary" as const;
}

function formatarData(iso: string) {
  return new Date(iso).toLocaleDateString("pt-BR", {
    timeZone: "America/Sao_Paulo",
  });
}

// Re-export icon for any external consumer (não usado internamente, mas mantém parity).
export { FileText };
