"use client";

import * as React from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { RefreshCw, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type DialogImportarCsvProps = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  periodoInicial: { de: string; ate: string };
};

export function DialogImportarCsv({
  open,
  onOpenChange,
  periodoInicial,
}: DialogImportarCsvProps) {
  const queryClient = useQueryClient();
  const [arquivo, setArquivo] = React.useState<File | null>(null);
  const [periodo, setPeriodo] = React.useState(periodoInicial);

  React.useEffect(() => {
    if (open) setPeriodo(periodoInicial);
  }, [open, periodoInicial]);

  const importarMut = useMutation({
    mutationFn: async () => {
      if (!arquivo) throw new Error("Selecione um arquivo");
      const form = new FormData();
      form.append("arquivo", arquivo);
      form.append("periodoInicio", periodo.de);
      form.append("periodoFim", periodo.ate);
      const res = await fetch("/api/ads/importar-campanha", {
        method: "POST",
        body: form,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.erro || err.error || "Erro ao importar");
      }
      return res.json() as Promise<{ importadas: number }>;
    },
    onSuccess: (res) => {
      toast.success(`${res.importadas} campanhas importadas`);
      onOpenChange(false);
      setArquivo(null);
      queryClient.invalidateQueries({ queryKey: ["ads-campanhas"] });
      queryClient.invalidateQueries({ queryKey: ["ads-timeline"] });
      queryClient.invalidateQueries({ queryKey: ["ads-por-sku"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Importar relatório de Ads</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <p className="text-sm text-muted-foreground">
            Baixe o relatório no Seller Central → Publicidade → Relatórios e
            faça upload aqui. Aceita CSV/TSV com colunas Campaign Name, Spend,
            Sales, ACoS, ROAS (Sponsored Products report já é compatível).
          </p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Período início</Label>
              <Input
                type="date"
                value={periodo.de}
                onChange={(e) =>
                  setPeriodo((p) => ({ ...p, de: e.target.value }))
                }
              />
            </div>
            <div>
              <Label className="text-xs">Período fim</Label>
              <Input
                type="date"
                value={periodo.ate}
                onChange={(e) =>
                  setPeriodo((p) => ({ ...p, ate: e.target.value }))
                }
              />
            </div>
          </div>
          <div>
            <Label className="text-xs">Arquivo CSV/TSV</Label>
            <Input
              type="file"
              accept=".csv,.tsv,.txt"
              onChange={(e) => setArquivo(e.target.files?.[0] ?? null)}
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button
              onClick={() => importarMut.mutate()}
              disabled={!arquivo || importarMut.isPending}
            >
              {importarMut.isPending ? (
                <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Upload className="mr-2 h-4 w-4" />
              )}
              Importar
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
