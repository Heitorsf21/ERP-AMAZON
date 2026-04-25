import Link from "next/link";
import { ArrowRight, Wallet, Package, ShoppingCart } from "lucide-react";
import { CardSaldo } from "@/components/caixa/card-saldo";
import { GraficoProjecao } from "@/components/caixa/grafico-projecao";
import { PageHeader } from "@/components/ui/page-header";
import { CardResumoEstoque } from "@/components/produtos/card-resumo-estoque";
import { CardResumoCompras } from "@/components/compras/card-resumo-compras";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { KpiStrip } from "./kpi-strip";

export default function DashboardFinanceiroPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Dashboard Financeiro"
        description="Visão geral financeira e operacional."
      />

      {/* Stat strip — KPIs do dia */}
      <KpiStrip />

      {/* Seção Financeiro */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="flex items-center gap-2 text-base">
            <Wallet className="h-4 w-4 text-primary" />
            Financeiro
          </CardTitle>
          <Button variant="ghost" size="sm" asChild className="gap-1 text-xs">
            <Link href="/financeiro">
              Ver detalhes <ArrowRight className="h-3 w-3" />
            </Link>
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          <CardSaldo />
          <GraficoProjecao />
        </CardContent>
      </Card>

      {/* Seção Produtos */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="flex items-center gap-2 text-base">
            <Package className="h-4 w-4 text-primary" />
            Produtos
          </CardTitle>
          <Button variant="ghost" size="sm" asChild className="gap-1 text-xs">
            <Link href="/produtos">
              Ver produtos <ArrowRight className="h-3 w-3" />
            </Link>
          </Button>
        </CardHeader>
        <CardContent>
          <CardResumoEstoque />
        </CardContent>
      </Card>

      {/* Seção Compras */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="flex items-center gap-2 text-base">
            <ShoppingCart className="h-4 w-4 text-primary" />
            Compras
          </CardTitle>
          <Button variant="ghost" size="sm" asChild className="gap-1 text-xs">
            <Link href="/compras">
              Ver compras <ArrowRight className="h-3 w-3" />
            </Link>
          </Button>
        </CardHeader>
        <CardContent>
          <CardResumoCompras />
        </CardContent>
      </Card>
    </div>
  );
}
