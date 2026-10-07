import { getListingsItem, spApiRequest } from "@/lib/amazon-sp-api";
import { AmazonQuotaCooldownError, AmazonSpApiOperation } from "@/lib/amazon-rate-limit";
import { extractAmazonListingEffectivePriceCentavos } from "@/modules/amazon/pricing";
import { getCredentialsOrThrow, resolverSellerIdDoTenant } from "@/modules/amazon/service";

// Alterar o preço do anúncio (our_price) via Listings Items API 2021-08-01.
// Exige a permissão "Product Listing" no app da Amazon. Sem ela, 403.
//
// A API só aceita patch em atributo de topo: um "replace" em
// /attributes/purchasable_offer troca o atributo INTEIRO. Por isso lemos as
// ofertas atuais e reenviamos todas, trocando só o our_price da oferta ALL do
// marketplace — promoção agendada (discounted_price), travas mín./máx.
// (minimum/maximum_seller_allowed_price) e ofertas B2B ficam intactas.

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
  /** our_price lido do anúncio antes da troca (sem considerar promoção). */
  ourPriceAnteriorCentavos?: number | null;
  /** Preço promocional (discounted_price) vigente no anúncio, se houver — continua valendo. */
  promocaoAtivaCentavos?: number | null;
};

type Oferta = Record<string, unknown>;

function ehRegistro(v: unknown): v is Oferta {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Oferta ao consumidor (audience ALL, ou sem audience) do marketplace. */
function ehOfertaAlvo(oferta: Oferta, marketplaceId: string): boolean {
  const audience = typeof oferta.audience === "string" ? oferta.audience.toUpperCase() : "ALL";
  return oferta.marketplace_id === marketplaceId && audience === "ALL";
}

/** Separa o our_price da promoção vigente na oferta ALL do marketplace. */
export function lerPrecosDaOferta(
  ofertasAtuais: unknown,
  marketplaceId: string,
  now = new Date(),
): { ourPriceCentavos: number | null; promocaoAtivaCentavos: number | null } {
  const ofertas = Array.isArray(ofertasAtuais) ? ofertasAtuais.filter(ehRegistro) : [];
  const alvo = ofertas.find((o) => ehOfertaAlvo(o, marketplaceId));
  if (!alvo) return { ourPriceCentavos: null, promocaoAtivaCentavos: null };
  const so = (campo: "our_price" | "discounted_price") =>
    alvo[campo] === undefined
      ? null
      : extractAmazonListingEffectivePriceCentavos(
          { attributes: { purchasable_offer: [{ [campo]: alvo[campo] }] } },
          now,
        );
  return { ourPriceCentavos: so("our_price"), promocaoAtivaCentavos: so("discounted_price") };
}

export function precisaConfirmarVariacao(atualCentavos: number | null, novoCentavos: number): boolean {
  if (!atualCentavos || atualCentavos <= 0) return false;
  return Math.abs(novoCentavos - atualCentavos) / atualCentavos > LIMITE_VARIACAO_SEM_CONFIRMACAO;
}

export function montarPatchPreco(input: {
  productType: string;
  marketplaceId: string;
  precoCentavos: number;
  /** attributes.purchasable_offer atual do anúncio (reenviado inteiro). */
  ofertasAtuais?: unknown;
}) {
  const ourPrice = [{ schedule: [{ value_with_tax: input.precoCentavos / 100 }] }];
  const ofertas = Array.isArray(input.ofertasAtuais) ? input.ofertasAtuais : [];
  let trocou = false;
  const value: unknown[] = ofertas.map((oferta) => {
    if (!trocou && ehRegistro(oferta) && ehOfertaAlvo(oferta, input.marketplaceId)) {
      trocou = true;
      return { ...oferta, our_price: ourPrice };
    }
    return oferta;
  });
  if (!trocou) {
    value.unshift({ marketplace_id: input.marketplaceId, currency: "BRL", our_price: ourPrice });
  }
  return {
    productType: input.productType,
    patches: [{ op: "replace", path: "/attributes/purchasable_offer", value }],
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
    listing = await getListingsItem(creds, sellerId, input.sku, ["summaries", "attributes"]);
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

  const ofertasAtuais = listing.attributes?.purchasable_offer;
  const body = montarPatchPreco({
    productType,
    marketplaceId: creds.marketplaceId,
    precoCentavos: input.precoCentavos,
    ofertasAtuais,
  });
  const patch = async (validar: boolean) => {
    let r: ResultadoPatchListing;
    try {
      r = await spApiRequest<ResultadoPatchListing>(
        creds,
        `/listings/2021-08-01/items/${encodeURIComponent(sellerId)}/${encodeURIComponent(input.sku)}`,
        {
          method: "PATCH",
          params: {
            marketplaceIds: creds.marketplaceId,
            issueLocale: "pt_BR",
            ...(validar ? { mode: "VALIDATION_PREVIEW" } : {}),
          },
          body,
          operation: AmazonSpApiOperation.LISTINGS_PATCH_ITEM,
        },
      );
    } catch (err) {
      if (ehErroPermissaoListing(err)) throw new PermissaoListingNegadaError();
      throw err;
    }
    if ((r.status ?? "").toUpperCase() === "INVALID") {
      throw new PrecoRejeitadoError(errosDasIssues(r) ?? "A Amazon recusou este preço.");
    }
    return r;
  };

  // Aplicação real: a Amazon valida o corpo antes (VALIDATION_PREVIEW); se
  // recusar, nada é aplicado no anúncio.
  if (!input.somenteValidar) await patch(true);
  const resultado = await patch(input.somenteValidar);

  const precos = lerPrecosDaOferta(ofertasAtuais, creds.marketplaceId);
  return {
    ...resultado,
    ourPriceAnteriorCentavos: precos.ourPriceCentavos,
    promocaoAtivaCentavos: precos.promocaoAtivaCentavos,
  };
}
