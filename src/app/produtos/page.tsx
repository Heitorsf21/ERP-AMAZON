"use client";

import { useEffect, useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { CardResumoEstoque } from "@/components/produtos/card-resumo-estoque";
import { ListaProdutos } from "@/components/produtos/lista-produtos";
import { DialogProduto } from "@/components/produtos/dialog-produto";
import {
  DEFAULT_PRODUTO_FILTROS,
  type ProdutoFiltrosQuery,
} from "@/modules/estoque/filtros";

export default function ProdutosPage() {
  const [modalNovo, setModalNovo] = useState(false);
  const [filtros, setFiltros] = useState<ProdutoFiltrosQuery>({
    ...DEFAULT_PRODUTO_FILTROS,
    busca: "",
  });
  const [buscaDebounced, setBuscaDebounced] = useState("");

  useEffect(() => {
    const id = setTimeout(() => setBuscaDebounced(filtros.busca ?? ""), 250);
    return () => clearTimeout(id);
  }, [filtros.busca]);

  const filtrosConsulta = useMemo<ProdutoFiltrosQuery>(
    () => ({
      ...filtros,
      busca: buscaDebounced,
    }),
    [buscaDebounced, filtros],
  );

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

      <CardResumoEstoque filtros={filtrosConsulta} />
      <ListaProdutos
        filtros={filtros}
        filtrosConsulta={filtrosConsulta}
        onFiltrosChange={setFiltros}
      />

      <DialogProduto
        aberto={modalNovo}
        produto={null}
        onOpenChange={setModalNovo}
      />
    </div>
  );
}
