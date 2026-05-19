import { cn } from "@/lib/utils";

/**
 * Pílula que identifica a conta/marketplace Amazon do pedido (FBA_SP, FBM, etc).
 * Usa o "a" itálico em laranja como marca visual sem importar SVG externo.
 */
export function MarketplaceTag({
  label,
  className,
}: {
  label: string | null | undefined;
  className?: string;
}) {
  const value = (label ?? "").trim() || "—";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border bg-muted/40 px-2 py-1 text-xs font-medium text-foreground",
        className,
      )}
    >
      <span
        aria-hidden="true"
        className="grid h-4 w-4 place-items-center rounded-sm bg-orange-400 text-[10px] font-extrabold italic text-slate-900"
      >
        a
      </span>
      <span className="font-medium">{value}</span>
    </span>
  );
}
