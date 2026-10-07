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
