import crypto from "node:crypto";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";

const sessionSecret =
  process.env.SESSION_SECRET ?? "playwright-session-secret-0123456789abcdef0123456789abcdef";
const baseURL = `http://localhost:${process.env.PLAYWRIGHT_PORT ?? 3107}`;

function base64Url(value: Buffer) {
  return value.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function signSession(payload: Record<string, unknown>) {
  const json = JSON.stringify(payload);
  const assinatura = crypto.createHmac("sha256", sessionSecret).update(json).digest();
  return `${base64Url(Buffer.from(json))}.${base64Url(assinatura)}`;
}

const KPIS = {
  faturamentoCentavos: 3894017, freteCentavos: 0, faturamentoComFreteCentavos: 3894017,
  faturamentoReembolsadoCentavos: 0, faturamentoComReembolsadosCentavos: 3894017,
  liquidoMarketplaceCentavos: 2790514, impostoSimplesCentavos: 0, impostoSimplesAliquotaBps: 600,
  impostoSimplesAtivo: true, lucroBrutoCentavos: 529626, margemPercentual: 13.6, numeroVendas: 431,
  unidades: 538, ticketMedioCentavos: 9034, roiPercentual: 21.4, valorAdsCentavos: 146832,
  tacosPercentual: 3.8, lucroPosAdsCentavos: 382794, mpaPercentual: 9.8, contasFixasCentavos: 0,
  mpaPosContasFixasPercentual: null, roiPosAdsPercentual: 15.5, trafficSessions: 0,
  trafficPageViews: 0, trafficUnitsOrdered: 0, trafficRevenueOrderedCentavos: 0,
  trafficConversionPercent: null, trafficBuyBoxPercent: null, vendasSemCusto: 0,
  delta: {
    faturamento: 12.4, frete: null, faturamentoComFrete: null, faturamentoReembolsado: null,
    faturamentoComReembolsados: null, liquidoMarketplace: null, lucroBruto: 8.1, margem: -0.6,
    numeroVendas: 9, unidades: null, ticketMedio: null, roi: 1.8, valorAds: 4.2, tacos: null,
    lucroPosAds: -2, roiPosAds: null,
  },
};

const TOTAIS_VENDAS = {
  receitaBrutaCentavos: 1234567890,
  unidadesVendidas: 9876543,
  quantidadePedidos: 1234567,
  ticketMedioCentavos: 1234567890,
  ultimaImportacao: { createdAt: "2026-10-06T15:00:00.000Z", tipo: "ORDERS", mensagem: null },
};

const REEMBOLSOS = {
  totais: {
    produtosAfetados: 1234567,
    pedidosVendidos: 98765432,
    pedidosReembolsados: 1234567,
    taxaReembolso: 12345.6,
    unidadesVendidas: 98765432,
    unidadesReembolsadas: 9876543,
    valorVendidoCentavos: 98765432100,
    valorReembolsadoCentavos: 1234567890,
  },
  produtos: [
    {
      sku: "MFS-0036", nome: "Kit 3 Potes Marinex Facilita Vap 1 Litro", pedidosVendidos: 98765432,
      pedidosReembolsados: 1234567, taxaReembolso: 12345.6, unidadesVendidas: 98765432,
      unidadesReembolsadas: 9876543, valorVendidoCentavos: 98765432100,
      valorReembolsadoCentavos: 1234567890,
    },
  ],
  pedidos: [
    {
      id: "r1", amazonOrderId: "702-1234567-1234567", sku: "MFS-0036", asin: null,
      titulo: "Kit 3 Potes Marinex Facilita Vap 1 Litro", quantidade: 2,
      valorReembolsadoCentavos: 1234567890, taxasReembolsadasCentavos: 0,
      dataReembolso: "2026-10-05T12:00:00.000Z", liquidacaoId: null, statusFinanceiro: "REEMBOLSADO",
    },
  ],
  totalPedidosReembolsados: 1,
  porPagina: 50,
};

async function logar(context: BrowserContext, kpis: Record<string, unknown> = KPIS) {
  await context.addCookies([
    {
      name: "erp_session",
      value: signSession({
        uid: "user-e2e", email: "e2e@atlas.test", nome: "E2E Admin", role: "ADMIN",
        exp: Math.floor(Date.now() / 1000) + 3600, v: 0, empresaId: "empresa-e2e",
      }),
      url: baseURL,
      sameSite: "Lax",
      httpOnly: true,
    },
  ]);
  await context.route("**/api/menu/preferencias", (r) => r.fulfill({ json: { ocultas: [] } }));
  await context.route("**/api/auth/me", (r) =>
    r.fulfill({ json: { usuario: { id: "user-e2e", nome: "E2E Admin", email: "e2e@atlas.test", role: "ADMIN", avatarUrl: null } } }),
  );
  await context.route("**/api/notificacoes/contar", (r) => r.fulfill({ json: { total: 0 } }));
  await context.route("**/api/push/config", (r) => r.fulfill({ json: { enabled: false, publicKey: null, loja: "Loja E2E" } }));
  await context.route("**/api/push/dispositivos", (r) => r.fulfill({ json: { dispositivos: [] } }));
  await context.route("**/api/dashboard-ecommerce/kpis**", (r) => r.fulfill({ json: kpis }));
  await context.route("**/api/dashboard-ecommerce/timeline**", (r) => r.fulfill({ json: [] }));
  await context.route("**/api/dashboard-ecommerce/top-produtos**", (r) => r.fulfill({ json: [] }));
  await context.route(/\/api\/vendas(\?|$)/, (r) =>
    r.fulfill({ json: { vendas: [], total: 0, porPagina: 50 } }),
  );
  await context.route(/\/api\/vendas\/totais(\?|$)/, (r) => r.fulfill({ json: TOTAIS_VENDAS }));
  await context.route(/\/api\/vendas\/reembolsos(\?|$)/, (r) => r.fulfill({ json: REEMBOLSOS }));
}

/** Nem a página nem a área de conteúdo (main rola sozinho) têm scroll lateral. */
async function semScrollLateral(page: Page) {
  const medidas = await page.evaluate(() => {
    const main = document.querySelector("main");
    return {
      documento: document.documentElement.scrollWidth,
      viewport: window.innerWidth,
      mainScroll: main?.scrollWidth ?? 0,
      mainClient: main?.clientWidth ?? 0,
    };
  });
  expect(medidas.documento).toBeLessThanOrEqual(medidas.viewport);
  expect(medidas.mainScroll).toBeLessThanOrEqual(medidas.mainClient);
}

test("dashboard no celular não mostra o aviso de taxa Amazon estimada", async ({ context, page }) => {
  await logar(context, {
    ...KPIS,
    vendasSemCusto: 3,
    vendasComTaxaEstimada: 14,
    categoriasTaxaEstimada: [
      { slug: "casa", label: "Casa", regra: "12%", vendas: 14 },
    ],
  });
  await page.goto("/dashboard-ecommerce");
  // KPIs carregados: o aviso âmbar de custo continua (não foi mexido).
  await expect(page.getByText("sem custo cadastrado")).toBeVisible();
  await expect(
    page.getByTestId("dashboard-mobile").getByText("Gasto em anúncios", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText(/com taxa Amazon/)).toHaveCount(0);
});

test("vendas no celular: sem os cards que repetem o dashboard", async ({ context, page }) => {
  await logar(context);
  await page.goto("/vendas");
  // totais continuam carregando: a descrição do cabeçalho usa a última importação.
  await expect(page.getByText(/Última sincronização:/)).toBeVisible();
  await expect(page.getByRole("tab", { name: "Reembolsados" })).toBeVisible();
  await expect(page.getByText("Receita Bruta", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Ticket Médio", { exact: true })).toHaveCount(0);
  await semScrollLateral(page);
});

test("vendas > Reembolsados no celular: valores grandes dos cards não ficam cortados", async ({ context, page }) => {
  await logar(context);
  await page.goto("/vendas");
  await page.getByRole("tab", { name: "Reembolsados" }).click();

  const cards: Array<{ label: string; valor: RegExp }> = [
    { label: "Taxa de Reembolso", valor: /12\.345,6%/ },
    { label: "Valor Reembolsado", valor: /12\.345\.678,90/ },
    { label: "Produtos Afetados", valor: /1234567/ },
    { label: "Unidades", valor: /9876543/ },
  ];
  const painel = page.getByRole("tabpanel");
  for (const { label, valor } of cards) {
    const rotulo = painel.getByText(label, { exact: true }).first();
    await expect(rotulo).toBeVisible();
    // O valor é o parágrafo logo abaixo do rótulo dentro do card.
    const elValor = rotulo.locator("xpath=following-sibling::p[1]");
    await expect(elValor).toHaveText(valor);
    const { scroll, client } = await elValor.evaluate((el) => ({
      scroll: el.scrollWidth,
      client: el.clientWidth,
    }));
    expect(scroll, `valor de "${label}" cortado`).toBeLessThanOrEqual(client);
  }
  await semScrollLateral(page);
});
