import crypto from "node:crypto";
import { expect, test, type BrowserContext } from "@playwright/test";

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

const TOP = [
  {
    sku: "MFS-0036", produtoId: "p1", nome: "Kit 3 Potes Marinex Facilita Vap 1 Litro", imagemUrl: null,
    amazonImagemUrl: null, asin: null, precoMedioCentavos: 7866, custoUnitarioCentavos: 4758,
    unidades: 65, faturadoCentavos: 511314, representatividadePercentual: 13.1, lucroCentavos: 63337,
    impostoSimplesCentavos: 0, margemPercentual: 12.4, custoAdsCentavos: 25566,
    lucroPosAdsCentavos: 37771, mpaPercentual: 7.4,
  },
];

async function logar(context: BrowserContext, ocultas: string[] = [], role = "ADMIN") {
  await context.addCookies([
    {
      name: "erp_session",
      value: signSession({
        uid: "user-e2e", email: "e2e@atlas.test", nome: "E2E Admin", role,
        exp: Math.floor(Date.now() / 1000) + 3600, v: 0, empresaId: "empresa-e2e",
      }),
      url: baseURL,
      sameSite: "Lax",
      httpOnly: true,
    },
  ]);
  await context.route("**/api/menu/preferencias", (r) => r.fulfill({ json: { ocultas } }));
  await context.route("**/api/auth/me", (r) =>
    r.fulfill({ json: { usuario: { id: "user-e2e", nome: "E2E Admin", email: "e2e@atlas.test", role, avatarUrl: null } } }),
  );
  await context.route("**/api/notificacoes/contar", (r) => r.fulfill({ json: { total: 0 } }));
  await context.route("**/api/push/config", (r) => r.fulfill({ json: { enabled: false, publicKey: null, loja: "Loja E2E" } }));
  await context.route("**/api/push/dispositivos", (r) => r.fulfill({ json: { dispositivos: [] } }));
  await context.route("**/api/dashboard-ecommerce/kpis**", (r) => r.fulfill({ json: KPIS }));
  await context.route("**/api/dashboard-ecommerce/timeline**", (r) => r.fulfill({ json: [] }));
  await context.route("**/api/dashboard-ecommerce/top-produtos**", (r) => r.fulfill({ json: TOP }));
}

test("manifest e service worker abrem sem login", async ({ request }) => {
  const manifest = await request.get("/manifest.webmanifest");
  expect(manifest.status()).toBe(200);
  expect((await manifest.json()).name).toBe("Atlas Seller");
  const sw = await request.get("/sw.js");
  expect(sw.status()).toBe(200);
  expect(sw.headers()["content-type"]).toContain("javascript");
});

test("barra inferior e folha Mais respeitam o menu do usuário", async ({ context, page }) => {
  await logar(context, ["/agenda"]);
  await page.goto("/dashboard-ecommerce");
  const nav = page.getByRole("navigation", { name: "Navegação principal" });
  await expect(nav.getByRole("link", { name: "Início" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Vendas" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Produtos" })).toBeVisible();
  await nav.getByRole("button", { name: "Mais" }).click();
  const folha = page.getByRole("dialog");
  await expect(folha.getByText("Personalizar menu")).toBeVisible();
  await expect(folha.getByRole("link", { name: "Caixa", exact: true })).toBeVisible();
  await expect(folha.getByRole("link", { name: "Agenda" })).toHaveCount(0);
});

test("operador abre Configurações e o atalho da folha Mais troca a aba", async ({ context, page }) => {
  await logar(context, [], "OPERADOR");
  await page.goto("/configuracoes?tab=menu");
  await expect(page.getByRole("tab", { name: "Menu" })).toHaveAttribute("aria-selected", "true");
  // Já em Configurações: o link muda só o ?tab= (navegação no cliente, mesma página).
  await page.getByRole("navigation", { name: "Navegação principal" }).getByRole("button", { name: "Mais" }).click();
  await page.getByRole("dialog").getByRole("link", { name: /Notificações deste celular/ }).click();
  await expect(page).toHaveURL(/tab=notificacoes/);
  await expect(page.getByRole("tab", { name: "Notificações" })).toHaveAttribute("aria-selected", "true");
});

test("dashboard no celular: 6 KPIs, MPA e Top 15, sem gráfico nem scroll lateral", async ({ context, page }) => {
  await logar(context);
  await page.goto("/dashboard-ecommerce");
  const mobile = page.getByTestId("dashboard-mobile");
  await expect(mobile.getByText("Gasto em anúncios", { exact: true })).toBeVisible();
  await expect(mobile.getByText("MPA · margem pós-anúncios")).toBeVisible();
  await expect(mobile.getByRole("heading", { name: "Top 15 produtos" })).toBeVisible();
  await expect(mobile.getByRole("link", { name: /Kit 3 Potes Marinex/ })).toBeVisible();
  await expect(page.getByText("Resumo de receitas")).toBeHidden();
  const [largura, viewport] = await page.evaluate(() => [
    document.documentElement.scrollWidth,
    window.innerWidth,
  ]);
  expect(largura).toBeLessThanOrEqual(viewport);
});
