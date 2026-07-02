"use client";

import Link from "next/link";
import { AlertTriangle } from "lucide-react";

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

// Strip compacta de sinais acionáveis — vive logo abaixo dos KPIs (antes era
// um card grande no rodapé da página). Os nomes das campanhas afetadas ficam
// no title de cada contador.
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
    <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 dark:border-amber-900/50 dark:bg-amber-950/30">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
        <span className="flex items-center gap-1.5 font-semibold text-amber-800 dark:text-amber-300">
          <AlertTriangle className="h-4 w-4" />
          Sinais de atenção
        </span>
        {acosAlto.length > 0 && (
          <Contador
            n={acosAlto.length}
            texto={`campanha${acosAlto.length > 1 ? "s" : ""} com ACoS > 30%`}
            exemplos={acosAlto.map((c) => c.nomeCampanha)}
          />
        )}
        {roasBaixo.length > 0 && (
          <Contador
            n={roasBaixo.length}
            texto={`campanha${roasBaixo.length > 1 ? "s" : ""} com ROAS < 2`}
            exemplos={roasBaixo.map((c) => c.nomeCampanha)}
          />
        )}
        {conversaoBaixa.length > 0 && (
          <Contador
            n={conversaoBaixa.length}
            texto="com conversão < 1%"
            exemplos={conversaoBaixa.map((c) => c.nomeCampanha)}
          />
        )}
        <Link
          href="/publicidade/otimizador"
          className="ml-auto font-medium text-amber-900 underline underline-offset-2 dark:text-amber-200"
        >
          Resolver no Otimizador →
        </Link>
      </div>
    </div>
  );
}

function Contador({
  n,
  texto,
  exemplos,
}: {
  n: number;
  texto: string;
  exemplos: string[];
}) {
  return (
    <span
      className="cursor-default text-amber-800/90 dark:text-amber-200/90"
      title={exemplos.slice(0, 5).join(" · ")}
    >
      <b className="tabular-nums">{n}</b> {texto}
    </span>
  );
}
