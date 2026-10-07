import { beforeEach, describe, expect, it, vi } from "vitest";

const { spMock, serviceMock } = vi.hoisted(() => ({
  spMock: { getListingsItem: vi.fn(), spApiRequest: vi.fn() },
  serviceMock: { getCredentialsOrThrow: vi.fn(), resolverSellerIdDoTenant: vi.fn() },
}));
vi.mock("@/lib/amazon-sp-api", () => spMock);
vi.mock("@/modules/amazon/service", () => serviceMock);

import {
  ehErroPermissaoListing,
  enviarPrecoAmazon,
  lerPrecosDaOferta,
  montarPatchPreco,
  PermissaoListingNegadaError,
  PrecoRejeitadoError,
  precisaConfirmarVariacao,
} from "./listings-preco";

const CREDS = { marketplaceId: "A2Q3Y263D00KWC" };

beforeEach(() => {
  vi.clearAllMocks();
  serviceMock.getCredentialsOrThrow.mockResolvedValue(CREDS);
  serviceMock.resolverSellerIdDoTenant.mockResolvedValue("SELLER1");
  spMock.getListingsItem.mockResolvedValue({
    summaries: [{ marketplaceId: "A2Q3Y263D00KWC", productType: "FOOD_STORAGE_CONTAINER" }],
  });
  spMock.spApiRequest.mockResolvedValue({ status: "ACCEPTED", submissionId: "s1" });
});

describe("trava de variação", () => {
  it("R$ 77,00 → R$ 7,70 (dedo gordo) exige confirmação", () => {
    expect(precisaConfirmarVariacao(7700, 770)).toBe(true);
  });
  it("ajuste pequeno não pede confirmação; sem preço atual também não", () => {
    expect(precisaConfirmarVariacao(7700, 7990)).toBe(false);
    expect(precisaConfirmarVariacao(7700, 10010)).toBe(false); // exatamente 30%
    expect(precisaConfirmarVariacao(null, 1)).toBe(false);
  });
});

describe("montarPatchPreco", () => {
  it("troca o our_price do purchasable_offer em reais, no marketplace do Brasil", () => {
    expect(montarPatchPreco({ productType: "X", marketplaceId: "A2Q3Y263D00KWC", precoCentavos: 7700 })).toEqual({
      productType: "X",
      patches: [
        {
          op: "replace",
          path: "/attributes/purchasable_offer",
          value: [
            {
              marketplace_id: "A2Q3Y263D00KWC",
              currency: "BRL",
              our_price: [{ schedule: [{ value_with_tax: 77 }] }],
            },
          ],
        },
      ],
    });
  });
});

describe("enviarPrecoAmazon", () => {
  it("validação sem efeito usa VALIDATION_PREVIEW e o productType do anúncio", async () => {
    spMock.spApiRequest.mockResolvedValue({ status: "VALID" });
    await enviarPrecoAmazon({ sku: "MFS-0036", precoCentavos: 7700, somenteValidar: true });
    expect(spMock.spApiRequest).toHaveBeenCalledTimes(1);
    const [, path, opts] = spMock.spApiRequest.mock.calls[0] ?? [];
    expect(path).toBe("/listings/2021-08-01/items/SELLER1/MFS-0036");
    expect(opts.method).toBe("PATCH");
    expect(opts.params).toMatchObject({ marketplaceIds: "A2Q3Y263D00KWC", mode: "VALIDATION_PREVIEW" });
    expect(opts.body.productType).toBe("FOOD_STORAGE_CONTAINER");
    expect(opts.operation).toBe("LISTINGS_PATCH_ITEM");
  });

  it("403 vira PermissaoListingNegadaError", async () => {
    spMock.spApiRequest.mockRejectedValue(new Error("SP-API PATCH /listings/2021-08-01/items/SELLER1/MFS-0036 -> 403: {\"errors\":[]}"));
    await expect(enviarPrecoAmazon({ sku: "MFS-0036", precoCentavos: 7700, somenteValidar: false })).rejects.toBeInstanceOf(PermissaoListingNegadaError);
  });

  it("403 já na leitura do anúncio também vira PermissaoListingNegadaError", async () => {
    spMock.getListingsItem.mockRejectedValue(new Error("SP-API GET /listings/2021-08-01/items/SELLER1/MFS-0036 -> 403: {}"));
    await expect(enviarPrecoAmazon({ sku: "MFS-0036", precoCentavos: 7700, somenteValidar: true })).rejects.toBeInstanceOf(PermissaoListingNegadaError);
    expect(spMock.spApiRequest).not.toHaveBeenCalled();
  });

  it("INVALID devolve a mensagem da Amazon", async () => {
    spMock.spApiRequest.mockResolvedValue({ status: "INVALID", issues: [{ severity: "ERROR", message: "Preço abaixo do mínimo permitido." }] });
    await expect(enviarPrecoAmazon({ sku: "MFS-0036", precoCentavos: 100, somenteValidar: false })).rejects.toThrow(PrecoRejeitadoError);
  });

  it("ehErroPermissaoListing só reconhece 403", () => {
    expect(ehErroPermissaoListing(new Error("… -> 403: {}"))).toBe(true);
    expect(ehErroPermissaoListing(new Error("… -> 400: {}"))).toBe(false);
  });
});

describe("preserva o resto da oferta (promoção, travas mín./máx., B2B)", () => {
  const OFERTA_B2C = {
    marketplace_id: "A2Q3Y263D00KWC",
    currency: "BRL",
    audience: "ALL",
    our_price: [{ schedule: [{ value_with_tax: 99.9 }] }],
    discounted_price: [
      { schedule: [{ value_with_tax: 79.9, start_at: "2026-01-01T00:00:00Z", end_at: "2099-01-01T00:00:00Z" }] },
    ],
    minimum_seller_allowed_price: [{ schedule: [{ value_with_tax: 60 }] }],
    maximum_seller_allowed_price: [{ schedule: [{ value_with_tax: 150 }] }],
  };
  const OFERTA_B2B = {
    marketplace_id: "A2Q3Y263D00KWC",
    currency: "BRL",
    audience: "B2B",
    our_price: [{ schedule: [{ value_with_tax: 90 }] }],
  };

  it("montarPatchPreco troca só o our_price da oferta ALL e mantém o resto", () => {
    const patch = montarPatchPreco({
      productType: "X",
      marketplaceId: "A2Q3Y263D00KWC",
      precoCentavos: 8490,
      ofertasAtuais: [OFERTA_B2C, OFERTA_B2B],
    });
    expect(patch.patches[0]?.value).toEqual([
      { ...OFERTA_B2C, our_price: [{ schedule: [{ value_with_tax: 84.9 }] }] },
      OFERTA_B2B,
    ]);
  });

  it("enviarPrecoAmazon lê os atributos e reenvia a oferta inteira (sem apagar a promoção)", async () => {
    spMock.getListingsItem.mockResolvedValue({
      summaries: [{ marketplaceId: "A2Q3Y263D00KWC", productType: "FOOD_STORAGE_CONTAINER" }],
      attributes: { purchasable_offer: [OFERTA_B2C, OFERTA_B2B] },
    });
    spMock.spApiRequest.mockResolvedValue({ status: "ACCEPTED" });
    const r = await enviarPrecoAmazon({ sku: "MFS-0036", precoCentavos: 8490, somenteValidar: false });
    expect(spMock.getListingsItem.mock.calls[0]?.[3]).toEqual(["summaries", "attributes"]);
    const ultimo = spMock.spApiRequest.mock.calls.at(-1) ?? [];
    const oferta = ultimo[2].body.patches[0].value[0];
    expect(oferta.discounted_price).toEqual(OFERTA_B2C.discounted_price);
    expect(oferta.minimum_seller_allowed_price).toEqual(OFERTA_B2C.minimum_seller_allowed_price);
    expect(oferta.maximum_seller_allowed_price).toEqual(OFERTA_B2C.maximum_seller_allowed_price);
    expect(oferta.our_price).toEqual([{ schedule: [{ value_with_tax: 84.9 }] }]);
    expect(ultimo[2].body.patches[0].value[1]).toEqual(OFERTA_B2B);
    expect(r.ourPriceAnteriorCentavos).toBe(9990);
    expect(r.promocaoAtivaCentavos).toBe(7990);
  });

  it("aplicação real valida antes com VALIDATION_PREVIEW e não aplica se a Amazon recusar", async () => {
    spMock.spApiRequest.mockResolvedValueOnce({
      status: "INVALID",
      issues: [{ severity: "ERROR", message: "Preço abaixo do mínimo." }],
    });
    await expect(
      enviarPrecoAmazon({ sku: "MFS-0036", precoCentavos: 100, somenteValidar: false }),
    ).rejects.toThrow(PrecoRejeitadoError);
    expect(spMock.spApiRequest).toHaveBeenCalledTimes(1);
    expect(spMock.spApiRequest.mock.calls[0]?.[2].params.mode).toBe("VALIDATION_PREVIEW");
  });

  it("aplicação real: preview VALID e depois o PATCH sem mode", async () => {
    spMock.spApiRequest.mockResolvedValueOnce({ status: "VALID" }).mockResolvedValueOnce({ status: "ACCEPTED", submissionId: "s9" });
    const r = await enviarPrecoAmazon({ sku: "MFS-0036", precoCentavos: 7700, somenteValidar: false });
    expect(spMock.spApiRequest).toHaveBeenCalledTimes(2);
    expect(spMock.spApiRequest.mock.calls[1]?.[2].params.mode).toBeUndefined();
    expect(r.submissionId).toBe("s9");
  });

  it("lerPrecosDaOferta separa our_price da promoção vigente", () => {
    expect(lerPrecosDaOferta([OFERTA_B2C, OFERTA_B2B], "A2Q3Y263D00KWC", new Date("2026-10-06T12:00:00Z"))).toEqual({
      ourPriceCentavos: 9990,
      promocaoAtivaCentavos: 7990,
    });
    expect(lerPrecosDaOferta(undefined, "A2Q3Y263D00KWC")).toEqual({ ourPriceCentavos: null, promocaoAtivaCentavos: null });
  });
});
