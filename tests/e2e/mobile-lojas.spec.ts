import { expect, test, type Page } from "@playwright/test";
import { LOJAS_SEM_VINCULO, logarComLojas } from "./lojas-fixtures";

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

test.beforeEach(async ({ page }) => {
  // Cada teste começa na visão da loja (a escolha fica salva no aparelho).
  await page.addInitScript(() => {
    try {
      if (!sessionStorage.getItem("e2e-iniciado")) {
        localStorage.removeItem("atlas:visao-inicio");
        sessionStorage.setItem("e2e-iniciado", "1");
      }
    } catch {
      // sem armazenamento
    }
  });
});

test("topo mostra a loja aberta e abre a folha Trocar de loja", async ({ context, page }) => {
  await logarComLojas(context);
  await page.goto("/dashboard-ecommerce");
  const seletor = page.getByRole("button", { name: /Trocar de loja\. Loja aberta: MundoFS/ });
  await expect(seletor).toBeVisible();
  await seletor.click();
  const folha = page.getByRole("dialog", { name: "Trocar de loja" });
  await expect(folha.getByText("Troca na hora, sem digitar senha.")).toBeVisible();
  await expect(folha.getByText("Aberta agora")).toBeVisible();
  await expect(folha.getByText("udn@atlas.test")).toBeVisible();
  await expect(folha.getByText("Ver as duas juntas")).toBeVisible();
  await expect(folha.getByText("Vincular outra loja")).toBeVisible();
});

test("Início: aba Todas soma as lojas, mostra Por loja e o selo da loja", async ({ context, page }) => {
  await logarComLojas(context);
  await page.goto("/dashboard-ecommerce");
  const abas = page.getByRole("tablist", { name: "Loja do Início" });
  await expect(abas.getByRole("tab", { name: "MundoFS" })).toHaveAttribute("aria-selected", "true");

  const pedidoTodas = page.waitForRequest((r) => r.url().includes("/kpis") && r.url().includes("lojas=todas"));
  await abas.getByRole("tab", { name: "Todas" }).click();
  await pedidoTodas;

  const mobile = page.getByTestId("dashboard-mobile");
  await expect(mobile.getByRole("heading", { name: "Por loja" })).toBeVisible();
  await expect(mobile.getByText("R$ 39.857,70").first()).toBeVisible();
  await expect(mobile.getByText("· 80,7%")).toBeVisible();
  await expect(mobile.getByText("por faturamento no período · MundoFS + UDN")).toBeVisible();
  await expect(mobile.locator("ol").getByText("UDN", { exact: true })).toBeVisible();
  await semScrollLateral(page);

  // A escolha fica salva: recarregar mantém "Todas".
  await page.reload();
  await expect(page.getByRole("tab", { name: "Todas" })).toHaveAttribute("aria-selected", "true");
});

test("tocar na outra loja troca a sessão sem login", async ({ context, page }) => {
  await logarComLojas(context);
  let corpo: unknown = null;
  await context.route("**/api/auth/trocar-loja", async (r) => {
    corpo = r.request().postDataJSON();
    await r.fulfill({ json: { ok: true, loja: { empresaId: "udn", nome: "UDN" } } });
  });
  await page.goto("/dashboard-ecommerce");
  await page.getByRole("tablist", { name: "Loja do Início" }).getByRole("tab", { name: "UDN" }).click();
  // Troca e recarrega o Início (navegação dura, cache limpo).
  await expect.poll(() => corpo).toEqual({ empresaId: "udn" });
  await page.waitForURL(/\/dashboard-ecommerce/);
});

test("sem loja vinculada: nome da loja no topo e nenhuma aba", async ({ context, page }) => {
  await logarComLojas(context, LOJAS_SEM_VINCULO);
  await page.goto("/dashboard-ecommerce");
  await expect(page.getByRole("button", { name: /Loja aberta: MundoFS/ })).toBeVisible();
  await expect(page.getByTestId("dashboard-mobile").getByText("Gasto em anúncios", { exact: true })).toBeVisible();
  await expect(page.getByRole("tablist", { name: "Loja do Início" })).toHaveCount(0);
});

test("Configurações > Lojas: vincular com 2FA pede o código depois da senha", async ({ context, page }) => {
  await logarComLojas(context, LOJAS_SEM_VINCULO);
  await context.route("**/api/lojas/vincular", (r) =>
    r.fulfill({ json: { requires2FA: true, challengeId: "c".repeat(32), metodo: "EMAIL" } }),
  );
  await context.route("**/api/lojas/vincular/2fa", (r) =>
    r.fulfill({ json: { loja: { empresaId: "udn", nome: "UDN", email: "udn@atlas.test", papel: "ADMIN", vinculoId: "v1", vinculadaEm: "" } } }),
  );
  await page.goto("/configuracoes?tab=lojas");
  await expect(page.getByText("Esta conta · Administrador")).toBeVisible();
  await expect(page.getByLabel("Código de verificação")).toHaveCount(0);

  await page.getByLabel("E-mail da outra loja").fill("udn@atlas.test");
  await page.getByLabel("Senha").fill("senha-da-udn");
  await page.getByRole("button", { name: "Vincular loja" }).click();

  const codigo = page.getByLabel("Código de verificação");
  await expect(codigo).toBeVisible();
  await expect(page.getByText(/Mandamos um código para o e-mail da outra loja/)).toBeVisible();
  await codigo.fill("123456");
  await page.getByRole("button", { name: "Confirmar e vincular" }).click();
  await expect(page.getByText(/UDN vinculada/)).toBeVisible();
  await semScrollLateral(page);
});

test("Configurações > Lojas: senha errada aparece perto do campo", async ({ context, page }) => {
  await logarComLojas(context, LOJAS_SEM_VINCULO);
  await context.route("**/api/lojas/vincular", (r) =>
    r.fulfill({ status: 401, json: { erro: "CREDENCIAIS_INVALIDAS" } }),
  );
  await page.goto("/configuracoes?tab=lojas");
  await page.getByLabel("E-mail da outra loja").fill("udn@atlas.test");
  await page.getByLabel("Senha").fill("errada");
  await page.getByRole("button", { name: "Vincular loja" }).click();
  await expect(page.locator("#vincular-senha-erro")).toHaveText(
    "E-mail ou senha não conferem. Confira e tente de novo.",
  );
  await expect(page.getByLabel("Senha")).toHaveAttribute("aria-invalid", "true");
});
