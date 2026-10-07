import crypto from "node:crypto";
import type { BrowserContext } from "@playwright/test";

// Fixtures compartilhadas dos e2e de "duas lojas juntas" (celular e computador).

const sessionSecret =
  process.env.SESSION_SECRET ?? "playwright-session-secret-0123456789abcdef0123456789abcdef";
export const baseURL = `http://localhost:${process.env.PLAYWRIGHT_PORT ?? 3107}`;

function base64Url(value: Buffer) {
  return value.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function signSession(payload: Record<string, unknown>) {
  const json = JSON.stringify(payload);
  const assinatura = crypto.createHmac("sha256", sessionSecret).update(json).digest();
  return `${base64Url(Buffer.from(json))}.${base64Url(assinatura)}`;
}

export const LOJAS_COM_VINCULO = {
  atual: { empresaId: "mundofs", nome: "MundoFS", email: "mfs@atlas.test", papel: "ADMIN" },
  vinculadas: [
    {
      empresaId: "udn",
      nome: "UDN",
      email: "udn@atlas.test",
      papel: "ADMIN",
      vinculoId: "v1",
      vinculadaEm: "2026-10-07T12:00:00.000Z",
    },
  ],
};

export const LOJAS_SEM_VINCULO = { ...LOJAS_COM_VINCULO, vinculadas: [] };

const DELTA = {
  faturamento: 26, frete: null, faturamentoComFrete: null, faturamentoReembolsado: null,
  faturamentoComReembolsados: null, liquidoMarketplace: null, lucroBruto: 13, margem: -1.7,
  numeroVendas: 30.9, unidades: null, ticketMedio: null, roi: -3.3, valorAds: -0.5, tacos: null,
  lucroPosAds: 16.3, roiPosAds: null,
};

function kpis(fat: number, lucro: number, vendas: number) {
  return {
    faturamentoCentavos: fat, freteCentavos: 0, faturamentoComFreteCentavos: fat,
    faturamentoReembolsadoCentavos: 0, faturamentoComReembolsadosCentavos: fat,
    liquidoMarketplaceCentavos: Math.round(fat * 0.7), impostoSimplesCentavos: 0,
    impostoSimplesAliquotaBps: 600, impostoSimplesAtivo: true, lucroBrutoCentavos: lucro,
    margemPercentual: (lucro / fat) * 100, numeroVendas: vendas, unidades: vendas,
    ticketMedioCentavos: Math.round(fat / vendas), roiPercentual: 25.2, valorAdsCentavos: 98992,
    tacosPercentual: 2.5, lucroPosAdsCentavos: lucro - 98992, mpaPercentual: 12,
    contasFixasCentavos: 0, mpaPosContasFixasPercentual: null, roiPosAdsPercentual: null,
    trafficSessions: 0, trafficPageViews: 0, trafficUnitsOrdered: 0, trafficRevenueOrderedCentavos: 0,
    trafficConversionPercent: null, trafficBuyBoxPercent: null, vendasSemCusto: 0, delta: DELTA,
  };
}

export const KPIS_LOJA = kpis(3217226, 458150, 420);
export const KPIS_TODAS = {
  ...kpis(3985770, 577781, 542),
  porLoja: [
    {
      empresaId: "mundofs", nome: "MundoFS", atual: true, faturamentoCentavos: 3217226,
      participacaoPercentual: 80.72, lucroBrutoCentavos: 458150, margemPercentual: 14.2,
      numeroVendas: 420, mpaPercentual: 11.2, vendasSemCusto: 0,
    },
    {
      empresaId: "udn", nome: "UDN", atual: false, faturamentoCentavos: 768544,
      participacaoPercentual: 19.28, lucroBrutoCentavos: 119631, margemPercentual: 15.6,
      numeroVendas: 122, mpaPercentual: 15.6, vendasSemCusto: 0,
    },
  ],
};

function produto(sku: string, nome: string, fat: number, loja?: { empresaId: string; nome: string; atual: boolean }) {
  return {
    sku, produtoId: `p-${sku}`, nome, imagemUrl: null, amazonImagemUrl: null, asin: null,
    precoMedioCentavos: 7863, custoUnitarioCentavos: 4758, unidades: 52, faturadoCentavos: fat,
    representatividadePercentual: 10.3, lucroCentavos: 51180, impostoSimplesCentavos: 0,
    margemPercentual: 12.5, custoAdsCentavos: 0, lucroPosAdsCentavos: 51180, mpaPercentual: 12.5,
    ...(loja ? { loja } : {}),
  };
}

export const TOP_LOJA = [produto("MFS-0036", "Kit 3 Potes Marinex Facilita Vap 1 Litro", 408857)];
export const TOP_TODAS = [
  produto("MFS-0036", "Kit 3 Potes Marinex Facilita Vap 1 Litro", 408857, {
    empresaId: "mundofs", nome: "MundoFS", atual: true,
  }),
  produto("UDN-0002", "Kit com 6 Tigelas Marinex Americano Com Tampa 150ml", 275557, {
    empresaId: "udn", nome: "UDN", atual: false,
  }),
];

export async function logarComLojas(
  context: BrowserContext,
  lojas: typeof LOJAS_COM_VINCULO = LOJAS_COM_VINCULO,
) {
  await context.addCookies([
    {
      name: "erp_session",
      value: signSession({
        uid: "user-e2e", email: "mfs@atlas.test", nome: "Heitor", role: "ADMIN",
        exp: Math.floor(Date.now() / 1000) + 3600, v: 0, empresaId: "mundofs",
      }),
      url: baseURL,
      sameSite: "Lax",
      httpOnly: true,
    },
  ]);
  await context.route("**/api/menu/preferencias", (r) => r.fulfill({ json: { ocultas: [] } }));
  await context.route("**/api/auth/me", (r) =>
    r.fulfill({ json: { usuario: { id: "user-e2e", nome: "Heitor", email: "mfs@atlas.test", role: "ADMIN", avatarUrl: null } } }),
  );
  await context.route("**/api/notificacoes/contar", (r) => r.fulfill({ json: { total: 0 } }));
  await context.route("**/api/push/config", (r) => r.fulfill({ json: { enabled: false, publicKey: null, loja: "MundoFS" } }));
  await context.route("**/api/push/dispositivos", (r) => r.fulfill({ json: { dispositivos: [] } }));
  await context.route(/\/api\/lojas$/, (r) => r.fulfill({ json: lojas }));
  await context.route("**/api/dashboard-ecommerce/kpis**", (r) =>
    r.fulfill({ json: r.request().url().includes("lojas=todas") ? KPIS_TODAS : KPIS_LOJA }),
  );
  await context.route("**/api/dashboard-ecommerce/timeline**", (r) => r.fulfill({ json: [] }));
  await context.route("**/api/dashboard-ecommerce/top-produtos**", (r) =>
    r.fulfill({ json: r.request().url().includes("lojas=todas") ? TOP_TODAS : TOP_LOJA }),
  );
}
