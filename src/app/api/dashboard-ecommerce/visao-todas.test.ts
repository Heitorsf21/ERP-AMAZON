import { beforeEach, describe, expect, it, vi } from "vitest";
import { getEmpresaId } from "@/lib/tenant-context";

const sessao = vi.hoisted(() => ({
  atual: { uid: "u-mfs", email: "mfs@loja.test", nome: "H", role: "ADMIN", exp: 0, empresaId: "mundofs" },
}));
vi.mock("@/lib/auth", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/auth")>();
  return {
    ...real,
    requireSession: vi.fn(async () => sessao.atual),
    requireRole: vi.fn(async () => sessao.atual),
  };
});

const lojas = vi.hoisted(() => ({ listarLojas: vi.fn() }));
vi.mock("@/modules/lojas/vinculos", () => lojas);

// Cada chamada registra em qual tenant rodou e devolve números por loja.
const chamadas = vi.hoisted(() => [] as { fn: string; empresa: string | null }[]);
const FAT: Record<string, number> = { mundofs: 3_217_226, udn: 768_544 };

vi.mock("@/modules/dashboard-ecommerce/service", () => ({
  dashboardEcommerceService: {
    obterKpis: vi.fn(async () => {
      const empresa = getEmpresaId();
      chamadas.push({ fn: "kpis", empresa });
      const fat = FAT[empresa ?? ""] ?? 0;
      return {
        periodo: { de: new Date(0), ate: new Date(0) },
        faturamentoCentavos: fat,
        freteCentavos: 0,
        faturamentoComFreteCentavos: fat,
        faturamentoReembolsadoCentavos: 0,
        faturamentoComReembolsadosCentavos: fat,
        liquidoMarketplaceCentavos: fat,
        impostoSimplesCentavos: 0,
        impostoSimplesAliquotaBps: 600,
        impostoSimplesAtivo: true,
        lucroBrutoCentavos: Math.round(fat / 10),
        margemPercentual: 10,
        numeroVendas: empresa === "udn" ? 122 : 420,
        unidades: 1,
        ticketMedioCentavos: 1,
        roiPercentual: 10,
        valorAdsCentavos: 0,
        tacosPercentual: 0,
        lucroPosAdsCentavos: Math.round(fat / 10),
        mpaPercentual: 10,
        contasFixasCentavos: 0,
        mpaPosContasFixasPercentual: 10,
        roiPosAdsPercentual: 10,
        trafficSessions: 0,
        trafficPageViews: 0,
        trafficUnitsOrdered: 0,
        trafficRevenueOrderedCentavos: 0,
        trafficConversionPercent: null,
        trafficBuyBoxPercent: null,
        valorAdsFonte: "VAZIO",
        valorAdsParcial: false,
        custoTotalCentavos: Math.round(fat / 2),
        vendasSemCusto: 0,
        vendasComTaxaEstimada: 0,
        categoriasTaxaEstimada: [],
        origemTaxas: "real",
      };
    }),
    obterTimeline: vi.fn(async () => {
      const empresa = getEmpresaId();
      chamadas.push({ fn: "timeline", empresa });
      return [
        {
          data: "2026-10-01",
          faturamentoCentavos: FAT[empresa ?? ""] ?? 0,
          liquidoMarketplaceCentavos: 0,
          impostoSimplesCentavos: 0,
          lucroBrutoCentavos: 0,
          lucroPosAdsCentavos: 0,
        },
      ];
    }),
    obterTopProdutosComTotal: vi.fn(async () => {
      const empresa = getEmpresaId();
      chamadas.push({ fn: "top", empresa });
      return {
        totalFaturamentoCentavos: FAT[empresa ?? ""] ?? 0,
        produtos: [
          {
            sku: empresa === "udn" ? "UDN-0002" : "MFS-0036",
            produtoId: `p-${empresa}`,
            nome: "Produto",
            imagemUrl: "/local.png",
            amazonImagemUrl: null,
            asin: null,
            precoMedioCentavos: 0,
            custoUnitarioCentavos: 0,
            unidades: 1,
            faturadoCentavos: empresa === "udn" ? 275_557 : 408_857,
            representatividadePercentual: 0,
            lucroCentavos: 0,
            impostoSimplesCentavos: 0,
            margemPercentual: 0,
            custoAdsCentavos: 0,
            lucroPosAdsCentavos: 0,
            mpaPercentual: 0,
          },
        ],
      };
    }),
  },
}));

import { GET as GET_KPIS } from "./kpis/route";
import { GET as GET_TIMELINE } from "./timeline/route";
import { GET as GET_TOP } from "./top-produtos/route";

const COM_VINCULO = {
  atual: { empresaId: "mundofs", nome: "MundoFS", email: "mfs@loja.test", papel: "ADMIN" },
  vinculadas: [
    { empresaId: "udn", nome: "UDN", email: "udn@loja.test", papel: "ADMIN", vinculoId: "v1", vinculadaEm: "" },
  ],
};

const url = (rota: string, qs = "") =>
  new Request(`http://localhost/api/dashboard-ecommerce/${rota}?preset=ULTIMOS_30_DIAS${qs}`);

beforeEach(() => {
  chamadas.length = 0;
  vi.clearAllMocks();
  lojas.listarLojas.mockResolvedValue(COM_VINCULO);
});

describe("dashboard com ?lojas=todas", () => {
  it("sem o parâmetro: só a loja da sessão, como hoje", async () => {
    const res = await GET_KPIS(url("kpis"));
    const body = await res.json();
    expect(chamadas.map((c) => c.empresa)).toEqual(["mundofs", "mundofs"]);
    expect(body.faturamentoCentavos).toBe(3_217_226);
    expect(body.porLoja).toBeUndefined();
    expect(lojas.listarLojas).not.toHaveBeenCalled();
  });

  it("KPIs: cada loja calculada no próprio tenant, atual e anterior, e somadas", async () => {
    const res = await GET_KPIS(url("kpis", "&lojas=todas"));
    const body = await res.json();
    expect(chamadas.filter((c) => c.empresa === "mundofs")).toHaveLength(2);
    expect(chamadas.filter((c) => c.empresa === "udn")).toHaveLength(2);
    expect(body.faturamentoCentavos).toBe(3_985_770);
    expect(body.numeroVendas).toBe(542);
    expect(body.porLoja.map((l: { nome: string }) => l.nome)).toEqual(["MundoFS", "UDN"]);
    expect(body.porLoja[0].atual).toBe(true);
    expect(body.delta.faturamento).toBe(0);
  });

  it("sem vínculo, ?lojas=todas responde como a loja sozinha", async () => {
    lojas.listarLojas.mockResolvedValue({ ...COM_VINCULO, vinculadas: [] });
    const body = await (await GET_KPIS(url("kpis", "&lojas=todas"))).json();
    expect(chamadas.map((c) => c.empresa)).toEqual(["mundofs", "mundofs"]);
    expect(body.porLoja).toBeUndefined();
  });

  it("cookie de uma loja e conta de outra (inconsistente): não consolida", async () => {
    lojas.listarLojas.mockResolvedValue({ ...COM_VINCULO, atual: { ...COM_VINCULO.atual, empresaId: "udn" } });
    const body = await (await GET_KPIS(url("kpis", "&lojas=todas"))).json();
    expect(body.porLoja).toBeUndefined();
    expect(chamadas.every((c) => c.empresa === "mundofs")).toBe(true);
  });

  it("timeline somada por dia", async () => {
    const body = await (await GET_TIMELINE(url("timeline", "&lojas=todas"))).json();
    expect(body).toEqual([expect.objectContaining({ data: "2026-10-01", faturamentoCentavos: 3_985_770 })]);
  });

  it("top produtos das lojas, com a loja de cada item", async () => {
    const body = await (await GET_TOP(url("top-produtos", "&lojas=todas&limit=15"))).json();
    expect(body.map((p: { sku: string }) => p.sku)).toEqual(["MFS-0036", "UDN-0002"]);
    expect(body[1].loja).toEqual({ empresaId: "udn", nome: "UDN", atual: false });
    expect(body[1].imagemUrl).toBeNull();
  });

  it("top produtos sem o parâmetro: lista de hoje, sem loja", async () => {
    const body = await (await GET_TOP(url("top-produtos", "&limit=15"))).json();
    expect(body).toHaveLength(1);
    expect(body[0].loja).toBeUndefined();
  });
});
