"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { CardResumoEstoque } from "@/components/estoque/card-resumo-estoque";
import { ListaProdutos } from "@/components/estoque/lista-produtos";
import { DialogProduto } from "@/components/estoque/dialog-produto";
import { PainelGestorSeller } from "@/components/estoque/painel-gestor-seller";

export default function EstoquePage() {
  const [modalNovo, setModalNovo] = useState(false);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Estoque"
        description="Gestão de produtos, entradas e saídas de estoque."
      >
        <Button onClick={() => setModalNovo(true)}>
          <Plus className="mr-2 h-4 w-4" />
          Novo produto
        </Button>
      </PageHeader>

      <CardResumoEstoque />
      <PainelGestorSeller />
      <ListaProdutos />

      <DialogProduto
        aberto={modalNovo}
        produto={null}
        onOpenChange={setModalNovo}
      />
    </div>
  );
}
