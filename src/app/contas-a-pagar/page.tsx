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
  Wallet,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { KpiCard } from "@/components/ui/kpi-card";
import { ListaContas } from "@/components/contas/lista-contas";
import { DialogContasFixas } from "@/components/agenda/dialog-contas-fixas";
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
  const [modalContasFixas, setModalContasFixas] = React.useState(false);
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
        {/* Grupo compacto de ações secundárias (somente ícone + tooltip),
            separado por divisórias — espelha o mockup do redesign. */}
        <div className="inline-flex items-center rounded-md border bg-background">
          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9 rounded-none rounded-l-md text-muted-foreground hover:text-foreground"
            title="Contas fixas"
            aria-label="Contas fixas"
            onClick={() => setModalContasFixas(true)}
          >
            <Wallet className="h-4 w-4" />
          </Button>
          <span aria-hidden className="h-5 w-px bg-border" />
          <BotaoDocumentosFinanceiros
            compact
            onCriarConta={(prefill) => {
              setPrefillConta(prefill);
              setModalNova(true);
            }}
          />
          <span aria-hidden className="h-5 w-px bg-border" />
          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9 rounded-none rounded-r-md text-muted-foreground hover:text-foreground"
            title="Receber documento"
            aria-label="Receber documento"
            onClick={() => setModalDocumento(true)}
          >
            <FileUp className="h-4 w-4" />
          </Button>
        </div>
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
          accent
        />
        <KpiCard
          label="Vencidas"
          value={totais ? formatBRL(totais.vencidasCentavos) : "—"}
          sub={totais ? pluralConta(totais.qtdVencidas) : undefined}
          icon={AlertTriangle}
          color="red"
          accent
          highlight={!!totais && totais.qtdVencidas > 0}
        />
        <KpiCard
          label="Pagas no mês"
          value={totais ? formatBRL(totais.pagasMesCentavos) : "—"}
          sub={totais ? pluralConta(totais.qtdPagasMes) : undefined}
          icon={CheckCircle2}
          color="green"
          accent
        />
        <KpiCard
          label="Total do mês"
          value={totais ? formatBRL(totais.totalMesCentavos) : "—"}
          sub={totais ? pluralConta(totais.qtdTotal) : undefined}
          icon={Calendar}
          color="blue"
          accent
        />
      </div>

      <ListaContas />

      <DialogContasFixas
        aberto={modalContasFixas}
        onOpenChange={setModalContasFixas}
      />
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
