"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { Calendar, Trash2, History } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { fetchJSON } from "@/lib/fetcher";
import { formatBRL } from "@/lib/money";
import { cn } from "@/lib/utils";

type Vigencia = {
  id: string;
  produtoId: string;
  custoCentavos: number;
  vigenciaInicio: string;
  vigenciaFim: string | null;
  origem: string;
  observacao: string | null;
  criadoEm: string;
};

type Resp = {
  produto: {
    id: string;
    sku: string;
    nome: string;
    custoUnitarioAtual: number | null;
  };
  vigencias: Vigencia[];
};

type Modo = "A_PARTIR_DE_HOJE" | "PERIODO" | "HISTORICO_COMPLETO";

type Props = {
  produtoId: string | null;
  aberto: boolean;
  onOpenChange: (open: boolean) => void;
};

export function DialogCustoHistorico({ produtoId, aberto, onOpenChange }: Props) {
  const qc = useQueryClient();
  const [modo, setModo] = React.useState<Modo>("A_PARTIR_DE_HOJE");
  const [valor, setValor] = React.useState("");
  const [de, setDe] = React.useState(format(new Date(), "yyyy-MM-dd"));
  const [ate, setAte] = React.useState(format(new Date(), "yyyy-MM-dd"));
  const [observacao, setObservacao] = React.useState("");

  React.useEffect(() => {
    if (aberto) {
      setModo("A_PARTIR_DE_HOJE");
      setValor("");
      setObservacao("");
    }
  }, [aberto]);

  const { data, isLoading } = useQuery<Resp>({
    queryKey: ["custo-historico", produtoId],
    queryFn: () => fetchJSON<Resp>(`/api/produtos/${produtoId}/custo-historico`),
    enabled: !!produtoId && aberto,
  });

  const aplicar = useMutation({
    mutationFn: async () => {
      const custoCentavos = Math.round(Number(valor.replace(",", ".")) * 100);
      if (!Number.isFinite(custoCentavos) || custoCentavos <= 0) {
        throw new Error("informe um custo válido em reais");
      }
      const body: Record<string, unknown> = {
        modo,
        custoCentavos,
        observacao: observacao.trim() || undefined,
      };
      if (modo === "PERIODO") {
        body.de = de;
        body.ate = ate;
      }
      return fetchJSON(`/api/produtos/${produtoId}/custo-historico`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    },
    onSuccess: (r: unknown) => {
      const resp = r as { vendasAtualizadas: number };
      toast.success(
        `Vigência aplicada. ${resp.vendasAtualizadas} venda(s) atualizada(s).`,
      );
      qc.invalidateQueries({ queryKey: ["custo-historico", produtoId] });
      qc.invalidateQueries({ queryKey: ["produtos"] });
      setValor("");
      setObservacao("");
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "Erro ao aplicar");
    },
  });

  const remover = useMutation({
    mutationFn: async (vigenciaId: string) => {
      return fetchJSON(`/api/produtos/${produtoId}/custo-historico`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vigenciaId }),
      });
    },
    onSuccess: () => {
      toast.success("Vigência removida.");
      qc.invalidateQueries({ queryKey: ["custo-historico", produtoId] });
      qc.invalidateQueries({ queryKey: ["produtos"] });
    },
  });

  return (
    <Dialog open={aberto} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <History className="h-5 w-5" />
            Histórico de custo
          </DialogTitle>
          <DialogDescription>
            {data?.produto.nome ? (
              <>
                <span className="font-medium">{data.produto.nome}</span>{" "}
                <span className="font-mono text-xs">({data.produto.sku})</span>
              </>
            ) : (
              "Carregando..."
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          <div className="rounded-lg border p-4">
            <h3 className="mb-3 text-sm font-semibold">Adicionar nova vigência</h3>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="modo" className="text-xs">Modo</Label>
                <Select
                  id="modo"
                  value={modo}
                  onChange={(e) => setModo(e.target.value as Modo)}
                  className="h-9"
                >
                  <option value="A_PARTIR_DE_HOJE">A partir de hoje</option>
                  <option value="PERIODO">Período específico</option>
                  <option value="HISTORICO_COMPLETO">Todo histórico</option>
                </Select>
              </div>

              <div className="space-y-1">
                <Label htmlFor="valor" className="text-xs">Custo unitário (R$)</Label>
                <Input
                  id="valor"
                  type="text"
                  inputMode="decimal"
                  placeholder="ex: 12,50"
                  value={valor}
                  onChange={(e) => setValor(e.target.value)}
                  className="h-9"
                />
              </div>

              {modo === "PERIODO" && (
                <>
                  <div className="space-y-1">
                    <Label htmlFor="de" className="text-xs">De</Label>
                    <Input
                      id="de"
                      type="date"
                      value={de}
                      onChange={(e) => setDe(e.target.value)}
                      className="h-9"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="ate" className="text-xs">Até</Label>
                    <Input
                      id="ate"
                      type="date"
                      value={ate}
                      onChange={(e) => setAte(e.target.value)}
                      className="h-9"
                    />
                  </div>
                </>
              )}

              <div className={cn("space-y-1", modo === "PERIODO" ? "sm:col-span-2" : "")}>
                <Label htmlFor="obs" className="text-xs">Observação (opcional)</Label>
                <Input
                  id="obs"
                  type="text"
                  placeholder="ex: aumento de fornecedor"
                  value={observacao}
                  onChange={(e) => setObservacao(e.target.value)}
                  className="h-9"
                />
              </div>
            </div>

            <div className="mt-3 rounded-md bg-muted/40 p-3 text-xs text-muted-foreground">
              {modo === "A_PARTIR_DE_HOJE" && (
                <>
                  Fecha a vigência atual em hoje e abre uma nova com o custo informado.
                  Vendas anteriores mantêm o custo de quando foram feitas.
                </>
              )}
              {modo === "PERIODO" && (
                <>
                  Insere uma vigência válida apenas entre as datas escolhidas. Útil para
                  corrigir um intervalo específico sem afetar o restante.
                </>
              )}
              {modo === "HISTORICO_COMPLETO" && (
                <>
                  <strong className="text-destructive">Atenção:</strong> apaga todas as
                  vigências do produto e aplica o custo informado em <strong>toda</strong>{" "}
                  a história. Vendas antigas serão recalculadas.
                </>
              )}
            </div>

            <Button
              className="mt-3 w-full sm:w-auto"
              onClick={() => aplicar.mutate()}
              disabled={aplicar.isPending || !valor}
            >
              Aplicar
            </Button>
          </div>

          <div>
            <h3 className="mb-2 text-sm font-semibold flex items-center gap-2">
              <Calendar className="h-4 w-4" />
              Vigências atuais
            </h3>
            {isLoading ? (
              <div className="rounded border p-4 text-sm text-muted-foreground">
                Carregando...
              </div>
            ) : !data || data.vigencias.length === 0 ? (
              <div className="rounded border border-dashed p-4 text-sm text-muted-foreground">
                Nenhuma vigência cadastrada. O custo atual ({" "}
                <strong>
                  {data?.produto.custoUnitarioAtual != null
                    ? formatBRL(data.produto.custoUnitarioAtual)
                    : "N/A"}
                </strong>{" "}
                ) vem do campo Produto.custoUnitario como fallback.
              </div>
            ) : (
              <div className="overflow-x-auto rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Início</TableHead>
                      <TableHead>Fim</TableHead>
                      <TableHead className="text-right">Custo</TableHead>
                      <TableHead>Origem</TableHead>
                      <TableHead className="w-[60px]" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.vigencias.map((v) => (
                      <TableRow key={v.id}>
                        <TableCell className="font-mono text-xs">
                          {v.vigenciaInicio.slice(0, 10)}
                        </TableCell>
                        <TableCell className="font-mono text-xs text-muted-foreground">
                          {v.vigenciaFim?.slice(0, 10) ?? "—"}
                        </TableCell>
                        <TableCell className="text-right font-semibold tabular-nums">
                          {formatBRL(v.custoCentavos)}
                        </TableCell>
                        <TableCell className="text-xs">
                          <span className="rounded bg-muted px-1.5 py-0.5">
                            {v.origem}
                          </span>
                          {v.observacao && (
                            <span className="ml-2 text-muted-foreground">
                              {v.observacao}
                            </span>
                          )}
                        </TableCell>
                        <TableCell>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-destructive"
                            onClick={() => {
                              if (confirm(`Remover vigência de ${v.vigenciaInicio.slice(0, 10)}?`)) {
                                remover.mutate(v.id);
                              }
                            }}
                            disabled={remover.isPending}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
