"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertCircle, FileCheck, FileText, FileUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { KpiCard } from "@/components/ui/kpi-card";
import { ListaNotasFiscais } from "@/components/notas-fiscais/lista-notas-fiscais";
import { DialogReceberDocumento } from "@/components/contas/dialog-receber-documento";
import { fetchJSON } from "@/lib/fetcher";

type DocumentosTotais = {
  total: number;
  boletos: number;
  notasFiscais: number;
  semConta: number;
};

export default function NotasFiscaisPage() {
  const [modalUpload, setModalUpload] = React.useState(false);

  const { data: totais } = useQuery<DocumentosTotais>({
    queryKey: ["documentos-totais"],
    queryFn: () =>
      fetchJSON<DocumentosTotais>("/api/documentos-financeiros/totais"),
  });

  const fmt = (n: number | undefined) =>
    typeof n === "number" ? n.toLocaleString("pt-BR") : "—";

  return (
    <div className="space-y-6">
      <PageHeader
        title="Notas Fiscais & Boletos"
        description="Busque, visualize e baixe os documentos recebidos de fornecedores."
      >
        <Button onClick={() => setModalUpload(true)}>
          <FileUp className="mr-2 h-4 w-4" />
          Subir documento
        </Button>
      </PageHeader>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="Total de documentos"
          value={fmt(totais?.total)}
          icon={FileText}
          color="blue"
        />
        <KpiCard
          label="Boletos"
          value={fmt(totais?.boletos)}
          icon={FileText}
          color="orange"
        />
        <KpiCard
          label="Notas fiscais"
          value={fmt(totais?.notasFiscais)}
          icon={FileCheck}
          color="green"
        />
        <KpiCard
          label="Sem conta vinculada"
          value={fmt(totais?.semConta)}
          icon={AlertCircle}
          color="slate"
        />
      </div>

      <ListaNotasFiscais />

      <DialogReceberDocumento
        aberto={modalUpload}
        onOpenChange={setModalUpload}
      />
    </div>
  );
}
