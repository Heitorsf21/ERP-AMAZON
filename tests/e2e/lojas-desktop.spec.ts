import { expect, test } from "@playwright/test";
import { logarComLojas } from "./lojas-fixtures";

test("computador: seletor na barra de cima leva ao Início com Todas as lojas", async ({ context, page }) => {
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
  await logarComLojas(context);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/dashboard-ecommerce");

  const seletor = page.locator("header").getByRole("button", { name: "MundoFS" });
  await expect(seletor).toBeVisible();
  await seletor.click();
  await expect(page.getByRole("menuitem", { name: /UDN/ })).toBeVisible();
  await page.getByRole("menuitem", { name: "Todas as lojas" }).click();

  await expect(page.locator("header").getByRole("button", { name: "Todas as lojas" })).toBeVisible();
  const tabela = page.getByRole("table").filter({ hasText: "Faturamento" }).first();
  await expect(page.getByText("mesmo período, cada loja e o total")).toBeVisible();
  await expect(tabela.getByRole("row", { name: /Total/ })).toBeVisible();
  await expect(tabela.getByRole("row", { name: /Total/ }).getByText("R$ 39.857,70")).toBeVisible();
  await expect(tabela.getByRole("row", { name: /UDN/ }).getByText("R$ 7.685,44")).toBeVisible();
});
