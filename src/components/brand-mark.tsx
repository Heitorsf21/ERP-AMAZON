import Image from "next/image";
import { cn } from "@/lib/utils";

/**
 * Marca visual do sistema "Atlas Seller" — usada na sidebar e no topbar
 * mobile.
 *
 * Usa o SÍMBOLO da MundoFS (apenas o totem + arco dourado, sem o texto
 * "Mundo F&S Ecommerce" da logo full) acompanhado do nome "Atlas Seller".
 *
 * - `size`: controla a altura do símbolo (24px para topbar mobile, 32px para sidebar)
 * - `collapsed`: esconde o texto (mantém só o símbolo) — útil quando a
 *   sidebar está colapsada para 64px de largura.
 */
export function BrandMark({
  size = "md",
  collapsed = false,
  className,
}: {
  size?: "sm" | "md";
  collapsed?: boolean;
  className?: string;
}) {
  const dimension = size === "sm" ? 24 : 32;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-2.5 text-foreground",
        className,
      )}
    >
      <Image
        src="/atlas-symbol.png"
        alt="Atlas Seller"
        width={dimension}
        height={dimension}
        priority
        className="shrink-0 object-contain"
        style={{ height: dimension, width: dimension }}
      />
      {!collapsed && (
        <span
          className={cn(
            "font-semibold tracking-tight leading-none",
            size === "sm" ? "text-sm" : "text-base",
          )}
        >
          Atlas Seller
        </span>
      )}
    </span>
  );
}
