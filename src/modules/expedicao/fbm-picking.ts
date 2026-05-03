import { db } from "@/lib/db";
import {
  StatusFbmPicking,
  StatusFbmPickingItem,
  type StatusFbmPicking as StatusFbmPickingType,
  type StatusFbmPickingItem as StatusFbmPickingItemType,
} from "@/modules/shared/domain";
import { whereVendaAmazonContabilizavel } from "@/modules/vendas/filtros";
import { subDays } from "date-fns";

type CriarBatchInput = {
  limite?: number;
  diasAtras?: number;
  criadoPorId?: string | null;
  criadoPorEmail?: string | null;
};

type AtualizarBatchInput = {
  status?: StatusFbmPickingType;
  etiquetaUrl?: string | null;
  observacoes?: string | null;
};

type AtualizarItemInput = {
  status?: StatusFbmPickingItemType;
  checklist?: Record<string, boolean>;
};

const FBM_CHANNEL_MARKERS = ["MFN", "MERCHANT", "SELLER", "FBM"];

export async function listarFbmPickingBatches(limit = 20) {
  return db.fbmPickingBatch.findMany({
    orderBy: { criadoEm: "desc" },
    take: limit,
    include: {
      itens: {
        select: { id: true, status: true, quantidade: true },
      },
    },
  });
}

export async function detalharFbmPickingBatch(id: string) {
  return db.fbmPickingBatch.findUnique({
    where: { id },
    include: { itens: { orderBy: [{ amazonOrderId: "asc" }, { sku: "asc" }] } },
  });
}

export async function criarFbmPickingBatch(input: CriarBatchInput = {}) {
  const limite = Math.min(Math.max(input.limite ?? 50, 1), 100);
  const desde = subDays(new Date(), input.diasAtras ?? 14);
  const vendas = await db.vendaAmazon.findMany({
    where: whereVendaAmazonContabilizavel({
      dataVenda: { gte: desde },
    }),
    orderBy: { dataVenda: "asc" },
    take: limite * 3,
  });

  const candidatas = vendas
    .filter((v) => isFbmFulfillmentChannel(v.fulfillmentChannel))
    .slice(0, limite);

  if (candidatas.length === 0) {
    return { batch: null, itensCriados: 0, mensagem: "Nenhuma venda FBM pendente encontrada." };
  }

  const existingItems = await db.fbmPickingItem.findMany({
    where: {
      OR: candidatas.map((v) => ({
        amazonOrderId: v.amazonOrderId,
        sku: v.sku,
      })),
    },
    select: { amazonOrderId: true, sku: true },
  });
  const existingKeys = new Set(existingItems.map((i) => `${i.amazonOrderId}|${i.sku}`));
  const novas = candidatas.filter((v) => !existingKeys.has(`${v.amazonOrderId}|${v.sku}`));

  if (novas.length === 0) {
    return { batch: null, itensCriados: 0, mensagem: "Vendas FBM recentes ja estao em lotes." };
  }

  const batch = await db.fbmPickingBatch.create({
    data: {
      codigo: buildBatchCode(),
      criadoPorId: input.criadoPorId ?? null,
      criadoPorEmail: input.criadoPorEmail ?? null,
      itens: {
        create: novas.map((v) => ({
          vendaAmazonId: v.id,
          amazonOrderId: v.amazonOrderId,
          sku: v.sku,
          asin: v.asin,
          titulo: v.titulo,
          quantidade: v.quantidade,
          checklistJson: JSON.stringify({
            separar: false,
            conferir: false,
            etiqueta: false,
          }),
        })),
      },
    },
    include: { itens: true },
  });

  return { batch, itensCriados: novas.length };
}

export async function atualizarFbmPickingBatch(id: string, input: AtualizarBatchInput) {
  return db.fbmPickingBatch.update({
    where: { id },
    data: {
      status: input.status,
      etiquetaUrl: input.etiquetaUrl,
      observacoes: input.observacoes,
    },
    include: { itens: true },
  });
}

export async function atualizarFbmPickingItem(
  batchId: string,
  itemId: string,
  input: AtualizarItemInput,
) {
  const now = new Date();
  const item = await db.fbmPickingItem.findFirst({
    where: { id: itemId, batchId },
    select: { id: true },
  });
  if (!item) throw new Error("Item de picking nao encontrado.");

  return db.fbmPickingItem.update({
    where: { id: item.id },
    data: {
      status: input.status,
      checklistJson: input.checklist ? JSON.stringify(input.checklist) : undefined,
      separadoEm: input.status === StatusFbmPickingItem.SEPARADO ? now : undefined,
      conferidoEm: input.status === StatusFbmPickingItem.CONFERIDO ? now : undefined,
    },
  });
}

function isFbmFulfillmentChannel(value: string | null): boolean {
  if (!value) return false;
  const normalized = value.toUpperCase();
  return FBM_CHANNEL_MARKERS.some((marker) => normalized.includes(marker));
}

function buildBatchCode(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return [
    "FBM",
    d.getUTCFullYear(),
    pad(d.getUTCMonth() + 1),
    pad(d.getUTCDate()),
    "-",
    pad(d.getUTCHours()),
    pad(d.getUTCMinutes()),
    pad(d.getUTCSeconds()),
  ].join("");
}

export { StatusFbmPicking, StatusFbmPickingItem };
