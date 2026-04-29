import { db } from "@/lib/db";
import {
  getListingsItem,
  getSellerId,
  type SPAPICredentials,
  type SPListingsItem,
} from "@/lib/amazon-sp-api";
import { getAmazonConfig, isAmazonConfigured } from "@/modules/amazon/service";

export type ListingDiffField = {
  campo: "titulo" | "preco" | "status" | "imagem";
  erp: string | number | null;
  amazon: string | number | null;
  igual: boolean;
};

export type ProdutoAmazonListingDiff = {
  produto: {
    id: string;
    sku: string;
    asin: string | null;
    nome: string;
    precoVenda: number | null;
    ativo: boolean;
    imagemUrl: string | null;
  };
  amazon: {
    sellerId: string;
    sku: string;
    asin: string | null;
    titulo: string | null;
    precoCentavos: number | null;
    status: string | null;
    imagemUrl: string | null;
    issuesCount: number;
  };
  diffs: ListingDiffField[];
  raw: SPListingsItem;
};

export async function getProdutoAmazonListingDiff(
  produtoId: string,
): Promise<ProdutoAmazonListingDiff> {
  const produto = await db.produto.findUnique({
    where: { id: produtoId },
    select: {
      id: true,
      sku: true,
      asin: true,
      nome: true,
      precoVenda: true,
      ativo: true,
      imagemUrl: true,
      amazonImagemUrl: true,
    },
  });

  if (!produto) {
    throw new Error("Produto nao encontrado.");
  }

  const config = await getAmazonConfig();
  if (!isAmazonConfigured(config)) {
    throw new Error("Amazon SP-API nao configurada.");
  }

  const creds: SPAPICredentials = {
    clientId: config.amazon_client_id!,
    clientSecret: config.amazon_client_secret!,
    refreshToken: config.amazon_refresh_token!,
    marketplaceId: config.amazon_marketplace_id!,
    endpoint: config.amazon_endpoint || undefined,
  };

  const sellerId = await resolveSellerId(creds, config.amazon_seller_id);
  const listing = await getListingsItem(creds, sellerId, produto.sku);
  const summary =
    listing.summaries?.find((s) => s.marketplaceId === creds.marketplaceId) ??
    listing.summaries?.[0];

  const amazon = {
    sellerId,
    sku: listing.sku ?? produto.sku,
    asin: summary?.asin ?? produto.asin,
    titulo: summary?.itemName ?? firstAttributeString(listing.attributes, "item_name"),
    precoCentavos: extractListingPriceCentavos(listing),
    status: normalizeStatus(summary?.status),
    imagemUrl:
      summary?.mainImage?.link ??
      firstAttributeString(listing.attributes, "main_product_image_locator"),
    issuesCount: listing.issues?.length ?? 0,
  };

  const erpImagem = produto.imagemUrl ?? produto.amazonImagemUrl;
  const diffs: ListingDiffField[] = [
    {
      campo: "titulo",
      erp: produto.nome,
      amazon: amazon.titulo,
      igual: normalizeText(produto.nome) === normalizeText(amazon.titulo),
    },
    {
      campo: "preco",
      erp: produto.precoVenda,
      amazon: amazon.precoCentavos,
      igual:
        produto.precoVenda != null &&
        amazon.precoCentavos != null &&
        Math.abs(produto.precoVenda - amazon.precoCentavos) <= 1,
    },
    {
      campo: "status",
      erp: produto.ativo ? "ATIVO" : "INATIVO",
      amazon: amazon.status,
      igual: produto.ativo
        ? isAmazonStatusActive(amazon.status)
        : !isAmazonStatusActive(amazon.status),
    },
    {
      campo: "imagem",
      erp: erpImagem,
      amazon: amazon.imagemUrl,
      igual: normalizeText(erpImagem) === normalizeText(amazon.imagemUrl),
    },
  ];

  return {
    produto: {
      id: produto.id,
      sku: produto.sku,
      asin: produto.asin,
      nome: produto.nome,
      precoVenda: produto.precoVenda,
      ativo: produto.ativo,
      imagemUrl: erpImagem,
    },
    amazon,
    diffs,
    raw: listing,
  };
}

async function resolveSellerId(
  creds: SPAPICredentials,
  configuredSellerId?: string | null,
): Promise<string> {
  if (configuredSellerId) return configuredSellerId;

  const sellerId = await getSellerId(creds);
  if (!sellerId) {
    throw new Error("Nao foi possivel resolver o sellerId da conta Amazon.");
  }

  await db.configuracaoSistema.upsert({
    where: { chave: "amazon_seller_id" },
    create: { chave: "amazon_seller_id", valor: sellerId },
    update: { valor: sellerId },
  });

  return sellerId;
}

function firstAttributeString(
  attributes: Record<string, unknown> | undefined,
  key: string,
): string | null {
  const value = attributes?.[key];
  const scalar = firstScalar(value);
  return scalar == null ? null : String(scalar);
}

function firstScalar(value: unknown): string | number | null {
  if (value == null) return null;
  if (typeof value === "string" || typeof value === "number") return value;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = firstScalar(item);
      if (found != null) return found;
    }
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    for (const key of ["value", "media_location", "link", "amount"]) {
      const found = firstScalar(record[key]);
      if (found != null) return found;
    }
  }
  return null;
}

function extractListingPriceCentavos(listing: SPListingsItem): number | null {
  for (const offer of listing.offers ?? []) {
    const amount = findMoneyAmount(offer);
    if (amount != null) return Math.round(amount * 100);
  }
  return null;
}

function findMoneyAmount(value: unknown): number | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;

  const direct = record.amount ?? record.Amount;
  if (typeof direct === "number") return direct;
  if (typeof direct === "string") {
    const parsed = Number(direct.replace(",", "."));
    if (Number.isFinite(parsed)) return parsed;
  }

  for (const key of ["listingPrice", "ListingPrice", "price", "Price"]) {
    const nested = findMoneyAmount(record[key]);
    if (nested != null) return nested;
  }

  for (const nested of Object.values(record)) {
    if (nested && typeof nested === "object") {
      const found = findMoneyAmount(nested);
      if (found != null) return found;
    }
  }

  return null;
}

function normalizeStatus(status: string[] | string | undefined): string | null {
  if (!status) return null;
  return Array.isArray(status) ? status.join(", ") : status;
}

function isAmazonStatusActive(status: string | null): boolean {
  if (!status) return false;
  const normalized = status.toUpperCase();
  return (
    normalized.includes("BUYABLE") ||
    normalized.includes("DISCOVERABLE") ||
    normalized.includes("ACTIVE")
  );
}

function normalizeText(value: string | null | undefined): string {
  return (value ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}
