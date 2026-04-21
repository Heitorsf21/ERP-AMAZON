import Link from "next/link";
import { Plus, Lightbulb } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { ListaPedidos } from "@/components/compras/lista-pedidos";
import { SugestoesReposicao } from "@/components/compras/sugestoes-reposicao";

export default function ComprasPage() {
  return (
    <div className="space-y-8">
      <PageHeader
        title="Compras"
        description="Pedidos de compra e reposição de estoque."
      >
        <Button asChild size="sm">
          <Link href="/compras/novo">
            <Plus className="mr-2 h-4 w-4" />
            Novo Pedido
          </Link>
        </Button>
      </PageHeader>

      <section className="space-y-4">
        <h2 className="flex items-center gap-2 text-sm font-medium uppercase tracking-wide text-muted-foreground">
          <Lightbulb className="h-4 w-4" />
          Sugestões de Reposição
        </h2>
        <SugestoesReposicao />
      </section>

      <section className="space-y-4">
        <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
          Pedidos
        </h2>
        <ListaPedidos />
      </section>
    </div>
  );
}
