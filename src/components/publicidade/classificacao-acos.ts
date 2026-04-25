// Faixas de classificação de ACoS — usadas em vários componentes da página
// /publicidade. Mantém consistência visual e textual.

export type ClassAcoS = {
  label: string;
  classe: string;
  acao: string;
};

export function classificarAcos(acos: number | null | undefined): ClassAcoS {
  if (acos == null)
    return {
      label: "N/A",
      classe: "bg-muted text-muted-foreground",
      acao: "Sem dados",
    };
  if (acos < 15)
    return {
      label: "Excelente",
      classe:
        "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
      acao: "Manter / aumentar lance",
    };
  if (acos < 25)
    return {
      label: "Bom",
      classe: "bg-teal-100 text-teal-800 dark:bg-teal-900 dark:text-teal-200",
      acao: "Monitorar",
    };
  if (acos < 35)
    return {
      label: "Atenção",
      classe:
        "bg-yellow-50 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300 border border-yellow-200 dark:border-yellow-800",
      acao: "Avaliar ajuste",
    };
  if (acos < 50)
    return {
      label: "Alto",
      classe:
        "bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300",
      acao: "Reduzir lance",
    };
  return {
    label: "Crítico",
    classe: "bg-red-700 text-white",
    acao: "Pausar ou revisar",
  };
}

export const FAIXAS_ACOS = [
  { range: "< 15%", label: "Excelente" },
  { range: "15–25%", label: "Bom" },
  { range: "25–35%", label: "Atenção" },
  { range: "35–50%", label: "Alto" },
  { range: "≥ 50%", label: "Crítico" },
] as const;
