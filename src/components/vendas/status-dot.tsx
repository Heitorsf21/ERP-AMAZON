import { cn } from "@/lib/utils";
import type { StatusVisual } from "@/lib/vendas-status";

const DOT_STYLES: Record<StatusVisual, string> = {
  pending: "bg-amber-500 shadow-[0_0_0_3px_rgba(245,158,11,0.18)]",
  done: "bg-emerald-500 shadow-[0_0_0_3px_rgba(16,185,129,0.18)]",
  cancel: "bg-red-500 shadow-[0_0_0_3px_rgba(239,68,68,0.18)]",
  refund: "bg-violet-500 shadow-[0_0_0_3px_rgba(139,92,246,0.18)]",
};

export function StatusDot({
  status,
  className,
}: {
  status: StatusVisual;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-block h-2.5 w-2.5 shrink-0 rounded-full",
        DOT_STYLES[status],
        className,
      )}
    />
  );
}
