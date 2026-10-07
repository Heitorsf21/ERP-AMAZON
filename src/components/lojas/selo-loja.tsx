import { cn } from "@/lib/utils";

/** Pílula com o nome da loja (Top 15 na visão "Todas"). Cor fixa por loja. */
export function SeloLoja({ nome, classeCor }: { nome: string; classeCor: string | undefined }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 rounded-full px-1.5 text-[11px] font-semibold leading-4",
        classeCor ?? "bg-muted text-foreground/80",
      )}
    >
      {nome}
    </span>
  );
}
