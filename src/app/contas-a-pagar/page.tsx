"use client";

import * as React from "react";
import { FileUp, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { ListaContas } from "@/components/contas/lista-contas";
import {
  DialogNovaConta,
  type PrefillNovaConta,
} from "@/components/contas/dialog-nova-conta";
import { DialogReceberDocumento } from "@/components/contas/dialog-receber-documento";
import { BotaoDocumentosFinanceiros } from "@/components/contas/lista-documentos-financeiros";

export default function ContasAPagarPage() {
  const [modalNova, setModalNova] = React.useState(false);
  const [modalDocumento, setModalDocumento] = React.useState(false);
  const [prefillConta, setPrefillConta] = React.useState<PrefillNovaConta | undefined>();

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
