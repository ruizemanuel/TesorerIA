import { expect, test } from "@playwright/test";
import { open } from "./support";

test("a browser in English sees the portada in English without touching anything", async ({ browser }) => {
  const context = await browser.newContext({ locale: "en-US" });
  const page = await context.newPage();
  await open(page, "/");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("The group's treasury, without a treasurer.");
  await expect(page.getByRole("link", { name: "Create a fund" })).toBeVisible();
  await page.getByRole("button", { name: "Español" }).click();
  await expect(page.getByRole("link", { name: "Crear un fondo" })).toBeVisible();
  await open(page, "/crear");
  await expect(page.getByLabel("Tu nombre")).toBeVisible(); // the cookie outlives the page
  await context.close();
});
