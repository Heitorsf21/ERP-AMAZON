import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { CardSaldo } from "@/components/caixa/card-saldo";
import { GraficoProjecao } from "@/components/caixa/grafico-projecao";
import { PageHeader } from "@/components/ui/page-header";
import { CardResumoEstoque } from "@/components/estoque/card-resumo-estoque";
import { CardResumoCompras } from "@/components/compras/card-resumo-compras";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";

export default function DashboardFinanceiroPage() {
  return (
    <div className="space-y-8">
      <PageHeader
        title="Dashboard Financeiro"
        description="Visão geral financeira e operacional."
      />

      <section className="space-y-4">
        <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
          Financeiro
        </h2>
        <CardSaldo />
        <GraficoProjecao />
      </section>

      <Separator />

      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
            Estoque
          </h2>
          <Button variant="ghost" size="sm" asChild className="gap-1 text-xs">
            <Link href="/estoque">
              Ver estoque <ArrowRight className="h-3 w-3" />
            </Link>
          </Button>
        </div>
        <CardResumoEstoque />
      </section>

      <Separator />

      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
            Compras
          </h2>
          <Button variant="ghost" size="sm" asChild className="gap-1 text-xs">
            <Link href="/compras">
              Ver compras <ArrowRight className="h-3 w-3" />
            </Link>
          </Button>
        </div>
        <CardResumoCompras />
      </section>
    </div>
  );
}
