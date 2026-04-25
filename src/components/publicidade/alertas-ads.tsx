"use client";

import { AlertTriangle, MousePointerClick, Zap } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

type CampanhaParaAlerta = {
  nomeCampanha: string;
  acosPercentual: number | null;
  roas: number | null;
  taxaConversaoPercentual: number | null;
  cliques: number;
};

type AlertasAdsProps = {
  campanhas: CampanhaParaAlerta[];
};

export function AlertasAds({ campanhas }: AlertasAdsProps) {
  const acosAlto = campanhas.filter((c) => (c.acosPercentual ?? 0) > 30);
  const roasBaixo = campanhas.filter(
    (c) => c.roas != null && c.roas < 2 && c.cliques > 0,
  );
  const conversaoBaixa = campanhas.filter(
    (c) =>
      c.cliques >= 30 &&
      c.taxaConversaoPercentual != null &&
      c.taxaConversaoPercentual < 1,
  );

  if (
    acosAlto.length === 0 &&
    roasBaixo.length === 0 &&
    conversaoBaixa.length === 0
  ) {
    return null;
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">
          Sinais de atenção
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="space-y-2 text-sm">
          {acosAlto.length > 0 && (
            <Linha
              icon={AlertTriangle}
              cor="text-orange-700 dark:text-orange-300 bg-orange-50 dark:bg-orange-950/40 border-orange-200 dark:border-orange-900"
              titulo={`${acosAlto.length} campanha(s) com ACoS acima de 30%`}
              detalhe="Considere reduzir lances ou pausar palavras-chave caras."
              exemplos={acosAlto.slice(0, 3).map((c) => c.nomeCampanha)}
            />
          )}
          {roasBaixo.length > 0 && (
            <Linha
              icon={Zap}
              cor="text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-950/40 border-red-200 dark:border-red-900"
              titulo={`${roasBaixo.length} campanha(s) com ROAS abaixo de 2`}
              detalhe="Cada R$ investido está retornando menos de R$ 2,00 — revise."
              exemplos={roasBaixo.slice(0, 3).map((c) => c.nomeCampanha)}
            />
          )}
          {conversaoBaixa.length > 0 && (
            <Linha
              icon={MousePointerClick}
              cor="text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-900"
              titulo={`${conversaoBaixa.length} campanha(s) com conversão abaixo de 1%`}
              detalhe="Avalie título, fotos e preço; tráfego está chegando mas não converte."
              exemplos={conversaoBaixa.slice(0, 3).map((c) => c.nomeCampanha)}
            />
          )}
        </ul>
      </CardContent>
    </Card>
  );
}

function Linha({
  icon: Icon,
  cor,
  titulo,
  detalhe,
  exemplos,
}: {
  icon: React.ComponentType<{ className?: string }>;
  cor: string;
  titulo: string;
  detalhe: string;
  exemplos: string[];
}) {
  return (
    <li className={cn("flex items-start gap-3 rounded-md border p-3", cor)}>
      <Icon className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="font-medium">{titulo}</p>
        <p className="mt-0.5 text-xs opacity-90">{detalhe}</p>
        {exemplos.length > 0 && (
          <p className="mt-1 truncate text-[11px] opacity-80">
            Ex.: {exemplos.join(" · ")}
          </p>
        )}
      </div>
    </li>
  );
}
