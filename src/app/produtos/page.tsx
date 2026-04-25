"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { CardResumoEstoque } from "@/components/produtos/card-resumo-estoque";
import { ListaProdutos } from "@/components/produtos/lista-produtos";
import { DialogProduto } from "@/components/produtos/dialog-produto";

export default function ProdutosPage() {
  const [modalNovo, setModalNovo] = useState(false);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Produtos"
        description="Catálogo, estoque e performance Amazon por SKU."
      >
        <Button onClick={() => setModalNovo(true)}>
          <Plus className="mr-2 h-4 w-4" />
          Novo produto
        </Button>
      </PageHeader>

      <CardResumoEstoque />
      <ListaProdutos />

      <DialogProduto
        aberto={modalNovo}
        produto={null}
        onOpenChange={setModalNovo}
      />
    </div>
  );
}
