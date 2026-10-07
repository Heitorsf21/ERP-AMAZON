import { getListingsItem, spApiRequest } from "@/lib/amazon-sp-api";
import { AmazonQuotaCooldownError, AmazonSpApiOperation } from "@/lib/amazon-rate-limit";
import { getCredentialsOrThrow, resolverSellerIdDoTenant } from "@/modules/amazon/service";

// Alterar o preço do anúncio (our_price) via Listings Items API 2021-08-01.
// Exige a permissão "Product Listing" no app da Amazon. Sem ela, 403.

/** Mudança acima disso (para mais ou para menos) pede segunda confirmação. */
export const LIMITE_VARIACAO_SEM_CONFIRMACAO = 0.3;

export class PermissaoListingNegadaError extends Error {
  constructor() {
    super("A Amazon ainda não liberou alteração de preço para o Atlas (permissão Product Listing).");
    this.name = "PermissaoListingNegadaError";
  }
}

export class PrecoRejeitadoError extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = "PrecoRejeitadoError";
  }
}

export type ResultadoPatchListing = {
  status?: string;
  submissionId?: string;
  issues?: Array<{ code?: string; message?: string; severity?: string }>;
};

export function precisaConfirmarVariacao(atualCentavos: number | null, novoCentavos: number): boolean {
  if (!atualCentavos || atualCentavos <= 0) return false;
  return Math.abs(novoCentavos - atualCentavos) / atualCentavos > LIMITE_VARIACAO_SEM_CONFIRMACAO;
}

export function montarPatchPreco(input: {
  productType: string;
  marketplaceId: string;
  precoCentavos: number;
}) {
  return {
    productType: input.productType,
    patches: [
      {
        op: "replace",
        path: "/attributes/purchasable_offer",
        value: [
          {
            marketplace_id: input.marketplaceId,
            currency: "BRL",
            our_price: [{ schedule: [{ value_with_tax: input.precoCentavos / 100 }] }],
          },
        ],
      },
    ],
  };
}

function mensagemDe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** spApiRequest lança "SP-API PATCH … -> 403: {…}" quando falta a permissão. */
export function ehErroPermissaoListing(err: unknown): boolean {
  return /->\s*403\b/.test(mensagemDe(err));
}

export function ehErroQuota(err: unknown): boolean {
  return err instanceof AmazonQuotaCooldownError || /SP-API quota/.test(mensagemDe(err));
}

function errosDasIssues(r: ResultadoPatchListing): string | null {
  const erros = (r.issues ?? [])
    .filter((i) => (i.severity ?? "").toUpperCase() === "ERROR")
    .map((i) => i.message)
    .filter((m): m is string => !!m);
  return erros.length > 0 ? erros.join(" ") : null;
}

export async function enviarPrecoAmazon(input: {
  sku: string;
  precoCentavos: number;
  /** true = mode=VALIDATION_PREVIEW: a Amazon valida e NÃO aplica. */
  somenteValidar: boolean;
}): Promise<ResultadoPatchListing> {
  const creds = await getCredentialsOrThrow();
  const sellerId = await resolverSellerIdDoTenant(creds);
  if (!sellerId) throw new Error("Não foi possível identificar a conta Amazon (sellerId).");

  let listing: Awaited<ReturnType<typeof getListingsItem>>;
  try {
    listing = await getListingsItem(creds, sellerId, input.sku, ["summaries"]);
  } catch (err) {
    // Sem a permissão de anúncios, a própria leitura já volta 403.
    if (ehErroPermissaoListing(err)) throw new PermissaoListingNegadaError();
    throw err;
  }
  const productType =
    listing.summaries?.find((s) => s.marketplaceId === creds.marketplaceId)?.productType ??
    listing.summaries?.[0]?.productType;
  if (!productType) {
    throw new PrecoRejeitadoError("Anúncio sem tipo de produto na Amazon; altere o preço pelo Seller Central.");
  }

  let resultado: ResultadoPatchListing;
  try {
    resultado = await spApiRequest<ResultadoPatchListing>(
      creds,
      `/listings/2021-08-01/items/${encodeURIComponent(sellerId)}/${encodeURIComponent(input.sku)}`,
      {
        method: "PATCH",
        params: {
          marketplaceIds: creds.marketplaceId,
          issueLocale: "pt_BR",
          ...(input.somenteValidar ? { mode: "VALIDATION_PREVIEW" } : {}),
        },
        body: montarPatchPreco({
          productType,
          marketplaceId: creds.marketplaceId,
          precoCentavos: input.precoCentavos,
        }),
        operation: AmazonSpApiOperation.LISTINGS_PATCH_ITEM,
      },
    );
  } catch (err) {
    if (ehErroPermissaoListing(err)) throw new PermissaoListingNegadaError();
    throw err;
  }

  if ((resultado.status ?? "").toUpperCase() === "INVALID") {
    throw new PrecoRejeitadoError(errosDasIssues(resultado) ?? "A Amazon recusou este preço.");
  }
  return resultado;
}
