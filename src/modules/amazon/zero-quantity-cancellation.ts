import { db } from "@/lib/db";
import { STATUS_PEDIDO_CANCELADO } from "@/modules/vendas/filtros";

export const STATUS_PEDIDO_CANCELADO_POR_QUANTIDADE_ZERO = "Cancelled";

type ItemQuantidadeAmazon = {
  sku?: string | null;
  quantidade: number;
};

export function skusSomenteComQuantidadeZero(
  itens: ItemQuantidadeAmazon[],
): string[] {
  const skusPositivos = new Set<string>();
  const skusZerados = new Set<string>();

  for (const item of itens) {
    const sku = item.sku?.trim();
    if (!sku) continue;

    if (item.quantidade > 0) {
      skusPositivos.add(sku);
      continue;
    }

    skusZerados.add(sku);
  }

  for (const sku of skusPositivos) {
    skusZerados.delete(sku);
  }

  return [...skusZerados].sort();
}

export async function marcarVendasAmazonQuantidadeZeroComoCanceladas(input: {
  amazonOrderId: string;
  skus: string[];
  ultimaSyncEm?: Date;
}): Promise<number> {
  const skus = [...new Set(input.skus.map((sku) => sku.trim()).filter(Boolean))];
  if (skus.length === 0) return 0;

  const result = await db.vendaAmazon.updateMany({
    where: {
      amazonOrderId: input.amazonOrderId,
      sku: { in: skus },
      statusPedido: { notIn: [...STATUS_PEDIDO_CANCELADO] },
    },
    data: {
      statusPedido: STATUS_PEDIDO_CANCELADO_POR_QUANTIDADE_ZERO,
      ultimaSyncEm: input.ultimaSyncEm ?? new Date(),
    },
  });

  return result.count;
}

export function isStatusPedidoCancelado(status?: string | null): boolean {
  const normalized = status?.trim().toUpperCase();
  if (!normalized) return false;

  return STATUS_PEDIDO_CANCELADO.some(
    (statusCancelado) => statusCancelado.toUpperCase() === normalized,
  );
}
