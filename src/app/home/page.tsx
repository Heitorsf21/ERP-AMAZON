import { WelcomeBanner } from "@/components/home/welcome-banner";
import { IndicadoresRapidos } from "@/components/home/indicadores";
import { AlertasCriticos } from "@/components/home/alertas-criticos";
import { ResumoRapidoModal } from "@/components/home/resumo-rapido-modal";

export default function HomePage() {
  return (
    <div className="space-y-6">
      <WelcomeBanner />

      <IndicadoresRapidos />

      <AlertasCriticos />

      <div className="flex justify-end">
        <ResumoRapidoModal />
      </div>
    </div>
  );
}
