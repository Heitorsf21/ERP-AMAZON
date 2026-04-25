"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  Calendar,
  CheckCircle2,
  FileText,
  FileUp,
  Plus,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { KpiCard } from "@/components/ui/kpi-card";
import { ListaContas } from "@/components/contas/lista-contas";
import {
  DialogNovaConta,
  type PrefillNovaConta,
} from "@/components/contas/dialog-nova-conta";
import { DialogReceberDocumento } from "@/components/contas/dialog-receber-documento";
import { BotaoDocumentosFinanceiros } from "@/components/contas/lista-documentos-financeiros";
import { fetchJSON } from "@/lib/fetcher";
import { formatBRL } from "@/lib/money";

type TotaisMes = {
  emAbertoCentavos: number;
  vencidasCentavos: number;
  pagasMesCentavos: number;
  totalMesCentavos: number;
  qtdEmAberto: number;
  qtdVencidas: number;
  qtdPagasMes: number;
  qtdTotal: number;
};

function pluralConta(qtd: number) {
  return `${qtd} conta${qtd === 1 ? "" : "s"}`;
}

export default function ContasAPagarPage() {
  const [modalNova, setModalNova] = React.useState(false);
  const [modalDocumento, setModalDocumento] = React.useState(false);
  const [prefillConta, setPrefillConta] = React.useState<PrefillNovaConta | undefined>();

  const { data: totais } = useQuery<TotaisMes>({
    queryKey: ["contas-totais-mes"],
    queryFn: () => fetchJSON<TotaisMes>("/api/contas/totais"),
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Contas a Pagar"
        description="Gerencie obrigações financeiras, pagamentos e fornecedores."
      >
        <BotaoDocumentosFinanceiros
          onCriarConta={(prefill) => {
            setPrefillConta(prefill);
            setModalNova(true);
          }}
        />
        <Button variant="outline" onClick={() => setModalDocumento(true)}>
          <FileUp className="mr-2 h-4 w-4" />
          Receber documento
        </Button>
        <Button
          onClick={() => {
            setPrefillConta(undefined);
            setModalNova(true);
          }}
        >
          <Plus className="mr-2 h-4 w-4" />
          Nova conta
        </Button>
      </PageHeader>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="Em aberto"
          value={totais ? formatBRL(totais.emAbertoCentavos) : "—"}
          sub={totais ? pluralConta(totais.qtdEmAberto) : undefined}
          icon={FileText}
          color="orange"
        />
        <KpiCard
          label="Vencidas"
          value={totais ? formatBRL(totais.vencidasCentavos) : "—"}
          sub={totais ? pluralConta(totais.qtdVencidas) : undefined}
          icon={AlertTriangle}
          color="red"
          highlight={!!totais && totais.qtdVencidas > 0}
        />
        <KpiCard
          label="Pagas no mês"
          value={totais ? formatBRL(totais.pagasMesCentavos) : "—"}
          sub={totais ? pluralConta(totais.qtdPagasMes) : undefined}
          icon={CheckCircle2}
          color="green"
        />
        <KpiCard
          label="Total do mês"
          value={totais ? formatBRL(totais.totalMesCentavos) : "—"}
          sub={totais ? pluralConta(totais.qtdTotal) : undefined}
          icon={Calendar}
          color="blue"
        />
      </div>

      <ListaContas />

      <DialogReceberDocumento
        aberto={modalDocumento}
        onOpenChange={setModalDocumento}
      />
      <DialogNovaConta
        aberto={modalNova}
        prefill={prefillConta}
        onOpenChange={(v) => {
          if (!v) setPrefillConta(undefined);
          setModalNova(v);
        }}
      />
    </div>
  );
}
