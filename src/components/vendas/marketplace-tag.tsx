import { cn } from "@/lib/utils";
import { normalizarNomeMarketplace } from "@/lib/amazon-marketplace";

/**
 * Pílula que identifica o marketplace Amazon do pedido (ex: `amazon.com.br`).
 *
 * O backend grava em `VendaAmazon.marketplace` ora o nome amigável vindo do
 * `SalesChannel`, ora o `marketplaceId` cru — aqui aplicamos
 * `normalizarNomeMarketplace` para o usuário sempre ver o domínio.
 */
export function MarketplaceTag({
  label,
  className,
}: {
  label: string | null | undefined;
  className?: string;
}) {
  const value = normalizarNomeMarketplace(label);
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border bg-muted/40 px-2 py-1 text-xs font-medium text-foreground",
        className,
      )}
    >
      <AmazonSmile className="h-3.5 w-4 shrink-0" />
      <span className="font-medium">{value}</span>
    </span>
  );
}

/**
 * "Sorriso" da Amazon (arco laranja com ponta de seta), desenhado em SVG
 * para não depender de asset externo nem importar a logo completa
 * (`amazon` + smile) — o texto ao lado já cobre o nome.
 */
function AmazonSmile({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 28 14"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      className={className}
      fill="none"
    >
      <path
        d="M2 4c3 7 16 9 23 3"
        stroke="#FF9900"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path d="M20 1l5 5-7 1z" fill="#FF9900" />
    </svg>
  );
}
