import Image from "next/image";
import { cn } from "@/lib/utils";

/**
 * Marca visual do sistema "Atlas Seller" — usada na sidebar e no topbar
 * mobile. Renderiza a logo MundoFS (símbolo + arco dourado) acompanhada
 * do nome "Atlas Seller".
 *
 * - `size`: controla a altura da logo (24px para topbar mobile, 32px para sidebar)
 * - `collapsed`: esconde o texto (mantém só a logo) — útil quando a
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
        "inline-flex items-center gap-2 text-foreground",
        className,
      )}
    >
      <Image
        src="/logo-mundofs.png"
        alt="Atlas Seller"
        width={dimension * 2.94}
        height={dimension}
        priority
        className="h-auto shrink-0 object-contain"
        style={{ height: dimension, width: "auto" }}
      />
      {!collapsed && (
        <span className="flex flex-col leading-tight">
          <span
            className={cn(
              "font-semibold tracking-tight",
              size === "sm" ? "text-sm" : "text-base",
            )}
          >
            Atlas Seller
          </span>
          {size === "md" && (
            <span className="text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
              MundoFS
            </span>
          )}
        </span>
      )}
    </span>
  );
}
