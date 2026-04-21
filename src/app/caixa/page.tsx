"use client";

import * as React from "react";
import { Plus, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { CardSaldo } from "@/components/caixa/card-saldo";
import { FormMovimentacao } from "@/components/caixa/form-movimentacao";
import { ListaMovimentacoes } from "@/components/caixa/lista-movimentacoes";
import { DialogImportar } from "@/components/caixa/dialog-importar";

export default function CaixaPage() {
  const [modalNovo, setModalNovo] = React.useState(false);
  const [modalImportar, setModalImportar] = React.useState(false);

  return (
    <div className="space-y-6">
      <PageHeader title="Caixa" description="Movimentações de entrada e saída.">
        <Button variant="outline" onClick={() => setModalImportar(true)}>
          <Upload className="mr-2 h-4 w-4" /> Importar
        </Button>
        <Button onClick={() => setModalNovo(true)}>
          <Plus className="mr-2 h-4 w-4" /> Nova movimentação
        </Button>
      </PageHeader>

      <CardSaldo />
      <ListaMovimentacoes />

      <FormMovimentacao aberto={modalNovo} onOpenChange={setModalNovo} />
      <DialogImportar aberto={modalImportar} onOpenChange={setModalImportar} />
    </div>
  );
}
