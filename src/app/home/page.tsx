import { WelcomeBanner } from "@/components/home/welcome-banner";
import { IndicadoresRapidos } from "@/components/home/indicadores";
import { PendenciasFinanceiras, EstoqueAtencao } from "@/components/home/pendencias";
import { AmazonStatusCard } from "@/components/home/amazon-status-card";
import { UltimasMovimentacoes } from "@/components/home/ultimas-movimentacoes";
import { AtalhosRapidos } from "@/components/home/atalhos";

export default function HomePage() {
  return (
    <div className="space-y-6">
      <WelcomeBanner />

      <IndicadoresRapidos />

      <AtalhosRapidos />

      <section className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <PendenciasFinanceiras />
        </div>
        <div>
          <AmazonStatusCard />
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <EstoqueAtencao />
        <UltimasMovimentacoes />
      </section>
    </div>
  );
}
